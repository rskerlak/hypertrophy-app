"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { computeMesoStats } from "@/domain/stats";
import { getRules } from "@/lib/rulesLoader";
import {
  activityRepo,
  checkinRepo,
  exerciseRepo,
  mesocycleRepo,
  sessionRepo,
  setLogRepo,
} from "@/db/repositories";
import type { MesoStats } from "@/domain/types";
import { Badge, Button, Card, EmptyState, HonestNote, PageHeader, Select } from "@/components/ui";
import { fmtSets, muscleLabel } from "@/lib/format";
import { FatigueChart } from "@/components/FatigueChart";
import { exportMesoToExcel, type ExportInput } from "@/lib/exportExcel";
import { buildMesoObservations } from "@/lib/mesoObservations";
import { assessRirCalibration, type RirCalibration } from "@/domain/rirCalibration";
import {
  loadAdherence,
  repDeltaBySession,
  sleepDebtBySession,
  weeklyReport,
  type LoadAdherence,
  type WeeklyReport,
} from "@/domain/analytics";
import { pearson } from "@/domain/correlations";
import { correlationMatrix, summarizeByModel, type CorrelationResult, type MesoObservation } from "@/domain/correlations";
import { CorrelationHeatmap } from "@/components/CorrelationHeatmap";
import { CORRELATION_LABELS, PROGRESSION_LABELS } from "@/lib/format";
import Link from "next/link";
import { fmtLoad, unitLabel } from "@/lib/units";
import { allExerciseTrends, type ExerciseTrend } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";
import { painReports } from "@/lib/pain";
import type { PainReport } from "@/domain/pain";
import { PAIN_ZONE_LABELS } from "@/lib/format";

const CORRELATION_VARS = [
  "d1rmPct", "adherencePct", "sleepOkPct", "proteinOkPct", "energyBalanceAvg",
  "extraSessionsPerWeek", "extraMinutesPerWeek",
  "d_bodyweightKg", "d_waistCm", "d_chestUnderShouldersCm", "d_shoulderGirthCm",
  "d_bicepCm", "d_quadCm", "d_calfCm",
];

export default function StatsPage() {
  const router = useRouter();
  const [mesos, setMesos] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [mesoId, setMesoId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState<
    | {
        stats: MesoStats;
        name: string;
        exNames: Map<string, string>;
        exportData: ExportInput;
        rirCal: RirCalibration;
        weeks: WeeklyReport[];
        adherence: LoadAdherence | null;
        sleep: { r: number | null; n: number };
      }
    | null
    | undefined
  >(undefined);

  // Lista de mesos y selección inicial: ?meso= → activo → más reciente.
  useEffect(() => {
    (async () => {
      const all = await mesocycleRepo.all();
      setMesos(all.map((m) => ({ id: m.id, name: m.name, status: m.status })));
      const fromQuery = new URLSearchParams(window.location.search).get("meso");
      const initial =
        (fromQuery && all.find((m) => m.id === fromQuery)?.id) ||
        all.find((m) => m.status === "active")?.id ||
        all[0]?.id ||
        null;
      if (!initial) setState(null);
      setMesoId(initial);
    })();
  }, []);
  const [correlations, setCorrelations] = useState<{
    observations: MesoObservation[];
    result: CorrelationResult;
  } | null>(null);

  // A5.5: dolor reportado por zona (covariable; nunca cambia la sesión por sí solo).
  const [pain, setPain] = useState<PainReport[] | null>(null);
  useEffect(() => {
    painReports().then(setPain);
  }, []);

  // Memoria larga (A5.2): tendencia por ejercicio entre mesos.
  const [trends, setTrends] = useState<{ list: ExerciseTrend[]; mesoNames: Map<string, string> } | null>(null);
  useEffect(() => {
    (async () => {
      const [list, all] = await Promise.all([allExerciseTrends(), mesocycleRepo.all()]);
      setTrends({ list, mesoNames: new Map(all.map((m) => [m.id, m.name])) });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const observations = await buildMesoObservations();
      setCorrelations({ observations, result: correlationMatrix(observations, CORRELATION_VARS) });
    })();
  }, []);

  useEffect(() => {
    if (!mesoId) return;
    (async () => {
      const meso = await mesocycleRepo.get(mesoId);
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
      const activities = await activityRepo.all();
      const stats = computeMesoStats({
        plan: meso.plan,
        sessions: sessions.map((s) => ({ id: s.id, weekIndex: s.weekIndex, dayIndex: s.dayIndex, status: s.status })),
        setLogs,
        checkins,
        exercises,
        rules: getRules(),
      });
      const rules = getRules();
      // Reporte por semana del meso (A3.3).
      const refs = sessions.map((s) => ({ ...s, mesocycleId: meso.id }));
      const weeks = meso.plan.weeks.map((w) =>
        weeklyReport({ plan: meso.plan, sessions: refs, logs: setLogs, exercises, weekIndex: w.weekIndex, rules }),
      );
      // Deuda de sueño vs reps a carga fija (A3.5), intra-sujeto y con n chico.
      const ordered = sessions
        .filter((s) => s.status === "completed" && !s.isDeload)
        .sort((a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex);
      const logsBy = new Map<string, typeof setLogs>();
      for (const l of setLogs) logsBy.set(l.sessionId, [...(logsBy.get(l.sessionId) ?? []), l]);
      const debt = sleepDebtBySession(
        ordered.map((s) => s.id),
        new Map(checkins.filter((c) => !!c.sessionId).map((c) => [c.sessionId, c])),
      );
      const deltas = repDeltaBySession(ordered.map((s) => ({ sessionId: s.id, dayKey: String(s.dayIndex), logs: logsBy.get(s.id) ?? [] })));
      const pairs = debt
        .map((d, i) => [d, deltas[i]] as const)
        .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null)
        .map(([a, b]) => [a, b] as [number, number]);
      setState({
        stats,
        name: meso.name,
        exNames: new Map(exercises.map((e) => [e.id, e.name])),
        exportData: { meso, sessions, setLogs, checkins, exercises, stats, activities },
        rirCal: assessRirCalibration(setLogs, rules),
        weeks,
        adherence: loadAdherence(setLogs),
        sleep: { r: pearson(pairs), n: pairs.length },
      });
    })();
  }, [mesoId]);

  if (state === undefined) return null;
  if (state === null) {
    return (
      <>
        <PageHeader title="Estadísticas" />
        <EmptyState title="Sin datos todavía" hint="Completá sesiones para ver tu calibración." action={<Button onClick={() => router.push("/plan")}>Crear plan</Button>} />
      </>
    );
  }

  const { stats, name, exNames, exportData, rirCal, weeks, adherence, sleep } = state;
  const term = q.trim().toLowerCase();
  const visibleExercises = stats.perExercise.filter((e) => !term || (exNames.get(e.exerciseId) ?? "").toLowerCase().includes(term));
  // Semana actual del meso: la última con alguna sesión hecha o la primera.
  const currentWeek = [...weeks].reverse().find((w) => w.sessionsCompleted > 0) ?? weeks[0];

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

      {mesos.length > 1 && (
        <div className="mb-4">
          <Select value={mesoId ?? ""} onChange={(e) => setMesoId(e.target.value)}>
            {mesos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.status === "active" ? " (activo)" : m.status === "paused" ? " (en pausa)" : ""}
              </option>
            ))}
          </Select>
        </div>
      )}

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

      {currentWeek && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">
            {currentWeek.isDeload ? "Semana de deload" : `Semana ${currentWeek.weekIndex + 1}`}
          </h2>
          <Card className="mb-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>
                {currentWeek.sessionsCompleted}/{currentWeek.sessionsPlanned} sesiones
                {currentWeek.sessionsSkipped > 0 && <span className="text-[var(--muted)]"> · {currentWeek.sessionsSkipped} saltadas</span>}
              </span>
              <span className="tabular-nums text-[var(--muted)]">{currentWeek.minutes > 0 ? `${currentWeek.minutes} min` : ""}</span>
            </div>
            <div className="space-y-1">
              {currentWeek.byMuscle.slice(0, 10).map((m) => (
                <div key={m.muscle} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate text-[var(--muted)]">{muscleLabel(m.muscle)}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--primary)]"
                      style={{ width: `${m.planned > 0 ? Math.min(100, (m.done / m.planned) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums">
                    {fmtSets(m.done)}/{fmtSets(m.planned)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted)]">Series fraccionadas de trabajo hechas / planificadas.</p>
          </Card>
        </>
      )}

      {adherence && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Adherencia a la carga prescrita</h2>
          <Card className="mb-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold tabular-nums">{adherence.pctAtTarget}%</p>
                <p className="text-[11px] text-[var(--muted)]">igual</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums">{adherence.pctAbove}%</p>
                <p className="text-[11px] text-[var(--muted)]">más pesada</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums">{adherence.pctBelow}%</p>
                <p className="text-[11px] text-[var(--muted)]">más liviana</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {adherence.samples} series · desvío medio {adherence.meanDeltaPct > 0 ? "+" : ""}
              {adherence.meanDeltaPct}%. Mide cuánto seguís la carga que propone el motor (no es una
              nota: cambiarla a mano también es información).
            </p>
          </Card>
        </>
      )}

      {stats.perExercise.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Progresión de carga estimada (1RM)</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ejercicio…"
            className="mb-2 h-10 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-sm"
          />
          {stats.rirEchoPct !== null && stats.rirEchoPct >= getRules().rirCalibration.echoThresholdPct && (
            <div className="mb-2">
              <HonestNote>
                El 1RM estimado usa el RIR que registraste, y en el {Math.round(stats.rirEchoPct)}% de
                las series coincide exactamente con el objetivo. Como el objetivo baja semana a semana
                (3 → 0), las mismas reps a la misma carga se leen como «más cerca del fallo» y el Δ sale
                artificialmente bajo o negativo. Para este meso, mirá mejor carga y reps a carga fija.
              </HonestNote>
            </div>
          )}
          <Card className="mb-4 space-y-2">
            {visibleExercises.map((e) => (
              <Link
                key={`${e.exerciseId}|${e.track ?? ""}`}
                href={`/exercise?id=${encodeURIComponent(e.exerciseId)}`}
                className="flex items-center justify-between text-sm"
              >
                <span className="truncate">
                  {exNames.get(e.exerciseId) ?? "(ejercicio eliminado)"}
                  {e.track && <span className="text-[var(--muted)]"> · {e.track}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-[var(--muted)]">
                    {fmtLoad(e.firstEst1RmKg)}→{fmtLoad(e.lastEst1RmKg)} {unitLabel()}
                  </span>
                  <Badge tone={e.deltaPct > 0 ? "success" : e.deltaPct < 0 ? "danger" : "neutral"}>
                    {e.deltaPct > 0 ? "+" : ""}
                    {e.deltaPct}%
                  </Badge>
                  <span className="text-[var(--muted)]">›</span>
                </span>
              </Link>
            ))}
            {visibleExercises.length === 0 && <p className="text-sm text-[var(--muted)]">Sin resultados.</p>}
          </Card>
        </>
      )}

      <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Deuda de sueño y rendimiento</h2>
      <Card className="mb-4">
        {sleep.n < 6 || sleep.r === null ? (
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Pocos datos ({sleep.n} sesiones con check-in y comparación a carga fija). Con varias
            sesiones vas a ver si las noches seguidas sin dormir tu mínimo se asocian a menos reps a la
            misma carga.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>Correlación noches sin el mínimo ↔ reps a carga fija</span>
              <span className="tabular-nums">r = {sleep.r.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
              {sleep.n} sesiones. Correlación intra-sujeto con n chico: no prueba causa. La evidencia
              muestra efectos pequeños que crecen con noches acumuladas (Craven 2022: −2,85 % de
              fuerza) y casi nada por una noche aislada; por eso la app nunca recorta la sesión por
              sueño.
            </p>
          </>
        )}
      </Card>

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
        Calibración de tu RIR
      </h2>
      <Card className="mb-4">
        {rirCal.echoDetected ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm">RIR igual al objetivo</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-[var(--muted)]">{Math.round(rirCal.echoPct ?? 0)}% de las series</span>
                <Badge tone="warning">no medible</Badge>
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              Casi siempre registraste exactamente el RIR precargado, así que no hay forma de saber
              cuán preciso es tu reporte: la dispersión saldría baja por construcción, no por
              precisión. Ningún estudio de precisión de RIR muestra coincidencias exactas tan
              sostenidas (el error típico es 0,6–1,5 reps). El motor se comporta como no calibrado
              hasta que el RIR registrado refleje lo que sentís en cada serie.
            </p>
          </>
        ) : rirCal.insufficientData ? (
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Todavía no hay suficientes series repetidas a la misma carga para estimar tu precisión.
            Mientras tanto el motor es conservador: usa medio tope de ajuste por RIR y no prescribe
            0 RIR.
          </p>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm">Dispersión de tu reporte</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-[var(--muted)]">
                  ±{rirCal.meanAbsDeviationReps} reps
                </span>
                <Badge tone={rirCal.wellCalibrated ? "success" : "warning"}>
                  {rirCal.wellCalibrated ? "calibrado" : "ruidoso"}
                </Badge>
              </span>
            </div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>Sesgo vs objetivo</span>
              <span className="tabular-nums text-[var(--muted)]">
                {rirCal.meanSignedBiasReps !== null && rirCal.meanSignedBiasReps > 0 ? "+" : ""}
                {rirCal.meanSignedBiasReps} reps
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              {rirCal.wellCalibrated
                ? "Tu capacidad implícita (reps + RIR) es consistente a carga fija, así que el motor confía en tu RIR con el tope completo y permite acercarse a 0 RIR al final del meso."
                : "Tu capacidad implícita (reps + RIR) varía bastante a carga fija, así que el motor recorta el ajuste por RIR y mantiene un piso de 1 RIR: sin precisión, prescribir el fallo es adivinar."}{" "}
              Medido sobre {rirCal.samples} comparaciones. Es una cota superior del ruido: también
              incluye variación real de rendimiento.
            </p>
          </>
        )}
      </Card>

      {pain && pain.some((r) => r.pain.length > 0) && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Dolor articular reportado</h2>
          <Card className="mb-2 space-y-1.5">
            {[...new Set(pain.flatMap((r) => r.pain.map((p) => p.zone)))].map((z) => {
              const seq = [...pain].sort((a, b) => a.date.localeCompare(b.date)).slice(-10).map((r) => r.pain.find((p) => p.zone === z)?.score ?? 0);
              return (
                <div key={z} className="flex items-center justify-between gap-2 text-sm">
                  <span>{PAIN_ZONE_LABELS[z]}</span>
                  <span className="tabular-nums text-[var(--muted)]">{seq.join(" · ")}</span>
                </div>
              );
            })}
          </Card>
          <div className="mb-4">
            <HonestNote>
              Últimos reportes (0 = sin dolor en esa zona ese día). Es un registro para ver tendencia, no un diagnóstico;
              con n chico no permite atribuir causas.
            </HonestNote>
          </div>
        </>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Entre mesos: 1RM estimado por ejercicio</h2>
      {!trends ? null : trends.list.length === 0 ? (
        <Card className="mb-4">
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Cuando repitas un ejercicio en 2 mesos o más vas a ver acá su tendencia de ciclo a ciclo.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-2 space-y-2">
            {trends.list.map((t) => (
              <TrendCard
                key={t.exercise.id}
                compact
                trend={t.trend}
                mesoNames={trends.mesoNames}
                title={t.exercise.name.replace(/\s*\(.*\)$/, "")}
                href={`/exercise?id=${t.exercise.id}`}
              />
            ))}
          </div>
          <div className="mb-4">
            <HonestNote>
              Mediana de tus mejores sesiones por meso, con RIR reportado. * = no cuenta (mantenimiento,
              Mantener, eco de RIR o sin RIR reportado). El «techo sugerido» es heurístico: con pocos
              ciclos es mayormente ruido. Tocá un ejercicio para ver el detalle.
            </HonestNote>
          </div>
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
            <Link href="/measurements" className="text-[var(--primary-ink)] underline">
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
