// Récords personales (A1.8). Solo series de trabajo y fuera de deload: el
// historial que entra ya debe venir filtrado (sesiones completadas, sin deload).

import type { Rules } from "./rules";
import { estimate1RM } from "./oneRepMax";
import { isRirReported, isWorkingSet, type SetLog } from "./types";

export type PRKind = "load" | "repsAtLoad" | "e1rm";

export interface PR {
  kind: PRKind;
  value: number;
  previous: number | null;
  /** Para repsAtLoad: la carga a la que se mejoraron las reps. */
  atLoadKg?: number;
}

/**
 * Récords que marca una serie nueva frente al historial del ejercicio.
 * - load: carga más alta jamás registrada (con ≥ 1 rep).
 * - repsAtLoad: más reps que nunca a esa misma carga.
 * - e1rm: 1RM estimado (Epley ajustado por RIR) más alto que nunca.
 * Sin historial no hay "récord": la primera vez solo es la primera vez.
 */
export function detectPRs(history: SetLog[], newSet: SetLog, rules: Rules): PR[] {
  if (!isWorkingSet(newSet) || newSet.actualReps < 1) return [];
  const past = history.filter((l) => isWorkingSet(l) && l.id !== newSet.id && l.actualReps >= 1);
  if (past.length === 0) return [];
  const out: PR[] = [];

  const maxLoad = Math.max(...past.map((l) => l.actualLoadKg));
  if (newSet.actualLoadKg > maxLoad && newSet.actualLoadKg > 0) {
    out.push({ kind: "load", value: newSet.actualLoadKg, previous: maxLoad });
  }

  const sameLoad = past.filter((l) => l.actualLoadKg === newSet.actualLoadKg);
  if (sameLoad.length > 0) {
    const best = Math.max(...sameLoad.map((l) => l.actualReps));
    if (newSet.actualReps > best) {
      out.push({ kind: "repsAtLoad", value: newSet.actualReps, previous: best, atLoadKg: newSet.actualLoadKg });
    }
  }

  // El 1RM estimado usa el RIR: solo con RIR REPORTADO de ambos lados (un RIR
  // precargado sin tocar no es percepción y lo inflaría o desinflaría).
  if (newSet.actualLoadKg > 0 && isRirReported(newSet)) {
    const e = (l: SetLog) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, rules);
    const bestE = Math.max(...past.filter((l) => l.actualLoadKg > 0 && isRirReported(l)).map(e), 0);
    const cur = e(newSet);
    if (bestE > 0 && cur > bestE) out.push({ kind: "e1rm", value: Math.round(cur * 10) / 10, previous: Math.round(bestE * 10) / 10 });
  }
  return out;
}
