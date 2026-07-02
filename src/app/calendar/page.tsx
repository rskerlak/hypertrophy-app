"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { mesocycleRepo, sessionRepo } from "@/db/repositories";
import { recommendCalendarShift } from "@/domain/calendar";
import { Badge, Button, Card, EmptyState, HonestNote, PageHeader } from "@/components/ui";
import type { SessionRow } from "@/db/schema";

export default function CalendarPage() {
  const router = useRouter();

  const data = useLiveQuery(async () => {
    const meso = await mesocycleRepo.active();
    if (!meso) return { meso: null };
    const sessions = await sessionRepo.forMesocycle(meso.id);
    return { meso, sessions };
  }, []);

  if (!data) return null;
  if (!data.meso) {
    return (
      <>
        <PageHeader title="Calendario" />
        <EmptyState title="Sin mesociclo activo" hint="Generá un plan para ver tu agenda." action={<Button onClick={() => router.push("/plan")}>Crear plan</Button>} />
      </>
    );
  }

  const { meso, sessions } = data;
  const byWeek = new Map<number, SessionRow[]>();
  for (const s of sessions) {
    const arr = byWeek.get(s.weekIndex) ?? [];
    arr.push(s);
    byWeek.set(s.weekIndex, arr);
  }
  const firstPending = sessions.find((s) => s.status === "pending");

  return (
    <>
      <PageHeader title="Calendario" subtitle={meso.name} />

      <div className="space-y-4">
        {[...byWeek.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([weekIndex, weekSessions]) => {
            const isDeloadWeek = weekSessions[0]?.isDeload;
            return (
              <div key={weekIndex}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[var(--muted)]">
                    {isDeloadWeek ? "Deload" : `Semana ${weekIndex + 1}`}
                  </h2>
                  {isDeloadWeek && <Badge tone="warning">Deload</Badge>}
                </div>
                <div className="space-y-2">
                  {weekSessions.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      isNext={s.id === firstPending?.id}
                      onOpen={() => router.push(`/session?id=${s.id}`)}
                      onSkip={() => sessionRepo.skip(s.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
      </div>

      <div className="mt-5">
        <HonestNote>
          La progresión avanza por <b>sesión completada</b>, no por fecha. Si perdés un día, la
          sesión pendiente sigue siendo la misma: corré la agenda sin perder estímulo.
        </HonestNote>
      </div>
    </>
  );
}

function SessionCard({
  session,
  isNext,
  onOpen,
  onSkip,
}: {
  session: SessionRow;
  isNext: boolean;
  onOpen: () => void;
  onSkip: () => void;
}) {
  const statusBadge =
    session.status === "completed" ? (
      <Badge tone="success">Completada</Badge>
    ) : session.status === "skipped" ? (
      <Badge tone="neutral">Saltada</Badge>
    ) : isNext ? (
      <Badge tone="primary">Siguiente</Badge>
    ) : null;

  // Recomendación de agenda (pura). Se muestra como pista neutral en la siguiente pendiente.
  const rec = isNext ? recommendCalendarShift({ daysMissed: 0 }) : null;

  return (
    <Card className={isNext ? "border-[var(--primary)]/50" : undefined}>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{session.dayLabel}</p>
          {rec && <p className="mt-0.5 text-xs text-[var(--muted)]">{rec.rationale}</p>}
        </div>
        <div className="flex items-center gap-2">{statusBadge}</div>
      </div>
      {session.status === "pending" && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1" onClick={onOpen}>
            {isNext ? "Empezar" : "Abrir"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Saltar
          </Button>
        </div>
      )}
    </Card>
  );
}
