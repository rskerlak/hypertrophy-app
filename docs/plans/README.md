# Planes de evolución de MyoNoesis — guía para agentes

Esta carpeta contiene instrucciones **ejecutables por agentes** (Claude Opus 5.5 u otro modelo capaz) para llevar la app al nivel profesional definido en noviembre de 2026, y el protocolo de auditoría posterior.

| Archivo | Qué es | Quién lo usa |
|---|---|---|
| `PLAN_A.md` | "Estudio": motor + sesión profesional + historial, 100% offline | Agentes implementadores |
| `PLAN_A5.md` | "Memoria": historial entre mesos, mantener, dolor, actividades, test AMRAP. 100% offline | Agentes implementadores, **después** de Plan A |
| `PLAN_B.md` | "Plataforma": backend propio, login, sync, capa IA (DeepSeek), integraciones | Agentes implementadores, **después** de A0–A1 |
| `AUDITORIA.md` | Protocolo de auditoría en tres pistas (UX, código, seguridad) y criterios de aceptación | Agentes auditores |

## Reglas que ningún plan puede romper

Son las de `CLAUDE.md` y `CONTEXT.md`; se repiten acá porque un agente que lee solo esta carpeta debe conocerlas:

1. `src/domain/` es **puro**: sin React, Dexie, `window`, `Date.now()`, `fetch`. La fecha entra como argumento. Todo lo científico vive ahí y se testea con Vitest.
2. **Ningún número científico en código.** Umbrales, rangos, incrementos, descansos, topes: todo en `rules.config.json`, validado con Zod en `src/domain/rules.ts`. Si aparece un literal de entrenamiento fuera del config, es un bug (hoy hay uno: `RECENT_WINDOW = 6` en `src/lib/postSession.ts` — A0 lo corrige).
3. La UI nunca toca IndexedDB: pasa por `src/db/repositories.ts`.
4. La progresión avanza por **sesión completada**, nunca por fecha.
5. El check-in de sueño/nutrición/readiness **nunca** modifica una prescripción ni bloquea una sesión. Solo se registra.
6. Honestidad epistémica en la UI: landmarks "heurísticos", deload "sugerido", stats con "n pequeño". Nada se vende como óptimo si la evidencia dice "equivalente".
7. El motor **sugiere**; el usuario decide. Nada se borra ni se cambia solo.
8. Nunca prescribe un LLM (kg, reps, series, RIR, deload, swap). Eso queda en funciones puras testeadas. (Plan B, sección B2.)
9. Compatibilidad de datos: el nombre de la base IndexedDB es `"hypertrophy"` y el respaldo lleva `app: "hypertrophy"`; no se cambian. Toda tabla nueva es una versión Dexie nueva, aditiva.
10. Cada cambio de `src/domain/` termina con `npm run test` y `npm run typecheck` en verde; cada cambio visible termina con una verificación end-to-end en navegador (ver "Cómo verificar" abajo).

## Cómo trabajar (para cada tarea)

1. Leer `CLAUDE.md`, `CONTEXT.md` (§ afectadas) y `SCIENCE.md` (§ afectadas) antes de tocar nada.
2. Trabajar en una rama o worktree por tarea (`feat/a1-ghost-values`, etc.). Un commit por tarea, mensaje en el formato de los commits existentes (`git log`), terminando con la línea de coautoría que indique el entorno.
3. Orden dentro de una tarea: **dominio + tests → repositorio → UI → docs (`CONTEXT.md`/`SCIENCE.md`/notas `_` en `rules.config.json`) → verificación E2E → commit**.
4. Comandos: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. El build estático debe terminar sin errores.
5. Verificación E2E: `.claude/launch.json` define el servidor `app` (`npm run serve`, puerto 3000, sirve `out/`). Para scripts con `playwright-core` (canal `msedge`, ya instalado) usar archivos `*.tmp.mjs` en la raíz y **borrarlos antes del commit**. Para restaurar datos reales, importar un respaldo JSON desde `/settings` (`input[type="file"]`). Patrón probado: borrar la DB `hypertrophy` vía `indexedDB.deleteDatabase`, recargar, pasar el onboarding (`Continuar`, `Continuar`, `Omitir`), importar respaldo, navegar.
6. Nunca commitear respaldos del usuario ni archivos `*.tmp.*`.
7. Si una tarea revela que la spec de esta carpeta está mal (contradice el código real), **corregir la spec en el mismo commit** y explicarlo en el mensaje.

## Estado de partida (commit `4c43385`, 5-nov-2026)

123 tests en verde. Funciona: semana base con días fuerte/normal/liviano, 4 modelos de progresión, banda de RIR por meso, pistas de progresión separadas, cargas iniciales desde el 1RM real, deload activo, disparadores multi-señal, swap por estancamiento, calibración de RIR, recorte de volumen con anclas/prescindibles, mancuernas armables, Excel/JSON export, medidas, actividades, correlaciones, bugs anotados con contexto, PWA offline en `myo.noesisargentina.com` (GitHub Pages, rama `gh-pages`, workflow `.github/workflows/deploy-pages.yml`).

Bugs conocidos (confirmados en código, se corrigen en A0): ver `PLAN_A.md` §A0.
