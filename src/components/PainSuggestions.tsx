"use client";

import { useEffect, useState } from "react";
import { sessionRepo, settingsRepo } from "@/db/repositories";
import { painStatus, type PainStatus } from "@/lib/pain";
import { PAIN_OPTION_LABELS, PAIN_ZONE_LABELS } from "@/lib/format";
import { getRules } from "@/lib/rulesLoader";
import type { PainOption } from "@/domain/pain";
import { Badge, Button, Card, HonestNote } from "./ui";

const shortName = (n: string) => n.replace(/\s*\(.*\)$/, "");

/**
 * Propuestas por dolor articular/tendinoso (A5.5): por ejercicio que carga la
 * zona, opciones para seguir entrenando con menos carga. Aceptar, elegir otra
 * opción o descartar. Nunca diagnostica ni bloquea.
 */
export function PainSuggestions({ mesocycleId, collapsed = false }: { mesocycleId: string; collapsed?: boolean }) {
  const [status, setStatus] = useState<PainStatus | null>(null);
  const [choice, setChoice] = useState<Record<string, PainOption>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  // UX-A5-04: en Home arranca plegada para no empujar "Empezar" fuera de la pantalla.
  const [open, setOpen] = useState(!collapsed);
  const rules = getRules();

  useEffect(() => {
    painStatus(mesocycleId).then(setStatus);
  }, [mesocycleId]);

  if (!status) return null;
  const actZones = status.signal.zones.filter((z) => z.level === "act");
  if (status.items.length === 0 && !status.signal.persistent) return null;

  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="warning">Dolor</Badge>
        <span className="text-xs text-[var(--muted)]">{actZones.map((z) => `${PAIN_ZONE_LABELS[z.zone]} ${z.latestScore}/10`).join(" · ")}</span>
      </div>
      {!open && (
        <Button size="md" variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          Ver opciones ({status.items.length})
        </Button>
      )}
      {open && actZones.length > 0 && (
        <p className="mb-3 text-sm leading-relaxed">
          Registrás dolor en {actZones.map((z) => PAIN_ZONE_LABELS[z.zone].toLowerCase()).join(" y ")}
          {actZones[0].consecutiveSessions > 1 ? ` desde hace ${actZones[0].consecutiveSessions} sesiones` : ""}. Esto no es un
          diagnóstico. Podés seguir entrenando con menos carga en los ejercicios que cargan esa zona:
        </p>
      )}
      {open && (
      <div className="space-y-3">
        {(showAll ? status.items : status.items.slice(0, 3)).map((it) => {
          const key = `${it.exerciseId}|${it.zone}`;
          const sel = choice[key] ?? it.options[0];
          if (done[key]) {
            return (
              <p key={key} className="rounded-lg bg-[var(--surface-2)] p-3 text-sm">
                {shortName(it.exerciseName)}: {done[key]}
              </p>
            );
          }
          return (
            <div key={key} className="rounded-lg bg-[var(--surface-2)] p-3">
              <p className="mb-2 text-sm font-medium">
                {shortName(it.exerciseName)} <span className="font-normal text-[var(--muted)]">· {PAIN_ZONE_LABELS[it.zone]}</span>
              </p>
              <fieldset className="space-y-1">
                <legend className="sr-only">Opciones para {shortName(it.exerciseName)}</legend>
                {it.options.map((o) => (
                  <label key={o} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="radio" name={key} checked={sel === o} onChange={() => setChoice({ ...choice, [key]: o })} />
                    <span>
                      {PAIN_OPTION_LABELS[o]}
                      {o === "swap-candidate" && it.swapCandidateName ? `: ${shortName(it.swapCandidateName)}` : ""}
                      {/* UX-A5-13: una línea de evidencia por opción. */}
                      <span className="block text-[11px] text-[var(--muted)]">{optionHint(o, rules)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="mt-2 flex gap-2">
                <Button
                  size="md"
                  className="flex-1"
                  onClick={async () => {
                    const n = await sessionRepo.applyPainOption(mesocycleId, it.exerciseId, sel, it.zone, it.swapCandidateId);
                    // UX-A5-03: lo aplicado no se vuelve a ofrecer en la misma racha.
                    if (n > 0) await settingsRepo.dismissPain(it.exerciseId, it.zone);
                    setDone({
                      ...done,
                      [key]: n > 0 ? `aplicado a ${n === 1 ? "la próxima sesión" : `las próximas ${n} sesiones`} con este ejercicio.` : "no quedan sesiones pendientes con este ejercicio.",
                    });
                  }}
                >
                  Aplicar
                </Button>
                <Button
                  size="md"
                  variant="secondary"
                  className="flex-1"
                  onClick={async () => {
                    await settingsRepo.dismissPain(it.exerciseId, it.zone);
                    setDone({ ...done, [key]: "descartado; no te lo vuelvo a proponer mientras dure esta racha." });
                  }}
                >
                  Descartar
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      )}
      {open && !showAll && status.items.length > 3 && (
        <Button size="md" variant="secondary" className="mt-2 w-full" onClick={() => setShowAll(true)}>
          Ver todos ({status.items.length})
        </Button>
      )}
      {open && (
      <div className="mt-3">
        <HonestNote>
          {status.signal.persistent
            ? "El dolor se sostiene hace varias semanas: conviene consultar a un profesional (kinesiólogo o médico deportólogo). "
            : ""}
          Seguir cargando con dolor tolerable (hasta ~{rules.pain.acceptableMax}/10, que calme en un día y no empeore semana a semana) suele ser mejor
          que el reposo total en molestias de tendón; los umbrales son de guías clínicas, no una regla para vos. Si se
          repite o empeora, consultá a un profesional.
        </HonestNote>
      </div>
      )}
    </Card>
  );
}

function optionHint(o: PainOption, rules: ReturnType<typeof getRules>): string {
  switch (o) {
    case "load-down-reps-up":
      return `Entre ${rules.repRanges.globalValid.min} y ${rules.repRanges.globalValid.max} reps la hipertrofia es similar con esfuerzo equiparado.`;
    case "rir-plus-one":
      return "Parar antes cuesta poco estímulo: la curva se aplana cerca del fallo.";
    case "swap-candidate":
      return "Una variante del mismo músculo que no carga la zona.";
    case "exercise-deload":
      return "Menos series y carga en este ejercicio, una sesión (sugerencia, sin ensayos propios).";
  }
}
