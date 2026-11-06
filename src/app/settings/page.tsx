"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { settingsRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";
import Link from "next/link";
import { Button, Card, HonestNote, Input, Label, PageHeader, Select, Stepper } from "@/components/ui";
import { InstallCard } from "@/components/InstallCard";
import { BackupCard } from "@/components/BackupCard";
import { BugListCard } from "@/components/BugReport";
import { EquipmentProfilePicker } from "@/components/EquipmentProfilePicker";
import { applyTheme, type Theme } from "@/lib/theme";
import { PROFILE_LABELS, muscleLabel } from "@/lib/format";
import type { ExperienceProfileId } from "@/domain/types";
import { fmtLoad, fromDisplay, parseLoadList, unitLabel } from "@/lib/units";
import { showToast } from "@/store/dialogs";

/** Lista de pesos (guardados en kg) para editar en la unidad elegida. */
const listText = (kgs: number[]) => kgs.map((k) => fmtLoad(k)).join(", ");

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

  // El inventario se valida al guardar (topes de cordura): si falla, avisar (N4).
  const saveEquipment = (equipment: typeof settings.equipment) =>
    settingsRepo.update({ equipment }).catch((e: unknown) => showToast(e instanceof Error ? e.message : "Inventario inválido.", "danger"));

  const editList = (key: "platesKg" | "dumbbellsKg" | "dumbbellPlatesKg", raw: string) => {
    const original = settings.equipment[key] ?? [];
    const nums = parseLoadList(raw, original);
    if (nums.length === original.length && nums.every((n, i) => n === [...original].sort((a, b) => a - b)[i])) return;
    settingsRepo.update({ equipment: { ...settings.equipment, [key]: nums } }).catch((e: unknown) =>
      showToast(e instanceof Error ? e.message : "Inventario inválido.", "danger"),
    );
  };

  // Mancuernas armables si el usuario declaró discos de mancuerna.
  const loadableDumbbells = (settings.equipment.dumbbellPlatesKg ?? []).length > 0;

  return (
    <>
      <PageHeader title="Ajustes" subtitle="Perfil y equipamiento" />

      <InstallCard />

      <Card className="mb-4 space-y-4">
        <div>
          <Label>Perfil de experiencia</Label>
          <Select
            aria-label="Perfil de experiencia"
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
            load
            onChange={(v) => settingsRepo.update({ bodyweightKg: v })}
          />
        </div>

        <div>
          <Label>Altura (cm)</Label>
          <Stepper
            value={settings.heightCm ?? 175}
            step={1}
            min={100}
            suffix="cm"
            onChange={(v) => settingsRepo.update({ heightCm: v })}
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

      <Link href="/measurements">
        <Card className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Medidas corporales</p>
            <p className="text-xs text-[var(--muted)]">Circunferencias y peso a lo largo del tiempo</p>
          </div>
          <span className="text-[var(--muted)]">→</span>
        </Card>
      </Link>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--muted)]">Equipamiento (redondeo de carga)</h2>
      <EquipmentProfilePicker />
      {/* key: los campos de discos son no controlados; al cambiar de perfil deben remontarse. */}
      <Card key={settings.activeEquipmentProfileId ?? "main"} className="mb-4 space-y-4">
        <div>
          <Label>Peso de la barra</Label>
          <Stepper
            value={settings.equipment.barWeightKg}
            step={2.5}
            min={5}
            load
            onChange={(v) => saveEquipment({ ...settings.equipment, barWeightKg: v })}
          />
        </div>
        <div>
          <Label>Discos disponibles ({unitLabel()}, por par) — separá con comas</Label>
          <Input
            aria-label="Discos disponibles"
            defaultValue={listText(settings.equipment.platesKg)}
            onBlur={(e) => editList("platesKg", e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <Label>Mancuernas armables (discos que se combinan)</Label>
          <div className="mb-2 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5">
            <span className="pr-3 text-sm">
              Uso mancuernas de barra corta y les cargo discos
            </span>
            <Toggle
              label="Mancuernas armables"
              on={loadableDumbbells}
              onChange={(v) =>
                settingsRepo.update({
                  equipment: {
                    ...settings.equipment,
                    dumbbellPlatesKg: v ? [...rules.loadIncrements.commonDumbbellPlatesKg] : [],
                    dumbbellHandleKg: v
                      ? (settings.equipment.dumbbellHandleKg ??
                        rules.loadIncrements.defaultDumbbellHandleKg)
                      : settings.equipment.dumbbellHandleKg,
                  },
                })
              }
            />
          </div>
          {loadableDumbbells ? (
            <>
              <Label>Discos de mancuerna ({unitLabel()}, por lado) — separá con comas</Label>
              <Input
                aria-label="Discos de mancuerna"
                defaultValue={listText(settings.equipment.dumbbellPlatesKg ?? [])}
                onBlur={(e) => editList("dumbbellPlatesKg", e.target.value)}
                inputMode="decimal"
                className="mb-2"
              />
              <Label>Peso del mango</Label>
              <Stepper
                value={settings.equipment.dumbbellHandleKg ?? rules.loadIncrements.defaultDumbbellHandleKg}
                step={0.5}
                min={0}
                load
                onChange={(v) =>
                  saveEquipment({ ...settings.equipment, dumbbellHandleKg: v })
                }
              />
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                El motor calcula cada mancuerna como mango + 2 × (discos combinados), así llega a
                pesos que un rack fijo no tiene (ej. 37·5 kg).
              </p>
            </>
          ) : (
            <>
              <Label>Rack de mancuernas ({unitLabel()}) — separá con comas</Label>
              <Input
                aria-label="Rack de mancuernas"
                defaultValue={listText(settings.equipment.dumbbellsKg)}
                onBlur={(e) => editList("dumbbellsKg", e.target.value)}
                inputMode="decimal"
              />
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                Cada valor es una mancuerna entera. Si superás la más pesada, el motor extrapola
                por el salto típico del rack.
              </p>
            </>
          )}
        </div>
        <div>
          <Label>Paso de máquinas/poleas</Label>
          <Stepper
            value={settings.equipment.machineStepKg}
            step={1}
            min={fromDisplay(1)}
            load
            onChange={(v) => saveEquipment({ ...settings.equipment, machineStepKg: v })}
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
                    ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary-ink)]"
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
          label="Mantener pantalla encendida"
          on={settings.wakeLockEnabled}
          onChange={(v) => settingsRepo.update({ wakeLockEnabled: v })}
        />
      </Card>

      <Card className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Seguros o spotter en barra libre</p>
          <p className="text-xs text-[var(--muted)]">
            Habilita el modo APRE (última serie al fallo) en sentadilla, banca y otros con barra. Sin
            esto, en barra el RIR mínimo es 1 por seguridad.
          </p>
        </div>
        <Toggle
          label="Seguros o spotter en barra libre"
          on={!!settings.barbellFailureAllowed}
          onChange={(v) => settingsRepo.update({ barbellFailureAllowed: v })}
        />
      </Card>

      <NotificationCard />

      <Card className="mb-4">
        <p className="mb-1 font-medium">Unidad de carga</p>
        <p className="mb-2 text-xs text-[var(--muted)]">
          Solo cambia cómo se muestran y tipean las cargas; todo se guarda en kg. Las medidas
          corporales quedan en cm y kg. Cambiarla recarga la app.
        </p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Unidad de carga">
          {(["kg", "lb"] as const).map((u) => {
            const on = (settings.units ?? "kg") === u;
            return (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={async () => {
                  if (on) return;
                  await settingsRepo.update({ units: u });
                  location.reload();
                }}
                className={
                  "rounded-2xl border py-2.5 text-sm font-medium transition " +
                  (on
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-ink)]"
                    : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]")
                }
              >
                {u === "kg" ? "Kilos (kg)" : "Libras (lb)"}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="mb-4">
        <p className="mb-2 font-medium">Tema</p>
        <div className="grid grid-cols-2 gap-2">
          {(["light", "dark"] as Theme[]).map((t) => {
            const on = (settings.theme ?? "light") === t;
            return (
              <button
                key={t}
                onClick={() => {
                  applyTheme(t);
                  settingsRepo.update({ theme: t });
                }}
                className={
                  "rounded-2xl border py-2.5 text-sm font-medium transition " +
                  (on
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-ink)]"
                    : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]")
                }
              >
                {t === "light" ? "☀️ Claro" : "🌙 Oscuro"}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="mb-4">
        <BackupCard />
      </div>

      <div className="mb-4">
        <BugListCard />
      </div>

      <p className="mb-4 text-center text-[11px] text-[var(--muted)]/70">
        Versión {process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"}
      </p>

      <HonestNote>
        Los landmarks de volumen (MEV/MAV/MRV) y los disparadores de deload son heurísticas de
        programación, no cantidades medidas. La app las usa como punto de partida y las recalibra
        con tu historial. Ver SCIENCE.md.
      </HonestNote>
    </>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
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

/**
 * Permiso de notificaciones para el fin del descanso (A1.4). Se pide solo
 * desde acá, nunca en medio de una sesión. Sin permiso, el timer igual vibra.
 */
function NotificationCard() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState<string>(supported ? Notification.permission : "unsupported");
  return (
    <Card className="mb-4">
      <p className="font-medium">Aviso de fin de descanso</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
        El timer vibra al terminar el descanso. Con permiso, también avisa si tenés la app en segundo
        plano. En iPhone funciona con la app instalada en la pantalla de inicio.
      </p>
      <div className="mt-3">
        {perm === "granted" ? (
          <p className="text-sm text-[var(--success)]">✓ Notificaciones activadas</p>
        ) : perm === "denied" ? (
          <p className="text-sm text-[var(--muted)]">Bloqueadas en el navegador; se habilitan desde sus ajustes.</p>
        ) : perm === "unsupported" ? (
          <p className="text-sm text-[var(--muted)]">Este navegador no soporta notificaciones.</p>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                setPerm(await Notification.requestPermission());
              } catch {
                setPerm("denied");
              }
            }}
          >
            Activar notificaciones
          </Button>
        )}
      </div>
    </Card>
  );
}
