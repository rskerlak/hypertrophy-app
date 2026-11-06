"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { mesocycleRepo, sessionRepo, settingsRepo } from "@/db/repositories";
import { recommendCalendarShift } from "@/domain/calendar";
import { daysBetween } from "@/domain/analytics";
import { Badge, Button, Card, EmptyState, HonestNote, PageHeader, cn } from "@/components/ui";
import { NewMesoButton } from "@/components/NewMesoSheet";
import { MonthGrid, sessionDate } from "@/components/MonthGrid";
import type { SessionRow } from "@/db/schema";
import { WEEKDAY_LETTERS, defaultWeekdays, todayIso } from "@/lib/agenda";

const WEEKDAYS = WEEKDAY_LETTERS;

export default function CalendarPage() {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const data = useLiveQuery(async () => {
    const meso = await mesocycleRepo.active();
    if (!meso) return { meso: null };
    const [sessions, settings] = await Promise.all([sessionRepo.forMesocycle(meso.id), settingsRepo.get()]);
    return { meso, sessions, settings };
  }, []);

  if (!data) return null;
  if (!data.meso) {
    return (
      <>
        <PageHeader title="Agenda" />
        <EmptyState title="Sin mesociclo activo" hint="Generá un meso para ver tu agenda." action={<NewMesoButton label="Nuevo meso" variant="primary" size="md" />} />
      </>
    );
  }

  const { meso, sessions, settings } = data;
  const daysPerWeek = meso.plan.weeks.find((w) => !w.isDeload)?.days.length ?? 1;
  const weekdays = settings.trainingWeekdays ?? defaultWeekdays(daysPerWeek);
  const byWeek = new Map<number, SessionRow[]>();
  for (const s of sessions) byWeek.set(s.weekIndex, [...(byWeek.get(s.weekIndex) ?? []), s]);
  const firstPending = sessions.find((s) => s.status === "pending");
  const today = todayIso();
  const scheduled = sessions.some((s) => !!s.plannedDate);
  const daysLate = firstPending?.plannedDate ? Math.max(0, daysBetween(firstPending.plannedDate, today)) : 0;
  const rec = recommendCalendarShift({ daysMissed: daysLate });

  return (
    <>
      <PageHeader title="Agenda" subtitle={meso.name} />

      {(!scheduled || editing) && (
        <ScheduleCard
          initialWeekdays={weekdays}
          onSave={async (start, days) => {
            await mesocycleRepo.schedule(meso.id, start, days);
            setEditing(false);
          }}
          onCancel={scheduled ? () => setEditing(false) : undefined}
        />
      )}

      {scheduled && daysLate > 0 && firstPending && (
        <Card className="mb-4 border-[var(--warning)]/40">
          <p className="text-sm font-medium">
            La próxima sesión estaba para hace {daysLate} {daysLate === 1 ? "día" : "días"}.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{rec.rationale}</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => mesocycleRepo.schedule(meso.id, today, weekdays)}
            >
              Correr agenda desde hoy
            </Button>
            {rec.action === "skip" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => confirm(`¿Saltar «${firstPending.dayLabel}»? Podés reabrirla después.`) && sessionRepo.skip(firstPending.id)}
              >
                Saltar esta
              </Button>
            )}
          </div>
        </Card>
      )}

      {scheduled && <MonthGrid sessions={sessions} today={today} onOpen={(s) => router.push(`/session?id=${s.id}`)} />}

      {scheduled && !editing && (
        <button type="button" className="mb-3 text-[11px] font-semibold text-[var(--primary)]" onClick={() => setEditing(true)}>
          Cambiar días o fecha de inicio ({weekdays.map((d) => WEEKDAYS[d]).join(" ")})
        </button>
      )}

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
                      today={today}
                      onOpen={() => router.push(`/session?id=${s.id}`)}
                      onSkip={() => confirm(`¿Saltar «${s.dayLabel}»? Podés reabrirla después.`) && sessionRepo.skip(s.id)}
                      onReopen={() => sessionRepo.reopen(s.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
      </div>

      <div className="mt-5">
        <HonestNote>
          La progresión avanza por <b>sesión completada</b>, no por fecha. Las fechas son solo agenda:
          si perdés un día, la sesión pendiente sigue siendo la misma.
        </HonestNote>
      </div>
    </>
  );
}

function ScheduleCard({
  initialWeekdays,
  onSave,
  onCancel,
}: {
  initialWeekdays: number[];
  onSave: (startIso: string, weekdays: number[]) => void;
  onCancel?: () => void;
}) {
  const [start, setStart] = useState(todayIso());
  const [days, setDays] = useState<number[]>(initialWeekdays);
  return (
    <Card className="mb-4">
      <p className="font-medium">Fechas de la agenda</p>
      <p className="mt-1 text-xs text-[var(--muted)]">Elegí qué días entrenás y desde cuándo. Se puede cambiar después.</p>
      <div className="mt-3 flex gap-1">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
            className={cn(
              "h-10 flex-1 rounded-xl border text-sm font-semibold",
              days.includes(d) ? "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)]" : "border-[var(--border)] text-[var(--muted)]",
            )}
            aria-pressed={days.includes(d)}
          >
            {WEEKDAYS[d]}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-xs text-[var(--muted)]">
        Empiezo el
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-[var(--foreground)]"
        />
      </label>
      <div className="mt-3 flex gap-2">
        {onCancel && (
          <Button size="sm" variant="secondary" className="flex-1" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button size="sm" className="flex-1" disabled={days.length === 0 || !start} onClick={() => onSave(start, days)}>
          Guardar fechas
        </Button>
      </div>
    </Card>
  );
}

function SessionCard({
  session,
  isNext,
  today,
  onOpen,
  onSkip,
  onReopen,
}: {
  session: SessionRow;
  isNext: boolean;
  today: string;
  onOpen: () => void;
  onSkip: () => void;
  onReopen: () => void;
}) {
  const statusBadge =
    session.status === "completed" ? (
      <Badge tone="success">Completada</Badge>
    ) : session.status === "skipped" ? (
      <Badge tone="neutral">Saltada</Badge>
    ) : session.startedAt ? (
      <Badge tone="warning">En curso</Badge>
    ) : isNext ? (
      <Badge tone="primary">Siguiente</Badge>
    ) : null;

  const date = sessionDate(session);
  const dateLabel = date
    ? new Date(`${date}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" })
    : null;

  return (
    <Card className={isNext ? "border-[var(--primary)]/50" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{session.dayLabel}</p>
          {dateLabel && (
            <p className={cn("text-xs", session.status === "pending" && date && date < today ? "text-[var(--warning)]" : "text-[var(--muted)]")}>
              {dateLabel}
              {session.status === "pending" && date === today ? " · hoy" : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{statusBadge}</div>
      </div>
      <div className="mt-3 flex gap-2">
        {session.status === "pending" && (
          <>
            <Button size="sm" variant={isNext || session.startedAt ? "primary" : "secondary"} className="flex-1" onClick={onOpen}>
              {session.startedAt ? "Continuar" : isNext ? "Empezar" : "Abrir"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip}>
              Saltar
            </Button>
          </>
        )}
        {session.status === "completed" && (
          <Button size="sm" variant="secondary" className="flex-1" onClick={onOpen}>
            Ver sesión
          </Button>
        )}
        {session.status === "skipped" && (
          <Button size="sm" variant="secondary" className="flex-1" onClick={onReopen}>
            Reabrir
          </Button>
        )}
      </div>
    </Card>
  );
}
