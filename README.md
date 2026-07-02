# Paquete de contexto — App de hipertrofia (para Claude Code)

Cuatro archivos que alimentan al agente de Claude Code para construir la app. Van a la **raíz del repo nuevo**.

| Archivo | Rol | Quién lo lee |
|---|---|---|
| `CLAUDE.md` | Cómo trabajar en el repo (comandos, arquitectura, do/don't). Corto (73 líneas) a propósito. | Agente, cada sesión |
| `CONTEXT.md` | Qué construir: PRD, modelo de datos, features, algoritmos, plan por fases. Fuente de verdad. | Agente (vía `@import`) + vos |
| `SCIENCE.md` | Por qué de cada número/regla. Distingue lo sólido de lo heurístico. | Agente (vía `@import`) + vos |
| `rules.config.json` | Datos científicos del motor (volumen, RIR, progresiones, deload, incrementos). Editable sin tocar código. | El código, en runtime |

## Cómo arrancar

1. Creá un repo/carpeta vacía y copiá estos 4 archivos a la raíz.
2. Abrí Claude Code ahí. El `CLAUDE.md` importa `CONTEXT.md` y `SCIENCE.md` automáticamente con `@`.
3. Primer prompt sugerido:
   > Leé CLAUDE.md, CONTEXT.md y SCIENCE.md. No escribas código todavía. Entrá en plan mode y proponé el plan de la Fase 0 (andamiaje) y Fase 1 (motor puro + tests) de CONTEXT.md §8. Cuando lo apruebe, empezás.
4. Trabajá fase por fase. Exigí tests verdes del motor (`src/domain/`) antes de pasar a la UI.

## Recalibrar después

Todo umbral científico vive en `rules.config.json`. Para ajustar (ej. bajar el RIR objetivo o cambiar landmarks tras varios ciclos), editás el JSON — no el código. El agente valida el schema con Zod al cargar.

## Nota honesta

El motor usa heurísticas (MEV/MAV/MRV, disparadores de deload) que no son cantidades medidas, solo andamiaje de programación. La app está diseñada para comunicar esa incertidumbre (deload "sugerido", stats con aviso de "n pequeño") en vez de fingir precisión. Ver `SCIENCE.md`.
