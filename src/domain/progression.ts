// nextPrescription: autorregulación de carga por modelo de progresión.
// Determinista: recibe historial + config y devuelve la prescripción siguiente.

import type { Rules } from "./rules";
import type {
  DupDayType,
  EquipmentType,
  Equipment,
  ProgressionModel,
  RepRange,
  SetLog,
} from "./types";
import { nextAchievableLoad, roundToAvailable } from "./rounding";

export interface NextPrescriptionInput {
  /** Logs de sesiones previas de este slot (mismo ejercicio), cualquier orden. */
  exerciseHistory: SetLog[];
  model: ProgressionModel;
  /** RIR objetivo de la semana actual (ya con offsets de DUP/block aplicados si vienen del plan). */
  targetRir: number;
  repRange: RepRange;
  currentLoadKg: number;
  equipmentType: EquipmentType;
  equipment: Equipment;
  /** Solo DUP: tipo de día del slot planificado. */
  dayType?: DupDayType;
  /** Solo block: índice de semana y total de acumulación para determinar la fase. */
  weekIndex?: number;
  numAccumulationWeeks?: number;
  rules: Rules;
}

export interface Prescription {
  nextLoadKg: number;
  nextReps: number;
  nextSets?: number;
  rationale: string;
}

/** Agrupa el historial por sesión y devuelve las sesiones ordenadas por tiempo. */
export function groupBySession(history: SetLog[]): SetLog[][] {
  const byId = new Map<string, SetLog[]>();
  for (const log of history) {
    const arr = byId.get(log.sessionId) ?? [];
    arr.push(log);
    byId.set(log.sessionId, arr);
  }
  const sessions = [...byId.values()];
  sessions.sort(
    (a, b) =>
      Math.min(...a.map((l) => Date.parse(l.timestamp))) -
      Math.min(...b.map((l) => Date.parse(l.timestamp))),
  );
  for (const s of sessions) s.sort((a, b) => a.setIndex - b.setIndex);
  return sessions;
}

/** Reps "logradas" de una sesión: el mínimo entre sus series (criterio conservador). */
function achievedReps(sessionLogs: SetLog[]): number {
  return Math.min(...sessionLogs.map((l) => l.actualReps));
}

/** ¿La sesión cumplió las reps objetivo al RIR objetivo (o más cerca del fallo)? */
function hitTarget(sessionLogs: SetLog[]): boolean {
  return sessionLogs.every(
    (l) => l.actualReps >= l.targetReps && l.actualRir <= l.targetRir + 1,
  );
}

export function nextPrescription(input: NextPrescriptionInput): Prescription {
  const { model, rules } = input;
  let repRange = input.repRange;
  let targetRir = input.targetRir;

  // DUP y block ajustan rango/RIR y por dentro corren doble progresión.
  if (model === "dup" && input.dayType) {
    const day = rules.progressionModels.dup.dayTypes[input.dayType];
    repRange = day.repRange;
    targetRir = input.targetRir + day.targetRirOffset;
  }
  if (
    model === "block" &&
    input.weekIndex !== undefined &&
    input.numAccumulationWeeks !== undefined
  ) {
    const phase = blockPhaseForWeek(rules, input.weekIndex, input.numAccumulationWeeks);
    repRange = phase.repRange;
    targetRir = input.targetRir + phase.rirBias;
  }

  const sessions = groupBySession(input.exerciseHistory);
  if (sessions.length === 0) {
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: repRange.min,
      rationale: "Sin historial: usar carga inicial y piso del rango.",
    };
  }

  // targetRir queda aplicado en los targets de la sesión; la progresión de
  // carga/reps se rige por reps logradas y el rango, no por el RIR en sí.
  void targetRir;
  if (model === "linear") {
    return linearProgression(input, sessions, repRange);
  }
  return doubleProgression(input, sessions, repRange);
}

function blockPhaseForWeek(rules: Rules, weekIndex: number, totalWeeks: number) {
  const frac = totalWeeks <= 1 ? 0 : weekIndex / totalWeeks;
  let cum = 0;
  for (const phase of rules.progressionModels.block.phases) {
    cum += phase.fractionOfMeso;
    if (frac < cum) return phase;
  }
  return rules.progressionModels.block.phases[
    rules.progressionModels.block.phases.length - 1
  ];
}

function linearProgression(
  input: NextPrescriptionInput,
  sessions: SetLog[][],
  repRange: RepRange,
): Prescription {
  const cfg = input.rules.progressionModels.linear;
  const ctx = { type: input.equipmentType, equipment: input.equipment };
  const last = sessions[sessions.length - 1];

  if (hitTarget(last)) {
    const target = input.currentLoadKg * (1 + cfg.loadIncrementPctPerSession / 100);
    let next = roundToAvailable(target, ctx);
    if (next <= input.currentLoadKg) {
      next = nextAchievableLoad(input.currentLoadKg, ctx);
    }
    if (next <= input.currentLoadKg) {
      // Sin salto de carga posible (bodyweight / tope de mancuernas): añadir una rep.
      return {
        nextLoadKg: input.currentLoadKg,
        nextReps: achievedReps(last) + 1,
        rationale: "Sin incremento de carga disponible: añadir una rep.",
      };
    }
    return {
      nextLoadKg: next,
      nextReps: repRange.min,
      rationale: "Objetivo cumplido: subir carga al incremento disponible.",
    };
  }

  const recentFails = sessions
    .slice(-cfg.failToProgressThreshold)
    .filter((s) => !hitTarget(s)).length;
  if (recentFails >= cfg.failToProgressThreshold) {
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: repRange.min,
      rationale: `Sin progreso en ${cfg.failToProgressThreshold} sesiones: mantener carga.`,
    };
  }
  return {
    nextLoadKg: input.currentLoadKg,
    nextReps: repRange.min,
    rationale: "Objetivo no cumplido: repetir carga.",
  };
}

function doubleProgression(
  input: NextPrescriptionInput,
  sessions: SetLog[][],
  repRange: RepRange,
): Prescription {
  const cfg = input.rules.progressionModels.double;
  const ctx = { type: input.equipmentType, equipment: input.equipment };
  const last = sessions[sessions.length - 1];
  const reps = achievedReps(last);

  if (reps < repRange.max) {
    // Debajo del tope: subir reps, misma carga.
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: Math.max(repRange.min, reps + cfg.repStepWhenBelowCeiling),
      rationale: "Debajo del tope del rango: subir reps a misma carga.",
    };
  }

  // Tope alcanzado: evaluar si el salto mínimo de carga es proporcional al % objetivo.
  const nextLoad = nextAchievableLoad(input.currentLoadKg, ctx);
  if (nextLoad <= input.currentLoadKg) {
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: reps + cfg.repStepWhenBelowCeiling,
      rationale: "Sin incremento de carga disponible: seguir añadiendo reps.",
    };
  }
  const minJumpPct =
    ((nextLoad - input.currentLoadKg) / input.currentLoadKg) * 100;
  // Cada rep por encima del tope "acredita" ~loadIncrementPct de progreso.
  const surplus = reps - repRange.max;
  const creditPct = (surplus + 1) * cfg.loadIncrementPctOnRepCeiling;

  if (creditPct >= minJumpPct) {
    return {
      nextLoadKg: nextLoad,
      nextReps: repRange.min,
      rationale: "Tope del rango alcanzado: subir carga y volver al piso del rango.",
    };
  }
  return {
    nextLoadKg: input.currentLoadKg,
    nextReps: reps + cfg.repStepWhenBelowCeiling,
    rationale:
      "El salto mínimo de carga excede el % objetivo: añadir una rep aunque supere el tope.",
  };
}
