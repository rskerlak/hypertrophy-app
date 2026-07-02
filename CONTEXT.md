# CONTEXT.md — Especificación de producto y técnica

> Fuente de verdad de **qué** construir. El `CLAUDE.md` cubre **cómo** trabajar en el repo. El `rules.config.json` contiene los datos científicos. El `SCIENCE.md` justifica cada número. Ante conflicto, este documento manda sobre suposiciones del agente; si algo no está especificado aquí, preguntar antes de inventar.

---

## 1. Visión y no-objetivos

**Visión.** App personal de un solo usuario para diseñar y ejecutar mesociclos de entrenamiento de hipertrofia. El usuario define **una semana base** (ejercicios, días, series, rangos de reps, pesos iniciales); la app **planifica todo el mesociclo** según el número de semanas y el modelo de progresión elegido, con **deload al final**. Durante cada sesión, el usuario registra por serie (peso, reps, RIR) y el motor **autorregula** las cargas y el volumen siguientes. Al final de cada ciclo entrega **estadísticas de calibración intra-sujeto**. Es conceptualmente similar a la app de Renaissance Periodization, pero propia, transparente y ajustable.

**No-objetivos (explícitos — no implementar).**
- Sin multiusuario, sin login, sin autenticación, sin perfiles de otras personas.
- Sin backend, sin servidor, sin sincronización en la nube. Todos los datos viven en el dispositivo (IndexedDB).
- Sin contador de macros ni base de datos de alimentos. La nutrición es autoreporte simple (dos campos).
- Sin red social, sin compartir, sin gamificación competitiva.
- Sin recomendaciones médicas ni de suplementación.
- No modificar la sesión de forma refleja por sueño/nutrición (ver §5 F7 y §9).

**Postura epistémica del producto.** El motor usa heurísticas útiles (MEV/MAV/MRV, disparadores de deload) que **no son cantidades medidas**. La app debe comunicar incertidumbre donde importa (deload "sugerido" y probabilístico, no "MRV alcanzado"; aviso de "n pequeño" en stats de un ciclo). No fingir precisión que la evidencia no respalda.

---

## 2. Glosario de dominio

- **Mesociclo (meso):** bloque de N semanas de acumulación + 1 semana de deload.
- **Semana base:** plantilla que define el usuario (días, ejercicios, series, rangos de reps, pesos iniciales). El motor la usa para generar el meso completo.
- **Set fraccionado:** unidad de volumen. Set directo = 1.0; set donde el músculo es sinergista = 0.5. (Pelland 2026.)
- **MV / MEV / MAV / MRV:** volúmenes de mantenimiento / mínimo efectivo / máximo adaptativo / máximo recuperable, en sets fraccionados/semana. **Heurísticos, no medidos.**
- **RIR (reps in reserve):** reps que quedan antes del fallo. Herramienta de autorregulación; ruidosa lejos del fallo.
- **Rampa de volumen:** aumento de sets/semana desde ~MEV hacia MAV/MRV a lo largo del meso.
- **Deload:** semana de fatiga reducida (menos volumen, algo de carga). Gestión de fatiga, no potenciador anabólico.
- **Doble progresión:** subir reps dentro de un rango y luego carga. Modelo core.
- **DUP:** periodización ondulante diaria (varía carga/reps por día).
- **`isSwappable`:** flag por ejercicio; solo sobre estos el motor sugiere cambios.

Definiciones fisiológicas y evidencia detrás de cada rango: ver **SCIENCE.md**.

---

## 3. Arquitectura

**Patrón: dominio puro + adaptadores (repository).**

```
┌──────────────────────────────────────────────┐
│  UI  (Next.js App Router + shadcn/ui)          │
│  render reactivo con useLiveQuery (Dexie)      │
└───────────────┬───────────────────────────────┘
                │ acciones
┌───────────────▼───────────────────────────────┐
│  store/  (Zustand) — estado de UI / sesión      │
└───────────────┬───────────────────────────────┘
                │ llama
┌───────────────▼───────────────────────────────┐
│  db/  repositories  → Dexie → IndexedDB         │
│  (única capa que toca persistencia)             │
└───────────────┬───────────────────────────────┘
                │ pasa estado + config a
┌───────────────▼───────────────────────────────┐
│  domain/  FUNCIONES PURAS  (leen rules.config)  │
│  progresiones · redondeo · gen. meso · deload   │
│  · stats · 1RM   —  CON tests unitarios          │
└────────────────────────────────────────────────┘
```

**Reglas duras:**
- `domain/` no importa React, Dexie, ni accede a `window`/`Date.now()`. La fecha, si hace falta, entra como argumento. Esto lo hace determinista y testeable.
- Toda constante científica sale de `rules.config.json` (tipada y validada con Zod al cargar).
- La UI nunca escribe IndexedDB directo: pasa por `db/` repositories.
- Progresión impulsada por sesión completada, no por fecha.

---

## 4. Modelo de datos (tablas Dexie)

Tipar todo con TypeScript. IDs `string` (uuid). Índices donde se filtra.

**`settings`** (singleton, id fijo `"default"`)
- `experienceProfile`: `"novice" | "intermediate" | "advanced"`
- `bodyweightKg`: number
- `proteinTargetGperKg`: number (default desde config, editable)
- `minSleepHours`: number (default desde config)
- `prioritizedMuscles`: string[] (subset de `muscles`; vacío = todos por igual)
- `equipment`: `{ barWeightKg: number, platesKg: number[], dumbbellsKg: number[], machineStepKg: number }`

**`exercises`**
- `id`, `name`
- `primaryMuscle`: string, `secondaryMuscles`: string[]
- `equipmentType`: `"barbell" | "dumbbell" | "machine" | "cable" | "bodyweight"`
- `resistanceProfile`: `"stretch" | "mid" | "short"` (para sesgo de reemplazo)
- `isSwappable`: boolean
- `swapCandidates`: string[] (ids de ejercicios alternativos, mismo `primaryMuscle`)
- `defaultRepRange`?: `{ min, max }` (si se omite, se deriva por tipo desde config)

**`baseWeek`** (singleton, id fijo `"default"`)
- `days`: `Array<{ label: string; slots: Array<{ exerciseId: string; targetSets: number; repRange: { min, max }; startingLoadKg: number }> }>`

**`mesocycles`**
- `id`, `name`, `createdAt`
- `numAccumulationWeeks`: number, `deloadWeeks`: number (default 1)
- `progressionModel`: `"linear" | "double" | "dup" | "block"`
- `status`: `"planned" | "active" | "completed"`
- `plan`: snapshot generado (el plan completo semana×día×slot con targets). Ver §6 `generateMesocycle`.

**`sessions`**
- `id`, `mesocycleId` (índice), `weekIndex`, `dayIndex`
- `dayLabel`, `isDeload`: boolean
- `plannedDate`?: string (ISO, solo agenda), `completedAt`?: string
- `status`: `"pending" | "completed" | "skipped"`

**`setLogs`**
- `id`, `sessionId` (índice), `exerciseId` (índice), `setIndex`
- `targetLoadKg`, `targetReps`, `targetRir`
- `actualLoadKg`, `actualReps`, `actualRir`
- `timestamp`

**`checkins`**
- `id`, `sessionId` (índice), `date`
- `sleptMinimum`: boolean | null
- `proteinSufficient`: boolean | null
- `energyBalance`: `"surplus" | "maintenance" | "deficit" | null`
- `readiness`?: 1–5 (opcional), `note`?: string

---

## 5. Features (historias verticales con criterios de aceptación)

Implementar **una por una, cada una completa (datos+lógica+UI)**. Criterios de aceptación = tests.

### F1 — Configuración inicial
Configurar perfil de experiencia, peso corporal, inventario de equipamiento (discos/mancuernas/barra), sueño mínimo, objetivo de proteína.
**Aceptación:** los defaults se leen de `rules.config.json`; los cambios persisten en `settings`; el inventario de equipamiento alimenta el redondeo de cargas.

### F2 — Definir semana base
Crear días; añadir ejercicios a cada día con series objetivo, rango de reps y peso inicial; marcar `isSwappable` y `swapCandidates`.
**Aceptación:** se puede crear/editar/reordenar; el volumen semanal por músculo (en sets fraccionados) se calcula y muestra en vivo, comparado contra MEV/MAV/MRV del perfil (con etiqueta de "heurístico").

### F3 — Generar mesociclo
Elegir modelo de progresión, número de semanas de acumulación (default por perfil, cap por perfil), deload al final. La app genera el `plan` completo.
**Aceptación:** dado semana base + config, `generateMesocycle` produce un plan determinista con rampa de volumen (MEV→MAV/MRV según perfil), RIR objetivo por semana (de `rirSchedule`), y una semana de deload estructurada. Cambiar el modelo cambia la estructura de targets, no el volumen semanal total (los modelos igualan volumen). El sesgo por músculos priorizados se aplica (§6).

### F4 — Calendario (agenda impulsada por sesión)
Vista de calendario real con las sesiones planificadas. Si un día no se entrena, la app **corre los días** o **sugiere saltar** con recomendación basada en evidencia.
**Aceptación:** el estado del meso avanza solo al **completar** una sesión, nunca por paso del tiempo. Un día perdido no rompe la progresión: la sesión N sigue siendo N. El aviso es neutral. La recomendación de correr vs. saltar viene de una función pura (§6) y no altera cargas por sí sola.

### F5 — Ejecutar sesión
Mostrar los slots del día con targets (carga, reps, RIR). Registrar por serie: peso, reps, RIR. Timer de descanso. **Wake lock** activo. Marcar sesión completada.
**Aceptación:** cada serie se persiste en `setLogs`; el wake lock se adquiere al iniciar y se libera al salir/minimizar (try/catch, re-adquisición en `visibilitychange`); recargar la página no pierde datos ya ingresados (`reloadOnOnline: false` + persistencia inmediata).

### F6 — Autorregulación de carga (motor)
Tras cada sesión (o al preparar la siguiente), el motor calcula la prescripción siguiente por slot según el modelo de progresión, usando las reps logradas al RIR objetivo. Redondea la carga al incremento disponible; si el salto mínimo excede el % objetivo, añade reps.
**Aceptación:** `nextPrescription` es determinista y cubierta por tests, incluyendo el caso "salto mínimo > % objetivo → añadir rep". Ver §6.

### F7 — Check-in neutral (opcional)
Antes de la sesión, ofrecer registrar sueño (¿dormiste el mínimo? sí/no) y nutrición (proteína suficiente sí/no; balance energético). Opcional, saltable, tono neutral.
**Aceptación:** el check-in **nunca** modifica los targets de la sesión ni bloquea su inicio. Solo persiste en `checkins`. No hay lenguaje culpabilizador. Puede saltarse con un tap.

### F8 — Disparadores de deload
Evaluar señales multi-fuente (caída de rendimiento, RIR creep, MRV alcanzado, baja disposición crónica) y **sugerir** deload cuando se cumplan ≥ `minSignalsToSuggest`. Fallback: forzar deload al terminar la acumulación.
**Aceptación:** `evaluateDeloadTrigger` devuelve `{ shouldSuggest, reasons[] }`; la UI lo presenta como sugerencia probabilística ("señales de fatiga acumulada", no "superaste tu MRV"); el usuario decide.

### F9 — Sugerencia de cambio de ejercicio
Sobre ejercicios `isSwappable`, sugerir cambio ante estancamiento (N sesiones sin progreso al RIR objetivo). Preferir reemplazo con `resistanceProfile: "stretch"`.
**Aceptación:** `suggestExerciseSwap` solo actúa sobre `isSwappable`; propone desde `swapCandidates`; nunca rota de forma aleatoria/frecuente; explica el motivo.

### F10 — Estadísticas de fin de ciclo
Al completar un meso, mostrar: progresión de carga estimada por ejercicio y por músculo, volumen completado vs. planeado, deriva de precisión de RIR, trayectoria de fatiga (reps a carga fija por semana), adherencia.
**Aceptación:** usa solo métricas válidas (`statsPolicy.validProgressMetrics`); **no** muestra bombeo/dolor como progreso; incluye aviso visible de "n pequeño: la calibración fiable requiere varios ciclos".

---

## 6. Especificación algorítmica (funciones puras en `src/domain/`)

Firmas orientativas (TypeScript). Todas deterministas, sin efectos, leen `rules` (el objeto parseado de `rules.config.json`). Escribir tests para cada una.

### `generateMesocycle`
```ts
generateMesocycle(input: {
  baseWeek: BaseWeek;
  profile: ExperienceProfile;
  progressionModel: ProgressionModel;
  numAccumulationWeeks: number;
  prioritizedMuscles: string[];
  rules: Rules;
}): MesocyclePlan
```
Pasos: (1) calcular volumen semanal base por músculo desde `baseWeek` (conteo fraccionado). (2) `rampVolume`: para cada semana de acumulación, interpolar sets desde MEV hacia el techo del perfil (MAV, o MRV si `pushToMrv`) usando `rampAggressiveness`. (3) `distributeVolumeByPriority`: sesgar el volumen añadido hacia músculos priorizados (los no priorizados se mantienen cerca de MEV/MAV bajo). (4) asignar RIR objetivo por semana desde `rirSchedule.byAccumulationLength[N]`. (5) para el modelo elegido, derivar targets de reps/carga por día (DUP y block modifican la estructura intra-semana, no el volumen semanal total). (6) añadir la semana de deload desde `deloadStructure`.
**Invariantes:** el volumen semanal total por músculo es igual entre modelos para la misma semana; ningún músculo supera su MRV de perfil salvo `pushToMrv` en avanzado en la última semana; el deload queda por debajo de MEV.

### `nextPrescription`
```ts
nextPrescription(input: {
  exerciseHistory: SetLog[];   // sesiones previas de este slot
  model: ProgressionModel;
  targetRir: number;           // de la semana actual
  repRange: { min: number; max: number };
  currentLoadKg: number;
  equipment: Equipment;
  rules: Rules;
}): { nextLoadKg: number; nextReps: number; nextSets?: number }
```
Despacha a la progresión:
- **linear:** si en la última sesión se alcanzaron las reps objetivo al RIR objetivo, subir carga por `loadIncrementPctPerSession` redondeado con `roundToAvailable`. Si no se progresó en `failToProgressThreshold` sesiones, mantener.
- **double:** si las reps logradas < tope del rango al RIR objetivo → subir reps en `repStepWhenBelowCeiling`, misma carga. Si se alcanzó el tope → subir carga (`loadIncrementPctOnRepCeiling` vía `roundToAvailable`) y volver al piso del rango. **Si el salto mínimo de carga excede el % objetivo → no subir carga aún; añadir una rep** (aunque supere el tope) hasta que el salto sea proporcional.
- **dup:** elegir `dayType` según el día; aplicar su `repRange` y `targetRirOffset`; dentro de eso, doble progresión.
- **block:** determinar la fase por `week / totalWeeks` vs `fractionOfMeso`; aplicar `repRange` y `rirBias` de la fase; dentro, doble progresión.

### `roundToAvailable`
```ts
roundToAvailable(targetLoadKg: number, equipment: {
  type: EquipmentType; barWeightKg: number; platesKg: number[]; dumbbellsKg: number[]; machineStepKg: number;
}): number
```
- **barbell:** paso mínimo = 2 × menor disco disponible. Redondear al peso alcanzable (barra + pares de discos) más cercano **por debajo o igual** al objetivo.
- **dumbbell:** al escalón de mancuerna disponible más cercano ≤ objetivo.
- **machine/cable:** múltiplo de `machineStepKg` más cercano ≤ objetivo.
- **bodyweight:** devolver el objetivo sin redondear (o gestionar lastre aparte).
**Tests:** objetivo 82.1 kg barra con discos [1.25,2.5,5,...] → 82.5 imposible con par de 1.25? (paso 2.5) → 82.5 no alcanzable desde 80 con par mínimo 2.5 → 82.5 requiere par de 1.25 (2.5 total) → validar exactamente contra el inventario. Cubrir el caso sin disco de 1.25 (paso 5).

### `evaluateDeloadTrigger`
```ts
evaluateDeloadTrigger(input: {
  recentSessions: SessionSummary[];
  checkins: Checkin[];
  currentWeeklyVolumeByMuscle: Record<string, number>;
  profile: ExperienceProfile;
  weekIndex: number;
  numAccumulationWeeks: number;
  rules: Rules;
}): { shouldSuggest: boolean; reasons: string[]; forced: boolean }
```
Contar señales habilitadas de `deloadTriggers.signals`. `shouldSuggest = signalsCount >= minSignalsToSuggest`. `forced = weekIndex >= numAccumulationWeeks` (fallback programado). Devolver los `reasons` legibles.

### `suggestExerciseSwap`
```ts
suggestExerciseSwap(input: {
  exercise: Exercise;
  history: SetLog[];
  rules: Rules;
}): { suggest: boolean; candidateId?: string; reason?: string }
```
Solo si `exercise.isSwappable`. `suggest = true` si hubo `stagnationSessions` sin progreso (ni reps ni carga al RIR objetivo). Elegir candidato desde `swapCandidates`, prefiriendo `resistanceProfile: "stretch"` si `preferStretchBiasedReplacement`.

### `estimate1RM`
```ts
estimate1RM(loadKg: number, reps: number, rir: number, rules: Rules): number
```
Epley ajustado por RIR: `1RM = load * (1 + coefficient * (reps + rir))`. Usar para sugerir peso inicial dado un target de reps/RIR: invertir para hallar la carga y pasar por `roundToAvailable`.

### `computeMesoStats`
```ts
computeMesoStats(input: { mesocycle: Mesocycle; sessions: Session[]; setLogs: SetLog[]; checkins: Checkin[]; rules: Rules }): MesoStats
```
Solo métricas de `statsPolicy.validProgressMetrics`. Incluir en el output el `smallSampleWarning`.

### `recommendCalendarShift`
```ts
recommendCalendarShift(input: { missedSession: Session; daysMissed: number; rules: Rules }): { action: "shift" | "skip"; rationale: string }
```
Como la progresión es por sesión, la recomendación por defecto es **correr** (shift): no se pierde estímulo, solo se desplaza la agenda. Sugerir **skip** solo si saltar mantiene mejor la frecuencia semanal objetivo del músculo. Nunca altera cargas por sí sola.

---

## 7. Esquema de `rules.config.json`

Ya provisto como archivo. Puntos que el agente debe respetar al consumirlo:
- Validar el shape con Zod al cargar; fallar ruidoso si el schema no coincide (`schemaVersion`).
- Los campos que empiezan con `_` son documentación (notas), no datos de ejecución: ignorarlos en la lógica pero no borrarlos.
- Landmarks efectivos por perfil = `volumeLandmarksBase[muscle] * experienceProfiles[profile].volumeMultiplier`.
- Nunca duplicar estos valores en código; leerlos siempre desde aquí.

---

## 8. Plan por fases (milestones incrementales)

**Fase 0 — Andamiaje.** Next.js (`output: 'export'`) + TS estricto + Tailwind + shadcn/ui + Dexie + Zustand + Serwist + Vitest. Cargar y validar `rules.config.json` con Zod. Esqueleto de rutas.

**Fase 1 — Motor puro + tests (lo primero verificable).** Implementar en `src/domain/` todas las funciones de §6 con unit tests, contra `rules.config.json`. Sin UI todavía. Este es el corazón; que pase tests antes de seguir.

**Fase 2 — Persistencia.** Esquema Dexie (§4) + repositories. `useLiveQuery` como fuente de render.

**Fase 3 — Features verticales**, en este orden: F1 config → F2 semana base → F3 generar meso → F5 ejecutar sesión (+ wake lock) → F6 autorregulación → F4 calendario → F7 check-in → F8 deload → F9 swap → F10 stats.

**Fase 4 — PWA hardening.** Serwist (disable en dev, `reloadOnOnline: false`), manifest instalable, precache del app shell, `navigator.storage.persist()`. Probar offline total en móvil real.

Cada fase termina con: `npm run typecheck` limpio, tests del motor en verde, y revisión del diff contra este documento.

---

## Recordatorios de honestidad (mantener en la UI)
- Deload = "señales de fatiga acumulada, se sugiere descargar", nunca "superaste tu MRV".
- Landmarks etiquetados como heurísticos.
- Stats de un ciclo con aviso de "n pequeño".
- Sueño/nutrición: se registran, no recortan la sesión.
