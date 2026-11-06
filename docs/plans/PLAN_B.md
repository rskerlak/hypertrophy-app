# Plan B — "Plataforma": backend propio, login, sync, capa IA e integraciones

Objetivo: la misma app, con datos que no dependen de un solo teléfono, un segundo dispositivo, y una capa de IA (DeepSeek u otro LLM) que **explica, resume y conversa sobre tus datos, pero nunca prescribe**. Alojado en el Lightsail del usuario.

Prerrequisito duro: **Plan A, fases A0 y A1 completas** (sin la sesión profesional no hay datos ricos que sincronizar ni explicar) y A4.1 (validación Zod del respaldo: es el contrato de la API).

Leer `docs/plans/README.md`. Las reglas 1–10 siguen vigentes; se agregan:
- **Offline-first se mantiene**: el cliente sigue funcionando sin red y sin cuenta. La nube es respaldo continuo y segundo dispositivo, no requisito.
- **Un solo usuario por despliegue** sigue siendo el caso de uso; el diseño debe soportar varios sin reescribir (tabla `users`, `userId` en cada fila del servidor), pero no se construye UI de administración.
- **El LLM nunca ve secretos ni escribe directo en la base**: toda escritura pasa por el motor y los repositorios, validada con Zod.

---

## B0 — Decisiones de arquitectura (documentar antes de codear, en `docs/plans/B0-decisiones.md`)

1. **Runtime del servidor**: Node 20 + Fastify (o Hono) + TypeScript, un solo proceso, SQLite vía `better-sqlite3` (archivo en volumen persistente) — suficiente para un usuario y decenas de miles de filas; Postgres solo si el usuario lo pide. Justificación: cero servicios externos, respaldo = copiar un archivo.
2. **Contrato de datos** = `BackupFile` (`src/db/repositories.ts`) validado por `backupFileSchema` (A4.1). El servidor guarda **filas**, no el blob: una tabla por tabla Dexie (`settings`, `baseWeek`, `exercises`, `mesocycles`, `sessions`, `setLogs`, `checkins`, `measurements`, `activities`, `bugReports`) con columnas `id`, `userId`, `updatedAt`, `deletedAt?`, `payload` (JSON). Los índices útiles (`sessionId`, `exerciseId`, `mesocycleId`, `date`) como columnas extraídas.
3. **Sync**: cada fila cliente gana `updatedAt` (ISO) y `deletedAt?` (tombstone). Dexie v5 agrega los campos; un hook `creating/updating` en `src/db/schema.ts` los mantiene. Algoritmo: *last-writer-wins por fila*, con `pull` desde `lastSyncAt` y `push` de las filas con `updatedAt > lastPushAt`. Sin OT/CRDT: no hay edición concurrente del mismo registro entre dispositivos en el gimnasio.
4. **Identidad de dispositivo**: `settings.deviceId` (uuid) para diagnosticar conflictos.
5. **Auth**: usuario + contraseña (Argon2id), sesión por token opaco en cookie `HttpOnly; Secure; SameSite=Strict` **y** opción de token Bearer para el cliente PWA en dominio distinto; refresh por rotación; rate limit en login; 2FA TOTP opcional (fase B4). Sin OAuth de terceros en v1.
6. **Despliegue**: Lightsail (Ubuntu), Docker Compose con `api`, `caddy` (TLS automático), volumen `./data`; backups nocturnos del `.sqlite` a Lightsail Object Storage (o `rclone` a otro bucket) con retención 30 días. Dominio sugerido `api.noesisargentina.com`.
7. **CORS**: solo `https://myo.noesisargentina.com` (+ `http://localhost:3000` en dev).
8. **Telemetría**: ninguna de terceros. Logs estructurados (pino) sin cuerpos de request; los bugs anotados ya viajan en los datos.

---

## B1 — API + auth + sync

### B1.1 Repositorio `server/` (monorepo en el mismo repo)
- `server/src/index.ts` (Fastify), `server/src/db.ts` (SQLite + migraciones versionadas en `server/migrations/*.sql`), `server/src/auth.ts`, `server/src/sync.ts`, `server/src/schema.ts` (importa los **mismos** schemas Zod de `src/db/backupSchema.ts` y `src/domain/rules.ts` — el dominio es compartible porque es puro).
- Scripts: `npm run server:dev`, `server:test` (Vitest + `supertest`), `server:migrate`.
- **Aceptación**: `GET /health` → `{ ok: true, version }`; tests de migraciones idempotentes.

### B1.2 Endpoints
| Método | Ruta | Body / respuesta | Notas |
|---|---|---|---|
| POST | `/auth/register` | `{ username, password }` → 201 | deshabilitado tras el primer usuario salvo `ALLOW_SIGNUP=true` |
| POST | `/auth/login` | `{ username, password }` → cookie + `{ token, expiresAt }` | rate limit 5/min/IP, Argon2id |
| POST | `/auth/logout` | — | invalida token |
| GET | `/me` | `{ username, deviceCount, lastSyncAt }` | |
| POST | `/sync/push` | `{ deviceId, lastPushAt, changes: { [table]: Row[] } }` → `{ accepted, rejected: [{ table, id, reason }] }` | valida cada fila con Zod; LWW por `updatedAt` |
| GET | `/sync/pull?since=ISO` | `{ changes: { [table]: Row[] }, serverTime }` | incluye tombstones |
| GET | `/export` | `BackupFile` completo | mismo formato que el JSON local |
| POST | `/import` | `BackupFile` | reemplazo total con confirmación (`?confirm=1`), guarda snapshot previo |
| GET | `/snapshots` / `POST /snapshots/:id/restore` | lista de respaldos nocturnos | |

- Todas las rutas salvo `/health` y `/auth/*` requieren sesión. Payload máximo 20 MB. Respuestas de error con `{ code, message }` y sin stack traces.
- **Aceptación**: tests de contrato por endpoint (auth requerida, validación, LWW: fila más nueva gana, tombstone borra, re-push idempotente).

### B1.3 Cliente: sync en `src/db/sync.ts` (fuera del dominio)
- Estado en `settings`: `syncEnabled`, `syncBaseUrl`, `lastPushAt`, `lastPullAt`, `deviceId`. Token en `localStorage` (`mn-sync-token`) — es credencial de UI, no dato de dominio; documentar en `CONTEXT.md` la excepción.
- Disparadores: al finalizar sesión, al volver online (`online` event), cada 10 min en foreground, y botón "Sincronizar ahora" en Ajustes. Nunca durante una serie en curso. Nunca `location.reload()`.
- Conflictos: el servidor devuelve `rejected` con motivo; la UI lista "N cambios no aplicados" y permite exportar el estado local. **No** se pierde nada local sin confirmación.
- Pantalla Ajustes → "Nube": URL del servidor, login, estado (última sync, pendientes), botón "Desvincular" (borra token, conserva datos locales).
- **Aceptación**: E2E con el servidor en local (`docker compose up`): registrar serie en dispositivo A (navegador 1) → aparece en B (navegador 2 con otro `deviceId`) tras sync; editar la misma medida en ambos offline → gana la más nueva y el otro recibe aviso; modo avión completo sigue funcionando.

### B1.4 Migración Dexie v5
- Campos `updatedAt`, `deletedAt` en todas las tablas; borrados pasan a tombstone (los repositorios `remove` marcan `deletedAt`; las consultas filtran). Compactación local de tombstones > 90 días tras sync exitoso.
- **Aceptación**: tests de repositorios con `fake-indexeddb` (todas las lecturas excluyen tombstones; export incluye tombstones solo si `includeDeleted`).

### B1.5 Operación
- `server/README.md`: instalación en Lightsail paso a paso, `docker compose`, Caddy, variables (`DATABASE_PATH`, `SESSION_SECRET`, `ALLOW_SIGNUP`, `CORS_ORIGIN`, `LLM_*`), backup nocturno (cron + `sqlite3 .backup`), restauración, rotación de logs, actualización (pull + `docker compose up -d --build`), monitoreo mínimo (`/health` desde UptimeRobot o similar, gratis).
- **Aceptación**: un agente sin contexto previo despliega siguiendo el README en una VM limpia (simular con Docker local).

---

## B2 — Capa IA (DeepSeek u otro proveedor compatible con la API de OpenAI)

### Principio (no negociable)
Evidencia 2025–2026: los planes generados por LLM son inferiores a los de expertos en 5/6 comparaciones directas y 14/24 estudios muestran fallas de seguridad sistémicas (He et al. 2026, Biol Sport 43:949–970; Havers et al. 2025). MacroFactor Workouts y Hevy Trainer declaran explícitamente que **no** usan IA generativa para prescribir. Por lo tanto:

- ✅ El LLM **explica, resume, responde preguntas sobre datos existentes, parsea entradas en lenguaje natural y traduce programas externos a la estructura de la app**.
- ❌ El LLM **nunca produce un número de carga, reps, series, RIR, deload o swap que llegue al plan sin pasar por `src/domain`**. Si el usuario pide "subime 5 kg", la respuesta es una acción propuesta (`{ action: "setSlotLoad", slot, loadKg }`) que el cliente valida con `roundToAvailable` y muestra para confirmar.

### B2.1 Servidor: `POST /ai/*` como proxy con contexto
- La clave del proveedor vive solo en el servidor (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`). El cliente nunca la ve.
- Cada endpoint arma el contexto **desde la base del servidor** (no desde lo que manda el cliente) con un presupuesto de tokens, y registra `promptTokens/completionTokens/costEstimate` por llamada en una tabla `aiUsage` (visible en Ajustes).
- Prompt de sistema común (en `server/src/ai/system.md`): rol ("asistente de un motor determinista de hipertrofia; no prescribís cargas; si te piden números, devolvés una acción propuesta en JSON"), postura epistémica (heurísticos, n pequeño), idioma español rioplatense, tono neutral y no culpabilizador (coherente con F7), prohibiciones (consejos médicos, suplementos, dietas).
- Salida siempre estructurada con JSON Schema (`{ answer: string, proposedActions?: Action[], citations?: string[] }`); `proposedActions` se valida con Zod (`actionSchema` en `src/domain/aiActions.ts`, puro) y se descarta lo inválido.

### B2.2 Casos de uso (cada uno un endpoint y una pantalla)
1. **"¿Por qué?" en lenguaje natural** (`/ai/explain`): entrada = `explain` + `rationale` de `nextPrescription` (A1.10) + últimas 3 sesiones de la pista; salida = 2–4 frases. Se muestra bajo el chip "¿por qué?" como "Asistente" (separado del motor, con icono distinto).
2. **Resumen de fin de meso** (`/ai/meso-summary`): entrada = `computeMesoStats` + correlaciones + adherencia; salida = resumen con lo que progresó, lo que no, y preguntas para el próximo meso. Incluye obligatoriamente el `smallSampleWarning`.
3. **Entrada conversacional** (`/ai/parse-log`): "hice 3 de 8 a RIR 2 con 80 en banca" → `[{ action: "logSet", exerciseId, setIndex, loadKg, reps, rir }]`; el cliente muestra las series a confirmar y registra con `sessionRepo` (nunca directo). Útil con dictado por voz (`SpeechRecognition` si está disponible, con fallback a texto).
4. **Importar un programa externo** (`/ai/parse-program`): texto o PDF (extracción de texto en servidor con `pdf-parse`) → `BaseWeek` candidata con ejercicios **mapeados a la biblioteca** (el LLM devuelve nombres; el servidor resuelve a `exerciseId` por similitud y marca los no encontrados para que el usuario elija). Cargas iniciales: **no** del LLM — se estiman con `suggestLoadFromHistory` o quedan en blanco.
5. **Q&A sobre tus datos** (`/ai/ask`): preguntas abiertas con herramientas de solo lectura (`getExerciseHistory`, `getMesoStats`, `getVolumeByMuscle`, `getMeasurements`) implementadas en el servidor; el LLM no recibe la base entera. Límite de 20 preguntas/día configurable.
6. **Bugs → issues** (`/ai/bug-triage`, opcional): toma los `bugReports` abiertos y propone un título, pasos de reproducción y archivo sospechoso; solo texto.

### B2.3 Cliente
- Panel "Asistente" (ruta `/assistant`) y entradas contextuales (chip "¿por qué?", fin de meso, sesión con micrófono). Todo opcional: si `syncEnabled=false` o sin servidor, los botones no aparecen.
- Indicador de costo acumulado del mes (de `aiUsage`).
- **Aceptación**: tests del `actionSchema` (rechaza cargas negativas, exerciseIds inexistentes, acciones no listadas); tests del servidor con un proveedor LLM **simulado** (respuestas fijas) para los 5 endpoints; E2E del flujo "parsear → confirmar → registrar" verificando que la serie quedó con `targetLoadKg` prescrito por el motor y `actualLoadKg` del usuario.

### B2.4 Evaluación continua de la IA
- `server/eval/`: 30 prompts con respuestas esperadas (explicaciones correctas, negativa a prescribir, no inventar citas) ejecutables con `npm run ai:eval`; falla si el modelo prescribe números fuera de `proposedActions` o inventa DOIs no presentes en `SCIENCE.md`. Correr al cambiar de modelo o de prompt.

---

## B3 — Integraciones realistas

- **Apple Health / Garmin / Oura / Whoop**: no hay HealthKit en PWA y Garmin no da API de fuerza a terceros (caso Hevy, marzo 2026). Implementar solo **importadores de archivos**: Apple Health `export.xml` (peso, sueño), Garmin CSV de actividades (→ `activities`), Oura/Whoop CSV (sueño, HRV como covariable). Función pura por formato en `src/lib/importers/*.ts` con tests sobre fixtures; nunca modifican sesiones.
- **Con backend**: OAuth a Oura API y Whoop API (ambas públicas, requieren suscripción) para traer sueño/HRV diarios a `checkins`/`activities`. Mostrar en Stats como covariable con el aviso "scores de wearables no validados; HRV-guided RT sin ventaja (Bittencourt 2024)". **Nunca modifican la prescripción.**
- **Exportar entrenamiento a Apple Health**: imposible desde PWA; documentar.

---

## B4 — Producto y seguridad operativa

- **2FA TOTP** opcional; recuperación de cuenta por código impreso (no email en v1).
- **Política de datos** (`docs/PRIVACIDAD.md`): qué se guarda, dónde, cómo borrar la cuenta (`DELETE /me` borra todo + snapshots en 30 días).
- **Changelog y roadmap públicos** (`CHANGELOG.md`, `docs/ROADMAP.md`), versión visible en Ajustes (ya existe `NEXT_PUBLIC_BUILD_SHA`).
- **Onboarding** por perfil con defaults de `rules.config.json` y "modo avanzado" colapsado (queja recurrente contra RP/Juggernaut/Liftosaur: demasiadas perillas).
- **Nunca** poner export, stats o datos detrás de un paywall si algún día se monetiza.

---

## Criterio de "Plan B terminado"
- Servidor desplegado en Lightsail con TLS, backups nocturnos verificados (restaurar uno y comparar `export`).
- Sync E2E entre dos navegadores, incluido un día entero offline.
- Auditoría de `docs/plans/AUDITORIA.md`, pista **seguridad** sin hallazgos altos ni medios abiertos; pistas UX y código sin altos.
- `npm run ai:eval` en verde; ninguna acción propuesta por la IA llega a la base sin pasar por Zod + motor + confirmación del usuario.
- La app sigue funcionando **íntegra** sin cuenta y sin red (test de regresión del Plan A completo).
