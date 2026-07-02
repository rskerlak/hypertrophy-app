// Disparadores de deload: multi-señal y PROBABILÍSTICOS. La caída de
// rendimiento es sobre todo fatiga aguda, no un "MRV superado" medible.
// La UI debe presentar esto como sugerencia, nunca como diagnóstico.

import type { Rules } from "./rules";
import { effectiveLandmarks } from "./rules";
import type {
  Checkin,
  DeloadEvaluation,
  ExperienceProfileId,
  SessionSummary,
  SetLog,
} from "./types";

/**
 * Construye el resumen de una sesión comparándola con la sesión previa
 * del mismo día/slots (mismos ejercicios). Puro: recibe los logs ya filtrados.
 */
export function summarizeSessionPair(
  prevLogs: SetLog[],
  currLogs: SetLog[],
  sessionId: string,
  checkin?: Checkin | null,
): SessionSummary {
  const prevByExercise = new Map<string, SetLog[]>();
  for (const l of prevLogs) {
    const arr = prevByExercise.get(l.exerciseId) ?? [];
    arr.push(l);
    prevByExercise.set(l.exerciseId, arr);
  }
  const currByExercise = new Map<string, SetLog[]>();
  for (const l of currLogs) {
    const arr = currByExercise.get(l.exerciseId) ?? [];
    arr.push(l);
    currByExercise.set(l.exerciseId, arr);
  }

  let repDrops = 0;
  let maxRirIncrease = 0;
  for (const [exId, curr] of currByExercise) {
    const prev = prevByExercise.get(exId);
    if (!prev) continue;
    // Comparación a carga fija: solo series con la misma carga real.
    const prevBest = new Map<number, { reps: number; rir: number }>();
    for (const p of prev) {
      const b = prevBest.get(p.actualLoadKg);
      if (!b || p.actualReps > b.reps) {
        prevBest.set(p.actualLoadKg, { reps: p.actualReps, rir: p.actualRir });
      }
    }
    let dropped = false;
    for (const c of curr) {
      const b = prevBest.get(c.actualLoadKg);
      if (!b) continue;
      if (c.actualReps < b.reps) dropped = true;
      const rirIncrease = c.actualRir - b.rir;
      if (rirIncrease > maxRirIncrease) maxRirIncrease = rirIncrease;
    }
    if (dropped) repDrops++;
  }

  return {
    sessionId,
    exercisesWithRepDropAtFixedLoad: repDrops,
    maxRirIncreaseAtFixedLoad: maxRirIncrease,
    readiness: checkin?.readiness ?? null,
    sleptMinimum: checkin?.sleptMinimum ?? null,
  };
}

export interface EvaluateDeloadInput {
  /** Resúmenes de las sesiones recientes, en orden cronológico. */
  recentSessions: SessionSummary[];
  checkins: Checkin[];
  currentWeeklyVolumeByMuscle: Record<string, number>;
  prioritizedMuscles: string[];
  profile: ExperienceProfileId;
  weekIndex: number;
  numAccumulationWeeks: number;
  rules: Rules;
}

export function evaluateDeloadTrigger(input: EvaluateDeloadInput): DeloadEvaluation {
  const { rules } = input;
  const cfg = rules.deloadTriggers;
  const reasons: string[] = [];

  // 1. Caída de rendimiento sostenida.
  const perf = cfg.signals.performanceDropSessions;
  if (perf.enabled) {
    const recent = input.recentSessions.slice(-perf.consecutiveSessions);
    if (
      recent.length >= perf.consecutiveSessions &&
      recent.every((s) => s.exercisesWithRepDropAtFixedLoad >= perf.exercisesAffected)
    ) {
      reasons.push(
        `Caída de reps a carga fija en ${perf.exercisesAffected}+ ejercicios durante ${perf.consecutiveSessions} sesiones seguidas`,
      );
    }
  }

  // 2. RIR creep a carga fija.
  const creep = cfg.signals.rirCreepAtFixedLoad;
  if (creep.enabled) {
    const hit = input.recentSessions.some(
      (s) => s.maxRirIncreaseAtFixedLoad >= creep.reps,
    );
    if (hit) {
      reasons.push(`El RIR reportado subió ≥${creep.reps} a carga fija`);
    }
  }

  // 3. Volumen planificado alcanza MRV en algún músculo priorizado.
  if (cfg.signals.reachedMrv.enabled) {
    const muscles =
      input.prioritizedMuscles.length > 0
        ? input.prioritizedMuscles
        : Object.keys(input.currentWeeklyVolumeByMuscle);
    for (const m of muscles) {
      const vol = input.currentWeeklyVolumeByMuscle[m] ?? 0;
      if (vol <= 0) continue;
      try {
        const lm = effectiveLandmarks(rules, input.profile, m);
        if (vol >= lm.mrv) {
          reasons.push(`El volumen semanal de ${m} alcanzó el MRV heurístico del perfil`);
          break;
        }
      } catch {
        // sin landmarks para ese músculo: ignorar
      }
    }
  }

  // 4. Disposición/sueño pobres sostenidos (señal débil, cuenta junto a otras).
  const chronic = cfg.signals.chronicPoorReadiness;
  if (chronic.enabled) {
    const window = input.recentSessions.slice(-chronic.windowSessions);
    if (
      window.length >= chronic.windowSessions &&
      window.every(
        (s) =>
          s.sleptMinimum === false ||
          (typeof s.readiness === "number" && s.readiness <= 2),
      )
    ) {
      reasons.push("Sueño bajo el mínimo o baja disposición sostenidos en el check-in");
    }
  }

  const forced = input.weekIndex >= input.numAccumulationWeeks;
  return {
    shouldSuggest: reasons.length >= cfg.minSignalsToSuggest || forced,
    reasons: forced
      ? [...reasons, "Fin de las semanas de acumulación programadas"]
      : reasons,
    forced,
  };
}

/** Utilidad para armar SessionSummary a partir del historial completo de logs. */
export function summarizeRecentSessions(
  logsBySession: Array<{ sessionId: string; logs: SetLog[]; checkin?: Checkin | null }>,
): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (let i = 0; i < logsBySession.length; i++) {
    const prev = i > 0 ? logsBySession[i - 1].logs : [];
    out.push(
      summarizeSessionPair(
        prev,
        logsBySession[i].logs,
        logsBySession[i].sessionId,
        logsBySession[i].checkin,
      ),
    );
  }
  return out;
}
