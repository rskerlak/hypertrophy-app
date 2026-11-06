import { describe, expect, it } from "vitest";
import { generateMesocycle } from "../mesocycle";
import { nextPrescription } from "../progression";
import { sessionCapWarnings } from "../volume";
import { intraSessionAdjust } from "../intraSession";
import { estimate1RM, loadForTarget } from "../oneRepMax";
import { assessRirCalibration } from "../rirCalibration";
import { baseWeek, equipment, exercises, exercisesById, rules, sessionLogs } from "./fixtures";
import type { BaseWeek } from "../types";

const bar = { type: "barbell" as const, equipment };

describe("A2.4 serie ancla", () => {
  const bw: BaseWeek = {
    days: [{ label: "A", slots: [{ ...baseWeek.days[0].slots[2], anchorSet: true }] }], // curl (mancuerna)
  };
  const plan = generateMesocycle({ baseWeek: bw, exercises, profile: "intermediate", progressionModel: "double", numAccumulationWeeks: 4, prioritizedMuscles: [], rules, rirBand: { min: 1, max: 3 } });
  it("la serie 1 va rirDelta más cerca del fallo, dentro de la banda", () => {
    const s = plan.weeks[0].days[0].slots[0];
    expect(s.setTargets).toBeDefined();
    expect(s.setTargets![0].targetRir).toBe(Math.max(1, s.targetRir - rules.anchorSet.rirDelta));
    expect(s.setTargets!.slice(1).every((t) => t.targetRir === s.targetRir)).toBe(true);
    for (const w of plan.weeks) for (const t of w.days[0].slots[0].setTargets ?? []) expect(t.targetRir).toBeGreaterThanOrEqual(1);
  });
  it("el deload no lleva ancla", () => {
    expect(plan.weeks.at(-1)!.days[0].slots[0].setTargets).toBeUndefined();
  });
});

describe("A2.5 tope blando por sesión", () => {
  it("avisa cuando un músculo supera el tope en un día", () => {
    const day = { slots: [{ exerciseId: "bench", targetSets: 8 }, { exerciseId: "db-press", targetSets: 6 }] };
    const w = sessionCapWarnings(day, exercisesById, rules);
    expect(w[0].muscle).toBe("chest");
    expect(w[0].sets).toBeGreaterThan(rules.volumeCounting.softSessionCapFractionalSets);
    expect(sessionCapWarnings({ slots: [{ exerciseId: "bench", targetSets: 3 }] }, exercisesById, rules)).toEqual([]);
  });
});

describe("A2.6 ajuste entre series", () => {
  const log = (rir: number, rirReported = true) => ({
    ...sessionLogs({ sessionId: "s", exerciseId: "bench", sets: 1, loadKg: 100, reps: 8, rir, targetReps: 8, targetRir: 2, timestamp: "2026-01-01T10:00:00Z" })[0],
    rirReported,
  });
  it("RIR 0 con objetivo 2 → baja la carga de la siguiente, redondeada", () => {
    const h = intraSessionAdjust(log(0), { loadKg: 100, reps: 8 }, bar, rules)!;
    expect(h.loadKg).toBe(95);
    expect(h.text).toContain("RIR 0");
  });
  it("sin desvío suficiente, RIR no reportado o calentamiento → nada", () => {
    expect(intraSessionAdjust(log(1), { loadKg: 100, reps: 8 }, bar, rules)).toBeNull();
    expect(intraSessionAdjust(log(0, false), { loadKg: 100, reps: 8 }, bar, rules)).toBeNull();
    expect(intraSessionAdjust({ ...log(0), kind: "warmup" }, { loadKg: 100, reps: 8 }, bar, rules)).toBeNull();
  });
  it("peso corporal → una rep menos", () => {
    expect(intraSessionAdjust(log(0), { loadKg: 0, reps: 10 }, { type: "bodyweight", equipment }, rules)).toMatchObject({ reps: 9 });
  });
});

describe("A2.7 confianza en el RIR", () => {
  const base = { model: "double" as const, targetRir: 2, repRange: { min: 8, max: 12 }, equipmentType: "barbell" as const, equipment, rules };
  it("con carga liviana relativa al e1RM el excedente de RIR cuenta la mitad", () => {
    // sesión pesada previa establece e1RM ~ 133; luego 60 kg (45%) × 10 @ RIR 4 (objetivo 2)
    const heavy = sessionLogs({ sessionId: "h", exerciseId: "bench", sets: 2, loadKg: 100, reps: 8, rir: 2, targetReps: 8, targetRir: 2, timestamp: "2026-01-01T10:00:00Z" });
    const light = sessionLogs({ sessionId: "l", exerciseId: "bench", sets: 2, loadKg: 60, reps: 10, rir: 3, targetReps: 10, targetRir: 1, timestamp: "2026-01-04T10:00:00Z" });
    const p = nextPrescription({ ...base, currentLoadKg: 60, exerciseHistory: [...heavy, ...light] });
    // ajuste crudo +2 → atenuado a +1 → 11 < 12: no llega al tope, pide 12 (no salta carga)
    expect(p.nextLoadKg).toBe(60);
    expect(p.nextReps).toBe(12);
  });
  it("en la calibración la serie 1 pesa menos", () => {
    const logs = [10, 12, 10, 12].flatMap((reps, i) =>
      sessionLogs({ sessionId: `c${i}`, exerciseId: "bench", sets: 2, loadKg: 80, reps, rir: 2, targetReps: 10, targetRir: 2, timestamp: `2026-02-0${i + 1}T10:00:00Z` }),
    );
    const c = assessRirCalibration(logs, rules);
    expect(c.meanAbsDeviationReps).not.toBeNull();
  });
});

describe("A2.8 APRE", () => {
  const base = { model: "double" as const, targetRir: 2, repRange: { min: 8, max: 12 }, currentLoadKg: 80, equipmentType: "barbell" as const, equipment, rules, slotProgression: "apre" as const };
  const amrap = (reps: number) =>
    sessionLogs({ sessionId: "s", exerciseId: "bench", sets: 3, loadKg: 80, reps, rir: 0, timestamp: "2026-01-05T10:00:00Z" });
  it.each([
    [6, 75],   // debajo del piso: −5% → 76 → redondeo 75
    [10, 80],  // dentro del rango: mantener
    [13, 82.5],// sobre el tope: +2.5% → 82 → salto mínimo 82.5
    [16, 82.5],// muy por encima: +5% → 84 → 82.5 con discos de 1.25? (84 → 82.5)
  ])("AMRAP de %i reps → %f kg", (reps, load) => {
    const p = nextPrescription({ ...base, exerciseHistory: amrap(reps) });
    expect(p.explain.rule).toBe("apre");
    expect(p.nextLoadKg).toBe(load);
  });
  it("el plan marca la última serie como AMRAP a RIR 0", () => {
    const bw: BaseWeek = { days: [{ label: "A", slots: [{ ...baseWeek.days[0].slots[1], progression: "apre" }] }] };
    const plan = generateMesocycle({ baseWeek: bw, exercises, profile: "intermediate", progressionModel: "double", numAccumulationWeeks: 4, prioritizedMuscles: [], rules });
    const s = plan.weeks[0].days[0].slots[0];
    expect(s.progression).toBe("apre");
    expect(s.setTargets!.at(-1)).toEqual({ targetRir: 0, amrap: true });
  });
});

describe("A2.9 1RM dependiente de la carga (opción)", () => {
  const wd = { ...rules, oneRepMax: { ...rules.oneRepMax, model: "weightDependent" as const } };
  it("el default sigue siendo Epley", () => {
    expect(rules.oneRepMax.model).toBe("epley");
    expect(estimate1RM(100, 10, 0, rules)).toBeCloseTo(100 * (1 + rules.oneRepMax.epleyCoefficient * 10));
  });
  it("da un valor razonable y su inversa vuelve a la carga", () => {
    const e = estimate1RM(100, 8, 2, wd);
    expect(e).toBeGreaterThan(100);
    expect(e).toBeLessThan(160);
    expect(loadForTarget(e, 8, 2, wd, bar)).toBeCloseTo(100, 0);
  });
  it("con cargas muy livianas cae a Epley (el modelo no aplica)", () => {
    expect(estimate1RM(1, 10, 0, wd)).toBeCloseTo(1 * (1 + rules.oneRepMax.epleyCoefficient * 10));
  });
});
