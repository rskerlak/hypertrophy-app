"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { buildSessionView, type SessionView } from "@/lib/sessionPlan";
import { checkinRepo, sessionRepo, setLogRepo, settingsRepo } from "@/db/repositories";
import { useWakeLock } from "@/lib/useWakeLock";
import { uuid } from "@/lib/id";
import { fmtKg } from "@/lib/format";
import { Badge, Button, Card, HonestNote, PageHeader } from "@/components/ui";
import { RestTimer } from "@/components/RestTimer";
import { CheckinSheet } from "@/components/CheckinSheet";
import type { SetLog } from "@/domain/types";

export default function SessionPage() {
  return (
    <Suspense fallback={null}>
      <SessionRunner />
    </Suspense>
  );
}

function SessionRunner() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();

  const [view, setView] = useState<SessionView | null | undefined>(undefined);
  const [showCheckin, setShowCheckin] = useState(false);
  const [restKey, setRestKey] = useState(0);

  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const logsQuery = useLiveQuery(() => (id ? setLogRepo.forSession(id) : Promise.resolve([])), [id]);
  const logs = useMemo(() => logsQuery ?? [], [logsQuery]);
  const existingCheckin = useLiveQuery(() => (id ? checkinRepo.forSession(id) : Promise.resolve(null)), [id]);

  useWakeLock(!!settings?.wakeLockEnabled && view?.session.status !== "completed");

  useEffect(() => {
    if (id) buildSessionView(id).then(setView);
  }, [id]);

  useEffect(() => {
    if (existingCheckin === undefined) return;
    if (existingCheckin === null && logs.length === 0) setShowCheckin(true);
  }, [existingCheckin, logs.length]);

  const logsBySlot = useMemo(() => {
    const m = new Map<string, SetLog[]>();
    for (const l of logs) {
      const arr = m.get(l.exerciseId) ?? [];
      arr.push(l);
      m.set(l.exerciseId, arr);
    }
    return m;
  }, [logs]);

  if (view === undefined) return null;
  if (view === null) {
    return (
      <>
        <PageHeader title="Sesión" />
        <Card>No se encontró la sesión.</Card>
      </>
    );
  }

  const { session, slots, isDeload } = view;
  const done = session.status === "completed";

  const logSet = async (args: {
    exerciseId: string;
    setIndex: number;
    loadKg: number;
    reps: number;
    rir: number;
    targetReps: number;
    targetRir: number;
    existingId?: string;
  }) => {
    const log: SetLog = {
      id: args.existingId ?? uuid(),
      sessionId: id,
      exerciseId: args.exerciseId,
      setIndex: args.setIndex,
      targetLoadKg: args.loadKg,
      targetReps: args.targetReps,
      targetRir: args.targetRir,
      actualLoadKg: args.loadKg,
      actualReps: args.reps,
      actualRir: args.rir,
      timestamp: new Date().toISOString(),
    };
    await setLogRepo.put(log);
    setRestKey((k) => k + 1);
  };

  const completeSession = async () => {
    await sessionRepo.complete(id);
    router.push(`/session/done?id=${id}`);
  };

  const totalSets = slots.reduce((n, s) => n + s.planned.sets, 0);
  const loggedSets = logs.length;

  return (
    <>
      <PageHeader
        title={session.dayLabel}
        subtitle={`${loggedSets}/${totalSets} series`}
        action={isDeload ? <Badge tone="warning">Deload</Badge> : undefined}
      />

      {!done && <RestTimer resetKey={restKey} />}

      {showCheckin && !done && (
        <div className="mt-4">
          <CheckinSheet sessionId={id} onDone={() => setShowCheckin(false)} />
        </div>
      )}

      {isDeload && (
        <div className="mt-4">
          <HonestNote>
            Semana de deload: menos volumen y algo menos de carga para gestionar fatiga. No es un
            potenciador: su objetivo es recuperación y articulaciones.
          </HonestNote>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {slots.map((slot) => (
          <ExerciseBlock
            key={slot.slotIndex}
            slot={slot}
            logs={logsBySlot.get(slot.exercise.id) ?? []}
            disabled={done}
            onLog={logSet}
          />
        ))}
      </div>

      {!done && (
        <Button className="mt-6 w-full" size="lg" disabled={loggedSets === 0} onClick={completeSession}>
          Finalizar sesión
        </Button>
      )}
      {done && <Card className="mt-6 text-center text-sm text-[var(--muted)]">Sesión completada.</Card>}
    </>
  );
}

function ExerciseBlock({
  slot,
  logs,
  disabled,
  onLog,
}: {
  slot: SessionView["slots"][number];
  logs: SetLog[];
  disabled: boolean;
  onLog: (args: {
    exerciseId: string;
    setIndex: number;
    loadKg: number;
    reps: number;
    rir: number;
    targetReps: number;
    targetRir: number;
    existingId?: string;
  }) => void;
}) {
  const { exercise, planned, suggestedLoadKg, suggestedReps, targetRir, rationale } = slot;
  const logsByIndex = new Map(logs.map((l) => [l.setIndex, l]));

  return (
    <Card>
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="font-medium">{exercise.name}</p>
        <Badge tone="primary">RIR {targetRir}</Badge>
      </div>
      <p className="mb-3 text-xs text-[var(--muted)]">
        Objetivo: {fmtKg(suggestedLoadKg)} kg × {suggestedReps} reps ({planned.repRange.min}–
        {planned.repRange.max}) · {planned.sets} series
      </p>

      <div className="space-y-2">
        {Array.from({ length: planned.sets }).map((_, i) => (
          <SetRow
            key={i}
            index={i}
            existing={logsByIndex.get(i)}
            defaultLoad={suggestedLoadKg}
            defaultReps={suggestedReps}
            defaultRir={targetRir}
            disabled={disabled}
            onLog={(loadKg, reps, rir, existingId) =>
              onLog({
                exerciseId: exercise.id,
                setIndex: i,
                loadKg,
                reps,
                rir,
                targetReps: suggestedReps,
                targetRir,
                existingId,
              })
            }
          />
        ))}
      </div>

      {rationale && <p className="mt-2 text-[11px] text-[var(--muted)]">↳ {rationale}</p>}
    </Card>
  );
}

function SetRow({
  index,
  existing,
  defaultLoad,
  defaultReps,
  defaultRir,
  disabled,
  onLog,
}: {
  index: number;
  existing?: SetLog;
  defaultLoad: number;
  defaultReps: number;
  defaultRir: number;
  disabled: boolean;
  onLog: (loadKg: number, reps: number, rir: number, existingId?: string) => void;
}) {
  const [load, setLoad] = useState(existing?.actualLoadKg ?? defaultLoad);
  const [reps, setReps] = useState(existing?.actualReps ?? defaultReps);
  const [rir, setRir] = useState(existing?.actualRir ?? defaultRir);
  const logged = !!existing;

  return (
    <div
      className={
        "flex items-center gap-1 rounded-xl border p-1.5 " +
        (logged ? "border-[var(--success)]/40 bg-[var(--success)]/5" : "border-[var(--border)] bg-[var(--surface-2)]")
      }
    >
      <span className="w-4 shrink-0 text-center text-xs text-[var(--muted)]">{index + 1}</span>
      <Field label="kg" value={load} step={1.25} min={0} onChange={setLoad} format={fmtKg} disabled={disabled} />
      <Field label="reps" value={reps} step={1} min={0} onChange={setReps} disabled={disabled} />
      <Field label="RIR" value={rir} step={1} min={0} onChange={setRir} disabled={disabled} />
      <Button
        size="sm"
        variant={logged ? "secondary" : "primary"}
        disabled={disabled}
        className="w-11 shrink-0 px-0"
        onClick={() => onLog(load, reps, rir, existing?.id)}
      >
        {logged ? "✓" : "Log"}
      </Button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
  min,
  format,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  format?: (v: number) => string;
  disabled: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-0.5 text-center text-[10px] uppercase text-[var(--muted)]">{label}</p>
      <div className="flex items-center justify-center gap-0.5">
        <button
          disabled={disabled}
          className="h-8 w-7 shrink-0 rounded bg-[var(--surface)] text-base disabled:opacity-40"
          onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
        >
          −
        </button>
        <span className="min-w-[30px] text-center text-sm tabular-nums">{format ? format(value) : value}</span>
        <button
          disabled={disabled}
          className="h-8 w-7 shrink-0 rounded bg-[var(--surface)] text-base disabled:opacity-40"
          onClick={() => onChange(+(value + step).toFixed(2))}
        >
          +
        </button>
      </div>
    </div>
  );
}
