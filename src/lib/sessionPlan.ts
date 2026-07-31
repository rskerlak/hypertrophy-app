// Compone el plan del día con la autorregulación (F6). No es dominio puro
// (lee repos), pero delega todo el cálculo a src/domain.

import { groupBySession, nextPrescription } from "@/domain/progression";
import {
  assessRirCalibration,
  calibratedRirCap,
  calibratedRirFloor,
  type RirCalibration,
} from "@/domain/rirCalibration";
import { getRules } from "@/lib/rulesLoader";
import type { Equipment, Exercise, PlannedSlot, SetLog } from "@/domain/types";
import { mesocycleRepo, sessionRepo, setLogRepo, exerciseRepo, settingsRepo } from "@/db/repositories";
import type { SessionRow } from "@/db/schema";

export interface SlotPrescription {
  slotIndex: number;
  exercise: Exercise;
  planned: PlannedSlot;
  suggestedLoadKg: number;
  suggestedReps: number;
  targetRir: number;
  rationale: string;
}

export interface SessionView {
  session: SessionRow;
  isDeload: boolean;
  slots: SlotPrescription[];
  equipment: Equipment;
  /** Calibración medida del RIR del usuario (para mostrar y para el motor). */
  rirCalibration: RirCalibration;
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
  for (let i = 0; i < day.slots.length; i++) {
    const planned = day.slots[i];
    const exercise = exById.get(planned.exerciseId);
    if (!exercise) continue;

    // Historial del ejercicio dentro de este meso, ANTERIOR a la sesión actual.
    // En DUP el mismo ejercicio rota de zona (pesado/medio/liviano): la doble
    // progresión debe comparar solo contra sesiones de la MISMA zona.
    const history = await exerciseHistoryBefore(
      planned.exerciseId,
      meso,
      session.weekIndex,
      session.dayIndex,
      meso.progressionModel === "dup" ? planned.dayType : undefined,
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

    const p = nextPrescription({
      exerciseHistory: history,
      model: meso.progressionModel,
      targetRir: planned.targetRir,
      repRange: planned.repRange,
      currentLoadKg,
      // Carga 0 = modo peso corporal: el motor no sube carga, progresa por reps.
      equipmentType: planned.targetLoadKg === 0 ? "bodyweight" : exercise.equipmentType,
      equipment: settings.equipment,
      dayType: planned.dayType,
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
    slots.push({
      slotIndex: i,
      exercise,
      planned,
      suggestedLoadKg: p.nextLoadKg,
      suggestedReps: p.nextReps,
      targetRir,
      rationale: p.rationale,
    });
  }

  return {
    session,
    isDeload: week.isDeload,
    slots,
    equipment: settings.equipment,
    rirCalibration,
  };
}

/**
 * SetLogs de un ejercicio en sesiones completadas del meso previas a (week, day).
 * Si se pasa `dayType` (DUP), solo cuenta sesiones donde el slot planificado de
 * ese ejercicio estaba en la misma zona.
 */
async function exerciseHistoryBefore(
  exerciseId: string,
  meso: NonNullable<Awaited<ReturnType<typeof mesocycleRepo.get>>>,
  weekIndex: number,
  dayIndex: number,
  dayType?: SessionView["slots"][number]["planned"]["dayType"],
): Promise<SetLog[]> {
  const [allLogs, sessions] = await Promise.all([
    setLogRepo.forExercise(exerciseId),
    sessionRepo.forMesocycle(meso.id),
  ]);
  const order = (w: number, d: number) => w * 1000 + d;
  const cutoff = order(weekIndex, dayIndex);
  const sameZone = (s: { weekIndex: number; dayIndex: number }) => {
    if (!dayType) return true;
    const slot = meso.plan.weeks[s.weekIndex]?.days[s.dayIndex]?.slots.find(
      (x) => x.exerciseId === exerciseId,
    );
    return slot?.dayType === dayType;
  };
  const eligible = new Set(
    sessions
      .filter(
        (s) =>
          s.status === "completed" && order(s.weekIndex, s.dayIndex) < cutoff && sameZone(s),
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
