import { describe, expect, it } from "vitest";
import { evaluateDeloadTrigger, summarizeSessionPair } from "../deload";
import type { SessionSummary } from "../types";
import { rules, sessionLogs } from "./fixtures";

const okSession = (id: string): SessionSummary => ({
  sessionId: id,
  exercisesWithRepDropAtFixedLoad: 0,
  maxRirIncreaseAtFixedLoad: 0,
  readiness: 4,
  sleptMinimum: true,
});

const droppedSession = (id: string): SessionSummary => ({
  sessionId: id,
  exercisesWithRepDropAtFixedLoad: 2,
  maxRirIncreaseAtFixedLoad: 0,
  readiness: 3,
  sleptMinimum: true,
});

const baseInput = {
  checkins: [],
  currentWeeklyVolumeByMuscle: { chest: 12, back: 12 },
  prioritizedMuscles: [],
  profile: "intermediate" as const,
  weekIndex: 2,
  numAccumulationWeeks: 5,
  rules,
};

describe("evaluateDeloadTrigger", () => {
  it("sin señales: no sugiere", () => {
    const r = evaluateDeloadTrigger({
      ...baseInput,
      recentSessions: [okSession("a"), okSession("b"), okSession("c")],
    });
    expect(r.shouldSuggest).toBe(false);
    expect(r.forced).toBe(false);
  });

  it("una sola señal no alcanza (minSignalsToSuggest = 2)", () => {
    const r = evaluateDeloadTrigger({
      ...baseInput,
      recentSessions: [droppedSession("a"), droppedSession("b")],
    });
    expect(r.reasons.length).toBe(1);
    expect(r.shouldSuggest).toBe(false);
  });

  it("dos señales concurrentes: sugiere (caída de rendimiento + RIR creep)", () => {
    const creep: SessionSummary = { ...droppedSession("b"), maxRirIncreaseAtFixedLoad: 2 };
    const r = evaluateDeloadTrigger({
      ...baseInput,
      recentSessions: [droppedSession("a"), creep],
    });
    expect(r.reasons.length).toBe(2);
    expect(r.shouldSuggest).toBe(true);
    expect(r.forced).toBe(false);
  });

  it("caída de rendimiento + MRV alcanzado: sugiere", () => {
    const r = evaluateDeloadTrigger({
      ...baseInput,
      currentWeeklyVolumeByMuscle: { chest: 22, back: 12 }, // chest MRV intermediate = 22
      recentSessions: [droppedSession("a"), droppedSession("b")],
    });
    expect(r.shouldSuggest).toBe(true);
    expect(r.reasons.some((x) => x.includes("MRV"))).toBe(true);
  });

  it("fin de la acumulación: forzado aunque no haya señales", () => {
    const r = evaluateDeloadTrigger({
      ...baseInput,
      weekIndex: 5,
      recentSessions: [okSession("a")],
    });
    expect(r.forced).toBe(true);
    expect(r.shouldSuggest).toBe(true);
  });
});

describe("summarizeSessionPair", () => {
  it("detecta caída de reps y aumento de RIR a carga fija", () => {
    const prev = [
      ...sessionLogs({ sessionId: "p", exerciseId: "bench", sets: 3, loadKg: 80, reps: 10, rir: 2, timestamp: "2026-01-05T10:00:00Z" }),
      ...sessionLogs({ sessionId: "p", exerciseId: "row", sets: 3, loadKg: 70, reps: 10, rir: 2, timestamp: "2026-01-05T10:20:00Z" }),
    ];
    const curr = [
      ...sessionLogs({ sessionId: "c", exerciseId: "bench", sets: 3, loadKg: 80, reps: 8, rir: 2, timestamp: "2026-01-08T10:00:00Z" }),
      ...sessionLogs({ sessionId: "c", exerciseId: "row", sets: 3, loadKg: 70, reps: 10, rir: 4, timestamp: "2026-01-08T10:20:00Z" }),
    ];
    const s = summarizeSessionPair(prev, curr, "c");
    expect(s.exercisesWithRepDropAtFixedLoad).toBe(1); // bench cayó de 10 a 8
    expect(s.maxRirIncreaseAtFixedLoad).toBe(2); // row subió RIR de 2 a 4
  });

  it("ignora series con carga distinta (no es comparación a carga fija)", () => {
    const prev = sessionLogs({ sessionId: "p", exerciseId: "bench", sets: 3, loadKg: 80, reps: 10, rir: 2, timestamp: "2026-01-05T10:00:00Z" });
    const curr = sessionLogs({ sessionId: "c", exerciseId: "bench", sets: 3, loadKg: 82.5, reps: 8, rir: 2, timestamp: "2026-01-08T10:00:00Z" });
    const s = summarizeSessionPair(prev, curr, "c");
    expect(s.exercisesWithRepDropAtFixedLoad).toBe(0);
  });
});
