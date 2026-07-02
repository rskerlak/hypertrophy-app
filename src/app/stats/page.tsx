"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { computeMesoStats } from "@/domain/stats";
import { getRules } from "@/lib/rulesLoader";
import {
  checkinRepo,
  exerciseRepo,
  mesocycleRepo,
  sessionRepo,
  setLogRepo,
} from "@/db/repositories";
import type { MesoStats } from "@/domain/types";
import { Badge, Button, Card, EmptyState, HonestNote, PageHeader } from "@/components/ui";
import { fmtKg, fmtSets, muscleLabel } from "@/lib/format";
import { FatigueChart } from "@/components/FatigueChart";
import { exportMesoToExcel, type ExportInput } from "@/lib/exportExcel";

export default function StatsPage() {
  const router = useRouter();
  const [state, setState] = useState<
    | { stats: MesoStats; name: string; exNames: Map<string, string>; exportData: ExportInput }
    | null
    | undefined
  >(undefined);

  useEffect(() => {
    (async () => {
      const meso = (await mesocycleRepo.active()) ?? (await mesocycleRepo.all())[0];
      if (!meso) {
        setState(null);
        return;
      }
      const [sessions, exercises] = await Promise.all([
        sessionRepo.forMesocycle(meso.id),
        exerciseRepo.all(),
      ]);
      const setLogs = (
        await Promise.all(sessions.map((s) => setLogRepo.forSession(s.id)))
      ).flat();
      const checkins = await checkinRepo.all();
      const stats = computeMesoStats({
        plan: meso.plan,
        sessions: sessions.map((s) => ({ id: s.id, weekIndex: s.weekIndex, status: s.status })),
        setLogs,
        checkins,
        exercises,
        rules: getRules(),
      });
      setState({
        stats,
        name: meso.name,
        exNames: new Map(exercises.map((e) => [e.id, e.name])),
        exportData: { meso, sessions, setLogs, checkins, exercises, stats },
      });
    })();
  }, []);

  if (state === undefined) return null;
  if (state === null) {
    return (
      <>
        <PageHeader title="Estadísticas" />
        <EmptyState title="Sin datos todavía" hint="Completá sesiones para ver tu calibración." action={<Button onClick={() => router.push("/plan")}>Crear plan</Button>} />
      </>
    );
  }

  const { stats, name, exNames, exportData } = state;

  return (
    <>
      <PageHeader
        title="Estadísticas"
        subtitle={name}
        action={
          <Button size="sm" variant="secondary" onClick={() => exportMesoToExcel(exportData)}>
            ⇩ Excel
          </Button>
        }
      />

      <div className="mb-4">
        <HonestNote>{stats.smallSampleWarning}</HonestNote>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Metric label="Adherencia" value={`${stats.adherence.pct}%`} sub={`${stats.adherence.completed}/${stats.adherence.totalPlanned} sesiones`} />
        <Metric
          label="Volumen completado"
          value={`${stats.volume.completionPct}%`}
          sub={`${fmtSets(stats.volume.completedFractionalSets)} / ${fmtSets(stats.volume.plannedFractionalSets)} series`}
        />
      </div>

      {stats.perExercise.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Progresión de carga estimada (1RM)</h2>
          <Card className="mb-4 space-y-2">
            {stats.perExercise.map((e) => (
              <div key={e.exerciseId} className="flex items-center justify-between text-sm">
                <span className="truncate">{exNames.get(e.exerciseId) ?? e.exerciseId}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-[var(--muted)]">
                    {fmtKg(e.firstEst1RmKg)}→{fmtKg(e.lastEst1RmKg)} kg
                  </span>
                  <Badge tone={e.deltaPct > 0 ? "success" : e.deltaPct < 0 ? "danger" : "neutral"}>
                    {e.deltaPct > 0 ? "+" : ""}
                    {e.deltaPct}%
                  </Badge>
                </span>
              </div>
            ))}
          </Card>
        </>
      )}

      {stats.perMuscle.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Por músculo</h2>
          <Card className="mb-4 space-y-2">
            {stats.perMuscle.map((m) => (
              <div key={m.muscle} className="flex items-center justify-between text-sm">
                <span>{muscleLabel(m.muscle)}</span>
                <Badge tone={m.avgDeltaPct > 0 ? "success" : m.avgDeltaPct < 0 ? "danger" : "neutral"}>
                  {m.avgDeltaPct > 0 ? "+" : ""}
                  {m.avgDeltaPct}%
                </Badge>
              </div>
            ))}
          </Card>
        </>
      )}

      {stats.fatigueTrajectory.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Trayectoria de fatiga (reps a carga fija)</h2>
          <Card className="mb-4">
            <FatigueChart data={stats.fatigueTrajectory} exNames={exNames} />
          </Card>
        </>
      )}

      {stats.rirDrift.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Deriva de precisión de RIR</h2>
          <Card className="mb-4 space-y-1 text-sm">
            {stats.rirDrift.map((d) => (
              <div key={d.weekIndex} className="flex items-center justify-between">
                <span className="text-[var(--muted)]">Semana {d.weekIndex + 1}</span>
                <span className="tabular-nums">
                  {d.meanDiff > 0 ? "+" : ""}
                  {d.meanDiff} reps vs objetivo
                </span>
              </div>
            ))}
            <p className="pt-1 text-xs text-[var(--muted)]">
              Diferencia media entre el RIR reportado y el objetivo. El RIR es más ruidoso lejos del
              fallo.
            </p>
          </Card>
        </>
      )}
    </>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{sub}</p>
    </Card>
  );
}
