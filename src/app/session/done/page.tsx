"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { analyzePostSession, type PostSessionAnalysis } from "@/lib/postSession";
import { sessionSummary, type SessionSummary } from "@/lib/sessionExtras";
import { mesocycleRepo, sessionRepo } from "@/db/repositories";
import { fmtKg, muscleLabel } from "@/lib/format";
import { Badge, Button, Card, HonestNote, PageHeader } from "@/components/ui";

export default function SessionDonePage() {
  return (
    <Suspense fallback={null}>
      <SessionDone />
    </Suspense>
  );
}

function SessionDone() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [analysis, setAnalysis] = useState<PostSessionAnalysis | null | undefined>(undefined);
  const [summary, setSummary] = useState<SessionSummary | null | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    analyzePostSession(id).then(setAnalysis);
    sessionSummary(id).then(setSummary);
  }, [id]);

  const prLine = (p: SessionSummary["prs"][number]) =>
    p.kind === "load"
      ? `carga ${fmtKg(p.value)} kg (antes ${fmtKg(p.previous ?? 0)})`
      : p.kind === "repsAtLoad"
        ? `${p.value} reps con ${fmtKg(p.atLoadKg ?? 0)} kg (antes ${p.previous})`
        : `1RM estimado ${fmtKg(p.value)} kg (antes ${fmtKg(p.previous ?? 0)})`;

  return (
    <>
      <PageHeader title="¡Sesión completada!" subtitle="Buen trabajo." />

      {summary && (
        <Card className="mb-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-2xl font-bold tabular-nums">{summary.loggedSets}</p>
              <p className="text-[11px] text-[var(--muted)]">de {summary.plannedSets} series</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{summary.durationMin ?? "—"}</p>
              <p className="text-[11px] text-[var(--muted)]">minutos</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{summary.prs.length}</p>
              <p className="text-[11px] text-[var(--muted)]">récords</p>
            </div>
          </div>
          {summary.volumeByMuscle.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
              Series fraccionadas hoy:{" "}
              {summary.volumeByMuscle.map((v) => `${muscleLabel(v.muscle)} ${fmtKg(v.sets)}`).join(" · ")}
            </p>
          )}
          {summary.prs.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {summary.prs.map((p, i) => (
                <li key={i}>
                  <span className="text-[var(--success)]">★</span> {p.exerciseName.replace(/\s*\(.*\)$/, "")}: {prLine(p)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            Tus series quedaron registradas; el motor las usa para autorregular la próxima sesión de
            este día.
          </p>
        </Card>
      )}

      {analysis === undefined && <Card>Analizando…</Card>}

      {analysis && analysis.deload.shouldSuggest && !dismissed && (
        <Card className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="warning">Deload sugerido</Badge>
          </div>
          <p className="mb-2 text-sm">
            {analysis.deload.forced
              ? "Terminaste las semanas de acumulación programadas."
              : "Aparecieron señales de fatiga acumulada:"}
          </p>
          <ul className="mb-3 list-inside list-disc space-y-1 text-sm text-[var(--muted)]">
            {analysis.deload.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <HonestNote>
            Son señales probabilísticas de fatiga, no la prueba de haber &quot;superado tu MRV&quot;.
            La caída de rendimiento es sobre todo fatiga aguda. Vos decidís si descargar.
          </HonestNote>
          {!analysis.deload.forced && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={async () => {
                  const s = await sessionRepo.get(id);
                  if (!s) return;
                  if (!confirm("¿Descargar ahora? Las sesiones de acumulación que faltan se marcan como saltadas (podés reabrirlas desde la Agenda) y la próxima es el deload.")) return;
                  const n = await mesocycleRepo.startDeloadNow(s.mesocycleId);
                  setMsg(`Listo: ${n} sesiones saltadas; la próxima es el deload.`);
                  setDismissed(true);
                }}
              >
                Descargar ahora
              </Button>
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => setDismissed(true)}>
                Seguir con el plan
              </Button>
            </div>
          )}
        </Card>
      )}

      {analysis && analysis.swaps.length > 0 && (
        <Card className="mb-4">
          <p className="mb-2 font-medium">Sugerencias de cambio de ejercicio</p>
          {analysis.swaps.map((s) => (
            <div key={s.exerciseId} className="mb-2 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
              <p className="font-medium">
                {s.exerciseName}
                {s.candidateName && <span className="text-[var(--muted)]"> → {s.candidateName}</span>}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">{s.reason}</p>
              {s.candidateId && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full"
                  disabled={applied.has(s.slotIndex)}
                  onClick={async () => {
                    const sess = await sessionRepo.get(id);
                    if (!sess || !s.candidateId) return;
                    await mesocycleRepo.swapExerciseInPlan(sess.mesocycleId, sess.dayIndex, s.slotIndex, s.candidateId, sess.weekIndex + 1);
                    setApplied(new Set([...applied, s.slotIndex]));
                  }}
                >
                  {applied.has(s.slotIndex) ? "✓ Cambiado desde la próxima semana" : "Cambiar en el plan desde la próxima semana"}
                </Button>
              )}
            </div>
          ))}
          <p className="text-[11px] text-[var(--muted)]">
            Solo sobre ejercicios marcados como intercambiables y ante estancamiento; nunca rotación
            aleatoria.
          </p>
        </Card>
      )}

      {msg && <p className="mb-3 text-center text-sm text-[var(--success)]">{msg}</p>}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => router.push("/")}>
          Volver al inicio
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={async () => {
            if (!confirm("¿Reabrir la sesión para corregir algo?")) return;
            await sessionRepo.reopen(id);
            router.push(`/session?id=${id}`);
          }}
        >
          Reabrir
        </Button>
      </div>
    </>
  );
}
