"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { settingsRepo } from "@/db/repositories";
import { normalizeProfiles } from "@/lib/equipmentProfiles";
import { askConfirm, askText, showToast } from "@/store/dialogs";
import { cn } from "./ui";

/**
 * Selector de perfil de gimnasio (A4.5). En Ajustes permite crear, renombrar y
 * borrar; en la sesión (`compact`) solo elegir "hoy entreno en…".
 */
export function EquipmentProfilePicker({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  if (!settings) return null;
  const { profiles, activeId } = normalizeProfiles(settings);
  if (compact && profiles.length < 2) return null;

  const pick = async (id: string) => {
    if (id === activeId) return;
    await settingsRepo.switchEquipmentProfile(id);
    onChanged?.();
    if (compact) showToast(`Cargas redondeadas al equipo de «${profiles.find((p) => p.id === id)?.name}».`);
  };

  const add = async () => {
    const name = await askText({ title: "Nuevo perfil", message: "Nombre del lugar (ej. Casa, Hotel). Arranca como copia del inventario actual.", confirmLabel: "Crear" });
    if (name === null) return;
    await settingsRepo.addEquipmentProfile(name);
    showToast("Perfil creado como copia del actual. Ajustá su inventario abajo.", "success");
  };
  const rename = async () => {
    const current = profiles.find((p) => p.id === activeId);
    const name = await askText({ title: "Renombrar perfil", message: "Nuevo nombre:", initial: current?.name ?? "", confirmLabel: "Guardar" });
    if (name === null) return;
    await settingsRepo.renameEquipmentProfile(activeId, name);
  };
  const remove = async () => {
    const current = profiles.find((p) => p.id === activeId);
    if (!(await askConfirm({ message: `¿Borrar el perfil «${current?.name}»?`, confirmLabel: "Borrar", danger: true }))) return;
    await settingsRepo.removeEquipmentProfile(activeId);
  };

  return (
    <div className="mb-3">
      {compact && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Hoy entreno en</p>}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Perfil de gimnasio">
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === activeId}
            onClick={() => pick(p.id)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm font-semibold",
              p.id === activeId ? "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary-ink)]" : "border-[var(--border)] text-[var(--muted)]",
            )}
          >
            {p.name}
          </button>
        ))}
        {!compact && (
          <button type="button" onClick={add} className="h-9 rounded-full border border-dashed border-[var(--border)] px-3.5 text-sm text-[var(--muted)]">
            + Perfil
          </button>
        )}
      </div>
      {!compact && (
        <div className="mt-2 flex gap-3 text-[11px] font-semibold">
          <button type="button" className="text-[var(--primary-ink)]" onClick={rename}>
            Renombrar
          </button>
          {profiles.length > 1 && (
            <button type="button" className="text-[var(--danger-ink)]" onClick={remove}>
              Borrar perfil
            </button>
          )}
        </div>
      )}
    </div>
  );
}
