"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { activityRepo } from "@/db/repositories";
import { ACTIVITY_ICONS, ACTIVITY_LABELS, ACTIVITY_SOURCE_LABELS } from "@/lib/format";
import { todayIso } from "@/lib/agenda";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select } from "@/components/ui";
import { DATA_LIMITS } from "@/db/backupSchema";
import { showAlert } from "@/store/dialogs";
import type { ActivityRow } from "@/db/schema";
import { askConfirm } from "@/store/dialogs";

const INTENSITY_LABELS: Record<number, string> = { 1: "suave", 2: "moderada", 3: "intensa" };

/** Tipos que el usuario registra a mano; `strength_external` solo llega por importadores. */
const MANUAL_TYPES = Object.keys(ACTIVITY_LABELS).filter((t) => t !== "strength_external");

export default function ActivitiesPage() {
  return (
    <Suspense fallback={null}>
      <ActivitiesInner />
    </Suspense>
  );
}

function ActivitiesInner() {
  const router = useRouter();
  // A5.6: `/activities?date=YYYY-MM-DD` abre el alta con esa fecha (desde la Agenda).
  // A5S-04: solo una fecha real YYYY-MM-DD; cualquier otra cosa se ignora.
  const rawDate = useSearchParams().get("date");
  const dateParam = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(`${rawDate}T00:00:00Z`)) ? rawDate : null;
  const history = useLiveQuery(() => activityRepo.all(), []);
  const [adding, setAdding] = useState(!!dateParam);
  const [editing, setEditing] = useState<ActivityRow | null>(null);

  if (!history) return null;

  const closeForm = () => {
    setAdding(false);
    setEditing(null);
    if (dateParam) router.replace("/activities");
  };

  if (adding || editing) {
    return (
      <>
        <PageHeader title="Actividad extra" subtitle={editing ? "Editar" : "Registrar"} />
        <ActivityForm initial={editing ?? undefined} initialDate={dateParam ?? undefined} onDone={closeForm} />
      </>
    );
  }

  const sorted = [...history].reverse();

  return (
    <>
      <PageHeader
        title="Actividades"
        subtitle="Extra al plan"
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            + Registrar
          </Button>
        }
      />

      <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
        Cardio o deporte fuera del plan (correr, nadar, bici…). Es opcional y no modifica tu
        mesociclo: se registra para correlacionarlo con tus resultados en Stats y se ve en la Agenda.
      </p>

      {sorted.length === 0 ? (
        <EmptyState
          title="Sin actividades todavía"
          hint="Registrá cada salida a correr, nadar o lo que hagas fuera del gym."
        />
      ) : (
        <div className="space-y-2.5">
          {sorted.map((a) => (
            <Card key={a.id} className="flex items-center justify-between gap-2 py-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(a)} aria-label={`Editar ${ACTIVITY_LABELS[a.type]} del ${a.date.slice(0, 10)}`}>
                <p className="text-sm font-semibold">
                  <span aria-hidden="true">{ACTIVITY_ICONS[a.type]} </span>
                  {ACTIVITY_LABELS[a.type]}
                  {a.note ? <span className="font-normal text-[var(--muted)]"> · {a.note}</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {a.date.slice(0, 10)}
                  {a.durationMin ? ` · ${a.durationMin} min` : ""}
                  {a.distanceKm ? ` · ${a.distanceKm} km` : ""}
                  {a.avgHr ? ` · ${a.avgHr} ppm` : ""}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {a.source && a.source !== "manual" && <Badge tone="neutral">{ACTIVITY_SOURCE_LABELS[a.source] ?? a.source}</Badge>}
                {a.intensity && <Badge tone={a.intensity === 3 ? "warning" : "neutral"}>{INTENSITY_LABELS[a.intensity]}</Badge>}
                <button
                  className="min-h-11 px-2 text-sm text-[var(--danger-ink)]"
                  aria-label="Eliminar actividad"
                  onClick={async () => { if (await askConfirm({ message: "¿Eliminar esta actividad?", confirmLabel: "Eliminar", danger: true })) await activityRepo.remove(a.id); }}
                >
                  ✕
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ActivityForm({ initial, initialDate, onDone }: { initial?: ActivityRow; initialDate?: string; onDone: () => void }) {
  const [type, setType] = useState<ActivityRow["type"]>(initial?.type ?? "running");
  const [date, setDate] = useState(initial?.date.slice(0, 10) ?? initialDate ?? todayIso());
  const [duration, setDuration] = useState(initial?.durationMin ? String(initial.durationMin) : "");
  const [intensity, setIntensity] = useState<1 | 2 | 3>(initial?.intensity ?? 2);
  const [note, setNote] = useState(initial?.note ?? "");

  const dur = parseFloat(duration.replace(",", "."));
  const durTooLong = Number.isFinite(dur) && dur > DATA_LIMITS.maxActivityMin;
  const save = async () => {
    const patch = {
      date: `${date}T12:00:00.000Z`,
      type,
      durationMin: Number.isFinite(dur) && dur > 0 ? dur : undefined,
      intensity,
      note: note.trim() || undefined,
    };
    try {
      if (initial) await activityRepo.update(initial.id, patch);
      else await activityRepo.add(patch);
      onDone();
    } catch (e) {
      await showAlert({ title: "No se pudo guardar", message: `Revisá los datos (${e instanceof Error ? e.message : String(e)}).` });
    }
  };

  return (
    <Card className="space-y-3.5">
      <div>
        <Label>Actividad</Label>
        <Select value={type} onChange={(e) => setType(e.target.value as ActivityRow["type"])}>
          {(initial?.type === "strength_external" ? [...MANUAL_TYPES, "strength_external"] : MANUAL_TYPES).map((k) => (
            <option key={k} value={k}>{ACTIVITY_LABELS[k]}</option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Fecha</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label>Duración (min)</Label>
          <Input inputMode="decimal" placeholder="ej: 30" value={duration} onChange={(e) => setDuration(e.target.value)} />
          {durTooLong && <p className="mt-1 text-[11px] text-[var(--danger-ink)]">Máximo {DATA_LIMITS.maxActivityMin} min.</p>}
        </div>
      </div>
      <div>
        <Label>Intensidad</Label>
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={intensity === i}
              onClick={() => setIntensity(i)}
              className={
                "rounded-2xl border py-2 text-sm font-medium transition " +
                (intensity === i
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-ink)]"
                  : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]")
              }
            >
              {INTENSITY_LABELS[i]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Nota (opcional)</Label>
        <Input placeholder="ej: 5 km por el parque" maxLength={DATA_LIMITS.maxTextChars} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {initial?.source && initial.source !== "manual" && (
        <p className="text-[11px] text-[var(--muted)]">
          Importada de {ACTIVITY_SOURCE_LABELS[initial.source] ?? initial.source}
          {initial.distanceKm ? ` · ${initial.distanceKm} km` : ""}
          {initial.avgHr ? ` · FC media ${initial.avgHr}` : ""}
          {initial.maxHr ? ` · máx ${initial.maxHr}` : ""}. Distancia y FC no se editan acá.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={save} disabled={!date || durTooLong}>
          Guardar
        </Button>
      </div>
    </Card>
  );
}
