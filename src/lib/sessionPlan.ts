// Compone el plan del día con la autorregulación (F6). No es dominio puro
// (lee repos), pero delega todo el cálculo a src/domain.

import { nextPrescription } from "@/domain/progression";
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

    const p = nextPrescription({
      exerciseHistory: history,
      model: meso.progressionModel,
      targetRir: planned.targetRir,
      repRange: planned.repRange,
      currentLoadKg: planned.targetLoadKg,
      equipmentType: exercise.equipmentType,
      equipment: settings.equipment,
      dayType: planned.dayType,
      weekIndex: session.weekIndex,
      numAccumulationWeeks: meso.numAccumulationWeeks,
      rules,
    });

    slots.push({
      slotIndex: i,
      exercise,
      planned,
      suggestedLoadKg: p.nextLoadKg,
      suggestedReps: p.nextReps,
      targetRir: planned.targetRir,
      rationale: p.rationale,
    });
  }

  return { session, isDeload: week.isDeload, slots, equipment: settings.equipment };
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
