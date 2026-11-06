// Lecturas del historial para la sesión (A1.1): la última sesión de la pista.
// A5.1: el historial de una pista continúa entre mesos (memoria corta).

import { groupBySession, progressionSessions, progressionTrackKey } from "./progression";
import type { Rules } from "./rules";
import {
  isComparableSet,
  isWorkingSet,
  type DayIntensity,
  type MesocyclePlan,
  type PlannedSlot,
  type ProgressionModel,
  type SetLog,
} from "./types";

/** Sesión mínima que necesita `trackHistory`. */
export interface TrackSessionRef {
  id: string;
  mesocycleId: string;
  weekIndex: number;
  dayIndex: number;
  status: "pending" | "completed" | "skipped";
  isDeload: boolean;
  completedAt?: string;
}

/** Meso mínimo que necesita `trackHistory`. */
export interface TrackMesoRef {
  plan: MesocyclePlan;
  progressionModel: ProgressionModel;
  numAccumulationWeeks: number;
}

/**
 * Continuidad de la pista:
 *  - same-track: hay historial de la misma pista (de este meso o de otros);
 *  - track-changed: hay sesiones del ejercicio pero de otra pista (otro rango,
 *    otra intensidad del día, otra zona DUP o bloques; lineal/doble/APRE
 *    con el mismo rango comparten pista): no se arrastran reps;
 *  - gap: el ejercicio no se hizo (en ninguna pista) en más de `maxGapDays`;
 *  - none: nunca se hizo el ejercicio.
 */
export type TrackContinuity = "same-track" | "track-changed" | "gap" | "none";

export interface TrackHistoryResult {
  /** Logs de la pista que deciden la progresión (vacío con track-changed/gap/none). */
  history: SetLog[];
  continuity: TrackContinuity;
  /** Última sesión de la pista (aunque haya pausa): semana y meso, para el modelo bloque. */
  last?: { sessionId: string; mesocycleId: string; weekIndex: number; completedAt?: string };
  /**
   * Series de progresión de la última sesión real del ejercicio en CUALQUIER
   * pista: el ancla para re-estimar la carga con track-changed o gap.
   */
  anchor?: SetLog[];
  /** Días entre la última sesión del ancla y la referencia. */
  anchorAgeDays?: number;
  /** Días entre la última sesión de la pista y la referencia. */
  gapDays?: number;
}

const DAY_MS = 86_400_000;

/**
 * Historial de la PISTA de un slot a través de mesos (A5.1, memoria corta).
 * Entran solo sesiones completadas y sin deload, anteriores a la actual: dentro
 * del meso por orden semana/día; en otros mesos por `completedAt` (anteriores a
 * la sesión actual si ya se completó; todas si está pendiente). Una sesión de
 * otro meso entra solo si un slot de ese día con este ejercicio está en la
 * MISMA pista (`progressionTrackKey` con el modelo de cada meso). Con el mismo
 * ejercicio dos veces en un día, cada slot compara contra su slot (S1).
 *
 * `today` entra como argumento (dominio puro). `inclusive` incluye la propia
 * sesión actual (análisis post-sesión).
 */
export function trackHistory(input: {
  logs: SetLog[];
  sessions: TrackSessionRef[];
  mesos: Map<string, TrackMesoRef>;
  current: {
    mesocycleId: string;
    weekIndex: number;
    dayIndex: number;
    slotIndex: number;
    slot: Pick<PlannedSlot, "exerciseId" | "repRange" | "dayType">;
    intensity?: DayIntensity;
    completedAt?: string;
  };
  today: string;
  inclusive?: boolean;
  rules: Rules;
}): TrackHistoryResult {
  const { current, rules } = input;
  const cfg = rules.progression.continuity;
  const exerciseId = current.slot.exerciseId;
  const currentMeso = input.mesos.get(current.mesocycleId);
  if (!currentMeso) return { history: [], continuity: "none" };
  const currentKey = progressionTrackKey({ slot: current.slot, intensity: current.intensity }, currentMeso.progressionModel);
  const order = (w: number, d: number) => w * 1000 + d;
  const cutoff = order(current.weekIndex, current.dayIndex);
  const refMs = Date.parse(current.completedAt ?? input.today);

  // Sesiones anteriores a la actual, con el slot que les corresponde en la
  // pista (inTrack) y el slot del ejercicio en cualquier pista (anyTrack, ancla).
  type Match = { session: TrackSessionRef; idx: number; repeated: boolean };
  const inTrack = new Map<string, Match>();
  const anyTrack = new Map<string, Match>();
  for (const s of input.sessions) {
    if (s.status !== "completed" || s.isDeload) continue;
    const sameMeso = s.mesocycleId === current.mesocycleId;
    if (sameMeso) {
      const o = order(s.weekIndex, s.dayIndex);
      if (input.inclusive ? o > cutoff : o >= cutoff) continue;
    } else {
      if (!cfg.enabled || !s.completedAt) continue;
      const t = Date.parse(s.completedAt);
      if (current.completedAt && (input.inclusive ? t > refMs : t >= refMs)) continue;
    }
    const meso = input.mesos.get(s.mesocycleId);
    const day = meso?.plan.weeks[s.weekIndex]?.days[s.dayIndex];
    if (!meso || !day) continue;
    const idxs = day.slots.flatMap((x, i) => (x.exerciseId === exerciseId ? [i] : []));
    if (idxs.length === 0) continue;
    const repeated = idxs.length > 1;
    const preferred = idxs.includes(current.slotIndex) ? current.slotIndex : idxs[0];
    anyTrack.set(s.id, { session: s, idx: preferred, repeated });
    const keyOf = (i: number) => progressionTrackKey({ slot: day.slots[i], intensity: day.intensity }, meso.progressionModel);
    let idx: number | undefined;
    if (sameMeso) {
      // Mismo plan: el mismo índice si tiene este ejercicio; si no, el primero.
      if (keyOf(preferred) === currentKey) idx = preferred;
    } else {
      // Otro plan: los slots del ejercicio en la misma pista; preferir el mismo índice.
      const ok = idxs.filter((i) => keyOf(i) === currentKey);
      if (ok.length) idx = ok.includes(current.slotIndex) ? current.slotIndex : ok[0];
    }
    if (idx !== undefined) inTrack.set(s.id, { session: s, idx, repeated });
  }

  const pick = (m: Map<string, Match>) =>
    input.logs.filter((l) => {
      if (l.exerciseId !== exerciseId) return false;
      const e = m.get(l.sessionId);
      if (!e) return false;
      // Logs viejos sin slotIndex: solo atribuibles si el ejercicio no se repite ese día.
      return l.slotIndex === undefined ? !e.repeated : l.slotIndex === e.idx;
    });
  const sessionAt = (logs: SetLog[], m: Map<string, Match>) =>
    m.get(logs[0].sessionId)?.session.completedAt ??
    logs.reduce((a, l) => (l.timestamp > a ? l.timestamp : a), logs[0].timestamp);
  const ageDays = (iso: string) => Math.max(0, Math.floor((refMs - Date.parse(iso)) / DAY_MS));

  const history = pick(inTrack);
  const anySessions = progressionSessions(pick(anyTrack));
  const anchorLogs = anySessions[anySessions.length - 1];
  const anchor = anchorLogs && cfg.enabled ? { anchor: anchorLogs, anchorAgeDays: ageDays(sessionAt(anchorLogs, anyTrack)) } : {};

  const trackSessions = progressionSessions(history);
  const lastLogs = trackSessions[trackSessions.length - 1];
  if (!lastLogs) {
    return { history: [], continuity: anchorLogs && cfg.enabled ? "track-changed" : "none", ...anchor };
  }
  const lastMatch = inTrack.get(lastLogs[0].sessionId)!.session;
  const last = {
    sessionId: lastMatch.id,
    mesocycleId: lastMatch.mesocycleId,
    weekIndex: lastMatch.weekIndex,
    completedAt: lastMatch.completedAt,
  };
  const gapDays = ageDays(sessionAt(lastLogs, inTrack));
  if (cfg.enabled && gapDays > cfg.maxGapDays) {
    // La pista quedó vieja. Si el ejercicio se siguió haciendo en OTRA pista
    // hace poco, no es una pausa: es un cambio de pista (sin descuento).
    const recent = anchor.anchorAgeDays !== undefined && anchor.anchorAgeDays <= cfg.maxGapDays;
    return { history: [], continuity: recent ? "track-changed" : "gap", last, gapDays, ...anchor };
  }
  return { history, continuity: "same-track", last, gapDays, ...anchor };
}

export interface PreviousSet {
  loadKg: number;
  reps: number;
  rir: number;
  rirReported: boolean;
}

/**
 * Series de TRABAJO de la última sesión del historial (ya filtrado por pista),
 * ordenadas por serie, con el sessionId para buscar su fecha. null si no hay.
 */
export function lastSessionSets(history: SetLog[]): { sessionId: string; sets: PreviousSet[] } | null {
  // A5-03: sin la serie del test AMRAP (al fallo): "última vez" y "copiar
  // anterior" deben mostrar series comparables con las de hoy.
  const sessions = groupBySession(history.filter(isComparableSet));
  const last = sessions[sessions.length - 1];
  if (!last || last.length === 0) return null;
  return {
    sessionId: last[0].sessionId,
    sets: last.map((l) => ({
      loadKg: l.actualLoadKg,
      reps: l.actualReps,
      rir: l.actualRir,
      rirReported: l.rirReported !== false,
    })),
  };
}

/** Serie previa "correspondiente" a la i-ésima de hoy (si hay menos, la última). */
export function previousForIndex(prev: PreviousSet[] | null, i: number): PreviousSet | null {
  if (!prev || prev.length === 0) return null;
  return prev[Math.min(i, prev.length - 1)];
}

/**
 * Comparación neutral de una serie de hoy contra la previa correspondiente:
 * "up" si subió la carga o, a igual carga, las reps; "down" si bajó; "same".
 */
export function compareToPrevious(
  today: { loadKg: number; reps: number },
  prev: PreviousSet | null,
): "up" | "same" | "down" | null {
  if (!prev) return null;
  if (today.loadKg > prev.loadKg) return "up";
  if (today.loadKg < prev.loadKg) return "down";
  if (today.reps > prev.reps) return "up";
  if (today.reps < prev.reps) return "down";
  return "same";
}
