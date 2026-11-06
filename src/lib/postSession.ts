// Análisis post-sesión: compone los disparadores de deload (F8) y las
// sugerencias de swap (F9) leyendo de los repos. El cálculo vive en src/domain.

import { evaluateDeloadTrigger, evaluateExerciseDeload, summarizeRecentSessions } from "@/domain/deload";
import { sameProgressionTrack } from "@/domain/progression";
import { suggestExerciseSwap } from "@/domain/swap";
import { getRules } from "@/lib/rulesLoader";
import type { Checkin, DayIntensity, DeloadEvaluation, PlannedSlot, SetLog } from "@/domain/types";
import type { MesocycleRow } from "@/db/schema";
import {
  checkinRepo,
  exerciseRepo,
  mesocycleRepo,
  sessionRepo,
  setLogRepo,
  settingsRepo,
} from "@/db/repositories";

export interface SwapHint {
  /** Posición del slot en el día (para aplicar el cambio en el plan). */
  slotIndex: number;
  exerciseId: string;
  exerciseName: string;
  candidateId?: string;
  candidateName?: string;
  reason: string;
}

export interface ExerciseDeloadHint {
  slotIndex: number;
  exerciseId: string;
  exerciseName: string;
  setsFactor: number;
  loadFactor: number;
  reason: string;
}

export interface PostSessionAnalysis {
  deload: DeloadEvaluation;
  swaps: SwapHint[];
  /** Deload por ejercicio sugerido (A2.3); se aplica a la próxima sesión de este día. */
  exerciseDeloads: ExerciseDeloadHint[];
}

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
  // Resúmenes sobre TODO el meso (sin deload) para que cada sesión se compare
  // con la previa de su mismo día aunque esa quede fuera de la ventana.
  const order = (s: { weekIndex: number; dayIndex: number }) => s.weekIndex * 1000 + s.dayIndex;
  const completed = sessions
    .filter((s) => s.status === "completed" && !s.isDeload)
    .sort((a, b) => order(a) - order(b));
  const logsBySession = await Promise.all(
    completed.map(async (s) => ({
      sessionId: s.id,
      dayKey: String(s.dayIndex),
      logs: await setLogRepo.forSession(s.id),
      checkin: (await checkinRepo.forSession(s.id)) as Checkin | null,
    })),
  );
  const daysPerWeek = meso.plan.weeks.find((w) => !w.isDeload)?.days.length ?? 1;
  const cfgTriggers = rules.deloadTriggers;
  const window = Math.max(
    cfgTriggers.recentWindowSessions,
    daysPerWeek * cfgTriggers.signals.performanceDropSessions.consecutiveSessions,
  );
  const summaries = summarizeRecentSessions(logsBySession).slice(-window);
  const recentCheckins = logsBySession
    .slice(-window)
    .map((l) => l.checkin)
    .filter((c): c is Checkin => !!c);

  const currentWeek = meso.plan.weeks[session.weekIndex];
  const deload = evaluateDeloadTrigger({
    recentSessions: summaries,
    checkins: recentCheckins,
    currentWeeklyVolumeByMuscle: currentWeek?.targetVolumeByMuscle ?? {},
    prioritizedMuscles: settings.prioritizedMuscles,
    profile: settings.experienceProfile,
    weekIndex: session.weekIndex,
    numAccumulationWeeks: meso.numAccumulationWeeks,
    isDeload: session.isDeload,
    rules,
  });

  // --- Swap (F9): sobre los ejercicios de esta sesión ---
  const day = meso.plan.weeks[session.weekIndex]?.days[session.dayIndex];
  const swaps: SwapHint[] = [];
  const exerciseDeloads: ExerciseDeloadHint[] = [];
  if (day && !session.isDeload) {
    for (const slot of day.slots) {
      const exercise = exById.get(slot.exerciseId);
      if (!exercise) continue;
      // Historial de la MISMA pista y sin deload (un día liviano no está
      // "estancado" respecto del fuerte; el deload es liviano a propósito).
      const history = await trackHistory(slot, day.intensity, meso, sessions);
      const ed = evaluateExerciseDeload(history, rules);
      if (ed.suggest) {
        exerciseDeloads.push({
          slotIndex: day.slots.indexOf(slot),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          setsFactor: ed.setsFactor!,
          loadFactor: ed.loadFactor!,
          reason: ed.reason!,
        });
      }
      if (!exercise.isSwappable) continue;
      const candidates = exercise.swapCandidates
        .map((cid) => exById.get(cid))
        .filter((e): e is NonNullable<typeof e> => !!e);
      const r = suggestExerciseSwap({ exercise, candidates, history, rules });
      if (r.suggest) {
        const cand = r.candidateId ? exById.get(r.candidateId) : undefined;
        swaps.push({
          slotIndex: day.slots.indexOf(slot),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          candidateId: r.candidateId,
          candidateName: cand?.name,
          reason: r.reason ?? "",
        });
      }
    }
  }

  return { deload, swaps, exerciseDeloads };
}

async function trackHistory(
  slot: PlannedSlot,
  intensity: DayIntensity | undefined,
  meso: MesocycleRow,
  sessions: Awaited<ReturnType<typeof sessionRepo.forMesocycle>>,
): Promise<SetLog[]> {
  const ids = new Set(
    sessions
      .filter((s) => {
        if (s.status !== "completed" || s.isDeload) return false;
        const d = meso.plan.weeks[s.weekIndex]?.days[s.dayIndex];
        const sl = d?.slots.find((x) => x.exerciseId === slot.exerciseId);
        return !!d && !!sl && sameProgressionTrack({ slot, intensity }, { slot: sl, intensity: d.intensity }, meso.progressionModel);
      })
      .map((s) => s.id),
  );
  const all = await setLogRepo.forExercise(slot.exerciseId);
  return all.filter((l) => ids.has(l.sessionId));
}
