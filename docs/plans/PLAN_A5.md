# Plan A5 — "Memoria": historial entre mesos, mantener, dolor, actividad externa, AMRAP y respaldo

> **Alcance recortado el 2026-11-06:** A5.7, A5.9 y A5.10 quedan fuera de este plan (se retoman en una planificación posterior). Queda por hacer: A5.6, A5.8, A5.11 y la auditoría.

Objetivo: que la app deje de tratar cada mesociclo como un universo aparte y empiece a usar **toda** la historia del usuario (fuerza, dolor, actividad fuera del gym, precisión del RIR) sin depender de la IA. Todo lo que se agrega al motor tiene cita en `SCIENCE.md`; lo que no la tiene se etiqueta "heurístico" o se deja como sugerencia. Este plan deja el terreno listo para el Plan B: la IA del Plan B necesita leer tendencia larga, dolor y actividad externa, y hoy nada de eso existe.

Prerrequisito: Plan A cerrado (commit `057cb17`, 287 tests). Leer primero `docs/plans/README.md` (reglas 1–10 siguen vigentes, en especial la 2: ningún número científico fuera de `rules.config.json`; la 5: el check-in nunca modifica una prescripción; y la 7: el motor sugiere, el usuario decide).

Convenciones: las mismas de `PLAN_A.md`. Cada tarea es un commit; el orden de fases es obligatorio (A5.0 → A5.1 → … → A5.9); A5.10 es opcional y va al final. Las claves nuevas de `rules.config.json` llevan nota `_` y campo Zod con `.default(...)` en `src/domain/rules.ts`. Toda tabla o campo nuevo en Dexie es una versión nueva y aditiva (v5) y sube `backupVersion` a 3 (se importan 1, 2 y 3).

---

## A5.0 — Decisiones de diseño (documentar en `docs/plans/A5-decisiones.md` antes de codear)

**Dos memorias, no una.** El problema de fondo: `exerciseHistoryBefore` (`src/lib/sessionPlan.ts`) lee solo `sessionRepo.forMesocycle(meso.id)`, así que progresión, "sin progreso en N sesiones", swap por estancamiento y deload arrancan de cero en cada meso. Cruzar mesos a ciegas sería peor: cambiar de estrategia (12 reps → 6 reps, meso de mantenimiento) es parte legítima de un macro plan y no debe leerse como estancamiento ni arrastrar reps de otro rango. Por eso:

1. **Memoria corta (prescripción)**: decide carga y reps de la próxima sesión. Continúa entre mesos **solo si la pista es la misma** (`progressionTrackKey`: ejercicio + rango de reps + intensidad del día), saltando deloads y sesiones saltadas. Si la pista cambia o hubo una pausa larga, **no arrastra nada**: re-ancla la carga desde el e1RM de la última sesión real (lo que ya hace `blockPhaseReanchor`) y empieza reps desde el piso del rango.
2. **Memoria larga (tendencia)**: detecta techo/estancamiento real mirando todos los mesos, en **e1RM por ejercicio** (Epley ajustado por RIR reportado), que es lo único comparable entre rangos. Nunca prescribe: produce avisos y propuestas.
3. **Intención del meso** (`MesocycleRow.intent`): `"hypertrophy" | "strength" | "maintenance" | "recovery"`. La memoria larga no cuenta mesos de `maintenance`/`recovery` como estancamiento. Default `"hypertrophy"` para mesos existentes.
4. **Dolor es distinto de DOMS.** `statsPolicy._excludedNote` sigue valiendo (el dolor muscular no es progreso). Lo que se agrega es dolor **articular/tendinoso** por zona, como señal de manejo de carga, nunca como diagnóstico.
5. **Actividad externa no modifica la prescripción.** Con sesiones en días distintos, la interferencia cardio-fuerza sobre fuerza máxima e hipertrofia es ~nula (Schumann 2022, SMD −0,06 / −0,01); el riesgo aparece en la misma sesión o con < 3 h (Petré 2021). Por eso Garmin alimenta covariables y agenda, no cargas.
6. **Lo registrado en la app manda sobre Garmin.** Un "entrenamiento de fuerza" de Garmin nunca crea ni pisa series.

Aceptación: el documento existe, cita la evidencia de `SCIENCE.md` §12–§15 (nuevas, ver A5.11) y lista las claves de config que cada fase agrega.

---

## A5.1 — Memoria corta: la pista continúa entre mesos

### A5.1.1 Historial por pista a través de mesos
- **Hoy**: `exerciseHistoryBefore(current, meso, weekIndex, dayIndex)` filtra por `meso.id`.
- **Cambio**: nueva función pura `trackHistory` en `src/domain/history.ts`:
  ```ts
  trackHistory(input: {
    logs: SetLog[];                       // setLogRepo.forExercise(exerciseId), todos los mesos
    sessions: SessionRef[];               // id, mesocycleId, weekIndex, dayIndex, status, isDeload, completedAt
    plansByMeso: Map<string, MesocyclePlan>;
    current: { mesocycleId; weekIndex; dayIndex; slotIndex; slot: PlannedSlot; intensity?: DayIntensity; model: ProgressionModel };
    today: string;                        // ISO, entra como argumento (dominio puro)
    rules: Rules;
  }): { history: SetLog[]; continuity: "same-track" | "track-changed" | "gap" | "none"; lastSessionAt?: string; gapDays?: number }
  ```
  Reglas: solo sesiones `completed`, no deload, anteriores a la actual (por `completedAt` entre mesos; por orden `weekIndex/dayIndex` dentro del meso). Una sesión de otro meso entra solo si su slot equivalente está en la **misma pista** (`sameProgressionTrack`) y el mismo ejercicio en la misma posición o primera aparición (regla S1 de la auditoría). Si la última sesión elegible de la pista es de hace más de `progression.continuity.maxGapDays` → `continuity: "gap"` y el historial se devuelve vacío. Si hay sesiones del ejercicio pero ninguna de la misma pista → `"track-changed"`, historial vacío.
- `exerciseHistoryBefore` pasa a ser un adaptador que arma las entradas y llama a `trackHistory`. `createFollowUp` (`src/db/repositories.ts`) usa la misma función en lugar de su filtro propio.
- **Config** (`progression.continuity`, nueva): `{ "enabled": true, "maxGapDays": 21, "gapE1rmFactor": 0.95, "_note": "Heurístico. La fuerza se conserva bien 2–3 semanas sin entrenar; tras maxGapDays se re-ancla desde el e1RM con un descuento prudente en vez de arrastrar la última prescripción." }`.
- **Aceptación** (tests en `src/domain/__tests__/continuity.test.ts`): (a) misma pista en dos mesos consecutivos → el historial incluye la última sesión del meso anterior y la prescripción es la que correspondía (p. ej. terminó 80×12 RIR 2 en 10–12 → el nuevo meso pide la subida, no la carga de la semana base); (b) rango distinto → historial vacío, `"track-changed"`; (c) pausa > `maxGapDays` → `"gap"`; (d) deload y saltadas nunca entran; (e) `continuity.enabled=false` reproduce el comportamiento de hoy (solo meso actual).

### A5.1.2 Re-anclaje al cambiar de pista o tras pausa
- `nextPrescription` recibe `continuity` y, con `"track-changed"` o `"gap"` y `currentLoadKg` igual a la carga de la semana base, re-ancla: `loadForTarget(e1rm_última_sesión_real × (gap ? gapE1rmFactor : 1), repRange.min, targetRir)` redondeado con `roundToAvailable`. Reglas `explain` nuevas: `track-reanchor`, `gap-reanchor` (inputs: e1RM, reps y RIR de origen, carga resultante).
- Generación de meso: `baseWeekRepo.suggestStartingLoad` y `applyTemplate` ya re-estiman desde el 1RM real; **"meso de cero"** debe ofrecer lo mismo (botón "Estimar cargas desde mi historial" en el editor de semana base, por slot y para todos). Sin historial → `baseWeekDefaults.startingLoadKg` como hoy.
- **Aceptación**: tests de las dos reglas; E2E con el respaldo real: crear un meso nuevo "de cero" con press 6–8 cuando el historial es de 10–12 → la carga sugerida sale de e1RM, no de la semana base.

### A5.1.3 Estancamiento y swap con la pista continua
- `suggestExerciseSwap` y `linear-stalled` cuentan sesiones sin progreso **sobre la pista continua** (misma función `trackHistory`); un cambio de pista o una pausa resetean el conteo (historial vacío). Sin cambios de config.
- **Aceptación**: test donde 2 sesiones sin progreso al final del meso 1 + 1 al inicio del meso 2 (misma pista) → sugiere swap; mismo caso con rango distinto en el meso 2 → no sugiere.

---

## A5.2 — Memoria larga: tendencia por ejercicio y "techo sugerido"

### A5.2.1 `longTermTrend`
- Nueva función pura en `src/domain/analytics.ts`:
  ```ts
  longTermTrend(input: { exerciseId; logs; sessions; mesos: Array<{ id; intent; completedAt?; status }>; plansByMeso; rules }): {
    points: Array<{ mesocycleId; intent; e1rmKg; repBand: { min; max }; nearFailureShare: number; reliable: boolean }>;
    slopePctPerMeso: number | null;      // regresión lineal sobre mesos "contables"
    flatMesos: number;                    // mesos consecutivos contables con |Δe1RM| < flatSlopePctPerMeso
    plateauSuggested: boolean;            // flatMesos >= minMesos && nearFailureShare >= nearFailureShareMin
    approximate: boolean;                 // true si compara rangos separados por más de repBandWidth
    reasons: string[];
  }
  ```
  Reutiliza `exerciseTimeline` (ya cruza mesos). Entran solo sesiones completadas, sin deload, series de trabajo con RIR **reportado** (`isRirReported`); con eco (`echoDetected` del meso) el punto queda `reliable: false`. Mesos con `intent` `maintenance`/`recovery` y ejercicios con `holdLoad` (A5.4) quedan en `points` pero no cuentan para `flatMesos`. El e1RM de cada meso es la mediana de las 3 mejores sesiones de la pista. `reliable=false` también si el rango del meso supera `highRepUnreliableFrom` (Epley se degrada a reps altas, SCIENCE §3/§7 bis).
- **Config** (`longTermTrend`, nueva): `{ "minMesos": 3, "flatSlopePctPerMeso": 1, "nearFailureRirMax": 1, "nearFailureShareMin": 0.5, "repBandWidth": 4, "highRepUnreliableFrom": 12, "_note": "Heurístico. No existe un modelo validado que prediga el techo individual (Latella 2020: la mejora se desacelera con los años y aparece un efecto techo en los más fuertes; es observacional). 'Techo sugerido' es probabilístico, como el deload." }`.
- **Aceptación** (`longTermTrend.test.ts`): 3 mesos de hipertrofia con e1RM 117/118/117 y RIR reportado ≤ 1 en ≥ 50 % → `plateauSuggested`; mismo caso con el meso del medio `maintenance` → `flatMesos` no lo cuenta y no sugiere; mesos de 12 vs 6 reps → `approximate: true`; eco → `reliable: false` y no sugiere; 2 mesos → nunca sugiere.

### A5.2.2 UI
- `/exercise?id=`: tarjeta "Tendencia entre mesos" con los puntos por meso (etiqueta de intención), la pendiente, y si corresponde el aviso: *"En N mesos el e1RM no subió y venís cerca del fallo. Puede ser el techo actual de este movimiento. Opciones: mantener (A5.4), rotar a una variante, o seguir empujando."* Siempre con "aproximado" cuando `approximate`, y con el aviso de n pequeño.
- `/stats`: pestaña "Entre mesos" (por músculo y por ejercicio) junto a la actual "Este meso".
- Al terminar un meso (`session/done` de la última sesión) se listan los ejercicios con `plateauSuggested` como observación, nunca como acción automática.
- **Aceptación**: axe sin violaciones en las dos pantallas; E2E con el respaldo real (4 mesos): la pestaña muestra 4 puntos para los ejercicios repetidos.

---

## A5.3 — Intención del meso
- `MesocycleRow.intent?: "hypertrophy" | "strength" | "maintenance" | "recovery"` (ausente = hypertrophy). Se elige al generar (selector con una línea de explicación por opción) y se puede editar en la ficha del meso. `createFollowUp` hereda la intención salvo que se cambie.
- La memoria larga la usa (A5.2); el resto del motor **no cambia** por la intención (la estructura del meso sigue saliendo de modelo, semanas y banda de RIR, que ya son elegibles). `maintenance` solo sugiere en la UI una banda de RIR más alta y sin bump final; no lo impone.
- Respaldo: campo opcional en el schema Zod; `backupVersion` 3.
- **Aceptación**: test de `longTermTrend` con intención (ya en A5.2); test de schema de respaldo que acepta y rechaza valores inválidos; E2E generar un meso con intención `maintenance` y verlo etiquetado en Home y Stats.

---

## A5.4 — "Mantener" por ejercicio, con salida de un toque

- `Exercise.holdLoad?: boolean`, `holdSince?: string`. Se activa/desactiva desde el chip **Mantener** en la fila del ejercicio en sesión y en `/exercise`.
- `nextPrescription` recibe `holdLoad`: con `true` nunca sube la carga. Doble progresión: debajo del tope, igual que hoy; en el tope, repite carga y tope (`explain.rule: "hold-at-ceiling"`). Lineal: mantiene (`"hold"`). APRE/anchor: la serie AMRAP sigue existiendo pero su resultado no sube la carga. Deload: sin cambios.
- **Salida automática**: si en una sesión la carga real registrada en todas las series de trabajo supera la prescrita en ≥ un paso mínimo del equipo (`nextAchievableLoad`), al completar la sesión el repositorio pone `holdLoad=false` y la UI avisa *"Saliste de Mantener en X porque cargaste más"*. La próxima prescripción parte de la carga real (ya es así: la progresión usa `actualLoadKg`).
- La memoria larga (A5.2) no cuenta ejercicios en `holdLoad` para estancamiento; `suggestExerciseSwap` tampoco sugiere sobre ellos.
- **Aceptación** (`hold.test.ts`): en el tope del rango con `holdLoad` → misma carga y reps del tope; al registrar +1 paso en todas las series → la función pura `holdExitDetected(logs, prescribed, equipment)` devuelve true; con una sola serie más pesada → false. E2E: activar Mantener, cerrar sesión, ver que la siguiente no sube; cargar más, ver el aviso.

---

## A5.5 — Dolor en el check-in y recalibración sugerida

### A5.5.1 Datos
- `Checkin.pain?: Array<{ zone: PainZone; score: number }>` con `PainZone = "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "lower_back" | "neck" | "other"`, `score` 0–10 (Zod en respaldo: 0–10 entero, máx. 9 zonas).
- `Exercise.loadedZones?: PainZone[]`: zonas que el movimiento carga. Sembrar en la biblioteca por patrón (press horizontal/vertical → shoulder, elbow; sentadilla/prensa → knee, hip, lower_back; peso muerto/remo → lower_back, hip; curl/extensión → elbow, wrist; gemelos → ankle). Es un mapeo **heurístico y editable** en la ficha del ejercicio; documentarlo así.
- Pregunta periódica: aunque el check-in se salte, cada `pain.askEverySessions` sesiones la pantalla de inicio de sesión muestra una sola pregunta *"¿Te duele alguna articulación o tendón?"* (No / Sí → zona + 0–10). Un toque para "No". Tono neutral; nunca bloquea.

### A5.5.2 `evaluatePainSignal` (pura, `src/domain/pain.ts`)
```ts
evaluatePainSignal(input: { checkins: Checkin[]; sessions: SessionRef[]; exercises: Exercise[]; plan: MesocyclePlan; currentWeekIndex: number; rules: Rules }): {
  zones: Array<{ zone; latestScore; consecutiveSessions; trend: "rising" | "flat" | "falling"; level: "watch" | "act" }>;
  perExercise: Array<{ exerciseId; zone; options: PainOption[]; rationale: string }>;
  persistent: boolean;   // una zona >= watch durante >= persistWeeks → texto neutro sugiriendo consultar a un profesional
}
type PainOption = "load-down-reps-up" | "rir-plus-one" | "swap-candidate" | "exercise-deload";
```
- `level: "act"` si `score > acceptableMax` **o** la misma zona aparece en ≥ `persistSessions` sesiones seguidas **o** la media semanal sube ≥ `risePoints` dos semanas seguidas. `"watch"` si aparece una vez con score ≥ `watchFrom`.
- Opciones por ejercicio que carga la zona, en este orden: bajar carga y subir reps dentro de `repRanges.globalValid` (misma hipertrofia con esfuerzo equiparado, SCIENCE §3; `loadDownPct`), RIR +1, variante de `swapCandidates` que **no** cargue la zona, deload por ejercicio (`exerciseDeload`, ya existe). Cada opción con su texto de evidencia.
- **Config** (`pain`, nueva): `{ "askEverySessions": 4, "watchFrom": 3, "acceptableMax": 5, "persistSessions": 2, "risePoints": 2, "persistWeeks": 3, "loadDownPct": 10, "_note": "Manejo de síntomas, NO diagnóstico. Con tendinopatía, seguir cargando bajo un modelo de monitoreo del dolor no tuvo efectos negativos frente a reposo (Silbernagel 2007, Aquiles, n=38). Los umbrales (≤5/10 aceptable, que baje en 24 h, sin empeorar semana a semana) vienen de guías clínicas, no de RCTs: heurísticos. La app nunca nombra una lesión." }`.
- **Aceptación** (`pain.test.ts`): una sola vez 4/10 → `watch`, sin opciones; dos sesiones seguidas 4/10 en codo → `act` con opciones solo para ejercicios con `elbow` en `loadedZones`; 7/10 una vez → `act`; sube 2→4→6 en tres semanas → `act` y `trend: "rising"`; swap propuesto nunca carga la misma zona; tres semanas ≥ watch → `persistent`.

### A5.5.3 UI
- Hoja "Dolor" en `session/done` y en Home cuando hay `act`: por ejercicio, las opciones con **Aceptar / Editar / Descartar**. Aceptar aplica como `overrides` de la próxima sesión del mismo día (como `exerciseDeload`) o, para el swap, desde la primera semana pendiente con `swapExerciseInPlan` (carga por `loadEstimator`, M3). Descartar guarda `dismissedPainSuggestions` (ejercicio, zona, fecha) para no repetir la misma propuesta durante `persistSessions` sesiones.
- Texto fijo, neutral: *"Registrás dolor en X desde hace N sesiones. Esto no es un diagnóstico. Podés seguir entrenando con menos carga en los ejercicios que cargan esa zona; si persiste o empeora, consultá a un profesional."*
- Stats: serie de dolor por zona junto a reps a carga fija (covariable, con el aviso de n pequeño).
- **Aceptación**: E2E registrar dolor en codo dos sesiones → aparece la hoja con opciones solo para los ejercicios de codo; aceptar "bajar carga, subir reps" → la próxima sesión del mismo día muestra la carga −10 % redondeada y el rango ampliado dentro de 5–30; axe limpio.

---

## A5.6 — Actividades: editar, fecha pasada, calendario y covariable ✅ (2026-11-06)
Hecha. Agregado sobre la spec: la grilla de la Agenda se muestra también sin meso activo, para registrar actividades igual; los días tocables usan contraste AA.

- `activityRepo.update(id, patch)`; en `/activities` cada tarjeta se edita (tipo, fecha, minutos, intensidad, nota). Alta desde la Agenda tocando un día pasado o futuro ("+ Actividad").
- `ActivityRow` gana `source?: "manual" | "garmin"`, `externalId?`, `distanceKm?`, `avgHr?`, `maxHr?`. La Agenda muestra las actividades en el día (icono por tipo) junto a las sesiones.
- Deload: **no** se descuenta la actividad del día previo (la evidencia con sesiones separadas no justifica un descuento); la razón del disparador `performanceDropSessions` agrega la nota *"hubo actividad intensa el día anterior"* cuando corresponde, para que el usuario lo pondere. `SessionSummary.intenseActivityPrevDay?: boolean`, calculado fuera del dominio y pasado como dato.
- **Aceptación**: tests del schema de respaldo con los campos nuevos; test de `evaluateDeloadTrigger` donde la nota aparece sin cambiar `shouldSuggest`; E2E editar una actividad y crear una en un día pasado desde la Agenda.

---

## A5.7 — Importar Garmin → fuera de este plan

Los hallazgos con la exportación real (rutas de `DI_CONNECT/`, unidades, fecha local, GPS nunca) y las reglas de fusión quedan abajo como referencia; El texto original queda abajo como referencia hasta que C2 lo absorba.

### A5.7.1 (referencia) Importadores puros (`src/lib/importers/`, con fixtures y tests en `src/lib/__tests__/`)
- `garminActivitiesCsv.ts`: parsea el CSV de "Actividades → Exportar CSV" de Garmin Connect. Encabezados en español **e inglés** (fixtures de ambos; el usuario aporta uno real, se anonimiza antes de commitear). Salida: `Array<{ externalId?; date; type; durationMin; distanceKm?; avgHr?; maxHr?; title }>`; tipos mapeados a `ActivityRow.type` + `"strength"` (fuerza, que se trata aparte). Filas que no parsean se devuelven en `rejected` con el número de línea.
- `garminAccountExport.ts`: lee el ZIP de la exportación completa de la cuenta (JSON de sueño, pasos, FC en reposo, HRV, Body Battery por día). Detectar cada archivo por **contenido** (claves), no por nombre; fixtures reales anonimizadas. Salida: `DailyMetric[]`. Descompresión con una librería ya instalada o `DecompressionStream` del navegador (verificar soporte; si no, el usuario sube los JSON sueltos).
- Nunca se importa nada sin la vista previa: *"N actividades nuevas, M ya existentes (por `externalId`), K entrenamientos de fuerza (ver regla)"*.
- **Hallazgos con la exportación real del usuario (2026-11-06)**, todos con test:
  - La exportación completa es un ZIP de ~80 MB; lo útil está en `DI_CONNECT/`: `DI-Connect-Fitness/*_summarizedActivities.json` (actividades), `DI-Connect-Aggregator/UDSFile_*.json` (resumen diario: pasos, kcal, FC reposo, estrés, Body Battery), `DI-Connect-Wellness/*_sleepData.json`, `*_healthStatusData.json` (HRV), `DI-Connect-Metrics/TrainingReadinessDTO_*.json`, `*_userBioMetrics.json` (peso en gramos dentro de `weight.weight`, altura, VO2max) y `*_nutritionLogs.json`. Los ZIP de archivos FIT subidos (`UploadedFiles_*`) no se leen.
  - Unidades: `calories` de actividad en **kJ** (kcal = kJ ÷ 4,184; `bmrCalories` también), `distance` en **cm**, `duration` en **ms**, `startTimeLocal` en ms de hora local.
  - **Fecha local**: la app guarda `completedAt` en UTC; comparar por fecha local (en datos reales, parte de las "fuerza sin sesión" eran sesiones nocturnas mal emparejadas en UTC).
  - Las actividades traen **coordenadas GPS**: no se importan nunca; los fixtures del repo van anonimizados y sin ubicación.
  - El sueño del reloj es esporádico (1 noche en 90 días en los datos reales): ninguna función depende de él.

### A5.7.2 Datos y reglas de fusión
- Dexie **v5**: tabla `dailyMetrics` (`id, date`) con `DailyMetricRow { id; date; steps?; sleepMin?; restingHr?; hrv?; bodyBattery?; source: "garmin" | "manual" }`; índice `externalId` en `activities`. `backupVersion` 3 con la tabla nueva (límites de cordura en `DATA_LIMITS`).
- Función pura `mergeGarminImport(parsed, existing: { activities; sessions; dailyMetrics })` → `{ addActivities; updateSessions; addDailyMetrics; unmatchedStrength; skippedDuplicates }` con estas reglas, cada una con test:

  | Garmin | Regla |
  |---|---|
  | Natación, running, bici, caminata, deporte | `activities` con `source: "garmin"`, `externalId`; duplicado por `externalId` → se salta. |
  | Fuerza el mismo día que una sesión completada en la app | **No crea ni toca series.** Solo `SessionRow.external = { durationMin, avgHr, source: "garmin" }`. |
  | Fuerza sin sesión en la app ese día | `activities` con `type: "strength_external"`. Nunca es sesión del meso; no cuenta para volumen ni progresión. Home avisa *"Garmin registró fuerza el D sin sesión en la app"* con enlace a reabrir/crear la sesión a mano. |
  | Sueño, pasos, FC reposo, HRV, Body Battery | `dailyMetrics` por fecha (upsert por `date`+`source`). |
  | Sueño vs. check-in | El check-in manual manda. Si `sleptMinimum` está vacío y hay sueño de Garmin para esa noche, se precarga con `sleepMin >= minSleepHours×60` y se guarda `sleepSource: "garmin"`. |

- Stats/correlaciones: `dailyMetrics` entran como covariables (pasos medios, sueño medio, FC en reposo) en `buildMesoObservation`; `sleepDebtBySession` usa el sueño de Garmin cuando el check-in no tiene dato, marcando la fuente. Nada de esto toca la prescripción (regla 5).
- **Aceptación**: tests de ambos parsers con fixtures (incluido CSV con coma decimal y encabezados en español); tests de `mergeGarminImport` para las cinco reglas y para re-importar el mismo archivo (0 altas); E2E en `/settings` → "Importar de Garmin": subir el CSV, ver la vista previa, confirmar, ver las actividades en la Agenda y la nota en una sesión con fuerza el mismo día.

---

## A5.8 — Test AMRAP opcional: medir la precisión del RIR contra el fallo real ✅ (2026-11-06)
Hecha. Agregado sobre la spec: la serie del test tampoco entra a las comparaciones de reps a carga fija (`isComparableSet`), porque si no la sesión siguiente "caería" contra ella y dispararía una falsa señal de deload o de estancamiento; no se ofrece en slots APRE (ya terminan al fallo); los tests cuentan para la calibración desde cualquier meso.

- Hoy la calibración es un proxy (dispersión a carga fija, `rirCalibration._methodCaveat`). El protocolo validado (Martikainen 2025) canta un RIR y sigue hasta el fallo. Se ofrece como test **opcional** en la última serie de un ejercicio elegible.
- Elegibilidad: `equipmentType` en `amrapTest.allowedEquipment` (máquina, polea, mancuerna, peso corporal; barra solo con `settings.barbellFailureAllowed`), carga ≥ `minLoadPctE1rm` del e1RM, no en deload, no con dolor `act` en una zona que el ejercicio carga, y como máximo una vez cada `everySessionsPerExercise` sesiones del ejercicio.
- Flujo en sesión: la app propone *"¿Test de precisión hoy en X?"*. Si acepta, en la última serie el usuario registra **primero** el RIR que siente al punto donde pararía (`predictedRir`), y después sigue hasta el fallo y registra las reps totales. Se guarda como `kind: "failure"` con `amrapTest: { predictedRir, repsAtPrediction }`. La serie cuenta como estímulo (volumen, stats) y, como en APRE, sus reps pueden decidir la carga siguiente solo si el slot es APRE; si no, la progresión usa las series previas de esa sesión.
- Función pura `rirAccuracyFromTests(logs)` → `{ n, meanError, mad, bias: "underestimates" | "overestimates" | "neutral" }` (error = reps reales restantes − `predictedRir`). `rirCalibration` pasa a tener dos fuentes: `proxy` (hoy) y `measured`; con `n >= amrapTest.minTests` la calibración usa `measured` y la UI lo dice ("medido contra el fallo, n=4").
- **Config** (`amrapTest`, nueva): `{ "enabled": true, "everySessionsPerExercise": 6, "minLoadPctE1rm": 70, "allowedEquipment": ["machine", "cable", "dumbbell", "bodyweight"], "minTests": 3, "_note": "Protocolo de Martikainen 2025 (tests al 80 % 1RM cantando 3-RIR y 1-RIR y siguiendo al fallo) adaptado a una serie por ejercicio; 70 % es un piso prudente porque la precisión cae con cargas livianas (Russo 2025). Frecuencia y n mínimos: heurísticos." }`.
- **Aceptación**: tests de elegibilidad (barra sin seguros → no; deload → no; dolor act → no; cada 6 sesiones), de `rirAccuracyFromTests` (sesgo a subestimar con errores positivos), y de que la calibración cambia de fuente con n ≥ 3; E2E hacer un test en una máquina y ver "medido" en Stats.

---

## A5.9 — Respaldo a Drive/iCloud → fuera de este plan
Queda la exportación JSON/Excel como portabilidad y el recordatorio de respaldo existente (`BackupPrompt`) hasta que el sync lo reemplace. Texto original, solo referencia:

- `settings.lastBackupAt?`. Botón "Guardar respaldo en…" en `/settings` y en el aviso de Home: usa `navigator.share({ files: [File] })` cuando `navigator.canShare?.({ files })` es true (Android Chrome e iOS ≥ 15 abren el menú del sistema: Drive, iCloud, etc.); si no, cae en la descarga actual. Al compartir o descargar con éxito, se guarda `lastBackupAt`.
- Recordatorio: Home muestra *"Último respaldo hace N días"* a partir de `BACKUP_REMINDER_DAYS = 7` (constante en `src/lib/backup.ts`, no es un número científico), con "Guardar ahora" y "Recordar en una semana".
- Nunca automático sin toque (no hay API para escribir en Drive sin cuenta); documentarlo en `CONTEXT.md`.
- **Aceptación**: test de `backupReminder(lastBackupAt, today)` (pura, `src/lib`); E2E en el navegador de escritorio verifica el fallback a descarga y que `lastBackupAt` se actualiza; verificación en el teléfono real (Android: Drive; iPhone: iCloud) anotada en `docs/audits/` como en Plan A.

---

## A5.10 — Macro plan → fuera de este plan
Texto original, solo referencia:

- `macroPlans` (Dexie v5, misma versión que A5.7): `{ id; name; blocks: Array<{ intent; numAccumulationWeeks; progressionModel; rirBand?; note? }>; currentBlockIndex; createdAt }`. Un solo macro activo.
- Al terminar un meso, "Nuevo meso" propone el siguiente bloque del macro (intención, semanas, modelo), con cargas re-ancladas por A5.1.2; el usuario puede editar o ignorar. La memoria larga lee la intención de cada bloque (ya la tiene el meso).
- Sin motor nuevo: es solo contexto y conveniencia. Si la tarea se posterga, nada de A5.1–A5.9 depende de ella.
- **Aceptación**: test de `nextBlock(macro)`; E2E crear un macro de 3 bloques y generar dos mesos seguidos desde él.

---

## A5.11 — Documentación ✅ (2026-11-06)
Hecha: `CONTEXT.md` §4 (campos A5), §5 (F11–F15), §6 (firmas y "Reglas fijadas por A5"); `SCIENCE.md` §12–§15; `CHANGELOG.md`. Las notas `_` de cada clave nueva de la config ya estaban.

- `CONTEXT.md`: §4 (campos `intent`, `holdLoad`, `loadedZones`, `pain`, `external`, `source/externalId`), §5 (F11 memoria entre mesos, F12 mantener, F13 dolor, F14 actividad externa, F15 test AMRAP), §6 (firmas de `trackHistory`, `longTermTrend`, `evaluatePainSignal`, `rirAccuracyFromTests`), y una sección "Reglas fijadas por A5" con la separación memoria corta/larga.
- `SCIENCE.md`: §12 Continuidad entre mesos y techo (Latella 2020; por qué el e1RM es la moneda común y dónde se degrada), §13 Dolor articular/tendinoso (Silbernagel 2007; umbrales como heurística clínica; distinción con DOMS), §14 Actividad externa (Schumann 2022, Petré 2021: interferencia solo misma sesión/< 3 h), §15 Test AMRAP (ampliación de §4). Cada número de config citado.
- `rules.config.json`: notas `_` en cada clave nueva. `docs/plans/README.md`: fila `PLAN_A5.md`. `docs/ROADMAP.md` y `CHANGELOG.md`.

---

## Auditoría
Al cerrar A5.8, correr el protocolo de `docs/plans/AUDITORIA.md` en las tres pistas, con énfasis en: (1) que ningún camino de actividad externa, dolor o intención llegue a `nextPrescription` fuera de lo especificado (grep de `pain`, `activities`, `intent` dentro de `src/domain/progression.ts` debe dar 0; solo `holdLoad` y `continuity` entran); (2) textos de dolor sin lenguaje diagnóstico ni culpabilizador; (3) el test AMRAP nunca se ofrece en barra sin seguros, en deload ni con dolor activo.

## Criterio de "Plan A5 terminado"
- Todas las tareas con aceptación verde; `npm run test` ≥ 360 tests; `typecheck`, `lint`, `build`, `test:a11y`, `test:offline` limpios.
- E2E final con el respaldo real: crear un meso nuevo con dos pistas repetidas y una cambiada → la repetida hereda, la cambiada re-ancla; marcar Mantener y salir cargando más; registrar dolor dos sesiones y aceptar una opción; editar una actividad y crear una en un día pasado desde la Agenda; hacer un test AMRAP. Exportar e importar sin pérdida (la migración Dexie v5 y `backupVersion` 3 se hacen una sola vez en un plan posterior; hasta entonces los campos nuevos de A5 son opcionales dentro de v2).
- Auditoría sin hallazgos altos ni medios abiertos.
- La app sigue funcionando íntegra sin ninguna de las funciones nuevas usadas (sin dolor, sin Garmin, sin intención declarada): regresión del Plan A completa.
