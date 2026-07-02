"use client";

import { useRef, useState } from "react";
import { backupRepo } from "@/db/repositories";
import { Button, Card } from "@/components/ui";

/**
 * Respaldo completo en JSON: exportar descarga todos los datos locales;
 * importar los REEMPLAZA (sirve también para migrar entre dispositivos).
 */
export function BackupCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const doExport = async () => {
    const backup = await backupRepo.export();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hipertrofia-respaldo-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg("Respaldo descargado.");
  };

  const doImport = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text());
      if (
        !confirm(
          "Esto REEMPLAZA todos los datos actuales de este dispositivo por los del respaldo. ¿Continuar?",
        )
      )
        return;
      await backupRepo.import(raw);
      alert("Respaldo importado correctamente.");
      location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo leer el archivo de respaldo.");
    }
  };

  return (
    <Card className="space-y-3">
      <div>
        <p className="font-medium">Respaldo de datos</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Tus datos viven solo en este dispositivo. Exportá un respaldo para guardarlos o pasarlos
          a otro dispositivo (importalo allá).
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
