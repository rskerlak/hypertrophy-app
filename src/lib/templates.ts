// Rutinas precargadas: sirven de base editable para la semana base, para no
// arrancar de cero. Referencian ejercicios de la biblioteca (src/db/seed.ts).
//
// Las cargas de estas plantillas son solo un punto de partida para quien no
// tiene historial: al aplicarlas (baseWeekRepo.applyTemplate) cada carga se
// re-estima desde el 1RM de tu última sesión real cuando existe.

import type { BaseWeekDay, RepRange } from "@/domain/types";

export interface RoutineTemplate {
  id: string;
  name: string;
  description: string;
  days: BaseWeekDay[];
}

// Rangos por rol del día. Día fuerte: menos reps (más carga); liviano: más
// reps (menos carga). Normal: lo que usás hoy. Todo editable por slot.
const NORMAL: RepRange = { min: 8, max: 12 };
const HEAVY_COMPOUND: RepRange = { min: 6, max: 8 };
const HEAVY_ISO: RepRange = { min: 8, max: 10 };
const LIGHT_COMPOUND: RepRange = { min: 10, max: 12 };
const LIGHT_ISO: RepRange = { min: 12, max: 15 };

const slot = (exerciseId: string, startingLoadKg: number, repRange: RepRange = NORMAL, targetSets = 3) => ({
  exerciseId,
  targetSets,
  repRange: { ...repRange },
  startingLoadKg,
});

const copyDay = (day: BaseWeekDay, label: string): BaseWeekDay => ({
  ...day,
  label,
  slots: day.slots.map((s) => ({ ...s, repRange: { ...s.repRange } })),
});

// ---------------------------------------------------------------------------
// Plantilla 1: 6 días, A-C-B-A-C-B (empuje · piernas · tracción, dos vueltas)
// ---------------------------------------------------------------------------

// Día A — Empuje. Nota: la apertura + press inclinado con mancuernas se hacen
// en superserie (una serie de cada, sin descanso entre ambas).
const DAY_A: BaseWeekDay = {
  label: "Día A · Empuje",
  slots: [
    slot("bb-bench-press", 95, NORMAL, 4), // 40 kg por lado + barra de 15
    slot("incline-bb-press", 95, NORMAL, 4),
    slot("incline-db-fly", 28, NORMAL, 4), // superserie con el press inclinado
    slot("incline-db-press", 28, NORMAL, 4),
    slot("db-lateral-raise", 16, NORMAL, 4),
    slot("front-raise", 16, NORMAL, 4),
    slot("db-shoulder-press", 14, NORMAL, 4),
    slot("triceps-pushdown", 37.5, NORMAL, 4),
    slot("db-overhead-ext", 20, NORMAL, 4),
  ],
};

// Día B — Tracción.
const DAY_B: BaseWeekDay = {
  label: "Día B · Tracción",
  slots: [
    slot("wide-grip-pulldown", 80, NORMAL, 4),
    slot("close-grip-pulldown", 80, NORMAL, 4),
    slot("back-extension", 20, NORMAL, 4),
    slot("seated-cable-row", 80, NORMAL, 4),
    slot("straight-arm-pulldown", 40, NORMAL, 4),
    slot("db-curl", 20, NORMAL, 4),
    slot("hammer-curl", 20, NORMAL, 4),
    slot("db-shrug", 20, NORMAL, 4),
  ],
};

// Día C — Piernas.
const DAY_C: BaseWeekDay = {
  label: "Día C · Piernas",
  slots: [
    slot("leg-press", 300, NORMAL, 4),
    slot("lying-leg-curl", 40, NORMAL, 4),
    slot("leg-extension", 60, NORMAL, 4),
    slot("hip-adduction", 40, NORMAL, 4),
    slot("hip-abduction", 40, NORMAL, 4),
    slot("machine-hip-thrust", 20, NORMAL, 4),
  ],
};

// ---------------------------------------------------------------------------
// Plantilla 2: 5 días con día fuerte / día liviano
//   1 Empuje FUERTE + piernas (cuádriceps/gemelos)
//   2 Tracción LIVIANO
//   3 Piernas completo
//   4 Empuje LIVIANO
//   5 Tracción FUERTE + piernas (isquios/glúteos)
//   (+ 2 días de descanso, los que elijas)
// El segundo día de piernas de la rutina de 6 se parte en dos mitades
// coherentes por músculo: cuádriceps + gemelos van con el empuje fuerte,
// isquios + glúteos con la tracción fuerte (ahí ya entra el espinal). Así cada
// grupo de piernas sigue entrenándose 2 veces por semana.
// Alternar fuerte/liviano entre días del mismo patrón es equivalente para
// hipertrofia con volumen igualado (Grgic 2017); es gestión de fatiga, no
// optimización. Rangos editables por slot.
// ---------------------------------------------------------------------------

const PUSH_HEAVY: BaseWeekDay = {
  label: "Día 1 · Empuje FUERTE + cuádriceps",
  intensity: "heavy",
  slots: [
    slot("bb-bench-press", 100, HEAVY_COMPOUND),
    slot("incline-bb-press", 95, HEAVY_COMPOUND),
    slot("incline-db-fly", 28, HEAVY_ISO),
    slot("db-lateral-raise", 14, HEAVY_ISO),
    slot("db-shoulder-press", 30, HEAVY_COMPOUND),
    slot("triceps-pushdown", 37.5, HEAVY_ISO),
    slot("db-overhead-ext", 20, HEAVY_ISO),
    // mitad de piernas: cuádriceps + gemelos
    slot("leg-press", 300, HEAVY_COMPOUND),
    slot("leg-extension", 60, HEAVY_ISO),
    slot("leg-press-calf-raise", 300, { min: 10, max: 12 }),
  ],
};

const PULL_LIGHT: BaseWeekDay = {
  label: "Día 2 · Tracción LIVIANO",
  intensity: "light",
  slots: [
    slot("pull-up", 0, LIGHT_COMPOUND),
    slot("close-grip-pulldown", 80, LIGHT_COMPOUND),
    slot("seated-cable-row", 80, LIGHT_COMPOUND),
    slot("straight-arm-pulldown", 40, LIGHT_ISO),
    slot("db-curl", 20, LIGHT_ISO, 4),
    slot("hammer-curl", 20, LIGHT_ISO, 4),
    slot("db-shrug", 20, LIGHT_ISO),
  ],
};

const LEGS_FULL: BaseWeekDay = {
  label: "Día 3 · Piernas",
  slots: [
    slot("leg-press", 300, { min: 8, max: 10 }),
    slot("leg-press-calf-raise", 300, { min: 12, max: 15 }),
    slot("lying-leg-curl", 60, { min: 10, max: 12 }),
    slot("leg-extension", 60, { min: 8, max: 10 }),
    slot("hip-abduction", 125, { min: 10, max: 12 }),
    slot("machine-hip-thrust", 20, { min: 8, max: 10 }),
    slot("back-extension", 30, { min: 10, max: 12 }),
  ],
};

const PUSH_LIGHT: BaseWeekDay = {
  label: "Día 4 · Empuje LIVIANO",
  intensity: "light",
  slots: [
    slot("bb-bench-press", 95, LIGHT_COMPOUND),
    slot("incline-bb-press", 100, LIGHT_COMPOUND),
    slot("incline-db-fly", 28, LIGHT_ISO, 4),
    slot("db-lateral-raise", 15, LIGHT_ISO),
    slot("front-raise", 15, LIGHT_ISO),
    slot("triceps-pushdown", 37.5, LIGHT_ISO),
    slot("db-overhead-ext", 37.5, LIGHT_ISO),
    slot("cable-crunch", 20, { min: 12, max: 15 }, 4),
  ],
};

const PULL_HEAVY: BaseWeekDay = {
  label: "Día 5 · Tracción FUERTE + isquios/glúteos",
  intensity: "heavy",
  slots: [
    slot("wide-grip-pulldown", 80, HEAVY_COMPOUND),
    slot("seated-cable-row", 75, HEAVY_COMPOUND),
    slot("back-extension", 20, HEAVY_ISO),
    slot("straight-arm-pulldown", 40, HEAVY_ISO),
    slot("db-curl", 20, HEAVY_ISO, 4),
    slot("hammer-curl", 20, HEAVY_ISO, 4),
    slot("db-shrug", 20, HEAVY_ISO),
    // mitad de piernas: isquios + glúteos
    slot("lying-leg-curl", 40, HEAVY_ISO),
    slot("hip-abduction", 40, HEAVY_ISO),
    slot("cable-kickback", 65, HEAVY_ISO),
  ],
};

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: "ppl5-heavy-light",
    name: "5 días · fuerte / liviano (empuje · tracción · piernas · empuje · tracción)",
    description:
      "Día 1 empuje FUERTE + cuádriceps/gemelos · día 2 tracción LIVIANO · día 3 piernas · día 4 empuje LIVIANO · día 5 tracción FUERTE + isquios/glúteos. Los días fuertes bajan el RIR y los livianos lo suben (acotado a la banda del meso); cada versión progresa por separado. Las cargas se estiman desde tu historial al aplicarla.",
    days: [PUSH_HEAVY, PULL_LIGHT, LEGS_FULL, PUSH_LIGHT, PULL_HEAVY],
  },
  {
    id: "acb-x2",
    name: "Empuje · Piernas · Tracción ×2 (A-C-B-A-C-B)",
    description:
      "6 días: empuje (pecho/hombros/tríceps), piernas y tracción (espalda/bíceps), dos vueltas por semana. Cargas iniciales precargadas; todo editable después.",
    days: [
      copyDay(DAY_A, "Día 1 · A Empuje"),
      copyDay(DAY_C, "Día 2 · C Piernas"),
      copyDay(DAY_B, "Día 3 · B Tracción"),
      copyDay(DAY_A, "Día 4 · A Empuje"),
      copyDay(DAY_C, "Día 5 · C Piernas"),
      copyDay(DAY_B, "Día 6 · B Tracción"),
    ],
  },
];
