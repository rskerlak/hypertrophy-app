// Análisis post-sesión: compone los disparadores de deload (F8) y las
// sugerencias de swap (F9) leyendo de los repos. El cálculo vive en src/domain.

import { evaluateDeloadTrigger, evaluateExerciseDeload, summarizeRecentSessions } from "@/domain/deload";
import { suggestExerciseSwap } from "@/domain/swap";
import { getRules } from "@/lib/rulesLoader";
import { slotTrackHistory, trackMesoRefs } from "@/lib/sessionPlan";
import { plateausFor } from "@/lib/trends";
import type { Checkin, DeloadEvaluation } from "@/domain/types";
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
  /** A5.2: al cerrar el meso, ejercicios con "techo sugerido" entre mesos (observación). */
  plateaus: Array<{ exerciseId: string; exerciseName: string; flatMesos: number }>;
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
  const mesoRefs = trackMesoRefs(await mesocycleRepo.all());
  const today = new Date().toISOString();

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
      // "estancado" respecto del fuerte; el deload es liviano a propósito). El
      // estancamiento mira la pista continua entre mesos (A5.1.3); el deload por
      // ejercicio, solo este meso (la fatiga es del bloque actual).
      const track = await slotTrackHistory({
        session,
        slot,
        slotIndex: day.slots.indexOf(slot),
        intensity: day.intensity,
        mesos: mesoRefs,
        today,
        inclusive: true,
      });
      const history = track.result.history;
      const mesoIds = new Set(sessions.map((s) => s.id));
      const ed = evaluateExerciseDeload(history.filter((l) => mesoIds.has(l.sessionId)), rules);
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

  // --- Memoria larga (A5.2): solo al cerrar el meso, como observación ---
  const closed = (await mesocycleRepo.get(meso.id))?.status === "completed";
  const plateaus = closed
    ? (await plateausFor(meso.plan.weeks.flatMap((w) => w.days.flatMap((d) => d.slots.map((x) => x.exerciseId))))).map((t) => ({
        exerciseId: t.exercise.id,
        exerciseName: t.exercise.name,
        flatMesos: t.trend.flatMesos,
      }))
    : [];

  return { deload, swaps, exerciseDeloads, plateaus };
}
