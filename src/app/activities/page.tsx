"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { activityRepo } from "@/db/repositories";
import { ACTIVITY_LABELS } from "@/lib/format";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select } from "@/components/ui";
import type { ActivityRow } from "@/db/schema";

const INTENSITY_LABELS: Record<number, string> = { 1: "suave", 2: "moderada", 3: "intensa" };

export default function ActivitiesPage() {
  const history = useLiveQuery(() => activityRepo.all(), []);
  const [adding, setAdding] = useState(false);

  if (!history) return null;

  if (adding) {
    return (
      <>
        <PageHeader title="Actividad extra" subtitle="Registrar" />
        <ActivityForm onDone={() => setAdding(false)} />
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
        mesociclo: se registra para correlacionarlo con tus resultados en Stats.
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
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {ACTIVITY_LABELS[a.type]}
                  {a.note ? <span className="font-normal text-[var(--muted)]"> · {a.note}</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {a.date.slice(0, 10)}
                  {a.durationMin ? ` · ${a.durationMin} min` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {a.intensity && <Badge tone={a.intensity === 3 ? "warning" : "neutral"}>{INTENSITY_LABELS[a.intensity]}</Badge>}
                <button
                  className="px-1 text-sm text-[var(--danger)]"
                  onClick={() => { if (confirm("¿Eliminar esta actividad?")) activityRepo.remove(a.id); }}
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

function ActivityForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<ActivityRow["type"]>("running");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState<1 | 2 | 3>(2);
  const [note, setNote] = useState("");

  const save = async () => {
    const dur = parseFloat(duration.replace(",", "."));
    await activityRepo.add({
      date: `${date}T12:00:00.000Z`,
      type,
      durationMin: Number.isFinite(dur) && dur > 0 ? dur : undefined,
      intensity,
      note: note.trim() || undefined,
    });
    onDone();
  };

  return (
    <Card className="space-y-3.5">
      <div>
        <Label>Actividad</Label>
        <Select value={type} onChange={(e) => setType(e.target.value as ActivityRow["type"])}>
          {Object.entries(ACTIVITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
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
        </div>
      </div>
      <div>
        <Label>Intensidad</Label>
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as const).map((i) => (
            <button
              key={i}
              onClick={() => setIntensity(i)}
              className={
                "rounded-2xl border py-2 text-sm font-medium transition " +
                (intensity === i
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
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
        <Input placeholder="ej: 5 km por el parque" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={save}>
          Guardar
        </Button>
      </div>
    </Card>
  );
}
