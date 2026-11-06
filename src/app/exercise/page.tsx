"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { exerciseRepo, mesocycleRepo, sessionRepo, setLogRepo } from "@/db/repositories";
import { exerciseTimeline, loadAdherence, type ExercisePoint, type LoadAdherence } from "@/domain/analytics";
import { getRules } from "@/lib/rulesLoader";
import { muscleLabel } from "@/lib/format";
import { Badge, Button, Card, EmptyState, HonestNote, PageHeader } from "@/components/ui";
import type { Exercise } from "@/domain/types";
import { fmtLoad, toDisplay, unitLabel } from "@/lib/units";

export default function ExercisePage() {
  return (
    <Suspense fallback={null}>
      <ExerciseHistory />
    </Suspense>
  );
}

const COLORS = ["#84cc16", "#0ea5e9", "#f59e0b", "#ef4444"];

/** Historial de un ejercicio en todos los mesos (A3.1). */
function ExerciseHistory() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [data, setData] = useState<
    { ex: Exercise | undefined; points: ExercisePoint[]; mesoNames: Map<string, string>; adherence: LoadAdherence | null } | undefined
  >();

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [exById, logs, mesos] = await Promise.all([exerciseRepo.byId(), setLogRepo.forExercise(id), mesocycleRepo.all()]);
      const sessions = await sessionRepo.byIds([...new Set(logs.map((l) => l.sessionId))]);
      const points = exerciseTimeline({
        exerciseId: id,
        logs,
        sessions,
        plansByMeso: new Map(mesos.map((m) => [m.id, m.plan])),
        rules: getRules(),
      });
      // Adherencia a la carga prescrita de este ejercicio (A3.4), sin deload.
      const deload = new Set(sessions.filter((s) => s.isDeload || s.status !== "completed").map((s) => s.id));
      setData({
        ex: exById.get(id),
        points,
        mesoNames: new Map(mesos.map((m) => [m.id, m.name])),
        adherence: loadAdherence(logs.filter((l) => !deload.has(l.sessionId))),
      });
    })();
  }, [id]);

  const tracks = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.points ?? []) if (!m.has(p.trackKey)) m.set(p.trackKey, p.trackLabel || p.trackKey);
    return [...m.entries()];
  }, [data]);

  if (!data) return null;
  const { ex, points, mesoNames, adherence } = data;
  if (!ex) return <EmptyState title="Ejercicio no encontrado" />;

  const r1 = (kg: number) => Math.round(toDisplay(kg) * 10) / 10;
  const rows = points.map((p) => ({ date: p.date.slice(5, 10), [`e:${p.trackKey}`]: r1(p.e1rmKg), [`c:${p.trackKey}`]: r1(p.topLoadKg) }));
  const best = points.length ? Math.max(...points.map((p) => p.e1rmKg)) : 0;
  const maxLoad = points.length ? Math.max(...points.map((p) => p.topLoadKg)) : 0;

  return (
    <>
      <PageHeader title={ex.name.replace(/\s*\(.*\)$/, "")} subtitle={muscleLabel(ex.primaryMuscle)} />
      {ex.note && <p className="-mt-3 mb-4 text-sm">📝 {ex.note}</p>}

      {points.length === 0 ? (
        <EmptyState title="Sin historial" hint="Cuando completes sesiones con este ejercicio vas a ver su evolución acá." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <Card className="p-3">
              <p className="text-xl font-bold tabular-nums">{points.length}</p>
              <p className="text-[11px] text-[var(--muted)]">sesiones</p>
            </Card>
            <Card className="p-3">
              <p className="text-xl font-bold tabular-nums">{fmtLoad(maxLoad)}</p>
              <p className="text-[11px] text-[var(--muted)]">carga máx. ({unitLabel()})</p>
            </Card>
            <Card className="p-3">
              <p className="text-xl font-bold tabular-nums">{Math.round(toDisplay(best))}</p>
              <p className="text-[11px] text-[var(--muted)]">1RM est. máx.</p>
            </Card>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">1RM estimado por sesión</h2>
          <Card className="mb-2">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickLine={false} />
                  <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                    formatter={(v) => [`${v} ${unitLabel()}`, "1RM est."]}
                  />
                  {tracks.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {tracks.map(([k, label], i) => (
                    <Line key={k} name={label} type="monotone" dataKey={`e:${k}`} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <div className="mb-4">
            <HonestNote>
              Epley ajustado por RIR, con las series de RIR reportado cuando las hay. Es una
              estimación: sirve para tendencia, no como 1RM real. Sin deload ni calentamiento.
            </HonestNote>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Carga tope por sesión</h2>
          <Card className="mb-4">
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickLine={false} />
                  <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                    formatter={(v) => [`${v} ${unitLabel()}`, "Carga"]}
                  />
                  {tracks.map(([k, label], i) => (
                    <Line key={k} name={label} type="monotone" dataKey={`c:${k}`} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {adherence && (
            <Card className="mb-4">
              <p className="text-sm font-medium">Carga hecha vs prescrita</p>
              <p className="mt-1 text-sm tabular-nums">
                {adherence.pctAtTarget}% igual · {adherence.pctAbove}% más · {adherence.pctBelow}% menos
              </p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {adherence.samples} series registradas con la carga sugerida guardada. Desvío medio{" "}
                {adherence.meanDeltaPct > 0 ? "+" : ""}
                {adherence.meanDeltaPct}%.
              </p>
            </Card>
          )}

          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Sesiones</h2>
          <Card className="space-y-3">
            {[...points].reverse().map((p) => (
              <div key={p.sessionId} className="border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                  <span className="min-w-0 truncate">
                    {new Date(p.date).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} · {mesoNames.get(p.mesocycleId)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                    {p.trackLabel && <Badge>{p.trackLabel}</Badge>}
                    <span className="tabular-nums">1RM {Math.round(toDisplay(p.e1rmKg))}</span>
                  </span>
                </div>
                <p className="mt-1 text-sm tabular-nums">
                  {p.sets
                    .map((s) => `${fmtLoad(s.loadKg)}×${s.reps}${s.rirReported ? ` @${s.rir}` : ""}${s.kind && s.kind !== "working" ? ` (${s.kind})` : ""}`)
                    .join(" · ")}
                </p>
              </div>
            ))}
          </Card>
        </>
      )}

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => router.back()}>
          Volver
        </Button>
        <Link href="/plan" className="flex-1">
          <Button variant="secondary" className="w-full">
            Ver en plan
          </Button>
        </Link>
      </div>
    </>
  );
}
