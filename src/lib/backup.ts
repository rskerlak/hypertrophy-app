// Descarga del respaldo completo en JSON y registro de la fecha del último
// respaldo (alimenta el recordatorio de Home).

import { backupRepo, settingsRepo } from "@/db/repositories";

/**
 * Descarga el respaldo completo. `prefix` distingue el respaldo automático
 * previo a importar (`myonoesis-pre-import-…`) del manual.
 */
export async function downloadBackup(prefix = "myonoesis-respaldo"): Promise<void> {
  const backup = await backupRepo.export();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const stamp = prefix === "myonoesis-respaldo" ? backup.exportedAt.slice(0, 10) : backup.exportedAt.slice(0, 19).replace(/[:T]/g, "-");
  a.download = `${prefix}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  await settingsRepo.update({ lastBackupAt: backup.exportedAt });
}
