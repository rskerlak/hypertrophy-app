"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { analyzePostSession, type PostSessionAnalysis } from "@/lib/postSession";
import { Badge, Button, Card, HonestNote, PageHeader } from "@/components/ui";

export default function SessionDonePage() {
  return (
    <Suspense fallback={null}>
      <SessionDone />
    </Suspense>
  );
}

function SessionDone() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [analysis, setAnalysis] = useState<PostSessionAnalysis | null | undefined>(undefined);

  useEffect(() => {
    if (id) analyzePostSession(id).then(setAnalysis);
  }, [id]);

  return (
    <>
      <PageHeader title="¡Sesión completada!" subtitle="Buen trabajo." />

      <Card className="mb-4 text-center">
        <div className="mb-2 text-4xl">✓</div>
        <p className="text-sm text-[var(--muted)]">
          Tus series quedaron registradas. El motor usará este rendimiento para autorregular la
          próxima sesión.
        </p>
      </Card>

      {analysis === undefined && <Card>Analizando…</Card>}

      {analysis && analysis.deload.shouldSuggest && (
        <Card className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="warning">Deload sugerido</Badge>
          </div>
          <p className="mb-2 text-sm">
            {analysis.deload.forced
              ? "Terminaste las semanas de acumulación programadas."
              : "Aparecieron señales de fatiga acumulada:"}
          </p>
          <ul className="mb-3 list-inside list-disc space-y-1 text-sm text-[var(--muted)]">
            {analysis.deload.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <HonestNote>
            Son señales probabilísticas de fatiga, no la prueba de haber &quot;superado tu MRV&quot;.
            La caída de rendimiento es sobre todo fatiga aguda. Vos decidís si descargar.
          </HonestNote>
        </Card>
      )}

      {analysis && analysis.swaps.length > 0 && (
        <Card className="mb-4">
          <p className="mb-2 font-medium">Sugerencias de cambio de ejercicio</p>
          {analysis.swaps.map((s) => (
            <div key={s.exerciseId} className="mb-2 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
              <p className="font-medium">
                {s.exerciseName}
                {s.candidateName && <span className="text-[var(--muted)]"> → {s.candidateName}</span>}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">{s.reason}</p>
            </div>
          ))}
          <p className="text-[11px] text-[var(--muted)]">
            Solo sobre ejercicios marcados como intercambiables y ante estancamiento; nunca rotación
            aleatoria.
          </p>
        </Card>
      )}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => router.push("/")}>
          Volver al inicio
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => router.push("/calendar")}>
          Calendario
        </Button>
      </div>
    </>
  );
}
