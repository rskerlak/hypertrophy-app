# Auditoría Plan A (A0–A4) — Pista 2: Código y motor

- Commit auditado: `aca8391` (main, árbol limpio). Fecha: 2026-11-05.
- Auditor: agente independiente (Claude Opus 5.5). Sin correcciones; solo reporte.
- Protocolo: `docs/plans/AUDITORIA.md`, Pista 2.

## Resumen

1. La arquitectura se cumple: el dominio es puro, la UI no toca Dexie, no hay `any` ni `console.log`, y typecheck, lint, tests (225) y build pasan. La cobertura de `src/domain` es 95.95 % de líneas, y el respaldo y la puerta de actualización del SW están bien resueltos.
2. La simulación de 20 sesiones encontró dos prescripciones incorrectas reproducibles. El modelo **lineal** sube carga con el salto mínimo del equipo sin mirar el % (+100 % en una polea de 5 kg), lo que viola F6. En **todos los modelos**, una serie drop o parcial congela la carga para siempre.
3. Hay 8 hallazgos Medios: deriva de cargas al mostrarlas en lb, transición de fase en bloques, carga heredada al reemplazar ejercicios, volumen perdido al borrar un ejercicio, APRE ignorado en la continuación, reps ilimitadas en peso corporal, números fuera de config y tests faltantes. Veredicto: **RECHAZADO** (2 Altos abiertos).

## Verificación base

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run lint` | limpio (sin warnings) |
| `npm run test` | 22 archivos, 225 tests en verde |
| `npm run build` | OK, 17 páginas estáticas |

## Hallazgos

Los tests de reproducción eran descartables (`*.tmp.test.ts`) y se borraron al terminar. La reproducción se resume con la salida real.

| id | sev. | archivo:línea | descripción | reproducción | sugerencia |
|---|---|---|---|---|---|
| H1 | **Alta** | `src/domain/progression.ts:257-262` | Lineal: si la carga +`loadIncrementPctPerSession` redondea a la actual, salta igual a `nextAchievableLoad` y vuelve al piso de reps, sin importar cuánto mide el salto. Viola F6 ("si el salto mínimo excede el % objetivo, añade reps"). Lineal es el modelo default del perfil novato. Con barra y discos de 1.25 kg cada salto es de +4.2 % contra un objetivo de 2.5 %. | `nextPrescription` lineal, usuario que cumple exacto. Polea a 5 kg: `5→10 (+100%) → 15 (+50%) → 20 (+33%)`, todos `linear-hit`. Polea a 20 kg: +25 %, +20 %, +16.7 %. Mancuerna armable a 12 kg: +20.8 %, +17.2 %. | Ver propuesta abajo. |
| H2 | **Alta** | `src/domain/progression.ts:132-134` (`achievedReps`), `:162-183` (`rirAdjustedReps`), `:186-190` (`hitTarget`), `:214` | Las series `drop` y `partial` (y cualquier serie con menos carga) entran al **mínimo de reps** y a `hitTarget`. Así, un usuario que agrega un drop set nunca llega al tope: la carga queda congelada y el motor repite "subir reps". `lastLoggedLoad` (`src/lib/sessionPlan.ts:111`) toma la carga máxima, así que las reps se juzgan contra una carga que esas series no usaron. | Doble: 3 series que cumplen exacto más un drop al 75 % × 8 reps queda en `60x9 (double-below-ceiling)` 10 sesiones seguidas. Lineal con drop: `linear-miss`, después `linear-stalled` para siempre. | Ver propuesta abajo. |
| M1 | Media | `src/components/ui.tsx:206-210, 220-223`; `src/app/settings/page.tsx:19, 34-41` | En lb, `EditableNumber` confirma el valor al perder foco **aunque no se haya editado**. Hace kg → lb redondeado a 0.1 → kg, y la carga guardada cambia. La lista de discos de Ajustes hace lo mismo en cada `onBlur`, así que el inventario se corrompe sin aviso. Efectos: adherencia en "por encima", posibles PR falsos, y comparaciones por igualdad exacta de carga (`repDeltaBySession`, trayectoria de fatiga) que dejan de encontrar pares. | Foco y blur en lb: `80→80.0137`, `62.5→62.505`, `100→100.0171`. Discos `[1.25…25]` quedan `[1.2701, 2.4948, 4.9895, 9.9790, 15.0139, 20.0034, 24.9929]`. `loadAdherence` de esa serie: `pctAbove: 100`. | Confirmar solo si `draft` cambió respecto del texto inicial. En `editList`, conservar el kg original de cada token que no cambió. Test kg→lb→kg. |
| M2 | Media | `src/domain/progression.ts:203-211` + rama de tope (`:362-394`) | Bloques: al pasar de acumulación (8–15) a intensificación (5–10), el historial queda por encima del tope nuevo. El motor sube solo el salto mínimo y prescribe el piso, sin re-anclar la carga al rango nuevo. La fase de intensificación (40 % del meso) arranca muy lejos del RIR objetivo y el ajuste por RIR está topeado (±2 y atenuado). | Historial `62.5×11 @RIR3` (e1RM 91.6), semana 3 de 5 → `65×5 (double-ceiling)`. A 65 kg el e1RM implica ≈12.3 reps+RIR, o sea ≈RIR 7 contra objetivo 2. Simulación: tras el cambio de fase hacen falta ~6 sesiones para volver al tope. | Si el rango de la fase difiere del rango del historial, re-anclar con `suggestLoadFromHistory` (Epley invertido) para el piso del rango al RIR objetivo y aplicar `roundToAvailable`. Documentarlo en CONTEXT §6. |
| M3 | Media | `src/domain/mesocycle.ts:510-521` (`replaceExerciseInPlan`), `:530-551` (`swapExerciseInPlan`); `src/lib/sessionPlan.ts:97-116` (swap solo hoy) | Reemplazar, intercambiar o cambiar "solo hoy" un ejercicio conserva el `targetLoadKg` del anterior. Sin historial en la pista, `nextPrescription` devuelve esa carga sin redondear (`no-history`). Pasa también en el borrado con reemplazo de A4.2. | Plan con press de banca a 80 kg, reemplazado por aperturas en polea: `fly 80 -> 80 no-history`. | Al cambiar el ejercicio, re-estimar con `suggestLoadFromHistory` del nuevo (como `suggestStartingLoad` de A4.4). Sin historial, marcar la carga "a definir" y no heredarla. |
| M4 | Media | `src/domain/analytics.ts:126-130` (y lookups análogos por `exById`); `src/db/repositories.ts:147-165` + `mesocycle.ts:510` | Borrar un ejercicio con historial (A4.2) hace dos cosas. (a) Sus series dejan de sumar volumen completado: el ejercicio ya no existe y `exById.get` falla. (b) `replaceExerciseInPlan` también reescribe las semanas **ya entrenadas**, así que esos logs pierden su pista (`trackKey "?"`) y el volumen planificado pasado se atribuye al reemplazo. Esto contradice el principio de `swapExerciseInPlan`, que no toca las semanas entrenadas. | `weeklyReport` con 3 series de press de banca hechas: con el ejercicio presente `chest done 3/3`; sin él (borrado) `done 0/3`. | Guardar una lápida (nombre y músculos) del ejercicio borrado, o no borrar los que tienen historial (archivarlos). Reemplazar solo desde la semana actual. |
| M5 | Media | `src/db/repositories.ts:570-582` (`createFollowUp`) | La continuación de un meso llama a `nextPrescription` **sin** `slotProgression` (ni `rirCapOverride`, a diferencia de la sesión). Los slots APRE heredan carga con doble progresión. | Mismo historial (AMRAP de 16 reps sobre un rango 8–12 a 60 kg): con `slotProgression: "apre"` da 62.5 (`apre`); sin él, como en `createFollowUp`, da 60 (`double-below-ceiling`). Reproducido a nivel dominio; la omisión se ve en la lectura del código. | Pasar `slotProgression: slot.progression` y el mismo `rirCapOverride` calibrado que usa `buildSessionView`. |
| M6 | Media | `src/domain/progression.ts:267` (`linear-no-jump`), `:374` (`double-no-jump`) | En peso corporal (o carga 0) las reps crecen sin tope, por encima del rango del usuario y de `repRanges.globalValid.max` (30, el límite de evidencia de SCIENCE §3). | 20 sesiones: lineal/doble 8–12 llegan a 27 reps; DUP liviano llega a **35** reps (> 30). | Topear en `globalValid.max` y, al llegar, sugerir lastre o una variante más difícil (regla `explain` propia). |
| M7 | Media | `src/domain/rules.ts:347`; `src/domain/deload.ts:176`; `src/app/plan/page.tsx:89, 92` | Números de entrenamiento fuera de `rules.config.json`. (a) El fallback del calendario de RIR usa un tope `4` literal para las longitudes sin tabla (7, 9–12; el novato llega a 12): `[4,4,4,4,4,4,4,4,3,2,1,0]`. (b) Umbral de disposición `≤ 2` (señal desactivada por defecto). (c) Slot nuevo con `targetSets: 3` (volumen) y carga default `20` kg. (a) y (b) son anteriores a Plan A (commit `82f3387`). | `rirScheduleForLength(rules, 12)` devuelve el arreglo de arriba; `(…,7)` da `[4,4,4,3,2,1,0]`. | Usar `rirSchedule.selectableBand.max` (o tabular 7/9–12). Agregar `chronicPoorReadiness.readinessMax` y `baseWeek.defaultSlotSets` / `defaultStartingLoadKg` al config con nota `_`. |
| M8 | Media | `src/domain/progression.ts:243-246, 265-271, 294-300, 353-359`; `src/domain/swap.ts:48-56`; `src/db/__tests__/` | Tests faltantes en el dominio. No tienen ningún test las reglas `linear-no-jump`, `linear-miss` y `double-no-jump`, ni el fallback de fase de bloques ni el swap sin candidatos (líneas sin cubrir según v8). Ningún test fija el tratamiento de `drop`/`partial` en la progresión ni la proporcionalidad del salto en el lineal (por eso H1 y H2 pasaron). Además no existe `src/db/__fixtures__/`: el test "acepta v1" solo cambia la etiqueta de un objeto v2, y los repositorios (transacciones, `import`, `createFollowUp` por pista) no tienen tests porque no hay IndexedDB falsa. | Reporte de cobertura (abajo). `ls src/db/__fixtures__` no existe. | Ver "Tests nuevos sugeridos". |
| B1 | Baja | `src/db/repositories.ts:164` | `replaceAndRemove` hace el borrado (`exerciseRepo.remove`) fuera de la transacción del reemplazo. El estado intermedio es consistente (el ejercicio queda vivo y sin referencias), pero no es atómico. | Lectura de código. | Incluir `exercises` y `baseWeek` en una sola transacción. |
| B2 | Baja | `src/db/repositories.ts:458-466` | `schedule` lee las sesiones fuera de la transacción y escribe `trainingWeekdays` en otra. | Lectura de código. | Una transacción `rw` sobre `sessions` y `settings`. |
| B3 | Baja (sospecha) | `src/components/Dialog.tsx:34-37` | Escape: `stopPropagation()` no frena a otros listeners del **mismo** nodo (`document`, fase de captura). Con una `Sheet` abierta y un `askConfirm` encima, un Escape cerraría las dos. | No reproducido (requiere DOM). | `stopImmediatePropagation()` y que solo la hoja superior escuche. |
| B4 | Baja | `src/domain/deload.ts:170-188, 275` | La variable local `window` ensucia el grep de pureza del protocolo (falso positivo). | `grep "window\." src/domain` da 5 líneas. | Renombrar a `recent`. |
| B5 | Baja | `SCIENCE.md:25` | "Hickmott 2022 (meta)" y "Meta 2022 (PMID 35038063)" se presentan como dos fuentes, pero son el mismo artículo (Hickmott et al., *Sports Med Open* 2022). Los números (MD 2.07 kg, IC −0.32 a 4.46, p=0.09) son correctos. | PubMed efetch del PMID 35038063. | Unificar en una sola cita. |
| B6 | Baja | `src/domain/rules.ts:37-270` | Los `.default` de Zod duplican los valores del config. El protocolo lo exige por compatibilidad, pero pueden divergir en silencio. | Lectura de código. | Test: `parseRules(config sin claves A1–A4)` debe ser igual a `parseRules(config)` en esas claves. |
| S1 | sospecha (sería Alta) | `src/lib/sessionPlan.ts:223-250` (y `:238`, `repositories.ts:560-561`) | El mismo ejercicio dos veces en un día (lo que `slotIndex` habilita, CONTEXT §4) mezcla el historial de ambos slots: no se filtra por `slotIndex` y la pista se decide con `slots.find` del **primer** slot. Por ejemplo, una serie pesada y una de back-off se juzgarían juntas con el mínimo de reps. | No reproducido de punta a punta (repos sin IndexedDB falsa en los tests). | Filtrar los logs por `slotIndex` (con fallback por orden para logs viejos) y calcular la pista por slot. |

Conteo: **Alta 2 · Media 8 · Baja 6 · sospecha 1**.

### Propuesta de corrección para los Altos (≤ 5 líneas cada una)

**H1.** En `linearProgression`, calcular `jumpPct = (next − current) / current × 100`. Si `jumpPct > loadIncrementPctPerSession × (1 + reps sobre el piso)`, aplicar la misma lógica de crédito por reps que el doble: devolver `nextReps = min(repRange.max, achieved + 1)` con la misma carga y la regla `linear-add-rep`. Saltar solo al llegar al tope (y avisar si el salto es grande). Test: polea a 5 kg nunca salta más del umbral sin pasar por el tope del rango.

**H2.** Para la progresión, usar solo las series con `kind` ausente, `working` o `failure` **y** `actualLoadKg` igual a la carga de trabajo de la sesión (la máxima). `drop` y `partial` quedan fuera de `achievedReps`, `rirAdjustedReps` y `hitTarget`, pero siguen contando para volumen y stats. Agregar un predicado `isProgressionSet` en `types.ts` y documentarlo en CONTEXT §4.

## Simulación del motor (20 sesiones, usuario que cumple exacto)

Rango base 8–12; DUP y bloques usan los rangos del config; RIR objetivo 2 con RIR reportado; 3 series por sesión. Criterios: no se congela, no baja sin motivo, no salta más del 15 % por sesión, reps ≤ tope (`maxRepsOverCeiling = 0`).

| Modelo \ equipo | Barra c/1.25 (60) | Barra s/1.25 (60 / 40) | Rack fijo (14 / 26) | Armable (17 / 12) | Máquina 5 (40) | Polea 5 (20) | Peso corporal |
|---|---|---|---|---|---|---|---|
| lineal | OK (máx 4.2 %, pero > 2.5 % objetivo → H1) | OK (8.3 % / 12.5 %) | **15.4 %** en 26→30 (salto del rack) | OK / **20.8 %, 17.2 %** | OK (12.5 %) | **25 %, 20 %, 16.7 %** (5 kg: **+100 %**) → H1 | reps 8→27, fuera de rango (M6) |
| doble | OK | OK | 26→30 15.4 % (inventario, avisado `large-jump`) | 12 kg: 20.8 % (inventario, avisado) | OK | 25 % (inventario, avisado) | reps 8→27 (M6) |
| DUP pesado/medio/liviano | OK | OK | ídem doble | ídem doble | OK | ídem doble | liviano llega a 35 > 30 (M6) |
| bloques | OK* | OK* | ídem doble* | ídem doble* | OK* | ídem doble* | reps sobre el tope de fase (M6) |

- En ningún caso la carga se congela (con equipo cargable) ni baja. Las reps nunca superan el tope con equipo cargable. Las rachas sin subir carga son las esperadas (ancho del rango: doble 5, DUP liviano 10, bloques 8).
- En doble, DUP y bloques, los saltos > 15 % salen solo cuando el **paso mínimo del equipo** ya es > 15 % de la carga. El motor lo marca con `double-ceiling-large-jump` (decisión documentada en CONTEXT §6). En el lineal no hay aviso ni alternativa (H1).
- \* Bloques: al cambiar de fase la carga no se re-ancla (M2).
- Con un drop set por sesión, todos los modelos se congelan (H2).

## Cobertura (`@vitest/coverage-v8@3.2.6`, `--no-save`, solo `src/domain`)

| Métrica | Valor |
|---|---|
| Líneas / sentencias | **95.95 %** (≥ 90 % ✓) |
| Ramas | 87.42 % |
| Funciones | 99 % |

Archivos más bajos: `swap.ts` 82 %, `deload.ts` 91.2 % (`chronicPoorReadiness` sin test), `progression.ts` 91.3 % (reglas `linear-no-jump`, `linear-miss`, `double-no-jump` y el fallback de fase sin test), `rounding.ts` 92.9 %. `index.ts` (re-exports) 0 %. Ninguna función del dominio queda sin ningún test; las faltas son ramas.

## Checklist de la Pista 2

- Pureza del dominio: sin React, Dexie, `window`, `Date.now` ni `fetch`. Las únicas coincidencias del grep son la variable local `window` (B4) ✓.
- `getDb()` en app/components/store/lib: 0 ✓. Dexie solo se importa en `src/db` ✓.
- Check-ins nunca llegan a `nextPrescription` ni a `generateMesocycle` ✓.
- Progresión por sesión: las fechas del dominio solo se usan en agenda, stats y para ordenar (`groupBySession`) ✓.
- Claves nuevas del config: todas tienen nota `_` y `.default` en Zod ✓ (B6).
- Números fuera de config: M7. Descartados como no científicos: `KG_PER_LB` (constante física), `DATA_LIMITS` del respaldo, `SKIP_THRESHOLD_DAYS` (umbral de agenda documentado), los tiempos de UI y los 183 días del recordatorio de medidas.
- Invariantes, pistas, A0, calentamiento, `explain` y determinismo tienen tests y pasan ✓. Falta lo de `drop`/`partial` y la proporcionalidad del lineal (M8).
- Respaldo: armé un respaldo con la forma real que exporta la app (todas las plantillas × 4 modelos, novato 12 semanas, banda 1–3, superserie, ancla y APRE, `overrides`, logs de calentamiento con lado y nota, perfiles de equipo, `units: "lb"`, check-in con `perceivedFatigue`, medidas, actividades, bugs). **Valida OK en los 8 casos.** Los límites de cordura (reps ≤ 100, RIR ≤ 10, carga ≤ 2000 kg) son razonables. El import valida antes de borrar y escribe las 10 tablas en una sola transacción ✓.
- `baseWeekRepo.get` es de solo lectura (ids `tmp-` en memoria; la migración real está en `ensureSeeded`) ✓. `settingsRepo.update` refleja el inventario en el perfil activo y `switchProfile` sincroniza antes de cambiar ✓.
- SW: `skipWaiting: false` más el `SKIP_WAITING` de Serwist (verificado en `node_modules/serwist/src/Serwist.ts:188-195`). `reloadOnOnline: false`. Solo recarga si `applying`. Con sesión en curso pregunta y permite posponer ✓.
- Calidad: sin `any` ni `console.log`; `sessionStorage` solo para borradores (permitido por PLAN_A A1.7) ✓.
- Citas de SCIENCE.md (web): verifiqué 6 y las 6 existen y coinciden: Pelland 2026 (DOI 10.1007/s40279-025-02344-w, *Sports Med* 56(2):481–505), Martikainen 2025 (10.1007/s42978-025-00338-8), Pancar 2026 (10.1038/s41598-026-40612-5, *Sci Rep* 10299), Russo 2025 (10.1080/10833196.2025.2564026), PMID 39869076 (Enes 2025, mujeres entrenadas; CSA y 1RM tal cual se citan) y PMID 35038063 (Hickmott 2022; los números coinciden, ver B5).

## Lo que está bien y debe preservarse

- Dominio puro y determinista, con `progressionTrackKey` como **definición única** de pista, compartida por el motor, `createFollowUp` y las stats.
- Redondeo en gramos, `nextAchievableLoad`, que nunca congela con equipo cargable, y la extrapolación del rack fijo.
- La doble progresión respeta el tope del rango como límite duro y avisa los saltos grandes.
- `explain.rule` distinta por rama, con sus inputs.
- El respaldo se valida con Zod antes de borrar, con mensajes que nombran tabla, fila y campo, y se importa en una sola transacción.
- La puerta de actualización es pura y testeada, y nunca toma control a mitad de sesión.
- Las semanas base se migran en el arranque y no dentro de `useLiveQuery`.
- Hay tests de regresión para cada regla A0.

## Tests nuevos sugeridos

| Nombre | Qué fija |
|---|---|
| `progression: lineal no salta más que el % objetivo; suma reps hasta el tope` | H1 (polea a 5 kg, armable a 12 kg, barra sin 1.25) |
| `progression: drop/partial no deciden la progresión` | H2 (3 working en el tope + drop → sube carga) |
| `progression: series a menor carga que la de trabajo no cuentan para reps logradas` | H2 (bajada intra-sesión) |
| `progression: simulación 20 sesiones por modelo × equipo` | invariantes de la simulación como test permanente |
| `progression: bloques re-anclan la carga al cambiar de fase` | M2 |
| `progression: peso corporal topea en globalValid.max` | M6 |
| `progression: linear-no-jump / linear-miss / double-no-jump` | reglas sin cubrir (M8) |
| `units: kg→lb→kg sin edición no cambia el valor` | M1 |
| `analytics: volumen completado de un ejercicio borrado se conserva` | M4 |
| `mesocycle: replaceExerciseInPlan no toca semanas entrenadas` | M4 |
| `followUp: hereda APRE con slotProgression` | M5 (función pura extraída de `createFollowUp`) |
| `rules: rirScheduleForLength sin literales (7, 9–12 semanas desde config)` | M7 |
| `backupSchema: fixtures reales v1 y v2 en src/db/__fixtures__` | import de versiones anteriores |
| `sessionPlan: mismo ejercicio dos veces en un día no mezcla historial` | S1 (requiere una función pura extraída o IndexedDB falsa) |

## Veredicto

**RECHAZADO.** Quedan abiertos 2 hallazgos Altos (H1 y H2, prescripción incorrecta). La fase A4 no se aprueba y el Plan A no puede cerrarse hasta corregirlos. Para cerrar el plan también hay que resolver los 8 Medios de esta pista, que es pista principal de A. Ninguna fase de Plan B debería empezar antes de cerrar H1 y H2 y de que esta pista vuelva a auditarse.
