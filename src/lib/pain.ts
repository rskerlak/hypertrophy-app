// A5.5: arma las entradas de evaluatePainSignal desde los repos y filtra las
// propuestas descartadas durante la racha actual. El cálculo vive en src/domain/pain.ts.

import { evaluatePainSignal, shouldAskPain, type PainOption, type PainReport, type PainSignal } from "@/domain/pain";
import type { PainZone } from "@/domain/types";
import { checkinRepo, exerciseRepo, mesocycleRepo, sessionRepo, settingsRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";

export interface PainItem {
  exerciseId: string;
  exerciseName: string;
  zone: PainZone;
  options: PainOption[];
  swapCandidateId?: string;
  swapCandidateName?: string;
}

export interface PainStatus {
  signal: PainSignal;
  items: PainItem[];
  mesocycleId: string;
}

export async function painReports(): Promise<PainReport[]> {
  const all = await checkinRepo.all();
  return all.filter((c) => Array.isArray(c.pain)).map((c) => ({ date: c.date, pain: c.pain! }));
}

/** Señal de dolor sobre el meso dado (sus ejercicios), sin lo descartado en la racha actual. */
export async function painStatus(mesocycleId: string): Promise<PainStatus | null> {
  const rules = getRules();
  const [reports, meso, library, settings] = await Promise.all([
    painReports(),
    mesocycleRepo.get(mesocycleId),
    exerciseRepo.all(),
    settingsRepo.get(),
  ]);
  if (!meso || reports.length === 0) return null;
  const byId = new Map(library.map((e) => [e.id, e]));
  const ids = new Set(meso.plan.weeks.flatMap((w) => w.days.flatMap((d) => d.slots.map((s) => s.exerciseId))));
  const exercises = [...ids].map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
  const signal = evaluatePainSignal({ reports, exercises, library, rules });
  const latest = reports.map((r) => r.date).sort().at(-1)!;
  const items: PainItem[] = [];
  for (const x of signal.perExercise) {
    const z = signal.zones.find((q) => q.zone === x.zone)!;
    const streakStart = Date.parse(latest) - z.streakDays * 86_400_000;
    const dismissedList = Array.isArray(settings.dismissedPainSuggestions) ? settings.dismissedPainSuggestions : [];
    const dismissed = dismissedList.some(
      (d) => d.exerciseId === x.exerciseId && d.zone === x.zone && Date.parse(d.at) >= streakStart - 86_400_000 && z.trend !== "rising",
    );
    if (dismissed) continue;
    items.push({
      ...x,
      exerciseName: byId.get(x.exerciseId)?.name ?? x.exerciseId,
      swapCandidateName: x.swapCandidateId ? byId.get(x.swapCandidateId)?.name : undefined,
    });
  }
  return { signal, items, mesocycleId };
}

/** ¿Toca la pregunta periódica de dolor? Cuenta sesiones completadas desde el último reporte. */
export async function painQuestionDue(): Promise<boolean> {
  const reports = await painReports();
  const last = reports.map((r) => r.date).sort().at(-1);
  return shouldAskPain(await sessionRepo.completedCountSince(last), getRules());
}
