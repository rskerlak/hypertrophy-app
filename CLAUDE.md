# CLAUDE.md

App personal (single-user, offline-first, sin backend ni login) para planificar y ejecutar mesociclos de hipertrofia en el gimnasio. PWA instalable en el móvil.

Contexto completo del producto: @CONTEXT.md
Fundamento científico de cada número/regla: @SCIENCE.md
Config del motor (datos, no código): `rules.config.json`

## Comandos

```bash
npm run dev        # dev server (Serwist deshabilitado en dev a propósito)
npm run build      # build estático (output: 'export')
npm run test       # vitest — tests del motor de dominio
npm run test:watch # vitest en watch
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Reglas de arquitectura (IMPORTANT — no negociables)

- **YOU MUST** mantener `src/domain/` como funciones PURAS: sin React, sin Dexie, sin `window`, sin efectos, sin fechas del sistema (la fecha entra como argumento). Es la única parte con lógica científica y la única que se testea con unit tests. Si algo en `domain/` importa de `ui/`, `db/` o `react`, está mal.
- **YOU MUST** leer todos los umbrales, rangos y parámetros científicos desde `rules.config.json`. NUNCA hardcodear un número científico (volumen, RIR, incrementos, disparadores de deload) en el código. Si un número de entrenamiento aparece como literal fuera de la config, es un bug.
- La progresión del mesociclo avanza por **sesión completada**, no por fecha. El calendario es solo capa de agenda/visualización. No atar el estado del meso a `Date`.
- Flujo de datos: UI (React/shadcn) → estado (Zustand) → repository (`src/db/`) → Dexie/IndexedDB. La UI nunca habla directo con Dexie; pasa por el repository.
- El check-in de sueño/nutrición **NUNCA** modifica la sesión ni bloquea su inicio. Solo persiste para estadística longitudinal. Tono neutral, sin culpa.

## Stack (ya decidido — no cambiar sin pedir)

Next.js (App Router, `output: 'export'`) · TypeScript estricto · Tailwind + shadcn/ui · Zustand · Dexie.js + `dexie-react-hooks` (`useLiveQuery`) · Serwist (service worker) · Recharts · react-hook-form + Zod · Vitest.

- Serwist: `disable` en dev, `reloadOnOnline: false` (no recargar a media sesión en el gym).
- Llamar `navigator.storage.persist()` al iniciar para evitar evicción de IndexedDB.
- Screen Wake Lock durante la sesión activa, envuelto en try/catch y re-adquirido en `visibilitychange`.

## Estructura de directorios

```
src/
  domain/        # funciones puras: progresiones, redondeo, generación de meso, deload, stats, 1RM. CON tests.
  db/            # esquema Dexie + repositories (única capa que toca IndexedDB)
  store/         # stores Zustand
  app/           # rutas Next.js (App Router)
  components/    # UI (shadcn + propias)
  lib/           # utilidades no científicas (formato, fechas de agenda)
rules.config.json
CONTEXT.md
SCIENCE.md
```

## Convenciones

- TypeScript `strict: true`. Sin `any` salvo justificación en comentario.
- Tipar el shape de `rules.config.json` con un tipo derivado por Zod; validar al cargar.
- Nombres de identificadores, tablas y claves JSON en inglés. Prosa/comentarios en español está bien.
- Componentes de shadcn: instalar con el CLI y adaptarlos; no reescribir Radix a mano.
- Formularios: react-hook-form + resolver Zod. Nada de `<form>` sin validación.

## Workflow

- Para cualquier feature que toque varios archivos, usá **plan mode** primero. No saltes directo a codear features multi-archivo.
- Construí por **rebanadas verticales** (datos + lógica + UI de una feature), NO capa por capa (evitar "primero toda la DB, luego toda la UI").
- Después de tocar `src/domain/`, correr `npm run test` y `npm run typecheck` antes de dar por hecho el trabajo. Los tests del motor son el criterio de "hecho".
- Al terminar una feature, revisá el diff contra `CONTEXT.md` (podés usar un subagente para revisión adversarial), reportando solo gaps que afecten corrección o requisitos declarados — no sobre-ingeniería.

## Do / Don't

- DO: escribir tests unitarios de cada regla de progresión y del redondeo de carga con casos límite (salto mínimo > % objetivo → añadir reps).
- DO: mantener honestidad epistémica en la UI donde corresponda (ej. el aviso de "n pequeño" en stats de un solo ciclo; el deload sugerido como probabilístico, no como "MRV alcanzado").
- DON'T: usar `localStorage`/`sessionStorage` para datos de dominio (usar IndexedDB vía Dexie).
- DON'T: inventar librerías o APIs. Si dudás de que algo exista, verificá en el package instalado antes de usarlo.
- DON'T: agregar backend, auth, multiusuario o sync. Está fuera de scope (ver no-objetivos en CONTEXT.md).
- DON'T: usar bombeo/dolor muscular como métrica de progreso.
