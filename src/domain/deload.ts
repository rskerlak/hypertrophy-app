// Disparadores de deload: multi-señal y PROBABILÍSTICOS. La caída de
// rendimiento es sobre todo fatiga aguda, no un "MRV superado" medible.
// La UI debe presentar esto como sugerencia, nunca como diagnóstico.

import type { Rules } from "./rules";
import { effectiveLandmarks } from "./rules";
import { roundToAvailable, type RoundingContext } from "./rounding";
import { isRirReported, isWorkingSet } from "./types";
import { estimate1RM } from "./oneRepMax";
import type {
  Checkin,
  DeloadEvaluation,
  ExperienceProfileId,
  SessionSummary,
  SetLog,
} from "./types";

/**
 * Construye el resumen de una sesión comparándola con la sesión previa
 * del mismo día/slots (mismos ejercicios). Puro: recibe los logs ya filtrados.
 */
export function summarizeSessionPair(
  prevLogs: SetLog[],
  currLogs: SetLog[],
  sessionId: string,
  checkin?: Checkin | null,
): SessionSummary {
  const prevByExercise = new Map<string, SetLog[]>();
  // Solo series de trabajo: el calentamiento no dice nada de fatiga.
  prevLogs = prevLogs.filter(isWorkingSet);
  currLogs = currLogs.filter(isWorkingSet);
  for (const l of prevLogs) {
    const arr = prevByExercise.get(l.exerciseId) ?? [];
    arr.push(l);
    prevByExercise.set(l.exerciseId, arr);
  }
  const currByExercise = new Map<string, SetLog[]>();
  for (const l of currLogs) {
    const arr = currByExercise.get(l.exerciseId) ?? [];
    arr.push(l);
    currByExercise.set(l.exerciseId, arr);
  }

  let repDrops = 0;
  let maxRirIncrease = 0;
  for (const [exId, curr] of currByExercise) {
    const prev = prevByExercise.get(exId);
    if (!prev) continue;
    // Comparación a carga fija: solo series con la misma carga real.
    const prevBest = new Map<number, { reps: number; rir: number; rirReported: boolean }>();
    for (const p of prev) {
      const b = prevBest.get(p.actualLoadKg);
      if (!b || p.actualReps > b.reps) {
        prevBest.set(p.actualLoadKg, { reps: p.actualReps, rir: p.actualRir, rirReported: isRirReported(p) });
      }
    }
    let dropped = false;
    for (const c of curr) {
      const b = prevBest.get(c.actualLoadKg);
      if (!b) continue;
      if (c.actualReps < b.reps) dropped = true;
      // RIR creep solo entre series con RIR reportado en ambos lados.
      if (!isRirReported(c) || !b.rirReported) continue;
      const rirIncrease = c.actualRir - b.rir;
      if (rirIncrease > maxRirIncrease) maxRirIncrease = rirIncrease;
    }
    if (dropped) repDrops++;
  }

  return {
    sessionId,
    exercisesWithRepDropAtFixedLoad: repDrops,
    maxRirIncreaseAtFixedLoad: maxRirIncrease,
    readiness: checkin?.readiness ?? null,
    sleptMinimum: checkin?.sleptMinimum ?? null,
    perceivedFatigue: checkin?.perceivedFatigue ?? null,
  };
}

export interface EvaluateDeloadInput {
  /** Resúmenes de las sesiones recientes, en orden cronológico. */
  recentSessions: SessionSummary[];
  checkins: Checkin[];
  currentWeeklyVolumeByMuscle: Record<string, number>;
  prioritizedMuscles: string[];
  profile: ExperienceProfileId;
  weekIndex: number;
  numAccumulationWeeks: number;
  /** true si la sesión evaluada ya es de deload: nunca se sugiere otro. */
  isDeload?: boolean;
  rules: Rules;
}

export function evaluateDeloadTrigger(input: EvaluateDeloadInput): DeloadEvaluation {
  const { rules } = input;
  const cfg = rules.deloadTriggers;
  const reasons: string[] = [];
  // Cada señal suma su peso (A2.1); la sugerencia sale por puntaje.
  let score = 0;
  const add = (weight: number, reason: string) => {
    score += weight;
    reasons.push(`${reason} (peso ${weight})`);
  };

  // Durante el propio deload no tiene sentido sugerir un deload (A0.5).
  if (input.isDeload) return { shouldSuggest: false, reasons: [], forced: false };

  // 1. Caída de rendimiento sostenida: N sesiones seguidas DEL MISMO DÍA del
  //    split con caída de reps a carga fija (Grandou 2020: único marcador
  //    establecido de fatiga acumulada). Sin dayKey: N sesiones seguidas.
  const perf = cfg.signals.performanceDropSessions;
  if (perf.enabled) {
    const byDay = new Map<string, SessionSummary[]>();
    for (const s of input.recentSessions) {
      const k = s.dayKey ?? "*";
      const arr = byDay.get(k) ?? [];
      arr.push(s);
      byDay.set(k, arr);
    }
    const hit = [...byDay.values()].some((list) => {
      const recent = list.slice(-perf.consecutiveSessions);
      return (
        recent.length >= perf.consecutiveSessions &&
        recent.every((s) => s.exercisesWithRepDropAtFixedLoad >= perf.exercisesAffected)
      );
    });
    if (hit) {
      add(
        perf.weight,
        `Caída de reps a carga fija en ${perf.exercisesAffected}+ ejercicios durante ${perf.consecutiveSessions} sesiones seguidas del mismo día`,
      );
    }
  }

  // 2. RIR creep a carga fija.
  const creep = cfg.signals.rirCreepAtFixedLoad;
  if (creep.enabled) {
    const hit = input.recentSessions.some(
      (s) => s.maxRirIncreaseAtFixedLoad >= creep.reps,
    );
    if (hit) {
      add(creep.weight, `El RIR reportado subió ≥${creep.reps} a carga fija`);
    }
  }

  // 3. Volumen planificado alcanza MRV en algún músculo priorizado.
  if (cfg.signals.reachedMrv.enabled) {
    const muscles =
      input.prioritizedMuscles.length > 0
        ? input.prioritizedMuscles
        : Object.keys(input.currentWeeklyVolumeByMuscle);
    for (const m of muscles) {
      const vol = input.currentWeeklyVolumeByMuscle[m] ?? 0;
      if (vol <= 0) continue;
      try {
        const lm = effectiveLandmarks(rules, input.profile, m);
        if (vol >= lm.mrv) {
          add(cfg.signals.reachedMrv.weight, `El volumen semanal de ${m} alcanzó el MRV heurístico del perfil`);
          break;
        }
      } catch {
        // sin landmarks para ese músculo: ignorar
      }
    }
  }

  // 4. Disposición/sueño pobres sostenidos (señal débil, cuenta junto a otras).
  const chronic = cfg.signals.chronicPoorReadiness;
  if (chronic.enabled) {
    const recent = input.recentSessions.slice(-chronic.windowSessions);
    if (
      recent.length >= chronic.windowSessions &&
      recent.every(
        (s) =>
          s.sleptMinimum === false ||
          (typeof s.readiness === "number" && s.readiness <= chronic.readinessMax),
      )
    ) {
      add(chronic.weight, "Sueño bajo el mínimo o baja disposición sostenidos en el check-in");
    }
  }

  // 5. Fatiga física + mental percibida sostenida (A2.2; consenso Bell 2023).
  const fat = cfg.signals.perceivedFatigue;
  if (fat.enabled) {
    const withValue = input.recentSessions.filter((s) => typeof s.perceivedFatigue === "number");
    const recent = withValue.slice(-fat.windowSessions);
    if (recent.length >= fat.windowSessions && recent.every((s) => (s.perceivedFatigue ?? 0) >= fat.threshold)) {
      add(fat.weight, `Fatiga percibida ≥${fat.threshold}/5 en las últimas ${fat.windowSessions} sesiones con check-in`);
    }
  }

  const forced = input.weekIndex >= input.numAccumulationWeeks;
  return {
    shouldSuggest: score >= cfg.minSignalsToSuggest || forced,
    score,
    reasons: forced
      ? [...reasons, "Fin de las semanas de acumulación programadas"]
      : reasons,
    forced,
  };
}

/**
 * Arma SessionSummary a partir del historial (orden cronológico). Si cada
 * entrada trae `dayKey`, cada sesión se compara con la sesión previa del MISMO
 * día del split (A0.4); sin `dayKey`, con la inmediatamente anterior (legado).
 */
export function summarizeRecentSessions(
  logsBySession: Array<{ sessionId: string; logs: SetLog[]; checkin?: Checkin | null; dayKey?: string }>,
): SessionSummary[] {
  const out: SessionSummary[] = [];
  const lastByDay = new Map<string, SetLog[]>();
  for (let i = 0; i < logsBySession.length; i++) {
    const cur = logsBySession[i];
    const prev =
      cur.dayKey !== undefined
        ? (lastByDay.get(cur.dayKey) ?? [])
        : i > 0
          ? logsBySession[i - 1].logs
          : [];
    const summary = summarizeSessionPair(prev, cur.logs, cur.sessionId, cur.checkin);
    out.push(cur.dayKey !== undefined ? { ...summary, dayKey: cur.dayKey } : summary);
    if (cur.dayKey !== undefined) lastByDay.set(cur.dayKey, cur.logs);
  }
  return out;
}

/**
 * Carga de un día de la semana de deload según `deloadStructure`: la primera
 * mitad de la semana usa la carga de la semana 1 del meso; la segunda mitad,
 * esa carga × `secondHalfFraction`, redondeada al equipamiento. El deload NO
 * progresa (ni reps ni carga): es gestión de fatiga (Coleman 2024; Bell 2023
 * Delphi: mantener intensidad y recortar volumen).
 * "Segunda mitad" = dayIndex ≥ ceil(días / 2). Peso corporal (carga 0) → 0.
 */
export function deloadLoadForDay(args: {
  dayIndex: number;
  daysInWeek: number;
  week1LoadKg: number;
  secondHalfFraction: number;
  ctx: RoundingContext;
}): { loadKg: number; half: "first" | "second" } {
  const half = args.dayIndex >= Math.ceil(args.daysInWeek / 2) ? "second" : "first";
  if (args.week1LoadKg <= 0) return { loadKg: 0, half };
  if (half === "first") return { loadKg: args.week1LoadKg, half };
  return { loadKg: roundToAvailable(args.week1LoadKg * args.secondHalfFraction, args.ctx), half };
}

export interface ExerciseDeloadSuggestion {
  suggest: boolean;
  /** Caída de e1RM entre la primera y la última de la ventana (%). */
  dropPct?: number;
  setsFactor?: number;
  loadFactor?: number;
  reason?: string;
}

/**
 * Deload POR EJERCICIO (A2.3): el e1RM (solo series de trabajo con RIR
 * reportado) cae ≥ e1rmDropPct en `sessions` sesiones SEGUIDAS de la pista,
 * cada una peor que la anterior. Heurística sin RCT (práctica de Dr. Muscle):
 * se sugiere, no se aplica sola. El historial ya viene filtrado por pista.
 */
export function evaluateExerciseDeload(history: SetLog[], rules: Rules): ExerciseDeloadSuggestion {
  const cfg = rules.deloadTriggers.exerciseDeload;
  if (!cfg.enabled) return { suggest: false };
  const usable = history.filter((l) => isWorkingSet(l) && isRirReported(l) && l.actualLoadKg > 0);
  const bySession = new Map<string, SetLog[]>();
  for (const l of usable) bySession.set(l.sessionId, [...(bySession.get(l.sessionId) ?? []), l]);
  const ordered = [...bySession.values()].sort((a, b) => a[0].timestamp.localeCompare(b[0].timestamp));
  if (ordered.length < cfg.sessions + 1) return { suggest: false };
  const best = (s: SetLog[]) => Math.max(...s.map((l) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, rules)));
  const recent = ordered.slice(-(cfg.sessions + 1)).map(best);
  const monotone = recent.every((v, i) => i === 0 || v < recent[i - 1]);
  const dropPct = ((recent[0] - recent[recent.length - 1]) / recent[0]) * 100;
  if (!monotone || dropPct < cfg.e1rmDropPct) return { suggest: false };
  return {
    suggest: true,
    dropPct: Math.round(dropPct * 10) / 10,
    setsFactor: cfg.setsFactor,
    loadFactor: cfg.loadFactor,
    reason: `El 1RM estimado de este ejercicio cayó ${dropPct.toFixed(1)}% en ${cfg.sessions} sesiones seguidas. Sugerencia: la próxima vez ${Math.round(cfg.setsFactor * 100)}% de las series y ${Math.round(cfg.loadFactor * 100)}% de la carga. Heurística sin ensayo clínico; vos decidís.`,
  };
}
