"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { baseWeekRepo, exerciseRepo, mesocycleRepo, settingsRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";
import { effectiveLandmarks } from "@/domain/rules";
import { weeklyVolumeByMuscle } from "@/domain/volume";
import type { BaseWeek, Exercise, ProgressionModel } from "@/domain/types";
import { Badge, Button, Card, EditableNumber, EmptyState, HonestNote, Input, Label, PageHeader, Select, Stepper } from "@/components/ui";
import { VolumeBar } from "@/components/VolumeBar";
import { PROGRESSION_LABELS, fmtKg, muscleLabel } from "@/lib/format";
import { ROUTINE_TEMPLATES } from "@/lib/templates";

export default function PlanPage() {
  const router = useRouter();
  const rules = getRules();

  const data = useLiveQuery(async () => {
    const [baseWeek, exercises, settings] = await Promise.all([
      baseWeekRepo.get(),
      exerciseRepo.all(),
      settingsRepo.get(),
    ]);
    return { baseWeek, exercises, settings };
  }, []);

  const [showGen, setShowGen] = useState(false);

  if (!data) return null;
  const { baseWeek, exercises, settings } = data;
  const exById = new Map(exercises.map((e) => [e.id, e]));

  const save = (bw: BaseWeek) => baseWeekRepo.set(bw);

  const addDay = () =>
    save({ days: [...baseWeek.days, { label: `Día ${String.fromCharCode(65 + baseWeek.days.length)}`, slots: [] }] });

  const removeDay = (i: number) =>
    save({ days: baseWeek.days.filter((_, idx) => idx !== i) });

  const moveDay = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= baseWeek.days.length) return;
    const days = [...baseWeek.days];
    [days[i], days[j]] = [days[j], days[i]];
    save({ days });
  };

  const moveSlot = (dayIdx: number, slotIdx: number, dir: -1 | 1) => {
    const slots = [...baseWeek.days[dayIdx].slots];
    const j = slotIdx + dir;
    if (j < 0 || j >= slots.length) return;
    [slots[slotIdx], slots[j]] = [slots[j], slots[slotIdx]];
    save({ days: baseWeek.days.map((d, i) => (i === dayIdx ? { ...d, slots } : d)) });
  };

  const addSlot = (dayIdx: number, exercise: Exercise) => {
    const range = exercise.defaultRepRange ?? defaultRange(exercise, rules);
    const days = baseWeek.days.map((d, i) =>
      i === dayIdx
        ? {
            ...d,
            slots: [
              ...d.slots,
              { exerciseId: exercise.id, targetSets: 3, repRange: range, startingLoadKg: 20 },
            ],
          }
        : d,
    );
    save({ days });
  };

  const updateSlot = (dayIdx: number, slotIdx: number, patch: Partial<BaseWeek["days"][0]["slots"][0]>) => {
    const days = baseWeek.days.map((d, i) =>
      i === dayIdx
        ? { ...d, slots: d.slots.map((s, j) => (j === slotIdx ? { ...s, ...patch } : s)) }
        : d,
    );
    save({ days });
  };

  const removeSlot = (dayIdx: number, slotIdx: number) => {
    const days = baseWeek.days.map((d, i) =>
      i === dayIdx ? { ...d, slots: d.slots.filter((_, j) => j !== slotIdx) } : d,
    );
    save({ days });
  };

  const volume = weeklyVolumeByMuscle(baseWeek, exById, rules);
  const trainedMuscles = Object.keys(volume).filter((m) => volume[m] > 0);
  const hasSlots = baseWeek.days.some((d) => d.slots.length > 0);

  return (
    <>
      <PageHeader title="Plan" subtitle="Semana base y mesociclo" />

      {trainedMuscles.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Volumen semanal por músculo</h2>
          <Card className="mb-2">
            {trainedMuscles
              .sort((a, b) => volume[b] - volume[a])
              .map((m) => (
                <VolumeBar
                  key={m}
                  muscle={m}
                  sets={volume[m]}
                  lm={safeLandmarks(rules, settings.experienceProfile, m)}
                />
              ))}
          </Card>
          <HonestNote>
            Series fraccionadas (directa 1·0, sinergista 0·5). Las marcas MEV/MAV/MRV son
            heurísticas de RP, no umbrales medidos.
          </HonestNote>
        </>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Días de entrenamiento</h2>

      {baseWeek.days.length === 0 && (
        <>
          <EmptyState
            title="Sin días todavía"
            hint="Agregá tu primer día de entrenamiento, o arrancá desde una rutina precargada y editala a gusto."
          />
          <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Rutinas precargadas</h2>
          {ROUTINE_TEMPLATES.map((t) => (
            <Card key={t.id} className="mb-3">
              <p className="font-semibold">{t.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{t.description}</p>
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                {t.days.length} días ·{" "}
                {t.days.reduce((a, d) => a + d.slots.length, 0)} ejercicios
              </p>
              <Button
                size="sm"
                className="mt-3 w-full"
                onClick={() =>
                  save({ days: t.days.map((d) => ({ ...d, slots: d.slots.map((s) => ({ ...s })) })) })
                }
              >
                Usar como base (editable)
              </Button>
            </Card>
          ))}
        </>
      )}

      <div className="space-y-3">
        {baseWeek.days.map((day, dayIdx) => (
          <Card key={dayIdx}>
            <div className="mb-3 flex items-center gap-2">
              <Input
                defaultValue={day.label}
                onBlur={(e) => {
                  const days = baseWeek.days.map((d, i) => (i === dayIdx ? { ...d, label: e.target.value } : d));
                  save({ days });
                }}
                className="h-9 flex-1 font-medium"
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <ReorderBtn disabled={dayIdx === 0} onClick={() => moveDay(dayIdx, -1)}>↑</ReorderBtn>
                <ReorderBtn disabled={dayIdx === baseWeek.days.length - 1} onClick={() => moveDay(dayIdx, 1)}>↓</ReorderBtn>
              </div>
              <button className="shrink-0 px-1 text-sm text-[var(--danger)]" onClick={() => removeDay(dayIdx)}>
                ✕
              </button>
            </div>

            <div className="space-y-2">
              {day.slots.map((slot, slotIdx) => {
                const ex = exById.get(slot.exerciseId);
                if (!ex) return null;
                return (
                  <div key={slotIdx} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{ex.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {muscleLabel(ex.primaryMuscle)}
                          {ex.resistanceProfile === "stretch" && " · estiramiento"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <ReorderBtn disabled={slotIdx === 0} onClick={() => moveSlot(dayIdx, slotIdx, -1)}>↑</ReorderBtn>
                        <ReorderBtn disabled={slotIdx === day.slots.length - 1} onClick={() => moveSlot(dayIdx, slotIdx, 1)}>↓</ReorderBtn>
                        <button className="px-1 text-sm text-[var(--danger)]" onClick={() => removeSlot(dayIdx, slotIdx)}>
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs text-[var(--muted)]">
                      <MiniStepper
                        label="Series"
                        value={slot.targetSets}
                        min={1}
                        step={1}
                        onChange={(v) => updateSlot(dayIdx, slotIdx, { targetSets: v })}
                      />
                      <div>
                        <p className="mb-1">Reps</p>
                        <div className="flex items-center justify-center gap-1 text-[var(--foreground)]">
                          <RangeBox
                            v={slot.repRange.min}
                            onChange={(v) => updateSlot(dayIdx, slotIdx, { repRange: { ...slot.repRange, min: v } })}
                          />
                          <span>–</span>
                          <RangeBox
                            v={slot.repRange.max}
                            onChange={(v) => updateSlot(dayIdx, slotIdx, { repRange: { ...slot.repRange, max: v } })}
                          />
                        </div>
                      </div>
                      <MiniStepper
                        label="Carga"
                        value={slot.startingLoadKg}
                        min={0}
                        step={2.5}
                        format={fmtKg}
                        onChange={(v) => updateSlot(dayIdx, slotIdx, { startingLoadKg: v })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <AddExercise exercises={exercises} onAdd={(ex) => addSlot(dayIdx, ex)} />
          </Card>
        ))}
      </div>

      <Button variant="secondary" className="mt-3 w-full" onClick={addDay}>
        + Agregar día
      </Button>

      {hasSlots && (
        <div className="mt-6">
          {!showGen ? (
            <Button className="w-full" size="lg" onClick={() => setShowGen(true)}>
              Generar mesociclo
            </Button>
          ) : (
            <GenerateForm
              defaultModel={rules.experienceProfiles[settings.experienceProfile].defaultProgressionModel as ProgressionModel}
              defaultWeeks={rules.experienceProfiles[settings.experienceProfile].defaultAccumulationWeeks}
              maxWeeks={rules.experienceProfiles[settings.experienceProfile].maxAccumulationWeeks}
              onCancel={() => setShowGen(false)}
              onGenerate={async (name, model, weeks) => {
                await mesocycleRepo.createFromBaseWeek({ name, progressionModel: model, numAccumulationWeeks: weeks });
                router.push("/");
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

function GenerateForm({
  defaultModel,
  defaultWeeks,
  maxWeeks,
  onGenerate,
  onCancel,
}: {
  defaultModel: ProgressionModel;
  defaultWeeks: number;
  maxWeeks: number;
  onGenerate: (name: string, model: ProgressionModel, weeks: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("Mesociclo 1");
  const [model, setModel] = useState<ProgressionModel>(defaultModel);
  const [weeks, setWeeks] = useState(defaultWeeks);

  return (
    <Card className="space-y-4">
      <div>
        <Label>Nombre</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label>Modelo de progresión</Label>
        <Select value={model} onChange={(e) => setModel(e.target.value as ProgressionModel)}>
          {(["linear", "double", "dup", "block"] as const).map((m) => (
            <option key={m} value={m}>
              {PROGRESSION_LABELS[m]}
            </option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          Los modelos igualan volumen y esfuerzo; la evidencia no muestra uno superior a otro para
          hipertrofia. Elegí por preferencia.
        </p>
      </div>
      <div>
        <Label>Semanas de acumulación (+ 1 deload)</Label>
        <Stepper value={weeks} min={2} step={1} onChange={(v) => setWeeks(Math.min(v, maxWeeks))} suffix="sem" />
        <p className="mt-1.5 text-xs text-[var(--muted)]">Máximo para tu perfil: {maxWeeks} semanas.</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={() => onGenerate(name.trim() || "Mesociclo", model, weeks)}>
          Generar
        </Button>
      </div>
    </Card>
  );
}

function AddExercise({ exercises, onAdd }: { exercises: Exercise[]; onAdd: (ex: Exercise) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () =>
      exercises
        .filter((e) => e.name.toLowerCase().includes(q.toLowerCase()) || muscleLabel(e.primaryMuscle).toLowerCase().includes(q.toLowerCase()))
        .slice(0, 30),
    [exercises, q],
  );

  if (!open) {
    return (
      <button
        className="mt-2 w-full rounded-xl border border-dashed border-[var(--border)] py-2.5 text-sm text-[var(--muted)]"
        onClick={() => setOpen(true)}
      >
        + Agregar ejercicio
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2">
      <Input autoFocus placeholder="Buscar ejercicio…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {filtered.map((ex) => (
          <button
            key={ex.id}
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm active:bg-[var(--surface)]"
            onClick={() => {
              onAdd(ex);
              setOpen(false);
              setQ("");
            }}
          >
            <span>{ex.name}</span>
            <span className="flex items-center gap-1">
              {ex.resistanceProfile === "stretch" && <Badge tone="success">stretch</Badge>}
              <span className="text-xs text-[var(--muted)]">{muscleLabel(ex.primaryMuscle)}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setOpen(false)}>
        Cerrar
      </Button>
    </div>
  );
}

function MiniStepper({
  label,
  value,
  onChange,
  step,
  min,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  format?: (v: number) => string;
}) {
  return (
    <div>
      <p className="mb-1">{label}</p>
      <div className="flex items-center justify-center gap-1.5 text-[var(--foreground)]">
        <button className="h-6 w-6 rounded bg-[var(--surface)] text-sm" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>
          −
        </button>
        <EditableNumber
          value={value}
          onChange={(v) => onChange(+v.toFixed(2))}
          min={min}
          format={format}
          className="h-6 w-full min-w-[36px] text-sm text-[var(--foreground)]"
        />
        <button className="h-6 w-6 rounded bg-[var(--surface)] text-sm" onClick={() => onChange(+(value + step).toFixed(2))}>
          +
        </button>
      </div>
    </div>
  );
}

function ReorderBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-sm text-[var(--muted)] disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function RangeBox({ v, onChange }: { v: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={v}
      onChange={(e) => onChange(Math.max(1, parseInt(e.target.value || "1", 10)))}
      className="w-9 rounded bg-[var(--surface)] py-0.5 text-center tabular-nums outline-none"
    />
  );
}

function defaultRange(ex: Exercise, rules: ReturnType<typeof getRules>) {
  if (ex.equipmentType === "barbell") return rules.repRanges.compound;
  if (ex.resistanceProfile === "short" || ex.primaryMuscle.includes("delt")) return rules.repRanges.isolation;
  return rules.repRanges.accessory;
}

function safeLandmarks(rules: ReturnType<typeof getRules>, profile: "novice" | "intermediate" | "advanced", muscle: string) {
  try {
    return effectiveLandmarks(rules, profile, muscle);
  } catch {
    return { mv: 0, mev: 0, mav: 0, mrv: 1 };
  }
}
