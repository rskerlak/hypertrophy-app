// Estadísticas de fin de ciclo. Solo métricas de statsPolicy.validProgressMetrics.
// NUNCA bombeo/dolor como progreso. Incluye siempre el aviso de "n pequeño".

import type { Rules } from "./rules";
import { isRirReported, type Checkin, type Exercise, type MesoStats, type MesocyclePlan, type SetLog } from "./types";
import { estimate1RM } from "./oneRepMax";
import { groupBySession, progressionTrackKey } from "./progression";
import { rirEchoPct } from "./rirCalibration";

export interface ComputeMesoStatsInput {
  plan: MesocyclePlan;
  sessions: Array<{
    id: string;
    weekIndex: number;
    /** Necesario para separar pistas (día fuerte/liviano, rangos distintos). */
    dayIndex?: number;
    status: "pending" | "completed" | "skipped";
  }>;
  setLogs: SetLog[];
  checkins: Checkin[];
  exercises: Exercise[];
  rules: Rules;
}

export function computeMesoStats(input: ComputeMesoStatsInput): MesoStats {
  const { plan, sessions, setLogs, exercises, rules } = input;
  const exercisesById = new Map(exercises.map((e) => [e.id, e]));
  const sessionWeek = new Map(sessions.map((s) => [s.id, s.weekIndex]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // Logs que cuentan como progreso: ni deload (cargas deliberadamente bajas,
  // A0.3) ni sesiones saltadas (el motor tampoco las usa).
  const isProgressLog = (l: SetLog) => {
    const s = sessionById.get(l.sessionId);
    if (!s || s.status === "skipped") return false;
    return !plan.weeks[s.weekIndex]?.isDeload;
  };
  const progressLogs = setLogs.filter(isProgressLog);

  // Pista de cada log: misma definición que el motor (progressionTrackKey).
  const trackOf = (l: SetLog): { key: string; intensity?: string; range?: string } => {
    const s = sessionById.get(l.sessionId);
    const day = s?.dayIndex !== undefined ? plan.weeks[s.weekIndex]?.days[s.dayIndex] : undefined;
    const slot = day?.slots.find((x) => x.exerciseId === l.exerciseId);
    if (!day || !slot) return { key: "?" };
    return {
      key: progressionTrackKey({ slot, intensity: day.intensity }, plan.progressionModel),
      intensity: day.intensity,
      range: `${slot.repRange.min}–${slot.repRange.max}`,
    };
  };

  // --- Progresión de carga estimada por ejercicio y pista ---
  const logsByExercise = new Map<string, SetLog[]>();
  const logsByTrack = new Map<string, { exerciseId: string; intensity?: string; range?: string; logs: SetLog[] }>();
  for (const l of progressLogs) {
    const arr = logsByExercise.get(l.exerciseId) ?? [];
    arr.push(l);
    logsByExercise.set(l.exerciseId, arr);
    const t = trackOf(l);
    const k = `${l.exerciseId}|${t.key}`;
    const entry = logsByTrack.get(k) ?? { exerciseId: l.exerciseId, intensity: t.intensity, range: t.range, logs: [] };
    entry.logs.push(l);
    logsByTrack.set(k, entry);
  }
  const tracksPerExercise = new Map<string, number>();
  for (const t of logsByTrack.values()) {
    tracksPerExercise.set(t.exerciseId, (tracksPerExercise.get(t.exerciseId) ?? 0) + 1);
  }

  const perExercise: MesoStats["perExercise"] = [];
  for (const t of logsByTrack.values()) {
    const bySession = groupBySession(t.logs);
    if (bySession.length < 2) continue;
    // e1RM con las series de RIR reportado si las hay (la última de cada
    // ejercicio, la más cercana al fallo y la más precisa: Russo 2025).
    const best = (s: SetLog[]) => {
      const reported = s.filter(isRirReported);
      const use = reported.length > 0 ? reported : s;
      return Math.max(...use.map((l) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, rules)));
    };
    const first = best(bySession[0]);
    const last = best(bySession[bySession.length - 1]);
    const multi = (tracksPerExercise.get(t.exerciseId) ?? 0) > 1;
    perExercise.push({
      exerciseId: t.exerciseId,
      track: multi
        ? t.intensity === "heavy" || t.intensity === "light"
          ? rules.dayIntensity[t.intensity].label.toLowerCase()
          : t.range
        : undefined,
      firstEst1RmKg: round1(first),
      lastEst1RmKg: round1(last),
      deltaPct: first > 0 ? round1(((last - first) / first) * 100) : 0,
    });
  }

  // --- Por músculo (promedio de deltas de sus ejercicios primarios) ---
  const deltasByMuscle = new Map<string, number[]>();
  for (const pe of perExercise) {
    const ex = exercisesById.get(pe.exerciseId);
    if (!ex) continue;
    const arr = deltasByMuscle.get(ex.primaryMuscle) ?? [];
    arr.push(pe.deltaPct);
    deltasByMuscle.set(ex.primaryMuscle, arr);
  }
  const perMuscle = [...deltasByMuscle.entries()].map(([muscle, deltas]) => ({
    muscle,
    avgDeltaPct: round1(deltas.reduce((a, b) => a + b, 0) / deltas.length),
  }));

  // --- Volumen completado vs planeado (sets fraccionados) ---
  const fractionalSets = (exerciseId: string, sets: number) => {
    const ex = exercisesById.get(exerciseId);
    if (!ex) return sets;
    return (
      sets * rules.volumeCounting.directSetWeight +
      sets * ex.secondaryMuscles.length * rules.volumeCounting.synergistSetWeight
    );
  };
  let planned = 0;
  for (const week of plan.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) planned += fractionalSets(slot.exerciseId, slot.sets);
    }
  }
  let completed = 0;
  for (const l of setLogs) completed += fractionalSets(l.exerciseId, 1);

  // --- Deriva de RIR por semana (media de actual - objetivo) ---
  const diffsByWeek = new Map<number, number[]>();
  for (const l of setLogs) {
    const w = sessionWeek.get(l.sessionId);
    if (w === undefined) continue;
    const arr = diffsByWeek.get(w) ?? [];
    if (!isRirReported(l)) continue; // la deriva de RIR solo con RIR reportado
    arr.push(l.actualRir - l.targetRir);
    diffsByWeek.set(w, arr);
  }
  const rirDrift = [...diffsByWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekIndex, diffs]) => ({
      weekIndex,
      meanDiff: round1(diffs.reduce((a, b) => a + b, 0) / diffs.length),
    }));

  // --- Trayectoria de fatiga: reps a carga fija a lo largo de semanas ---
  const fatigueTrajectory: MesoStats["fatigueTrajectory"] = [];
  for (const [exerciseId, logs] of logsByExercise) {
    // carga más frecuente del ejercicio
    const countByLoad = new Map<number, number>();
    for (const l of logs) countByLoad.set(l.actualLoadKg, (countByLoad.get(l.actualLoadKg) ?? 0) + 1);
    const [topLoad] = [...countByLoad.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (topLoad === undefined) continue;
    const byWeek = new Map<number, number>();
    for (const l of logs) {
      if (l.actualLoadKg !== topLoad) continue;
      const w = sessionWeek.get(l.sessionId);
      if (w === undefined) continue;
      byWeek.set(w, Math.max(byWeek.get(w) ?? 0, l.actualReps));
    }
    if (byWeek.size < 2) continue;
    fatigueTrajectory.push({
      exerciseId,
      loadKg: topLoad,
      points: [...byWeek.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([weekIndex, reps]) => ({ weekIndex, reps })),
    });
  }

  // --- Adherencia ---
  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const skipped = sessions.filter((s) => s.status === "skipped").length;
  const pending = sessions.filter((s) => s.status === "pending").length;

  return {
    perExercise: perExercise.sort((a, b) => b.deltaPct - a.deltaPct),
    perMuscle: perMuscle.sort((a, b) => b.avgDeltaPct - a.avgDeltaPct),
    volume: {
      plannedFractionalSets: round1(planned),
      completedFractionalSets: round1(completed),
      completionPct: planned > 0 ? round1((completed / planned) * 100) : 0,
    },
    rirDrift,
    fatigueTrajectory,
    adherence: {
      completed: completedCount,
      skipped,
      pending,
      totalPlanned: sessions.length,
      pct: sessions.length > 0 ? round1((completedCount / sessions.length) * 100) : 0,
    },
    smallSampleWarning: rules.statsPolicy.smallSampleWarning,
    rirEchoPct: rirEchoPct(progressLogs),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
