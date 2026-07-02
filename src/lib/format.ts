// Utilidades de formato no científicas.

export function fmtKg(kg: number): string {
  return Number.isInteger(kg) ? `${kg}` : kg.toFixed(kg * 2 === Math.round(kg * 2) ? 1 : 2);
}

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
