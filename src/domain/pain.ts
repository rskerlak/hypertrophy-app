// A5.5 — Dolor articular/tendinoso: señal de manejo de carga, NUNCA diagnóstico.
// Funciones puras: reciben los reportes ya leídos y la config `rules.pain`.

import type { Rules } from "./rules";
import type { Exercise, PainZone } from "./types";

export interface PainReport {
  /** ISO de la sesión/check-in. */
  date: string;
  /** Zonas con dolor; [] = respondió que no le duele nada. */
  pain: Array<{ zone: PainZone; score: number }>;
}

export type PainOption = "load-down-reps-up" | "rir-plus-one" | "swap-candidate" | "exercise-deload";

export interface PainZoneSignal {
  zone: PainZone;
  latestScore: number;
  /** Reportes seguidos (los más recientes) con la zona ≥ watchFrom. */
  consecutiveSessions: number;
  trend: "rising" | "flat" | "falling";
  level: "watch" | "act";
  /** Días desde el primer reporte de la racha actual. */
  streakDays: number;
}

export interface PainSignal {
  zones: PainZoneSignal[];
  perExercise: Array<{ exerciseId: string; zone: PainZone; options: PainOption[]; swapCandidateId?: string }>;
  /** Alguna zona sostenida ≥ persistWeeks: sugerir consultar a un profesional (texto neutro). */
  persistent: boolean;
}

/** Zonas que carga un ejercicio: las propias o las de su músculo principal (config). */
export function exerciseZones(ex: Exercise, rules: Rules): PainZone[] {
  if (ex.loadedZones) return ex.loadedZones;
  return (rules.pain.zonesByMuscle[ex.primaryMuscle] ?? []) as PainZone[];
}

const DAY = 86_400_000;
const weekKey = (iso: string) => Math.floor(Date.parse(iso) / (7 * DAY));

/**
 * Evalúa el dolor reportado. `exercises` = los ejercicios del plan próximo
 * (sobre los que se proponen opciones); `library` = biblioteca para buscar una
 * variante de `swapCandidates` que no cargue la zona.
 */
export function evaluatePainSignal(input: {
  reports: PainReport[];
  exercises: Exercise[];
  library: Exercise[];
  rules: Rules;
}): PainSignal {
  const cfg = input.rules.pain;
  const reports = [...input.reports].sort((a, b) => a.date.localeCompare(b.date));
  const latest = reports[reports.length - 1];
  if (!latest) return { zones: [], perExercise: [], persistent: false };
  const scoreIn = (r: PainReport, z: PainZone) => r.pain.find((p) => p.zone === z)?.score ?? 0;

  const zones: PainZoneSignal[] = [];
  for (const { zone, score } of latest.pain) {
    if (score < cfg.watchFrom) continue;
    let consecutive = 0;
    let streakStart = latest.date;
    for (let i = reports.length - 1; i >= 0; i--) {
      if (scoreIn(reports[i], zone) >= cfg.watchFrom) {
        consecutive++;
        streakStart = reports[i].date;
      } else break;
    }
    // Media semanal de la zona (0 si un reporte no la incluye).
    const byWeek = new Map<number, number[]>();
    for (const r of reports) byWeek.set(weekKey(r.date), [...(byWeek.get(weekKey(r.date)) ?? []), scoreIn(r, zone)]);
    const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([, xs]) => xs.reduce((a, b) => a + b, 0) / xs.length);
    const w = weeks.slice(-3);
    let trend: PainZoneSignal["trend"] = "flat";
    if (w.length === 3 && w[2] > w[1] && w[1] > w[0] && w[2] - w[0] >= cfg.risePoints) trend = "rising";
    else if (w.length >= 2 && w[w.length - 1] < w[w.length - 2]) trend = "falling";
    const act = score > cfg.acceptableMax || consecutive >= cfg.persistSessions || trend === "rising";
    zones.push({
      zone,
      latestScore: score,
      consecutiveSessions: consecutive,
      trend,
      level: act ? "act" : "watch",
      streakDays: Math.round((Date.parse(latest.date) - Date.parse(streakStart)) / DAY),
    });
  }

  const byId = new Map(input.library.map((e) => [e.id, e]));
  const perExercise: PainSignal["perExercise"] = [];
  for (const z of zones.filter((x) => x.level === "act")) {
    for (const ex of input.exercises) {
      if (!exerciseZones(ex, input.rules).includes(z.zone)) continue;
      const candidate = ex.swapCandidates
        .map((id) => byId.get(id))
        .find((c) => c && !c.archived && !exerciseZones(c, input.rules).includes(z.zone));
      const options: PainOption[] = ["load-down-reps-up", "rir-plus-one"];
      if (candidate) options.push("swap-candidate");
      options.push("exercise-deload");
      perExercise.push({ exerciseId: ex.id, zone: z.zone, options, swapCandidateId: candidate?.id });
    }
  }
  const persistent = zones.some((z) => z.streakDays >= cfg.persistWeeks * 7);
  return { zones, perExercise, persistent };
}

/**
 * Ajuste "bajar carga, subir reps" para un slot: −loadDownPct % de carga y
 * +repsUpWhenLoadDown reps al rango, sin pasar del máximo con evidencia
 * (repRanges.globalValid.max). El redondeo de la carga lo hace quien aplica.
 */
export function painLoadDownAdjust(range: { min: number; max: number }, rules: Rules): { loadFactor: number; repRange: { min: number; max: number } } {
  const cap = rules.repRanges.globalValid.max;
  const up = rules.pain.repsUpWhenLoadDown;
  return {
    loadFactor: 1 - rules.pain.loadDownPct / 100,
    repRange: { min: Math.min(cap, range.min + up), max: Math.min(cap, range.max + up) },
  };
}

/** ¿Toca la pregunta periódica de dolor? (cada askEverySessions sesiones sin reporte). */
export function shouldAskPain(sessionsSinceLastReport: number, rules: Rules): boolean {
  return sessionsSinceLastReport >= rules.pain.askEverySessions;
}
