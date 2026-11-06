"use client";

import { useState } from "react";
import { checkinRepo } from "@/db/repositories";
import { Button, Card } from "./ui";
import { PainPicker, painMissingScore, painToSave, type PainAnswer } from "./PainPicker";

/** Pregunta periódica de dolor (A5.5): un toque para "No". Nunca bloquea la sesión. */
export function PainAskCard({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [pain, setPain] = useState<PainAnswer>(null);
  const save = async (v: NonNullable<PainAnswer>) => {
    await checkinRepo.setPain(sessionId, v);
    onDone();
  };
  return (
    <Card className="mb-4 space-y-3">
      <PainPicker value={pain} onChange={(v) => (v !== null && v.length === 0 ? save([]) : setPain(v))} />
      {pain !== null && pain.length > 0 && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onDone}>
            Ahora no
          </Button>
          <Button
            className="flex-1"
            disabled={painMissingScore(pain)}
            title={painMissingScore(pain) ? "Elegí la intensidad de cada zona" : undefined}
            onClick={() => {
              const v = painToSave(pain);
              if (v) void save(v);
            }}
          >
            Guardar
          </Button>
        </div>
      )}
      {pain === null && (
        <button type="button" className="min-h-11 text-xs text-[var(--muted)] underline" onClick={onDone}>
          Ahora no
        </button>
      )}
      <p className="text-[11px] text-[var(--muted)]">
        Cada algunas sesiones te pregunto esto. Solo se registra y, si se repite, te propongo ajustes que podés aceptar o no.
      </p>
    </Card>
  );
}
