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
import { isRirReported, isWorkingSet, type EquipmentType, type PainZone, type SetLog } from "./types";

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
  /** % de series cuyo RIR registrado coincide EXACTAMENTE con el objetivo. */
  echoPct: number | null;
  /**
   * true si ese % supera `echoThresholdPct`: el RIR no mide la percepción del
   * usuario (se confirmó el valor precargado). Nunca se declara "calibrado".
   */
  echoDetected: boolean;
  /**
   * A5.8: de dónde sale el juicio de calibración. `proxy` = dispersión a carga
   * fija (cota superior del ruido); `measured` = tests al fallo (≥ minTests).
   */
  source: "proxy" | "measured";
  /** Resultado de los tests al fallo, si hay alguno. */
  measured?: RirAccuracy;
}

export interface RirAccuracy {
  /** Nº de tests al fallo. */
  n: number;
  /** Error medio (reps que de verdad quedaban − RIR que creías). + = subestimás tu reserva. */
  meanErrorReps: number;
  /** Error absoluto medio. */
  madReps: number;
  bias: "underestimates" | "overestimates" | "neutral";
}

/** % de series con RIR registrado === RIR objetivo (null si no hay series). */
export function rirEchoPct(allLogs: SetLog[]): number | null {
  // Solo series con RIR reportado: el precargado sin tocar no es eco, es "sin dato".
  const logs = allLogs.filter((l) => isRirReported(l) && isWorkingSet(l) && !l.amrapTest);
  if (logs.length === 0) return null;
  const eq = logs.filter((l) => l.actualRir === l.targetRir).length;
  return round2((eq / logs.length) * 100);
}

/**
 * Estima la calibración del RIR desde el historial. Solo usa grupos de ≥2
 * series con el MISMO ejercicio y la MISMA carga real.
 */
export function assessRirCalibration(
  allLogs: SetLog[],
  rules: Rules,
  /** A5.8: tests al fallo a considerar (por defecto, los de `allLogs`). Pueden venir de otros mesos. */
  testLogs: SetLog[] = allLogs,
): RirCalibration {
  const proxy = assessProxy(allLogs.filter((l) => !l.amrapTest), rules);
  const measured = rirAccuracyFromTests(testLogs, rules);
  if (!measured || measured.n < rules.amrapTest.minTests) return { ...proxy, ...(measured ? { measured } : {}) };
  // Medido contra el fallo: manda sobre el proxy y sobre el eco (es una
  // medición, no una percepción precargada).
  return {
    ...proxy,
    meanAbsDeviationReps: measured.madReps,
    samples: measured.n,
    wellCalibrated: measured.madReps <= rules.rirCalibration.wellCalibratedMadReps,
    insufficientData: false,
    source: "measured",
    measured,
  };
}

function assessProxy(allLogs: SetLog[], rules: Rules): RirCalibration {
  const cfg = rules.rirCalibration;
  // Calibrar solo con RIR reportado (A1.11): el precargado no mide percepción.
  const logs = allLogs.filter((l) => isRirReported(l) && isWorkingSet(l));

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
  const weights: number[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    const implied = arr.map((l) => l.actualReps + l.actualRir);
    const mean = implied.reduce((a, b) => a + b, 0) / implied.length;
    arr.forEach((l, k) => {
      deviations.push(Math.abs(implied[k] - mean));
      // La serie 1 de la sesión es menos precisa (heurístico, A2.7).
      weights.push(l.setIndex === 0 ? cfg.firstSetWeight : 1);
    });
  }

  const biases = logs.map((l) => l.actualRir - l.targetRir);
  const echoPct = rirEchoPct(logs);
  const echoDetected =
    echoPct !== null && logs.length >= cfg.minSamplesToAssess && echoPct >= cfg.echoThresholdPct;

  if (deviations.length < cfg.minSamplesToAssess) {
    return {
      meanAbsDeviationReps: null,
      meanSignedBiasReps: biases.length > 0 ? round2(mean(biases)) : null,
      samples: deviations.length,
      wellCalibrated: false,
      insufficientData: true,
      echoPct,
      echoDetected,
      source: "proxy",
    };
  }

  const wsum = weights.reduce((a, b) => a + b, 0);
  const mad = wsum > 0 ? deviations.reduce((a, d, k) => a + d * weights[k], 0) / wsum : mean(deviations);
  return {
    meanAbsDeviationReps: round2(mad),
    meanSignedBiasReps: round2(mean(biases)),
    samples: deviations.length,
    // Con eco la dispersión mide el calendario de RIR, no la percepción.
    wellCalibrated: !echoDetected && mad <= cfg.wellCalibratedMadReps,
    insufficientData: false,
    echoPct,
    echoDetected,
    source: "proxy",
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

// ---------------- A5.8: test AMRAP de precisión ----------------

/** Error de un test: reps que de verdad quedaban − RIR que el usuario creía. null si no es test. */
export function amrapTestError(l: Pick<SetLog, "amrapTest" | "actualReps" | "kind">): number | null {
  // A5S-05: un "test" que no fue al fallo no mide nada.
  if (!l.amrapTest || l.kind !== "failure") return null;
  return l.actualReps - l.amrapTest.repsAtPrediction - l.amrapTest.predictedRir;
}

/**
 * Precisión del RIR medida contra el fallo real (Martikainen 2025). Solo usa
 * series con `amrapTest`. En entrenados el sesgo típico es subestimar la
 * reserva (error positivo: podías más de lo que creías).
 */
export function rirAccuracyFromTests(logs: SetLog[], rules: Rules): RirAccuracy | null {
  const errors = logs.map(amrapTestError).filter((e): e is number => e !== null);
  if (errors.length === 0) return null;
  const meanError = mean(errors);
  const band = rules.amrapTest.neutralBiasReps;
  return {
    n: errors.length,
    meanErrorReps: round2(meanError),
    madReps: round2(mean(errors.map(Math.abs))),
    bias: meanError > band ? "underestimates" : meanError < -band ? "overestimates" : "neutral",
  };
}

/**
 * Sesiones completadas del ejercicio desde su último test (null = nunca se
 * testeó). `sessions` trae estado y fecha de las sesiones de esos logs.
 */
export function sessionsSinceLastAmrapTest(
  logs: Array<Pick<SetLog, "sessionId" | "amrapTest">>,
  sessions: Array<{ id: string; status: string; completedAt?: string }>,
): number | null {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const done = [...new Set(logs.map((l) => l.sessionId))]
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s && s.status === "completed" && !!s.completedAt)
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!));
  const tested = new Set(logs.filter((l) => l.amrapTest).map((l) => l.sessionId));
  let last = -1;
  done.forEach((s, k) => {
    if (tested.has(s.id)) last = k;
  });
  return last < 0 ? null : done.length - 1 - last;
}

export interface AmrapEligibility {
  eligible: boolean;
  /** Motivo legible (por qué sí o por qué no). */
  reason: string;
}

/**
 * ¿Se ofrece el test hoy en este ejercicio? Nunca en deload, ni en barra libre
 * sin seguros declarados, ni con dolor activo en una zona que el ejercicio
 * carga, ni en slots APRE (ya terminan al fallo y sus reps deciden la carga),
 * ni con cargas livianas (la precisión cae), ni más seguido que la frecuencia
 * del config.
 */
export function amrapTestEligibility(input: {
  equipmentType: EquipmentType;
  isDeload: boolean;
  slotIsApre: boolean;
  loadKg: number;
  e1rmKg: number | null;
  loadedZones: PainZone[];
  activePainZones: PainZone[];
  sessionsSinceLastTest: number | null;
  barbellFailureAllowed: boolean;
  rules: Rules;
}): AmrapEligibility {
  const cfg = input.rules.amrapTest;
  const no = (reason: string): AmrapEligibility => ({ eligible: false, reason });
  if (!cfg.enabled) return no("Test desactivado en la configuración.");
  if (input.isDeload) return no("En deload no se va al fallo.");
  if (input.slotIsApre) return no("Este ejercicio es APRE: su última serie ya es al fallo.");
  const barbellOk = input.equipmentType === "barbell" && input.barbellFailureAllowed;
  if (!cfg.allowedEquipment.includes(input.equipmentType) && !barbellOk) {
    return no(input.equipmentType === "barbell" ? "Barra libre sin seguros declarados: no se va al fallo." : "Tipo de equipo no habilitado para el test.");
  }
  const hurts = input.loadedZones.filter((z) => input.activePainZones.includes(z));
  if (hurts.length > 0) return no("Hay dolor activo en una zona que este ejercicio carga.");
  if (input.equipmentType !== "bodyweight") {
    if (input.e1rmKg === null || input.e1rmKg <= 0) return no("Sin historial para estimar la carga relativa.");
    if ((input.loadKg / input.e1rmKg) * 100 < cfg.minLoadPctE1rm) {
      return no(`Carga por debajo del ${cfg.minLoadPctE1rm} % del e1RM: el RIR es menos preciso con cargas livianas.`);
    }
  }
  if (input.sessionsSinceLastTest !== null && input.sessionsSinceLastTest < cfg.everySessionsPerExercise) {
    return no(`Último test hace ${input.sessionsSinceLastTest} sesiones de este ejercicio (cada ${cfg.everySessionsPerExercise}).`);
  }
  return { eligible: true, reason: "Opcional: mide qué tan preciso es tu RIR contra el fallo real." };
}
