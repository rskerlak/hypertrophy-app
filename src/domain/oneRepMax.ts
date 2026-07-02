// Estimación de 1RM desde carga + reps + RIR (Epley ajustado por RIR).
// Aproximación: degrada a reps altas. Usar para sugerir cargas, no como verdad.

import type { Rules } from "./rules";
import { roundToAvailable, type RoundingContext } from "./rounding";

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
