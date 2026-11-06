"use client";

import { BackupCard } from "@/components/BackupCard";
import { Button, Card } from "@/components/ui";

/**
 * Pantalla de error global (auditoría S-01): si una pantalla se rompe (por
 * ejemplo, por datos inválidos de un respaldo), el usuario conserva acceso a
 * exportar e importar sin tener que borrar los datos del sitio.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4 pt-4">
      <Card>
        <p className="font-semibold">Algo falló en esta pantalla</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          Tus datos siguen guardados en este dispositivo. Podés reintentar, volver al inicio o,
          si el problema vino de un respaldo, importar otro (la app guarda una copia previa antes
          de cada importación).
        </p>
        <p className="mt-2 break-words text-[11px] text-[var(--muted)]">{error.message}</p>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => reset()}>
            Reintentar
          </Button>
          <Button className="flex-1" onClick={() => location.assign("/")}>
            Ir al inicio
          </Button>
        </div>
      </Card>
      <BackupCard />
    </div>
  );
}
