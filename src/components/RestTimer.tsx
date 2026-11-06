"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "./ui";

/**
 * Descanso (A1.4): cuenta REGRESIVA desde la última serie registrada hasta el
 * descanso objetivo del ejercicio. Se ancla a `lastSetAt` (persistido en la
 * sesión), así que sobrevive recargas. Al llegar a 0 vibra y, si el usuario dio
 * permiso de notificaciones en Ajustes, avisa. Nunca bloquea: se puede
 * registrar antes. ±15 s ajusta solo este descanso.
 */
export function RestTimer({
  lastSetAt,
  targetSec,
  minSec,
  nextLabel,
}: {
  lastSetAt?: string;
  targetSec: number;
  minSec: number;
  nextLabel?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [extra, setExtra] = useState(0);
  const notified = useRef<string | null>(null);

  // Cada serie nueva reinicia el ajuste manual.
  useEffect(() => setExtra(0), [lastSetAt]);

  useEffect(() => {
    if (!lastSetAt) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [lastSetAt]);

  const total = Math.max(0, targetSec + extra);
  const elapsed = lastSetAt ? Math.max(0, Math.floor((now - Date.parse(lastSetAt)) / 1000)) : 0;
  const remaining = total - elapsed;
  const done = !!lastSetAt && remaining <= 0;

  useEffect(() => {
    if (!done || !lastSetAt || notified.current === lastSetAt) return;
    // Solo si el descanso terminó hace poco (no al reabrir la sesión horas después).
    if (elapsed - total > 30) {
      notified.current = lastSetAt;
      return;
    }
    notified.current = lastSetAt;
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* sin vibración */
    }
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification("Descanso terminado", { body: nextLabel ? `Siguiente: ${nextLabel}` : undefined });
      }
    } catch {
      /* sin notificaciones */
    }
  }, [done, lastSetAt, elapsed, total, nextLabel]);

  const show = Math.abs(remaining);
  const mm = Math.floor(show / 60);
  const ss = show % 60;
  const belowMin = !!lastSetAt && !done && elapsed < minSec;

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-2 transition-colors",
        done ? "border-[var(--success)]/40 bg-[var(--success)]/10" : "border-[var(--border)] bg-[var(--surface-2)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[var(--muted)]">{!lastSetAt ? "Descanso" : done ? "Listo · pasó" : "Descanso"}</span>
        <span className={cn("font-mono text-lg tabular-nums", done && "text-[var(--success)]")}>
          {lastSetAt ? `${done ? "+" : ""}${mm}:${ss.toString().padStart(2, "0")}` : "—"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!lastSetAt}
            onClick={() => setExtra((e) => e - 15)}
            className="h-8 rounded-lg px-2 text-xs font-semibold text-[var(--muted)] disabled:opacity-40"
          >
            −15
          </button>
          <button
            type="button"
            disabled={!lastSetAt}
            onClick={() => setExtra((e) => e + 15)}
            className="h-8 rounded-lg px-2 text-xs font-semibold text-[var(--muted)] disabled:opacity-40"
          >
            +15
          </button>
        </div>
      </div>
      {lastSetAt && nextLabel && (
        <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
          Siguiente: {nextLabel}
          {belowMin && ` · mínimo sugerido ${minSec} s`}
        </p>
      )}
    </div>
  );
}
