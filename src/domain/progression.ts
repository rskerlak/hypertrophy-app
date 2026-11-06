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
import { isRirReported, isWorkingSet } from "./types";
import { estimate1RM } from "./oneRepMax";

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
   * Tope del ajuste por RIR ya corregido por la calibración medida del usuario
   * (ver rirCalibration). Si se omite, se usa el del config por rango de reps.
   */
  rirCapOverride?: number;
  /** "apre": la carga sale de las reps de la serie AMRAP (A2.8). */
  slotProgression?: "default" | "apre";
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
  | "linear-miss"
  | "double-below-ceiling"
  | "double-consolidate"
  | "double-no-jump"
  | "double-cushion"
  | "double-ceiling"
  | "double-ceiling-large-jump"
  | "deload-first-half"
  | "deload-second-half"
  | "apre";

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

  // Las series de aproximación no son estímulo medido: nunca deciden la progresión.
  const sessions = groupBySession(input.exerciseHistory.filter(isWorkingSet));
  if (sessions.length === 0) {
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
        explain: { rule: "linear-no-jump", inputs: { repsLogradas: achievedReps(last), cargaKg: input.currentLoadKg } },
      };
    }
    return {
      nextLoadKg: next,
      nextReps: repRange.min,
      rationale: "Objetivo cumplido: subir carga al incremento disponible.",
      explain: {
        rule: "linear-hit",
        inputs: { cargaAnteriorKg: input.currentLoadKg, cargaNuevaKg: next, incrementoObjetivoPct: cfg.loadIncrementPctPerSession },
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
    return {
      nextLoadKg: input.currentLoadKg,
      nextReps: reps + cfg.repStepWhenBelowCeiling,
      rationale: "Sin incremento de carga disponible: seguir añadiendo reps.",
      explain: { rule: "double-no-jump", inputs: { repsAjustadasPorRir: reps, topeRango: repRange.max, cargaKg: input.currentLoadKg } },
    };
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
