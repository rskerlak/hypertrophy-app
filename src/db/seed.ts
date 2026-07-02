// Datos iniciales: biblioteca de ejercicios y settings por defecto, para que la
// app sea usable desde el primer arranque sin configuración manual.
//
// Convención de nombres (pedido del usuario): el nombre PRINCIPAL del ejercicio
// y de la máquina va en inglés (estándar del fitness); la traducción al español
// va entre paréntesis. El resto de la app está en español.

import type { Exercise, EquipmentType, ResistanceProfile } from "@/domain/types";
import { getRules } from "@/lib/rulesLoader";
import type { SettingsRow } from "./schema";

/** Bump para forzar re-seed de la biblioteca de ejercicios tras cambios aquí. */
export const SEED_VERSION = 3;

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
    seedVersion: SEED_VERSION,
  };
}

// [id, nombre (EN (ES)), músculo primario, secundarios, equipo, perfil, ¿swappable?]
type Raw = [string, string, string, string[], EquipmentType, ResistanceProfile, boolean];

const RAW: Raw[] = [
  // ---------------- CHEST / Pecho ----------------
  ["bb-bench-press", "Barbell Bench Press (Press de banca con barra)", "chest", ["triceps", "front_delts"], "barbell", "mid", false],
  ["incline-bb-press", "Incline Barbell Press (Press inclinado con barra)", "chest", ["front_delts", "triceps"], "barbell", "mid", true],
  ["decline-bb-press", "Decline Barbell Press (Press declinado con barra)", "chest", ["triceps"], "barbell", "mid", true],
  ["db-bench-press", "Dumbbell Bench Press (Press de banca con mancuernas)", "chest", ["triceps", "front_delts"], "dumbbell", "stretch", true],
  ["incline-db-press", "Incline Dumbbell Press (Press inclinado con mancuernas)", "chest", ["front_delts", "triceps"], "dumbbell", "stretch", true],
  ["decline-db-press", "Decline Dumbbell Press (Press declinado con mancuernas)", "chest", ["triceps"], "dumbbell", "stretch", true],
  ["machine-chest-press", "Machine Chest Press (Press de pecho en máquina)", "chest", ["triceps", "front_delts"], "machine", "mid", true],
  ["incline-machine-press", "Incline Machine Press (Press inclinado en máquina)", "chest", ["front_delts", "triceps"], "machine", "mid", true],
  ["smith-bench-press", "Smith Machine Bench Press (Press de banca en Smith)", "chest", ["triceps", "front_delts"], "machine", "mid", true],
  ["pec-deck", "Pec Deck Fly (Contractora de pecho)", "chest", [], "machine", "short", true],
  ["high-cable-fly", "High Cable Fly (Cruce de poleas alto)", "chest", [], "cable", "mid", true],
  ["low-cable-fly", "Low Cable Fly (Cruce de poleas bajo)", "chest", [], "cable", "stretch", true],
  ["db-fly", "Dumbbell Fly (Aperturas con mancuernas)", "chest", [], "dumbbell", "stretch", true],
  ["incline-db-fly", "Incline Dumbbell Fly (Aperturas inclinadas con mancuernas)", "chest", [], "dumbbell", "stretch", true],
  ["chest-dip", "Chest Dip (Fondos en paralelas para pecho)", "chest", ["triceps", "front_delts"], "bodyweight", "stretch", true],
  ["push-up", "Push-Up (Flexiones)", "chest", ["triceps", "front_delts"], "bodyweight", "mid", true],

  // ---------------- BACK / Espalda ----------------
  ["deadlift", "Deadlift (Peso muerto)", "back", ["hamstrings", "glutes", "traps"], "barbell", "mid", false],
  ["bb-row", "Barbell Row (Remo con barra)", "back", ["biceps", "rear_delts"], "barbell", "mid", false],
  ["pendlay-row", "Pendlay Row (Remo Pendlay)", "back", ["biceps", "rear_delts"], "barbell", "mid", true],
  ["db-row", "Dumbbell Row (Remo con mancuerna)", "back", ["biceps", "rear_delts"], "dumbbell", "stretch", true],
  ["t-bar-row", "T-Bar Row (Remo en T)", "back", ["biceps", "rear_delts"], "machine", "mid", true],
  ["chest-supported-row", "Chest-Supported Row (Remo con apoyo de pecho)", "back", ["biceps", "rear_delts"], "machine", "mid", true],
  ["seated-cable-row", "Seated Cable Row (Remo sentado en polea)", "back", ["biceps", "rear_delts"], "cable", "mid", true],
  ["machine-row", "Machine Row (Remo en máquina)", "back", ["biceps", "rear_delts"], "machine", "mid", true],
  ["lat-pulldown", "Lat Pulldown (Jalón al pecho)", "back", ["biceps"], "cable", "stretch", true],
  ["wide-grip-pulldown", "Wide-Grip Lat Pulldown (Jalón agarre ancho)", "back", ["biceps"], "cable", "stretch", true],
  ["close-grip-pulldown", "Close-Grip Lat Pulldown (Jalón agarre cerrado)", "back", ["biceps"], "cable", "stretch", true],
  ["pull-up", "Pull-Up (Dominadas pronas)", "back", ["biceps"], "bodyweight", "stretch", true],
  ["chin-up", "Chin-Up (Dominadas supinas)", "back", ["biceps"], "bodyweight", "stretch", true],
  ["straight-arm-pulldown", "Straight-Arm Pulldown (Jalón con brazos rectos)", "back", [], "cable", "stretch", true],
  ["machine-pullover", "Machine Pullover (Pullover en máquina)", "back", [], "machine", "stretch", true],
  ["back-extension", "Back Extension (Espinales en banco)", "back", ["glutes", "hamstrings"], "machine", "stretch", true],

  // ---------------- TRAPS / Trapecios ----------------
  ["bb-shrug", "Barbell Shrug (Encogimientos con barra)", "traps", [], "barbell", "short", true],
  ["db-shrug", "Dumbbell Shrug (Encogimientos con mancuernas)", "traps", [], "dumbbell", "short", true],
  ["machine-shrug", "Machine Shrug (Encogimientos en máquina)", "traps", [], "machine", "short", true],

  // ---------------- QUADS / Cuádriceps ----------------
  ["back-squat", "Barbell Back Squat (Sentadilla con barra)", "quads", ["glutes", "hamstrings"], "barbell", "stretch", false],
  ["front-squat", "Front Squat (Sentadilla frontal)", "quads", ["glutes"], "barbell", "stretch", true],
  ["hack-squat", "Hack Squat (Sentadilla hack)", "quads", ["glutes"], "machine", "stretch", true],
  ["pendulum-squat", "Pendulum Squat (Sentadilla pendular)", "quads", ["glutes"], "machine", "stretch", true],
  ["leg-press", "Leg Press (Prensa de piernas)", "quads", ["glutes"], "machine", "mid", true],
  ["leg-extension", "Leg Extension (Extensión de cuádriceps)", "quads", [], "machine", "short", true],
  ["smith-squat", "Smith Machine Squat (Sentadilla en Smith)", "quads", ["glutes"], "machine", "stretch", true],
  ["goblet-squat", "Goblet Squat (Sentadilla goblet)", "quads", ["glutes"], "dumbbell", "stretch", true],
  ["bulgarian-split-squat", "Bulgarian Split Squat (Sentadilla búlgara)", "quads", ["glutes"], "dumbbell", "stretch", true],
  ["walking-lunge", "Walking Lunge (Zancadas caminando)", "quads", ["glutes"], "dumbbell", "stretch", true],
  ["leg-press-machine-quads", "Vertical Leg Press (Prensa vertical)", "quads", ["glutes"], "machine", "mid", true],

  // ---------------- HAMSTRINGS / Femorales ----------------
  ["romanian-deadlift", "Romanian Deadlift (Peso muerto rumano)", "hamstrings", ["glutes"], "barbell", "stretch", true],
  ["stiff-leg-deadlift", "Stiff-Legged Deadlift (Peso muerto piernas rígidas)", "hamstrings", ["glutes"], "barbell", "stretch", true],
  ["lying-leg-curl", "Lying Leg Curl (Curl femoral tumbado)", "hamstrings", [], "machine", "mid", true],
  ["seated-leg-curl", "Seated Leg Curl (Curl femoral sentado)", "hamstrings", [], "machine", "stretch", true],
  ["nordic-curl", "Nordic Ham Curl (Curl nórdico)", "hamstrings", [], "bodyweight", "stretch", true],
  ["good-morning", "Good Morning (Buenos días)", "hamstrings", ["glutes"], "barbell", "stretch", true],
  ["cable-pull-through", "Cable Pull-Through (Empuje de cadera en polea)", "hamstrings", ["glutes"], "cable", "stretch", true],

  // ---------------- GLUTES / Glúteos ----------------
  ["hip-thrust", "Barbell Hip Thrust (Empuje de cadera con barra)", "glutes", ["hamstrings"], "barbell", "short", true],
  ["machine-hip-thrust", "Machine Hip Thrust (Hip thrust en máquina)", "glutes", ["hamstrings"], "machine", "short", true],
  ["glute-bridge", "Glute Bridge (Puente de glúteos)", "glutes", ["hamstrings"], "barbell", "short", true],
  ["cable-kickback", "Cable Glute Kickback (Patada de glúteo en polea)", "glutes", [], "cable", "short", true],
  ["hip-abduction", "Hip Abduction Machine (Máquina de abductores)", "glutes", [], "machine", "short", true],

  // ---------------- ADDUCTORS / Aductores ----------------
  ["hip-adduction", "Hip Adduction Machine (Máquina de aductores)", "adductors", [], "machine", "short", true],
  ["sumo-deadlift", "Sumo Deadlift (Peso muerto sumo)", "glutes", ["quads", "back", "hamstrings"], "barbell", "mid", true],

  // ---------------- SIDE DELTS / Deltoides laterales ----------------
  ["db-lateral-raise", "Dumbbell Lateral Raise (Elevaciones laterales con mancuernas)", "side_delts", [], "dumbbell", "mid", true],
  ["cable-lateral-raise", "Cable Lateral Raise (Elevación lateral en polea)", "side_delts", [], "cable", "stretch", true],
  ["machine-lateral-raise", "Machine Lateral Raise (Elevación lateral en máquina)", "side_delts", [], "machine", "mid", true],
  ["upright-row", "Upright Row (Remo al mentón)", "side_delts", ["traps", "front_delts"], "barbell", "mid", true],

  // ---------------- FRONT DELTS / Deltoides anteriores ----------------
  ["overhead-press", "Overhead Press (Press militar con barra)", "front_delts", ["triceps", "side_delts"], "barbell", "mid", false],
  ["db-shoulder-press", "Dumbbell Shoulder Press (Press de hombros con mancuernas)", "front_delts", ["triceps", "side_delts"], "dumbbell", "stretch", true],
  ["machine-shoulder-press", "Machine Shoulder Press (Press de hombros en máquina)", "front_delts", ["triceps", "side_delts"], "machine", "mid", true],
  ["arnold-press", "Arnold Press (Press Arnold)", "front_delts", ["triceps", "side_delts"], "dumbbell", "mid", true],
  ["smith-shoulder-press", "Smith Machine Shoulder Press (Press de hombros en Smith)", "front_delts", ["triceps", "side_delts"], "machine", "mid", true],
  ["front-raise", "Front Raise (Elevaciones frontales)", "front_delts", [], "dumbbell", "mid", true],

  // ---------------- REAR DELTS / Deltoides posteriores ----------------
  ["reverse-pec-deck", "Reverse Pec Deck (Contractora inversa)", "rear_delts", [], "machine", "mid", true],
  ["db-rear-delt-fly", "Dumbbell Rear Delt Fly (Pájaros con mancuernas)", "rear_delts", [], "dumbbell", "mid", true],
  ["face-pull", "Face Pull (Jalón a la cara)", "rear_delts", ["traps"], "cable", "mid", true],
  ["cable-rear-delt-fly", "Cable Rear Delt Fly (Aperturas posteriores en polea)", "rear_delts", [], "cable", "mid", true],

  // ---------------- BICEPS / Bíceps ----------------
  ["bb-curl", "Barbell Curl (Curl con barra)", "biceps", ["forearms"], "barbell", "mid", true],
  ["ez-bar-curl", "EZ-Bar Curl (Curl con barra Z)", "biceps", ["forearms"], "barbell", "mid", true],
  ["db-curl", "Dumbbell Curl (Curl con mancuernas)", "biceps", ["forearms"], "dumbbell", "mid", true],
  ["incline-db-curl", "Incline Dumbbell Curl (Curl inclinado con mancuernas)", "biceps", ["forearms"], "dumbbell", "stretch", true],
  ["hammer-curl", "Hammer Curl (Curl martillo)", "biceps", ["forearms"], "dumbbell", "mid", true],
  ["preacher-curl", "Preacher Curl (Curl predicador)", "biceps", ["forearms"], "barbell", "short", true],
  ["machine-preacher-curl", "Machine Preacher Curl (Curl predicador en máquina)", "biceps", ["forearms"], "machine", "short", true],
  ["cable-curl", "Cable Curl (Curl en polea)", "biceps", ["forearms"], "cable", "mid", true],
  ["concentration-curl", "Concentration Curl (Curl concentrado)", "biceps", [], "dumbbell", "short", true],

  // ---------------- TRICEPS / Tríceps ----------------
  ["close-grip-bench", "Close-Grip Bench Press (Press cerrado)", "triceps", ["chest", "front_delts"], "barbell", "mid", true],
  ["triceps-pushdown", "Triceps Pushdown (Extensión de tríceps en polea)", "triceps", [], "cable", "short", true],
  ["rope-pushdown", "Rope Triceps Pushdown (Extensión con soga)", "triceps", [], "cable", "short", true],
  ["overhead-cable-ext", "Overhead Cable Triceps Extension (Extensión sobre la cabeza en polea)", "triceps", [], "cable", "stretch", true],
  ["skull-crusher", "Skull Crusher (Rompecráneos)", "triceps", [], "barbell", "stretch", true],
  ["db-overhead-ext", "Dumbbell Overhead Extension (Extensión con mancuerna)", "triceps", [], "dumbbell", "stretch", true],
  ["triceps-dip", "Triceps Dip (Fondos para tríceps)", "triceps", ["chest"], "bodyweight", "mid", true],
  ["machine-triceps-ext", "Machine Triceps Extension (Extensión de tríceps en máquina)", "triceps", [], "machine", "short", true],

  // ---------------- CALVES / Gemelos ----------------
  ["standing-calf-raise", "Standing Calf Raise (Elevación de gemelos de pie)", "calves", [], "machine", "stretch", true],
  ["seated-calf-raise", "Seated Calf Raise (Elevación de gemelos sentado)", "calves", [], "machine", "stretch", true],
  ["leg-press-calf-raise", "Leg Press Calf Raise (Gemelos en prensa)", "calves", [], "machine", "stretch", true],

  // ---------------- ABS / Abdomen ----------------
  ["cable-crunch", "Cable Crunch (Crunch en polea)", "abs", [], "cable", "mid", true],
  ["machine-crunch", "Machine Crunch (Crunch en máquina)", "abs", [], "machine", "mid", true],
  ["hanging-leg-raise", "Hanging Leg Raise (Elevación de piernas colgado)", "abs", [], "bodyweight", "stretch", true],
  ["ab-wheel", "Ab Wheel Rollout (Rueda abdominal)", "abs", [], "bodyweight", "stretch", true],
  ["plank", "Plank (Plancha)", "abs", [], "bodyweight", "mid", true],

  // ---------------- FOREARMS / Antebrazos ----------------
  ["wrist-curl", "Barbell Wrist Curl (Curl de muñeca con barra)", "forearms", [], "barbell", "mid", true],
  ["reverse-wrist-curl", "Reverse Wrist Curl (Curl de muñeca inverso)", "forearms", [], "barbell", "mid", true],
  ["reverse-curl", "Reverse Curl (Curl inverso)", "forearms", ["biceps"], "barbell", "mid", true],
];

/**
 * Asigna swapCandidates automáticamente: para cada ejercicio swappable, otros
 * ejercicios swappable del mismo músculo primario, priorizando perfil "stretch"
 * y distinto tipo de equipo. Máx. 5.
 */
function buildLibrary(): Exercise[] {
  const items: Exercise[] = RAW.map(([id, name, primaryMuscle, secondaryMuscles, equipmentType, resistanceProfile, isSwappable]) => ({
    id,
    name,
    primaryMuscle,
    secondaryMuscles,
    equipmentType,
    resistanceProfile,
    isSwappable,
    swapCandidates: [],
  }));

  for (const ex of items) {
    if (!ex.isSwappable) continue;
    const peers = items.filter((o) => o.id !== ex.id && o.primaryMuscle === ex.primaryMuscle);
    peers.sort((a, b) => {
      const stretch = (x: Exercise) => (x.resistanceProfile === "stretch" ? 0 : 1);
      const diffEquip = (x: Exercise) => (x.equipmentType !== ex.equipmentType ? 0 : 1);
      return stretch(a) - stretch(b) || diffEquip(a) - diffEquip(b);
    });
    ex.swapCandidates = peers.slice(0, 5).map((p) => p.id);
  }
  return items;
}

export const seedExercises: Exercise[] = buildLibrary();
