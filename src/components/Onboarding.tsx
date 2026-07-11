"use client";

import { useState } from "react";
import { settingsRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";
import { PROFILE_LABELS } from "@/lib/format";
import { Button, Card, HonestNote, Label, Stepper } from "@/components/ui";
import { fmtKg } from "@/lib/format";
import { MeasurementForm } from "@/components/MeasurementForm";
import type { ExperienceProfileId } from "@/domain/types";

/** Alta guiada la primera vez: perfil + peso corporal. Marca onboarded al terminar. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const rules = getRules();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<ExperienceProfileId>("intermediate");
  const [bodyweight, setBodyweight] = useState(80);

  const finish = async () => {
    await settingsRepo.update({
      experienceProfile: profile,
      bodyweightKg: bodyweight,
      onboarded: true,
    });
    onDone();
  };

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">MyoNoesis</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Mesociclos autorregulados, sin humo. Configuremos lo básico.
        </p>
      </div>

      {step === 0 && (
        <Card className="space-y-4">
          <div>
            <Label>¿Cuánta experiencia tenés entrenando?</Label>
            <div className="mt-1 space-y-2">
              {(["novice", "intermediate", "advanced"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProfile(p)}
                  className={
                    "w-full rounded-xl border p-3 text-left transition " +
                    (profile === p
                      ? "border-[var(--primary)] bg-[var(--primary)]/10"
                      : "border-[var(--border)] bg-[var(--surface-2)]")
                  }
                >
                  <p className="font-medium">{PROFILE_LABELS[p]}</p>
                  <p className="text-xs text-[var(--muted)]">{PROFILE_HINT[p]}</p>
                </button>
              ))}
            </div>
          </div>
          <Button className="w-full" onClick={() => setStep(1)}>
            Continuar
          </Button>
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-4">
          <div>
            <Label>Tu peso corporal</Label>
            <Stepper value={bodyweight} step={0.5} min={30} suffix="kg" onChange={setBodyweight} format={fmtKg} />
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              Se usa para el objetivo de proteína (~{rules.nutrition.proteinFloorGperKg} g/kg). Podés
              cambiar todo después en Ajustes.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setStep(0)}>
              Atrás
            </Button>
            <Button className="flex-1" onClick={() => setStep(2)}>
              Continuar
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <>
          <p className="mb-3 text-center text-sm text-[var(--muted)]">
            Medidas iniciales (opcional): sirven para medir el efecto real de cada mesociclo.
            Podés cargarlas después en Medidas.
          </p>
          <MeasurementForm
            trigger="onboarding"
            askHeight
            initialWeight={bodyweight}
            onSaved={finish}
            onSkip={finish}
          />
        </>
      )}

      <div className="mt-4">
        <HonestNote>
          La app usa heurísticas de volumen (MEV/MAV/MRV) como punto de partida, no como verdades
          medidas, y las recalibra con tu propio historial.
        </HonestNote>
      </div>
    </div>
  );
}

const PROFILE_HINT: Record<ExperienceProfileId, string> = {
  novice: "Menos de ~1 año entrenando en serio. Progresás rápido con poco volumen.",
  intermediate: "1–3 años. Doble progresión y volumen moderado.",
  advanced: "Varios años. Más volumen y mesos más cortos.",
};
