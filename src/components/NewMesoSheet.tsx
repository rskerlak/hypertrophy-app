"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { baseWeekRepo } from "@/db/repositories";
import { ROUTINE_TEMPLATES } from "@/lib/templates";
import { Button, cn } from "./ui";

/**
 * Cómo arrancar un meso nuevo: de cero, desde la semana base actual o desde una
 * rutina precargada. En todos los casos lleva al Plan para editar y generar.
 * Los mesos ya generados nunca cambian (tienen su propio plan).
 */
export function NewMesoButton({
  label = "+ Nuevo",
  size = "sm",
  variant = "secondary",
  className,
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <NewMesoSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function NewMesoSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const baseWeek = useLiveQuery(() => baseWeekRepo.get(), []);
  const [busy, setBusy] = useState(false);
  const hasBase = (baseWeek?.days.length ?? 0) > 0;
  const days = baseWeek?.days.length ?? 0;
  const exercises = baseWeek?.days.reduce((n, d) => n + d.slots.length, 0) ?? 0;

  const go = () => {
    onClose();
    router.push("/plan");
  };
  const confirmReplace = () =>
    !hasBase || confirm("Esto reemplaza tu semana base actual (tus mesos ya generados no cambian). ¿Seguir?");

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 p-3" role="dialog" aria-modal aria-label="Nuevo mesociclo" onClick={onClose}>
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--pop-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <p className="font-semibold">Nuevo mesociclo</p>
          <button type="button" onClick={onClose} className="px-2 text-[var(--muted)]" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Elegí cómo arrancar. Después editás todo en el Plan y tocás «Generar mesociclo».
        </p>

        {hasBase && (
          <Option
            title="Desde mi semana actual"
            hint={`${days} días · ${exercises} ejercicios, tal como los dejaste.`}
            disabled={busy}
            onClick={go}
          />
        )}

        <Option
          title="De cero"
          hint="Semana vacía: agregás días y ejercicios a mano."
          disabled={busy}
          onClick={async () => {
            if (!confirmReplace()) return;
            setBusy(true);
            await baseWeekRepo.set({ days: [] });
            go();
          }}
        />

        <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Rutinas precargadas</p>
        {ROUTINE_TEMPLATES.map((t) => (
          <Option
            key={t.id}
            title={t.name}
            hint={`${t.days.length} días · ${t.days.reduce((n, d) => n + d.slots.length, 0)} ejercicios. ${t.description}`}
            disabled={busy}
            onClick={async () => {
              if (!confirmReplace()) return;
              setBusy(true);
              const r = await baseWeekRepo.applyTemplate(
                t.days.map((d) => ({ ...d, slots: d.slots.map((s) => ({ ...s, repRange: { ...s.repRange } })) })),
              );
              if (r.estimated > 0) {
                alert(
                  `Rutina cargada para editar. ${r.estimated} carga${r.estimated === 1 ? "" : "s"} estimada${r.estimated === 1 ? "" : "s"} desde tu historial real${r.kept > 0 ? `; ${r.kept} sin historial quedaron como en la plantilla` : ""}. Revisalas antes de generar.`,
                );
              }
              go();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Option({ title, hint, onClick, disabled }: { title: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mb-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-left transition active:scale-[0.99] disabled:opacity-50",
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{hint}</p>
    </button>
  );
}
