"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { settingsRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";
import Link from "next/link";
import { Card, HonestNote, Input, Label, PageHeader, Select, Stepper } from "@/components/ui";
import { InstallCard } from "@/components/InstallCard";
import { PROFILE_LABELS, fmtKg, muscleLabel } from "@/lib/format";
import type { ExperienceProfileId } from "@/domain/types";

export default function SettingsPage() {
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const rules = getRules();

  if (!settings) return null;

  const toggleMuscle = (m: string) => {
    const set = new Set(settings.prioritizedMuscles);
    if (set.has(m)) set.delete(m);
    else set.add(m);
    settingsRepo.update({ prioritizedMuscles: [...set] });
  };

  const editList = (key: "platesKg" | "dumbbellsKg", raw: string) => {
    const nums = raw
      .split(",")
      .map((x) => parseFloat(x.trim()))
      .filter((x) => !Number.isNaN(x) && x > 0)
      .sort((a, b) => a - b);
    settingsRepo.update({ equipment: { ...settings.equipment, [key]: nums } });
  };

  return (
    <>
      <PageHeader title="Ajustes" subtitle="Perfil y equipamiento" />

      <InstallCard />

      <Card className="mb-4 space-y-4">
        <div>
          <Label>Perfil de experiencia</Label>
          <Select
            value={settings.experienceProfile}
            onChange={(e) =>
              settingsRepo.update({ experienceProfile: e.target.value as ExperienceProfileId })
            }
          >
            {(["novice", "intermediate", "advanced"] as const).map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABELS[p]}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            Ajusta volumen inicial, techo y agresividad de la rampa. Multiplicador heurístico,
            no medido.
          </p>
        </div>

        <div>
          <Label>Peso corporal</Label>
          <Stepper
            value={settings.bodyweightKg}
            step={0.5}
            min={30}
            suffix="kg"
            onChange={(v) => settingsRepo.update({ bodyweightKg: v })}
            format={fmtKg}
          />
        </div>

        <div>
          <Label>Objetivo de proteína (g/kg)</Label>
          <Stepper
            value={settings.proteinTargetGperKg}
            step={0.1}
            min={0.8}
            suffix="g/kg"
            onChange={(v) => settingsRepo.update({ proteinTargetGperKg: v })}
            format={(v) => v.toFixed(1)}
          />
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            Piso ~{rules.nutrition.proteinFloorGperKg} g/kg (Morton 2018); techo defendible{" "}
            {rules.nutrition.proteinUpperGperKg} g/kg. Es piso, no techo.
          </p>
        </div>

        <div>
          <Label>Sueño mínimo (horas)</Label>
          <Stepper
            value={settings.minSleepHours}
            step={0.5}
            min={4}
            suffix="h"
            onChange={(v) => settingsRepo.update({ minSleepHours: v })}
            format={(v) => v.toFixed(1)}
          />
        </div>
      </Card>

      <Link href="/exercises">
        <Card className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Biblioteca de ejercicios</p>
            <p className="text-xs text-[var(--muted)]">Ver, crear y editar ejercicios</p>
          </div>
          <span className="text-[var(--muted)]">→</span>
        </Card>
      </Link>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Equipamiento (redondeo de carga)</h2>
      <Card className="mb-4 space-y-4">
        <div>
          <Label>Peso de la barra</Label>
          <Stepper
            value={settings.equipment.barWeightKg}
            step={2.5}
            min={5}
            suffix="kg"
            onChange={(v) => settingsRepo.update({ equipment: { ...settings.equipment, barWeightKg: v } })}
            format={fmtKg}
          />
        </div>
        <div>
          <Label>Discos disponibles (kg, por par) — separá con comas</Label>
          <Input
            defaultValue={settings.equipment.platesKg.join(", ")}
            onBlur={(e) => editList("platesKg", e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <Label>Mancuernas disponibles (kg) — separá con comas</Label>
          <Input
            defaultValue={settings.equipment.dumbbellsKg.join(", ")}
            onBlur={(e) => editList("dumbbellsKg", e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <Label>Paso de máquinas/poleas</Label>
          <Stepper
            value={settings.equipment.machineStepKg}
            step={1}
            min={1}
            suffix="kg"
            onChange={(v) => settingsRepo.update({ equipment: { ...settings.equipment, machineStepKg: v } })}
            format={fmtKg}
          />
        </div>
      </Card>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Músculos priorizados</h2>
      <Card className="mb-4">
        <p className="mb-3 text-xs text-[var(--muted)]">
          El volumen extra de la rampa se concentra en estos músculos. Sin selección, todos rampan
          por igual.
        </p>
        <div className="flex flex-wrap gap-2">
          {rules.muscles.map((m) => {
            const on = settings.prioritizedMuscles.includes(m);
            return (
              <button
                key={m}
                onClick={() => toggleMuscle(m)}
                className={
                  "rounded-full border px-3 py-1.5 text-sm transition " +
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
      </Card>

      <Card className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-medium">Mantener pantalla encendida</p>
          <p className="text-xs text-[var(--muted)]">Wake lock durante la sesión</p>
        </div>
        <Toggle
          on={settings.wakeLockEnabled}
          onChange={(v) => settingsRepo.update({ wakeLockEnabled: v })}
        />
      </Card>

      <HonestNote>
        Los landmarks de volumen (MEV/MAV/MRV) y los disparadores de deload son heurísticas de
        programación, no cantidades medidas. La app las usa como punto de partida y las recalibra
        con tu historial. Ver SCIENCE.md.
      </HonestNote>
    </>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={
        "relative h-7 w-12 rounded-full transition " + (on ? "bg-[var(--primary)]" : "bg-[var(--surface-2)]")
      }
    >
      <span
        className={
          "absolute top-1 h-5 w-5 rounded-full bg-white transition-all " + (on ? "left-6" : "left-1")
        }
      />
    </button>
  );
}
