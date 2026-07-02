"use client";

import { useState } from "react";
import { getRules } from "@/lib/rulesLoader";
import { EQUIPMENT_LABELS, RESISTANCE_LABELS, muscleLabel } from "@/lib/format";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import type { Exercise, EquipmentType, ResistanceProfile } from "@/domain/types";

export type ExerciseDraft = Omit<Exercise, "id" | "custom" | "swapCandidates"> & {
  swapCandidates: string[];
};

/** Formulario para crear/editar un ejercicio personalizado. */
export function ExerciseForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Exercise;
  onSave: (draft: ExerciseDraft) => void;
  onCancel: () => void;
}) {
  const rules = getRules();
  const [name, setName] = useState(initial?.name ?? "");
  const [primaryMuscle, setPrimary] = useState(initial?.primaryMuscle ?? rules.muscles[0]);
  const [secondary, setSecondary] = useState<string[]>(initial?.secondaryMuscles ?? []);
  const [equipmentType, setEquip] = useState<EquipmentType>(initial?.equipmentType ?? "machine");
  const [resistanceProfile, setResistance] = useState<ResistanceProfile>(initial?.resistanceProfile ?? "mid");
  const [isSwappable, setSwappable] = useState(initial?.isSwappable ?? true);

  const toggleSecondary = (m: string) => {
    setSecondary((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const save = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      primaryMuscle,
      secondaryMuscles: secondary.filter((m) => m !== primaryMuscle),
      equipmentType,
      resistanceProfile,
      isSwappable,
      swapCandidates: initial?.swapCandidates ?? [],
      defaultRepRange: initial?.defaultRepRange,
    });
  };

  return (
    <Card className="space-y-4">
      <div>
        <Label>Nombre</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Cable Crossover (Cruce en polea)" />
        <p className="mt-1 text-xs text-[var(--muted)]">Convención: nombre en inglés, español entre paréntesis.</p>
      </div>

      <div>
        <Label>Músculo principal</Label>
        <Select value={primaryMuscle} onChange={(e) => setPrimary(e.target.value)}>
          {rules.muscles.map((m) => (
            <option key={m} value={m}>
              {muscleLabel(m)}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label>Músculos sinergistas (0·5 series c/u)</Label>
        <div className="flex flex-wrap gap-2">
          {rules.muscles
            .filter((m) => m !== primaryMuscle)
            .map((m) => {
              const on = secondary.includes(m);
              return (
                <button
                  key={m}
                  onClick={() => toggleSecondary(m)}
                  className={
                    "rounded-full border px-2.5 py-1 text-xs transition " +
                    (on
                      ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]"
                      : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]")
                  }
                >
                  {muscleLabel(m)}
                </button>
              );
            })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Equipo</Label>
          <Select value={equipmentType} onChange={(e) => setEquip(e.target.value as EquipmentType)}>
            {Object.entries(EQUIPMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Perfil de resistencia</Label>
          <Select value={resistanceProfile} onChange={(e) => setResistance(e.target.value as ResistanceProfile)}>
            {Object.entries(RESISTANCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isSwappable} onChange={(e) => setSwappable(e.target.checked)} className="h-4 w-4" />
        Permitir que el motor sugiera cambiarlo ante estancamiento
      </label>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={save} disabled={!name.trim()}>
          Guardar
        </Button>
      </div>
    </Card>
  );
}
