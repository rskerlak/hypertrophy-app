// generateMesocycle: dado semana base + perfil + modelo, produce el plan
// completo (semanas de acumulación con rampa de volumen + RIR por semana +
// semana de deload). Determinista.

import type { Rules } from "./rules";
import { effectiveLandmarks, rirScheduleForLength } from "./rules";
import type {
  BaseWeek,
  DayIntensity,
  DupDayType,
  Exercise,
  ExperienceProfileId,
  MesocyclePlan,
  PlannedDay,
  PlannedSlot,
  PlannedWeek,
  ProgressionModel,
  RirBand,
} from "./types";
import { addExerciseVolume, emptyVolume, weeklyVolumeByMuscle, type VolumeByMuscle } from "./volume";

export interface GenerateMesocycleInput {
  baseWeek: BaseWeek;
  exercises: Exercise[];
  profile: ExperienceProfileId;
  progressionModel: ProgressionModel;
  numAccumulationWeeks: number;
  prioritizedMuscles: string[];
  rules: Rules;
  /** Banda de RIR del meso (ej. 1–3). Sin valor: el calendario del config tal cual. */
  rirBand?: RirBand;
}

/**
 * RIR objetivo final de un slot: calendario semanal + offset del día
 * (fuerte/liviano) + offset del modelo, acotado a la banda del meso. El piso
 * de barra se aplica al final: la seguridad manda sobre la banda.
 */
export function plannedRir(args: {
  baseRir: number;
  intensity?: DayIntensity;
  modelOffset?: number;
  band?: RirBand;
  isBarbell: boolean;
  rules: Rules;
}): number {
  const { rules } = args;
  let rir = args.baseRir + (args.modelOffset ?? 0);
  if (args.intensity) rir += rules.dayIntensity[args.intensity].rirOffset;
  if (args.band) rir = Math.min(args.band.max, Math.max(args.band.min, rir));
  else rir = Math.max(0, rir);
  if (args.isBarbell) rir = Math.max(rir, rules.rirSchedule.barbellRiskFloor);
  return rir;
}

const DUP_CYCLE: DupDayType[] = ["heavy", "medium", "light"];

/** Similitud de Jaccard entre dos conjuntos (1 si ambos vacíos). */
function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / union.size;
}

/**
 * Asigna el tipo de día DUP ONDULANDO POR GRUPO MUSCULAR, no por posición:
 * los días que comparten la mayoría de sus músculos primarios (Jaccard ≥ 0.5)
 * forman un "cluster" (ej. tus dos días de empuje, aunque varíen ejercicios)
 * y ciclan pesado→medio→liviano entre sí. El punto de partida rota con la
 * semana, así cada grupo muscular cubre las tres zonas a lo largo del meso
 * aunque entrene 1–2 veces por semana. El offset por cluster mantiene
 * variedad dentro de la misma semana.
 */
export function dupDayTypesForWeek(
  baseWeek: BaseWeek,
  exercisesById: Map<string, Exercise>,
  weekIndex: number,
): DupDayType[] {
  const signatures = baseWeek.days.map(
    (day) =>
      new Set(
        day.slots
          .map((s) => exercisesById.get(s.exerciseId)?.primaryMuscle)
          .filter((m): m is string => !!m),
      ),
  );
  const clusters: Array<{ signature: Set<string>; occurrences: number; index: number }> = [];
  return signatures.map((sig) => {
    let cluster = clusters.find((c) => jaccard(c.signature, sig) >= 0.5);
    if (!cluster) {
      cluster = { signature: sig, occurrences: 0, index: clusters.length };
      clusters.push(cluster);
    }
    const type =
      DUP_CYCLE[(cluster.occurrences + cluster.index + weekIndex) % DUP_CYCLE.length];
    cluster.occurrences++;
    return type;
  });
}

/**
 * Reconstruye una semana base desde la semana 1 de un plan existente,
 * opcionalmente reemplazando las cargas iniciales (continuación de meso:
 * heredar cargas desde el rendimiento real del ciclo anterior).
 */
export function deriveBaseWeekFromPlan(
  plan: MesocyclePlan,
  /** Cargas heredadas por slot, clave `${dayIndex}:${slotIndex}`. */
  loadOverridesBySlot?: Map<string, number>,
): BaseWeek {
  const week0 = plan.weeks.find((w) => !w.isDeload) ?? plan.weeks[0];
  return {
    days: week0.days.map((day, dayIndex) => ({
      label: day.label,
      ...(day.intensity ? { intensity: day.intensity } : {}),
      slots: day.slots.map((slot, slotIndex) => ({
        exerciseId: slot.exerciseId,
        ...(slot.supersetGroup ? { supersetGroup: slot.supersetGroup } : {}),
        ...(slot.setTargets && slot.setTargets.length > 1 && !slot.setTargets[0].amrap && slot.setTargets[0].targetRir < slot.targetRir
          ? { anchorSet: true }
          : {}),
        ...(slot.progression === "apre" ? { progression: "apre" as const } : {}),
        targetSets: slot.sets,
        repRange: { ...slot.repRange },
        startingLoadKg:
          loadOverridesBySlot?.get(`${dayIndex}:${slotIndex}`) ?? slot.targetLoadKg,
      })),
    })),
  };
}

export function generateMesocycle(input: GenerateMesocycleInput): MesocyclePlan {
  const { baseWeek, exercises, profile, progressionModel, prioritizedMuscles, rules } = input;
  const profileCfg = rules.experienceProfiles[profile];
  const N = Math.min(input.numAccumulationWeeks, profileCfg.maxAccumulationWeeks);
  const exercisesById = new Map(exercises.map((e) => [e.id, e]));

  const baseVol = weeklyVolumeByMuscle(baseWeek, exercisesById, rules);
  const weeks: PlannedWeek[] = [];

  for (let w = 0; w < N; w++) {
    weeks.push(
      buildAccumulationWeek({
        baseWeek,
        exercisesById,
        baseVol,
        weekIndex: w,
        numAccumulationWeeks: N,
        profile,
        progressionModel,
        prioritizedMuscles,
        rules,
        rirBand: input.rirBand,
      }),
    );
  }

  weeks.push(buildDeloadWeek(weeks[0], weeks[N - 1], exercisesById, profile, rules, N, input.rirBand));

  return {
    progressionModel,
    numAccumulationWeeks: N,
    weeks,
    ...(input.rirBand ? { rirBand: { ...input.rirBand } } : {}),
  };
}

/**
 * Volumen objetivo del músculo para la semana w según volumeRamp.mode:
 * - "finalWeeksBump" (default): el volumen se queda en el de la semana base;
 *   solo las últimas bumpWeeks semanas agregan un empujón acotado de sets.
 *   La progresión primaria es reps/carga, no series (Barsuhn 2025).
 * - "linear" (legado): rampa hacia MAV (o MRV si pushToMrv) con rampAggressiveness.
 * - "none": volumen constante siempre.
 * Si el músculo no está priorizado (habiendo priorizados), nunca rampa.
 */
export function weeklyVolumeTarget(args: {
  muscle: string;
  baseVolume: number;
  weekIndex: number;
  numAccumulationWeeks: number;
  profile: ExperienceProfileId;
  prioritized: boolean;
  rules: Rules;
}): number {
  const { muscle, baseVolume, weekIndex, numAccumulationWeeks, profile, prioritized, rules } = args;
  const lm = effectiveLandmarks(rules, profile, muscle);
  const profileCfg = rules.experienceProfiles[profile];
  const ramp = rules.volumeRamp;
  const start = Math.max(baseVolume, 0);
  if (start === 0) return 0; // músculo no entrenado en la semana base: no inventar volumen
  if (!prioritized || ramp.mode === "none") return start;

  if (ramp.mode === "finalWeeksBump") {
    const bumpStart = numAccumulationWeeks - ramp.bumpWeeks;
    if (weekIndex < bumpStart) return start;
    const bumps = weekIndex - bumpStart + 1;
    const ceiling = Math.min(lm.mav, lm.mrv);
    return Math.min(start + ramp.maxExtraSetsPerMusclePerWeek * bumps, Math.max(ceiling, start));
  }

  // "linear" (legado)
  const ceiling = profileCfg.pushToMrv ? lm.mrv : lm.mav;
  if (start >= ceiling) return Math.min(start, lm.mrv);
  const progress =
    numAccumulationWeeks <= 1 ? 0 : weekIndex / (numAccumulationWeeks - 1);
  const target = start + (ceiling - start) * profileCfg.rampAggressiveness * progress;
  return Math.min(target, lm.mrv);
}

function buildAccumulationWeek(args: {
  baseWeek: BaseWeek;
  exercisesById: Map<string, Exercise>;
  baseVol: VolumeByMuscle;
  weekIndex: number;
  numAccumulationWeeks: number;
  profile: ExperienceProfileId;
  progressionModel: ProgressionModel;
  prioritizedMuscles: string[];
  rules: Rules;
  rirBand?: RirBand;
}): PlannedWeek {
  const { baseWeek, exercisesById, baseVol, weekIndex, numAccumulationWeeks, profile, progressionModel, prioritizedMuscles, rules, rirBand } = args;
  const rirSchedule = rirScheduleForLength(rules, numAccumulationWeeks);
  const baseRir = rirSchedule[weekIndex];

  // 1. Sets extra por músculo para alcanzar el objetivo de la semana.
  const trained = Object.keys(baseVol).filter((m) => baseVol[m] > 0);
  const prioritizedSet = new Set(
    prioritizedMuscles.length > 0 ? prioritizedMuscles : trained,
  );
  const targets: VolumeByMuscle = {};
  for (const m of trained) {
    targets[m] = weeklyVolumeTarget({
      muscle: m,
      baseVolume: baseVol[m],
      weekIndex,
      numAccumulationWeeks,
      profile,
      prioritized: prioritizedSet.has(m),
      rules,
    });
  }

  // 2. Distribuir sets extra en los slots (round-robin por músculo primario),
  //    sin que ningún músculo afectado supere su MRV efectivo.
  const extraSetsBySlot = distributeExtraSets({
    baseWeek,
    exercisesById,
    baseVol,
    targets,
    prioritizedFirst: [...prioritizedSet],
    profile,
    rules,
  });

  // 3. Construir los días con targets según el modelo.
  const dupTypes = dupDayTypesForWeek(baseWeek, exercisesById, weekIndex);
  const days: PlannedDay[] = baseWeek.days.map((day, dayIndex) => {
    const dayType = dupTypes[dayIndex];
    const slots: PlannedSlot[] = day.slots.map((slot, slotIndex) => {
      const ex = exercisesById.get(slot.exerciseId);
      const extra = extraSetsBySlot.get(`${dayIndex}:${slotIndex}`) ?? 0;
      let repRange = slot.repRange;
      let modelOffset = 0;
      let phase: string | undefined;
      let slotDayType: DupDayType | undefined;

      if (progressionModel === "dup") {
        const dt = rules.progressionModels.dup.dayTypes[dayType];
        repRange = dt.repRange;
        modelOffset = dt.targetRirOffset;
        slotDayType = dayType;
      } else if (progressionModel === "block") {
        const p = blockPhase(rules, weekIndex, numAccumulationWeeks);
        repRange = p.repRange;
        modelOffset = p.rirBias;
        phase = p.name;
      }

      // Calendario + día fuerte/liviano + modelo, acotado a la banda; piso de barra.
      const rir = plannedRir({
        baseRir,
        intensity: day.intensity,
        modelOffset,
        band: rirBand,
        isBarbell: ex?.equipmentType === "barbell",
        rules,
      });

      // RIR por serie: ancla (serie 1 más cerca del fallo) y AMRAP de APRE
      // (última serie al fallo). Sin ancla ni APRE, todas iguales.
      const totalSets = slot.targetSets + extra;
      const isApre = slot.progression === "apre";
      let setTargets: PlannedSlot["setTargets"];
      if (slot.anchorSet || isApre) {
        setTargets = Array.from({ length: totalSets }, () => ({ targetRir: rir }));
        if (slot.anchorSet && totalSets > 1) {
          setTargets[0] = {
            targetRir: plannedRir({
              baseRir,
              intensity: day.intensity,
              modelOffset: modelOffset - rules.anchorSet.rirDelta,
              band: rirBand,
              isBarbell: ex?.equipmentType === "barbell",
              rules,
            }),
          };
        }
        if (isApre) setTargets[totalSets - 1] = { targetRir: 0, amrap: true };
      }
      return {
        exerciseId: slot.exerciseId,
        ...(slot.supersetGroup ? { supersetGroup: slot.supersetGroup } : {}),
        ...(setTargets ? { setTargets } : {}),
        ...(isApre ? { progression: "apre" as const } : {}),
        sets: totalSets,
        repRange,
        targetRir: rir,
        targetLoadKg: slot.startingLoadKg,
        dayType: slotDayType,
        phase,
      };
    });
    return { label: day.label, slots, ...(day.intensity ? { intensity: day.intensity } : {}) };
  });

  // 4. Volumen resultante de la semana.
  const vol = emptyVolume(rules);
  for (const day of days) {
    for (const slot of day.slots) {
      const ex = exercisesById.get(slot.exerciseId);
      if (ex) addExerciseVolume(vol, ex, slot.sets, rules);
    }
  }

  return { weekIndex, isDeload: false, days, targetVolumeByMuscle: vol };
}

function blockPhase(rules: Rules, weekIndex: number, totalWeeks: number) {
  const frac = totalWeeks <= 1 ? 0 : weekIndex / totalWeeks;
  let cum = 0;
  for (const phase of rules.progressionModels.block.phases) {
    cum += phase.fractionOfMeso;
    if (frac < cum) return phase;
  }
  return rules.progressionModels.block.phases[
    rules.progressionModels.block.phases.length - 1
  ];
}

function distributeExtraSets(args: {
  baseWeek: BaseWeek;
  exercisesById: Map<string, Exercise>;
  baseVol: VolumeByMuscle;
  targets: VolumeByMuscle;
  prioritizedFirst: string[];
  profile: ExperienceProfileId;
  rules: Rules;
}): Map<string, number> {
  const { baseWeek, exercisesById, baseVol, targets, prioritizedFirst, profile, rules } = args;
  const extra = new Map<string, number>();
  const current: VolumeByMuscle = { ...baseVol };

  // Slots por músculo primario, en orden estable.
  const slotsByMuscle = new Map<string, Array<{ key: string; exercise: Exercise }>>();
  baseWeek.days.forEach((day, dayIndex) => {
    day.slots.forEach((slot, slotIndex) => {
      const ex = exercisesById.get(slot.exerciseId);
      if (!ex) return;
      const arr = slotsByMuscle.get(ex.primaryMuscle) ?? [];
      arr.push({ key: `${dayIndex}:${slotIndex}`, exercise: ex });
      slotsByMuscle.set(ex.primaryMuscle, arr);
    });
  });

  const muscleOrder = [
    ...prioritizedFirst,
    ...Object.keys(targets).filter((m) => !prioritizedFirst.includes(m)),
  ];
  // Nunca apilar más de este extra en un mismo slot/sesión: aunque el objetivo
  // semanal pida más, una sesión con 9+ series del mismo ejercicio es basura.
  const maxPerSlot = rules.volumeRamp.maxExtraSetsPerSlotPerWeek;

  for (const muscle of muscleOrder) {
    const slots = slotsByMuscle.get(muscle);
    if (!slots || slots.length === 0) continue;
    let needed = Math.round((targets[muscle] ?? 0) - (current[muscle] ?? 0));
    let rr = 0;
    let guard = 0;
    while (needed >= 1 && guard < 100) {
      guard++;
      const { key, exercise } = slots[rr % slots.length];
      rr++;
      if ((extra.get(key) ?? 0) >= maxPerSlot) {
        // slot lleno: si ya dimos la vuelta completa, no hay dónde poner más
        if (slots.every((s) => (extra.get(s.key) ?? 0) >= maxPerSlot)) break;
        continue;
      }
      // Comprobar que añadir 1 set no lleva a NINGÚN músculo afectado por encima de su MRV.
      const affected = [exercise.primaryMuscle, ...exercise.secondaryMuscles];
      const violates = affected.some((m) => {
        let lm;
        try {
          lm = effectiveLandmarks(rules, profile, m);
        } catch {
          return false;
        }
        const weight =
          m === exercise.primaryMuscle
            ? rules.volumeCounting.directSetWeight
            : rules.volumeCounting.synergistSetWeight;
        return (current[m] ?? 0) + weight > lm.mrv;
      });
      if (violates) {
        // Probar el resto de slots antes de rendirse.
        if (rr - 1 >= slots.length * 2) break;
        continue;
      }
      extra.set(key, (extra.get(key) ?? 0) + 1);
      addExerciseVolume(current, exercise, 1, rules);
      needed--;
    }
  }
  return extra;
}

function buildDeloadWeek(
  week1: PlannedWeek,
  lastWeek: PlannedWeek,
  exercisesById: Map<string, Exercise>,
  profile: ExperienceProfileId,
  rules: Rules,
  numAccumulationWeeks: number,
  rirBand?: RirBand,
): PlannedWeek {
  const d = rules.deloadStructure;

  // Factor de sets por músculo: llevar el volumen a ~MEV (o la fracción fallback).
  const factorByMuscle: Record<string, number> = {};
  for (const [muscle, vol] of Object.entries(lastWeek.targetVolumeByMuscle)) {
    if (vol <= 0) continue;
    let f = d.volumeFractionFallback;
    try {
      const lm = effectiveLandmarks(rules, profile, muscle);
      f = Math.min(d.volumeFractionFallback, lm.mev / vol);
    } catch {
      // músculo sin landmarks: usar el fallback
    }
    factorByMuscle[muscle] = Math.min(1, f);
  }

  const days: PlannedDay[] = week1.days.map((day) => ({
    label: `${day.label} (deload)`,
    ...(day.intensity ? { intensity: day.intensity } : {}),
    slots: day.slots.map((slot) => {
      const ex = exercisesById.get(slot.exerciseId);
      const f = ex ? (factorByMuscle[ex.primaryMuscle] ?? d.volumeFractionFallback) : d.volumeFractionFallback;
      return {
        exerciseId: slot.exerciseId,
        ...(slot.supersetGroup ? { supersetGroup: slot.supersetGroup } : {}),
        sets: Math.max(1, Math.floor(slot.sets * f)),
        repRange: {
          min: Math.max(1, Math.round(slot.repRange.min * d.repsFraction)),
          max: Math.max(1, Math.round(slot.repRange.max * d.repsFraction)),
        },
        // El deload también respeta la banda del meso (ej. 1–3 → RIR 3).
        targetRir: rirBand ? Math.min(rirBand.max, Math.max(rirBand.min, d.targetRir)) : d.targetRir,
        targetLoadKg: slot.targetLoadKg, // carga de semana 1; la 2ª mitad usa la fracción de la política
      };
    }),
  }));

  const vol = emptyVolume(rules);
  for (const day of days) {
    for (const slot of day.slots) {
      const ex = exercisesById.get(slot.exerciseId);
      if (ex) addExerciseVolume(vol, ex, slot.sets, rules);
    }
  }

  return {
    weekIndex: numAccumulationWeeks,
    isDeload: true,
    days,
    targetVolumeByMuscle: vol,
    deloadLoadPolicy: { firstHalf: "week1_load", secondHalfFraction: d.loadSecondHalf },
  };
}

/**
 * Cambia el ejercicio de un slot en el plan desde `fromWeekIndex` en adelante
 * (deload incluido), conservando series, rango, RIR y carga planificada. Las
 * semanas ya entrenadas no se tocan: su historial sigue apuntando al ejercicio
 * que se hizo. Puro: devuelve un plan nuevo.
 */
export function swapExerciseInPlan(
  plan: MesocyclePlan,
  dayIndex: number,
  slotIndex: number,
  exerciseId: string,
  fromWeekIndex: number,
): MesocyclePlan {
  return {
    ...plan,
    weeks: plan.weeks.map((w) =>
      w.weekIndex < fromWeekIndex
        ? w
        : {
            ...w,
            days: w.days.map((d, di) =>
              di !== dayIndex
                ? d
                : { ...d, slots: d.slots.map((sl, si) => (si === slotIndex ? { ...sl, exerciseId } : sl)) },
            ),
          },
    ),
  };
}
