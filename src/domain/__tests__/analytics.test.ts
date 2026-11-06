import { describe, expect, it } from "vitest";
import { daysBetween, ema, exerciseTimeline, loadAdherence, repDeltaBySession, scheduleDates, sleepDebtBySession, weeklyReport } from "../analytics";
import { generateMesocycle } from "../mesocycle";
import { baseWeek, exercises, rules, sessionLogs } from "./fixtures";
import type { Checkin } from "../types";

const plan = generateMesocycle({ baseWeek, exercises, profile: "intermediate", progressionModel: "double", numAccumulationWeeks: 3, prioritizedMuscles: [], rules });
const deloadW = plan.weeks.findIndex((w) => w.isDeload);
const S = (id: string, weekIndex: number, dayIndex: number, extra: Partial<{ status: "completed" | "pending" | "skipped"; isDeload: boolean; completedAt: string; startedAt: string }> = {}) => ({
  id, mesocycleId: "m", weekIndex, dayIndex, isDeload: weekIndex === deloadW, status: "completed" as const, ...extra,
});

describe("exerciseTimeline (A3.1)", () => {
  const sessions = [S("a", 0, 0, { completedAt: "2026-01-01" }), S("b", 1, 0, { completedAt: "2026-01-08" }), S("d", deloadW, 0, { completedAt: "2026-01-22" }), S("p", 2, 0, { status: "pending" })];
  const logs = [
    ...sessionLogs({ sessionId: "a", exerciseId: "bench", sets: 3, loadKg: 80, reps: 8, rir: 2, timestamp: "2026-01-01T10:00:00Z" }),
    ...sessionLogs({ sessionId: "b", exerciseId: "bench", sets: 3, loadKg: 82.5, reps: 8, rir: 2, timestamp: "2026-01-08T10:00:00Z" }),
    ...sessionLogs({ sessionId: "d", exerciseId: "bench", sets: 2, loadKg: 50, reps: 5, rir: 4, timestamp: "2026-01-22T10:00:00Z" }),
    ...sessionLogs({ sessionId: "p", exerciseId: "bench", sets: 1, loadKg: 90, reps: 8, rir: 2, timestamp: "2026-01-15T10:00:00Z" }),
  ];
  const t = exerciseTimeline({ exerciseId: "bench", logs, sessions, plansByMeso: new Map([["m", plan]]), rules });
  it("solo completadas y sin deload, en orden, con e1RM y carga tope", () => {
    expect(t.map((p) => p.sessionId)).toEqual(["a", "b"]);
    expect(t[1].topLoadKg).toBe(82.5);
    expect(t[1].e1rmKg).toBeGreaterThan(t[0].e1rmKg);
    expect(t[0].trackKey).not.toBe("?");
  });
});

describe("weeklyReport (A3.3)", () => {
  it("cuenta sesiones, minutos y series por músculo hechas vs planificadas", () => {
    const sessions = [S("a", 0, 0, { startedAt: "2026-01-01T10:00:00Z", completedAt: "2026-01-01T11:00:00Z" }), S("b", 0, 1, { status: "skipped" })];
    const logs = sessionLogs({ sessionId: "a", exerciseId: "bench", sets: 3, loadKg: 80, reps: 8, rir: 2, timestamp: "2026-01-01T10:10:00Z" });
    const r = weeklyReport({ plan, sessions, logs, exercises, weekIndex: 0, rules });
    expect(r).toMatchObject({ sessionsCompleted: 1, sessionsSkipped: 1, minutes: 60 });
    const chest = r.byMuscle.find((m) => m.muscle === "chest")!;
    expect(chest.done).toBe(3);
    expect(chest.planned).toBeGreaterThan(chest.done);
  });
});

describe("loadAdherence (A3.4)", () => {
  const mk = (target: number, actual: number, newFormat = true) => ({
    ...sessionLogs({ sessionId: "s", exerciseId: "bench", sets: 1, loadKg: actual, reps: 8, rir: 2, timestamp: "2026-01-01T10:00:00Z" })[0],
    targetLoadKg: target,
    ...(newFormat ? { rirReported: false } : {}),
  });
  it("mide a objetivo / por encima / por debajo y el desvío medio", () => {
    const a = loadAdherence([mk(100, 100), mk(100, 105), mk(100, 95), mk(100, 100)])!;
    expect(a).toMatchObject({ samples: 4, pctAtTarget: 50, pctAbove: 25, pctBelow: 25, meanDeltaPct: 0 });
  });
  it("ignora registros del formato viejo (targetLoadKg copiaba la real)", () => {
    expect(loadAdherence([mk(100, 100, false)])).toBeNull();
  });
});

describe("tendencia de peso y deuda de sueño (A3.5)", () => {
  it("EMA suaviza", () => {
    expect(ema([80, 82, 80], 0.5)).toEqual([80, 81, 80.5]);
  });
  it("deuda de sueño = noches seguidas sin el mínimo, null sin check-in", () => {
    const c = (sessionId: string, sleptMinimum: boolean) => ({ id: sessionId, sessionId, date: "", sleptMinimum, proteinSufficient: null, energyBalance: null }) as Checkin;
    const m = new Map([["a", c("a", false)], ["b", c("b", false)], ["d", c("d", true)]]);
    expect(sleepDebtBySession(["a", "b", "x", "d"], m)).toEqual([1, 2, null, 0]);
  });
  it("delta de reps a carga fija contra la sesión previa del mismo día", () => {
    const l = (id: string, reps: number) => sessionLogs({ sessionId: id, exerciseId: "bench", sets: 2, loadKg: 80, reps, rir: 2, timestamp: "2026-01-01T10:00:00Z" });
    expect(repDeltaBySession([
      { sessionId: "a", dayKey: "0", logs: l("a", 10) },
      { sessionId: "b", dayKey: "1", logs: l("b", 6) },
      { sessionId: "c", dayKey: "0", logs: l("c", 8) },
    ])).toEqual([null, null, -2]);
  });
});

describe("agenda (A3.2)", () => {
  it("asigna fechas solo en los días elegidos, desde el inicio", () => {
    // 2026-11-09 es lunes; L-X-V = 1,3,5
    expect(scheduleDates(4, "2026-11-09", [1, 3, 5])).toEqual(["2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16"]);
  });
  it("días entre fechas", () => {
    expect(daysBetween("2026-11-09", "2026-11-16")).toBe(7);
    expect(daysBetween("2026-11-09T23:00:00Z", "2026-11-10")).toBe(1);
  });
});
