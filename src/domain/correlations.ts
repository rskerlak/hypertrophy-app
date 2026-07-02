// Correlaciones entre mesociclos: cruza resultados (Δ1RM, medidas corporales)
// con covariables (sueño, proteína, balance energético, adherencia) y el tipo
// de progresión. TODO ESTO ES ORIENTATIVO: con pocos mesos es ruido (n pequeño);
// la UI debe decirlo siempre. Funciones puras, sin efectos.

import type { Checkin } from "./types";

/** Medidas corporales relevantes para el análisis (subset del registro). */
export interface BodyMeasurement {
  date: string;
  bodyweightKg?: number;
  waistCm?: number;
  chestUnderShouldersCm?: number;
  shoulderGirthCm?: number;
  bicepCm?: number;
  quadCm?: number;
  calfCm?: number;
}

export const MEASUREMENT_FIELDS = [
  "bodyweightKg",
  "waistCm",
  "chestUnderShouldersCm",
  "shoulderGirthCm",
  "bicepCm",
  "quadCm",
  "calfCm",
] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

/** Una observación = un mesociclo completado, con sus variables numéricas. */
export interface MesoObservation {
  mesoId: string;
  mesoName: string;
  progressionModel: string;
  /** variable → valor (null si no hay dato para ese meso) */
  values: Record<string, number | null>;
}

/** Deltas de medidas entre el inicio y el fin del meso (end - start). */
export function measurementDeltas(
  start: BodyMeasurement | undefined,
  end: BodyMeasurement | undefined,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const f of MEASUREMENT_FIELDS) {
    const a = start?.[f];
    const b = end?.[f];
    out[`d_${f}`] =
      typeof a === "number" && typeof b === "number" ? +(b - a).toFixed(2) : null;
  }
  return out;
}

/** Agregados de check-ins del meso: % de sueño OK, % proteína OK, balance medio. */
export function checkinAggregates(checkins: Checkin[]): {
  sleepOkPct: number | null;
  proteinOkPct: number | null;
  energyBalanceAvg: number | null;
} {
  const sleep = checkins.map((c) => c.sleptMinimum).filter((v): v is boolean => v !== null && v !== undefined);
  const protein = checkins.map((c) => c.proteinSufficient).filter((v): v is boolean => v !== null && v !== undefined);
  const energy = checkins
    .map((c) => c.energyBalance)
    .filter((v): v is "surplus" | "maintenance" | "deficit" => v === "surplus" || v === "maintenance" || v === "deficit")
    .map((v): number => (v === "surplus" ? 1 : v === "deficit" ? -1 : 0));
  const pct = (xs: boolean[]) => (xs.length === 0 ? null : Math.round((xs.filter(Boolean).length / xs.length) * 100));
  return {
    sleepOkPct: pct(sleep),
    proteinOkPct: pct(protein),
    energyBalanceAvg: energy.length === 0 ? null : +(energy.reduce((a, b) => a + b, 0) / energy.length).toFixed(2),
  };
}

export interface BuildObservationInput {
  mesoId: string;
  mesoName: string;
  progressionModel: string;
  /** Δ% medio de 1RM estimado entre primera y última sesión (de computeMesoStats). */
  avg1RmDeltaPct: number | null;
  adherencePct: number | null;
  checkins: Checkin[];
  startMeasurement?: BodyMeasurement;
  endMeasurement?: BodyMeasurement;
}

export function buildMesoObservation(input: BuildObservationInput): MesoObservation {
  const agg = checkinAggregates(input.checkins);
  return {
    mesoId: input.mesoId,
    mesoName: input.mesoName,
    progressionModel: input.progressionModel,
    values: {
      d1rmPct: input.avg1RmDeltaPct,
      adherencePct: input.adherencePct,
      sleepOkPct: agg.sleepOkPct,
      proteinOkPct: agg.proteinOkPct,
      energyBalanceAvg: agg.energyBalanceAvg,
      ...measurementDeltas(input.startMeasurement, input.endMeasurement),
    },
  };
}

/**
 * Correlación de Pearson sobre pares completos. Devuelve null si hay menos de
 * 3 pares o si alguna serie es constante (r indefinido).
 */
export function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return +(num / Math.sqrt(dx * dy)).toFixed(2);
}

export interface CorrelationResult {
  variables: string[];
  /** matrix[i][j] = r entre variables i y j (null si no computable). */
  matrix: Array<Array<number | null>>;
  /** nº de observaciones (mesos) usadas. */
  n: number;
}

/**
 * Matriz de correlaciones entre variables a través de las observaciones.
 * Solo incluye variables con al menos 2 valores no nulos.
 */
export function correlationMatrix(
  observations: MesoObservation[],
  candidateVariables: string[],
): CorrelationResult {
  const variables = candidateVariables.filter(
    (v) => observations.filter((o) => o.values[v] !== null && o.values[v] !== undefined).length >= 2,
  );
  const matrix = variables.map((vi) =>
    variables.map((vj) => {
      if (vi === vj) return 1;
      const pairs: Array<[number, number]> = [];
      for (const o of observations) {
        const a = o.values[vi];
        const b = o.values[vj];
        if (typeof a === "number" && typeof b === "number") pairs.push([a, b]);
      }
      return pearson(pairs);
    }),
  );
  return { variables, matrix, n: observations.length };
}

/** Promedios por tipo de progresión (para comparar qué meso rindió más). */
export function summarizeByModel(
  observations: MesoObservation[],
  variables: string[],
): Array<{ model: string; n: number; means: Record<string, number | null> }> {
  const byModel = new Map<string, MesoObservation[]>();
  for (const o of observations) {
    const arr = byModel.get(o.progressionModel) ?? [];
    arr.push(o);
    byModel.set(o.progressionModel, arr);
  }
  return [...byModel.entries()].map(([model, obs]) => {
    const means: Record<string, number | null> = {};
    for (const v of variables) {
      const vals = obs.map((o) => o.values[v]).filter((x): x is number => typeof x === "number");
      means[v] = vals.length === 0 ? null : +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    }
    return { model, n: obs.length, means };
  });
}
