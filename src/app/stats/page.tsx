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
import { buildMesoObservations } from "@/lib/mesoObservations";
import { correlationMatrix, summarizeByModel, type CorrelationResult, type MesoObservation } from "@/domain/correlations";
import { CorrelationHeatmap } from "@/components/CorrelationHeatmap";
import { CORRELATION_LABELS, PROGRESSION_LABELS } from "@/lib/format";
import Link from "next/link";

const CORRELATION_VARS = [
  "d1rmPct", "adherencePct", "sleepOkPct", "proteinOkPct", "energyBalanceAvg",
  "d_bodyweightKg", "d_waistCm", "d_chestUnderShouldersCm", "d_shoulderGirthCm",
  "d_bicepCm", "d_quadCm", "d_calfCm",
];

export default function StatsPage() {
  const router = useRouter();
  const [state, setState] = useState<
    | { stats: MesoStats; name: string; exNames: Map<string, string>; exportData: ExportInput }
    | null
    | undefined
  >(undefined);
  const [correlations, setCorrelations] = useState<{
    observations: MesoObservation[];
    result: CorrelationResult;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const observations = await buildMesoObservations();
      setCorrelations({ observations, result: correlationMatrix(observations, CORRELATION_VARS) });
    })();
  }, []);

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

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">
        Comparativa entre mesociclos
      </h2>
      {!correlations || correlations.observations.length < 2 ? (
        <Card className="mb-4">
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Acá se cruzan tus resultados (Δ1RM, medidas corporales) con sueño, proteína, balance
            energético y el tipo de progresión de cada ciclo. Necesita al menos{" "}
            <span className="text-[var(--foreground)]">2 mesociclos completados</span> y{" "}
            <Link href="/measurements" className="text-[var(--primary)] underline">
              medidas registradas
            </Link>{" "}
            al inicio y fin de cada uno.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-3">
            <CorrelationHeatmap result={correlations.result} />
          </Card>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Promedios por tipo de progresión
          </h3>
          <Card className="mb-3 space-y-2">
            {summarizeByModel(correlations.observations, CORRELATION_VARS).map((m) => (
              <div key={m.model} className="border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                <p className="mb-1 text-sm font-semibold">
                  {PROGRESSION_LABELS[m.model] ?? m.model}{" "}
                  <span className="font-normal text-[var(--muted)]">({m.n} meso{m.n > 1 ? "s" : ""})</span>
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                  {CORRELATION_VARS.filter((v) => m.means[v] !== null).map((v) => (
                    <div key={v} className="flex justify-between">
                      <span className="text-[var(--muted)]">{CORRELATION_LABELS[v]}</span>
                      <span className="tabular-nums">{m.means[v]}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>

          <div className="mb-4">
            <HonestNote>
              Correlaciones sobre n={correlations.observations.length} mesociclos: con menos de
              ~4–6 ciclos esto es mayormente ruido y NO establece causalidad (un r alto puede ser
              casualidad, o ambas variables moviéndose por un tercer factor). Usalo como pista para
              hipótesis, no como veredicto.
            </HonestNote>
          </div>
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
