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

describe("computeMesoStats — Δ1RM sin deload y por pista (A0.3)", () => {
  // Meso de 3 semanas + deload (semana índice 3). Día A con intensidad
  // fuerte y la misma semana base repetida como día liviano.
  const bw = {
    days: [
      { ...baseWeek.days[0], label: "Fuerte", intensity: "heavy" as const },
      { ...baseWeek.days[0], label: "Liviano", intensity: "light" as const },
    ],
  };
  const p = generateMesocycle({
    baseWeek: bw, exercises, profile: "intermediate", progressionModel: "double",
    numAccumulationWeeks: 3, prioritizedMuscles: [], rules,
  });
  const deloadWeek = p.weeks.findIndex((w) => w.isDeload);
  const ses = (id: string, weekIndex: number, dayIndex: number) => ({ id, weekIndex, dayIndex, status: "completed" as const });
  const sessions2 = [ses("h0", 0, 0), ses("l0", 0, 1), ses("h1", 1, 0), ses("l1", 1, 1), ses("d0", deloadWeek, 0)];
  const logs = [
    ...sessionLogs({ sessionId: "h0", exerciseId: "bench", sets: 3, loadKg: 90, reps: 6, rir: 1, timestamp: "2026-01-01T10:00:00Z" }),
    ...sessionLogs({ sessionId: "l0", exerciseId: "bench", sets: 3, loadKg: 70, reps: 12, rir: 3, timestamp: "2026-01-03T10:00:00Z" }),
    ...sessionLogs({ sessionId: "h1", exerciseId: "bench", sets: 3, loadKg: 92.5, reps: 6, rir: 1, timestamp: "2026-01-08T10:00:00Z" }),
    ...sessionLogs({ sessionId: "l1", exerciseId: "bench", sets: 3, loadKg: 72.5, reps: 12, rir: 3, timestamp: "2026-01-10T10:00:00Z" }),
    // deload: liviano a propósito; NO debe aparecer como retroceso
    ...sessionLogs({ sessionId: "d0", exerciseId: "bench", sets: 2, loadKg: 45, reps: 5, rir: 3, timestamp: "2026-01-22T10:00:00Z" }),
  ];
  const s = computeMesoStats({ plan: p, sessions: sessions2, setLogs: logs, checkins: [], exercises, rules });
  const bench = s.perExercise.filter((e) => e.exerciseId === "bench");

  it("una entrada por pista, etiquetada, ambas con Δ positivo (el deload no cuenta)", () => {
    expect(bench).toHaveLength(2);
    expect(bench.map((b) => b.track).sort()).toEqual(
      [rules.dayIntensity.heavy.label.toLowerCase(), rules.dayIntensity.light.label.toLowerCase()].sort(),
    );
    for (const b of bench) expect(b.deltaPct).toBeGreaterThan(0);
  });

  it("sin dayIndex (llamadas viejas) cae a una sola pista por ejercicio y sin etiqueta", () => {
    const legacy = computeMesoStats({
      plan: p, sessions: sessions2.map(({ dayIndex: _d, ...r }) => r), setLogs: logs, checkins: [], exercises, rules,
    });
    const b = legacy.perExercise.filter((e) => e.exerciseId === "bench");
    expect(b).toHaveLength(1);
    expect(b[0].track).toBeUndefined();
  });

  it("las sesiones saltadas no cuentan para el Δ", () => {
    const withSkip = computeMesoStats({
      plan: p,
      sessions: sessions2.map((x) => (x.id === "h1" ? { ...x, status: "skipped" as const } : x)),
      setLogs: logs, checkins: [], exercises, rules,
    });
    const heavy = withSkip.perExercise.find((e) => e.exerciseId === "bench" && e.track === rules.dayIntensity.heavy.label.toLowerCase());
    expect(heavy).toBeUndefined(); // queda una sola sesión fuerte válida: sin Δ posible
  });
});
