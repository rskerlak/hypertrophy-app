// Memoria larga (A5.2): arma las entradas de `longTermTrend` desde los repos.
// El cálculo vive en src/domain/analytics.ts.

import { exerciseTimeline, longTermTrend, type ExercisePoint, type LongTermTrend } from "@/domain/analytics";
import { assessRirCalibration } from "@/domain/rirCalibration";
import type { Exercise, SetLog } from "@/domain/types";
import type { MesocycleRow, SessionRow } from "@/db/schema";
import { exerciseRepo, mesocycleRepo, sessionRepo, setLogRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";

export interface ExerciseTrend {
  exercise: Exercise;
  points: ExercisePoint[];
  trend: LongTermTrend;
}

/** Mesos donde el RIR de ESTE ejercicio es eco del objetivo (no mide percepción). */
function echoMesos(logs: SetLog[], sessions: Map<string, SessionRow>): Set<string> {
  const rules = getRules();
  const byMeso = new Map<string, SetLog[]>();
  for (const l of logs) {
    const s = sessions.get(l.sessionId);
    if (!s || s.status !== "completed" || s.isDeload) continue;
    byMeso.set(s.mesocycleId, [...(byMeso.get(s.mesocycleId) ?? []), l]);
  }
  const out = new Set<string>();
  for (const [id, ls] of byMeso) if (assessRirCalibration(ls, rules).echoDetected) out.add(id);
  return out;
}

export function computeExerciseTrend(args: {
  exercise: Exercise;
  logs: SetLog[];
  sessions: SessionRow[];
  mesos: MesocycleRow[];
}): ExerciseTrend {
  const rules = getRules();
  const points = exerciseTimeline({
    exerciseId: args.exercise.id,
    logs: args.logs,
    sessions: args.sessions,
    plansByMeso: new Map(args.mesos.map((m) => [m.id, m.plan])),
    rules,
  });
  const trend = longTermTrend({
    points,
    mesos: args.mesos.map((m) => ({ id: m.id, intent: m.intent })),
    echoMesoIds: echoMesos(args.logs, new Map(args.sessions.map((s) => [s.id, s]))),
    holdLoad: args.exercise.holdLoad,
    rules,
  });
  return { exercise: args.exercise, points, trend };
}

/** Tendencia de cada ejercicio hecho en 2+ mesos (pestaña "Entre mesos"). */
export async function allExerciseTrends(): Promise<ExerciseTrend[]> {
  const [exercises, mesos] = await Promise.all([exerciseRepo.all(), mesocycleRepo.all()]);
  const out: ExerciseTrend[] = [];
  for (const exercise of exercises) {
    const logs = await setLogRepo.forExercise(exercise.id);
    if (logs.length === 0) continue;
    const sessions = await sessionRepo.byIds([...new Set(logs.map((l) => l.sessionId))]);
    const t = computeExerciseTrend({ exercise, logs, sessions, mesos });
    if (t.trend.points.length >= 2) out.push(t);
  }
  return out.sort((a, b) => Number(b.trend.plateauSuggested) - Number(a.trend.plateauSuggested) || a.exercise.name.localeCompare(b.exercise.name));
}

/** Ejercicios con techo sugerido entre los dados (observación al cerrar un meso). */
export async function plateausFor(exerciseIds: string[]): Promise<ExerciseTrend[]> {
  const [exById, mesos] = await Promise.all([exerciseRepo.byId(), mesocycleRepo.all()]);
  const out: ExerciseTrend[] = [];
  for (const id of new Set(exerciseIds)) {
    const exercise = exById.get(id);
    if (!exercise) continue;
    const logs = await setLogRepo.forExercise(id);
    const sessions = await sessionRepo.byIds([...new Set(logs.map((l) => l.sessionId))]);
    const t = computeExerciseTrend({ exercise, logs, sessions, mesos });
    if (t.trend.plateauSuggested) out.push(t);
  }
  return out;
}
