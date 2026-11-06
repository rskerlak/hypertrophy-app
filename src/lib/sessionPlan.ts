// Compone el plan del día con la autorregulación (F6). No es dominio puro
// (lee repos), pero delega todo el cálculo a src/domain.

import {
  groupBySession,
  nextPrescription,
  sameProgressionTrack,
  type PrescriptionExplain,
} from "@/domain/progression";
import { lastSessionSets, type PreviousSet } from "@/domain/history";
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
import { mesocycleRepo, sessionRepo, setLogRepo, exerciseRepo, settingsRepo } from "@/db/repositories";
import type { SessionRow } from "@/db/schema";

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
  const [meso, settings, exById] = await Promise.all([
    mesocycleRepo.get(session.mesocycleId),
    settingsRepo.get(),
    exerciseRepo.byId(),
  ]);
  if (!meso) return null;

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
    const planned: PlannedSlot = swapId && exById.get(swapId) ? { ...basePlanned, exerciseId: exercise.id } : basePlanned;
    const setsDelta = overrides.setsDelta?.find((x) => x.slotIndex === i)?.delta ?? 0;
    const exDeload = overrides.exerciseDeload?.find((x) => x.slotIndex === i);

    // Historial del ejercicio dentro de este meso, ANTERIOR a la sesión actual.
    // En DUP el mismo ejercicio rota de zona (pesado/medio/liviano): la doble
    // progresión debe comparar solo contra sesiones de la MISMA zona.
    const history = await exerciseHistoryBefore(
      { slot: planned, intensity: day.intensity },
      meso,
      session.weekIndex,
      session.dayIndex,
    );

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
          weekIndex: session.weekIndex,
          numAccumulationWeeks: meso.numAccumulationWeeks,
          rirCapOverride: calibratedRirCap(
            rules.progressionModels.double.rirAdjustmentCapReps,
            rirCalibration,
            rules,
          ),
          rules,
        });

    // Piso de RIR si el reporte no está calibrado: no prescribir 0 RIR cuando
    // no sabemos dónde está realmente el fallo para este usuario.
    const targetRir = rirFloor !== null ? Math.max(planned.targetRir, rirFloor) : planned.targetRir;
    // "Última vez" (solo para mostrar, A1.1): la pista de este meso; si es la
    // primera sesión del meso, la última vez que se hizo el ejercicio en
    // cualquier meso (sin deload). La progresión NO usa este respaldo.
    let prev = lastSessionSets(history);
    let prevSession = prev ? mesoSessions.find((s) => s.id === prev!.sessionId) : undefined;
    if (!prev) {
      prev = lastSessionSets(await setLogRepo.completedNonDeloadForExercise(exercise.id, session.id));
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
      suggestedLoadKg: exDeload ? roundToAvailable(p.nextLoadKg * exDeload.loadFactor, ctxLoad) : p.nextLoadKg,
      suggestedReps: p.nextReps,
      targetRir,
      rationale: exDeload
        ? `Deload de este ejercicio aplicado hoy (${Math.round(exDeload.setsFactor * 100)}% series, ${Math.round(exDeload.loadFactor * 100)}% carga). ${p.rationale}`
        : p.rationale,
      explain: p.explain,
      previous: prev ? { sets: prev.sets, completedAt: prevSession?.completedAt } : null,
      restSec:
        exercise.restSec ??
        (exercise.secondaryMuscles.length > 0 ? rules.rest.defaultCompoundSec : rules.rest.defaultIsolationSec),
      exerciseDeload: !!exDeload,
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

/**
 * SetLogs de un ejercicio en sesiones completadas del meso previas a (week, day),
 * solo de sesiones de la MISMA pista de progresión (ver sameProgressionTrack):
 * el mismo ejercicio en un día fuerte y en uno liviano progresa por separado.
 */
async function exerciseHistoryBefore(
  current: { slot: PlannedSlot; intensity?: DayIntensity },
  meso: NonNullable<Awaited<ReturnType<typeof mesocycleRepo.get>>>,
  weekIndex: number,
  dayIndex: number,
): Promise<SetLog[]> {
  const exerciseId = current.slot.exerciseId;
  const [allLogs, sessions] = await Promise.all([
    setLogRepo.forExercise(exerciseId),
    sessionRepo.forMesocycle(meso.id),
  ]);
  const order = (w: number, d: number) => w * 1000 + d;
  const cutoff = order(weekIndex, dayIndex);
  const sameTrack = (s: { weekIndex: number; dayIndex: number }) => {
    const day = meso.plan.weeks[s.weekIndex]?.days[s.dayIndex];
    const slot = day?.slots.find((x) => x.exerciseId === exerciseId);
    if (!day || !slot) return false;
    return sameProgressionTrack(current, { slot, intensity: day.intensity }, meso.progressionModel);
  };
  const eligible = new Set(
    sessions
      .filter(
        (s) =>
          s.status === "completed" && order(s.weekIndex, s.dayIndex) < cutoff && sameTrack(s),
      )
      .map((s) => s.id),
  );
  return allLogs.filter((l) => eligible.has(l.sessionId));
}

/**
 * Carga real de la última sesión registrada de este ejercicio (la más pesada
 * entre sus series). null si no hay historial.
 */
function lastLoggedLoad(history: SetLog[]): number | null {
  const sessions = groupBySession(history);
  if (sessions.length === 0) return null;
  const last = sessions[sessions.length - 1];
  const max = Math.max(...last.map((l) => l.actualLoadKg));
  return Number.isFinite(max) && max > 0 ? max : null;
}
