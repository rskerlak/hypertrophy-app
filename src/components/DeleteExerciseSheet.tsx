"use client";

import { useEffect, useMemo, useState } from "react";
import { exerciseRepo } from "@/db/repositories";
import { EQUIPMENT_LABELS } from "@/lib/format";
import { showToast } from "@/store/dialogs";
import type { Exercise } from "@/domain/types";
import { Sheet } from "./Dialog";
import { Button, Input, cn } from "./ui";

type Usage = Awaited<ReturnType<typeof exerciseRepo.usage>>;

/**
 * Borrado seguro de un ejercicio (A4.2). Si está en la semana base o en el plan
 * de un meso no terminado, obliga a elegir un reemplazo: borrarlo en silencio
 * dejaría slots apuntando a un ejercicio inexistente. El historial se conserva.
 */
export function DeleteExerciseSheet({
  exercise,
  all,
  onClose,
}: {
  exercise: Exercise;
  all: Exercise[];
  onClose: () => void;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [q, setQ] = useState("");
  const [replacement, setReplacement] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void exerciseRepo.usage(exercise.id).then(setUsage);
  }, [exercise.id]);

  // Candidatos: mismo músculo primero (sus swapCandidates antes), estirado antes.
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rank = (e: Exercise) =>
      (exercise.swapCandidates.includes(e.id) ? 0 : 2) + (e.primaryMuscle === exercise.primaryMuscle ? 0 : 4) + (e.resistanceProfile === "stretch" ? 0 : 1);
    return all
      .filter((e) => e.id !== exercise.id)
      .filter((e) => (term ? e.name.toLowerCase().includes(term) : e.primaryMuscle === exercise.primaryMuscle))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 30);
  }, [all, exercise, q]);

  if (!usage) return null;
  const inUse = usage.mesos.length > 0 || usage.baseWeekSlots > 0;

  const run = async () => {
    setBusy(true);
    try {
      if (inUse) await exerciseRepo.replaceAndRemove(exercise.id, replacement!);
      else await exerciseRepo.remove(exercise.id);
      showToast(inUse ? "Ejercicio reemplazado y eliminado." : "Ejercicio eliminado.", "success");
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo eliminar.", "danger");
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Eliminar «${exercise.name}»`} onClose={onClose}>
      {inUse ? (
        <>
          <p className="text-sm leading-relaxed">
            Está en uso
            {usage.baseWeekSlots > 0 && <> en tu semana base ({usage.baseWeekSlots} {usage.baseWeekSlots === 1 ? "vez" : "veces"})</>}
            {usage.baseWeekSlots > 0 && usage.mesos.length > 0 && " y"}
            {usage.mesos.length > 0 && (
              <> en {usage.mesos.map((m) => `«${m.name}»${m.status === "active" ? " (activo)" : m.status === "paused" ? " (en pausa)" : ""}`).join(", ")}</>
            )}
            . Elegí con qué reemplazarlo ahí; después se elimina.
          </p>
          <Input className="mt-3" placeholder="Buscar otro ejercicio…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Reemplazo">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={replacement === c.id}
                onClick={() => setReplacement(c.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm",
                  replacement === c.id ? "border-[var(--primary)]/60 bg-[var(--primary)]/10" : "border-[var(--border)]",
                )}
              >
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {EQUIPMENT_LABELS[c.equipmentType]}
                  {c.resistanceProfile === "stretch" ? " · estiramiento" : ""}
                </span>
              </button>
            ))}
            {candidates.length === 0 && <p className="py-2 text-sm text-[var(--muted)]">Sin resultados.</p>}
          </div>
        </>
      ) : (
        <p className="text-sm leading-relaxed">No está en tu semana base ni en ningún meso sin terminar.</p>
      )}
      {usage.loggedSets > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          Tu historial ({usage.loggedSets} series) se conserva y en Stats aparecerá como «(ejercicio eliminado)».
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="danger" className="flex-1" disabled={busy || (inUse && !replacement)} onClick={run}>
          {inUse ? "Reemplazar y eliminar" : "Eliminar"}
        </Button>
      </div>
    </Sheet>
  );
}
