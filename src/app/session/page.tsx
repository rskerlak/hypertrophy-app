"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { buildSessionView, type SessionView, type SlotPrescription } from "@/lib/sessionPlan";
import { prsForSet } from "@/lib/sessionExtras";
import { checkinRepo, exerciseRepo, mesocycleRepo, sessionRepo, setLogRepo, settingsRepo } from "@/db/repositories";
import { useWakeLock } from "@/lib/useWakeLock";
import { uuid } from "@/lib/id";
import { fmtKg } from "@/lib/format";
import { getRules } from "@/lib/rulesLoader";
import { Badge, Button, Card, EditableNumber, HonestNote, PageHeader, cn } from "@/components/ui";
import { EquipmentProfilePicker } from "@/components/EquipmentProfilePicker";
import { Sheet } from "@/components/Dialog";
import { RestTimer } from "@/components/RestTimer";
import { CheckinSheet } from "@/components/CheckinSheet";
import { nextAchievableLoad, plateBreakdown, roundToAvailable, type RoundingContext } from "@/domain/rounding";
import { warmupSets } from "@/domain/warmup";
import { compareToPrevious, previousForIndex, type PreviousSet } from "@/domain/history";
import { intraSessionAdjust, type IntraSessionHint } from "@/domain/intraSession";
import type { PR } from "@/domain/records";
import { isWorkingSet, type Exercise, type SetKind, type SetLog } from "@/domain/types";
import { askConfirm } from "@/store/dialogs";
import { fmtLoad, unitLabel } from "@/lib/units";

export default function SessionPage() {
  return (
    <Suspense fallback={null}>
      <SessionRunner />
    </Suspense>
  );
}

/** Índice para series de calentamiento: fuera del rango de las de trabajo. */
const WARMUP_BASE_INDEX = 100;

interface LogArgs {
  slotIndex: number;
  exerciseId: string;
  setIndex: number;
  loadKg: number;
  reps: number;
  rir: number;
  targetLoadKg: number;
  targetReps: number;
  targetRir: number;
  rirReported: boolean;
  kind: SetKind;
  side?: "L" | "R";
  note?: string;
  existingId?: string;
}

function SessionRunner() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const rules = getRules();

  const [view, setView] = useState<SessionView | null | undefined>(undefined);
  const [showCheckin, setShowCheckin] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<SlotPrescription | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const sessionRow = useLiveQuery(() => (id ? sessionRepo.get(id) : Promise.resolve(undefined)), [id]);
  const logsQuery = useLiveQuery(() => (id ? setLogRepo.forSession(id) : Promise.resolve([])), [id]);
  const logs = useMemo(() => logsQuery ?? [], [logsQuery]);
  // undefined = cargando; null = no hay check-in (forSession devuelve undefined
  // cuando no existe: sin este mapeo el check-in no aparecía nunca).
  const existingCheckin = useLiveQuery(
    async () => (id ? ((await checkinRepo.forSession(id)) ?? null) : null),
    [id],
  );
  const allExercises = useLiveQuery(() => exerciseRepo.selectable(), []);

  const refresh = useCallback(() => {
    if (id) buildSessionView(id).then(setView);
  }, [id]);
  useEffect(refresh, [refresh]);

  useWakeLock(!!settings?.wakeLockEnabled && view?.session.status !== "completed");

  useEffect(() => {
    if (existingCheckin === undefined) return;
    if (existingCheckin === null && logs.length === 0) setShowCheckin(true);
  }, [existingCheckin, logs.length]);

  // Reloj de la sesión (duración) a resolución de minuto.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Series por slot: por slotIndex (datos nuevos) o por ejercicio (datos viejos).
  const logsBySlot = useMemo(() => {
    const m = new Map<number, SetLog[]>();
    if (!view) return m;
    for (const l of logs) {
      const slot =
        l.slotIndex ?? view.slots.find((s) => s.exercise.id === l.exerciseId || s.planned.exerciseId === l.exerciseId)?.slotIndex;
      if (slot === undefined) continue;
      m.set(slot, [...(m.get(slot) ?? []), l]);
    }
    return m;
  }, [logs, view]);

  if (view === undefined) return null;
  if (view === null) {
    return (
      <>
        <PageHeader title="Sesión" />
        <Card>No se encontró la sesión.</Card>
      </>
    );
  }

  const { slots, isDeload } = view;
  const session = sessionRow ?? view.session;
  const done = session.status === "completed";
  const workingLogs = logs.filter(isWorkingSet);
  const totalSets = slots.reduce((n, s) => n + s.sets, 0);
  const loggedSets = workingLogs.length;
  const ctxFor = (slot: SlotPrescription): RoundingContext => ({
    type: slot.planned.targetLoadKg === 0 ? "bodyweight" : slot.exercise.equipmentType,
    equipment: settings?.equipment ?? view.equipment,
  });

  // --- Descanso: objetivo del último ejercicio registrado; en superserie,
  // sin descanso hasta cerrar el último ejercicio del grupo.
  const lastLog = [...workingLogs].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1);
  const lastSlot = lastLog
    ? slots.find((s) => s.slotIndex === (lastLog.slotIndex ?? slots.find((x) => x.exercise.id === lastLog.exerciseId)?.slotIndex))
    : undefined;
  const group = lastSlot?.planned.supersetGroup;
  const groupSlots = group ? slots.filter((s) => s.planned.supersetGroup === group) : [];
  const supersetPending = !!group && groupSlots.at(-1)?.slotIndex !== lastSlot?.slotIndex;
  const restTarget = supersetPending ? 0 : (lastSlot?.restSec ?? rules.rest.defaultCompoundSec);

  const nextUp = slots
    .map((s) => ({ s, n: (logsBySlot.get(s.slotIndex) ?? []).filter(isWorkingSet).length }))
    .find(({ s, n }) => n < s.sets);
  const nextLabel = nextUp
    ? `${shortName(nextUp.s.exercise.name)} · ${nextUp.s.planned.targetLoadKg === 0 ? "corporal" : `${fmtLoad(nextUp.s.suggestedLoadKg)} ${unitLabel()}`} × ${nextUp.s.suggestedReps}`
    : undefined;

  const durationMin = session.startedAt ? Math.max(0, Math.round((now - Date.parse(session.startedAt)) / 60000)) : null;

  const logSet = async (a: LogArgs) => {
    const ts = new Date().toISOString();
    const log: SetLog = {
      id: a.existingId ?? uuid(),
      sessionId: id,
      exerciseId: a.exerciseId,
      slotIndex: a.slotIndex,
      setIndex: a.setIndex,
      targetLoadKg: a.targetLoadKg,
      targetReps: a.targetReps,
      targetRir: a.targetRir,
      actualLoadKg: a.loadKg,
      actualReps: a.reps,
      actualRir: a.rir,
      rirReported: a.rirReported,
      kind: a.kind === "working" ? undefined : a.kind,
      side: a.side,
      note: a.note?.trim() || undefined,
      timestamp: ts,
    };
    await setLogRepo.put(log);
    if (a.kind !== "warmup") await sessionRepo.touch(id, ts);
    clearDraft(id, a.slotIndex, a.setIndex);
    if (a.kind !== "warmup") {
      const prs = await prsForSet(id, log);
      if (prs.length > 0) setToast(prLabel(prs[0]));
    }
  };

  const completeSession = async () => {
    const remaining = totalSets - loggedSets;
    const msg =
      remaining > 0
        ? `Registraste ${loggedSets} de ${totalSets} series (faltan ${remaining}). ¿Finalizar la sesión igual?`
        : "¿Finalizar la sesión? El motor usará estos registros para calcular la próxima.";
    if (!(await askConfirm({ title: "Finalizar sesión", message: msg, confirmLabel: "Finalizar" }))) return;
    await sessionRepo.complete(id);
    clearAllDrafts(id);
    router.push(`/session/done?id=${encodeURIComponent(id)}`);
  };

  return (
    <>
      <PageHeader
        title={session.dayLabel}
        subtitle={`${loggedSets}/${totalSets} series${durationMin !== null ? ` · ${durationMin} min` : ""}`}
        action={
          <>
            {view.intensity === "heavy" && <Badge tone="danger">Fuerte</Badge>}
            {view.intensity === "light" && <Badge tone="primary">Liviano</Badge>}
            {isDeload && <Badge tone="warning">Deload</Badge>}
          </>
        }
      />

      {!done && <EquipmentProfilePicker compact onChanged={refresh} />}

      {!done && (
        // Pegado arriba (UX-03): tras registrar en el 5.º ejercicio el timer quedaba
        // 1800 px fuera de pantalla, y en iPhone no hay vibración.
        <div className="sticky top-2 z-30">
          <RestTimer lastSetAt={session.lastSetAt} targetSec={restTarget} minSec={rules.rest.minSec} nextLabel={nextLabel} />
        </div>
      )}

      {showCheckin && !done && (
        <div className="mt-4">
          <CheckinSheet sessionId={id} onDone={() => setShowCheckin(false)} />
        </div>
      )}

      {!done && view.rirCalibration.echoDetected && (
        <div className="mt-4">
          <HonestNote>
            En el {Math.round(view.rirCalibration.echoPct ?? 0)}% de tus series el RIR registrado es
            exactamente el objetivo precargado. Elegí el RIR que sentiste en la última serie de cada
            ejercicio: con eso el motor puede adaptar reps y cargas a vos.
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
        {groupSlotsInOrder(slots).map((grp) =>
          grp.length > 1 ? (
            <div key={`g${grp[0].slotIndex}`} className="space-y-2 rounded-[calc(var(--radius)+4px)] border border-dashed border-[var(--primary)]/40 p-1.5">
              <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--primary-ink)]">
                Superserie · sin descanso entre ejercicios
              </p>
              {grp.map((slot) => (
                <ExerciseBlock
                  key={slot.slotIndex}
                  sessionId={id}
                  slot={slot}
                  logs={logsBySlot.get(slot.slotIndex) ?? []}
                  disabled={done}
                  bodyweightKg={settings?.bodyweightKg ?? 0}
                  ctx={ctxFor(slot)}
                  onLog={logSet}
                  onSwap={() => setSwapFor(slot)}
                  onChangeSets={async (d) => {
                    await sessionRepo.changeSetsToday(id, slot.slotIndex, d);
                    refresh();
                  }}
                />
              ))}
            </div>
          ) : (
            <ExerciseBlock
              key={grp[0].slotIndex}
              sessionId={id}
              slot={grp[0]}
              logs={logsBySlot.get(grp[0].slotIndex) ?? []}
              disabled={done}
              bodyweightKg={settings?.bodyweightKg ?? 0}
              ctx={ctxFor(grp[0])}
              onLog={logSet}
              onSwap={() => setSwapFor(grp[0])}
              onChangeSets={async (d) => {
                await sessionRepo.changeSetsToday(id, grp[0].slotIndex, d);
                refresh();
              }}
            />
          ),
        )}
      </div>

      {!done && (
        <Button className="mt-6 w-full" size="lg" disabled={loggedSets === 0} onClick={completeSession}>
          Finalizar sesión
        </Button>
      )}
      {done && (
        <Card className="mt-6 space-y-3 text-center text-sm text-[var(--muted)]">
          <p>Sesión completada.</p>
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              if (!(await askConfirm({ message: "¿Reabrir la sesión? Tus series quedan; vas a poder editarlas y volver a finalizar.", confirmLabel: "Reabrir" }))) return;
              await sessionRepo.reopen(id);
              refresh();
            }}
          >
            Reabrir sesión
          </Button>
        </Card>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[65] flex justify-center px-6" role="status">
          <div className="pointer-events-auto rounded-full border border-[var(--success)]/40 bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--success)] shadow-[var(--pop-shadow)]">
            ★ {toast}
          </div>
        </div>
      )}

      {swapFor && allExercises && (
        <SwapSheet
          slot={swapFor}
          exercises={allExercises}
          onClose={() => setSwapFor(null)}
          onToday={async (exerciseId) => {
            await sessionRepo.swapExerciseToday(id, swapFor.slotIndex, exerciseId);
            setSwapFor(null);
            refresh();
          }}
          onPlan={async (exerciseId) => {
            await mesocycleRepo.swapExerciseInPlan(session.mesocycleId, session.dayIndex, swapFor.slotIndex, exerciseId, session.weekIndex);
            await sessionRepo.swapExerciseToday(id, swapFor.slotIndex, null);
            setSwapFor(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

/** Agrupa slots consecutivos con el mismo supersetGroup. */
function groupSlotsInOrder(slots: SlotPrescription[]): SlotPrescription[][] {
  const out: SlotPrescription[][] = [];
  for (const s of slots) {
    const last = out.at(-1);
    const g = s.planned.supersetGroup;
    if (last && g && last[0].planned.supersetGroup === g) last.push(s);
    else out.push([s]);
  }
  return out;
}

const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");

function prLabel(pr: PR): string {
  const u = unitLabel();
  if (pr.kind === "load") return `Récord de carga: ${fmtLoad(pr.value)} ${u} (antes ${fmtLoad(pr.previous ?? 0)})`;
  if (pr.kind === "repsAtLoad") return `Récord: ${pr.value} reps con ${fmtLoad(pr.atLoadKg ?? 0)} ${u} (antes ${pr.previous})`;
  return `Récord de 1RM estimado: ${fmtLoad(pr.value)} ${u} (antes ${fmtLoad(pr.previous ?? 0)})`;
}

// ---------------- borradores (A1.7): sobreviven recargas ----------------

interface Draft {
  load: number;
  reps: number;
  rir: number | null;
  rirTouched: boolean;
  kind: SetKind;
  side?: "L" | "R";
  note?: string;
}
const draftKey = (sid: string, slot: number, set: number) => `mn-draft:${sid}:${slot}:${set}`;
function readDraft(sid: string, slot: number, set: number): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(sid, slot, set));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(sid: string, slot: number, set: number, d: Draft) {
  try {
    sessionStorage.setItem(draftKey(sid, slot, set), JSON.stringify(d));
  } catch {
    /* almacenamiento no disponible */
  }
}
function clearDraft(sid: string, slot: number, set: number) {
  try {
    sessionStorage.removeItem(draftKey(sid, slot, set));
  } catch {
    /* noop */
  }
}
function clearAllDrafts(sid: string) {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(`mn-draft:${sid}:`)) sessionStorage.removeItem(k);
  } catch {
    /* noop */
  }
}

// ---------------- bloque de ejercicio ----------------

const RULE_INPUT_LABELS: Record<string, string> = {
  repsLogradas: "Reps logradas (mínimo entre series)",
  repsAjustadasPorRir: "Reps ajustadas por RIR",
  topeRango: "Tope del rango",
  pisoReps: "Piso del rango",
  cargaKg: "Carga (kg)",
  cargaInicialKg: "Carga inicial (kg)",
  cargaAnteriorKg: "Carga anterior (kg)",
  cargaNuevaKg: "Carga nueva (kg)",
  saltoMinimoPct: "Salto mínimo de tu equipamiento (%)",
  incrementoObjetivoPct: "Incremento objetivo del motor (%)",
  sesionesSinProgreso: "Sesiones sin progreso",
  umbral: "Umbral",
  colchonUsado: "Colchón usado (reps)",
  colchonMax: "Colchón máximo (reps)",
  cargaSemana1Kg: "Carga de la semana 1 (kg)",
  cargaHoyKg: "Carga de hoy (kg)",
  fraccion: "Fracción aplicada",
};

const PROFILE_LABEL: Record<string, string> = { stretch: "en estiramiento", mid: "medio", short: "acortado" };

function ExerciseBlock({
  sessionId,
  slot,
  logs,
  disabled,
  bodyweightKg,
  ctx,
  onLog,
  onSwap,
  onChangeSets,
}: {
  sessionId: string;
  slot: SlotPrescription;
  logs: SetLog[];
  disabled: boolean;
  bodyweightKg: number;
  ctx: RoundingContext;
  onLog: (a: LogArgs) => Promise<void>;
  onSwap: () => void;
  onChangeSets: (delta: number) => Promise<void>;
}) {
  const rules = getRules();
  const { exercise, planned, suggestedLoadKg, suggestedReps, targetRir, rationale, explain, previous } = slot;
  const [whyOpen, setWhyOpen] = useState(false);
  const [warmOpen, setWarmOpen] = useState(false);
  const [noteEdit, setNoteEdit] = useState(false);
  const [noteDraft, setNoteDraft] = useState(exercise.note ?? "");
  const [noteSaved, setNoteSaved] = useState(exercise.note);

  const working = logs.filter(isWorkingSet);
  const warmLogs = logs.filter((l) => !isWorkingSet(l));
  const byIndex = new Map(working.map((l) => [l.setIndex, l]));
  /** Carga de la última serie de trabajo registrada HOY antes de `i`, si difiere de la sugerida (UX-07). */
  const deviatedLoadBefore = (i: number): number | null => {
    for (let k = i - 1; k >= 0; k--) {
      const l = byIndex.get(k);
      if (!l || l.kind === "drop" || l.kind === "partial") continue;
      return l.actualLoadKg !== suggestedLoadKg ? l.actualLoadKg : null;
    }
    return null;
  };
  const isBodyweight = planned.targetLoadKg === 0;
  const plates = !isBodyweight ? plateBreakdown(suggestedLoadKg, ctx) : null;
  const warmups = !isBodyweight ? warmupSets(suggestedLoadKg, ctx, rules) : [];
  const lastIndexLogged = byIndex.has(slot.sets - 1);
  // RIR objetivo por serie (serie ancla / AMRAP de APRE) o el general.
  const setRir = (i: number) => planned.setTargets?.[i]?.targetRir ?? targetRir;
  const isAmrap = (i: number) => !!planned.setTargets?.[i]?.amrap;
  const isAnchor = (i: number) => i === 0 && !!planned.setTargets && planned.setTargets.length > 1 && !planned.setTargets[0].amrap && planned.setTargets[0].targetRir < targetRir;
  // Ajuste sugerido entre series (A2.6): sobre la siguiente sin registrar.
  const lastLogged = [...working].sort((a, b) => b.setIndex - a.setIndex)[0];
  const hintIndex = lastLogged && lastLogged.setIndex + 1 < slot.sets && !byIndex.has(lastLogged.setIndex + 1) ? lastLogged.setIndex + 1 : -1;
  const hint: IntraSessionHint | null =
    hintIndex >= 0 && !disabled
      ? intraSessionAdjust(lastLogged, { loadKg: isBodyweight ? 0 : suggestedLoadKg, reps: suggestedReps }, ctx, rules)
      : null;
  const daysAgo = previous?.completedAt ? Math.round((Date.now() - Date.parse(previous.completedAt)) / 86400000) : null;

  return (
    <Card>
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{exercise.name}</p>
          {slot.plannedExercise && (
            <p className="text-[11px] text-[var(--warning)]">Hoy en lugar de {shortName(slot.plannedExercise.name)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setWhyOpen((v) => !v)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3 text-[11px] font-semibold",
              whyOpen ? "border-[var(--primary)]/50 text-[var(--primary-ink)]" : "border-[var(--border)] text-[var(--muted)]",
            )}
            aria-expanded={whyOpen}
          >
            ¿por qué?
          </button>
          <Badge tone="primary">RIR {targetRir}</Badge>
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Objetivo: {isBodyweight ? "corporal" : `${fmtLoad(suggestedLoadKg)} ${unitLabel()}`} × {suggestedReps} reps ({planned.repRange.min}–
        {planned.repRange.max}
        {suggestedReps > planned.repRange.max ? ` +${suggestedReps - planned.repRange.max}` : ""}) · {slot.sets} series
      </p>
      {plates && plates.perSide.length > 0 && (
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Por lado: <span className="font-medium text-[var(--foreground)]">{plates.perSide.map((p) => fmtLoad(p)).join(" · ")}</span>
          {" "}({ctx.type === "barbell" ? "barra" : "mango"} {fmtLoad(plates.baseKg)})
        </p>
      )}
      {previous && previous.sets.length > 0 && (
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Última vez{daysAgo !== null ? ` (hace ${daysAgo === 0 ? "hoy" : `${daysAgo} d`})` : ""}:{" "}
          {previous.sets
            .map((s) => `${isBodyweight ? "BW" : fmtLoad(s.loadKg)}×${s.reps}${s.rirReported ? ` @${s.rir}` : ""}`)
            .join(", ")}
        </p>
      )}

      {whyOpen && (
        <div className="mt-2 rounded-xl bg-[var(--surface-2)] p-3 text-xs">
          <p className="mb-2 leading-relaxed">{rationale}</p>
          <table className="w-full">
            <tbody>
              {Object.entries(explain.inputs).map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 pr-2 text-[var(--muted)]">{(RULE_INPUT_LABELS[k] ?? k).replace("(kg)", `(${unitLabel()})`)}</td>
                  <td className="py-0.5 text-right tabular-nums">{typeof v === "number" ? (k.endsWith("Kg") ? fmtLoad(v) : fmtKg(v)) : v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-[var(--muted)]">Regla del motor: {explain.rule}</p>
        </div>
      )}

      {(noteSaved || noteEdit) && (
        <div className="mt-2">
          {noteEdit ? (
            <div className="flex gap-1">
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                maxLength={200}
                placeholder="Ej: asiento 4, agarre ancho"
                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs"
              />
              <Button
                size="sm"
                onClick={async () => {
                  await exerciseRepo.setNoteAndRest(exercise.id, { note: noteDraft });
                  setNoteSaved(noteDraft.trim() || undefined);
                  setNoteEdit(false);
                }}
              >
                OK
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setNoteEdit(true)} className="text-left text-[11px] text-[var(--foreground)]/80">
              📝 {noteSaved}
            </button>
          )}
        </div>
      )}

      {warmups.length > 0 && !disabled && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setWarmOpen((v) => !v)}
            className="-my-2 inline-flex min-h-11 items-center text-[11px] font-semibold text-[var(--muted)]"
            aria-expanded={warmOpen}
          >
            {warmOpen ? "▾" : "▸"} Calentamiento · {warmups.length} series{warmLogs.length > 0 ? ` (${warmLogs.length} hechas)` : ""}
          </button>
          {warmOpen && (
            <div className="mt-1 space-y-1">
              {warmups.map((w, k) => {
                const doneW = warmLogs.find((l) => l.setIndex === WARMUP_BASE_INDEX + k);
                return (
                  <div key={k} className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs">
                    <span className="text-[var(--muted)]">W{k + 1}</span>
                    <span className="tabular-nums">
                      {fmtLoad(w.loadKg)} {unitLabel()} × {w.reps}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        "rounded-full px-3 py-1 font-semibold",
                        doneW ? "text-[var(--success)]" : "bg-[var(--primary)]/15 text-[var(--primary-ink)]",
                      )}
                      onClick={() =>
                        doneW
                          ? setLogRepo.remove(doneW.id)
                          : onLog({
                              slotIndex: slot.slotIndex,
                              exerciseId: exercise.id,
                              setIndex: WARMUP_BASE_INDEX + k,
                              loadKg: w.loadKg,
                              reps: w.reps,
                              rir: targetRir,
                              targetLoadKg: w.loadKg,
                              targetReps: w.reps,
                              targetRir,
                              rirReported: false,
                              kind: "warmup",
                            })
                      }
                    >
                      {doneW ? "✓" : "Log"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {Array.from({ length: slot.sets }).map((_, i) => (
          <SetRow
            key={`${exercise.id}-${i}`}
            sessionId={sessionId}
            slotIndex={slot.slotIndex}
            index={i}
            existing={byIndex.get(i)}
            previous={previousForIndex(previous?.sets ?? null, i)}
            // UX-07: si la serie anterior de HOY se hizo con otra carga (no había
            // discos, pesaba de más), las siguientes la proponen; el objetivo sigue visible.
            defaultLoad={isBodyweight ? bodyweightKg : (deviatedLoadBefore(i) ?? suggestedLoadKg)}
            defaultReps={suggestedReps}
            defaultRir={setRir(i)}
            disabled={disabled}
            bodyweight={isBodyweight}
            ctx={ctx}
            // RIR explícito en la ÚLTIMA serie (A1.11), en la serie ancla y en
            // la AMRAP: son las más cercanas al fallo y las más informativas.
            requireRir={i === slot.sets - 1 || isAnchor(i) || isAmrap(i)}
            tag={isAmrap(i) ? "AMRAP al fallo" : isAnchor(i) ? "ancla" : undefined}
            hint={i === hintIndex ? hint : null}
            onLog={(v) =>
              onLog({
                slotIndex: slot.slotIndex,
                exerciseId: exercise.id,
                setIndex: i,
                loadKg: v.load,
                reps: v.reps,
                rir: v.rir,
                // Lo que pidió el motor, no lo que se levantó (A0.1).
                targetLoadKg: isBodyweight ? 0 : suggestedLoadKg,
                targetReps: suggestedReps,
                targetRir: setRir(i),
                rirReported: v.rirReported,
                kind: isAmrap(i) && v.kind === "working" ? "failure" : v.kind,
                side: v.side,
                note: v.note,
              })
            }
          />
        ))}
      </div>

      {rationale && !whyOpen && <p className="mt-2 text-[11px] text-[var(--muted)]">↳ {rationale}</p>}

      {!disabled && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={chipBtn} onClick={() => onChangeSets(1)}>
            + serie
          </button>
          <button
            type="button"
            className={chipBtn}
            disabled={slot.sets <= 1 || lastIndexLogged}
            onClick={() => onChangeSets(-1)}
            title={lastIndexLogged ? "La última serie ya está registrada" : undefined}
          >
            − serie
          </button>
          {exercise.isSwappable !== false && (
            <button type="button" className={chipBtn} onClick={onSwap}>
              Cambiar ejercicio
            </button>
          )}
          {!noteSaved && !noteEdit && (
            <button type="button" className={chipBtn} onClick={() => setNoteEdit(true)}>
              + nota
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

const chipBtn =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-3.5 text-[11px] font-semibold text-[var(--muted)] active:text-[var(--foreground)] disabled:opacity-40";

// ---------------- fila de serie ----------------

const KIND_LABEL: Record<SetKind, string> = {
  working: "Normal",
  warmup: "Calentamiento",
  drop: "Drop set",
  failure: "Al fallo",
  partial: "Parciales",
};

function SetRow({
  sessionId,
  slotIndex,
  index,
  existing,
  previous,
  defaultLoad,
  defaultReps,
  defaultRir,
  disabled,
  bodyweight,
  ctx,
  requireRir,
  tag,
  hint,
  onLog,
}: {
  sessionId: string;
  slotIndex: number;
  index: number;
  existing?: SetLog;
  previous: PreviousSet | null;
  defaultLoad: number;
  defaultReps: number;
  defaultRir: number;
  disabled: boolean;
  bodyweight: boolean;
  ctx: RoundingContext;
  requireRir: boolean;
  /** Etiqueta de la serie ("ancla", "AMRAP al fallo"). */
  tag?: string;
  /** Ajuste sugerido para esta serie (A2.6). */
  hint?: IntraSessionHint | null;
  onLog: (v: { load: number; reps: number; rir: number; rirReported: boolean; kind: SetKind; side?: "L" | "R"; note?: string }) => void | Promise<void>;
}) {
  const draft = !existing ? readDraft(sessionId, slotIndex, index) : null;
  const [load, setLoadS] = useState(existing?.actualLoadKg ?? draft?.load ?? defaultLoad);
  const [reps, setRepsS] = useState(existing?.actualReps ?? draft?.reps ?? defaultReps);
  // RIR: null = todavía sin elegir (solo en la serie que lo pide).
  const [rir, setRirS] = useState<number | null>(
    existing?.actualRir ?? (draft ? draft.rir : requireRir ? null : defaultRir),
  );
  const [rirTouched, setRirTouched] = useState(draft?.rirTouched ?? false);
  const [kind, setKind] = useState<SetKind>(existing?.kind ?? draft?.kind ?? "working");
  const [side, setSide] = useState<"L" | "R" | undefined>(existing?.side ?? draft?.side);
  const [note, setNote] = useState(existing?.note ?? draft?.note ?? "");
  const [menu, setMenu] = useState(false);
  const [rirOpen, setRirOpen] = useState(false);
  // UX-02: un rebote o doble toque no puede des-registrar la serie recién registrada.
  const loggedAt = useRef(0);
  const [busy, setBusy] = useState(false);
  // UX-07: mientras no se toque la carga, sigue a la propuesta (que puede cambiar
  // cuando la serie anterior se registra con otra carga).
  const loadTouched = useRef(!!existing || draft?.load !== undefined);
  useEffect(() => {
    if (!existing && !loadTouched.current) setLoadS(defaultLoad);
  }, [defaultLoad, existing]);

  const logged = !!existing;
  const locked = disabled || logged;
  const needsRir = requireRir && rir === null && !logged;

  const persist = (patch: Partial<Draft>) => {
    if (logged) return;
    writeDraft(sessionId, slotIndex, index, {
      load, reps, rir, rirTouched, kind, side, note, ...patch,
    });
  };
  const setLoad = (v: number) => ((loadTouched.current = true), setLoadS(v), persist({ load: v }));
  const setReps = (v: number) => (setRepsS(v), persist({ reps: v }));
  const setRir = (v: number) => (setRirS(v), setRirTouched(true), persist({ rir: v, rirTouched: true }));

  const copyPrevious = () => {
    if (!previous) return;
    if (!bodyweight) {
      loadTouched.current = true;
      setLoadS(previous.loadKg);
    }
    setRepsS(previous.reps);
    persist({ load: bodyweight ? load : previous.loadKg, reps: previous.reps });
  };

  // Steppers de carga que siguen el inventario (A1.2): + = siguiente alcanzable,
  // − = mayor alcanzable por debajo.
  const loadUp = (v: number) => nextAchievableLoad(v, ctx);
  const loadDown = (v: number) => Math.max(0, roundToAvailable(Math.max(0, v - 0.001), ctx));
  const breakdown = !bodyweight && !logged ? plateBreakdown(load, ctx) : null;
  const cmp = logged ? compareToPrevious({ loadKg: existing.actualLoadKg, reps: existing.actualReps }, previous) : null;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-xl border p-1.5",
          logged ? "border-[var(--success)]/40 bg-[var(--success)]/5" : "border-[var(--border)] bg-[var(--surface-2)]",
        )}
      >
        <button
          type="button"
          onClick={() => !disabled && setMenu((v) => !v)}
          className="flex h-11 w-6 shrink-0 flex-col items-center justify-center text-center text-xs text-[var(--muted)]"
          aria-label={`Opciones de la serie ${index + 1}`}
          title="Tipo, lado y nota"
        >
          {index + 1}
          {kind !== "working" && <span className="block text-[8px] text-[var(--primary-ink)]">{kind[0].toUpperCase()}</span>}
        </button>
        {bodyweight ? (
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-center text-[10px] uppercase text-[var(--muted)]">{unitLabel()}</p>
            <p className={cn("text-center text-sm font-medium", locked && "opacity-50")}>BW</p>
          </div>
        ) : (
          <Field label={unitLabel()} value={load} min={0} onChange={setLoad} down={loadDown} up={loadUp} disabled={locked} wide isLoad />
        )}
        <Field
          label="reps"
          value={reps}
          min={0}
          onChange={setReps}
          down={(v) => Math.max(0, v - 1)}
          up={(v) => v + 1}
          disabled={locked}
          tone={cmp === "up" ? "up" : cmp === "down" ? "down" : undefined}
        />
        {/* RIR: celda compacta que abre el selector 0·1·2·3·4+ (la fila no
            entra con tres pares de −/+ en 360–390 px y los botones se pisaban). */}
        <div className="w-11 shrink-0">
          <p className={cn("mb-0.5 text-center text-[10px] uppercase", needsRir ? "text-[var(--primary-ink)]" : "text-[var(--muted)]")}>
            RIR{needsRir ? " ↓" : ""}
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => setRirOpen((v) => !v)}
            className={cn(
              "h-11 w-full rounded-lg text-sm font-semibold tabular-nums disabled:opacity-40",
              needsRir ? "text-[var(--primary-ink)]" : "bg-[var(--surface)]",
              rirOpen && "ring-2 ring-[var(--primary)]/30",
            )}
            aria-label="Elegir RIR"
          >
            {rir === null ? "?" : rir >= 4 ? "4+" : rir}
          </button>
        </div>
        <Button
          size="sm"
          variant={logged ? "secondary" : "primary"}
          disabled={disabled || needsRir || busy}
          className="h-11 w-12 shrink-0 px-0"
          aria-label={logged ? `Serie ${index + 1} registrada: editar` : `Registrar serie ${index + 1}`}
          title={logged ? "Editar esta serie" : needsRir ? "Elegí el RIR de esta serie" : "Registrar serie"}
          onClick={async () => {
            if (logged) {
              // Toques dentro del segundo siguiente al registro son rebote: se ignoran.
              if (Date.now() - loggedAt.current < 1200) return;
              const ok = await askConfirm({
                title: `Editar serie ${index + 1}`,
                message: "La serie deja de estar registrada hasta que vuelvas a tocar Log. Los valores quedan cargados.",
                confirmLabel: "Editar",
              });
              if (!ok) return;
              // Al volver a registrar se conserva si el RIR ya estaba reportado.
              if (existing.rirReported !== false) setRirTouched(true);
              loadTouched.current = true;
              await setLogRepo.remove(existing.id);
              return;
            }
            setBusy(true);
            loggedAt.current = Date.now();
            try {
              await onLog({
                load: bodyweight ? defaultLoad : load,
                reps,
                rir: rir ?? defaultRir,
                rirReported: requireRir || rirTouched,
                kind,
                side,
                note,
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {logged ? "✓" : "Log"}
        </Button>
      </div>

      {tag && !logged && (
        <p className="mt-0.5 pl-6 text-[10px] font-semibold uppercase tracking-wide text-[var(--primary-ink)]">
          {tag} · RIR objetivo {defaultRir}
        </p>
      )}

      {hint && !logged && (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-[var(--warning)]/10 px-2 py-1.5 pl-6 text-[11px] text-[var(--warning)]">
          <span>{hint.text}</span>
          <button
            type="button"
            className="shrink-0 font-semibold underline"
            onClick={() => {
              if (!bodyweight) setLoad(hint.loadKg);
              setReps(hint.reps);
            }}
          >
            usar
          </button>
        </div>
      )}

      {!logged && !disabled && (previous || breakdown?.unreachable) && (
        <div className="mt-0.5 flex items-center justify-between gap-2 pl-6 text-[10px] text-[var(--muted)]">
          {previous ? (
            <span>
              ant. {bodyweight ? "BW" : fmtLoad(previous.loadKg)}×{previous.reps}
              {previous.rirReported ? ` @${previous.rir}` : ""}
            </span>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-2">
            {breakdown?.unreachable && (
              <button type="button" className="-my-3 py-3 text-[var(--warning)]" onClick={() => setLoad(breakdown.nearestBelow)}>
                no se arma → usar {fmtLoad(breakdown.nearestBelow)}
              </button>
            )}
            {previous && (
              <button type="button" className="-my-3 py-3 pl-3 font-semibold text-[var(--primary-ink)]" onClick={copyPrevious}>
                copiar anterior
              </button>
            )}
          </span>
        </div>
      )}

      {logged && existing.note && <p className="mt-0.5 pl-6 text-[10px] text-[var(--muted)]">📝 {existing.note}</p>}

      {menu && !disabled && (
        <div className="mt-1 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
          <div className="flex flex-wrap gap-1">
            {(["working", "drop", "failure", "partial"] as SetKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={async () => {
                  setKind(k);
                  persist({ kind: k });
                  if (logged) await setLogRepo.patch(existing.id, { kind: k === "working" ? undefined : k });
                }}
                className={cn(chipBtn, kind === k && "border-[var(--primary)]/50 text-[var(--primary-ink)]")}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[var(--muted)]">Lado:</span>
            {([undefined, "L", "R"] as const).map((sd) => (
              <button
                key={sd ?? "-"}
                type="button"
                onClick={async () => {
                  setSide(sd);
                  persist({ side: sd });
                  if (logged) await setLogRepo.patch(existing.id, { side: sd });
                }}
                className={cn(chipBtn, side === sd && "border-[var(--primary)]/50 text-[var(--primary-ink)]")}
              >
                {sd === undefined ? "ambos" : sd === "L" ? "izq." : "der."}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              persist({ note: e.target.value });
            }}
            onBlur={async () => {
              if (logged) await setLogRepo.patch(existing.id, { note: note.trim() || undefined });
            }}
            maxLength={200}
            placeholder="Nota de la serie (molestia, técnica…)"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2"
          />
        </div>
      )}

      {(needsRir || rirOpen) && !locked && (
        <RirPicker
          onPick={(v) => {
            setRir(v);
            setRirOpen(false);
          }}
        />
      )}
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
            className="h-11 min-w-9 flex-1 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/10 text-sm font-semibold text-[var(--primary-ink)] active:scale-95"
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
  down,
  up,
  min,
  format,
  disabled,
  tone,
  wide,
  isLoad = false,
}: {
  isLoad?: boolean;
  label: string;
  value: number;
  onChange: (v: number) => void;
  down: (v: number) => number;
  up: (v: number) => number;
  min: number;
  format?: (v: number) => string;
  disabled: boolean;
  tone?: "up" | "down";
  /** Más ancho (carga: "107.5" necesita 5 caracteres). */
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide ? "flex-[1.35]" : "flex-1")}>
      <p className="mb-0.5 text-center text-[10px] uppercase text-[var(--muted)]">{label}</p>
      <div className="flex items-center justify-center gap-0.5">
        <button
          type="button"
          disabled={disabled}
          className="h-11 w-7 shrink-0 rounded bg-[var(--surface)] text-base disabled:opacity-40"
          onClick={() => onChange(+down(value).toFixed(3))}
          aria-label={`Bajar ${label}`}
        >
          −
        </button>
        <EditableNumber
          value={value}
          onChange={(v) => onChange(+v.toFixed(isLoad ? 4 : 2))}
          min={min}
          format={format}
          load={isLoad}
          ariaLabel={isLoad ? "Carga" : label}
          disabled={disabled}
          className={cn(
            "h-11 w-full min-w-[34px] text-sm",
            tone === "up" && "text-[var(--success)]",
            tone === "down" && "text-[var(--warning)]",
          )}
        />
        <button
          type="button"
          disabled={disabled}
          className="h-11 w-7 shrink-0 rounded bg-[var(--surface)] text-base disabled:opacity-40"
          onClick={() => onChange(+up(value).toFixed(3))}
          aria-label={`Subir ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ---------------- cambio de ejercicio (A1.9) ----------------

function SwapSheet({
  slot,
  exercises,
  onClose,
  onToday,
  onPlan,
}: {
  slot: SlotPrescription;
  exercises: Exercise[];
  onClose: () => void;
  onToday: (exerciseId: string | null) => void;
  onPlan: (exerciseId: string) => void;
}) {
  const current = slot.exercise;
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const fromCandidates = current.swapCandidates.map((id) => byId.get(id)).filter((e): e is Exercise => !!e);
  const sameMuscle = exercises.filter(
    (e) => e.primaryMuscle === current.primaryMuscle && e.id !== current.id && !current.swapCandidates.includes(e.id),
  );
  const list = [...fromCandidates, ...sameMuscle].slice(0, 14);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <Sheet title={`Cambiar ${shortName(current.name)}`} onClose={onClose}>
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--muted)]">
          Mismo músculo principal. Se conservan series, rango y RIR. Preferí perfiles en estiramiento o
          medio: el trabajo en posición acortada es el menos respaldado (SCIENCE §8). No rotes por rotar.
        </p>
        {slot.plannedExercise && (
          <Button variant="secondary" size="sm" className="mb-2 w-full" onClick={() => onToday(null)}>
            Volver a {shortName(slot.plannedExercise.name)}
          </Button>
        )}
        <div className="space-y-1">
          {list.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setPicked(e.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm",
                picked === e.id ? "border-[var(--primary)]/50 bg-[var(--primary)]/10" : "border-[var(--border)]",
              )}
            >
              <span className="min-w-0 truncate">{e.name}</span>
              <span className="ml-2 shrink-0 text-[10px] text-[var(--muted)]">
                {PROFILE_LABEL[e.resistanceProfile]}
                {current.swapCandidates.includes(e.id) ? " · sugerido" : ""}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={!picked} onClick={() => picked && onToday(picked)}>
            Solo hoy
          </Button>
          <Button
            className="flex-1"
            disabled={!picked}
            onClick={async () => {
              if (!picked) return;
              if (await askConfirm({ title: "Cambiar en el plan", message: "¿Cambiarlo en el plan desde esta semana? Las semanas ya entrenadas no cambian.", confirmLabel: "Cambiar" })) onPlan(picked);
            }}
          >
            En el plan
          </Button>
        </div>
    </Sheet>
  );
}

