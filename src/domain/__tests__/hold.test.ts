// A5.4 — "Mantener": el motor no sube la carga; sale solo si cargás más en todas las series.

import { describe, expect, it } from "vitest";
import { holdExitDetected, nextPrescription } from "../progression";
import { equipment, rules, sessionLogs } from "./fixtures";

const base = {
  model: "double" as const,
  targetRir: 2,
  repRange: { min: 8, max: 10 },
  currentLoadKg: 100,
  equipmentType: "barbell" as const,
  equipment,
  rules,
};
const at = (reps: number, load = 100) =>
  sessionLogs({ sessionId: `s${reps}-${load}`, exerciseId: "bench", sets: 3, loadKg: load, reps, rir: 2, targetReps: reps, targetRir: 2, timestamp: "2026-11-01T10:00:00Z" });

describe("Mantener en la prescripción (A5.4)", () => {
  it("en el tope del rango repite carga y tope en vez de subir", () => {
    const normal = nextPrescription({ ...base, exerciseHistory: at(10) });
    expect(normal.nextLoadKg).toBeGreaterThan(100);
    const hold = nextPrescription({ ...base, exerciseHistory: at(10), holdLoad: true });
    expect(hold.nextLoadKg).toBe(100);
    expect(hold.nextReps).toBe(10);
    expect(hold.explain.rule).toBe("hold-at-ceiling");
  });

  it("debajo del tope no cambia nada (sigue subiendo reps a la misma carga)", () => {
    const normal = nextPrescription({ ...base, exerciseHistory: at(8) });
    const hold = nextPrescription({ ...base, exerciseHistory: at(8), holdLoad: true });
    expect(hold).toEqual(normal);
  });

  it("lineal: no sube carga", () => {
    const hold = nextPrescription({ ...base, model: "linear", exerciseHistory: at(10), holdLoad: true });
    expect(hold.nextLoadKg).toBe(100);
    expect(hold.explain.rule).toMatch(/^hold/);
  });

  it("APRE: una AMRAP sobre el tope no sube carga", () => {
    const hold = nextPrescription({ ...base, slotProgression: "apre", exerciseHistory: at(14), holdLoad: true });
    expect(hold.nextLoadKg).toBe(100);
  });

  it("las re-estimaciones (cambio de pista) no son progresión y se respetan", () => {
    const p = nextPrescription({
      ...base,
      exerciseHistory: [],
      anchor: { logs: at(10, 110), reason: "track-changed" },
      holdLoad: true,
    });
    expect(p.explain.rule).toBe("track-reanchor");
  });
});

describe("holdExitDetected (A5.4)", () => {
  const ctx = { type: "barbell" as const, equipment };
  const logs = (loads: number[], target = 100) =>
    loads.map((l, i) => ({ ...at(8)[0], id: `h${i}`, setIndex: i, targetLoadKg: target, actualLoadKg: l }));

  it("todas las series ≥ un paso arriba de lo prescrito → sale", () => {
    expect(holdExitDetected(logs([102.5, 102.5, 105]), ctx)).toBe(true);
  });
  it("una sola serie más pesada → no sale", () => {
    expect(holdExitDetected(logs([102.5, 100, 100]), ctx)).toBe(false);
  });
  it("igual a lo prescrito → no sale", () => {
    expect(holdExitDetected(logs([100, 100, 100]), ctx)).toBe(false);
  });
  it("calentamientos y drops no cuentan", () => {
    const l = logs([102.5, 102.5]);
    l.push({ ...l[0], id: "w", setIndex: 9, kind: "warmup", actualLoadKg: 60 });
    l.push({ ...l[0], id: "d", setIndex: 10, kind: "drop", actualLoadKg: 80 });
    expect(holdExitDetected(l, ctx)).toBe(true);
  });
  it("peso corporal (sin carga prescrita) → nunca sale solo", () => {
    expect(holdExitDetected(logs([80, 80], 0), ctx)).toBe(false);
  });
});

// ---------------- Re-auditoría A5 (A5-11) ----------------
import { holdExitCandidates } from "../progression";

describe("re-auditoría A5-11: Mantener con re-estimaciones y salidas", () => {
  it("gap-reanchor y block-phase-reanchor se respetan con Mantener", () => {
    const gap = nextPrescription({ ...base, exerciseHistory: [], anchor: { logs: at(10, 110), reason: "gap", ageDays: 40 }, holdLoad: true });
    expect(gap.explain.rule).toBe("gap-reanchor");
    const h = sessionLogs({ sessionId: "blk", exerciseId: "bench", sets: 3, loadKg: 62.5, reps: 11, rir: 3, targetReps: 11, targetRir: 3, timestamp: "2026-11-01T10:00:00Z" });
    const blk = nextPrescription({ ...base, model: "block", repRange: { min: 5, max: 10 }, currentLoadKg: 62.5, exerciseHistory: h, weekIndex: 3, historyWeekIndex: 2, numAccumulationWeeks: 5, holdLoad: true });
    expect(blk.explain.rule).toBe("block-phase-reanchor");
  });
  it("A5-02: en deload o en slots con carga reducida no hay candidatos a salir de Mantener", () => {
    const logs = [0, 1].map((slotIndex) => ({ ...at(8)[0], id: `c${slotIndex}`, slotIndex, targetLoadKg: 90, actualLoadKg: 100 }));
    expect(holdExitCandidates(logs, { isDeload: true, reducedSlots: [] })).toEqual([]);
    expect(holdExitCandidates(logs, { isDeload: false, reducedSlots: [0] }).map((l) => l.slotIndex)).toEqual([1]);
    expect(holdExitCandidates(logs, { isDeload: false, reducedSlots: [] })).toHaveLength(2);
  });
});
