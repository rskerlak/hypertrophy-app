// A5.1 — Memoria corta: la pista de progresión continúa entre mesos; un cambio
// de pista o una pausa larga re-anclan la carga desde el e1RM real.

import { describe, expect, it } from "vitest";
import { trackHistory, type TrackMesoRef, type TrackSessionRef } from "../history";
import { nextPrescription } from "../progression";
import { estimate1RM } from "../oneRepMax";
import { suggestExerciseSwap } from "../swap";
import type { MesocyclePlan, PlannedSlot, ProgressionModel, SetLog } from "../types";
import { equipment, exercisesById, rules, sessionLogs } from "./fixtures";

const slot = (exerciseId: string, min: number, max: number, load = 80): PlannedSlot => ({
  exerciseId,
  sets: 3,
  repRange: { min, max },
  targetRir: 2,
  targetLoadKg: load,
});

/** Plan de `weeks` semanas de acumulación + 1 de deload, un solo día con los slots dados. */
function plan(slots: PlannedSlot[], weeks = 2, model: ProgressionModel = "double"): MesocyclePlan {
  return {
    progressionModel: model,
    numAccumulationWeeks: weeks,
    weeks: Array.from({ length: weeks + 1 }, (_, w) => ({
      weekIndex: w,
      isDeload: w === weeks,
      days: [{ label: "A", slots: slots.map((s) => ({ ...s })) }],
      targetVolumeByMuscle: {},
    })),
  };
}

const meso = (p: MesocyclePlan): TrackMesoRef => ({ plan: p, progressionModel: p.progressionModel, numAccumulationWeeks: p.numAccumulationWeeks });

function session(id: string, mesocycleId: string, weekIndex: number, completedAt?: string, extra: Partial<TrackSessionRef> = {}): TrackSessionRef {
  return { id, mesocycleId, weekIndex, dayIndex: 0, status: completedAt ? "completed" : "pending", isDeload: false, completedAt, ...extra };
}

const logs = (sessionId: string, at: string, loadKg: number, reps: number, rir = 2, targetReps = reps): SetLog[] =>
  sessionLogs({ sessionId, exerciseId: "bench", sets: 3, loadKg, reps, rir, targetReps, targetRir: 2, timestamp: at });

const m1 = plan([slot("bench", 10, 12)]);
const m2 = plan([slot("bench", 10, 12, 60)]);
const m3 = plan([slot("bench", 6, 8, 60)]);
const mesos = new Map([
  ["m1", meso(m1)],
  ["m2", meso(m2)],
  ["m3", meso(m3)],
]);

const s1 = session("s1", "m1", 0, "2026-09-01T10:00:00Z");
const s2 = session("s2", "m1", 1, "2026-09-08T10:00:00Z");
const allLogs = [...logs("s1", "2026-09-01T10:00:00Z", 80, 10), ...logs("s2", "2026-09-08T10:00:00Z", 80, 12, 2, 11)];
const today = "2026-09-15T10:00:00Z";

const prescribe = (r: ReturnType<typeof trackHistory>, s: PlannedSlot, currentLoadKg: number) =>
  nextPrescription({
    exerciseHistory: r.history,
    model: "double",
    targetRir: s.targetRir,
    repRange: s.repRange,
    currentLoadKg,
    equipmentType: "barbell",
    equipment,
    anchor:
      r.anchor && (r.continuity === "track-changed" || r.continuity === "gap")
        ? { logs: r.anchor, reason: r.continuity, ageDays: r.anchorAgeDays }
        : undefined,
    rules,
  });

describe("trackHistory (A5.1.1)", () => {
  it("misma pista en el meso siguiente: continúa desde la última sesión real", () => {
    const r = trackHistory({
      logs: allLogs,
      sessions: [s1, s2, session("n1", "m2", 0)],
      mesos,
      current: { mesocycleId: "m2", weekIndex: 0, dayIndex: 0, slotIndex: 0, slot: m2.weeks[0].days[0].slots[0] },
      today,
      rules,
    });
    expect(r.continuity).toBe("same-track");
    expect(new Set(r.history.map((l) => l.sessionId))).toEqual(new Set(["s1", "s2"]));
    expect(r.last).toMatchObject({ sessionId: "s2", mesocycleId: "m1", weekIndex: 1 });
    // Terminó 80×12 a RIR 2 en 10–12: el meso nuevo pide la subida, no los 60 kg de su semana base.
    const p = prescribe(r, m2.weeks[0].days[0].slots[0], 80);
    expect(p.explain.rule).toMatch(/^double-ceiling/);
    expect(p.nextLoadKg).toBe(82.5);
    expect(p.nextReps).toBe(10);
  });

  it("rango distinto: track-changed, sin historial y re-anclaje desde el e1RM", () => {
    const r = trackHistory({
      logs: allLogs,
      sessions: [s1, s2],
      mesos,
      current: { mesocycleId: "m3", weekIndex: 0, dayIndex: 0, slotIndex: 0, slot: m3.weeks[0].days[0].slots[0] },
      today,
      rules,
    });
    expect(r.continuity).toBe("track-changed");
    expect(r.history).toEqual([]);
    expect(r.anchor?.[0].sessionId).toBe("s2");
    const p = prescribe(r, m3.weeks[0].days[0].slots[0], 60);
    expect(p.explain.rule).toBe("track-reanchor");
    expect(p.nextReps).toBe(6);
    // 80×12 @2 → e1RM ≈ 80·(1+c·14); para 6 reps @2 la carga sube por encima de 80 y nunca queda en 60.
    expect(p.nextLoadKg).toBeGreaterThan(80);
    expect(p.explain.inputs.e1rmKg).toBeCloseTo(estimate1RM(80, 12, 2, rules), 1);
  });

  it("pausa mayor a maxGapDays: gap y re-anclaje con descuento", () => {
    const later = "2026-10-20T10:00:00Z"; // 42 días después
    const base = {
      logs: allLogs,
      sessions: [s1, s2],
      mesos,
      current: { mesocycleId: "m2", weekIndex: 0, dayIndex: 0, slotIndex: 0, slot: m2.weeks[0].days[0].slots[0] },
      rules,
    };
    const r = trackHistory({ ...base, today: later });
    expect(r.continuity).toBe("gap");
    expect(r.history).toEqual([]);
    expect(r.gapDays).toBe(42);
    const p = prescribe(r, m2.weeks[0].days[0].slots[0], 80);
    expect(p.explain.rule).toBe("gap-reanchor");
    expect(p.explain.inputs.factor).toBe(rules.progression.continuity.gapE1rmFactor);
    // El mismo caso sin descuento daría una carga mayor o igual.
    const noGap = nextPrescription({
      exerciseHistory: [],
      model: "double",
      targetRir: 2,
      repRange: { min: 10, max: 12 },
      currentLoadKg: 80,
      equipmentType: "barbell",
      equipment,
      anchor: { logs: r.anchor!, reason: "track-changed", ageDays: 0 },
      rules,
    });
    expect(p.nextLoadKg).toBeLessThanOrEqual(noGap.nextLoadKg);
  });

  it("pista vieja pero el ejercicio se hizo hace poco en otra pista: track-changed, sin descuento", () => {
    // 8–12 hecho hace 60 días; 10–12 hace 5 días. Volver a 8–12 no es una pausa.
    const m812 = plan([slot("bench", 8, 12)]);
    const ms = new Map([...mesos, ["m812", meso(m812)]]);
    const old = session("o1", "m812", 0, "2026-07-17T10:00:00Z");
    const recent = session("r1", "m1", 0, "2026-09-10T10:00:00Z");
    const r = trackHistory({
      logs: [...logs("o1", "2026-07-17T10:00:00Z", 70, 10), ...logs("r1", "2026-09-10T10:00:00Z", 80, 11)],
      sessions: [old, recent],
      mesos: ms,
      current: { mesocycleId: "m812", weekIndex: 1, dayIndex: 0, slotIndex: 0, slot: m812.weeks[0].days[0].slots[0] },
      today,
      rules,
    });
    expect(r.continuity).toBe("track-changed");
    expect(r.anchor?.[0].sessionId).toBe("r1");
    expect(r.anchorAgeDays).toBe(5);
    const p = prescribe(r, m812.weeks[0].days[0].slots[0], 70);
    expect(p.explain.rule).toBe("track-reanchor");
    expect(p.explain.inputs.factor).toBe(1);
  });

  it("deload y sesiones saltadas nunca entran", () => {
    const deload = session("d1", "m1", 2, "2026-09-12T10:00:00Z", { isDeload: true });
    const skipped = session("k1", "m1", 1, undefined, { status: "skipped" });
    const r = trackHistory({
      logs: [...allLogs, ...logs("d1", "2026-09-12T10:00:00Z", 60, 8), ...logs("k1", "2026-09-10T10:00:00Z", 50, 5)],
      sessions: [s1, s2, deload, skipped],
      mesos,
      current: { mesocycleId: "m2", weekIndex: 0, dayIndex: 0, slotIndex: 0, slot: m2.weeks[0].days[0].slots[0] },
      today,
      rules,
    });
    expect(new Set(r.history.map((l) => l.sessionId))).toEqual(new Set(["s1", "s2"]));
    expect(r.anchor?.[0].sessionId).toBe("s2");
  });

  it("continuity.enabled=false: cada meso arranca de cero (comportamiento anterior)", () => {
    const off = { ...rules, progression: { continuity: { ...rules.progression.continuity, enabled: false } } };
    const r = trackHistory({
      logs: allLogs,
      sessions: [s1, s2],
      mesos,
      current: { mesocycleId: "m2", weekIndex: 0, dayIndex: 0, slotIndex: 0, slot: m2.weeks[0].days[0].slots[0] },
      today,
      rules: off,
    });
    expect(r.continuity).toBe("none");
    expect(r.history).toEqual([]);
    expect(r.anchor).toBeUndefined();
    // Dentro del mismo meso sigue funcionando.
    const same = trackHistory({
      logs: allLogs,
      sessions: [s1, s2],
      mesos,
      current: { mesocycleId: "m1", weekIndex: 2, dayIndex: 0, slotIndex: 0, slot: m1.weeks[0].days[0].slots[0] },
      today,
      rules: off,
    });
    expect(same.continuity).toBe("same-track");
    expect(same.history).toHaveLength(6);
  });

  it("viendo una sesión ya completada, no entran sesiones de otros mesos posteriores", () => {
    const later = session("x1", "m2", 0, "2026-09-20T10:00:00Z");
    const r = trackHistory({
      logs: [...allLogs, ...logs("x1", "2026-09-20T10:00:00Z", 85, 10)],
      sessions: [s1, s2, later],
      mesos,
      current: { mesocycleId: "m1", weekIndex: 1, dayIndex: 0, slotIndex: 0, slot: m1.weeks[0].days[0].slots[0], completedAt: "2026-09-08T10:00:00Z" },
      today: "2026-09-25T10:00:00Z",
      rules,
    });
    expect(new Set(r.history.map((l) => l.sessionId))).toEqual(new Set(["s1"]));
  });

  it("inclusive incluye la propia sesión (análisis post-sesión)", () => {
    const r = trackHistory({
      logs: allLogs,
      sessions: [s1, s2],
      mesos,
      current: { mesocycleId: "m1", weekIndex: 1, dayIndex: 0, slotIndex: 0, slot: m1.weeks[0].days[0].slots[0], completedAt: s2.completedAt },
      today,
      inclusive: true,
      rules,
    });
    expect(new Set(r.history.map((l) => l.sessionId))).toEqual(new Set(["s1", "s2"]));
  });

  it("día fuerte y liviano del mismo ejercicio en otro meso: solo la misma intensidad", () => {
    const heavyLight: MesocyclePlan = {
      ...plan([slot("bench", 10, 12)]),
      weeks: plan([slot("bench", 10, 12)]).weeks.map((w) => ({
        ...w,
        days: [
          { label: "Fuerte", intensity: "heavy" as const, slots: [slot("bench", 10, 12)] },
          { label: "Liviano", intensity: "light" as const, slots: [slot("bench", 10, 12)] },
        ],
      })),
    };
    const ms = new Map([...mesos, ["hl", meso(heavyLight)]]);
    const heavy = { ...session("h1", "hl", 0, "2026-09-01T10:00:00Z"), dayIndex: 0 };
    const light = { ...session("l1", "hl", 0, "2026-09-03T10:00:00Z"), dayIndex: 1 };
    const r = trackHistory({
      logs: [...logs("h1", "2026-09-01T10:00:00Z", 90, 10), ...logs("l1", "2026-09-03T10:00:00Z", 70, 12)],
      sessions: [heavy, light],
      mesos: ms,
      current: { mesocycleId: "m2", weekIndex: 0, dayIndex: 0, slotIndex: 0, slot: m2.weeks[0].days[0].slots[0], intensity: "light" },
      today,
      rules,
    });
    expect(r.continuity).toBe("same-track");
    expect(new Set(r.history.map((l) => l.sessionId))).toEqual(new Set(["l1"]));
  });

  it("peso corporal nunca re-ancla", () => {
    const p = nextPrescription({
      exerciseHistory: [],
      model: "double",
      targetRir: 2,
      repRange: { min: 8, max: 12 },
      currentLoadKg: 0,
      equipmentType: "bodyweight",
      equipment,
      anchor: { logs: logs("bw", "2026-09-01T10:00:00Z", 80, 15), reason: "track-changed" },
      rules,
    });
    expect(p.explain.rule).toBe("no-history");
  });
});

describe("estancamiento con la pista continua (A5.1.3)", () => {
  const flat = (id: string, mesoId: string, w: number, at: string) => ({
    s: session(id, mesoId, w, at),
    l: logs(id, at, 80, 10, 2, 10),
  });
  const a = flat("a", "m1", 0, "2026-09-01T10:00:00Z");
  const b = flat("b", "m1", 1, "2026-09-08T10:00:00Z");
  const c = flat("c", "m2", 0, "2026-09-20T10:00:00Z");
  const d = flat("d", "m2", 1, "2026-09-27T10:00:00Z");
  const all = [a, b, c, d];
  const bench = exercisesById.get("bench")!;
  const candidates = [exercisesById.get("db-press")!, exercisesById.get("fly")!];

  it("sin progreso a ambos lados del cambio de meso, misma pista → sugiere swap", () => {
    const r = trackHistory({
      logs: all.flatMap((x) => x.l),
      sessions: all.map((x) => x.s),
      mesos,
      current: { mesocycleId: "m2", weekIndex: 1, dayIndex: 0, slotIndex: 0, slot: m2.weeks[0].days[0].slots[0], completedAt: d.s.completedAt },
      today: "2026-09-27T12:00:00Z",
      inclusive: true,
      rules,
    });
    expect(suggestExerciseSwap({ exercise: bench, candidates, history: r.history, rules }).suggest).toBe(true);
  });

  it("si el meso nuevo cambió de rango, el conteo arranca de cero → no sugiere", () => {
    const m3Sessions = [c, d].map((x) => ({ ...x, s: { ...x.s, mesocycleId: "m3" } }));
    const r = trackHistory({
      logs: [...a.l, ...b.l, ...m3Sessions.flatMap((x) => x.l)],
      sessions: [a.s, b.s, ...m3Sessions.map((x) => x.s)],
      mesos,
      current: { mesocycleId: "m3", weekIndex: 1, dayIndex: 0, slotIndex: 0, slot: m3.weeks[0].days[0].slots[0], completedAt: d.s.completedAt },
      today: "2026-09-27T12:00:00Z",
      inclusive: true,
      rules,
    });
    expect(new Set(r.history.map((l) => l.sessionId))).toEqual(new Set(["c", "d"]));
    expect(suggestExerciseSwap({ exercise: bench, candidates, history: r.history, rules }).suggest).toBe(false);
  });
});

// ---------------- Auditoría A5-11 ----------------
import { nextPrescription as np11, progressionTrackKey } from "../progression";
import { rules as rules11, equipment as eq11, sessionLogs as logs11 } from "./fixtures";

describe("auditoría A5-11: bloques entre mesos de distinta duración y pistas por modelo", () => {
  // Último meso de 3 semanas: la semana 3 (índice 2) es intensificación (2/3 > 0,6).
  // El meso nuevo de 5 semanas arranca en acumulación: hay cambio de fase y se re-ancla.
  const h = logs11({ sessionId: "prev", exerciseId: "x", sets: 3, loadKg: 90, reps: 6, rir: 1, targetReps: 6, targetRir: 1, timestamp: "2026-10-01T10:00:00Z" });
  const base = { exerciseHistory: h, model: "block" as const, targetRir: 2, repRange: { min: 8, max: 15 }, currentLoadKg: 90, equipmentType: "machine" as const, equipment: eq11, weekIndex: 0, historyWeekIndex: 2, numAccumulationWeeks: 5, rules: rules11 };
  it("con historyNumAccumulationWeeks del meso de origen detecta el cambio de fase", () => {
    expect(np11({ ...base, historyNumAccumulationWeeks: 3 }).explain.rule).toBe("block-phase-reanchor");
  });
  it("sin él, mediría la semana vieja contra la duración nueva y no lo vería", () => {
    expect(np11(base).explain.rule).not.toBe("block-phase-reanchor");
  });
  it("lineal, doble y APRE con el mismo rango comparten pista; DUP por zona y bloques no", () => {
    const slot = { repRange: { min: 8, max: 12 } };
    expect(progressionTrackKey({ slot }, "linear")).toBe(progressionTrackKey({ slot }, "double"));
    expect(progressionTrackKey({ slot: { ...slot, dayType: "heavy" as never } }, "dup")).not.toBe(progressionTrackKey({ slot: { ...slot, dayType: "light" as never } }, "dup"));
    expect(progressionTrackKey({ slot }, "block")).not.toBe(progressionTrackKey({ slot }, "double"));
    expect(progressionTrackKey({ slot, intensity: "heavy" }, "double")).not.toBe(progressionTrackKey({ slot, intensity: "light" }, "double"));
  });
});
