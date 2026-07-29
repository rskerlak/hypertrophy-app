"use client";

import type { VolumeLandmarks } from "@/domain/rules";
import { fmtSets, muscleLabel } from "@/lib/format";

/** Barra de volumen del músculo situada contra MEV/MAV/MRV (heurísticos). */
export function VolumeBar({ muscle, sets, lm }: { muscle: string; sets: number; lm: VolumeLandmarks }) {
  const scaleMax = Math.max(lm.mrv * 1.1, sets);
  const pct = (v: number) => `${(v / scaleMax) * 100}%`;

  let tone = "var(--muted)";
  let status: string | null = null;
  if (sets > lm.mrv) {
    tone = "var(--danger)";
    status = "exceso";
  } else if (sets > lm.mav) {
    tone = "var(--warning)";
    status = "alto";
  } else if (sets >= lm.mev) {
    tone = "var(--success)";
  }

  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span>{muscleLabel(muscle)}</span>
        <span className="tabular-nums text-[var(--muted)]">
          {fmtSets(sets)} series
          {status && (
            <span className="ml-1.5 font-semibold" style={{ color: tone }}>
              · {status}
            </span>
          )}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full transition-all" style={{ width: pct(sets), background: tone }} />
        {/* marcadores MEV / MAV / MRV */}
        {(["mev", "mav", "mrv"] as const).map((k) => (
          <span
            key={k}
            className="absolute top-0 h-full w-px bg-[var(--foreground)]/40"
            style={{ left: pct(lm[k]) }}
            title={k.toUpperCase()}
          />
        ))}
      </div>
    </div>
  );
}
