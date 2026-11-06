import { describe, expect, it } from "vitest";
import { generateMesocycle, weeklyVolumeTarget } from "../mesocycle";
import { weeklyVolumeByMuscle } from "../volume";
import { baseWeek, exercises, rules } from "./fixtures";
import type { BaseWeek, Exercise } from "../types";

// A4.2: un ejercicio propio con un músculo que el config no conoce no debe
// romper la generación del meso: se trata como "sin objetivo".
const foo: Exercise = {
  id: "foo-ex", name: "Ejercicio raro", primaryMuscle: "foo", secondaryMuscles: [],
  equipmentType: "machine", resistanceProfile: "mid", isSwappable: false, swapCandidates: [],
};
const week: BaseWeek = {
  days: baseWeek.days.map((d, i) =>
    i === 0 ? { ...d, slots: [...d.slots, { exerciseId: "foo-ex", targetSets: 3, repRange: { min: 10, max: 15 }, startingLoadKg: 40 }] } : d,
  ),
};

describe("músculo sin landmarks (A4.2)", () => {
  it("weeklyVolumeTarget mantiene el volumen base en vez de lanzar", () => {
    for (let w = 0; w < 4; w++) {
      expect(weeklyVolumeTarget({ muscle: "foo", baseVolume: 3, weekIndex: w, numAccumulationWeeks: 4, profile: "intermediate", prioritized: true, rules })).toBe(3);
    }
  });
  it("generateMesocycle no lanza y conserva el slot del músculo desconocido", () => {
    const plan = generateMesocycle({ baseWeek: week, exercises: [...exercises, foo], profile: "intermediate", progressionModel: "double", numAccumulationWeeks: 4, prioritizedMuscles: [], rules });
    const acc = plan.weeks.filter((w) => !w.isDeload);
    for (const w of acc) {
      const slot = w.days[0].slots.find((s) => s.exerciseId === "foo-ex");
      expect(slot?.sets).toBe(3);
    }
    const deload = plan.weeks.find((w) => w.isDeload)!;
    expect(deload.days[0].slots.find((s) => s.exerciseId === "foo-ex")).toBeDefined();
    expect(weeklyVolumeByMuscle(week, new Map([...exercises, foo].map((e) => [e.id, e])), rules).foo).toBe(3);
  });
});

describe("reemplazar un ejercicio en todo el plan (A4.2)", () => {
  it("cambia todos los slots, incluido el deload, y nada más", async () => {
    const { countExerciseInPlan, replaceExerciseInPlan } = await import("../mesocycle");
    const plan = generateMesocycle({ baseWeek, exercises, profile: "intermediate", progressionModel: "double", numAccumulationWeeks: 3, prioritizedMuscles: [], rules });
    const before = countExerciseInPlan(plan, "bench");
    expect(before).toBeGreaterThan(0);
    const next = replaceExerciseInPlan(plan, "bench", "row");
    expect(countExerciseInPlan(next, "bench")).toBe(0);
    expect(countExerciseInPlan(next, "row")).toBe(countExerciseInPlan(plan, "row") + before);
    expect(countExerciseInPlan(plan, "bench")).toBe(before); // puro: no muta
  });
});
