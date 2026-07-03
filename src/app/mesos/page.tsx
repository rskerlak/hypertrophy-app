"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { mesocycleRepo, sessionRepo } from "@/db/repositories";
import { PROGRESSION_LABELS } from "@/lib/format";
import { Badge, Button, Card, EmptyState, HonestNote, PageHeader } from "@/components/ui";
import type { MesocycleRow } from "@/db/schema";

const STATUS_META: Record<
  MesocycleRow["status"],
  { label: string; tone: "primary" | "warning" | "success" | "neutral" }
> = {
  active: { label: "Activo", tone: "primary" },
  paused: { label: "En pausa", tone: "warning" },
  completed: { label: "Completado", tone: "success" },
  planned: { label: "Planificado", tone: "neutral" },
};

export default function MesosPage() {
  const router = useRouter();

  const data = useLiveQuery(async () => {
    const mesos = await mesocycleRepo.all();
    const progress = new Map<string, { done: number; total: number }>();
    for (const m of mesos) {
      const sessions = await sessionRepo.forMesocycle(m.id);
      progress.set(m.id, {
        done: sessions.filter((s) => s.status !== "pending").length,
        total: sessions.length,
      });
    }
    return { mesos, progress };
  }, []);

  if (!data) return null;
  const { mesos, progress } = data;

  const order: MesocycleRow["status"][] = ["active", "paused", "planned", "completed"];
  const sorted = [...mesos].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <>
      <PageHeader
        title="Mesociclos"
        subtitle="Todos tus ciclos"
        action={
          <Button size="sm" variant="secondary" onClick={() => router.push("/plan")}>
            + Nuevo
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          title="Sin mesociclos"
          hint="Generá tu primer meso desde el Plan."
          action={<Button onClick={() => router.push("/plan")}>Ir al Plan</Button>}
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((m) => {
            const p = progress.get(m.id) ?? { done: 0, total: 0 };
            const meta = STATUS_META[m.status];
            return (
              <Card key={m.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold">{m.name}</p>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {PROGRESSION_LABELS[m.progressionModel]} · {m.numAccumulationWeeks}+1 semanas ·{" "}
                  {p.done}/{p.total} sesiones
                  {m.continuedFromId && " · continuación"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.status === "active" && (
                    <>
                      <Button size="sm" className="flex-1" onClick={() => router.push("/")}>
                        Entrenar
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => mesocycleRepo.pause(m.id)}>
                        Pausar
                      </Button>
                    </>
                  )}
                  {(m.status === "paused" || m.status === "planned") && (
                    <Button size="sm" className="flex-1" onClick={() => mesocycleRepo.activate(m.id)}>
                      Reanudar
                    </Button>
                  )}
                  {m.status === "completed" && (
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={async () => {
                        await mesocycleRepo.createFollowUp(m.id);
                        router.push("/");
                      }}
                    >
                      Continuar progresión →
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => router.push(`/stats?meso=${m.id}`)}>
                    Stats
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`¿Eliminar "${m.name}" con todas sus sesiones y series? No se puede deshacer.`))
                        mesocycleRepo.remove(m.id);
                    }}
                  >
                    ✕
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <HonestNote>
          Pausar un meso congela su progresión donde quedó: al reanudarlo, la sesión N sigue siendo
          la N (la progresión avanza por sesión completada, no por fecha). «Continuar progresión»
          genera un bloque nuevo con la misma estructura, cargas heredadas de tu rendimiento real
          (sin contar el deload) y la rampa de volumen y RIR reiniciadas — el patrón
          acumulación + deload + acumulación.
        </HonestNote>
      </div>
    </>
  );
}
