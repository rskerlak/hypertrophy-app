"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { mesocycleRepo, settingsRepo } from "@/db/repositories";
import { downloadBackup } from "@/lib/backup";
import { Card } from "@/components/ui";

const REMIND_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recordatorio de respaldo: aparece cuando hay datos que proteger (algún meso)
 * y hace más de 7 días que no se exporta un respaldo. Exporta con un tap y
 * desaparece solo (lastBackupAt es reactivo vía useLiveQuery).
 */
export function BackupPrompt() {
  const show = useLiveQuery(async () => {
    const settings = await settingsRepo.get();
    if (!settings.onboarded) return null;
    const mesos = await mesocycleRepo.all();
    if (mesos.length === 0) return null; // sin datos que valga la pena respaldar
    const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0;
    const days = Math.floor((Date.now() - last) / DAY_MS);
    if (days < REMIND_AFTER_DAYS) return null;
    return { neverBackedUp: !settings.lastBackupAt, days };
  }, []);

  if (!show) return null;

  return (
    <Card
      className="mb-4 border-[var(--warning)]/30 bg-[var(--warning)]/5"
      onClick={() => void downloadBackup()}
    >
      <p className="text-sm font-semibold text-[var(--warning)]">💾 Respaldo pendiente</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
        {show.neverBackedUp
          ? "Todavía no exportaste ningún respaldo. Tus datos viven solo en este dispositivo: tocá acá para descargar una copia completa."
          : `Hace ${show.days} días que no exportás un respaldo. Tocá acá para descargar una copia completa y guardala en la nube.`}
      </p>
    </Card>
  );
}
