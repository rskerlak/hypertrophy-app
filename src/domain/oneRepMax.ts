// Estimación de 1RM desde carga + reps + RIR (Epley ajustado por RIR).
// Aproximación: degrada a reps altas. Usar para sugerir cargas, no como verdad.

import type { Rules } from "./rules";
import type { SetLog } from "./types";
import { roundToAvailable, type RoundingContext } from "./rounding";
import { groupBySession } from "./progression";

export function estimate1RM(
  loadKg: number,
  reps: number,
  rir: number,
  rules: Rules,
): number {
  const c = rules.oneRepMax.epleyCoefficient;
  return loadKg * (1 + c * (reps + rir));
}

/**
 * Invierte Epley: carga sugerida para lograr `targetReps` a `targetRir`,
 * redondeada al incremento disponible.
 */
export function loadForTarget(
  oneRmKg: number,
  targetReps: number,
  targetRir: number,
  rules: Rules,
  ctx: RoundingContext,
): number {
  const c = rules.oneRepMax.epleyCoefficient;
  const raw = oneRmKg / (1 + c * (targetReps + targetRir));
  return roundToAvailable(raw, ctx);
}

/**
 * Carga inicial sugerida a partir del historial REAL de un ejercicio: toma la
 * sesión más reciente, estima el 1RM con su mejor serie (Epley ajustado por
 * RIR) y lo invierte para `targetReps` a `targetRir`, redondeando al
 * equipamiento. Devuelve null si no hay historial con carga (> 0).
 * El historial debe venir sin deloads (cargas deliberadamente bajas).
 */
export function suggestLoadFromHistory(input: {
  history: SetLog[];
  targetReps: number;
  targetRir: number;
  rules: Rules;
  ctx: RoundingContext;
}): number | null {
  const sessions = groupBySession(input.history.filter((l) => l.actualLoadKg > 0));
  if (sessions.length === 0) return null;
  const last = sessions[sessions.length - 1];
  const best = Math.max(
    ...last.map((l) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, input.rules)),
  );
  return loadForTarget(best, input.targetReps, input.targetRir, input.rules, input.ctx);
}
