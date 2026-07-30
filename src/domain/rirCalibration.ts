// Calibración individual del RIR: medir cuán consistente es TU reporte con tus
// propios datos, sin test al fallo, y usar eso para decidir cuánto confía el
// motor en el RIR. Función pura.
//
// Método (capacidad implícita a carga fija): en cada serie, reps + RIR
// reportado ≈ reps máximas a esa carga. Si tu RIR fuera perfecto y tu capacidad
// estable, ese número sería consistente entre series de la misma carga y
// ejercicio. La dispersión que queda es una cota superior del ruido de tu
// reporte (mezcla ruido de RIR + fluctuación real de rendimiento, por eso es
// cota superior, no medida limpia).
//
// Base: los autores de Refalo 2024 proponen exactamente un criterio de puerta —
// recién con error ≲1 rep tiene sentido prescribir en la banda 0–2 RIR; si el
// reporte es impreciso, conviene mantenerse más lejos del fallo. Además la
// precisión NO mejora sola con la práctica dentro de un bloque, así que esto se
// mide, no se asume.

import type { Rules } from "./rules";
import type { SetLog } from "./types";

export interface RirCalibration {
  /** Desvío absoluto medio de la capacidad implícita (reps + RIR) a carga fija. */
  meanAbsDeviationReps: number | null;
  /** Sesgo medio del RIR reportado vs objetivo (+ = reportás más lejos del fallo). */
  meanSignedBiasReps: number | null;
  /** Nº de comparaciones usadas (series agrupadas por ejercicio+carga). */
  samples: number;
  /** true si hay datos suficientes Y la dispersión es ≤ umbral de "bien calibrado". */
  wellCalibrated: boolean;
  /** Datos insuficientes para opinar. */
  insufficientData: boolean;
}

/**
 * Estima la calibración del RIR desde el historial. Solo usa grupos de ≥2
 * series con el MISMO ejercicio y la MISMA carga real.
 */
export function assessRirCalibration(logs: SetLog[], rules: Rules): RirCalibration {
  const cfg = rules.rirCalibration;

  // Agrupar por ejercicio + carga real.
  const groups = new Map<string, SetLog[]>();
  for (const l of logs) {
    if (l.actualLoadKg <= 0) continue; // peso corporal: la carga no identifica el estímulo
    const key = `${l.exerciseId}@${l.actualLoadKg}`;
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  }

  const deviations: number[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    const implied = arr.map((l) => l.actualReps + l.actualRir);
    const mean = implied.reduce((a, b) => a + b, 0) / implied.length;
    for (const v of implied) deviations.push(Math.abs(v - mean));
  }

  const biases = logs.map((l) => l.actualRir - l.targetRir);

  if (deviations.length < cfg.minSamplesToAssess) {
    return {
      meanAbsDeviationReps: null,
      meanSignedBiasReps: biases.length > 0 ? round2(mean(biases)) : null,
      samples: deviations.length,
      wellCalibrated: false,
      insufficientData: true,
    };
  }

  const mad = mean(deviations);
  return {
    meanAbsDeviationReps: round2(mad),
    meanSignedBiasReps: round2(mean(biases)),
    samples: deviations.length,
    wellCalibrated: mad <= cfg.wellCalibratedMadReps,
    insufficientData: false,
  };
}

/**
 * Tope del ajuste por RIR ya corregido por la calibración medida del usuario:
 * si su reporte es ruidoso (o no hay datos), el motor confía menos.
 * Se combina con el tope por rango de reps (ver rirCapForRepRange).
 */
export function calibratedRirCap(
  baseCap: number,
  calibration: RirCalibration,
  rules: Rules,
): number {
  const cfg = rules.rirCalibration;
  if (calibration.insufficientData || !calibration.wellCalibrated) {
    return Math.min(baseCap, cfg.capWhenUncalibrated);
  }
  return baseCap;
}

/**
 * Piso de RIR sugerido: mientras el reporte no esté calibrado, no tiene sentido
 * prescribir 0 RIR (no sabés dónde estás realmente respecto del fallo).
 * Devuelve null si no corresponde elevar el piso.
 */
export function calibratedRirFloor(
  calibration: RirCalibration,
  rules: Rules,
): number | null {
  const cfg = rules.rirCalibration;
  if (!cfg.raiseFloorWhenUncalibrated) return null;
  if (calibration.insufficientData || !calibration.wellCalibrated) {
    return cfg.rirFloorWhenUncalibrated;
  }
  return null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round2 = (n: number) => Math.round(n * 100) / 100;
