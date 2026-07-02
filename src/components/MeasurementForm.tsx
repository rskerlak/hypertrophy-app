"use client";

import { useState } from "react";
import { measurementRepo, settingsRepo } from "@/db/repositories";
import { MEASUREMENT_LABELS } from "@/lib/format";
import { Button, Card, Input, Label } from "@/components/ui";
import type { MeasurementRow } from "@/db/schema";

const FIELDS = Object.keys(MEASUREMENT_LABELS) as Array<keyof typeof MEASUREMENT_LABELS>;

/** Formulario de medidas corporales. Todos los campos son opcionales. */
export function MeasurementForm({
  trigger,
  askHeight,
  initialWeight,
  onSaved,
  onSkip,
}: {
  trigger: MeasurementRow["trigger"];
  /** Pedir altura (solo primera vez; va a settings). */
  askHeight?: boolean;
  initialWeight?: number;
  onSaved: () => void;
  onSkip?: () => void;
}) {
  const [height, setHeight] = useState<string>("");
  const [vals, setVals] = useState<Record<string, string>>(
    initialWeight ? { bodyweightKg: String(initialWeight) } : {},
  );

  const parse = (s: string): number | undefined => {
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const save = async () => {
    const m: Omit<MeasurementRow, "id"> = { date: new Date().toISOString(), trigger };
    for (const f of FIELDS) {
      const v = parse(vals[f] ?? "");
      if (v !== undefined) (m as Record<string, unknown>)[f] = v;
    }
    const h = parse(height);
    const patch: Parameters<typeof settingsRepo.update>[0] = {};
    if (askHeight && h) patch.heightCm = h;
    const w = parse(vals.bodyweightKg ?? "");
    if (w) patch.bodyweightKg = w; // mantener el peso de settings sincronizado
    if (Object.keys(patch).length > 0) await settingsRepo.update(patch);
    await measurementRepo.add(m);
    onSaved();
  };

  const anyValue = FIELDS.some((f) => parse(vals[f] ?? "") !== undefined) || (askHeight && parse(height));

  return (
    <Card className="space-y-3.5">
      {askHeight && (
        <div>
          <Label>Altura (cm)</Label>
          <Input
            inputMode="decimal"
            placeholder="ej: 178"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </div>
      )}
      {FIELDS.map((f) => (
        <div key={f}>
          <Label>{MEASUREMENT_LABELS[f]}</Label>
          <Input
            inputMode="decimal"
            placeholder="—"
            value={vals[f] ?? ""}
            onChange={(e) => setVals((p) => ({ ...p, [f]: e.target.value }))}
          />
        </div>
      ))}
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Medí siempre en las mismas condiciones (misma hora, sin bombeo) para que las comparaciones
        entre ciclos tengan sentido.
      </p>
      <div className="flex gap-2">
        {onSkip && (
          <Button variant="secondary" className="flex-1" onClick={onSkip}>
            Omitir
          </Button>
        )}
        <Button className="flex-1" disabled={!anyValue} onClick={save}>
          Guardar medidas
        </Button>
      </div>
    </Card>
  );
}
