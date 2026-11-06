// Lecturas del historial para la sesión (A1.1): la última sesión de la pista.

import { groupBySession } from "./progression";
import { isWorkingSet, type SetLog } from "./types";

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
  const sessions = groupBySession(history.filter(isWorkingSet));
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
