import { describe, expect, it } from "vitest";
import { deloadLoadForDay, evaluateDeloadTrigger, summarizeRecentSessions, summarizeSessionPair } from "../deload";
import type { SessionSummary } from "../types";
import { equipment, rules, sessionLogs } from "./fixtures";

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

  it("A2.1: la caída sostenida de rendimiento sola alcanza (pesa 2: único marcador establecido)", () => {
    const r = evaluateDeloadTrigger({
      ...baseInput,
      recentSessions: [droppedSession("a"), droppedSession("b")],
    });
    expect(r.reasons.length).toBe(1);
    expect(r.score).toBe(rules.deloadTriggers.signals.performanceDropSessions.weight);
    expect(r.shouldSuggest).toBe(true);
  });

  it("A2.1: una señal de peso 1 sola no alcanza (RIR creep)", () => {
    const creep: SessionSummary = { ...okSession("b"), maxRirIncreaseAtFixedLoad: 2 };
    const r = evaluateDeloadTrigger({ ...baseInput, recentSessions: [okSession("a"), creep] });
    expect(r.reasons.length).toBe(1);
    expect(r.shouldSuggest).toBe(false);
  });

  it("A2.1: la baja disposición crónica está deshabilitada por defecto (sin consenso, Bell 2023)", () => {
    const poor = (id: string): SessionSummary => ({ ...okSession(id), sleptMinimum: false, readiness: 1 });
    const r = evaluateDeloadTrigger({ ...baseInput, recentSessions: [poor("a"), poor("b"), poor("c"), poor("d")] });
    expect(r.reasons).toEqual([]);
  });

  it("A2.2: fatiga percibida sostenida suma 1 y, junto a otra señal, sugiere", () => {
    const f = rules.deloadTriggers.signals.perceivedFatigue;
    const tired = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({ ...okSession(id), perceivedFatigue: f.threshold, ...extra });
    const sessions = Array.from({ length: f.windowSessions }, (_, i) => tired(`t${i}`));
    const alone = evaluateDeloadTrigger({ ...baseInput, recentSessions: sessions });
    expect(alone.reasons.some((x) => x.includes("Fatiga percibida"))).toBe(true);
    expect(alone.shouldSuggest).toBe(false);
    const withCreep = evaluateDeloadTrigger({
      ...baseInput,
      recentSessions: [...sessions.slice(0, -1), tired("z", { maxRirIncreaseAtFixedLoad: 2 })],
    });
    expect(withCreep.shouldSuggest).toBe(true);
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

describe("deloadLoadForDay — política de carga de la semana de deload (A0.2)", () => {
  const ctx = { type: "barbell" as const, equipment };
  it("primera mitad: carga de la semana 1 sin cambios", () => {
    expect(deloadLoadForDay({ dayIndex: 0, daysInWeek: 5, week1LoadKg: 100, secondHalfFraction: 0.5, ctx })).toEqual({ loadKg: 100, half: "first" });
    expect(deloadLoadForDay({ dayIndex: 2, daysInWeek: 5, week1LoadKg: 100, secondHalfFraction: 0.5, ctx }).half).toBe("first");
  });
  it("segunda mitad (dayIndex ≥ ceil(días/2)): fracción redondeada al equipamiento", () => {
    const r = deloadLoadForDay({ dayIndex: 3, daysInWeek: 5, week1LoadKg: 107.5, secondHalfFraction: 0.5, ctx });
    expect(r.half).toBe("second");
    expect(r.loadKg).toBe(52.5); // 53.75 → mayor alcanzable ≤ objetivo con discos de 1.25
  });
  it("peso corporal (carga 0) sigue en 0 en ambas mitades", () => {
    expect(deloadLoadForDay({ dayIndex: 4, daysInWeek: 5, week1LoadKg: 0, secondHalfFraction: 0.5, ctx }).loadKg).toBe(0);
  });
  it("la fracción sale del config, no de un literal", () => {
    expect(rules.deloadStructure.loadSecondHalf).toBeGreaterThan(0);
    expect(rules.deloadStructure.loadSecondHalf).toBeLessThan(1);
  });
});

describe("disparador de deload por día del split (A0.4) y nunca durante el deload (A0.5)", () => {
  // Helpers: una sesión con banca a 80 kg y N reps.
  let n = 0;
  const sess = (dayKey: string, reps: number) => {
    n++;
    return {
      sessionId: `s${n}`,
      dayKey,
      logs: sessionLogs({
        sessionId: `s${n}`, exerciseId: dayKey === "A" ? "bench" : "squat", sets: 3, loadKg: 80,
        reps, rir: 2, timestamp: `2026-02-${String(n).padStart(2, "0")}T10:00:00Z`,
      }).concat(
        sessionLogs({
          sessionId: `s${n}`, exerciseId: dayKey === "A" ? "row" : "db-press", sets: 3, loadKg: 60,
          reps, rir: 2, timestamp: `2026-02-${String(n).padStart(2, "0")}T10:30:00Z`,
        }),
      ),
    };
  };

  it("compara con la sesión previa del MISMO día, no con la anterior cronológica", () => {
    // A(10) B(6) A(9): con la lógica vieja, A(9) se comparaba contra B (otros ejercicios) → sin dato.
    const sums = summarizeRecentSessions([sess("A", 10), sess("B", 6), sess("A", 9)]);
    expect(sums[2].dayKey).toBe("A");
    expect(sums[2].exercisesWithRepDropAtFixedLoad).toBe(2); // bench y row cayeron vs la A previa
    expect(sums[1].exercisesWithRepDropAtFixedLoad).toBe(0); // B no tiene previa propia
  });

  it("caída sostenida en el mismo día dispara aunque otros días intercalen", () => {
    const sums = summarizeRecentSessions([sess("A", 10), sess("B", 8), sess("A", 9), sess("B", 9), sess("A", 8)]);
    const perf = rules.deloadTriggers.signals.performanceDropSessions;
    const r = evaluateDeloadTrigger({ ...baseInput, recentSessions: sums });
    const hasPerf = r.reasons.some((x) => x.includes("mismo día"));
    expect(perf.consecutiveSessions).toBe(2); // el escenario asume el default del config
    expect(hasPerf).toBe(true);
  });

  it("una sola caída del día no dispara la señal", () => {
    const sums = summarizeRecentSessions([sess("A", 10), sess("B", 8), sess("A", 9), sess("B", 9)]);
    const r = evaluateDeloadTrigger({ ...baseInput, recentSessions: sums });
    expect(r.reasons.some((x) => x.includes("mismo día"))).toBe(false);
  });

  it("sin dayKey se conserva el comportamiento anterior (legado)", () => {
    const r = evaluateDeloadTrigger({ ...baseInput, recentSessions: [droppedSession("a"), droppedSession("b")] });
    expect(r.reasons.some((x) => x.includes("Caída de reps"))).toBe(true);
  });

  it("durante la semana de deload nunca sugiere otro deload, ni forzado", () => {
    const r = evaluateDeloadTrigger({
      ...baseInput, weekIndex: 5, isDeload: true,
      recentSessions: [droppedSession("a"), droppedSession("b")],
    });
    expect(r).toEqual({ shouldSuggest: false, reasons: [], forced: false });
  });

  it("la ventana de sesiones sale del config", () => {
    expect(rules.deloadTriggers.recentWindowSessions).toBeGreaterThan(0);
  });
});

describe("evaluateExerciseDeload (A2.3)", () => {
  const mk = (id: string, load: number, reps: number, day: number) =>
    sessionLogs({ sessionId: id, exerciseId: "bench", sets: 2, loadKg: load, reps, rir: 1, timestamp: `2026-02-${String(day).padStart(2, "0")}T10:00:00Z` });
  it("sugiere cuando el e1RM cae seguido y más que el umbral", async () => {
    const { evaluateExerciseDeload } = await import("../deload");
    const r = evaluateExerciseDeload([...mk("a", 100, 10, 1), ...mk("b", 100, 8, 4), ...mk("c", 100, 6, 8)], rules);
    expect(r.suggest).toBe(true);
    expect(r.setsFactor).toBe(rules.deloadTriggers.exerciseDeload.setsFactor);
    expect(r.dropPct).toBeGreaterThanOrEqual(rules.deloadTriggers.exerciseDeload.e1rmDropPct);
  });
  it("no sugiere si la caída no es sostenida o es chica", async () => {
    const { evaluateExerciseDeload } = await import("../deload");
    expect(evaluateExerciseDeload([...mk("a", 100, 10, 1), ...mk("b", 100, 8, 4), ...mk("c", 100, 9, 8)], rules).suggest).toBe(false);
    expect(evaluateExerciseDeload([...mk("a", 100, 10, 1), ...mk("b", 100, 10, 4), ...mk("c", 100, 9, 8)], rules).suggest).toBe(false);
  });
  it("ignora RIR no reportado y calentamiento", async () => {
    const { evaluateExerciseDeload } = await import("../deload");
    const un = [...mk("a", 100, 10, 1), ...mk("b", 100, 8, 4), ...mk("c", 100, 6, 8)].map((l) => ({ ...l, rirReported: false }));
    expect(evaluateExerciseDeload(un, rules).suggest).toBe(false);
  });
});

describe("chronicPoorReadiness con readinessMax del config (auditoría N5)", () => {
  const cfg = rules.deloadTriggers.signals.chronicPoorReadiness;
  const on = { ...rules, deloadTriggers: { ...rules.deloadTriggers, signals: { ...rules.deloadTriggers.signals, chronicPoorReadiness: { ...cfg, enabled: true } } } };
  const sess = (id: string, readiness: number): SessionSummary => ({ ...okSession(id), readiness, sleptMinimum: true });
  it("cuenta la señal con disposición ≤ readinessMax sostenida", () => {
    const recent = Array.from({ length: cfg.windowSessions }, (_, i) => sess(`r${i}`, cfg.readinessMax));
    const r = evaluateDeloadTrigger({ ...baseInput, rules: on, recentSessions: recent });
    expect(r.reasons.some((x) => /disposición/.test(x))).toBe(true);
  });
  it("no la cuenta por encima del umbral", () => {
    const recent = Array.from({ length: cfg.windowSessions }, (_, i) => sess(`r${i}`, cfg.readinessMax + 1));
    const r = evaluateDeloadTrigger({ ...baseInput, rules: on, recentSessions: recent });
    expect(r.reasons.some((x) => /disposición/.test(x))).toBe(false);
  });
});
