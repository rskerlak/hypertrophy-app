// generateMesocycle: dado semana base + perfil + modelo, produce el plan
// completo (semanas de acumulación con rampa de volumen + RIR por semana +
// semana de deload). Determinista.

import type { Rules } from "./rules";
import { effectiveLandmarks, rirScheduleForLength } from "./rules";
import type {
  BaseWeek,
  DupDayType,
  Exercise,
  ExperienceProfileId,
  MesocyclePlan,
  PlannedDay,
  PlannedSlot,
  PlannedWeek,
  ProgressionModel,
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
}

const DUP_CYCLE: DupDayType[] = ["heavy", "medium", "light"];

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
      }),
    );
  }

  weeks.push(buildDeloadWeek(weeks[0], weeks[N - 1], exercisesById, profile, rules, N));

  return { progressionModel, numAccumulationWeeks: N, weeks };
}

/**
 * Volumen objetivo del músculo para la semana w: rampa lineal desde el volumen
 * de partida hacia el techo del perfil (MAV, o MRV si pushToMrv), cubriendo la
 * fracción `rampAggressiveness` del gap a lo largo del meso. Si el músculo no
 * está priorizado (y hay priorizados), no rampa: se queda en su volumen base.
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
  const start = Math.max(baseVolume, 0);
  if (start === 0) return 0; // músculo no entrenado en la semana base: no inventar volumen
  if (!prioritized) return start;

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
}): PlannedWeek {
  const { baseWeek, exercisesById, baseVol, weekIndex, numAccumulationWeeks, profile, progressionModel, prioritizedMuscles, rules } = args;
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
  const days: PlannedDay[] = baseWeek.days.map((day, dayIndex) => {
    const dayType = DUP_CYCLE[dayIndex % DUP_CYCLE.length];
    const slots: PlannedSlot[] = day.slots.map((slot, slotIndex) => {
      const ex = exercisesById.get(slot.exerciseId);
      const extra = extraSetsBySlot.get(`${dayIndex}:${slotIndex}`) ?? 0;
      let repRange = slot.repRange;
      let rir = baseRir;
      let phase: string | undefined;
      let slotDayType: DupDayType | undefined;

      if (progressionModel === "dup") {
        const dt = rules.progressionModels.dup.dayTypes[dayType];
        repRange = dt.repRange;
        rir = baseRir + dt.targetRirOffset;
        slotDayType = dayType;
      } else if (progressionModel === "block") {
        const p = blockPhase(rules, weekIndex, numAccumulationWeeks);
        repRange = p.repRange;
        rir = baseRir + p.rirBias;
        phase = p.name;
      }

      // Piso de RIR en ejercicios con riesgo de barra.
      if (ex?.equipmentType === "barbell") {
        rir = Math.max(rir, rules.rirSchedule.barbellRiskFloor);
      }

      return {
        exerciseId: slot.exerciseId,
        sets: slot.targetSets + extra,
        repRange,
        targetRir: rir,
        targetLoadKg: slot.startingLoadKg,
        dayType: slotDayType,
        phase,
      };
    });
    return { label: day.label, slots };
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
    slots: day.slots.map((slot) => {
      const ex = exercisesById.get(slot.exerciseId);
      const f = ex ? (factorByMuscle[ex.primaryMuscle] ?? d.volumeFractionFallback) : d.volumeFractionFallback;
      return {
        exerciseId: slot.exerciseId,
        sets: Math.max(1, Math.floor(slot.sets * f)),
        repRange: {
          min: Math.max(1, Math.round(slot.repRange.min * d.repsFraction)),
          max: Math.max(1, Math.round(slot.repRange.max * d.repsFraction)),
        },
        targetRir: d.targetRir,
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
