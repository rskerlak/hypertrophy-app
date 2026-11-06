// nextPrescription: autorregulación de carga por modelo de progresión.
// Determinista: recibe historial + config y devuelve la prescripción siguiente.

import type { Rules } from "./rules";
import type {
  DayIntensity,
  DupDayType,
  EquipmentType,
  Equipment,
  ProgressionModel,
  RepRange,
  SetLog,
} from "./types";
import { nextAchievableLoad, roundToAvailable } from "./rounding";
import { isProgressionSet, isRirReported } from "./types";
import { estimate1RM, loadForTarget } from "./oneRepMax";

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
  /**
   * Solo block: semana de la última sesión del historial. El re-anclaje de fase
   * corre solo si esa semana y `weekIndex` caen en fases distintas (N1/N2).
   */
  historyWeekIndex?: number;
  /** Solo block: semanas de acumulación del meso de la última sesión (si es otro meso, A5.1). */
  historyNumAccumulationWeeks?: number;
  /**
   * A5.1: sin historial en la pista pero con sesiones reales del ejercicio en
   * otra pista (track-changed) o tras una pausa larga (gap): la carga se
   * re-ancla desde el e1RM de esa última sesión real. Solo actúa si el
   * historial de la pista está vacío.
   */
  anchor?: { logs: SetLog[]; reason: "track-changed" | "gap"; ageDays?: number };
  /**
   * Tope del ajuste por RIR ya corregido por la calibración medida del usuario
   * (ver rirCalibration). Si se omite, se usa el del config por rango de reps.
   */
  rirCapOverride?: number;
  /** "apre": la carga sale de las reps de la serie AMRAP (A2.8). */
  slotProgression?: "default" | "apre";
  /** A5.4: "Mantener" — nunca subir la carga; las reps siguen dentro del rango. */
  holdLoad?: boolean;
  rules: Rules;
}

/**
 * Regla aplicada por el motor, para el chip "¿por qué?" (A1.10). Cada rama de
 * progresión devuelve un `rule` distinto (ver CONTEXT.md §6) y los números que
 * la decidieron, en unidades legibles.
 */
export type PrescriptionRule =
  | "no-history"
  | "linear-hit"
  | "linear-no-jump"
  | "linear-stalled"
  | "linear-add-rep"
  | "linear-hit-large-jump"
  | "bodyweight-cap"
  | "block-phase-reanchor"
  | "track-reanchor"
  | "gap-reanchor"
  | "linear-miss"
  | "double-below-ceiling"
  | "double-consolidate"
  | "double-no-jump"
  | "double-cushion"
  | "double-ceiling"
  | "double-ceiling-large-jump"
  | "deload-first-half"
  | "deload-second-half"
  | "apre"
  | "hold"
  | "hold-at-ceiling";

export interface PrescriptionExplain {
  rule: PrescriptionRule;
  inputs: Record<string, number | string>;
}

export interface Prescription {
  nextLoadKg: number;
  nextReps: number;
  nextSets?: number;
  rationale: string;
  explain: PrescriptionExplain;
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

/**
 * ¿Dos apariciones planificadas de un ejercicio comparten PISTA de progresión?
 * Un mismo ejercicio puede estar en varios días con prescripciones distintas
 * (banca en día fuerte 6–8 y en día liviano 10–12): si compartieran historial,
 * el día liviano heredaría la carga y las reps del fuerte. Reglas:
 *  - distinta intensidad de día (fuerte/normal/liviano) → pistas separadas;
 *  - DUP: además, misma zona (dayType);
 *  - doble/lineal: además, mismo rango de reps;
 *  - bloques: el rango cambia por fase A PROPÓSITO, así que no separa por rango.
 */
export function sameProgressionTrack(
  a: { slot: { repRange: RepRange; dayType?: DupDayType }; intensity?: DayIntensity },
  b: { slot: { repRange: RepRange; dayType?: DupDayType }; intensity?: DayIntensity },
  model: ProgressionModel,
): boolean {
  return progressionTrackKey(a, model) === progressionTrackKey(b, model);
}

/**
 * Clave estable de la pista de progresión de un slot (sin el ejercicio).
 * Dos slots comparten pista ⇔ comparten clave: es la ÚNICA definición, usada
 * por el motor (historial, herencia de cargas) y por las estadísticas.
 */
export function progressionTrackKey(
  x: { slot: { repRange: RepRange; dayType?: DupDayType }; intensity?: DayIntensity },
  model: ProgressionModel,
): string {
  const zone =
    model === "dup"
      ? `dup:${x.slot.dayType ?? "-"}`
      : model === "block"
        ? "block"
        : `${x.slot.repRange.min}-${x.slot.repRange.max}`;
  return `${x.intensity ?? "normal"}|${zone}`;
}

/** Reps "logradas" de una sesión: el mínimo entre sus series (criterio conservador). */
function achievedReps(sessionLogs: SetLog[]): number {
  return Math.min(...sessionLogs.map((l) => l.actualReps));
}

/**
 * Tope del ajuste por RIR para este rango de reps. El error de estimación de
 * RIR crece con las reps del set (deriva ≈ −0.4 reps por rep adicional), así
 * que en rangos altos confiamos menos en el RIR reportado.
 */
export function rirCapForRepRange(
  repRange: RepRange,
  cfg: {
    rirAdjustmentCapReps: number;
    rirAdjustmentCapRepsHighRep: number;
    rirAdjustmentHighRepThreshold: number;
  },
): number {
  return repRange.max >= cfg.rirAdjustmentHighRepThreshold
    ? cfg.rirAdjustmentCapRepsHighRep
    : cfg.rirAdjustmentCapReps;
}

/**
 * Reps logradas AJUSTADAS POR RIR (mínimo entre series): a las reps reales se
 * les suma (RIR real − RIR objetivo de esa serie), con tope ±cap. Si te sobró
 * RIR la carga quedó liviana y contás reps virtuales de más; si llegaste al
 * fallo antes del objetivo, contás menos. El tope es chico porque el RIR
 * reportado es ruidoso (Refalo 2024: error <1 rep pero SD que se duplica al
 * alejarse del fallo) y no mejora con la práctica dentro del bloque.
 */
function rirAdjustedReps(
  sessionLogs: SetLog[],
  capReps: number,
  dampenFrom: number,
  /** e1RM de referencia y umbral (%) para atenuar con cargas livianas (A2.7). */
  lowLoad?: { e1rmKg: number; belowPct: number },
): number {
  return Math.min(
    ...sessionLogs.map((l) => {
      // RIR no reportado (precargado sin tocar): sin ajuste, solo cuentan las reps.
      if (!isRirReported(l)) return l.actualReps;
      let adj = Math.max(-capReps, Math.min(capReps, l.actualRir - l.targetRir));
      // Un RIR reportado lejos del fallo es de baja información: se atenúa.
      if (l.actualRir >= dampenFrom) adj = Math.trunc(adj / 2);
      // Con carga liviana relativa al e1RM el RIR es menos preciso (Russo 2025).
      if (lowLoad && lowLoad.e1rmKg > 0 && l.actualLoadKg / lowLoad.e1rmKg < lowLoad.belowPct / 100) {
        adj = Math.trunc(adj / 2);
      }
      return l.actualReps + adj;
    }),
  );
}

/** ¿La sesión cumplió las reps objetivo al RIR objetivo (o más cerca del fallo)? */
function hitTarget(sessionLogs: SetLog[]): boolean {
  return sessionLogs.every(
    (l) => l.actualReps >= l.targetReps && l.actualRir <= l.targetRir + 1,
  );
}

export function nextPrescription(input: NextPrescriptionInput): Prescription {
  const p = prescribe(input);
  return input.holdLoad ? applyHold(input, p) : p;
}

/**
 * A5.4: con "Mantener" la carga no sube. Las re-estimaciones (cambio de pista,
 * pausa, fase de bloque) no son progresión y se respetan; cualquier otra regla
 * que suba la carga se convierte en repetir carga con reps dentro del rango (en
 * el tope si ya se llegó).
 */
function applyHold(input: NextPrescriptionInput, p: Prescription): Prescription {
  const reestimate = ["track-reanchor", "gap-reanchor", "block-phase-reanchor", "no-history"];
  if (reestimate.includes(p.explain.rule) || p.nextLoadKg <= input.currentLoadKg) return p;
  const sessions = progressionSessions(input.exerciseHistory);
  const last = sessions[sessions.length - 1];
  const achieved = last ? achievedReps(last) : input.repRange.min;
  const atCeiling = achieved >= input.repRange.max;
  const reps = Math.min(input.repRange.max, Math.max(input.repRange.min, achieved));
  return {
    nextLoadKg: input.currentLoadKg,
    nextReps: reps,
    rationale: atCeiling
      ? "Mantener activo: repetir la carga en el tope del rango (el motor habría subido carga)."
      : "Mantener activo: repetir la carga (el motor habría subido carga).",
    explain: {
      rule: atCeiling ? "hold-at-ceiling" : "hold",
      inputs: { cargaKg: input.currentLoadKg, cargaQueHabriaSubidoKg: p.nextLoadKg, repsLogradas: achieved, topeRango: input.repRange.max },
    },
  };
}

/**
 * A5.4: ¿salió del modo Mantener? Sí si en TODAS las series de progresión de
 * la sesión la carga real superó la prescrita (`targetLoadKg`, A0.1) en al
 * menos un paso del equipamiento. Una sola serie más pesada no alcanza.
 */
export function holdExitDetected(sessionLogs: SetLog[], ctx: { type: EquipmentType; equipment: Equipment }): boolean {
  const sets = sessionLogs.filter((l) => isProgressionSet(l) && l.targetLoadKg > 0);
  if (sets.length === 0) return false;
  return sets.every((l) => {
    const step = nextAchievableLoad(l.targetLoadKg, ctx);
    return step > l.targetLoadKg && l.actualLoadKg >= step - 1e-9;
  });
}

function prescribe(input: NextPrescriptionInput): Prescription {
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

  // Deciden la progresión solo las series de trabajo/fallo hechas con la carga
  // de trabajo de la sesión (la más alta). Calentamiento, drop, parciales y una
  // bajada de carga dentro de la sesión no entran al mínimo de reps (H2).
  const sessions = progressionSessions(input.exerciseHistory);
  if (sessions.length === 0) {
    const reanchored = continuityReanchor(input, repRange, targetRir);
    if (reanchored) return reanchored;
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: repRange.min,
      rationale: "Sin historial: usar carga inicial y piso del rango.",
      explain: { rule: "no-history", inputs: { cargaInicialKg: input.currentLoadKg, pisoReps: repRange.min } },
    };
  }

  // targetRir queda aplicado en los targets de la sesión; la progresión de
  // carga/reps se rige por reps logradas y el rango, no por el RIR en sí.
  void targetRir;
  if (input.slotProgression === "apre") {
    return apreProgression(input, sessions, repRange);
  }
  if (model === "block") {
    const reanchor = blockPhaseReanchor(input, sessions, repRange, targetRir);
    if (reanchor) return reanchor;
  }
  if (model === "linear") {
    return linearProgression(input, sessions, repRange);
  }
  return doubleProgression(input, sessions, repRange);
}

/**
 * Sesiones (ordenadas) con las series que deciden la progresión: trabajo o
 * fallo, y dentro de cada sesión solo las hechas con su carga de trabajo.
 */
export function progressionSessions(history: SetLog[]): SetLog[][] {
  return groupBySession(history.filter(isProgressionSet))
    .map((s) => {
      const top = Math.max(...s.map((l) => l.actualLoadKg));
      return s.filter((l) => l.actualLoadKg === top);
    })
    .filter((s) => s.length > 0);
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
    const achieved = achievedReps(last);
    const target = input.currentLoadKg * (1 + cfg.loadIncrementPctPerSession / 100);
    const rounded = roundToAvailable(target, ctx);
    if (rounded > input.currentLoadKg) {
      // El redondeo queda por debajo del objetivo: el salto es proporcional.
      return {
        nextLoadKg: rounded,
        nextReps: repRange.min,
        rationale: "Objetivo cumplido: subir carga al incremento disponible.",
        explain: {
          rule: "linear-hit",
          inputs: { cargaAnteriorKg: input.currentLoadKg, cargaNuevaKg: rounded, incrementoObjetivoPct: cfg.loadIncrementPctPerSession },
        },
      };
    }
    const next = nextAchievableLoad(input.currentLoadKg, ctx);
    if (next <= input.currentLoadKg) {
      // Sin salto de carga posible (peso corporal / inventario agotado): reps.
      return bodyweightReps(input, achieved, repRange, "linear-no-jump");
    }
    // F6: si el salto mínimo excede el % objetivo, sumar reps (cada rep sobre el
    // piso acredita el % por sesión) y saltar recién cuando el crédito alcanza
    // o se llega al tope del rango, que es un límite duro (auditoría H1).
    const minJumpPct = ((next - input.currentLoadKg) / input.currentLoadKg) * 100;
    const creditPct = (Math.max(0, achieved - repRange.min) + 1) * cfg.loadIncrementPctPerSession;
    if (creditPct < minJumpPct && achieved < repRange.max) {
      const nextReps = Math.min(repRange.max, Math.max(repRange.min, achieved + 1));
      return {
        nextLoadKg: input.currentLoadKg,
        nextReps,
        rationale: `El salto mínimo de tu equipamiento (+${minJumpPct.toFixed(1)}%) supera el ${cfg.loadIncrementPctPerSession}% por sesión: sumar una rep antes de subir carga.`,
        explain: {
          rule: "linear-add-rep",
          inputs: { repsLogradas: achieved, saltoMinimoPct: +minJumpPct.toFixed(1), incrementoObjetivoPct: cfg.loadIncrementPctPerSession, topeRango: repRange.max },
        },
      };
    }
    const large = creditPct < minJumpPct;
    return {
      nextLoadKg: next,
      nextReps: repRange.min,
      rationale: large
        ? `Tope del rango alcanzado: subir carga. El salto mínimo de tu equipamiento es grande (+${minJumpPct.toFixed(1)}%): si no llegás a ${repRange.min} reps, repetí la carga.`
        : "Objetivo cumplido con reps de sobra: subir carga al incremento disponible.",
      explain: {
        rule: large ? "linear-hit-large-jump" : "linear-hit",
        inputs: { cargaAnteriorKg: input.currentLoadKg, cargaNuevaKg: next, saltoMinimoPct: +minJumpPct.toFixed(1), incrementoObjetivoPct: cfg.loadIncrementPctPerSession },
      },
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
      explain: { rule: "linear-stalled", inputs: { sesionesSinProgreso: recentFails, umbral: cfg.failToProgressThreshold } },
    };
  }
  return {
    nextLoadKg: input.currentLoadKg,
    nextReps: repRange.min,
    rationale: "Objetivo no cumplido: repetir carga.",
    explain: { rule: "linear-miss", inputs: { repsLogradas: achievedReps(last), cargaKg: input.currentLoadKg } },
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
  const rangeCap = rirCapForRepRange(repRange, cfg);
  const reported = sessions.flat().filter((l) => isRirReported(l) && l.actualLoadKg > 0);
  const e1rmRef = reported.length
    ? Math.max(...reported.map((l) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, input.rules)))
    : 0;
  const reps = rirAdjustedReps(
    last,
    input.rirCapOverride !== undefined ? Math.min(rangeCap, input.rirCapOverride) : rangeCap,
    input.rules.rirCalibration.highRirDampenFrom,
    { e1rmKg: e1rmRef, belowPct: input.rules.rirCalibration.lowLoadDampenBelowPctE1rm },
  );

  if (reps < repRange.max) {
    // Debajo del tope (en reps ajustadas por RIR): subir reps a misma carga.
    // El próximo objetivo nunca supera el tope acá: si llegaste a las reps
    // moliéndote (RIR real < objetivo), esto prescribe REPETIR, no subir.
    const rawReps = achievedReps(last);
    const next = Math.min(
      repRange.max,
      Math.max(reps, rawReps) + cfg.repStepWhenBelowCeiling,
    );
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: Math.max(repRange.min, next),
      rationale:
        reps < rawReps
          ? "Llegaste a las reps pero más cerca del fallo que el objetivo: consolidar antes de subir."
          : "Debajo del tope del rango: subir reps a misma carga.",
      explain: {
        rule: reps < rawReps ? "double-consolidate" : "double-below-ceiling",
        inputs: {
          repsLogradas: rawReps,
          repsAjustadasPorRir: reps,
          topeRango: repRange.max,
          cargaKg: input.currentLoadKg,
        },
      },
    };
  }

  // Tope alcanzado: evaluar si el salto mínimo de carga es proporcional al % objetivo.
  const nextLoad = nextAchievableLoad(input.currentLoadKg, ctx);
  if (nextLoad <= input.currentLoadKg) {
    return bodyweightReps(input, reps, repRange, "double-no-jump");
  }
  const minJumpPct =
    ((nextLoad - input.currentLoadKg) / input.currentLoadKg) * 100;
  const surplus = reps - repRange.max;
  // Cada rep por encima del tope "acredita" ~loadIncrementPct de progreso.
  const creditPct = (surplus + 1) * cfg.loadIncrementPctOnRepCeiling;
  const jumpIsProportional = creditPct >= minJumpPct;

  // Colchón OPCIONAL (maxRepsOverCeiling > 0): solo si el salto es
  // desproporcionado y todavía quedan reps de colchón, sumar una rep sobre el
  // tope. Con el default 0 este bloque nunca corre: el rango del usuario es
  // un límite duro.
  if (!jumpIsProportional && surplus < cfg.maxRepsOverCeiling) {
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: reps + cfg.repStepWhenBelowCeiling,
      rationale: `El salto mínimo de tu equipamiento (+${minJumpPct.toFixed(1)}%) es grande: sumo una rep sobre el tope (colchón ${surplus + 1}/${cfg.maxRepsOverCeiling}) antes de subir carga.`,
      explain: {
        rule: "double-cushion",
        inputs: { saltoMinimoPct: +minJumpPct.toFixed(1), colchonUsado: surplus + 1, colchonMax: cfg.maxRepsOverCeiling },
      },
    };
  }

  // Tope alcanzado → subir carga al mínimo alcanzable y volver al piso.
  // Si el salto es grande se avisa: puede que no se llegue al piso, y en ese
  // caso la rama "debajo del tope" repite la carga hasta consolidar.
  return {
    nextLoadKg: nextLoad,
    nextReps: repRange.min,
    rationale: jumpIsProportional
      ? "Tope del rango alcanzado: subir carga y volver al piso del rango."
      : `Tope del rango alcanzado: subir carga. El salto mínimo de tu equipamiento es grande (+${minJumpPct.toFixed(1)}%): si no llegás a ${repRange.min} reps, la próxima repite la carga hasta consolidar.`,
    explain: {
      rule: jumpIsProportional ? "double-ceiling" : "double-ceiling-large-jump",
      inputs: {
        repsAjustadasPorRir: reps,
        topeRango: repRange.max,
        cargaAnteriorKg: input.currentLoadKg,
        cargaNuevaKg: nextLoad,
        saltoMinimoPct: +minJumpPct.toFixed(1),
        incrementoObjetivoPct: cfg.loadIncrementPctOnRepCeiling,
      },
    },
  };
}

/**
 * Sin salto de carga posible (peso corporal o inventario agotado): la única
 * progresión es sumar reps, hasta el máximo de reps con evidencia de
 * hipertrofia (`repRanges.globalValid.max`, SCIENCE §3). Ahí se sugiere lastre
 * o una variante más difícil en vez de seguir sumando (auditoría M6).
 */
function bodyweightReps(
  input: NextPrescriptionInput,
  achieved: number,
  repRange: RepRange,
  rule: "linear-no-jump" | "double-no-jump",
): Prescription {
  const cap = input.rules.repRanges.globalValid.max;
  const step = input.rules.progressionModels.double.repStepWhenBelowCeiling;
  if (achieved >= cap) {
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: cap,
      rationale: `Llegaste a ${cap} reps sin carga para sumar: más reps ya no aportan más estímulo. Agregá lastre o pasá a una variante más difícil.`,
      explain: { rule: "bodyweight-cap", inputs: { repsLogradas: achieved, maxRepsEvidencia: cap, cargaKg: input.currentLoadKg } },
    };
  }
  return {
    nextLoadKg: input.currentLoadKg,
    nextReps: Math.min(cap, Math.max(repRange.min, achieved + step)),
    rationale: "Sin incremento de carga disponible: sumar reps.",
    explain: { rule, inputs: { repsLogradas: achieved, topeRango: repRange.max, maxRepsEvidencia: cap, cargaKg: input.currentLoadKg } },
  };
}

/**
 * Bloques (auditoría M2): al cambiar de fase el rango cambia a propósito y el
 * historial queda fuera del rango nuevo. Si las reps PRESCRITAS de la última
 * sesión no caen en el rango de la fase actual, se re-ancla la carga: e1RM de
 * la última sesión (Epley ajustado por RIR) invertido para el piso del rango
 * nuevo al RIR objetivo, redondeado al equipamiento. null = misma fase.
 */
function blockPhaseReanchor(
  input: NextPrescriptionInput,
  sessions: SetLog[][],
  repRange: RepRange,
  targetRir: number,
): Prescription | null {
  // Peso corporal: no hay carga que re-anclar (la UI guarda el peso corporal
  // como carga, así que no alcanza con mirar actualLoadKg; N1).
  if (input.equipmentType === "bodyweight" || input.currentLoadKg === 0) return null;
  const { weekIndex, historyWeekIndex, numAccumulationWeeks } = input;
  if (weekIndex === undefined || historyWeekIndex === undefined || numAccumulationWeeks === undefined) return null;
  const before = blockPhaseForWeek(input.rules, historyWeekIndex, input.historyNumAccumulationWeeks ?? numAccumulationWeeks);
  const now = blockPhaseForWeek(input.rules, weekIndex, numAccumulationWeeks);
  if (before.name === now.name) return null; // misma fase: progresión normal (N2)
  const last = sessions[sessions.length - 1];
  const prescribed = Math.max(...last.map((l) => l.targetReps));
  const loaded = last.filter((l) => l.actualLoadKg > 0);
  if (loaded.length === 0) return null;
  const e1rm = Math.max(...loaded.map((l) => estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, input.rules)));
  const ctx = { type: input.equipmentType, equipment: input.equipment };
  const next = loadForTarget(e1rm, repRange.min, Math.max(0, targetRir), input.rules, ctx);
  if (next <= 0) return null;
  return {
    nextLoadKg: next,
    nextReps: repRange.min,
    rationale: `Nueva fase del bloque (${repRange.min}–${repRange.max} reps): carga re-anclada desde tu 1RM estimado de la última sesión.`,
    explain: {
      rule: "block-phase-reanchor",
      inputs: { repsPrescritasAntes: prescribed, pisoReps: repRange.min, topeRango: repRange.max, e1rmKg: +e1rm.toFixed(1), cargaAnteriorKg: input.currentLoadKg, cargaNuevaKg: next },
    },
  };
}

/**
 * A5.1: re-anclaje al empezar una pista nueva (otro rango/intensidad/modelo) o
 * tras una pausa larga. e1RM de la última sesión real del ejercicio (Epley
 * ajustado por RIR) × descuento si hubo pausa, invertido para el piso del
 * rango al RIR objetivo y redondeado. null en peso corporal o sin carga.
 */
function continuityReanchor(input: NextPrescriptionInput, repRange: RepRange, targetRir: number): Prescription | null {
  const a = input.anchor;
  if (!a || input.equipmentType === "bodyweight" || input.currentLoadKg === 0) return null;
  const loaded = a.logs.filter((l) => l.actualLoadKg > 0);
  if (loaded.length === 0) return null;
  const cfg = input.rules.progression.continuity;
  const best = loaded.reduce((b, l) => {
    const e = estimate1RM(l.actualLoadKg, l.actualReps, l.actualRir, input.rules);
    return e > b.e ? { e, l } : b;
  }, { e: 0, l: loaded[0] });
  const paused = a.reason === "gap" || (a.ageDays ?? 0) > cfg.maxGapDays;
  const factor = paused ? cfg.gapE1rmFactor : 1;
  const ctx = { type: input.equipmentType, equipment: input.equipment };
  const next = loadForTarget(best.e * factor, repRange.min, Math.max(0, targetRir), input.rules, ctx);
  if (next <= 0) return null;
  const rule = a.reason === "gap" ? ("gap-reanchor" as const) : ("track-reanchor" as const);
  return {
    nextLoadKg: next,
    nextReps: repRange.min,
    rationale:
      rule === "gap-reanchor"
        ? `Volvés después de ${a.ageDays ?? "varios"} días: carga estimada desde tu 1RM de la última sesión, con un ${Math.round((1 - factor) * 100)}% de margen.`
        : `Pista nueva para este ejercicio (${repRange.min}–${repRange.max} reps): carga estimada desde tu 1RM de la última sesión real${paused ? `, con un ${Math.round((1 - factor) * 100)}% de margen por la pausa` : ""}.`,
    explain: {
      rule,
      inputs: {
        cargaOrigenKg: best.l.actualLoadKg,
        repsOrigen: best.l.actualReps,
        rirOrigen: best.l.actualRir,
        e1rmKg: +best.e.toFixed(1),
        factor,
        pisoReps: repRange.min,
        rirObjetivo: Math.max(0, targetRir),
        cargaNuevaKg: next,
        ...(a.ageDays !== undefined ? { diasDesdeLaUltima: a.ageDays } : {}),
      },
    },
  };
}

/**
 * APRE (A2.8): la última serie de la sesión anterior es AMRAP y sus reps
 * deciden la carga: debajo del piso baja, dentro del rango se mantiene, sobre
 * el tope sube (más si lo superó por mucho). Porcentajes desde config `apre`.
 * Todas las series siguientes apuntan al piso del rango; la última vuelve a ser
 * AMRAP (la marca el plan).
 */
function apreProgression(input: NextPrescriptionInput, sessions: SetLog[][], repRange: RepRange): Prescription {
  const cfg = input.rules.apre;
  const ctx = { type: input.equipmentType, equipment: input.equipment };
  const last = sessions[sessions.length - 1];
  const amrap = [...last].sort((a, b) => a.setIndex - b.setIndex).at(-1)!;
  const r = amrap.actualReps;
  const pct =
    r < repRange.min
      ? cfg.belowMinPct
      : r <= repRange.max
        ? cfg.inRangePct
        : r >= repRange.max + cfg.wellAboveMaxReps
          ? cfg.wellAboveMaxPct
          : cfg.aboveMaxPct;
  let next = pct === 0 ? input.currentLoadKg : roundToAvailable(input.currentLoadKg * (1 + pct / 100), ctx);
  if (pct > 0 && next <= input.currentLoadKg) next = nextAchievableLoad(input.currentLoadKg, ctx);
  return {
    nextLoadKg: next,
    nextReps: repRange.min,
    rationale:
      pct > 0
        ? `APRE: la serie AMRAP llegó a ${r} reps (tope ${repRange.max}): subir carga.`
        : pct < 0
          ? `APRE: la serie AMRAP quedó en ${r} reps (piso ${repRange.min}): bajar carga.`
          : `APRE: la serie AMRAP quedó dentro del rango (${r} reps): mantener carga.`,
    explain: {
      rule: "apre",
      inputs: { repsAmrap: r, pisoReps: repRange.min, topeRango: repRange.max, ajustePct: pct, cargaAnteriorKg: input.currentLoadKg, cargaNuevaKg: next },
    },
  };
}
