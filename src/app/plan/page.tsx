"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { baseWeekRepo, exerciseRepo, mesocycleRepo, settingsRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";
import { effectiveLandmarks } from "@/domain/rules";
import { sessionCapWarnings, weeklyVolumeByMuscle } from "@/domain/volume";
import { suggestVolumeTrim, trimRoleBySlot } from "@/domain/volumeTrim";
import type { BaseWeek, DayIntensity, Exercise, ProgressionModel, RirBand } from "@/domain/types";
import { Badge, Button, Card, cn, EditableNumber, EmptyState, HonestNote, Input, Label, PageHeader, Select, Stepper } from "@/components/ui";
import { VolumeBar } from "@/components/VolumeBar";
import { PROGRESSION_LABELS, fmtKg, fmtSets, muscleLabel } from "@/lib/format";
import { ROUTINE_TEMPLATES } from "@/lib/templates";
import { WEEKDAY_LETTERS, defaultWeekdays, todayIso } from "@/lib/agenda";

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
              {
                exerciseId: exercise.id,
                targetSets: 3,
                repRange: range,
                // Ejercicios de peso corporal arrancan en modo "Corporal" (carga 0).
                startingLoadKg: exercise.equipmentType === "bodyweight" ? 0 : 20,
              },
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

  // Qué conservar y qué es prescindible cuando un músculo pasa lo aconsejable.
  // El motor decide anclas vs recortables (perfil de resistencia, aporte
  // directo, orden); la app solo lo señala, nunca borra nada sola.
  const trim = suggestVolumeTrim({
    baseWeek,
    exercisesById: exById,
    volumeByMuscle: volume,
    profile: settings.experienceProfile,
    rules,
  });
  const trimBySlot = trimRoleBySlot(trim);
  const trimmable = [...trimBySlot.values()].filter((v) => v.role === "trim").length;

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

      {trim.muscles.length > 0 && (
        <div className="mb-3">
          <HonestNote>
            {trim.muscles
              .map(
                (m) =>
                  `${muscleLabel(m.muscle)} ${fmtSets(m.current)} (aconsejable ~${fmtSets(m.target)})`,
              )
              .join(" · ")}
            {trimmable > 0 ? (
              <>
                {" "}— marqué{" "}
                <span className="text-[var(--warning)]">
                  {trimmable} ejercicio{trimmable > 1 ? "s" : ""} prescindible
                  {trimmable > 1 ? "s" : ""}
                </span>{" "}
                (repiten un perfil de resistencia ya cubierto). Las anclas cubren el aporte directo y
                la posición estirada (iguala al recorrido completo; la acortada es la menos respaldada). Solo señalo ejercicios cuyo
                músculo PRINCIPAL está excedido: si el exceso viene del aporte sinergista, sacar el
                ejercicio te costaría su trabajo directo — ahí conviene bajar series. Vos decidís:
                los landmarks son heurísticos, no umbrales medidos.
              </>
            ) : (
              " — pero no hay ejercicio claramente prescindible: el exceso viene del aporte sinergista de otros patrones o de las series por ejercicio, no de la selección. Para bajarlo, recortá series antes que ejercicios."
            )}
          </HonestNote>
        </div>
      )}

      {baseWeek.days.length === 0 && (
        <>
          <EmptyState
            title="Sin días todavía"
            hint="Agregá tu primer día de entrenamiento, o arrancá desde una rutina precargada y editala a gusto."
          />
          <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Rutinas precargadas</h2>
          <TemplatesList />
        </>
      )}

      <div className="space-y-3">
        {baseWeek.days.map((day, dayIdx) => (
          // key con la etiqueta: el input del nombre es no controlado y, al
          // reemplazar o reordenar la semana, mostraba el nombre viejo.
          <Card key={`${dayIdx}:${day.label}`}>
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

            <IntensityPicker
              value={day.intensity}
              onChange={(intensity) => {
                const days = baseWeek.days.map((d, i) => {
                  if (i !== dayIdx) return d;
                  const next = { ...d };
                  if (intensity) next.intensity = intensity;
                  else delete next.intensity;
                  return next;
                });
                save({ days });
              }}
            />

            {sessionCapWarnings(day, exById, rules).length > 0 && (
              <p className="mb-2 rounded-lg bg-[var(--warning)]/10 px-3 py-2 text-[11px] leading-relaxed text-[var(--warning)]">
                {sessionCapWarnings(day, exById, rules)
                  .map((w) => `${muscleLabel(w.muscle)} ${fmtKg(w.sets)}`)
                  .join(" · ")}{" "}
                series fraccionadas en este día. Por encima de ~{rules.volumeCounting.softSessionCapFractionalSets} por músculo y
                sesión el rendimiento por serie cae (estimación provisional, Remmert 2025); repartir en otro día es
                neutral, no superior.
              </p>
            )}

            <div className="space-y-2">
              {day.slots.map((slot, slotIdx) => {
                const ex = exById.get(slot.exerciseId);
                if (!ex) return null;
                const tr = trimBySlot.get(`${dayIdx}:${slotIdx}`);
                return (
                  <div
                    key={slotIdx}
                    title={tr?.reason}
                    className={
                      "rounded-xl border p-3 " +
                      (tr?.role === "trim"
                        ? "border-[var(--warning)]/60 border-dashed bg-[var(--warning)]/[0.07]"
                        : "border-[var(--border)] bg-[var(--surface-2)]")
                    }
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{ex.name}</p>
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                          {muscleLabel(ex.primaryMuscle)}
                          {ex.resistanceProfile === "stretch" && " · estiramiento"}
                          {tr?.role === "trim" && <Badge tone="warning">prescindible</Badge>}
                          {tr?.role === "anchor" && <Badge tone="success">ancla</Badge>}
                          {slot.supersetGroup && <Badge tone="primary">superserie</Badge>}
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
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        title="La serie 1 se planifica más cerca del fallo como ancla para calibrar tu RIR"
                        onClick={() => updateSlot(dayIdx, slotIdx, { anchorSet: !slot.anchorSet || undefined })}
                        className={
                          "rounded-full border px-2.5 py-1 text-[11px] font-semibold " +
                          (slot.anchorSet ? "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)]" : "border-[var(--border)] text-[var(--muted)]")
                        }
                      >
                        ⚓ serie ancla
                      </button>
                      <button
                        type="button"
                        disabled={ex.equipmentType === "barbell" && !settings.barbellFailureAllowed}
                        title={
                          ex.equipmentType === "barbell" && !settings.barbellFailureAllowed
                            ? "En barra libre requiere declarar seguros o spotter en Ajustes"
                            : "APRE: la última serie es AMRAP (al fallo) y decide la carga siguiente"
                        }
                        onClick={() => updateSlot(dayIdx, slotIdx, { progression: slot.progression === "apre" ? undefined : "apre" })}
                        className={
                          "rounded-full border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 " +
                          (slot.progression === "apre" ? "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)]" : "border-[var(--border)] text-[var(--muted)]")
                        }
                      >
                        APRE (AMRAP)
                      </button>
                    </div>
                    {slotIdx < day.slots.length - 1 && (
                      <button
                        type="button"
                        className="mb-2 text-[11px] font-semibold text-[var(--primary)]"
                        onClick={() => {
                          const next = day.slots[slotIdx + 1];
                          const linked = !!slot.supersetGroup && slot.supersetGroup === next.supersetGroup;
                          const g = slot.supersetGroup ?? next.supersetGroup ?? `ss-${dayIdx}-${slotIdx}`;
                          const days = baseWeek.days.map((d, i) => {
                            if (i !== dayIdx) return d;
                            const slots = d.slots.map((s, j) => {
                              if (j !== slotIdx && j !== slotIdx + 1) return s;
                              if (linked) {
                                // Desvincular: el siguiente sale del grupo; este también si queda solo.
                                const { supersetGroup: _g, ...rest } = s;
                                void _g;
                                return j === slotIdx + 1 || !d.slots.some((x, k) => k < slotIdx && x.supersetGroup === s.supersetGroup)
                                  ? rest
                                  : s;
                              }
                              return { ...s, supersetGroup: g };
                            });
                            return { ...d, slots };
                          });
                          save({ days });
                        }}
                      >
                        {slot.supersetGroup && slot.supersetGroup === day.slots[slotIdx + 1]?.supersetGroup
                          ? "✕ quitar superserie con el siguiente"
                          : "⇣ superserie con el siguiente"}
                      </button>
                    )}
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
                        label={slot.startingLoadKg === 0 ? "Carga · BW" : "Carga"}
                        value={slot.startingLoadKg}
                        min={0}
                        step={2.5}
                        format={(v) => (v === 0 ? "Corp." : fmtKg(v))}
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

      {baseWeek.days.length > 0 && (
        <details className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">Cambiar a una rutina precargada</summary>
          <p className="mb-3 mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Reemplaza tu semana base (los mesos ya generados no cambian). Las cargas se estiman desde
            tu historial real. Después generás un meso nuevo con «Generar mesociclo».
          </p>
          <TemplatesList replace />
        </details>
      )}

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
              initialWeekdays={settings.trainingWeekdays ?? defaultWeekdays(baseWeek.days.length)}
              onCancel={() => setShowGen(false)}
              onGenerate={async (name, model, weeks, rirBand, startIso, weekdays) => {
                const meso = await mesocycleRepo.createFromBaseWeek({ name, progressionModel: model, numAccumulationWeeks: weeks, rirBand });
                // Agenda (A3.2): solo fechas para mostrar; la progresión sigue siendo por sesión.
                if (weekdays.length > 0) await mesocycleRepo.schedule(meso.id, startIso, weekdays);
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
  initialWeekdays,
  onGenerate,
  onCancel,
}: {
  defaultModel: ProgressionModel;
  defaultWeeks: number;
  maxWeeks: number;
  initialWeekdays: number[];
  onGenerate: (name: string, model: ProgressionModel, weeks: number, rirBand: RirBand, startIso: string, weekdays: number[]) => void;
  onCancel: () => void;
}) {
  const rules = getRules();
  const [name, setName] = useState("Mesociclo 1");
  const [model, setModel] = useState<ProgressionModel>(defaultModel);
  const [weeks, setWeeks] = useState(defaultWeeks);
  // Banda de RIR del meso. Default 1–3: 1–2 RIR iguala al fallo en entrenados
  // y más de 3 queda lejos del estímulo (ver rules.config _bandNote).
  const lim = rules.rirSchedule.selectableBand;
  const [band, setBand] = useState<RirBand>({ min: Math.max(lim.min, 1), max: Math.min(lim.max, 3) });
  const [start, setStart] = useState(todayIso());
  const [days, setDays] = useState<number[]>(initialWeekdays);

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
      <div>
        <Label>Banda de RIR del meso</Label>
        <div className="grid grid-cols-2 gap-2">
          <Stepper
            value={band.min}
            min={lim.min}
            step={1}
            suffix="mín"
            onChange={(v) => setBand({ min: Math.min(v, band.max), max: band.max })}
          />
          <Stepper
            value={band.max}
            min={band.min}
            step={1}
            suffix="máx"
            onChange={(v) => setBand({ min: band.min, max: Math.min(v, lim.max) })}
          />
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          Todo RIR planificado (días fuertes/livianos y deload incluidos) se acota a esta banda.
          1–3 es lo recomendado: 1–2 RIR iguala al fallo en entrenados (Refalo 2024) y más de 3
          queda lejos del estímulo. El piso de 1 en barra libre se mantiene por seguridad.
        </p>
      </div>
      <div>
        <Label>Agenda: días que entrenás y fecha de inicio</Label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(d)}
              onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
              className={cn(
                "h-10 flex-1 rounded-xl border text-sm font-semibold",
                days.includes(d) ? "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)]" : "border-[var(--border)] text-[var(--muted)]",
              )}
            >
              {WEEKDAY_LETTERS[d]}
            </button>
          ))}
        </div>
        <Input type="date" className="mt-2" value={start} onChange={(e) => setStart(e.target.value)} />
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          Solo agenda: si perdés un día, la sesión pendiente sigue siendo la misma. Sin días
          marcados, el meso queda sin fechas.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={() => onGenerate(name.trim() || "Mesociclo", model, weeks, band, start, days)}>
          Generar
        </Button>
      </div>
    </Card>
  );
}

/**
 * Intensidad fija del día: fuerte (menos RIR) / normal / liviano (más RIR).
 * El mismo ejercicio en un día fuerte y en uno liviano progresa por separado.
 */
function IntensityPicker({
  value,
  onChange,
}: {
  value?: DayIntensity;
  onChange: (v: DayIntensity | undefined) => void;
}) {
  const rules = getRules();
  const opts: Array<{ v: DayIntensity | undefined; label: string; hint: string }> = [
    { v: "heavy", label: rules.dayIntensity.heavy.label, hint: `RIR ${rules.dayIntensity.heavy.rirOffset}` },
    { v: undefined, label: "Normal", hint: "RIR ±0" },
    { v: "light", label: rules.dayIntensity.light.label, hint: `RIR +${rules.dayIntensity.light.rirOffset}` },
  ];
  return (
    <div className="mb-3 flex gap-1 rounded-xl bg-[var(--surface-2)] p-1">
      {opts.map((o) => {
        const active = (value ?? undefined) === o.v;
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(o.v)}
            className={
              "flex flex-1 flex-col items-center rounded-lg py-1.5 text-xs font-semibold transition-colors " +
              (active
                ? o.v === "heavy"
                  ? "bg-[var(--danger)]/15 text-[var(--danger)]"
                  : o.v === "light"
                    ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                    : "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted)]")
            }
          >
            {o.label}
            <span className="text-[10px] font-normal opacity-70">{o.hint}</span>
          </button>
        );
      })}
    </div>
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

/** Rutinas precargadas; con `replace`, pide confirmación antes de reemplazar la semana base. */
function TemplatesList({ replace }: { replace?: boolean }) {
  return (
    <>
      {ROUTINE_TEMPLATES.map((t) => (
        <Card key={t.id} className="mb-3">
          <p className="font-semibold">{t.name}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{t.description}</p>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {t.days.length} días · {t.days.reduce((a, d) => a + d.slots.length, 0)} ejercicios
          </p>
          <Button
            size="sm"
            className="mt-3 w-full"
            onClick={async () => {
              if (replace && !confirm(`¿Reemplazar tu semana base por «${t.name}»? Tus mesos ya generados no cambian.`)) return;
              const r = await baseWeekRepo.applyTemplate(
                t.days.map((d) => ({ ...d, slots: d.slots.map((sl) => ({ ...sl, repRange: { ...sl.repRange } })) })),
              );
              if (r.estimated > 0) {
                alert(
                  `Rutina aplicada. ${r.estimated} carga${r.estimated === 1 ? "" : "s"} estimada${r.estimated === 1 ? "" : "s"} desde tu historial real (1RM de tu última sesión, ajustado al rango y al RIR de cada día)${r.kept > 0 ? `; ${r.kept} sin historial quedaron como en la plantilla` : ""}. Revisalas antes de generar.`,
                );
              }
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            {replace ? "Usar esta rutina" : "Usar como base (editable)"}
          </Button>
        </Card>
      ))}
    </>
  );
}
