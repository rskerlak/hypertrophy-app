// Series de aproximación (A1.3). Evidencia débil-probable: 1–2 series, la
// última cerca de la carga de trabajo, sin reps al fallo (Wilson/Nunes/
// Blazevich 2025: el calentamiento no cambia la fuerza máxima; sirve para
// familiarizar la carga). Nunca cuentan como volumen ni progresión.

import type { Rules } from "./rules";
import { roundToAvailable, type RoundingContext } from "./rounding";

export interface WarmupSet {
  loadKg: number;
  reps: number;
}

/**
 * Series de aproximación para una carga de trabajo. Vacío si está deshabilitado,
 * si la carga es peso corporal o menor que `minWorkingLoadKg`. Cargas
 * redondeadas al equipamiento y sin duplicados ni series ≥ la de trabajo.
 */
export function warmupSets(workingLoadKg: number, ctx: RoundingContext, rules: Rules): WarmupSet[] {
  const cfg = rules.warmup;
  if (!cfg.enabled || ctx.type === "bodyweight" || workingLoadKg < cfg.minWorkingLoadKg) return [];
  const out: WarmupSet[] = [];
  for (const step of cfg.scheme) {
    const loadKg = roundToAvailable(workingLoadKg * step.pct, ctx);
    if (loadKg <= 0 || loadKg >= workingLoadKg) continue;
    if (out.some((w) => w.loadKg === loadKg)) continue;
    out.push({ loadKg, reps: step.reps });
  }
  return out;
}
