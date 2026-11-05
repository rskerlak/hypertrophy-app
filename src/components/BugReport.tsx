"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { bugReportRepo } from "@/db/repositories";
import type { BugReportRow } from "@/db/schema";
import { Badge, Button, Card, cn } from "./ui";
import { ZodError } from "zod";

const CATEGORY_LABELS: Record<BugReportRow["category"], string> = {
  engine: "Motor / prescripción",
  ui: "Pantalla / botones",
  data: "Datos / respaldo",
  other: "Otro",
};

const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";

/** Contexto técnico que ayuda a reproducir el bug (pantalla, PWA, navegador). */
function captureContext() {
  const vv = window.visualViewport;
  return {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    visualViewport: vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : undefined,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    userAgent: navigator.userAgent.slice(0, 400),
  };
}

/**
 * Botón chico para anotar un bug desde cualquier pantalla. Guarda la ruta
 * actual (incluida la sesión), el meso activo y la versión del build; todo
 * viaja en el respaldo JSON para reproducirlo después.
 */
export function BugReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Anotar un bug"
        title="Anotar un bug"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] active:text-[var(--foreground)]"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 9C4.6 8.8 3 7.2 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M17.5 9C19.4 8.8 21 7.2 21 5M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4" />
        </svg>
      </button>
      {open && <BugReportSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function BugReportSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<BugReportRow["category"]>("engine");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    try {
      await bugReportRepo.add({
        text,
        category,
        route: window.location.pathname + window.location.search,
        buildSha: BUILD_SHA,
        context: captureContext(),
      });
      setSaved(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e instanceof ZodError ? e.issues[0]?.message ?? "Dato inválido." : "No se pudo guardar.");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 p-3" role="dialog" aria-modal aria-label="Anotar un bug" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--pop-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold">Anotar un bug</p>
          <button type="button" onClick={onClose} className="px-2 text-[var(--muted)]" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CATEGORY_LABELS) as BugReportRow["category"][]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                category === c
                  ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "border-[var(--border)] text-[var(--muted)]",
              )}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          rows={4}
          maxLength={2000}
          placeholder="Qué pasó y qué esperabas. Ej: puse rango 10–12 y me pidió 14 reps en laterales."
          className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--primary)]/50"
        />
        <p className="text-[11px] leading-relaxed text-[var(--muted)]">
          Se guarda con la pantalla actual, el meso activo y la versión de la app. Viaja en el
          respaldo JSON (Ajustes → Exportar respaldo).
        </p>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <Button className="w-full" onClick={save} disabled={saved}>
          {saved ? "✓ Guardado" : "Guardar bug"}
        </Button>
      </div>
    </div>
  );
}

/** Lista de bugs anotados (Ajustes): marcar resuelto o borrar. */
export function BugListCard() {
  const bugs = useLiveQuery(() => bugReportRepo.all(), []);
  if (!bugs) return null;
  const open = bugs.filter((b) => b.status === "open").length;

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Bugs anotados</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            {bugs.length === 0
              ? "Todavía no anotaste ninguno. Usá el botón del bicho arriba a la derecha de cada pantalla."
              : `${open} abierto${open === 1 ? "" : "s"} de ${bugs.length}. Se incluyen al exportar el respaldo.`}
          </p>
        </div>
        <BugReportButton />
      </div>
      {bugs.map((b) => (
        <div key={b.id} className={cn("rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-3", b.status === "resolved" && "opacity-60")}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <Badge tone={b.status === "open" ? "warning" : "success"}>
              {b.status === "open" ? "abierto" : "resuelto"}
            </Badge>
            <span className="text-[11px] tabular-nums text-[var(--muted)]">
              {new Date(b.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>
          <p className={cn("text-sm", b.status === "resolved" && "line-through")}>{b.text}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {CATEGORY_LABELS[b.category]} · {b.context.sessionDayLabel ?? b.route} · v{b.buildSha}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => bugReportRepo.setStatus(b.id, b.status === "open" ? "resolved" : "open")}
            >
              {b.status === "open" ? "Marcar resuelto" : "Reabrir"}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => confirm("¿Borrar este bug?") && bugReportRepo.remove(b.id)}
            >
              ✕
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
