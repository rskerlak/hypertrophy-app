// Descarga del respaldo completo en JSON y registro de la fecha del último
// respaldo (alimenta el recordatorio de Home).

import { backupRepo, settingsRepo } from "@/db/repositories";

export async function downloadBackup(): Promise<void> {
  const backup = await backupRepo.export();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hipertrofia-respaldo-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  await settingsRepo.update({ lastBackupAt: backup.exportedAt });
}
