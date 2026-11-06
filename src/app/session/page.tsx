"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { buildSessionView, type SessionView } from "@/lib/sessionPlan";
import { checkinRepo, sessionRepo, setLogRepo, settingsRepo } from "@/db/repositories";
import { useWakeLock } from "@/lib/useWakeLock";
import { uuid } from "@/lib/id";
import { fmtKg } from "@/lib/format";
import { Badge, Button, Card, EditableNumber, HonestNote, PageHeader } from "@/components/ui";
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
  const totalSets = slots.reduce((n, s) => n + s.planned.sets, 0);
  const loggedSets = logs.length;

  const unlogSet = async (logId: string) => {
    await setLogRepo.remove(logId);
  };

  const logSet = async (args: {
    exerciseId: string;
    setIndex: number;
    loadKg: number;
    reps: number;
    rir: number;
    /** Carga PRESCRITA por el motor (0 = peso corporal). La real va en loadKg. */
    targetLoadKg: number;
    targetReps: number;
    targetRir: number;
    /** false = RIR precargado sin tocar (no informa percepción). */
    rirReported: boolean;
    existingId?: string;
  }) => {
    const log: SetLog = {
      id: args.existingId ?? uuid(),
      sessionId: id,
      exerciseId: args.exerciseId,
      setIndex: args.setIndex,
      targetLoadKg: args.targetLoadKg,
      targetReps: args.targetReps,
      targetRir: args.targetRir,
      actualLoadKg: args.loadKg,
      actualReps: args.reps,
      actualRir: args.rir,
      rirReported: args.rirReported,
      timestamp: new Date().toISOString(),
    };
    await setLogRepo.put(log);
    setRestKey((k) => k + 1);
  };

  const completeSession = async () => {
    const remaining = totalSets - loggedSets;
    const msg =
      remaining > 0
        ? `Registraste ${loggedSets} de ${totalSets} series (faltan ${remaining}). ¿Finalizar la sesión igual?`
        : "¿Finalizar la sesión? El motor usará estos registros para calcular la próxima.";
    if (!confirm(msg)) return;
    await sessionRepo.complete(id);
    router.push(`/session/done?id=${id}`);
  };

  return (
    <>
      <PageHeader
        title={session.dayLabel}
        subtitle={`${loggedSets}/${totalSets} series`}
        action={
          <>
            {view.intensity === "heavy" && <Badge tone="danger">Fuerte</Badge>}
            {view.intensity === "light" && <Badge tone="primary">Liviano</Badge>}
            {isDeload && <Badge tone="warning">Deload</Badge>}
          </>
        }
      />

      {!done && <RestTimer resetKey={restKey} />}

      {showCheckin && !done && (
        <div className="mt-4">
          <CheckinSheet sessionId={id} onDone={() => setShowCheckin(false)} />
        </div>
      )}

      {!done && view.rirCalibration.echoDetected && (
        <div className="mt-4">
          <HonestNote>
            En el {Math.round(view.rirCalibration.echoPct ?? 0)}% de tus series el RIR registrado es
            exactamente el objetivo precargado. Si al terminar cada serie ajustás el RIR a lo que
            sentiste (aunque sea ±1), el motor puede adaptar reps y cargas a vos; mientras tanto se
            comporta como no calibrado (piso de 1 RIR, ajuste prudente).
          </HonestNote>
        </div>
      )}

      {!done &&
        !view.rirCalibration.echoDetected &&
        !view.rirCalibration.wellCalibrated &&
        !view.rirCalibration.insufficientData && (
        <div className="mt-4">
          <HonestNote>
            Tu RIR reportado viene variando ±{view.rirCalibration.meanAbsDeviationReps} reps a carga
            fija, así que el motor mantiene un piso de 1 RIR y ajusta con más cautela. Se recalibra
            solo a medida que registrás.
          </HonestNote>
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
            bodyweightKg={settings?.bodyweightKg ?? 0}
            onLog={logSet}
            onUnlog={unlogSet}
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
  bodyweightKg,
  onLog,
  onUnlog,
}: {
  slot: SessionView["slots"][number];
  logs: SetLog[];
  disabled: boolean;
  bodyweightKg: number;
  onLog: (args: {
    exerciseId: string;
    setIndex: number;
    loadKg: number;
    reps: number;
    rir: number;
    targetLoadKg: number;
    targetReps: number;
    targetRir: number;
    rirReported: boolean;
    existingId?: string;
  }) => void;
  onUnlog: (logId: string) => void;
}) {
  const { exercise, planned, suggestedLoadKg, suggestedReps, targetRir, rationale } = slot;
  const logsByIndex = new Map(logs.map((l) => [l.setIndex, l]));
  // Convención: carga planificada 0 = ejercicio a PESO CORPORAL. La carga no
  // progresa (el volumen/reps sí) y se registra tu peso corporal como carga real.
  const isBodyweight = planned.targetLoadKg === 0;

  return (
    <Card>
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="font-medium">{exercise.name}</p>
        <Badge tone="primary">RIR {targetRir}</Badge>
      </div>
      <p className="mb-3 text-xs text-[var(--muted)]">
        Objetivo: {isBodyweight ? "corporal" : `${fmtKg(suggestedLoadKg)} kg`} × {suggestedReps} reps ({planned.repRange.min}–
        {planned.repRange.max}
        {suggestedReps > planned.repRange.max ? ` +${suggestedReps - planned.repRange.max}` : ""}) · {planned.sets} series
      </p>

      <div className="space-y-2">
        {Array.from({ length: planned.sets }).map((_, i) => (
          <SetRow
            key={i}
            index={i}
            existing={logsByIndex.get(i)}
            defaultLoad={isBodyweight ? bodyweightKg : suggestedLoadKg}
            defaultReps={suggestedReps}
            defaultRir={targetRir}
            disabled={disabled}
            bodyweight={isBodyweight}
            // La ÚLTIMA serie de cada ejercicio pide el RIR explícito: es la
            // más cercana al fallo y la más precisa (Russo 2025). Las demás
            // se precargan con el objetivo y cuentan como "no reportado"
            // salvo que el RIR se toque.
            requireRir={i === planned.sets - 1}
            onLog={(loadKg, reps, rir, rirReported, existingId) =>
              onLog({
                exerciseId: exercise.id,
                setIndex: i,
                loadKg,
                reps,
                rir,
                // Lo que pidió el motor, no lo que se levantó: permite medir
                // adherencia y si el motor prescribe bien (la progresión usa
                // siempre actualLoadKg).
                targetLoadKg: isBodyweight ? 0 : suggestedLoadKg,
                targetReps: suggestedReps,
                targetRir,
                rirReported,
                existingId,
              })
            }
            onUnlog={onUnlog}
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
  bodyweight,
  requireRir,
  onLog,
  onUnlog,
}: {
  index: number;
  existing?: SetLog;
  defaultLoad: number;
  defaultReps: number;
  defaultRir: number;
  disabled: boolean;
  bodyweight: boolean;
  /** true en la última serie: RIR vacío hasta elegirlo (A1.11). */
  requireRir: boolean;
  onLog: (loadKg: number, reps: number, rir: number, rirReported: boolean, existingId?: string) => void;
  onUnlog: (logId: string) => void;
}) {
  const [load, setLoad] = useState(existing?.actualLoadKg ?? defaultLoad);
  const [reps, setReps] = useState(existing?.actualReps ?? defaultReps);
  // RIR: null = todavía sin elegir (solo en la serie que lo pide).
  const [rir, setRirState] = useState<number | null>(
    existing?.actualRir ?? (requireRir ? null : defaultRir),
  );
  const [rirTouched, setRirTouched] = useState(false);
  const setRir = (v: number) => {
    setRirState(v);
    setRirTouched(true);
  };
  const logged = !!existing;
  const needsRir = requireRir && rir === null && !logged;
  // Serie logueada = BLOQUEADA (gris) para no tocarla sin querer.
  // Para editar: ✓ des-loguea, corregís y volvés a dar Log.
  const locked = disabled || logged;

  return (
    <div>
    <div
      className={
        "flex items-center gap-1 rounded-xl border p-1.5 " +
        (logged ? "border-[var(--success)]/40 bg-[var(--success)]/5" : "border-[var(--border)] bg-[var(--surface-2)]")
      }
    >
      <span className="w-4 shrink-0 text-center text-xs text-[var(--muted)]">{index + 1}</span>
      {bodyweight ? (
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-center text-[10px] uppercase text-[var(--muted)]">kg</p>
          <p className={"text-center text-sm font-medium " + (locked ? "opacity-50" : "")}>BW</p>
        </div>
      ) : (
        <Field label="kg" value={load} step={1.25} min={0} onChange={setLoad} format={fmtKg} disabled={locked} />
      )}
      <Field label="reps" value={reps} step={1} min={0} onChange={setReps} disabled={locked} />
      {needsRir ? (
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-center text-[10px] uppercase text-[var(--primary)]">RIR ↓</p>
          <p className="flex h-8 items-center justify-center text-sm font-semibold text-[var(--primary)]">?</p>
        </div>
      ) : (
        <Field label="RIR" value={rir ?? defaultRir} step={1} min={0} onChange={setRir} disabled={locked} />
      )}
      <Button
        size="sm"
        variant={logged ? "secondary" : "primary"}
        disabled={disabled || needsRir}
        className="w-11 shrink-0 px-0"
        title={logged ? "Des-loguear para editar" : needsRir ? "Elegí el RIR de esta serie" : "Registrar serie"}
        onClick={() =>
          logged
            ? onUnlog(existing.id)
            : onLog(load, reps, rir ?? defaultRir, requireRir || rirTouched)
        }
      >
        {logged ? "✓" : "Log"}
      </Button>
    </div>
    {needsRir && !disabled && <RirPicker onPick={setRir} />}
    </div>
  );
}

/**
 * Selector rápido de RIR para la serie que lo pide: un tap elige y habilita
 * "Log". Valores fijos de la escala (0 = al fallo … 4+ = lejos del fallo).
 */
function RirPicker({ onPick }: { onPick: (rir: number) => void }) {
  return (
    <div className="mt-1.5 pl-5">
      <p className="mb-1 text-[11px] text-[var(--muted)]">¿Cuántas reps te quedaban en esta serie?</p>
      <div className="flex gap-1">
      {[0, 1, 2, 3, 4].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className="h-9 min-w-9 flex-1 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/10 text-sm font-semibold text-[var(--primary)] active:scale-95"
        >
          {v === 4 ? "4+" : v}
        </button>
      ))}
      </div>
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
        <EditableNumber
          value={value}
          onChange={(v) => onChange(+v.toFixed(2))}
          min={min}
          format={format}
          disabled={disabled}
          className="h-8 w-full min-w-[34px] text-sm"
        />
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
