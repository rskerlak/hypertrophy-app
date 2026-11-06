// Regresiones de la auditoría de código de Plan A (docs/audits/2026-11-05-planA-codigo.md).
import { describe, expect, it } from "vitest";
import { nextPrescription, type NextPrescriptionInput } from "../progression";
import { rirScheduleForLength } from "../rules";
import type { Equipment, EquipmentType, ProgressionModel, SetLog } from "../types";
import { equipment, equipmentNoSmallPlates, rules, sessionLogs } from "./fixtures";

const base = {
  targetRir: 2,
  repRange: { min: 8, max: 12 },
  equipment,
  rules,
} as const;

let day = 1;
const ts = () => `2026-02-${String(day++).padStart(2, "0")}T10:00:00Z`;

describe("H1 — lineal: el salto nunca supera el % objetivo sin pasar por reps", () => {
  const run = (equipmentType: EquipmentType, eq: Equipment, startKg: number, n = 12) => {
    let load = startKg;
    let reps = 8;
    const history: SetLog[] = [];
    const steps: Array<{ load: number; reps: number; rule: string }> = [];
    for (let i = 0; i < n; i++) {
      history.push(...sessionLogs({ sessionId: `s${i}`, exerciseId: "x", sets: 3, loadKg: load, reps, rir: 2, targetReps: reps, targetRir: 2, timestamp: ts() }));
      const p = nextPrescription({ ...base, model: "linear", equipment: eq, equipmentType, currentLoadKg: load, exerciseHistory: history });
      steps.push({ load: p.nextLoadKg, reps: p.nextReps, rule: p.explain.rule });
      if (p.nextLoadKg > load) {
        const jump = ((p.nextLoadKg - load) / load) * 100;
        // Un salto desproporcionado solo se permite al llegar al tope del rango (y avisado).
        if (jump > rules.progressionModels.linear.loadIncrementPctPerSession * (reps - 8 + 1)) {
          expect(reps).toBe(12);
          expect(p.explain.rule).toBe("linear-hit-large-jump");
        }
      }
      load = p.nextLoadKg;
      reps = p.nextReps;
    }
    return steps;
  };

  it("polea de 5 kg en 5 kg: suma reps hasta el tope antes de +100 %", () => {
    const steps = run("cable", equipment, 5);
    expect(steps.slice(0, 4).every((s) => s.load === 5 && s.rule === "linear-add-rep")).toBe(true);
    expect(steps.some((s) => s.load === 10)).toBe(true);
  });
  it("mancuerna armable de 12 kg y barra sin discos de 1.25 tampoco saltan sin crédito", () => {
    run("dumbbell", { ...equipment, dumbbellPlatesKg: [1.25, 2.5, 5], dumbbellHandleKg: 2 }, 12);
    run("barbell", equipmentNoSmallPlates, 40);
  });
  it("linear-miss: objetivo no cumplido repite la carga", () => {
    const h = sessionLogs({ sessionId: "m", exerciseId: "x", sets: 3, loadKg: 60, reps: 6, rir: 2, targetReps: 8, targetRir: 2, timestamp: ts() });
    expect(nextPrescription({ ...base, model: "linear", equipmentType: "barbell", currentLoadKg: 60, exerciseHistory: h })).toMatchObject({
      nextLoadKg: 60,
      explain: { rule: "linear-miss" },
    });
  });
});

describe("H2 — drop, parciales y bajadas de carga no deciden la progresión", () => {
  const working = (id: string, reps: number) =>
    sessionLogs({ sessionId: id, exerciseId: "x", sets: 3, loadKg: 60, reps, rir: 2, targetReps: reps, targetRir: 2, timestamp: ts() });
  const extra = (id: string, kind: SetLog["kind"], loadKg: number, reps: number): SetLog => ({
    ...sessionLogs({ sessionId: id, exerciseId: "x", sets: 1, loadKg, reps, rir: 0, targetReps: reps, targetRir: 0, timestamp: ts() })[0],
    setIndex: 3,
    kind,
  });
  const input = (h: SetLog[]): NextPrescriptionInput => ({ ...base, model: "double", equipmentType: "barbell", currentLoadKg: 60, exerciseHistory: h });

  it("doble: 3 series en el tope + un drop al 75 % → sube la carga", () => {
    const h = [...working("a", 12), extra("a", "drop", 45, 8)];
    expect(nextPrescription(input(h)).nextLoadKg).toBeGreaterThan(60);
  });
  it("doble: una parcial con menos reps tampoco frena", () => {
    const h = [...working("a", 12), extra("a", "partial", 60, 5)];
    expect(nextPrescription(input(h)).nextLoadKg).toBeGreaterThan(60);
  });
  it("una serie de trabajo bajada de carga a mitad de sesión no entra al mínimo de reps", () => {
    const h = [...working("a", 12), extra("a", "working", 55, 9)];
    expect(nextPrescription(input(h)).nextLoadKg).toBeGreaterThan(60);
  });
  it("una serie al fallo SÍ cuenta (es trabajo a la misma carga)", () => {
    const h = [...working("a", 12), extra("a", "failure", 60, 10)];
    expect(nextPrescription(input(h))).toMatchObject({ nextLoadKg: 60 });
  });
  it("lineal con un drop por sesión no queda estancado", () => {
    const h = [...working("a", 8), extra("a", "drop", 45, 6)];
    const p = nextPrescription({ ...input(h), model: "linear" });
    expect(p.explain.rule).not.toBe("linear-miss");
    expect(p.explain.rule).not.toBe("linear-stalled");
  });
});

describe("M2 — bloques re-anclan la carga al cambiar de fase", () => {
  it("de acumulación (8–15) a intensificación (5–10) la carga sube según el e1RM", () => {
    const h = sessionLogs({ sessionId: "b", exerciseId: "x", sets: 3, loadKg: 62.5, reps: 11, rir: 3, targetReps: 11, targetRir: 3, timestamp: ts() });
    const p = nextPrescription({ ...base, model: "block", equipmentType: "barbell", currentLoadKg: 62.5, exerciseHistory: h, weekIndex: 3, numAccumulationWeeks: 5 });
    expect(p.explain.rule).toBe("block-phase-reanchor");
    expect(p.nextReps).toBe(5);
    expect(p.nextLoadKg).toBeGreaterThan(70);
  });
  it("dentro de la misma fase no re-ancla", () => {
    const h = sessionLogs({ sessionId: "b", exerciseId: "x", sets: 3, loadKg: 62.5, reps: 11, rir: 3, targetReps: 11, targetRir: 3, timestamp: ts() });
    const p = nextPrescription({ ...base, model: "block", equipmentType: "barbell", currentLoadKg: 62.5, exerciseHistory: h, weekIndex: 1, numAccumulationWeeks: 5 });
    expect(p.explain.rule).not.toBe("block-phase-reanchor");
  });
});

describe("M6 — peso corporal topea en el máximo de reps con evidencia", () => {
  const cap = rules.repRanges.globalValid.max;
  for (const model of ["linear", "double"] as const) {
    it(`${model}: nunca prescribe más de ${cap} reps y al llegar sugiere lastre`, () => {
      const h = sessionLogs({ sessionId: "bw", exerciseId: "x", sets: 3, loadKg: 0, reps: cap - 1, rir: 2, targetReps: cap - 1, targetRir: 2, timestamp: ts() });
      const p = nextPrescription({ ...base, model, equipmentType: "bodyweight", currentLoadKg: 0, exerciseHistory: h });
      expect(p.nextReps).toBe(cap);
      expect(p.explain.rule).toBe(model === "linear" ? "linear-no-jump" : "double-no-jump");
      const h2 = sessionLogs({ sessionId: "bw2", exerciseId: "x", sets: 3, loadKg: 0, reps: cap, rir: 2, targetReps: cap, targetRir: 2, timestamp: ts() });
      const p2 = nextPrescription({ ...base, model, equipmentType: "bodyweight", currentLoadKg: 0, exerciseHistory: [...h, ...h2] });
      expect(p2).toMatchObject({ nextReps: cap, explain: { rule: "bodyweight-cap" } });
    });
  }
});

describe("M7 — calendario de RIR sin literales para longitudes sin tabla", () => {
  it("el tope del calendario de respaldo sale del config", () => {
    const max = rules.rirSchedule.selectableBand.max;
    for (const n of [7, 9, 12]) {
      const s = rirScheduleForLength(rules, n);
      expect(s).toHaveLength(n);
      expect(Math.max(...s)).toBeLessThanOrEqual(max);
      expect(s.at(-1)).toBe(0);
    }
  });
});

describe("Simulación: 20 sesiones de un usuario que cumple exacto (auditoría Pista 2)", () => {
  const equipments: Array<{ name: string; type: EquipmentType; eq: Equipment; start: number }> = [
    { name: "barra c/1.25", type: "barbell", eq: equipment, start: 60 },
    { name: "barra s/1.25", type: "barbell", eq: equipmentNoSmallPlates, start: 40 },
    { name: "rack fijo", type: "dumbbell", eq: equipment, start: 14 },
    { name: "armable", type: "dumbbell", eq: { ...equipment, dumbbellPlatesKg: [1.25, 2.5, 5], dumbbellHandleKg: 2 }, start: 12 },
    { name: "máquina 5", type: "machine", eq: equipment, start: 40 },
    { name: "polea 5", type: "cable", eq: equipment, start: 20 },
  ];
  const variants: Array<{ model: ProgressionModel; dayType?: "heavy" | "medium" | "light" }> = [
    { model: "linear" },
    { model: "double" },
    { model: "dup", dayType: "heavy" },
    { model: "dup", dayType: "light" },
    { model: "block" },
  ];
  const LARGE = ["double-ceiling-large-jump", "linear-hit-large-jump"];

  for (const v of variants) {
    for (const e of equipments) {
      it(`${v.model}${v.dayType ? `/${v.dayType}` : ""} × ${e.name}: no se congela, no retrocede, saltos grandes solo avisados`, () => {
        let load = e.start;
        let reps = 8;
        const history: SetLog[] = [];
        let increased = 0;
        for (let i = 0; i < 20; i++) {
          history.push(...sessionLogs({ sessionId: `${v.model}${i}`, exerciseId: "x", sets: 3, loadKg: load, reps, rir: 2, targetReps: reps, targetRir: 2, timestamp: ts() }));
          const p = nextPrescription({
            ...base,
            model: v.model,
            dayType: v.dayType,
            weekIndex: Math.min(4, Math.floor(i / 4)),
            numAccumulationWeeks: 5,
            equipment: e.eq,
            equipmentType: e.type,
            currentLoadKg: load,
            exerciseHistory: history,
          });
          if (p.nextLoadKg < load) expect(p.explain.rule).toBe("block-phase-reanchor");
          if (p.nextLoadKg > load) {
            increased++;
            const jump = ((p.nextLoadKg - load) / load) * 100;
            if (jump > 15 && p.explain.rule !== "block-phase-reanchor") expect(LARGE).toContain(p.explain.rule);
          }
          expect(p.nextReps).toBeLessThanOrEqual(rules.repRanges.globalValid.max);
          load = p.nextLoadKg;
          reps = p.nextReps;
        }
        expect(increased).toBeGreaterThan(0);
      });
    }
  }
});
