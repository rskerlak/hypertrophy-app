"use client";

import { useRef, useState } from "react";
import { backupRepo } from "@/db/repositories";
import { downloadBackup } from "@/lib/backup";
import { DATA_LIMITS, validateBackup } from "@/db/backupSchema";
import { Button, Card } from "@/components/ui";
import { askConfirm, showAlert } from "@/store/dialogs";

/**
 * Respaldo completo en JSON: exportar descarga todos los datos locales;
 * importar los REEMPLAZA (sirve también para migrar entre dispositivos).
 */
export function BackupCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const doExport = async () => {
    await downloadBackup();
    setMsg("Respaldo descargado.");
  };

  const doImport = async (file: File) => {
    try {
      if (file.size > DATA_LIMITS.maxFileBytes) {
        throw new Error(`El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB: un respaldo real pesa pocos MB. No se importó nada.`);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error("El archivo no es JSON válido.");
      }
      // Validar antes de preguntar: un archivo roto no debe llegar a borrar nada.
      const v = validateBackup(raw);
      if (!v.ok) throw new Error(v.error);
      const n = v.backup.data.sessions.filter((s) => s.status === "completed").length;
      if (
        !(await askConfirm({
          title: "Importar respaldo",
          message:
            `El respaldo tiene ${v.backup.data.mesocycles.length} mesos y ${n} sesiones completadas.\n\n` +
            "Va a REEMPLAZAR todos los datos de este dispositivo. Antes se descarga automáticamente una copia de lo actual.",
          confirmLabel: "Importar",
          danger: true,
        }))
      )
        return;
      // A4.1: copia automática del estado actual antes de reemplazarlo.
      await downloadBackup("myonoesis-pre-import");
      await backupRepo.import(raw);
      await showAlert({ title: "Listo", message: "Respaldo importado correctamente. La app se recarga." });
      location.reload();
    } catch (e) {
      await showAlert({ title: "No se importó nada", message: e instanceof Error ? e.message : "No se pudo leer el archivo de respaldo." });
    }
  };

  return (
    <Card className="space-y-3">
      <div>
        <p className="font-medium">Respaldo de datos</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Tus datos viven solo en este dispositivo. Exportá un respaldo para guardarlos o pasarlos
          a otro dispositivo (importalo allá). El respaldo lleva TODO: entrenamientos, medidas,
          check-ins, notas y bugs anotados; compartilo solo con quien quieras.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onClick={doExport}>
          Exportar respaldo
        </Button>
        <Button size="sm" variant="secondary" className="flex-1" onClick={() => fileRef.current?.click()}>
          Importar respaldo
        </Button>
      </div>
      {msg && <p className="text-xs text-[var(--success)]">{msg}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void doImport(f);
          e.target.value = "";
        }}
      />
    </Card>
  );
}
