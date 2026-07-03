"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { mesocycleRepo, sessionRepo, settingsRepo } from "@/db/repositories";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { PROGRESSION_LABELS } from "@/lib/format";
import { Onboarding } from "@/components/Onboarding";
import { MeasurementPrompt } from "@/components/MeasurementPrompt";
import { BackupPrompt } from "@/components/BackupPrompt";

export default function HomePage() {
  const router = useRouter();

  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const data = useLiveQuery(async () => {
    const all = await mesocycleRepo.all();
    const paused = all.filter((m) => m.status === "paused");
    const lastCompleted = all.find((m) => m.status === "completed");
    const meso = all.find((m) => m.status === "active") ?? null;
    if (!meso) return { meso: null, paused, lastCompleted };
    const sessions = await sessionRepo.forMesocycle(meso.id);
    const next = sessions.find((s) => s.status === "pending");
    const completed = sessions.filter((s) => s.status === "completed").length;
    return { meso, sessions, next, completed, paused, lastCompleted };
  }, []);

  if (!settings || !data) return null;

  if (!settings.onboarded) {
    return <Onboarding onDone={() => { /* useLiveQuery re-renderiza solo */ }} />;
  }

  if (!data.meso) {
    return (
      <>
        <PageHeader title="Hipertrofia" subtitle="Tu mesociclo, basado en evidencia." />
        <MeasurementPrompt />
        <BackupPrompt />

        {data.paused.length > 0 && (
          <div className="mb-4 space-y-2">
            {data.paused.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-[var(--muted)]">En pausa · tocá para reanudar</p>
                </div>
                <Button size="sm" onClick={() => mesocycleRepo.activate(p.id)}>
                  Reanudar
                </Button>
              </Card>
            ))}
          </div>
        )}

        {data.lastCompleted && (
          <Card className="mb-4">
            <p className="font-medium">Continuar «{data.lastCompleted.name}»</p>
            <p className="mt-1 mb-3 text-xs text-[var(--muted)]">
              Nuevo bloque con la misma estructura y cargas heredadas de tu rendimiento real.
            </p>
            <Button
              size="sm"
              className="w-full"
              onClick={() => mesocycleRepo.createFollowUp(data.lastCompleted!.id)}
            >
              Continuar progresión →
            </Button>
          </Card>
        )}

        <EmptyState
          title="Sin mesociclo activo"
          hint="Definí tu semana base y generá un mesociclo nuevo, o reanudá uno existente."
          action={
            <div className="flex gap-2">
              <Button onClick={() => router.push("/plan")}>Crear plan</Button>
              <Button variant="secondary" onClick={() => router.push("/mesos")}>
                Mis mesociclos
              </Button>
            </div>
          }
        />
      </>
    );
  }

  const { meso, sessions, next, completed } = data;
  const total = sessions.length;
  const week = next ? next.weekIndex + 1 : meso.numAccumulationWeeks + 1;
  const totalWeeks = meso.numAccumulationWeeks + meso.deloadWeeks;

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={meso.name}
        action={<Badge tone="primary">{PROGRESSION_LABELS[meso.progressionModel]}</Badge>}
      />

      <MeasurementPrompt />
      <BackupPrompt />

      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between text-sm text-[var(--muted)]">
          <span>Progreso del mesociclo</span>
          <span className="tabular-nums">
            {completed}/{total} sesiones
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-all"
            style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-[var(--muted)]">
          Semana {Math.min(week, totalWeeks)} de {totalWeeks}
          {next?.isDeload && " · deload"}
        </div>
      </Card>

      {next ? (
        <Card className="mb-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm text-[var(--muted)]">Siguiente sesión</span>
            {next.isDeload && <Badge tone="warning">Deload</Badge>}
          </div>
          <p className="mb-4 text-xl font-semibold">{next.dayLabel}</p>
          <Button className="w-full" size="lg" onClick={() => router.push(`/session?id=${next.id}`)}>
            Empezar entrenamiento
          </Button>
        </Card>
      ) : (
        <Card className="mb-4">
          <p className="mb-3 font-medium">Mesociclo completado 🎉</p>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Podés continuar la progresión con un bloque nuevo (misma estructura, cargas heredadas
            de tu rendimiento), revisar tus stats, o armar un meso distinto.
          </p>
          <Button
            className="mb-2 w-full"
            onClick={async () => {
              await mesocycleRepo.createFollowUp(meso.id);
              router.refresh();
            }}
          >
            Continuar progresión →
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => router.push(`/stats?meso=${meso.id}`)}>
              Ver stats
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => router.push("/plan")}>
              Nuevo meso
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/calendar">
          <Card className="h-full">
            <p className="text-sm text-[var(--muted)]">Calendario</p>
            <p className="mt-1 font-medium">Ver agenda</p>
          </Card>
        </Link>
        <Link href="/stats">
          <Card className="h-full">
            <p className="text-sm text-[var(--muted)]">Estadísticas</p>
            <p className="mt-1 font-medium">Calibración</p>
          </Card>
        </Link>
        <Link href="/activities">
          <Card className="h-full">
            <p className="text-sm text-[var(--muted)]">Extra</p>
            <p className="mt-1 font-medium">🏃 Actividades</p>
          </Card>
        </Link>
        <Link href="/measurements">
          <Card className="h-full">
            <p className="text-sm text-[var(--muted)]">Cuerpo</p>
            <p className="mt-1 font-medium">📏 Medidas</p>
          </Card>
        </Link>
        <Link href="/mesos" className="col-span-2">
          <Card>
            <p className="text-sm text-[var(--muted)]">Historial y pausados</p>
            <p className="mt-1 font-medium">📚 Mis mesociclos</p>
          </Card>
        </Link>
      </div>
    </>
  );
}
