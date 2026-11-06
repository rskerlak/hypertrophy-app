"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import type { SessionRow } from "@/db/schema";

const HEAD = ["L", "M", "X", "J", "V", "S", "D"];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Fecha que se muestra para una sesión: la real si se completó, si no la agendada. */
export function sessionDate(s: SessionRow): string | undefined {
  return s.status === "completed" && s.completedAt ? s.completedAt.slice(0, 10) : s.plannedDate?.slice(0, 10);
}

/**
 * Vista mensual de la agenda (A3.2). Solo visualización: tocar un día con
 * sesión la abre. La progresión no depende de las fechas.
 */
export function MonthGrid({
  sessions,
  today,
  onOpen,
}: {
  sessions: SessionRow[];
  today: string;
  onOpen: (s: SessionRow) => void;
}) {
  const [cursor, setCursor] = useState(() => ({ y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 }));
  const byDate = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const d = sessionDate(s);
    if (d) byDate.set(d, [...(byDate.get(d) ?? []), s]);
  }
  const first = new Date(cursor.y, cursor.m, 1);
  const offset = (first.getDay() + 6) % 7; // lunes primero
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const move = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };
  const raw = first.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);

  return (
    <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Mes anterior" className="h-8 w-8 rounded-lg text-lg text-[var(--muted)]" onClick={() => move(-1)}>
          ‹
        </button>
        <p className="text-sm font-semibold">{title}</p>
        <button type="button" aria-label="Mes siguiente" className="h-8 w-8 rounded-lg text-lg text-[var(--muted)]" onClick={() => move(1)}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {HEAD.map((h) => (
          <span key={h} className="text-[10px] font-semibold text-[var(--muted)]">
            {h}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const key = iso(cursor.y, cursor.m, d);
          const list = byDate.get(key) ?? [];
          const s = list[0];
          const tone = !s
            ? ""
            : s.status === "completed"
              ? "bg-[var(--success)]/15 text-[var(--success)]"
              : s.status === "skipped"
                ? "bg-[var(--surface-2)] text-[var(--muted)] line-through"
                : s.isDeload
                  ? "bg-[var(--warning)]/15 text-[var(--warning)]"
                  : "bg-[var(--primary)]/12 text-[var(--primary-ink)]";
          return (
            <button
              key={key}
              type="button"
              disabled={!s}
              onClick={() => s && onOpen(s)}
              aria-label={s ? `${key}: ${list.map((x) => x.dayLabel).join(", ")}` : key}
              className={cn(
                "flex h-9 items-center justify-center rounded-lg text-xs tabular-nums",
                tone,
                key === today && "ring-1 ring-[var(--foreground)]/40",
                !s && "text-[var(--muted)]/70",
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
