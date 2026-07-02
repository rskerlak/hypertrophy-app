"use client";

import { useState } from "react";
import { checkinRepo } from "@/db/repositories";
import { uuid } from "@/lib/id";
import { Button, Card } from "./ui";
import type { Checkin } from "@/domain/types";

/**
 * Check-in neutral opcional (F7). NUNCA modifica la sesión ni la bloquea;
 * solo persiste para análisis longitudinal. Tono sin culpa, saltable.
 */
export function CheckinSheet({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [slept, setSlept] = useState<boolean | null>(null);
  const [protein, setProtein] = useState<boolean | null>(null);
  const [energy, setEnergy] = useState<Checkin["energyBalance"]>(null);
  const [readiness, setReadiness] = useState<number | null>(null);

  const save = async () => {
    const c: Checkin = {
      id: uuid(),
      sessionId,
      date: new Date().toISOString(),
      sleptMinimum: slept,
      proteinSufficient: protein,
      energyBalance: energy,
      readiness,
    };
    await checkinRepo.put(c);
    onDone();
  };

  return (
    <Card className="mb-4 space-y-4">
      <div>
        <p className="font-medium">Check-in rápido</p>
        <p className="text-xs text-[var(--muted)]">
          Opcional. No cambia tu sesión: solo se registra para ver tendencias. Podés saltarlo.
        </p>
      </div>

      <YesNo label="¿Dormiste tu mínimo anoche?" value={slept} onChange={setSlept} />
      <YesNo label="¿Proteína suficiente ayer?" value={protein} onChange={setProtein} />

      <div>
        <p className="mb-1.5 text-sm text-[var(--muted)]">Balance energético</p>
        <div className="grid grid-cols-3 gap-2">
          {(["deficit", "maintenance", "surplus"] as const).map((e) => (
            <Chip key={e} on={energy === e} onClick={() => setEnergy(energy === e ? null : e)}>
              {e === "deficit" ? "Déficit" : e === "maintenance" ? "Mant." : "Superávit"}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm text-[var(--muted)]">Disposición a entrenar (1–5)</p>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Chip key={n} on={readiness === n} onClick={() => setReadiness(readiness === n ? null : n)}>
              {n}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          Saltar
        </Button>
        <Button className="flex-1" onClick={save}>
          Guardar
        </Button>
      </div>
    </Card>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-sm text-[var(--muted)]">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <Chip on={value === true} onClick={() => onChange(value === true ? null : true)}>
          Sí
        </Chip>
        <Chip on={value === false} onClick={() => onChange(value === false ? null : false)}>
          No
        </Chip>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "h-10 rounded-xl border text-sm font-medium transition " +
        (on
          ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]"
          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]")
      }
    >
      {children}
    </button>
  );
}
