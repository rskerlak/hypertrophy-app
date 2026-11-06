"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDialogStore } from "@/store/dialogs";
import { Button, cn } from "./ui";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hoja modal accesible (A4.6): `role="dialog"`, `aria-modal`, título enlazado,
 * Escape cierra, el foco queda atrapado adentro y vuelve al disparador al cerrar.
 */
export function Sheet({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (items.length === 0) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3" onClick={() => closeRef.current()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--pop-shadow)] outline-none",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p id={titleId} className="font-semibold">
            {title}
          </p>
          <button type="button" onClick={() => closeRef.current()} className="h-9 w-9 shrink-0 rounded-lg text-[var(--muted)]" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PromptField({ initial, onSubmit }: { initial: string; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      id="dialog-prompt-field"
      data-autofocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onSubmit(v)}
      className="mt-3 h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[15px] outline-none focus:border-[var(--primary)]"
    />
  );
}

/** Dibuja la cola de confirmaciones/avisos y los toasts. Montado una vez en AppProviders. */
export function DialogHost() {
  const queue = useDialogStore((s) => s.queue);
  const toasts = useDialogStore((s) => s.toasts);
  const settle = useDialogStore((s) => s.settle);
  const dismiss = useDialogStore((s) => s.dismissToast);
  const current = queue[0];

  return (
    <>
      {current && (
        <Sheet key={current.id} title={current.title ?? (current.kind === "alert" ? "Aviso" : "Confirmar")} onClose={() => settle(current.id, false)}>
          <p className="whitespace-pre-line text-sm leading-relaxed">{current.message}</p>
          {current.kind === "prompt" && <PromptField key={current.id} initial={current.initial ?? ""} onSubmit={(v) => settle(current.id, true, v)} />}
          <div className="mt-4 flex gap-2">
            {current.kind !== "alert" && (
              <Button variant="secondary" className="flex-1" onClick={() => settle(current.id, false)}>
                {current.cancelLabel ?? "Cancelar"}
              </Button>
            )}
            <Button
              data-autofocus={current.danger ? undefined : true}
              variant={current.danger ? "danger" : "primary"}
              className="flex-1"
              onClick={() => {
                const field = document.getElementById("dialog-prompt-field") as HTMLInputElement | null;
                settle(current.id, true, field?.value);
              }}
            >
              {current.confirmLabel ?? (current.kind === "alert" ? "Entendido" : "Confirmar")}
            </Button>
          </div>
        </Sheet>
      )}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex flex-col items-center gap-2 px-3" aria-live="polite" role="status">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={cn(
              "pointer-events-auto max-w-md rounded-2xl border px-4 py-2.5 text-sm shadow-[var(--pop-shadow)]",
              t.tone === "success"
                ? "border-[var(--success)]/30 bg-[var(--surface)] text-[var(--success)]"
                : t.tone === "danger"
                  ? "border-[var(--danger)]/30 bg-[var(--surface)] text-[var(--danger-ink)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
            )}
          >
            {t.message}
          </button>
        ))}
      </div>
    </>
  );
}
