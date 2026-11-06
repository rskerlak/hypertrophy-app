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

const r = (min: number, max: number): RepRange => ({ min, max });
const slot = (exerciseId: string, startingLoadKg: number, repRange: RepRange, targetSets = 3) => ({
  exerciseId,
  targetSets,
  repRange: { ...repRange },
  startingLoadKg,
});

// Rangos por rol del día. Día fuerte: menos reps (más carga); liviano: más
// reps (menos carga). Normal: los de tu último meso. Todo editable por slot.
const HEAVY_COMPOUND = r(6, 8);
const HEAVY_ISO = r(8, 10);
const LIGHT_COMPOUND = r(10, 12);
const LIGHT_ISO = r(12, 15);

// ---------------------------------------------------------------------------
// Tu último meso de 6 días (Mesociclo 1 · 2), tal cual: A-C-B-A-C-B
// ---------------------------------------------------------------------------

const PUSH_1: BaseWeekDay = {
  label: "Día 1 · A Empuje",
  slots: [
    slot("bb-bench-press", 100, r(8, 10)),
    slot("incline-bb-press", 95, r(8, 10)),
    slot("incline-db-fly", 28, r(8, 10)),
    slot("db-lateral-raise", 14, r(10, 12)),
    slot("db-shoulder-press", 30, r(10, 12)),
    slot("triceps-pushdown", 37.5, r(10, 12)),
    slot("db-overhead-ext", 20, r(10, 12)),
    slot("cable-crunch", 20, r(12, 15), 4),
  ],
};

const LEGS_1: BaseWeekDay = {
  label: "Día 2 · C Piernas",
  slots: [
    slot("leg-press", 300, r(8, 10)),
    slot("leg-press-calf-raise", 300, r(12, 15)),
    slot("lying-leg-curl", 60, r(10, 12)),
    slot("leg-extension", 60, r(8, 10)),
    slot("hip-abduction", 125, r(10, 12)),
    slot("machine-hip-thrust", 20, r(8, 10)),
    slot("back-extension", 30, r(10, 12)),
  ],
};

const PULL_1: BaseWeekDay = {
  label: "Día 3 · B Tracción",
  slots: [
    slot("pull-up", 0, r(12, 15)),
    slot("close-grip-pulldown", 80, r(8, 10)),
    slot("back-extension", 20, r(10, 12)),
    slot("seated-cable-row", 80, r(8, 10)),
    slot("straight-arm-pulldown", 40, r(8, 10)),
    slot("db-curl", 20, r(8, 10), 4),
    slot("hammer-curl", 20, r(8, 10), 4),
    slot("db-shrug", 20, r(8, 10)),
  ],
};

const PUSH_2: BaseWeekDay = {
  label: "Día 4 · A Empuje",
  slots: [
    slot("bb-bench-press", 95, r(8, 10)),
    slot("incline-bb-press", 100, r(8, 10)),
    slot("incline-db-fly", 28, r(10, 12), 4),
    slot("db-lateral-raise", 15, r(10, 12)),
    slot("front-raise", 15, r(10, 12)),
    slot("triceps-pushdown", 37.5, r(10, 12)),
    slot("db-overhead-ext", 37.5, r(10, 12)),
  ],
};

const LEGS_2: BaseWeekDay = {
  label: "Día 5 · C Piernas",
  slots: [
    slot("leg-press", 300, r(8, 10)),
    slot("leg-press-calf-raise", 300, r(12, 15)),
    slot("lying-leg-curl", 40, r(8, 10)),
    slot("leg-extension", 60, r(10, 12)),
    slot("hip-abduction", 40, r(10, 12)),
    slot("cable-kickback", 65, r(10, 12)),
  ],
};

const PULL_2: BaseWeekDay = {
  label: "Día 6 · B Tracción",
  slots: [
    slot("wide-grip-pulldown", 80, r(8, 10)),
    slot("seated-cable-row", 75, r(8, 10)),
    slot("straight-arm-pulldown", 40, r(8, 10)),
    slot("db-curl", 20, r(8, 10), 4),
    slot("hammer-curl", 20, r(8, 10), 4),
    slot("db-shrug", 20, r(10, 12)),
  ],
};

// ---------------------------------------------------------------------------
// 5 días fuerte / liviano: empuje F + cuádriceps · tracción L · piernas ·
// empuje L · tracción F + isquios/glúteos. El 2º día de piernas de la de 6 se
// parte en dos mitades coherentes por músculo; cada grupo de piernas sigue
// 2×/semana. Alternar fuerte/liviano es equivalente para hipertrofia con
// volumen igualado (Grgic 2017): gestión de fatiga, no optimización.
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
    slot("leg-press-calf-raise", 300, r(10, 12)),
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

const LEGS_FULL: BaseWeekDay = { ...LEGS_1, label: "Día 3 · Piernas", slots: LEGS_1.slots.map((s) => ({ ...s, repRange: { ...s.repRange } })) };

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
    slot("cable-crunch", 20, r(12, 15), 4),
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

const copyDay = (day: BaseWeekDay, label: string): BaseWeekDay => ({
  ...day,
  label,
  slots: day.slots.map((s) => ({ ...s, repRange: { ...s.repRange } })),
});

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: "ppl5-heavy-light",
    name: "5 días · fuerte / liviano (empuje · tracción · piernas · empuje · tracción)",
    description:
      "Día 1 empuje FUERTE + cuádriceps/gemelos · día 2 tracción LIVIANO · día 3 piernas · día 4 empuje LIVIANO · día 5 tracción FUERTE + isquios/glúteos. Los días fuertes bajan el RIR y los livianos lo suben (acotado a la banda del meso); cada versión progresa por separado.",
    days: [PUSH_HEAVY, PULL_LIGHT, LEGS_FULL, PUSH_LIGHT, PULL_HEAVY],
  },
  {
    id: "acb-x2-last",
    name: "6 días · tu último meso (empuje · piernas · tracción ×2)",
    description:
      "Exactamente la estructura de «Mesociclo 1 · 2»: dos días de empuje, dos de piernas y dos de tracción, con tus ejercicios, series y rangos. Las cargas se toman de tu historial.",
    days: [PUSH_1, LEGS_1, PULL_1, PUSH_2, LEGS_2, PULL_2].map((d) => copyDay(d, d.label)),
  },
];
