// Lecturas para la sesión y su resumen (A1.8): PRs y resumen de fin. No es
// dominio puro (lee repos), pero todo el cálculo vive en src/domain.

import { detectPRs, type PR } from "@/domain/records";
import { addExerciseVolume, emptyVolume } from "@/domain/volume";
import { isWorkingSet, type SetLog } from "@/domain/types";
import { getRules } from "@/lib/rulesLoader";
import { exerciseRepo, mesocycleRepo, sessionRepo, setLogRepo } from "@/db/repositories";

/**
 * Historial del ejercicio para récords: series de trabajo de sesiones
 * COMPLETADAS fuera de deload (de todos los mesos), excluyendo la sesión dada.
 */
async function prHistory(exerciseId: string, excludeSessionId: string): Promise<SetLog[]> {
  return (await setLogRepo.completedNonDeloadForExercise(exerciseId, excludeSessionId)).filter(isWorkingSet);
}

/** PRs que marca una serie recién registrada (para el aviso en vivo). */
export async function prsForSet(sessionId: string, log: SetLog): Promise<PR[]> {
  const session = await sessionRepo.get(sessionId);
  if (!session || session.isDeload) return [];
  const history = await prHistory(log.exerciseId, sessionId);
  // también cuentan las series previas de ESTA sesión (no repetir el mismo PR)
  const today = (await setLogRepo.forSession(sessionId)).filter(
    (l) => l.exerciseId === log.exerciseId && l.id !== log.id && isWorkingSet(l),
  );
  return detectPRs([...history, ...today], log, getRules());
}

export interface SessionSummary {
  durationMin: number | null;
  loggedSets: number;
  plannedSets: number;
  /** Series fraccionadas de trabajo por músculo en esta sesión. */
  volumeByMuscle: Array<{ muscle: string; sets: number }>;
  prs: Array<PR & { exerciseId: string; exerciseName: string }>;
}

/** Resumen de una sesión finalizada (A1.8). */
export async function sessionSummary(sessionId: string): Promise<SessionSummary | null> {
  const rules = getRules();
  const session = await sessionRepo.get(sessionId);
  if (!session) return null;
  const [meso, logs, exById] = await Promise.all([
    mesocycleRepo.get(session.mesocycleId),
    setLogRepo.forSession(sessionId),
    exerciseRepo.byId(),
  ]);
  const day = meso?.plan.weeks[session.weekIndex]?.days[session.dayIndex];
  const deltas = new Map((session.overrides?.setsDelta ?? []).map((x) => [x.slotIndex, x.delta]));
  const plannedSets = day ? day.slots.reduce((n, s, i) => n + Math.max(1, s.sets + (deltas.get(i) ?? 0)), 0) : 0;
  const working = logs.filter(isWorkingSet);

  const vol = emptyVolume(rules);
  for (const l of working) {
    const ex = exById.get(l.exerciseId);
    if (ex) addExerciseVolume(vol, ex, 1, rules);
  }

  // PRs: por ejercicio, el mejor de cada tipo en la sesión.
  const prs: SessionSummary["prs"] = [];
  if (!session.isDeload) {
    const byEx = new Map<string, SetLog[]>();
    for (const l of working) byEx.set(l.exerciseId, [...(byEx.get(l.exerciseId) ?? []), l]);
    for (const [exerciseId, sets] of byEx) {
      const history = await prHistory(exerciseId, sessionId);
      const best = new Map<string, PR>();
      for (const s of sets) {
        for (const pr of detectPRs(history, s, rules)) {
          const k = pr.kind + (pr.atLoadKg ?? "");
          const cur = best.get(k);
          if (!cur || pr.value > cur.value) best.set(k, pr);
        }
      }
      for (const pr of best.values()) {
        prs.push({ ...pr, exerciseId, exerciseName: exById.get(exerciseId)?.name ?? "(ejercicio eliminado)" });
      }
    }
  }

  const durationMin =
    session.startedAt && (session.completedAt ?? session.lastSetAt)
      ? Math.max(1, Math.round((Date.parse(session.completedAt ?? session.lastSetAt!) - Date.parse(session.startedAt)) / 60000))
      : null;

  return {
    durationMin,
    loggedSets: working.length,
    plannedSets,
    volumeByMuscle: Object.entries(vol)
      .filter(([, v]) => v > 0)
      .map(([muscle, sets]) => ({ muscle, sets: Math.round(sets * 10) / 10 }))
      .sort((a, b) => b.sets - a.sets),
    prs,
  };
}
