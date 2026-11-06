"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { measurementRepo } from "@/db/repositories";
import { MEASUREMENT_LABELS } from "@/lib/format";
import { Button, Card, EmptyState, HonestNote, PageHeader } from "@/components/ui";
import { MeasurementForm } from "@/components/MeasurementForm";
import type { MeasurementRow } from "@/db/schema";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ema } from "@/domain/analytics";
import { getRules } from "@/lib/rulesLoader";

const TRIGGER_LABELS: Record<MeasurementRow["trigger"], string> = {
  onboarding: "inicio",
  meso_end: "fin de meso",
  periodic: "control semestral",
  manual: "manual",
};

export default function MeasurementsPage() {
  const router = useRouter();
  const history = useLiveQuery(() => measurementRepo.all(), []);
  const [adding, setAdding] = useState(false);
  const [trigger, setTrigger] = useState<MeasurementRow["trigger"]>("manual");

  // El motivo llega por query param (?trigger=meso_end|periodic) desde el aviso de Home.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("trigger");
    if (t === "meso_end" || t === "periodic") {
      setTrigger(t);
      setAdding(true);
    }
  }, []);

  if (!history) return null;

  if (adding) {
    return (
      <>
        <PageHeader
          title="Registrar medidas"
          subtitle={trigger === "meso_end" ? "Fin de mesociclo" : trigger === "periodic" ? "Control semestral" : "Registro manual"}
        />
        <MeasurementForm
          trigger={trigger}
          onSaved={() => {
            setAdding(false);
            router.replace("/measurements");
          }}
          onSkip={() => {
            setAdding(false);
            router.replace("/measurements");
          }}
        />
      </>
    );
  }

  const sorted = [...history].reverse();
  // Tendencia del peso (A3.5): media móvil exponencial sobre los registros en orden.
  const weighIns = [...history]
    .filter((m) => typeof m.bodyweightKg === "number")
    .sort((a, b) => a.date.localeCompare(b.date));
  const trend = ema(weighIns.map((m) => m.bodyweightKg as number), getRules().measurements.weightTrendAlpha);
  const weightRows = weighIns.map((m, i) => ({ date: m.date.slice(5, 10), peso: m.bodyweightKg, tendencia: trend[i] }));

  return (
    <>
      <PageHeader
        title="Medidas"
        subtitle="Seguimiento corporal"
        action={
          <Button size="sm" onClick={() => { setTrigger("manual"); setAdding(true); }}>
            + Registrar
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          title="Sin medidas todavía"
          hint="Registrá tus circunferencias para correlacionarlas con tus mesociclos en Stats."
        />
      ) : (
        <div className="space-y-3">
          {weightRows.length >= 2 && (
            <Card>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold">Peso y tendencia</span>
                <span className="tabular-nums text-[var(--muted)]">
                  tendencia {trend[trend.length - 1]} kg
                </span>
              </div>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weightRows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickLine={false} />
                    <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                    <Line type="monotone" dataKey="peso" stroke="var(--muted)" strokeWidth={0} dot={{ r: 3, fill: "var(--muted)", strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="tendencia" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2">
                <HonestNote>
                  Los puntos son tus pesajes; la línea es una media móvil que filtra el ruido diario
                  (agua, sal, glucógeno). Mirá la dirección de la línea, no el número de un día.
                </HonestNote>
              </div>
            </Card>
          )}
          {sorted.map((m) => (
            <Card key={m.id}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{m.date.slice(0, 10)}</p>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">{TRIGGER_LABELS[m.trigger]}</span>
                  <button
                    className="text-sm text-[var(--danger)]"
                    onClick={() => { if (confirm("¿Eliminar este registro?")) measurementRepo.remove(m.id); }}
                  >
                    ✕
                  </button>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {Object.entries(MEASUREMENT_LABELS).map(([f, label]) => {
                  const v = m[f as keyof MeasurementRow];
                  if (typeof v !== "number") return null;
                  return (
                    <div key={f} className="flex justify-between">
                      <span className="text-[var(--muted)]">{label.replace(/ \(.+\)/, "")}</span>
                      <span className="tabular-nums">{v}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
