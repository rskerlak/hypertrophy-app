// Historial y análisis (A3). Funciones puras: reciben datos ya leídos de los
// repos. Las fechas entran como ISO; nada lee el reloj del sistema.

import type { Rules } from "./rules";
import { estimate1RM } from "./oneRepMax";
import { progressionTrackKey } from "./progression";
import { addExerciseVolume, emptyVolume } from "./volume";
import { isRirReported, isWorkingSet, type Checkin, type Exercise, type MesocyclePlan, type SetLog } from "./types";

export interface SessionRef {
  id: string;
  mesocycleId: string;
  weekIndex: number;
  dayIndex: number;
  isDeload: boolean;
  status: "pending" | "completed" | "skipped";
  completedAt?: string;
  startedAt?: string;
}

// ---------------------------------------------------------------- A3.1

export interface ExercisePoint {
  sessionId: string;
  date: string;
  mesocycleId: string;
  /** Pista (intensidad + rango) para separar día fuerte / liviano en el gráfico. */
  trackKey: string;
  trackLabel: string;
  /** e1RM con RIR reportado si lo hay en la sesión (si no, con todas). */
  e1rmKg: number;
  e1rmFromReported: boolean;
  topLoadKg: number;
  repsAtTopLoad: number;
  sets: Array<{ loadKg: number; reps: number; rir: number; rirReported: boolean; kind?: string }>;
}

/**
 * Historial de un ejercicio a lo largo de TODOS los mesos: una entrada por
 * sesión completada (sin deload), en orden de fecha, con su pista.
 */
export function exerciseTimeline(input: {
  exerciseId: string;
  logs: SetLog[];
  sessions: SessionRef[];
  plansByMeso: Map<string, MesocyclePlan>;
  rules: Rules;
}): ExercisePoint[] {
  const { exerciseId, rules } = input;
  const byId = new Map(input.sessions.map((s) => [s.id, s]));
  const bySession = new Map<string, SetLog[]>();
  for (const l of input.logs) {
    if (l.exerciseId !== exerciseId || !isWorkingSet(l)) continue;
    const s = byId.get(l.sessionId);
    if (!s || s.status !== "completed" || s.isDeload) continue;
    bySession.set(l.sessionId, [...(bySession.get(l.sessionId) ?? []), l]);
  }
  const out: ExercisePoint[] = [];
  for (const [sid, sets] of bySession) {
    const s = byId.get(sid)!;
    const plan = input.plansByMeso.get(s.mesocycleId);
    const day = plan?.weeks[s.weekIndex]?.days[s.dayIndex];
    const slot = day?.slots.find((x) => x.exerciseId === exerciseId);
    const trackKey = slot && plan ? progressionTrackKey({ slot, intensity: day?.intensity }, plan.progressionModel) : "?";
    const trackLabel = day?.intensity
      ? rules.dayIntensity[day.intensity].label
      : slot
        ? `${slot.repRange.min}–${slot.repRange.max}`
        : "";
    const reported = sets.filter((l) => isRirReported(l) && l.actualLoadKg > 0);
    const use = reported.length > 0 ? reported : sets.filter((l) => l.actualLoadKg > 0);
    const e1rm = use.length ? Math.max(...use.map((l) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, rules))) : 0;
    const top = Math.max(...sets.map((l) => l.actualLoadKg));
    out.push({
      sessionId: sid,
      date: s.completedAt ?? sets[0].timestamp,
      mesocycleId: s.mesocycleId,
      trackKey,
      trackLabel,
      e1rmKg: Math.round(e1rm * 10) / 10,
      e1rmFromReported: reported.length > 0,
      topLoadKg: top,
      repsAtTopLoad: Math.max(...sets.filter((l) => l.actualLoadKg === top).map((l) => l.actualReps)),
      sets: [...sets]
        .sort((a, b) => a.setIndex - b.setIndex)
        .map((l) => ({ loadKg: l.actualLoadKg, reps: l.actualReps, rir: l.actualRir, rirReported: isRirReported(l), kind: l.kind })),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- A3.3

export interface WeeklyReport {
  weekIndex: number;
  isDeload: boolean;
  sessionsCompleted: number;
  sessionsPlanned: number;
  sessionsSkipped: number;
  minutes: number;
  /** Series fraccionadas de trabajo hechas vs planificadas por músculo. */
  byMuscle: Array<{ muscle: string; done: number; planned: number }>;
}

export function weeklyReport(input: {
  plan: MesocyclePlan;
  sessions: SessionRef[];
  logs: SetLog[];
  exercises: Exercise[];
  weekIndex: number;
  rules: Rules;
}): WeeklyReport {
  const { plan, weekIndex, rules } = input;
  const exById = new Map(input.exercises.map((e) => [e.id, e]));
  const week = plan.weeks[weekIndex];
  const weekSessions = input.sessions.filter((s) => s.weekIndex === weekIndex);
  const ids = new Set(weekSessions.filter((s) => s.status !== "skipped").map((s) => s.id));
  const planned = emptyVolume(rules);
  for (const d of week?.days ?? []) {
    for (const sl of d.slots) {
      const ex = exById.get(sl.exerciseId);
      if (ex) addExerciseVolume(planned, ex, sl.sets, rules);
    }
  }
  const done = emptyVolume(rules);
  for (const l of input.logs) {
    if (!ids.has(l.sessionId) || !isWorkingSet(l)) continue;
    const ex = exById.get(l.exerciseId);
    if (ex) addExerciseVolume(done, ex, 1, rules);
  }
  let minutes = 0;
  for (const s of weekSessions) {
    if (s.status === "completed" && s.startedAt && s.completedAt) {
      minutes += Math.max(0, (Date.parse(s.completedAt) - Date.parse(s.startedAt)) / 60000);
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    weekIndex,
    isDeload: !!week?.isDeload,
    sessionsCompleted: weekSessions.filter((s) => s.status === "completed").length,
    sessionsPlanned: weekSessions.length,
    sessionsSkipped: weekSessions.filter((s) => s.status === "skipped").length,
    minutes: Math.round(minutes),
    byMuscle: Object.keys(planned)
      .filter((m) => planned[m] > 0 || done[m] > 0)
      .map((m) => ({ muscle: m, done: round(done[m]), planned: round(planned[m]) }))
      .sort((a, b) => b.planned - a.planned),
  };
}

// ---------------------------------------------------------------- A3.4

export interface LoadAdherence {
  samples: number;
  pctAtTarget: number;
  pctAbove: number;
  pctBelow: number;
  /** Desvío medio de la carga real respecto de la prescrita (%). */
  meanDeltaPct: number;
}

/**
 * Adherencia a la carga PRESCRITA. Solo series de trabajo con carga y del
 * formato nuevo (A0.1 en adelante, marcadas con `rirReported` definido): antes
 * `targetLoadKg` copiaba la carga real y daría 100 % falso.
 */
export function loadAdherence(logs: SetLog[]): LoadAdherence | null {
  const usable = logs.filter((l) => isWorkingSet(l) && l.rirReported !== undefined && l.targetLoadKg > 0 && l.actualLoadKg > 0);
  if (usable.length === 0) return null;
  let at = 0, above = 0, below = 0, delta = 0;
  for (const l of usable) {
    const d = l.actualLoadKg - l.targetLoadKg;
    if (Math.abs(d) < 0.01) at++;
    else if (d > 0) above++;
    else below++;
    delta += (d / l.targetLoadKg) * 100;
  }
  const pct = (n: number) => Math.round((n / usable.length) * 1000) / 10;
  return { samples: usable.length, pctAtTarget: pct(at), pctAbove: pct(above), pctBelow: pct(below), meanDeltaPct: Math.round((delta / usable.length) * 10) / 10 };
}

// ---------------------------------------------------------------- A3.5

/** Media móvil exponencial (tendencia de peso). alpha desde config. */
export function ema(values: number[], alpha: number): number[] {
  const out: number[] = [];
  for (const v of values) out.push(out.length === 0 ? v : alpha * v + (1 - alpha) * out[out.length - 1]);
  return out.map((x) => Math.round(x * 100) / 100);
}

/**
 * Por sesión (en orden): noches seguidas sin dormir el mínimo según los
 * check-ins hasta esa sesión inclusive; null si esa sesión no tiene check-in.
 */
export function sleepDebtBySession(orderedSessionIds: string[], checkinsBySession: Map<string, Checkin>): Array<number | null> {
  let streak = 0;
  return orderedSessionIds.map((id) => {
    const c = checkinsBySession.get(id);
    if (!c || c.sleptMinimum === null || c.sleptMinimum === undefined) return null;
    streak = c.sleptMinimum ? 0 : streak + 1;
    return streak;
  });
}

/**
 * Por sesión: diferencia media de reps a la MISMA carga respecto de la sesión
 * previa del MISMO día (solo series de trabajo). null si no hay comparación.
 */
export function repDeltaBySession(ordered: Array<{ sessionId: string; dayKey: string; logs: SetLog[] }>): Array<number | null> {
  const lastByDay = new Map<string, SetLog[]>();
  return ordered.map((s) => {
    const prev = lastByDay.get(s.dayKey);
    const cur = s.logs.filter(isWorkingSet);
    lastByDay.set(s.dayKey, cur);
    if (!prev) return null;
    const deltas: number[] = [];
    for (const c of cur) {
      const best = prev.filter((p) => p.exerciseId === c.exerciseId && p.actualLoadKg === c.actualLoadKg);
      if (best.length === 0) continue;
      deltas.push(c.actualReps - Math.max(...best.map((b) => b.actualReps)));
    }
    return deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  });
}

// ---------------------------------------------------------------- A3.2

/** Días entre dos fechas ISO (por fecha calendario, sin horas). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * Agenda: asigna una fecha (YYYY-MM-DD) a cada sesión en orden, desde
 * `startIso` y solo en `weekdays` (0 = domingo … 6 = sábado). Solo agenda: la
 * progresión sigue avanzando por sesión completada.
 */
export function scheduleDates(count: number, startIso: string, weekdays: number[]): string[] {
  const days = weekdays.length > 0 ? new Set(weekdays) : new Set([0, 1, 2, 3, 4, 5, 6]);
  const out: string[] = [];
  let t = Date.UTC(+startIso.slice(0, 4), +startIso.slice(5, 7) - 1, +startIso.slice(8, 10));
  let guard = 0;
  while (out.length < count && guard < 4000) {
    const d = new Date(t);
    if (days.has(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    t += 86400000;
    guard++;
  }
  return out;
}
