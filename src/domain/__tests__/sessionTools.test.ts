import { describe, expect, it } from "vitest";
import { plateBreakdown } from "../rounding";
import { warmupSets } from "../warmup";
import { compareToPrevious, lastSessionSets, previousForIndex } from "../history";
import { detectPRs } from "../records";
import { nextPrescription } from "../progression";
import { assessRirCalibration } from "../rirCalibration";
import { computeMesoStats } from "../stats";
import { generateMesocycle } from "../mesocycle";
import { baseWeek, equipment, exercises, rules, sessionLogs } from "./fixtures";
import type { Equipment, SetLog } from "../types";

const bar = { type: "barbell" as const, equipment };

describe("plateBreakdown (A1.2)", () => {
  it("102.5 kg con barra de 20 → 41.25 por lado = 25 + 15 + 1.25", () => {
    const b = plateBreakdown(102.5, bar)!;
    expect(b.baseKg).toBe(20);
    expect(b.perSide.reduce((a, x) => a + x, 0)).toBe(41.25);
    expect(b.perSide[0]).toBe(25); // de mayor a menor
    expect(b.unreachable).toBe(false);
  });
  it("carga inalcanzable → marca y propone la alcanzable inferior", () => {
    const b = plateBreakdown(101, bar)!;
    expect(b.unreachable).toBe(true);
    expect(b.nearestBelow).toBe(100);
  });
  it("mancuerna armable usa el mango; rack fijo y máquina no tienen discos", () => {
    const loadable: Equipment = { ...equipment, dumbbellPlatesKg: [1.25, 2.5, 5, 10], dumbbellHandleKg: 2 };
    const d = plateBreakdown(24.5, { type: "dumbbell", equipment: loadable })!;
    expect(d.baseKg).toBe(2);
    expect(d.perSide.reduce((a, x) => a + x, 0)).toBe(11.25);
    expect(plateBreakdown(24, { type: "dumbbell", equipment })).toBeNull();
    expect(plateBreakdown(50, { type: "machine", equipment })).toBeNull();
  });
  it("solo la barra → sin discos", () => {
    expect(plateBreakdown(20, bar)!.perSide).toEqual([]);
  });
});

describe("warmupSets (A1.3)", () => {
  it("dos aproximaciones redondeadas, menores que la carga de trabajo", () => {
    const w = warmupSets(100, bar, rules);
    expect(w).toEqual([{ loadKg: 50, reps: 8 }, { loadKg: 75, reps: 4 }]);
  });
  it("sin calentamiento bajo el mínimo o en peso corporal", () => {
    expect(warmupSets(rules.warmup.minWorkingLoadKg - 1, bar, rules)).toEqual([]);
    expect(warmupSets(80, { type: "bodyweight", equipment }, rules)).toEqual([]);
  });
});

const warm = (logs: SetLog[]) => logs.map((l) => ({ ...l, kind: "warmup" as const, id: l.id + "w", setIndex: -1 - l.setIndex }));

describe("las series de calentamiento no cuentan (A1.3)", () => {
  const work = sessionLogs({ sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80, reps: 10, rir: 2, timestamp: "2026-01-05T10:00:00Z" });
  const wu = warm(sessionLogs({ sessionId: "s1", exerciseId: "bench", sets: 2, loadKg: 40, reps: 8, rir: 6, timestamp: "2026-01-05T09:50:00Z" }));
  const base = { model: "double" as const, targetRir: 2, repRange: { min: 8, max: 12 }, currentLoadKg: 80, equipmentType: "barbell" as const, equipment, rules };

  it("no cambian la prescripción", () => {
    const a = nextPrescription({ ...base, exerciseHistory: work });
    const b = nextPrescription({ ...base, exerciseHistory: [...work, ...wu] });
    expect(b).toEqual(a);
  });
  it("no entran en la calibración ni en el volumen de stats", () => {
    expect(assessRirCalibration([...work, ...wu], rules)).toEqual(assessRirCalibration(work, rules));
    const plan = generateMesocycle({ baseWeek, exercises, profile: "intermediate", progressionModel: "double", numAccumulationWeeks: 3, prioritizedMuscles: [], rules });
    const sessions = [{ id: "s1", weekIndex: 0, status: "completed" as const }];
    const s1 = computeMesoStats({ plan, sessions, setLogs: work, checkins: [], exercises, rules });
    const s2 = computeMesoStats({ plan, sessions, setLogs: [...work, ...wu], checkins: [], exercises, rules });
    expect(s2.volume.completedFractionalSets).toBe(s1.volume.completedFractionalSets);
  });
  it("la sesión anterior que se muestra excluye el calentamiento", () => {
    const prev = lastSessionSets([...work, ...wu])!;
    expect(prev.sets).toHaveLength(3);
    expect(prev.sets[0]).toMatchObject({ loadKg: 80, reps: 10 });
  });
});

describe("sesión anterior y comparación (A1.1)", () => {
  const s1 = sessionLogs({ sessionId: "a", exerciseId: "bench", sets: 2, loadKg: 80, reps: 10, rir: 2, timestamp: "2026-01-01T10:00:00Z" });
  const s2 = sessionLogs({ sessionId: "b", exerciseId: "bench", sets: 3, loadKg: 80, reps: 11, rir: 2, timestamp: "2026-01-04T10:00:00Z" });
  it("toma la ÚLTIMA sesión y su sessionId", () => {
    const p = lastSessionSets([...s1, ...s2])!;
    expect(p.sessionId).toBe("b");
    expect(p.sets.map((x) => x.reps)).toEqual([11, 11, 11]);
  });
  it("si hoy hay más series que la vez anterior, repite la última previa", () => {
    const p = lastSessionSets(s1)!.sets;
    expect(previousForIndex(p, 3)).toEqual(p[1]);
    expect(previousForIndex(null, 0)).toBeNull();
  });
  it("compara neutral: carga manda, luego reps", () => {
    const prev = { loadKg: 80, reps: 10, rir: 2, rirReported: true };
    expect(compareToPrevious({ loadKg: 82.5, reps: 8 }, prev)).toBe("up");
    expect(compareToPrevious({ loadKg: 80, reps: 11 }, prev)).toBe("up");
    expect(compareToPrevious({ loadKg: 80, reps: 10 }, prev)).toBe("same");
    expect(compareToPrevious({ loadKg: 80, reps: 9 }, prev)).toBe("down");
  });
});

describe("detectPRs (A1.8)", () => {
  const hist = [
    ...sessionLogs({ sessionId: "a", exerciseId: "bench", sets: 2, loadKg: 100, reps: 8, rir: 2, timestamp: "2026-01-01T10:00:00Z" }),
    ...sessionLogs({ sessionId: "b", exerciseId: "bench", sets: 2, loadKg: 95, reps: 10, rir: 2, timestamp: "2026-01-04T10:00:00Z" }),
  ];
  const one = (loadKg: number, reps: number, rir = 2) =>
    sessionLogs({ sessionId: "c", exerciseId: "bench", sets: 1, loadKg, reps, rir, timestamp: "2026-01-08T10:00:00Z" })[0];

  it("carga máxima nueva", () => {
    expect(detectPRs(hist, one(102.5, 6), rules).map((p) => p.kind)).toContain("load");
  });
  it("más reps a una carga ya usada", () => {
    const prs = detectPRs(hist, one(100, 9), rules);
    expect(prs.find((p) => p.kind === "repsAtLoad")).toMatchObject({ value: 9, previous: 8, atLoadKg: 100 });
  });
  it("igualar no es récord; sin historial tampoco; calentamiento nunca", () => {
    expect(detectPRs(hist, one(100, 8), rules)).toEqual([]);
    expect(detectPRs([], one(200, 10), rules)).toEqual([]);
    expect(detectPRs(hist, { ...one(150, 10), kind: "warmup" }, rules)).toEqual([]);
  });
});

describe("explain (A1.10): cada rama de la doble progresión tiene su regla", () => {
  const base = { model: "double" as const, targetRir: 2, repRange: { min: 8, max: 12 }, currentLoadKg: 80, equipmentType: "barbell" as const, equipment, rules };
  const mk = (reps: number, rir: number, targetRir = 2) =>
    sessionLogs({ sessionId: "s", exerciseId: "bench", sets: 3, loadKg: 80, reps, rir, targetReps: reps, targetRir, timestamp: "2026-01-05T10:00:00Z" });
  it.each([
    [[], "no-history"],
    [mk(10, 2), "double-below-ceiling"],
    [mk(10, 0), "double-consolidate"],
    [mk(13, 2), "double-ceiling"], // 1 rep sobre el tope: crédito 5% ≥ salto 3.1% (80→82.5)
  ] as const)("historial → %s", (history, rule) => {
    expect(nextPrescription({ ...base, exerciseHistory: [...history] }).explain.rule).toBe(rule);
  });
  it("salto grande → regla propia con el % en los inputs", () => {
    const db = { ...base, equipmentType: "dumbbell" as const, currentLoadKg: 14, equipment: { ...equipment, dumbbellsKg: [12, 14, 16] } };
    const p = nextPrescription({ ...db, exerciseHistory: sessionLogs({ sessionId: "s", exerciseId: "lat", sets: 3, loadKg: 14, reps: 12, rir: 2, timestamp: "2026-01-05T10:00:00Z" }) });
    expect(p.explain.rule).toBe("double-ceiling-large-jump");
    expect(p.explain.inputs.saltoMinimoPct).toBe(14.3);
  });
});

describe("detectPRs: el récord de 1RM exige RIR reportado", () => {
  const hist = sessionLogs({ sessionId: "a", exerciseId: "bench", sets: 2, loadKg: 100, reps: 8, rir: 1, timestamp: "2026-01-01T10:00:00Z" });
  const s = (rir: number, rirReported: boolean) => ({
    ...sessionLogs({ sessionId: "c", exerciseId: "bench", sets: 1, loadKg: 100, reps: 8, rir, timestamp: "2026-01-08T10:00:00Z" })[0],
    rirReported,
  });
  it("RIR precargado (no tocado) no genera récord de 1RM aunque lo infle", () => {
    expect(detectPRs(hist, s(4, false), rules).map((p) => p.kind)).not.toContain("e1rm");
  });
  it("con RIR reportado sí", () => {
    expect(detectPRs(hist, s(4, true), rules).map((p) => p.kind)).toContain("e1rm");
  });
});
