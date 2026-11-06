# Auditoría Plan A5: re-auditorías y cierre

Fecha: 2026-11-06. Informes de origen: [`2026-11-06-A5-ux.md`](2026-11-06-A5-ux.md), [`2026-11-06-A5-codigo.md`](2026-11-06-A5-codigo.md), [`2026-11-06-A5-seguridad.md`](2026-11-06-A5-seguridad.md). Protocolo: [`docs/plans/AUDITORIA.md`](../plans/AUDITORIA.md).

## Resumen
Tres auditores independientes (UX, código y motor, seguridad del cliente) revisaron A5; dos re-auditorías verificaron las correcciones y encontraron cuatro huecos nuevos, también corregidos. Gate: `typecheck`, `lint`, `test` (377), `build`, `test:a11y` y `test:offline` en verde.

## Estado por hallazgo (Altos y Medios)

| id | sev. | estado | dónde se cerró |
|---|---|---|---|
| A5-01 Mantener ignorado al continuar un meso | Alta | cerrado | `createFollowUp` pasa `holdLoad` |
| A5-02 salida de Mantener contra cargas reducidas | Media | cerrado | `holdExitCandidates` (puro, con test) |
| A5-03/04 test AMRAP en "última vez" y tendencia | Media | cerrado | `isComparableSet` en `lastSessionSets` y `exerciseTimeline` |
| A5-06 RIR +1 por dolor | Media | cerrado | una rep menos (nunca bajo el piso), también en series con objetivo propio |
| A5-07 defaults de Zod | Media | cerrado | `pain` y `progression.continuity` con default; test de defaults ampliado |
| A5-08 números en textos de UI | Media | cerrado | leídos de `rules.config.json` |
| A5-11 tests faltantes | Media | cerrado (quedan Bajos) | tests de Mantener con re-anclajes, dolor que baja, deriva sin el test, APRE |
| A5S-02/03/04 respaldo y escala | Media | cerrado | schema, agregaciones lineales, validación de actividades |
| UX-A5-01 a 06 | Media | cerrado | test AMRAP en borrador, sin selector muerto, dolor aplicado no se repite, tarjeta plegada, grilla siempre, `?date=` saneado |
| A5R-01 RIR +1 no llegaba a series con objetivo propio | Media | cerrado | `setTargets` con +1 y sin AMRAP |
| A5R-02 zona de dolor sin intensidad grababa "sin dolor" | Media | cerrado | `painToSave` / `painMissingScore` |
| A5R2-01 APRE bajaba la carga tras una sesión sin AMRAP | Media | cerrado | APRE solo con la última serie al fallo; si no, doble progresión |

## Bajos abiertos (no bloquean)
- Sin test de repositorio para `createFollowUp` con Mantener ni para pausar → otro meso → reanudar (falta `fake-indexeddb`; cubierto por E2E manual).
- A5S-11 (heredado): pico de memoria transitorio al validar listas anidadas enormes.
- Rango ampliado por dolor: se recalcula desde la config vigente, no desde el valor guardado al aceptarlo.
- Spreads anteriores a A5 en agregaciones de Stats.

## Veredicto
**APROBADO CON OBSERVACIONES.** A5 queda cerrado.
