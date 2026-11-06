"use client";

import { useState } from "react";
import { PAIN_ZONES, type PainZone } from "@/domain/types";
import { PAIN_ZONE_LABELS } from "@/lib/format";
import { cn } from "./ui";

export type PainAnswer = Array<{ zone: PainZone; score: number }> | null;

/**
 * Pregunta de dolor articular/tendinoso (A5.5). null = sin responder,
 * [] = "no me duele nada". Tono neutral: registra un lugar y una intensidad,
 * nunca una lesión. No es el dolor muscular post-entreno.
 */
export function PainPicker({ value, onChange }: { value: PainAnswer; onChange: (v: PainAnswer) => void }) {
  const has = value !== null && value.length > 0;
  // "Sí" abre las zonas sin elegir ninguna; destildar la última no salta a "No".
  const [open, setOpen] = useState(has);
  const said = value !== null && value.length === 0 && !open;
  const toggleZone = (z: PainZone) => {
    const cur = value ?? [];
    // UX-A5-09: sin puntaje preelegido (0 = todavía sin elegir; no cuenta como señal).
    const next = cur.some((p) => p.zone === z) ? cur.filter((p) => p.zone !== z) : [...cur, { zone: z, score: 0 }];
    onChange(next.length ? next : null);
  };
  const setScore = (z: PainZone, score: number) => onChange((value ?? []).map((p) => (p.zone === z ? { ...p, score } : p)));

  return (
    <div>
      <p className="mb-1.5 text-sm text-[var(--muted)]">¿Te duele alguna articulación o tendón?</p>
      <p className="mb-2 text-[11px] text-[var(--muted)]">No el dolor muscular de los días después: ese no se usa.</p>
      <div className="grid grid-cols-2 gap-2">
        <Chip
          on={said}
          onClick={() => {
            setOpen(false);
            onChange(said ? null : []);
          }}
        >
          No
        </Chip>
        <Chip
          on={open}
          onClick={() => {
            if (open) onChange(null);
            setOpen(!open);
          }}
        >
          Sí
        </Chip>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PAIN_ZONES.map((z) => (
              <Chip key={z} small on={!!value?.some((p) => p.zone === z)} onClick={() => toggleZone(z)}>
                {PAIN_ZONE_LABELS[z]}
              </Chip>
            ))}
          </div>
          {(value ?? []).map((p) => (
            <div key={p.zone}>
              <p className="mb-1 text-xs text-[var(--muted)]">
                {PAIN_ZONE_LABELS[p.zone]}: {p.score > 0 ? `${p.score}/10` : "elegí la intensidad"}
              </p>
              <div className="grid grid-cols-5 gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${PAIN_ZONE_LABELS[p.zone]} ${n} de 10`}
                    aria-pressed={p.score === n}
                    onClick={() => setScore(p.zone, n)}
                    className={cn(
                      "h-11 rounded-lg border text-xs font-medium",
                      p.score === n
                        ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary-ink)]"
                        : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-xl border text-sm font-medium transition",
        small ? "min-h-11 px-3" : "h-11",
        on
          ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary-ink)]"
          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]",
      )}
    >
      {children}
    </button>
  );
}
