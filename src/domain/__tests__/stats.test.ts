import { describe, expect, it } from "vitest";
import { computeMesoStats } from "../stats";
import { generateMesocycle } from "../mesocycle";
import { baseWeek, exercises, rules, sessionLogs } from "./fixtures";

const plan = generateMesocycle({
  baseWeek,
  exercises,
  profile: "intermediate",
  progressionModel: "double",
  numAccumulationWeeks: 3,
  prioritizedMuscles: [],
  rules,
});

const sessions = [
  { id: "w0", weekIndex: 0, status: "completed" as const },
  { id: "w1", weekIndex: 1, status: "completed" as const },
  { id: "w2", weekIndex: 2, status: "skipped" as const },
];

const setLogs = [
  ...sessionLogs({ sessionId: "w0", exerciseId: "bench", sets: 3, loadKg: 80, reps: 8, rir: 2, timestamp: "2026-01-01T10:00:00Z" }),
  ...sessionLogs({ sessionId: "w1", exerciseId: "bench", sets: 3, loadKg: 82.5, reps: 9, rir: 1, timestamp: "2026-01-08T10:00:00Z" }),
];

describe("computeMesoStats", () => {
  const stats = computeMesoStats({ plan, sessions, setLogs, checkins: [], exercises, rules });

  it("calcula progresión de 1RM positiva para bench", () => {
    const bench = stats.perExercise.find((e) => e.exerciseId === "bench")!;
    expect(bench.lastEst1RmKg).toBeGreaterThan(bench.firstEst1RmKg);
    expect(bench.deltaPct).toBeGreaterThan(0);
  });

  it("reporta volumen completado vs planeado", () => {
    expect(stats.volume.plannedFractionalSets).toBeGreaterThan(0);
    expect(stats.volume.completedFractionalSets).toBeGreaterThan(0);
    expect(stats.volume.completionPct).toBeGreaterThan(0);
  });

  it("calcula adherencia (1 completada real de 3, 1 saltada)", () => {
    expect(stats.adherence.completed).toBe(2);
    expect(stats.adherence.skipped).toBe(1);
    expect(stats.adherence.totalPlanned).toBe(3);
  });

  it("incluye siempre el aviso de n pequeño", () => {
    expect(stats.smallSampleWarning).toBe(rules.statsPolicy.smallSampleWarning);
    expect(stats.smallSampleWarning.length).toBeGreaterThan(0);
  });

  it("calcula deriva de RIR por semana", () => {
    expect(stats.rirDrift.length).toBeGreaterThan(0);
    expect(stats.rirDrift[0]).toHaveProperty("meanDiff");
  });

  it("no expone métricas de vanidad (pump/soreness) en el output", () => {
    const json = JSON.stringify(stats);
    expect(json).not.toContain("pump");
    expect(json).not.toContain("soreness");
  });
});
