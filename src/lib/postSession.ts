// Análisis post-sesión: compone los disparadores de deload (F8) y las
// sugerencias de swap (F9) leyendo de los repos. El cálculo vive en src/domain.

import { evaluateDeloadTrigger, summarizeRecentSessions } from "@/domain/deload";
import { suggestExerciseSwap } from "@/domain/swap";
import { getRules } from "@/lib/rulesLoader";
import type { Checkin, DeloadEvaluation, SetLog } from "@/domain/types";
import {
  checkinRepo,
  exerciseRepo,
  mesocycleRepo,
  sessionRepo,
  setLogRepo,
  settingsRepo,
} from "@/db/repositories";

export interface SwapHint {
  exerciseId: string;
  exerciseName: string;
  candidateId?: string;
  candidateName?: string;
  reason: string;
}

export interface PostSessionAnalysis {
  deload: DeloadEvaluation;
  swaps: SwapHint[];
}

const RECENT_WINDOW = 6;

export async function analyzePostSession(sessionId: string): Promise<PostSessionAnalysis | null> {
  const rules = getRules();
  const session = await sessionRepo.get(sessionId);
  if (!session) return null;

  const [meso, settings, sessions, exById] = await Promise.all([
    mesocycleRepo.get(session.mesocycleId),
    settingsRepo.get(),
    sessionRepo.forMesocycle(session.mesocycleId),
    exerciseRepo.byId(),
  ]);
  if (!meso) return null;

  // --- Deload (F8) ---
  const completed = sessions.filter((s) => s.status === "completed");
  const recent = completed.slice(-RECENT_WINDOW);
  const logsBySession = await Promise.all(
    recent.map(async (s) => ({
      sessionId: s.id,
      logs: await setLogRepo.forSession(s.id),
      checkin: (await checkinRepo.forSession(s.id)) as Checkin | null,
    })),
  );
  const summaries = summarizeRecentSessions(logsBySession);

  const currentWeek = meso.plan.weeks[session.weekIndex];
  const deload = evaluateDeloadTrigger({
    recentSessions: summaries,
    checkins: logsBySession.map((l) => l.checkin).filter((c): c is Checkin => !!c),
    currentWeeklyVolumeByMuscle: currentWeek?.targetVolumeByMuscle ?? {},
    prioritizedMuscles: settings.prioritizedMuscles,
    profile: settings.experienceProfile,
    weekIndex: session.weekIndex,
    numAccumulationWeeks: meso.numAccumulationWeeks,
    rules,
  });

  // --- Swap (F9): sobre los ejercicios de esta sesión ---
  const day = meso.plan.weeks[session.weekIndex]?.days[session.dayIndex];
  const swaps: SwapHint[] = [];
  if (day) {
    for (const slot of day.slots) {
      const exercise = exById.get(slot.exerciseId);
      if (!exercise || !exercise.isSwappable) continue;
      const history = await mesoExerciseHistory(slot.exerciseId, sessions);
      const candidates = exercise.swapCandidates
        .map((cid) => exById.get(cid))
        .filter((e): e is NonNullable<typeof e> => !!e);
      const r = suggestExerciseSwap({ exercise, candidates, history, rules });
      if (r.suggest) {
        const cand = r.candidateId ? exById.get(r.candidateId) : undefined;
        swaps.push({
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          candidateId: r.candidateId,
          candidateName: cand?.name,
          reason: r.reason ?? "",
        });
      }
    }
  }

  return { deload, swaps };
}

async function mesoExerciseHistory(
  exerciseId: string,
  sessions: Awaited<ReturnType<typeof sessionRepo.forMesocycle>>,
): Promise<SetLog[]> {
  const completedIds = new Set(sessions.filter((s) => s.status === "completed").map((s) => s.id));
  const all = await setLogRepo.forExercise(exerciseId);
  return all.filter((l) => completedIds.has(l.sessionId));
}
