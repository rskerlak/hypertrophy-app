"use client";

import Link from "next/link";
import type { LongTermTrend } from "@/domain/analytics";
import { Badge, Card } from "@/components/ui";
import { INTENT_LABELS } from "@/lib/format";
import { toDisplay, unitLabel } from "@/lib/units";

/** Tendencia del e1RM por meso (A5.2). `compact` = una fila para la lista de Stats. */
export function TrendCard({
  trend,
  mesoNames,
  title,
  href,
  compact,
}: {
  trend: LongTermTrend;
  mesoNames: Map<string, string>;
  title?: string;
  href?: string;
  compact?: boolean;
}) {
  const r = (kg: number) => Math.round(toDisplay(kg));
  const slope = trend.slopePctPerMeso;
  const header = (
    <div className="flex items-center justify-between gap-2">
      <p className="min-w-0 truncate text-sm font-semibold">{title ?? "Tendencia entre mesos"}</p>
      <span className="flex shrink-0 items-center gap-1">
        {trend.plateauSuggested && <Badge tone="warning">techo sugerido</Badge>}
        {trend.approximate && <Badge>aproximado</Badge>}
        {slope !== null && (
          <span className="text-xs tabular-nums text-[var(--muted)]">
            {slope > 0 ? "+" : ""}
            {slope}%/meso
          </span>
        )}
      </span>
    </div>
  );
  if (compact) {
    return (
      <Card className="py-3">
        {href ? <Link href={href}>{header}</Link> : header}
        <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">
          {trend.points.map((p) => `${r(p.e1rmKg)}${p.countable && p.reliable ? "" : "*"}`).join(" → ")} {unitLabel()} (1RM est. por meso)
        </p>
      </Card>
    );
  }
  return (
    <Card className="mb-2">
      {header}
      <div className="mt-2 space-y-1.5">
        {trend.points.map((p) => (
          <div key={p.mesocycleId} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">
              {mesoNames.get(p.mesocycleId) ?? "Meso"}
              {p.intent !== "hypertrophy" && <span className="text-[var(--muted)]"> · {INTENT_LABELS[p.intent]}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
              {p.repBand && <span className="text-[var(--muted)]">{p.repBand.min}–{p.repBand.max}</span>}
              {!p.reliable && <Badge>no confiable</Badge>}
              {p.reliable && !p.countable && <Badge>no cuenta</Badge>}
              <span className="font-semibold">{r(p.e1rmKg)} {unitLabel()}</span>
            </span>
          </div>
        ))}
      </div>
      {trend.plateauSuggested && (
        <p className="mt-3 text-sm leading-relaxed">
          En {trend.flatMesos} mesos el 1RM estimado no subió y venís cerca del fallo. Puede ser el techo actual de
          este movimiento. Opciones: mantener la carga, rotar a una variante o seguir empujando. Vos decidís.
        </p>
      )}
      {trend.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
          {trend.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
