// Fixtures compartidas para los tests del motor. Usan el rules.config.json real.

import rulesJson from "../../../rules.config.json";
import { parseRules } from "../rules";
import type { BaseWeek, Equipment, Exercise, SetLog } from "../types";

export const rules = parseRules(rulesJson);

export const equipment: Equipment = {
  barWeightKg: 20,
  platesKg: [1.25, 2.5, 5, 10, 15, 20, 25],
  dumbbellsKg: [2, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30],
  machineStepKg: 5,
};

export const equipmentNoSmallPlates: Equipment = {
  ...equipment,
  platesKg: [2.5, 5, 10, 15, 20, 25],
};

export const exercises: Exercise[] = [
  {
    id: "bench",
    name: "Press banca",
    primaryMuscle: "chest",
    secondaryMuscles: ["triceps", "front_delts"],
    equipmentType: "barbell",
    resistanceProfile: "mid",
    isSwappable: true,
    swapCandidates: ["db-press", "fly"],
  },
  {
    id: "db-press",
    name: "Press con mancuernas",
    primaryMuscle: "chest",
    secondaryMuscles: ["triceps", "front_delts"],
    equipmentType: "dumbbell",
    resistanceProfile: "stretch",
    isSwappable: true,
    swapCandidates: ["bench"],
  },
  {
    id: "fly",
    name: "Aperturas en polea",
    primaryMuscle: "chest",
    secondaryMuscles: [],
    equipmentType: "cable",
    resistanceProfile: "stretch",
    isSwappable: true,
    swapCandidates: ["db-press"],
  },
  {
    id: "row",
    name: "Remo con barra",
    primaryMuscle: "back",
    secondaryMuscles: ["biceps", "rear_delts"],
    equipmentType: "barbell",
    resistanceProfile: "mid",
    isSwappable: false,
    swapCandidates: [],
  },
  {
    id: "squat",
    name: "Sentadilla",
    primaryMuscle: "quads",
    secondaryMuscles: ["glutes"],
    equipmentType: "barbell",
    resistanceProfile: "stretch",
    isSwappable: false,
    swapCandidates: [],
  },
  {
    id: "curl",
    name: "Curl con mancuernas",
    primaryMuscle: "biceps",
    secondaryMuscles: ["forearms"],
    equipmentType: "dumbbell",
    resistanceProfile: "mid",
    isSwappable: true,
    swapCandidates: [],
  },
];

export const exercisesById = new Map(exercises.map((e) => [e.id, e]));

export const baseWeek: BaseWeek = {
  days: [
    {
      label: "Día A",
      slots: [
        { exerciseId: "bench", targetSets: 3, repRange: { min: 5, max: 10 }, startingLoadKg: 80 },
        { exerciseId: "row", targetSets: 3, repRange: { min: 8, max: 12 }, startingLoadKg: 70 },
        { exerciseId: "curl", targetSets: 2, repRange: { min: 10, max: 15 }, startingLoadKg: 14 },
      ],
    },
    {
      label: "Día B",
      slots: [
        { exerciseId: "squat", targetSets: 3, repRange: { min: 5, max: 10 }, startingLoadKg: 100 },
        { exerciseId: "db-press", targetSets: 3, repRange: { min: 8, max: 12 }, startingLoadKg: 26 },
        { exerciseId: "fly", targetSets: 2, repRange: { min: 10, max: 20 }, startingLoadKg: 25 },
      ],
    },
  ],
};

let logCounter = 0;

/** Crea logs de una sesión con las mismas reps/carga/RIR en todas las series. */
export function sessionLogs(args: {
  sessionId: string;
  exerciseId: string;
  sets: number;
  loadKg: number;
  reps: number;
  rir: number;
  targetReps?: number;
  targetRir?: number;
  timestamp: string;
}): SetLog[] {
  const out: SetLog[] = [];
  for (let i = 0; i < args.sets; i++) {
    out.push({
      id: `log-${logCounter++}`,
      sessionId: args.sessionId,
      exerciseId: args.exerciseId,
      setIndex: i,
      targetLoadKg: args.loadKg,
      targetReps: args.targetReps ?? args.reps,
      targetRir: args.targetRir ?? args.rir,
      actualLoadKg: args.loadKg,
      actualReps: args.reps,
      actualRir: args.rir,
      timestamp: args.timestamp,
    });
  }
  return out;
}
