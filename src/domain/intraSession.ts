// Ajuste SUGERIDO entre series (A2.6). Evidencia indirecta: la pérdida de
// rendimiento crece con la proximidad al fallo (Refalo 2023). Nunca cambia el
// objetivo guardado: solo propone un valor que el usuario puede usar.

import type { Rules } from "./rules";
import { roundToAvailable, type RoundingContext } from "./rounding";
import { isRirReported, type SetLog } from "./types";

export interface IntraSessionHint {
  loadKg: number;
  reps: number;
  text: string;
}

/**
 * Si la serie recién registrada salió ≥ rirShortfall más cerca del fallo que
 * su objetivo (con RIR REPORTADO), sugiere para la siguiente serie bajar
 * loadDropPct% la carga redondeada al equipamiento; si no hay una carga menor
 * alcanzable (o es peso corporal), 1 rep menos. null si no corresponde.
 */
export function intraSessionAdjust(
  last: SetLog,
  next: { loadKg: number; reps: number },
  ctx: RoundingContext,
  rules: Rules,
): IntraSessionHint | null {
  const cfg = rules.intraSession;
  if (!isRirReported(last) || last.kind === "warmup") return null;
  const shortfall = last.targetRir - last.actualRir;
  if (shortfall < cfg.rirShortfall) return null;
  if (ctx.type !== "bodyweight" && next.loadKg > 0) {
    const lower = roundToAvailable(next.loadKg * (1 - cfg.loadDropPct / 100), ctx);
    if (lower < next.loadKg) {
      return {
        loadKg: lower,
        reps: next.reps,
        text: `La serie ${last.setIndex + 1} salió a RIR ${last.actualRir} (objetivo ${last.targetRir}): para esta sugiero ${lower} kg.`,
      };
    }
  }
  if (next.reps <= 1) return null;
  return {
    loadKg: next.loadKg,
    reps: next.reps - 1,
    text: `La serie ${last.setIndex + 1} salió a RIR ${last.actualRir} (objetivo ${last.targetRir}): para esta sugiero ${next.reps - 1} reps.`,
  };
}
