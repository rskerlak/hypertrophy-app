// Utilidades de formato no científicas.

export function fmtKg(kg: number): string {
  return Number.isInteger(kg) ? `${kg}` : kg.toFixed(kg * 2 === Math.round(kg * 2) ? 1 : 2);
}

export { fmtLoad, unitLabel } from "./units";

export function fmtSets(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

const MUSCLE_ES: Record<string, string> = {
  chest: "Pecho",
  back: "Espalda",
  quads: "Cuádriceps",
  hamstrings: "Femorales",
  glutes: "Glúteos",
  side_delts: "Deltoides laterales",
  front_delts: "Deltoides anteriores",
  rear_delts: "Deltoides posteriores",
  biceps: "Bíceps",
  triceps: "Tríceps",
  calves: "Gemelos",
  abs: "Abdomen",
  traps: "Trapecios",
  forearms: "Antebrazos",
  adductors: "Aductores",
};

export function muscleLabel(m: string): string {
  return MUSCLE_ES[m] ?? m;
}

export const PROGRESSION_LABELS: Record<string, string> = {
  linear: "Lineal",
  double: "Doble progresión",
  dup: "Ondulante (DUP)",
  block: "Bloques",
};

export const PROFILE_LABELS: Record<string, string> = {
  novice: "Novato",
  intermediate: "Medio",
  advanced: "Avanzado",
};

export const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: "Barra",
  dumbbell: "Mancuernas",
  machine: "Máquina",
  cable: "Polea",
  bodyweight: "Peso corporal",
};

export const RESISTANCE_LABELS: Record<string, string> = {
  stretch: "Estiramiento",
  mid: "Media",
  short: "Acortada",
};

export const MEASUREMENT_LABELS: Record<string, string> = {
  bodyweightKg: "Peso (kg)",
  waistCm: "Cintura (cm)",
  chestUnderShouldersCm: "Torso bajo hombros (cm)",
  shoulderGirthCm: "Torso con hombros (cm)",
  bicepCm: "Bíceps (cm)",
  quadCm: "Cuádriceps (cm)",
  calfCm: "Gemelo (cm)",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  running: "Correr",
  swimming: "Natación",
  cycling: "Bici",
  walking: "Caminata",
  sport: "Deporte",
  other: "Otra",
  strength_external: "Fuerza (reloj)",
};

/** A5.6: icono por tipo para la Agenda. */
export const ACTIVITY_ICONS: Record<string, string> = {
  running: "🏃",
  swimming: "🏊",
  cycling: "🚴",
  walking: "🚶",
  sport: "⚽",
  other: "✦",
  strength_external: "🏋️",
};

export const ACTIVITY_SOURCE_LABELS: Record<string, string> = { strava: "Strava", garmin: "Garmin" };

export const CORRELATION_LABELS: Record<string, string> = {
  d1rmPct: "Δ 1RM %",
  adherencePct: "Adherencia %",
  sleepOkPct: "Sueño OK %",
  proteinOkPct: "Proteína OK %",
  energyBalanceAvg: "Balance energético",
  extraSessionsPerWeek: "Extra ses/sem",
  extraMinutesPerWeek: "Extra min/sem",
  d_bodyweightKg: "Δ Peso",
  d_waistCm: "Δ Cintura",
  d_chestUnderShouldersCm: "Δ Torso s/h",
  d_shoulderGirthCm: "Δ Torso c/h",
  d_bicepCm: "Δ Bíceps",
  d_quadCm: "Δ Cuádriceps",
  d_calfCm: "Δ Gemelo",
};

/** Qué significa cada intención (selector al generar el meso). */
export const INTENT_HINTS: Record<keyof typeof INTENT_LABELS, string> = {
  hypertrophy: "Lo habitual: se espera que el 1RM estimado suba de meso a meso.",
  strength: "Bloque orientado a cargas altas; se compara contra otros mesos de rango parecido.",
  maintenance: "Para no perder (vacaciones, otro deporte en foco): un meso plano es lo esperado y no cuenta como estancamiento.",
  recovery: "Volver de un dolor o una pausa: tampoco cuenta como estancamiento.",
};

/** Intención declarada del meso (A5.3). */
export const INTENT_LABELS: Record<"hypertrophy" | "strength" | "maintenance" | "recovery", string> = {
  hypertrophy: "Hipertrofia",
  strength: "Fuerza",
  maintenance: "Mantenimiento",
  recovery: "Recuperación",
};

/** Zonas de dolor (A5.5). Lenguaje de lugar, nunca de lesión. */
export const PAIN_ZONE_LABELS: Record<"shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "lower_back" | "neck" | "other", string> = {
  shoulder: "Hombro",
  elbow: "Codo",
  wrist: "Muñeca",
  hip: "Cadera",
  knee: "Rodilla",
  ankle: "Tobillo",
  lower_back: "Zona lumbar",
  neck: "Cuello",
  other: "Otra",
};

export const PAIN_OPTION_LABELS: Record<"load-down-reps-up" | "rir-plus-one" | "swap-candidate" | "exercise-deload", string> = {
  "load-down-reps-up": "Bajar carga y subir reps",
  "rir-plus-one": "Dejar una rep más en reserva (RIR +1)",
  "swap-candidate": "Cambiar a una variante que no cargue esa zona",
  "exercise-deload": "Deload de este ejercicio la próxima vez",
};
