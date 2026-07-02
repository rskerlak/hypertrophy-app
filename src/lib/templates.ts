// Rutinas precargadas: sirven de base editable para la semana base, para no
// arrancar de cero. Referencian ejercicios de la biblioteca (src/db/seed.ts).

import type { BaseWeekDay, RepRange } from "@/domain/types";

export interface RoutineTemplate {
  id: string;
  name: string;
  description: string;
  days: BaseWeekDay[];
}

// Rango 8–12 alrededor de las 10 reps con las que se entrena esta rutina.
const R: RepRange = { min: 8, max: 12 };

const slot = (exerciseId: string, startingLoadKg: number, targetSets = 4) => ({
  exerciseId,
  targetSets,
  repRange: { ...R },
  startingLoadKg,
});

// Día A — Empuje. Nota: la apertura + press inclinado con mancuernas se hacen
// en superserie (una serie de cada, sin descanso entre ambas).
const DAY_A: BaseWeekDay = {
  label: "Día A · Empuje",
  slots: [
    slot("bb-bench-press", 95), // 40 kg por lado + barra de 15
    slot("incline-bb-press", 95),
    slot("incline-db-fly", 28), // superserie con el press inclinado
    slot("incline-db-press", 28),
    slot("db-lateral-raise", 16),
    slot("front-raise", 16),
    slot("db-shoulder-press", 14),
    slot("triceps-pushdown", 37.5),
    slot("db-overhead-ext", 20),
  ],
};

// Día B — Tracción.
const DAY_B: BaseWeekDay = {
  label: "Día B · Tracción",
  slots: [
    slot("wide-grip-pulldown", 80),
    slot("close-grip-pulldown", 80),
    slot("back-extension", 20),
    slot("seated-cable-row", 80),
    slot("straight-arm-pulldown", 40),
    slot("db-curl", 20),
    slot("hammer-curl", 20),
    slot("db-shrug", 20),
  ],
};

// Día C — Piernas.
const DAY_C: BaseWeekDay = {
  label: "Día C · Piernas",
  slots: [
    slot("leg-press", 300),
    slot("lying-leg-curl", 40),
    slot("leg-extension", 60),
    slot("hip-adduction", 40),
    slot("hip-abduction", 40),
    slot("machine-hip-thrust", 20),
  ],
};

const relabel = (day: BaseWeekDay, label: string): BaseWeekDay => ({
  label,
  slots: day.slots.map((s) => ({ ...s, repRange: { ...s.repRange } })),
});

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: "acb-x2",
    name: "Empuje · Piernas · Tracción ×2 (A-C-B-A-C-B)",
    description:
      "6 días: empuje (pecho/hombros/tríceps), piernas y tracción (espalda/bíceps), dos vueltas por semana. Cargas iniciales precargadas; todo editable después.",
    days: [
      relabel(DAY_A, "Día 1 · A Empuje"),
      relabel(DAY_C, "Día 2 · C Piernas"),
      relabel(DAY_B, "Día 3 · B Tracción"),
      relabel(DAY_A, "Día 4 · A Empuje"),
      relabel(DAY_C, "Día 5 · C Piernas"),
      relabel(DAY_B, "Día 6 · B Tracción"),
    ],
  },
];
