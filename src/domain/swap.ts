// Sugerencia de cambio de ejercicio: SOLO sobre ejercicios isSwappable y ante
// estancamiento sostenido. Nunca rotación aleatoria/frecuente (Kassiano 2022).

import type { Rules } from "./rules";
import type { Exercise, SetLog } from "./types";
import { groupBySession } from "./progression";
import { estimate1RM } from "./oneRepMax";

export interface SuggestSwapInput {
  exercise: Exercise;
  /** Ejercicios candidatos (los referidos por exercise.swapCandidates). */
  candidates: Exercise[];
  history: SetLog[];
  rules: Rules;
}

export interface SwapSuggestion {
  suggest: boolean;
  candidateId?: string;
  reason?: string;
}

export function suggestExerciseSwap(input: SuggestSwapInput): SwapSuggestion {
  const { exercise, candidates, history, rules } = input;
  if (!exercise.isSwappable) return { suggest: false };

  const cfg = rules.exerciseRotation.suggestSwapWhen;
  const sessions = groupBySession(history);
  // Se necesitan stagnationSessions sesiones SIN progreso respecto a una previa:
  // ventana de stagnationSessions + 1 sesiones.
  if (sessions.length < cfg.stagnationSessions + 1) return { suggest: false };

  const best1Rm = (logs: SetLog[]) =>
    Math.max(...logs.map((l) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, rules)));

  const window = sessions.slice(-(cfg.stagnationSessions + 1));
  const baseline = best1Rm(window[0]);
  const stagnant = window
    .slice(1)
    .every((s) => best1Rm(s) <= baseline + 1e-9);

  if (!stagnant) return { suggest: false };

  const valid = candidates.filter(
    (c) => exercise.swapCandidates.includes(c.id) && c.primaryMuscle === exercise.primaryMuscle,
  );
  if (valid.length === 0) {
    return {
      suggest: true,
      reason: `${cfg.stagnationSessions} sesiones sin progreso (ni reps ni carga) al RIR objetivo. No hay candidatos configurados.`,
    };
  }

  const pick = cfg.preferStretchBiasedReplacement
    ? (valid.find((c) => c.resistanceProfile === "stretch") ?? valid[0])
    : valid[0];

  return {
    suggest: true,
    candidateId: pick.id,
    reason:
      `${cfg.stagnationSessions} sesiones sin progreso (ni reps ni carga) al RIR objetivo. ` +
      (pick.resistanceProfile === "stretch"
        ? "Se prefiere un reemplazo con estímulo en estiramiento (evidencia moderada 2022–2024)."
        : "Se sugiere un candidato configurado para este ejercicio."),
  };
}
