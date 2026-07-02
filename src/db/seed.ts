// Datos iniciales: una biblioteca básica de ejercicios y settings por defecto,
// para que la app sea usable desde el primer arranque sin configuración manual.

import type { Exercise } from "@/domain/types";
import { getRules } from "@/lib/rulesLoader";
import type { SettingsRow } from "./schema";

export function defaultSettings(): SettingsRow {
  const rules = getRules();
  return {
    id: "default",
    experienceProfile: "intermediate",
    bodyweightKg: 80,
    proteinTargetGperKg: rules.nutrition.proteinFloorGperKg,
    minSleepHours: rules.sleep.defaultMinimumHours,
    prioritizedMuscles: [],
    equipment: {
      barWeightKg: rules.loadIncrements.defaultBarWeightKg,
      platesKg: [...rules.loadIncrements.commonPlatesKg],
      dumbbellsKg: [...rules.loadIncrements.commonDumbbellsKg],
      machineStepKg: rules.loadIncrements.machineStepKg,
    },
    wakeLockEnabled: true,
    onboarded: false,
  };
}

export const seedExercises: Exercise[] = [
  ex("bench-bb", "Press banca con barra", "chest", ["triceps", "front_delts"], "barbell", "mid", true, ["bench-db", "chest-press-machine"]),
  ex("bench-db", "Press banca con mancuernas", "chest", ["triceps", "front_delts"], "dumbbell", "stretch", true, ["bench-bb"]),
  ex("incline-db", "Press inclinado con mancuernas", "chest", ["front_delts", "triceps"], "dumbbell", "stretch", true, ["bench-bb"]),
  ex("cable-fly", "Aperturas en polea", "chest", [], "cable", "stretch", true, ["incline-db"]),
  ex("chest-press-machine", "Press de pecho en máquina", "chest", ["triceps", "front_delts"], "machine", "mid", true, ["bench-bb"]),

  ex("row-bb", "Remo con barra", "back", ["biceps", "rear_delts"], "barbell", "mid", true, ["row-db", "lat-pulldown"]),
  ex("row-db", "Remo con mancuerna", "back", ["biceps", "rear_delts"], "dumbbell", "stretch", true, ["row-bb"]),
  ex("lat-pulldown", "Jalón al pecho", "back", ["biceps"], "cable", "stretch", true, ["pullup"]),
  ex("pullup", "Dominadas", "back", ["biceps"], "bodyweight", "stretch", true, ["lat-pulldown"]),

  ex("squat-bb", "Sentadilla con barra", "quads", ["glutes"], "barbell", "stretch", false, []),
  ex("leg-press", "Prensa de piernas", "quads", ["glutes"], "machine", "mid", true, ["squat-bb"]),
  ex("leg-ext", "Extensión de cuádriceps", "quads", [], "machine", "short", true, ["leg-press"]),
  ex("rdl", "Peso muerto rumano", "hamstrings", ["glutes"], "barbell", "stretch", true, ["leg-curl"]),
  ex("leg-curl", "Curl femoral", "hamstrings", [], "machine", "mid", true, ["rdl"]),
  ex("hip-thrust", "Hip thrust", "glutes", ["hamstrings"], "barbell", "short", true, []),

  ex("ohp-bb", "Press militar con barra", "front_delts", ["triceps", "side_delts"], "barbell", "mid", true, ["ohp-db"]),
  ex("ohp-db", "Press de hombros con mancuernas", "front_delts", ["triceps", "side_delts"], "dumbbell", "stretch", true, ["ohp-bb"]),
  ex("lateral-raise", "Elevaciones laterales", "side_delts", [], "dumbbell", "mid", true, ["cable-lateral"]),
  ex("cable-lateral", "Elevación lateral en polea", "side_delts", [], "cable", "stretch", true, ["lateral-raise"]),
  ex("rear-fly", "Pájaros / rear delt fly", "rear_delts", [], "dumbbell", "mid", true, ["face-pull"]),
  ex("face-pull", "Face pull", "rear_delts", [], "cable", "mid", true, ["rear-fly"]),

  ex("curl-db", "Curl con mancuernas", "biceps", ["forearms"], "dumbbell", "mid", true, ["curl-cable"]),
  ex("curl-cable", "Curl en polea", "biceps", ["forearms"], "cable", "stretch", true, ["curl-db"]),
  ex("incline-curl", "Curl inclinado", "biceps", ["forearms"], "dumbbell", "stretch", true, ["curl-db"]),
  ex("triceps-pushdown", "Extensión de tríceps en polea", "triceps", [], "cable", "short", true, ["overhead-ext"]),
  ex("overhead-ext", "Extensión de tríceps sobre la cabeza", "triceps", [], "cable", "stretch", true, ["triceps-pushdown"]),

  ex("calf-raise", "Elevación de gemelos", "calves", [], "machine", "stretch", true, []),
  ex("crunch", "Crunch en polea", "abs", [], "cable", "mid", true, []),
];

function ex(
  id: string,
  name: string,
  primaryMuscle: string,
  secondaryMuscles: string[],
  equipmentType: Exercise["equipmentType"],
  resistanceProfile: Exercise["resistanceProfile"],
  isSwappable: boolean,
  swapCandidates: string[],
): Exercise {
  return { id, name, primaryMuscle, secondaryMuscles, equipmentType, resistanceProfile, isSwappable, swapCandidates };
}
