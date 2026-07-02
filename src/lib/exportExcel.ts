// Exportación del mesociclo completo a Excel (.xlsx) con SheetJS.
// Hojas: Resumen · Progresión · Sesiones · Series · Volumen semanal.
// Corre 100% en el navegador (sin backend): genera y descarga el archivo.

import * as XLSX from "xlsx";
import type { Checkin, Exercise, MesoStats, SetLog } from "@/domain/types";
import type { ActivityRow, MesocycleRow, SessionRow } from "@/db/schema";
import { ACTIVITY_LABELS, muscleLabel, PROGRESSION_LABELS } from "@/lib/format";

export interface ExportInput {
  meso: MesocycleRow;
  sessions: SessionRow[];
  setLogs: SetLog[];
  checkins: Checkin[];
  exercises: Exercise[];
  stats: MesoStats;
  activities?: ActivityRow[];
}

const STATUS_ES: Record<string, string> = {
  pending: "Pendiente",
  completed: "Completada",
  skipped: "Salteada",
};

export function exportMesoToExcel(input: ExportInput): void {
  const { meso, sessions, setLogs, exercises, stats } = input;
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const wb = XLSX.utils.book_new();

  // ---------- Resumen ----------
  const resumen: Array<Array<string | number>> = [
    ["Mesociclo", meso.name],
    ["Modelo de progresión", PROGRESSION_LABELS[meso.progressionModel] ?? meso.progressionModel],
    ["Semanas de acumulación", meso.plan.numAccumulationWeeks],
    ["Semanas de deload", meso.deloadWeeks],
    ["Estado", meso.status === "completed" ? "Completado" : meso.status === "active" ? "Activo" : "Planificado"],
    [],
    ["Adherencia", `${stats.adherence.pct}%`],
    ["Sesiones completadas", stats.adherence.completed],
    ["Sesiones salteadas", stats.adherence.skipped],
    ["Sesiones planificadas", stats.adherence.totalPlanned],
    [],
    ["Volumen completado (series fraccionadas)", stats.volume.completedFractionalSets],
    ["Volumen planeado (series fraccionadas)", stats.volume.plannedFractionalSets],
    ["% completado", `${stats.volume.completionPct}%`],
    [],
    ["Nota", stats.smallSampleWarning],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
  wsResumen["!cols"] = [{ wch: 38 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  // ---------- Progresión (1RM estimado por ejercicio y por músculo) ----------
  const prog: Array<Array<string | number>> = [
    ["Ejercicio", "1RM estimado inicial (kg)", "1RM estimado final (kg)", "Δ %"],
    ...stats.perExercise.map((e) => [
      exById.get(e.exerciseId)?.name ?? e.exerciseId,
      e.firstEst1RmKg,
      e.lastEst1RmKg,
      e.deltaPct,
    ]),
    [],
    ["Músculo", "Δ % promedio", "", ""],
    ...stats.perMuscle.map((m) => [muscleLabel(m.muscle), m.avgDeltaPct, "", ""]),
  ];
  const wsProg = XLSX.utils.aoa_to_sheet(prog);
  wsProg["!cols"] = [{ wch: 44 }, { wch: 22 }, { wch: 22 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsProg, "Progresión");

  // ---------- Sesiones ----------
  const ses: Array<Array<string | number>> = [
    ["Semana", "Día", "Etiqueta", "Estado", "Fecha planificada", "Completada el"],
    ...[...sessions]
      .sort((a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex)
      .map((s) => [
        s.weekIndex + 1,
        s.dayIndex + 1,
        s.dayLabel + (s.isDeload ? " (deload)" : ""),
        STATUS_ES[s.status] ?? s.status,
        s.plannedDate ? s.plannedDate.slice(0, 10) : "",
        s.completedAt ? s.completedAt.slice(0, 10) : "",
      ]),
  ];
  const wsSes = XLSX.utils.aoa_to_sheet(ses);
  wsSes["!cols"] = [{ wch: 8 }, { wch: 6 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsSes, "Sesiones");

  // ---------- Series (todos los setLogs) ----------
  const logs = [...setLogs].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const series: Array<Array<string | number>> = [
    [
      "Fecha", "Semana", "Día", "Ejercicio", "Serie",
      "Carga objetivo (kg)", "Reps objetivo", "RIR objetivo",
      "Carga real (kg)", "Reps reales", "RIR real",
    ],
    ...logs.map((l) => {
      const s = sessionById.get(l.sessionId);
      return [
        l.timestamp.slice(0, 10),
        s ? s.weekIndex + 1 : "",
        s ? s.dayIndex + 1 : "",
        exById.get(l.exerciseId)?.name ?? l.exerciseId,
        l.setIndex + 1,
        l.targetLoadKg,
        l.targetReps,
        l.targetRir,
        l.actualLoadKg,
        l.actualReps,
        l.actualRir,
      ];
    }),
  ];
  const wsSeries = XLSX.utils.aoa_to_sheet(series);
  wsSeries["!cols"] = [
    { wch: 11 }, { wch: 8 }, { wch: 5 }, { wch: 44 }, { wch: 6 },
    { wch: 17 }, { wch: 13 }, { wch: 12 }, { wch: 15 }, { wch: 11 }, { wch: 9 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSeries, "Series");

  // ---------- Volumen semanal planificado por músculo ----------
  const muscles = Object.keys(meso.plan.weeks[0]?.targetVolumeByMuscle ?? {}).filter((m) =>
    meso.plan.weeks.some((w) => (w.targetVolumeByMuscle[m] ?? 0) > 0),
  );
  const vol: Array<Array<string | number>> = [
    ["Músculo", ...meso.plan.weeks.map((w) => (w.isDeload ? "Deload" : `Semana ${w.weekIndex + 1}`))],
    ...muscles.map((m) => [
      muscleLabel(m),
      ...meso.plan.weeks.map((w) => Math.round((w.targetVolumeByMuscle[m] ?? 0) * 10) / 10),
    ]),
  ];
  const wsVol = XLSX.utils.aoa_to_sheet(vol);
  wsVol["!cols"] = [{ wch: 22 }, ...meso.plan.weeks.map(() => ({ wch: 10 }))];
  XLSX.utils.book_append_sheet(wb, wsVol, "Volumen");

  // ---------- Actividades extra (si hay) ----------
  if (input.activities && input.activities.length > 0) {
    const INTENSITY: Record<number, string> = { 1: "Suave", 2: "Moderada", 3: "Intensa" };
    const acts: Array<Array<string | number>> = [
      ["Fecha", "Actividad", "Duración (min)", "Intensidad", "Nota"],
      ...[...input.activities]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((a) => [
          a.date.slice(0, 10),
          ACTIVITY_LABELS[a.type] ?? a.type,
          a.durationMin ?? "",
          a.intensity ? INTENSITY[a.intensity] : "",
          a.note ?? "",
        ]),
    ];
    const wsActs = XLSX.utils.aoa_to_sheet(acts);
    wsActs["!cols"] = [{ wch: 11 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsActs, "Actividades");
  }

  const safeName = meso.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "mesociclo";
  XLSX.writeFile(wb, `${safeName}.xlsx`, { compression: true });
}
