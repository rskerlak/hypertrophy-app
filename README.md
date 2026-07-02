# Hipertrofia — app personal de mesociclos basada en evidencia

PWA single-user, offline-first, sin backend ni login, para planificar y ejecutar
mesociclos de hipertrofia. El motor de cálculo es determinista y transparente, y
comunica la incertidumbre de sus heurísticas en lugar de fingir precisión.

## Comandos

```bash
npm run dev        # dev server (Serwist deshabilitado en dev a propósito)
npm run build      # build estático (output: 'export') → carpeta out/
npm run test       # vitest — 62 tests del motor de dominio
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

Abrí http://localhost:3000. Los datos viven en IndexedDB del navegador.

## Uso rápido en Windows (un click)

- **`Abrir Hipertrofia.bat`** — doble clic. La primera vez instala dependencias y
  genera la app; después levanta el servidor y abre el navegador. Cerrás la ventana
  para detenerla. Podés hacerle un acceso directo al escritorio.
- **`Reconstruir Hipertrofia.bat`** — regenera la app tras editar `rules.config.json`.

Requiere [Node.js](https://nodejs.org) instalado.

## Arquitectura

Dominio puro + adaptadores. Ver `CLAUDE.md` y `CONTEXT.md` para el detalle.

```
src/
  domain/     # funciones PURAS (sin React/Dexie/window): progresiones,
              # redondeo de carga, generación de meso, deload, swap, stats, 1RM.
              # Toda la ciencia sale de rules.config.json. CON tests.
  db/         # esquema Dexie + repositories (única capa que toca IndexedDB) + seed
              # (biblioteca de ~99 ejercicios/máquinas, nombre EN + español entre paréntesis)
  lib/        # composición no-pura (sessionPlan, postSession), wake lock, formato
  components/ # UI (primitivas propias + gráficos Recharts)
  app/        # rutas Next.js App Router (Hoy, Plan, Sesión, Calendario, Stats, Ajustes)
rules.config.json  # datos científicos versionables (recalibrás sin tocar código)
```

## Flujo de la app

1. **Ajustes** → perfil de experiencia, peso, equipamiento (redondeo de carga),
   músculos priorizados, sueño/proteína.
2. **Plan** → definís tu semana base (días, ejercicios, series, rangos, pesos) y
   ves el volumen semanal por músculo contra MEV/MAV/MRV. Generás el mesociclo
   (modelo de progresión + semanas de acumulación + deload).
3. **Hoy / Sesión** → ejecutás con targets autorregulados por rendimiento (reps al
   RIR objetivo), registrás cada serie, timer de descanso y wake lock. Check-in
   neutral opcional (no modifica la sesión).
4. **Post-sesión** → sugerencia probabilística de deload y de cambio de ejercicio.
5. **Calendario** → agenda impulsada por sesión (perder un día no rompe la progresión).
6. **Stats** → progresión de carga, volumen completado, deriva de RIR, trayectoria
   de fatiga y adherencia, con aviso de "n pequeño".

## Recalibrar

Todo umbral científico vive en `rules.config.json` (validado con Zod al cargar).
Ajustás el JSON, no el código. Ver `SCIENCE.md` para el porqué de cada número.

## Documentos de contexto

- `CLAUDE.md` — cómo trabajar en el repo.
- `CONTEXT.md` — qué construir (PRD, modelo de datos, features, algoritmos).
- `SCIENCE.md` — fundamento de cada regla; distingue lo sólido de lo heurístico.
