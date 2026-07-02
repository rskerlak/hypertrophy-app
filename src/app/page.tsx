"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { mesocycleRepo, sessionRepo, settingsRepo } from "@/db/repositories";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { PROGRESSION_LABELS } from "@/lib/format";
import { Onboarding } from "@/components/Onboarding";

export default function HomePage() {
  const router = useRouter();

  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const data = useLiveQuery(async () => {
    const meso = await mesocycleRepo.active();
    if (!meso) return { meso: null };
    const sessions = await sessionRepo.forMesocycle(meso.id);
    const next = sessions.find((s) => s.status === "pending");
    const completed = sessions.filter((s) => s.status === "completed").length;
    return { meso, sessions, next, completed };
  }, []);

  if (!settings || !data) return null;

  if (!settings.onboarded) {
    return <Onboarding onDone={() => { /* useLiveQuery re-renderiza solo */ }} />;
  }

  if (!data.meso) {
    return (
      <>
        <PageHeader title="Hipertrofia" subtitle="Tu mesociclo, basado en evidencia." />
        <EmptyState
          title="Todavía no hay un mesociclo activo"
          hint="Definí tu semana base y generá tu primer mesociclo con rampa de volumen y deload."
          action={<Button onClick={() => router.push("/plan")}>Crear mi plan</Button>}
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
            Revisá tus estadísticas de calibración o generá el siguiente bloque.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => router.push(`/stats?meso=${meso.id}`)}>
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
      </div>
    </>
  );
}
