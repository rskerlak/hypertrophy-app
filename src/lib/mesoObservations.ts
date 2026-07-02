// Ensambla las observaciones por mesociclo COMPLETADO para el análisis de
// correlaciones de Stats: junta stats del meso, check-ins y las medidas
// corporales más cercanas al inicio/fin de cada ciclo.

import { computeMesoStats } from "@/domain/stats";
import {
  activityAggregates,
  buildMesoObservation,
  type BodyMeasurement,
  type MesoObservation,
} from "@/domain/correlations";
import {
  activityRepo,
  checkinRepo,
  exerciseRepo,
  measurementRepo,
  mesocycleRepo,
  sessionRepo,
  setLogRepo,
} from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";
import type { MeasurementRow } from "@/db/schema";

/** Ventana máxima (días) entre una medición y el inicio/fin del meso para asociarla. */
const WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function nearestBefore(ms: MeasurementRow[], date: string): BodyMeasurement | undefined {
  const limit = Date.parse(date) + 7 * DAY_MS; // tolerancia: medida tomada apenas después de arrancar
  const candidates = ms.filter(
    (m) => Date.parse(m.date) <= limit && Date.parse(date) - Date.parse(m.date) <= WINDOW_DAYS * DAY_MS,
  );
  return candidates.sort((a, b) => a.date.localeCompare(b.date)).pop();
}

function nearestAfter(ms: MeasurementRow[], date: string): BodyMeasurement | undefined {
  const from = Date.parse(date) - 7 * DAY_MS;
  const candidates = ms.filter(
    (m) => Date.parse(m.date) >= from && Date.parse(m.date) - Date.parse(date) <= WINDOW_DAYS * DAY_MS,
  );
  return candidates.sort((a, b) => a.date.localeCompare(b.date))[0];
}

export async function buildMesoObservations(): Promise<MesoObservation[]> {
  const rules = getRules();
  const [allMesos, measurements, exercises, allActivities] = await Promise.all([
    mesocycleRepo.all(),
    measurementRepo.all(),
    exerciseRepo.all(),
    activityRepo.all(),
  ]);
  const completed = allMesos.filter((m) => m.status === "completed");
  // Si el usuario nunca registró actividades, la variable no existe (null en
  // todos los mesos) y el heatmap la filtra; si registró alguna vez, cero
  // actividad en un meso cuenta como 0 (dato real).
  const usesActivities = allActivities.length > 0;

  const out: MesoObservation[] = [];
  for (const meso of completed) {
    const sessions = await sessionRepo.forMesocycle(meso.id);
    const setLogs = (await Promise.all(sessions.map((s) => setLogRepo.forSession(s.id)))).flat();
    if (setLogs.length === 0) continue; // meso sin datos: no aporta nada
    const checkins = (
      await Promise.all(sessions.map((s) => checkinRepo.forSession(s.id)))
    ).filter((c): c is NonNullable<typeof c> => !!c);

    const stats = computeMesoStats({
      plan: meso.plan,
      sessions: sessions.map((s) => ({ id: s.id, weekIndex: s.weekIndex, status: s.status })),
      setLogs,
      checkins,
      exercises,
      rules,
    });
    const avg1Rm =
      stats.perExercise.length > 0
        ? +(stats.perExercise.reduce((a, e) => a + e.deltaPct, 0) / stats.perExercise.length).toFixed(2)
        : null;

    const startDate = meso.createdAt;
    const endDate =
      sessions.map((s) => s.completedAt).filter((x): x is string => !!x).sort().pop() ?? meso.createdAt;

    const acts = usesActivities ? activityAggregates(allActivities, startDate, endDate) : null;

    out.push(
      buildMesoObservation({
        mesoId: meso.id,
        mesoName: meso.name,
        progressionModel: meso.progressionModel,
        avg1RmDeltaPct: avg1Rm,
        adherencePct: stats.adherence.pct,
        checkins,
        startMeasurement: nearestBefore(measurements, startDate),
        endMeasurement: nearestAfter(measurements, endDate),
        extraSessionsPerWeek: acts?.extraSessionsPerWeek ?? null,
        extraMinutesPerWeek: acts?.extraMinutesPerWeek ?? null,
      }),
    );
  }
  return out;
}
