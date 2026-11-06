// Compone el plan del día con la autorregulación (F6). No es dominio puro
// (lee repos), pero delega todo el cálculo a src/domain.

import {
  nextPrescription,
  progressionSessions,
  sameProgressionTrack,
  type PrescriptionExplain,
} from "@/domain/progression";
import {
  lastSessionSets,
  trackHistory,
  type PreviousSet,
  type TrackContinuity,
  type TrackHistoryResult,
  type TrackMesoRef,
} from "@/domain/history";
import { roundToAvailable } from "@/domain/rounding";
import { deloadLoadForDay } from "@/domain/deload";
import {
  assessRirCalibration,
  calibratedRirCap,
  calibratedRirFloor,
  type RirCalibration,
} from "@/domain/rirCalibration";
import { getRules } from "@/lib/rulesLoader";
import type { DayIntensity, Equipment, Exercise, PlannedSlot, SetLog } from "@/domain/types";
import { loadEstimator, mesocycleRepo, sessionRepo, setLogRepo, exerciseRepo, settingsRepo } from "@/db/repositories";
import type { MesocycleRow, SessionRow } from "@/db/schema";

export interface SlotPrescription {
  slotIndex: number;
  exercise: Exercise;
  /** Ejercicio del plan si hoy se reemplazó (swap "solo hoy"). */
  plannedExercise?: Exercise;
  planned: PlannedSlot;
  /** Series de HOY (plan + cambios de esta sesión). */
  sets: number;
  suggestedLoadKg: number;
  suggestedReps: number;
  targetRir: number;
  rationale: string;
  explain: PrescriptionExplain;
  /** Última sesión de la misma pista (series de trabajo) y su fecha. */
  previous: { sets: PreviousSet[]; completedAt?: string } | null;
  /** Descanso objetivo en segundos (ejercicio o default por tipo). */
  restSec: number;
  /** true si hoy hay un deload por ejercicio aplicado a este slot. */
  exerciseDeload?: boolean;
  /** A5.5: hoy hay un ajuste por dolor aceptado en este slot. */
  painAdjusted?: boolean;
  /** A5.1: de dónde viene el historial de la pista (continúa entre mesos, cambió, pausa). */
  continuity: TrackContinuity;
}

export interface SessionView {
  session: SessionRow;
  isDeload: boolean;
  slots: SlotPrescription[];
  equipment: Equipment;
  /** Calibración medida del RIR del usuario (para mostrar y para el motor). */
  rirCalibration: RirCalibration;
  /** Intensidad fija del día (fuerte/liviano), si la semana base la define. */
  intensity?: DayIntensity;
}

export async function buildSessionView(sessionId: string): Promise<SessionView | null> {
  const rules = getRules();
  const session = await sessionRepo.get(sessionId);
  if (!session) return null;
  const [meso, settings, exById, allMesos] = await Promise.all([
    mesocycleRepo.get(session.mesocycleId),
    settingsRepo.get(),
    exerciseRepo.byId(),
    mesocycleRepo.all(),
  ]);
  if (!meso) return null;
  const mesoRefs = trackMesoRefs(allMesos);
  const today = new Date().toISOString();

  const week = meso.plan.weeks[session.weekIndex];
  const day = week?.days[session.dayIndex];
  if (!day) return null;

  // Calibración del RIR con TODO el historial del meso: decide cuánto confía el
  // motor en el RIR reportado y si conviene no bajar de cierto piso.
  const mesoSessions = await sessionRepo.forMesocycle(meso.id);
  const mesoLogs = (
    await Promise.all(
      mesoSessions.filter((s) => s.status === "completed").map((s) => setLogRepo.forSession(s.id)),
    )
  ).flat();
  const rirCalibration = assessRirCalibration(mesoLogs, rules);
  const rirFloor = calibratedRirFloor(rirCalibration, rules);

  const slots: SlotPrescription[] = [];
  const overrides = session.overrides ?? {};
  for (let i = 0; i < day.slots.length; i++) {
    const basePlanned = day.slots[i];
    const plannedExercise = exById.get(basePlanned.exerciseId);
    // Swap "solo hoy": mismo slot (series, rango, RIR), otro ejercicio.
    const swapId = overrides.exercise?.find((x) => x.slotIndex === i)?.exerciseId;
    const exercise = (swapId ? exById.get(swapId) : undefined) ?? plannedExercise;
    if (!exercise) continue;
    // Swap solo hoy: mismo slot, otro ejercicio y carga estimada para ESE
    // ejercicio (su historial real o el default), nunca la del anterior (M3).
    let planned: PlannedSlot = basePlanned;
    if (swapId && exById.get(swapId) && swapId !== basePlanned.exerciseId) {
      const loadFor = await loadEstimator(exercise.id, session.id);
      planned = {
        ...basePlanned,
        exerciseId: exercise.id,
        targetLoadKg: loadFor(basePlanned.repRange.min, basePlanned.targetRir, basePlanned.targetLoadKg),
      };
    }
    const setsDelta = overrides.setsDelta?.find((x) => x.slotIndex === i)?.delta ?? 0;
    const exDeload = overrides.exerciseDeload?.find((x) => x.slotIndex === i);
    const painAdj = overrides.painAdjust?.find((x) => x.slotIndex === i);

    // Historial de la PISTA anterior a la sesión actual, también de otros mesos
    // (A5.1): mismo ejercicio, rango e intensidad del día. En DUP el mismo
    // ejercicio rota de zona: solo cuenta la MISMA zona.
    const track = await slotTrackHistory({
      session,
      slot: planned,
      slotIndex: i,
      intensity: day.intensity,
      mesos: mesoRefs,
      today,
    });
    const { history } = track.result;

    // Carga base = la ÚLTIMA carga realmente registrada de este ejercicio, no
    // la del snapshot del plan: si subiste (o bajaste) la carga a mano, la
    // sesión siguiente parte de ahí. Excepciones:
    //  - modo peso corporal (plan en 0): se mantiene 0 para no perder el modo.
    //  - semana de deload: se respeta la carga que dictó el plan (la política
    //    del deload es deliberadamente más liviana que tu carga actual).
    const currentLoadKg =
      planned.targetLoadKg === 0 || week.isDeload
        ? planned.targetLoadKg
        : lastLoggedLoad(history) ?? planned.targetLoadKg;

    // Deload: sin progresión; carga por política de la semana (1ª mitad =
    // carga de semana 1, 2ª mitad = fracción) y piso del rango reducido.
    const deload =
      week.isDeload && week.deloadLoadPolicy
        ? deloadLoadForDay({
            dayIndex: session.dayIndex,
            daysInWeek: week.days.length,
            week1LoadKg: planned.targetLoadKg,
            secondHalfFraction: week.deloadLoadPolicy.secondHalfFraction,
            ctx: {
              type: planned.targetLoadKg === 0 ? "bodyweight" : exercise.equipmentType,
              equipment: settings.equipment,
            },
          })
        : null;

    const p = deload
      ? {
          nextLoadKg: deload.loadKg,
          nextReps: planned.repRange.min,
          explain: {
            rule: deload.half === "first" ? ("deload-first-half" as const) : ("deload-second-half" as const),
            inputs: {
              cargaSemana1Kg: planned.targetLoadKg,
              cargaHoyKg: deload.loadKg,
              fraccion: deload.half === "first" ? 1 : week.deloadLoadPolicy!.secondHalfFraction,
            },
          },
          rationale:
            deload.half === "first"
              ? "Deload, primera mitad: carga de la semana 1 con menos series y reps. Gestión de fatiga, no progresión."
              : `Deload, segunda mitad: ${Math.round(week.deloadLoadPolicy!.secondHalfFraction * 100)}% de la carga de la semana 1. Gestión de fatiga, no progresión.`,
        }
      : nextPrescription({
          exerciseHistory: history,
          model: meso.progressionModel,
          targetRir: planned.targetRir,
          repRange: planned.repRange,
          currentLoadKg,
          // Carga 0 = modo peso corporal: el motor no sube carga, progresa por reps.
          equipmentType: planned.targetLoadKg === 0 ? "bodyweight" : exercise.equipmentType,
          equipment: settings.equipment,
          dayType: planned.dayType,
          slotProgression: planned.progression,
          holdLoad: exercise.holdLoad,
          weekIndex: session.weekIndex,
          historyWeekIndex: track.result.last?.weekIndex,
          historyNumAccumulationWeeks: track.result.last
            ? mesoRefs.get(track.result.last.mesocycleId)?.numAccumulationWeeks
            : undefined,
          numAccumulationWeeks: meso.numAccumulationWeeks,
          anchor: continuityAnchor(track.result),
          rirCapOverride: calibratedRirCap(
            rules.progressionModels.double.rirAdjustmentCapReps,
            rirCalibration,
            rules,
          ),
          rules,
        });

    // Piso de RIR si el reporte no está calibrado: no prescribir 0 RIR cuando
    // no sabemos dónde está realmente el fallo para este usuario.
    const baseRir = rirFloor !== null ? Math.max(planned.targetRir, rirFloor) : planned.targetRir;
    // A5.5: ajuste aceptado por dolor (RIR +1); nunca por debajo del piso.
    const targetRir = baseRir + (painAdj?.rirDelta ?? 0);
    // "Última vez" (solo para mostrar, A1.1): la pista (que ya cruza mesos); si
    // no hay, la última vez que se hizo el ejercicio en la misma pista en
    // cualquier meso aunque haya pausa. La progresión NO usa este respaldo.
    let prev = lastSessionSets(history);
    let prevSession = prev ? track.sessions.get(prev.sessionId) : undefined;
    if (!prev) {
      // Respaldo entre mesos SOLO de la misma pista (UX-06): el día liviano no
      // muestra ni copia las series del día fuerte.
      const other = await sameTrackLogs(
        await setLogRepo.completedNonDeloadForExercise(exercise.id, session.id),
        { slot: planned, intensity: day.intensity },
        meso.progressionModel,
      );
      prev = lastSessionSets(other);
      prevSession = prev ? await sessionRepo.get(prev.sessionId) : undefined;
    }
    const ctxLoad = {
      type: planned.targetLoadKg === 0 ? ("bodyweight" as const) : exercise.equipmentType,
      equipment: settings.equipment,
    };
    const baseSets = Math.max(1, planned.sets + setsDelta);
    slots.push({
      slotIndex: i,
      exercise,
      plannedExercise: swapId && plannedExercise && plannedExercise.id !== exercise.id ? plannedExercise : undefined,
      planned,
      sets: exDeload ? Math.max(1, Math.round(baseSets * exDeload.setsFactor)) : baseSets,
      suggestedLoadKg: exDeload
        ? roundToAvailable(p.nextLoadKg * exDeload.loadFactor, ctxLoad)
        : painAdj && painAdj.loadFactor < 1
          ? roundToAvailable(p.nextLoadKg * painAdj.loadFactor, ctxLoad)
          : p.nextLoadKg,
      suggestedReps: painAdj ? Math.min(rules.repRanges.globalValid.max, p.nextReps + painAdj.repsUp) : p.nextReps,
      targetRir,
      rationale: exDeload
        ? `Deload de este ejercicio aplicado hoy (${Math.round(exDeload.setsFactor * 100)}% series, ${Math.round(exDeload.loadFactor * 100)}% carga). ${p.rationale}`
        : painAdj
          ? `Ajuste por dolor aceptado: ${painAdj.loadFactor < 1 ? `${Math.round((1 - painAdj.loadFactor) * 100)}% menos carga y +${painAdj.repsUp} reps (5–30 reps crecen igual con esfuerzo equiparado)` : `RIR +${painAdj.rirDelta}`}. Sin el ajuste, el motor proponía ${p.nextLoadKg} kg × ${p.nextReps}.`
          : p.rationale,
      explain: p.explain,
      previous: prev ? { sets: prev.sets, completedAt: prevSession?.completedAt } : null,
      restSec:
        exercise.restSec ??
        (exercise.secondaryMuscles.length > 0 ? rules.rest.defaultCompoundSec : rules.rest.defaultIsolationSec),
      exerciseDeload: !!exDeload,
      painAdjusted: !!painAdj,
      continuity: track.result.continuity,
    });
  }

  return {
    session,
    isDeload: week.isDeload,
    slots,
    equipment: settings.equipment,
    rirCalibration,
    intensity: day.intensity,
  };
}

/** Mesos en la forma que necesita `trackHistory`. */
export function trackMesoRefs(mesos: MesocycleRow[]): Map<string, TrackMesoRef> {
  return new Map(
    mesos.map((m) => [m.id, { plan: m.plan, progressionModel: m.progressionModel, numAccumulationWeeks: m.numAccumulationWeeks }]),
  );
}

/** Ancla para re-estimar la carga cuando la pista cambió o hubo una pausa (A5.1.2). */
export function continuityAnchor(r: TrackHistoryResult) {
  if (!r.anchor || (r.continuity !== "track-changed" && r.continuity !== "gap")) return undefined;
  return { logs: r.anchor, reason: r.continuity, ageDays: r.anchorAgeDays };
}

/**
 * Historial de la pista de un slot (A5.1): lee los logs del ejercicio en todos
 * los mesos y sus sesiones, y delega el filtrado a `trackHistory` (dominio).
 */
export async function slotTrackHistory(args: {
  session: SessionRow;
  slot: PlannedSlot;
  slotIndex: number;
  intensity?: DayIntensity;
  mesos: Map<string, TrackMesoRef>;
  today: string;
  inclusive?: boolean;
}): Promise<{ result: TrackHistoryResult; sessions: Map<string, SessionRow> }> {
  const logs = await setLogRepo.forExercise(args.slot.exerciseId);
  const rows = await sessionRepo.byIds([...new Set(logs.map((l) => l.sessionId))]);
  const result = trackHistory({
    logs,
    sessions: rows,
    mesos: args.mesos,
    current: {
      mesocycleId: args.session.mesocycleId,
      weekIndex: args.session.weekIndex,
      dayIndex: args.session.dayIndex,
      slotIndex: args.slotIndex,
      slot: args.slot,
      intensity: args.intensity,
      completedAt: args.session.status === "completed" ? args.session.completedAt : undefined,
    },
    today: args.today,
    inclusive: args.inclusive,
    rules: getRules(),
  });
  return { result, sessions: new Map(rows.map((r) => [r.id, r])) };
}

/** Filtra logs (de cualquier meso) a los de sesiones cuyo slot es de la misma pista. */
async function sameTrackLogs(
  logs: SetLog[],
  current: { slot: PlannedSlot; intensity?: DayIntensity },
  model: Parameters<typeof sameProgressionTrack>[2],
): Promise<SetLog[]> {
  if (logs.length === 0) return logs;
  const sessions = await sessionRepo.byIds([...new Set(logs.map((l) => l.sessionId))]);
  const mesos = new Map<string, Awaited<ReturnType<typeof mesocycleRepo.get>>>();
  for (const s of sessions) if (!mesos.has(s.mesocycleId)) mesos.set(s.mesocycleId, await mesocycleRepo.get(s.mesocycleId));
  const ok = new Set<string>();
  for (const s of sessions) {
    const day = mesos.get(s.mesocycleId)?.plan.weeks[s.weekIndex]?.days[s.dayIndex];
    const slot = day?.slots.find((x) => x.exerciseId === current.slot.exerciseId);
    if (day && slot && sameProgressionTrack(current, { slot, intensity: day.intensity }, model)) ok.add(s.id);
  }
  return logs.filter((l) => ok.has(l.sessionId));
}

/**
 * Carga real de la última sesión registrada de este ejercicio (la más pesada
 * entre sus series). null si no hay historial.
 */
function lastLoggedLoad(history: SetLog[]): number | null {
  // Carga de trabajo de la última sesión (sin calentamiento, drop ni parciales).
  const sessions = progressionSessions(history);
  if (sessions.length === 0) return null;
  const last = sessions[sessions.length - 1];
  const max = Math.max(...last.map((l) => l.actualLoadKg));
  return Number.isFinite(max) && max > 0 ? max : null;
}
