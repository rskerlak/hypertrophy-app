# Plan A — "Estudio": la app más profesional posible sin nube

Objetivo: que un entrenador serio use MyoNoesis en el gimnasio sin extrañar nada de RP, Alpha Progression, Hevy o MacroFactor Workouts, **sin backend**, manteniendo la transparencia del motor como diferencial. Todo lo que se agrega al motor tiene cita en `SCIENCE.md`; todo lo que no la tiene se etiqueta "heurístico" o no se agrega.

Leer primero `docs/plans/README.md` (reglas y método). Cada tarea es un commit. El orden de fases es obligatorio (A0 → A1 → A2 → A3 → A4); dentro de una fase, las tareas son independientes salvo que se indique.

Convenciones de este documento:
- **Archivos**: rutas relativas a la raíz del repo.
- **Config**: claves nuevas de `rules.config.json` (con su nota `_`), y el campo Zod correspondiente en `src/domain/rules.ts` con `.default(...)` para que respaldos y configs viejas sigan cargando.
- **Aceptación**: tests unitarios en `src/domain/__tests__/` y/o pasos E2E. La tarea no está hecha hasta que todos pasan.

---

## A0 — Corregir lo roto (obligatoria, 1 commit por ítem o uno solo bien descrito)

### A0.1 Guardar la carga prescrita además de la real
- **Hoy**: `src/app/session/page.tsx` (función que arma el `SetLog`, ~línea 86–96) pone `targetLoadKg: args.loadKg` (la carga real). `targetReps`/`targetRir` sí guardan lo prescrito.
- **Cambio**: pasar la carga sugerida del slot (`suggestedLoadKg` de `SlotPrescription`, `src/lib/sessionPlan.ts`) como `targetLoadKg`. En modo peso corporal (`planned.targetLoadKg === 0`) guardar `0` en `targetLoadKg` y el peso corporal del usuario en `actualLoadKg` como hoy.
- **No cambiar**: toda la progresión sigue usando `actualLoadKg` (test existente "la carga base es la REAL registrada").
- **Aceptación**: E2E — registrar una serie con carga distinta a la sugerida y comprobar en IndexedDB que `targetLoadKg` ≠ `actualLoadKg`. Agregar en `src/domain/stats.ts` la métrica `loadAdherence` (ver A3.4) que depende de esto.

### A0.2 Aplicar `deloadLoadPolicy.secondHalfFraction`
- **Hoy**: `src/domain/mesocycle.ts` calcula `deloadLoadPolicy = { firstHalf: "week1_load", secondHalfFraction }` pero `src/lib/sessionPlan.ts` usa siempre `planned.targetLoadKg` en deload.
- **Cambio**: en `buildSessionView`, si `week.isDeload`, determinar si la sesión está en la segunda mitad de la semana de deload (`session.dayIndex >= ceil(days.length / 2)`) y entonces `currentLoadKg = roundToAvailable(planned.targetLoadKg * secondHalfFraction, ctx)`. Función pura nueva `deloadLoadForDay(weekDays, dayIndex, baseLoad, policy, ctx)` en `src/domain/deload.ts`, con tests (día 0 = carga de semana 1; último día = fracción redondeada; peso corporal = 0).
- **Aceptación**: tests + E2E en una sesión de deload de segunda mitad mostrando la carga reducida y el `rationale` "Deload: segunda mitad a X% de la carga de la semana 1".

### A0.3 Stats Δ1RM sin deload y por pista
- **Hoy**: `src/domain/stats.ts` toma primera y última sesión de **todos** los logs del ejercicio.
- **Cambio**: `computeMesoStats` recibe `sessions` con `isDeload`; excluir deload del cálculo de `perExercise`/`perMuscle`. Agrupar por pista: clave `${exerciseId}|${intensity ?? "normal"}|${repRange.min}-${repRange.max}` usando `plan.weeks[w].days[d]` de cada sesión (reutilizar `sameProgressionTrack` de `src/domain/progression.ts`). Mostrar en `/stats` el nombre del ejercicio con sufijo " · fuerte" / " · liviano" cuando haya más de una pista.
- **Aceptación**: test con un meso de 2 pistas + deload donde la última sesión real es más pesada que la de deload → Δ positivo; test de que el deload no entra.

### A0.4 Disparador de deload: comparar con la sesión previa del mismo día
- **Hoy**: `summarizeRecentSessions` en `src/domain/deload.ts` compara cada sesión con la inmediatamente anterior aunque sea de otro día del split.
- **Cambio**: la función recibe también `dayKey` por sesión (ej. `dayIndex` del plan, o la lista ordenada de `exerciseId` del día) y compara con la **última sesión completada con el mismo `dayKey`**. `summarizeSessionPair` no cambia. Señal "performanceDropSessions" exige `consecutiveSessions` consecutivas del mismo día con caída en ≥ `exercisesAffected` ejercicios (ambos ya en config).
- **Aceptación**: test con split A/B/C donde solo A cae dos veces seguidas → dispara; test donde A cae, B sube, A cae → dispara (misma día); test donde cae una sola vez → no dispara.

### A0.5 Sugerencia de deload y ventana desde config
- `src/domain/deload.ts`: `forced = weekIndex >= numAccumulationWeeks` debe ser `false` cuando la sesión actual **ya es deload** (`isDeload` en la entrada) — hoy aparece "Deload sugerido" durante el propio deload (`src/app/session/done/page.tsx`).
- Mover `RECENT_WINDOW = 6` de `src/lib/postSession.ts` a `rules.config.json` → `deloadTriggers.recentWindowSessions: 6` (+ Zod `.default(6)`).
- **Aceptación**: test de `evaluateDeloadTrigger` con `isDeload: true` → `forced=false`; grep de literales numéricos en `src/lib` y `src/app` relacionados con entrenamiento = 0 (documentar los que queden con justificación).

### A0.6 Citas de SCIENCE.md y notas del config
Corregir, sin cambiar la lógica:
- "Larsen 2025" → **Martikainen O, Niiranen H, Rytkönen T, Schoenfeld BJ, Ahtiainen JP, Hulmi JJ (2025). J Sci Sport Exerc. DOI 10.1007/s42978-025-00338-8** (RIR 1–4 variable vs RIR 1 constante, 10 semanas, n=31). Marcar los números de error (−1.5±1.7 → −0.6±1.4 etc.) como "según full-text; el abstract solo reporta mejora en el grupo variable".
- "Halperin/Zourdos 2023 (18 sesiones de banca)" → **Remmert JF et al. (2023), Perceptual and Motor Skills**, 9 hombres entrenados, 3×/sem × 6 sem.
- Separar "Refalo 2024": precisión del RIR = **J Strength Cond Res 2024;38(3):e78–e85**; RCT fallo vs 1–2 RIR = **J Sports Sci 2024;42(1):85–101**.
- Pelland 2026: añadir DOI 10.1007/s40279-025-02344-w. Deload en no entrenados = **Pancar et al., Sci Rep 2026;16:10299**.
- En §8 y §8 bis cambiar "estirado **supera** ROM completo" por "**iguala** (Wolf 2025 PeerJ 13:e18904; Gschneidner 2025, n=297); parciales cortos inferiores".
- Mismas correcciones en las notas `_rirCapNote`, `_thresholdNote` y `rirCalibration._note` de `rules.config.json`.
- **Aceptación**: revisión por lectura; `npm run test` sigue en verde (los tests de reglas no dependen de las notas).

### A0.8 RIR eco (descubierto al ejecutar A0 — hecho)
- **Hallazgo con datos reales**: en el 99,3 % de 1.589 series el RIR registrado es exactamente el objetivo (la app precarga el objetivo y se confirma sin tocar). La calibración declaraba "±0,55, calibrado", el ajuste por RIR nunca actuó y los Δ1RM salían negativos (mismas reps a misma carga con RIR objetivo 3 → 0 se leen como pérdida de fuerza).
- **Hecho**: `rirEchoPct` y `echoDetected` en `src/domain/rirCalibration.ts` (`echoThresholdPct: 90` en config), calibración "no medible", motor como no calibrado, aviso en sesión y en Stats junto al Δ1RM.
- **Pendiente (decisión de producto, ver A1.11)**: cambiar el flujo de carga del RIR en la sesión para que no se pueda "ecoar" sin querer.

### A0.7 Tests de regresión y nota en CONTEXT.md
Agregar una sección "Bugs corregidos en A0" en `CONTEXT.md` §6 con la regla que cada uno fija, para que no vuelvan.

---

## A1 — Sesión profesional

Principio de diseño: **menos taps, más contexto, cero sorpresas**. Todo lo que se muestra en sesión tiene que responder "¿qué hago ahora, por qué, y cómo me fue la última vez?".

### A1.1 Valores de la sesión anterior ("ghost values")
- **Dominio**: `src/lib/sessionPlan.ts` ya calcula el historial por pista (`exerciseHistoryBefore`). Exponer en `SlotPrescription` un campo `previous: Array<{ loadKg, reps, rir }> | null` con las series de la **última sesión completada de la misma pista**, ordenadas por `setIndex`.
- **UI** (`src/app/session/page.tsx`, componente `SetRow`): en cada input, placeholder gris con el valor de la serie correspondiente de `previous` (si hay menos series previas, repetir la última). Debajo del nombre del ejercicio una línea "Última vez: 80×10, 80×9, 80×8 @ RIR 2 · hace N días" (N desde `completedAt`; la fecha de hoy entra por prop, no `Date.now()` dentro de dominio). Botón "Copiar anterior" por serie (un tap rellena kg/reps/RIR con lo previo).
- **Color**: al registrar, la celda de reps se pinta `--success` si `reps ≥ previa a igual carga` o la carga subió; `--warning` si bajó. Nunca rojo "castigo"; tono neutral.
- **Aceptación**: E2E con el respaldo real: en una sesión de empuje, el placeholder de banca muestra la última serie real (107.5×8…); "Copiar anterior" rellena; registrar 1 rep más pinta verde.

### A1.2 Discos por lado y calculadora de carga
- **Dominio**: nueva función pura `plateBreakdown(loadKg, ctx: RoundingContext): { perSide: number[]; unreachable: boolean; nearestBelow: number } | null` en `src/domain/rounding.ts` (barra: `(load − barra)/2` descompuesto con los discos del inventario de mayor a menor, cantidad ilimitada por denominación; mancuerna armable: mango + discos; rack fijo/máquina: `null`). Tests: 102.5 kg con barra 20 → por lado [20, 20, 1.25]; carga inalcanzable → `unreachable=true` y `nearestBelow`.
- **UI**: bajo el objetivo del ejercicio, chips "20 · 20 · 1.25 por lado"; al editar la carga, recalcular en vivo; si inalcanzable, mostrar "no se arma con tus discos → 100" y un tap para aceptar.
- **Aceptación**: tests + E2E.

### A1.3 Series de calentamiento
- **Config**: `warmup: { enabled: true, scheme: [{ pct: 0.5, reps: 8 }, { pct: 0.75, reps: 4 }], minWorkingLoadKg: 40, _note: "1–2 series de aproximación, la última cerca de la carga de trabajo; sin reps al fallo. Evidencia débil-probable (Wilson/Nunes/Blazevich 2025): no afecta la fuerza máxima; sirve para familiarizar la carga. Solo para el primer ejercicio de cada patrón o cargas ≥ minWorkingLoadKg." }`.
- **Dominio**: `warmupSets(workingLoadKg, ctx, rules): Array<{ loadKg, reps }>` (redondeadas con `roundToAvailable`; omitir si la carga de trabajo < `minWorkingLoadKg` o es peso corporal). Tests.
- **Datos**: `SetLog.kind?: "warmup" | "working" | "drop" | "failure" | "partial"` (default `"working"`). **Las series `warmup` no entran** en volumen, stats, calibración de RIR ni progresión: filtrar en `computeMesoStats`, `assessRirCalibration`, `exerciseHistoryBefore` y `weeklyVolume*`. Dexie: no requiere versión nueva (campo opcional), pero documentar en `CONTEXT.md` §4.
- **UI**: filas "W" plegadas arriba de las series de trabajo, con un toggle por ejercicio "mostrar calentamiento"; registrables con un tap (no piden RIR).
- **Aceptación**: tests de exclusión (un `warmup` registrado no cambia `nextPrescription` ni el volumen); E2E.

### A1.4 Timer de descanso real
- **Config**: `rest: { defaultCompoundSec: 120, defaultIsolationSec: 90, minSec: 60, _note: "Singer 2024 (meta Bayesiano): beneficio pequeño con >60 s; sin diferencia clara por encima de 90 s. Default y mínimo sugerido, nunca un techo ni un bloqueo." }`. Multiarticular = ejercicio con `secondaryMuscles.length > 0`.
- **Datos**: `Exercise.restSec?: number` (override por ejercicio, editable en `ExerciseForm`). `SessionRow.startedAt?: string`, `SessionRow.lastSetAt?: string` (para sobrevivir recargas).
- **UI** (`src/components/RestTimer.tsx`): cuenta regresiva que arranca al registrar una serie (objetivo = `restSec` del ejercicio o default por tipo), botones −15 s / +15 s, muestra "siguiente: 80 kg × 10 @ RIR 2". Al llegar a 0: `navigator.vibrate([200,100,200])` en try/catch y, si hay permiso, `Notification` (pedir permiso una sola vez desde Ajustes, nunca en la sesión). Sobrevive recargas (lee `lastSetAt`). Sin bloqueo: el usuario puede registrar antes.
- **Aceptación**: E2E: registrar serie → timer en 120 s para banca; recargar la página → el timer sigue; en un aislamiento arranca en 90 s.

### A1.5 Tipos de serie, notas y supersets
- **Datos**: `SetLog.kind` (ver A1.3), `SetLog.note?: string`, `SetLog.side?: "L" | "R"` (unilateral), `Exercise.note?: string` (persistente: "asiento 4, agarre ancho"), `BaseWeekSlot.supersetGroup?: string` y `PlannedSlot.supersetGroup?` (los slots con el mismo grupo se muestran juntos y el timer de descanso se dispara al cerrar el último del grupo).
- **Volumen**: `drop`/`failure`/`partial` cuentan como series de trabajo (son estímulo); `warmup` no. Documentar en `CONTEXT.md` §2.
- **UI**: menú "⋯" por serie (tipo, nota, lado); nota del ejercicio editable desde la sesión y desde `/exercises`; en Plan, botón "superserie con el siguiente".
- **Aceptación**: tests de conteo de volumen por `kind`; E2E de superserie (timer único al final del par).

### A1.6 Edición en sesión: series, swap "solo hoy", reabrir, estado en curso
- **Series**: botones "+ serie" / "− serie" por ejercicio en sesión; la serie extra se registra con `setIndex` siguiente; el plan **no** cambia (solo esa sesión). En stats cuenta como volumen real.
- **Swap solo hoy**: botón "cambiar ejercicio" que abre el modal de A1.9; opción "solo hoy" guarda `SessionRow.overrides?: Array<{ slotIndex, exerciseId }>` (nuevo campo) y `buildSessionView` lo aplica; opción "en el plan" llama a `baseWeekRepo` + `regeneratePlan` como hoy.
- **Reabrir**: `sessionRepo.reopen(id)` → `status: "pending"`, `completedAt: undefined`, y si el meso se había marcado `completed` por esta sesión, volver a `active`. Botón en `/session/done` y en Agenda, con confirmación propia (A4.6).
- **En curso**: `SessionRow.startedAt` se setea al registrar la primera serie; Home muestra "Continuar sesión · Día X · N/M series" en lugar de "Empezar entrenamiento" cuando hay una sesión con `startedAt` y `status: "pending"`.
- **Duración**: `completedAt − startedAt` mostrada en `/session/done` y en stats (A3.3).
- **Aceptación**: E2E de cada flujo; test de `reopen` en repositorio (mock Dexie con `fake-indexeddb` — agregar como devDependency).

### A1.7 Valores no registrados que sobreviven recargas
- **Hoy**: lo editado pero no registrado vive en `useState`.
- **Cambio**: guardar borradores en `sessionStorage` con clave `mn-draft:${sessionId}:${slotIndex}:${setIndex}` (es UI, no dominio: permitido). Restaurar al montar. Limpiar al finalizar.
- **Aceptación**: E2E: editar sin registrar → recargar → el valor sigue.

### A1.8 PRs en vivo y resumen de fin de sesión
- **Dominio**: `src/domain/records.ts` con `detectPRs(history: SetLog[], newSet: SetLog, rules): PR[]` donde `PR = { kind: "load" | "repsAtLoad" | "e1rm" | "volume", value, previous }`, excluyendo `warmup` y deloads. Tests.
- **UI**: al registrar, toast corto "PR: e1RM 141 kg (+2.5)" (no bloqueante); `/session/done` muestra: duración, series registradas/planificadas, volumen (series fraccionadas por músculo de esa sesión), PRs, y las sugerencias de deload/swap actuales **con botones** ("Aplicar deload", "Ver alternativas", "Ignorar") que hoy no existen.
- **Aceptación**: tests de `detectPRs`; E2E con el respaldo real.

### A1.9 Modal de swap con motivo
- **UI**: lista de `swapCandidates` filtrados por equipamiento disponible (del inventario) y músculo primario; cada candidato muestra `resistanceProfile` ("en estiramiento / medio / acortado") y el motivo cuando viene de `suggestExerciseSwap` ("N sesiones sin progreso"); acciones "solo hoy" / "en el plan". Reutiliza `src/domain/swap.ts`.
- **Aceptación**: E2E.

### A1.10 Chip "¿por qué?" por ejercicio
- **Dominio**: `nextPrescription` ya devuelve `rationale`. Extender `Prescription` con `explain: { rule: string; inputs: Record<string, number | string> }` (ej. `rule: "ceiling-reached"`, `inputs: { achievedReps: 12, ceiling: 12, minJumpPct: 14.3, targetPct: 2.5 }`). Sin cambiar `rationale`.
- **UI**: chip "¿por qué?" junto al objetivo que despliega el `rationale` + una tabla de `inputs` legible. Es el diferencial de producto más citado por los usuarios de RP/MacroFactor/Fitbod ("no sé por qué me pide esto").
- **Aceptación**: tests de que cada rama de `doubleProgression` y `linearProgression` produce un `explain.rule` distinto y documentado en `CONTEXT.md` §6.

### A1.11 Carga del RIR que mida percepción, no eco (depende de A0.8) — HECHO con la opción (c)
- **Problema**: precargar el RIR objetivo en cada serie hace que se confirme sin pensar (99 % de eco en datos reales). Sin RIR real, el ajuste por RIR, la calibración, la señal de RIR creep y el e1RM pierden sentido.
- **Opciones (elige el usuario)**: (a) RIR vacío hasta que se toque: selector rápido de 5 botones (0 · 1 · 2 · 3 · 4+) en la fila, con "Log" deshabilitado hasta elegir; (b) precarga solo en la serie 1 y en las siguientes el RIR de la serie anterior (refleja fatiga intra-sesión); (c) precarga como hoy pero pedir RIR explícito solo en la **última serie** de cada ejercicio (la más informativa: más cerca del fallo, Russo 2025) y marcar las demás como "RIR no reportado" (excluidas de calibración).
- **Requisitos comunes**: `SetLog.rirReported?: boolean` (false = valor por defecto no tocado) para que calibración/ajuste ignoren lo no reportado; nunca más de 1 tap extra por serie; tono neutral.
- **Aceptación**: test de que `assessRirCalibration` y `rirAdjustedReps` ignoran `rirReported === false`; E2E de 4 series registradas con la opción elegida contando taps.

---

## A2 — Motor: solo lo que tiene respaldo

Cada ítem lleva su cita a `SCIENCE.md` (actualizarla en el mismo commit). Lo que no tenga cita no entra.

### A2.1 Señal primaria de deload = caída de reps a carga fija, mismo día, sostenida
- Depende de A0.4. Config: `deloadTriggers.signals.performanceDropSessions` ya tiene `consecutiveSessions` y `exercisesAffected`; agregar `weight: 2` y a las demás señales `weight: 1`; `minSignalsToSuggest` pasa a sumar pesos (documentar). Bajar `chronicPoorReadiness` a `enabled: false` por defecto con nota: "sin consenso de expertos (Bell 2023 Delphi) ni validez predictiva; se deja como covariable en stats".
- Cita: Grandou 2020 (único marcador establecido = caída sostenida de rendimiento); Refalo 2023 (reps a carga fija ~ fatiga); Bell 2023.
- **Aceptación**: tests de pesos; E2E del mensaje en `/session/done` listando las señales con su peso.

### A2.2 Deload reactivo con fatiga percibida como señal explícita
- **Datos**: `Checkin.perceivedFatigue?: 1 | 2 | 3 | 4 | 5` (física + mental, una sola escala, opcional).
- **Config**: `deloadTriggers.signals.perceivedFatigue: { enabled: true, threshold: 4, windowSessions: 3, weight: 1 }` con nota: "único disparador subjetivo con consenso de expertos (Bell 2023: 100% 'descargar cuando hay fatiga física y mental percibida'); sin validación predictiva; tono neutral, decide el usuario".
- **UI**: el check-in suma la pregunta (saltable); nunca modifica la sesión.
- **Aceptación**: tests; E2E.

### A2.3 Deload por ejercicio (opcional)
- **Dominio**: `evaluateExerciseDeload(history, rules)` → sugiere, para un slot, `sets × 0.5` y `load × 0.9` cuando el e1RM del ejercicio cayó ≥ `exerciseDeload.e1rmDropPct` (default 5) en ≥ `exerciseDeload.sessions` (default 2) sesiones consecutivas de la misma pista **y** no es la semana 1. Config con nota: "práctica de Dr. Muscle; sin RCT; heurística de gestión de fatiga local". Se **sugiere** en `/session/done`; aplicarlo escribe `SessionRow.overrides` para la próxima sesión de ese slot (reutiliza A1.6).
- **Aceptación**: tests; E2E.

### A2.4 "Serie dura primero" opcional por ejercicio
- **Datos**: `BaseWeekSlot.anchorSet?: boolean`.
- **Dominio**: en `buildAccumulationWeek`, si `anchorSet`, `PlannedSlot.setTargets?: Array<{ targetRir }>` con la serie 1 a `max(band.min, baseRir − anchor.rirDelta)` y las demás al RIR normal. Config: `anchorSet: { rirDelta: 1, _note: "Patrón de MacroFactor Workouts: una serie cerca del fallo como ancla de calibración del RIR; coherente con Martikainen 2025 (variar la proximidad al fallo mejora la precisión). Sin RCT del patrón en sí: opcional." }`.
- **Calibración**: `assessRirCalibration` ya usa series a carga fija; la serie ancla aporta datos cerca del fallo, donde el RIR es más preciso (Russo 2025).
- **Aceptación**: tests (banda respetada, deload sin ancla); UI en Plan (toggle por slot) y en sesión (RIR objetivo distinto en la serie 1).

### A2.5 Tope blando por sesión
- **Config**: `volumeCounting.softSessionCapFractionalSets: 11` con nota: "Remmert 2025 (preprint SportRxiv 537): punto de utilidad decreciente ≈ 11 series fraccionadas por músculo por sesión; Pelland 2026: repartir en más días es neutral, no superior. Heurístico; solo aviso."
- **UI**: en Plan, junto al volumen semanal, aviso por día cuando un músculo supera el tope en una sola sesión ("Pecho: 14 series fraccionadas hoy; por encima de ~11 el rendimiento por serie cae. Repartir es neutral.").
- **Aceptación**: función pura `sessionVolumeByMuscle(day, exercisesById, rules)` con tests; E2E.

### A2.6 Ajuste intra-sesión sugerido
- **Dominio**: `intraSessionAdjust(loggedSets, nextSetTarget, rules)` → si la serie recién registrada salió a RIR < objetivo − `intraSession.rirShortfall` (default 2) sugerir para la siguiente serie `load × (1 − intraSession.loadDropPct/100)` (default 5) redondeada, o −1 rep si no hay salto de carga; `rationale` incluido. Config con nota: "Juggernaut/Alpha ajustan 'set 3 ≠ set 1'; evidencia indirecta (Refalo 2023, pérdida de velocidad lineal con proximidad al fallo). Solo sugerencia visible; nunca cambia el target guardado."
- **UI**: banner pequeño bajo la serie siguiente: "La serie 2 salió a RIR 0; para la 3 sugiero 97.5 kg. [Usar] [Ignorar]".
- **Aceptación**: tests; E2E.

### A2.7 Confianza en el RIR por %e1RM y por número de serie
- **Config**: `rirCalibration.lowLoadDampenBelowPctE1rm: 60`, `rirCalibration.firstSetWeight: 0.5` con notas (Russo 2025: precisión peor con menor %1RM y más reps; mejor en series posteriores — evidencia de tesis para lo segundo, marcar "heurístico").
- **Dominio**: en `rirAdjustedReps` atenuar a la mitad el ajuste cuando `actualLoadKg / e1RM(última sesión) < 0.60`; en `assessRirCalibration` ponderar la serie 1 por `firstSetWeight`. Tests.
- **Aceptación**: tests que muestren menos saltos espurios a cargas ligeras.

### A2.8 Modo APRE opcional (por ejercicio)
- **Datos**: `BaseWeekSlot.progression?: "default" | "apre"`.
- **Dominio**: `apreProgression(lastSession, repRange, rules)`: la última serie es AMRAP (RIR 0, marcada `failure`); según reps logradas vs tabla `apre.adjustments` (ej. `{ "<min": -5, "min..max": 0, ">max": +2.5, ">max+3": +5 }` en %) se fija la carga siguiente, redondeada. Config con nota: "Huang 2025 red-meta: APRE con la mejor señal para fuerza (SMD −0.83 banca vs %fijo), estudios pequeños en universitarios; implica una serie al fallo por ejercicio (más fatiga, Refalo 2023). Opcional, no default."
- **Seguridad**: no permitido en ejercicios con `equipmentType: "barbell"` sin marcar "tengo seguros/spotter" en Ajustes (flag `settings.barbellFailureAllowed`).
- **Aceptación**: tests de la tabla; E2E.

### A2.9 e1RM dependiente de la carga (opción)
- **Config**: `oneRepMax.model: "epley" | "weightDependent"` (default `"epley"`), parámetros de Marzagão 2026 (arXiv:2603.17495) con nota "preprint, sin 1RM medidos, sin RIR".
- **Dominio**: `estimate1RM` despacha por modelo; el modelo nuevo se usa solo en stats y arranque, nunca cambia la progresión.
- **Aceptación**: tests de ambos modelos.

### A2.10 Lenguaje de la evidencia en la UI
- Revisar todos los textos que digan "supera", "óptimo", "mejor": cambiar a "iguala / equivalente / preferencia" donde SCIENCE.md así lo diga (parciales alargados, modelos de periodización, autorregulación).
- **Aceptación**: grep de "óptim" y "supera" en `src/app` y `src/components` revisado a mano.

---

## A3 — Historial y análisis

### A3.1 Vista por ejercicio
- Ruta `/exercise?id=…` (estática: página con query string, como `/session`). Gráficos Recharts: e1RM por sesión (por pista, sin deload), reps a carga fija, carga por sesión; tabla de sesiones con series; notas del ejercicio; botón "Ver en plan".
- **Aceptación**: E2E con el respaldo real (banca: ~26 sesiones).

### A3.2 Calendario real
- `SessionRow.plannedDate` se asigna al generar el meso desde una fecha de inicio y un patrón de días de la semana elegido por el usuario (Plan → Generar: "Empiezo el … · entreno L-M-X-V-S"), **solo como agenda**: la progresión sigue siendo por sesión completada. Al completar o saltar, las fechas de las siguientes se corren con `recommendCalendarShift` (hoy se llama con `daysMissed: 0`; pasar el valor real).
- Vista mensual con sesiones completadas abribles en modo lectura (hoy no se pueden abrir).
- **Aceptación**: tests de `recommendCalendarShift` con `daysMissed` real; E2E.

### A3.3 Reporte semanal y duración
- `/stats` → tarjeta "Esta semana": sesiones hechas/planificadas, series fraccionadas por músculo vs objetivo de la semana del plan, tiempo total (A1.6), PRs. Función pura `weeklyReport(plan, sessions, logs, weekIndex, rules)`.
- **Aceptación**: tests; E2E.

### A3.4 Adherencia a la prescripción
- Depende de A0.1. `computeMesoStats` → `loadAdherence: { pctAtTarget, pctAbove, pctBelow, meanDeltaPct }` por ejercicio y global; en `/stats` con el aviso de n pequeño.
- **Aceptación**: tests.

### A3.5 Tendencia de peso corporal suavizada y deuda de sueño
- Peso: EMA con `measurements.weightTrendAlpha: 0.1` (config, nota "MacroFactor/Dr. Muscle usan ~10%; heurística de suavizado, no fisiología").
- Sueño: variable derivada `sleepDebtNights` = noches consecutivas con `sleptMinimum=false` en los check-ins previos; correlación intra-sujeto con reps a carga fija en el heatmap de `/stats`, con nota: "Craven 2022: −2.85% fuerza, crece con noches acumuladas; una noche aislada no predice (no modificar la sesión)".
- **Aceptación**: tests de EMA y de `sleepDebtNights`.

### A3.6 Búsqueda
- Buscador global en `/exercises` y `/stats` por nombre de ejercicio (ya existe en Plan al agregar); historial filtrable por ejercicio y rango de fechas.

---

## A4 — Robustez, datos y pulido

### A4.1 Respaldo seguro
- Antes de importar: exportar automáticamente el estado actual a un archivo `myonoesis-pre-import-<fecha>.json` (descarga) y pedir confirmación propia.
- Validar cada fila con Zod (`backupFileSchema` en `src/db/backupSchema.ts`): tipos y rangos (reps 0–100, RIR 0–10, carga ≥ 0, fechas ISO). Rechazar con mensaje claro qué tabla/fila falla. Aceptar `backupVersion` 1 y, al agregar campos, subir a 2 manteniendo import de 1.
- **Aceptación**: tests del schema con respaldos sintéticos (válido, tabla faltante, fila corrupta).

### A4.2 Borrado seguro de ejercicios y músculos desconocidos
- `exerciseRepo.remove`: si el ejercicio está en algún `plan` de un meso activo/pausado, avisar "en uso en N mesos" y ofrecer reemplazo (modal de A1.9) en vez de borrar en silencio. Nunca dejar `setLogs` huérfanos sin nombre: `/stats` y Excel muestran "(ejercicio eliminado)".
- `weeklyVolumeTarget` y `buildAccumulationWeek`: capturar músculo sin landmarks (`try/catch` como ya hace `volumeTrim`) y tratarlo como "sin objetivo" en lugar de lanzar.
- **Aceptación**: tests; E2E importando un respaldo con un músculo `foo`.

### A4.3 Service worker que no toma control a mitad de sesión
- `src/app/sw.ts`: `skipWaiting: false`; el toast "Nueva versión lista" envía `SKIP_WAITING` al SW solo cuando el usuario toca y no hay sesión `startedAt` sin finalizar (si la hay, ofrecer "actualizar al terminar").
- **Aceptación**: E2E manual documentado (dos builds consecutivos) + unit test del guard.

### A4.4 Plan: edición segura
- Confirmar al borrar día/ejercicio; `key` estable por slot (uuid en `BaseWeekSlot.id`, migración en `baseWeekRepo.get` que asigna ids faltantes); rango de reps con `min ≤ max` forzado en `RangeBox`; carga inicial por defecto desde `suggestLoadFromHistory` cuando hay historial (hoy 20 kg); duplicar día; "Generar meso" avisa si va a pausar el activo.
- **Aceptación**: E2E.

### A4.5 Perfiles de gym
- `settings.equipmentProfiles: Array<{ id, name, equipment }>` y `settings.activeEquipmentProfileId`; selector en Ajustes y en sesión ("hoy entreno en: casa"). `buildSessionView` usa el activo. Migración: el `equipment` actual pasa a ser el perfil "Principal".
- **Aceptación**: tests de migración; E2E.

### A4.6 Diálogos propios y accesibilidad
- Reemplazar `confirm()`/`alert()` por un componente `ConfirmDialog`/`Toast` (ya existe un sheet en `BugReport.tsx` como referencia). Focus trap, `Escape`, `aria-modal`. Contraste AA en ambos temas (verificar con Playwright + axe-core como devDependency, test en CI).
- **Aceptación**: `npm run test:a11y` en verde para las 10 pantallas.

### A4.7 Unidades
- `settings.units: "kg" | "lb"` solo para **mostrar**; el dominio sigue en kg. `fmtKg` → `fmtLoad(settings)`. Inventario se edita en la unidad elegida y se guarda en kg.

### A4.8 Documentación de producto
- `CHANGELOG.md` (desde `4c43385`), `docs/ROADMAP.md` (público, con estado), README con capturas nuevas de la sesión.

---

## Criterio de "Plan A terminado"
- Todas las tareas con aceptación verde; `npm run test` ≥ 180 tests; `typecheck`, `lint`, `build` limpios.
- Auditoría de `docs/plans/AUDITORIA.md` (pistas UX y código) sin hallazgos de severidad alta.
- `CONTEXT.md` y `SCIENCE.md` reflejan cada cambio; ningún número científico fuera de `rules.config.json`.
- Verificación E2E final con un respaldo real: generar meso de 5 días fuerte/liviano, entrenar 3 sesiones completas con calentamiento, superserie y una serie extra, reabrir una, ver PRs, deload en segunda mitad con carga reducida, exportar e importar sin pérdida.
