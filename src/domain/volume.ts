// Conteo de volumen en sets fraccionados: set directo = directSetWeight (1.0),
// set donde el músculo es sinergista = synergistSetWeight (0.5). Pelland 2026.

import type { Rules } from "./rules";
import type { BaseWeek, Exercise } from "./types";

export type VolumeByMuscle = Record<string, number>;

export function emptyVolume(rules: Rules): VolumeByMuscle {
  const v: VolumeByMuscle = {};
  for (const m of rules.muscles) v[m] = 0;
  return v;
}

/** Añade el volumen fraccionado de `sets` series de un ejercicio al acumulador. */
export function addExerciseVolume(
  acc: VolumeByMuscle,
  exercise: Exercise,
  sets: number,
  rules: Rules,
): void {
  const direct = rules.volumeCounting.directSetWeight;
  const syn = rules.volumeCounting.synergistSetWeight;
  acc[exercise.primaryMuscle] = (acc[exercise.primaryMuscle] ?? 0) + sets * direct;
  for (const m of exercise.secondaryMuscles) {
    acc[m] = (acc[m] ?? 0) + sets * syn;
  }
}

/** Volumen semanal fraccionado por músculo de una semana base. */
export function weeklyVolumeByMuscle(
  baseWeek: BaseWeek,
  exercisesById: Map<string, Exercise>,
  rules: Rules,
): VolumeByMuscle {
  const acc = emptyVolume(rules);
  for (const day of baseWeek.days) {
    for (const slot of day.slots) {
      const ex = exercisesById.get(slot.exerciseId);
      if (!ex) continue;
      addExerciseVolume(acc, ex, slot.targetSets, rules);
    }
  }
  return acc;
}

/**
 * Series fraccionadas por músculo de UN día (A2.5). Sirve para avisar cuando
 * un músculo pasa `softSessionCapFractionalSets` en una sola sesión (heurístico).
 */
export function sessionVolumeByMuscle(
  day: { slots: Array<{ exerciseId: string; targetSets: number }> },
  exercisesById: Map<string, Exercise>,
  rules: Rules,
): VolumeByMuscle {
  const acc = emptyVolume(rules);
  for (const slot of day.slots) {
    const ex = exercisesById.get(slot.exerciseId);
    if (ex) addExerciseVolume(acc, ex, slot.targetSets, rules);
  }
  return acc;
}

/** Músculos que superan el tope blando por sesión en un día (A2.5). */
export function sessionCapWarnings(
  day: { slots: Array<{ exerciseId: string; targetSets: number }> },
  exercisesById: Map<string, Exercise>,
  rules: Rules,
): Array<{ muscle: string; sets: number }> {
  const cap = rules.volumeCounting.softSessionCapFractionalSets;
  const vol = sessionVolumeByMuscle(day, exercisesById, rules);
  return Object.entries(vol)
    .filter(([, v]) => v > cap)
    .map(([muscle, v]) => ({ muscle, sets: Math.round(v * 10) / 10 }))
    .sort((a, b) => b.sets - a.sets);
}
