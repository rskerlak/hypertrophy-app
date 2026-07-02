"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { measurementRepo } from "@/db/repositories";
import { Card } from "@/components/ui";

const TEXTS = {
  meso_end: "Terminaste un mesociclo: registrá tus medidas para comparar el efecto del ciclo.",
  periodic: "Pasaron ~6 meses desde tus últimas medidas: un control ayuda a la calibración.",
};

/**
 * Aviso neutral para re-registrar medidas: al terminar un meso y cada ~6 meses.
 * Nunca bloquea nada; un tap lleva al formulario.
 */
export function MeasurementPrompt() {
  const prompt = useLiveQuery(() => measurementRepo.pendingPrompt(), []);
  if (!prompt) return null;

  return (
    <Link href={`/measurements?trigger=${prompt.trigger}`}>
      <Card className="mb-4 border-[var(--primary)]/30 bg-[var(--primary)]/5">
        <p className="text-sm font-semibold text-[var(--primary)]">📏 Medidas pendientes</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{TEXTS[prompt.trigger]}</p>
      </Card>
    </Link>
  );
}
