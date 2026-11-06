// Tipos del dominio. Este módulo (y todo src/domain/) es puro:
// sin React, sin Dexie, sin window, sin Date.now().

export type ExperienceProfileId = "novice" | "intermediate" | "advanced";
export type ProgressionModel = "linear" | "double" | "dup" | "block";
export type EquipmentType =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight";
export type ResistanceProfile = "stretch" | "mid" | "short";
export type DupDayType = "heavy" | "medium" | "light";
/**
 * Intensidad fija de un día de la semana base (independiente de DUP):
 * "heavy" = día fuerte (menos RIR, rangos de reps más bajos los define el
 * usuario por slot), "light" = día liviano (más RIR). Sin valor = normal.
 */
export type DayIntensity = "heavy" | "light";
/** Banda de RIR permitida en un meso: todo RIR planificado se acota a [min, max]. */
export interface RirBand {
  min: number;
  max: number;
}

export interface RepRange {
  min: number;
  max: number;
}

export interface Exercise {
  id: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  equipmentType: EquipmentType;
  resistanceProfile: ResistanceProfile;
  isSwappable: boolean;
  swapCandidates: string[];
  defaultRepRange?: RepRange;
  /** true si lo creó el usuario (se preserva en las migraciones de biblioteca). */
  custom?: boolean;
  /** Nota persistente del usuario ("asiento 4, agarre ancho"). */
  note?: string;
  /** Descanso propio en segundos (si falta, default por tipo desde config). */
  restSec?: number;
  /**
   * Archivado (auditoría M4): se "borró" pero tiene historial. No aparece en
   * listas ni selectores; sigue existiendo para que el historial conserve
   * nombre, músculos y volumen.
   */
  archived?: boolean;
  /** A5.5: zonas que este movimiento carga (si falta, se deriva del músculo con `pain.zonesByMuscle`). */
  loadedZones?: PainZone[];
  /** A5.4: "Mantener" — el motor no sube la carga de este ejercicio. */
  holdLoad?: boolean;
  /** Desde cuándo está en Mantener (ISO). */
  holdSince?: string;
}

/**
 * Tipo de serie. "warmup" (aproximación) NO cuenta para volumen, progresión,
 * calibración ni stats; drop/failure/partial sí son estímulo y cuentan.
 */
export type SetKind = "warmup" | "working" | "drop" | "failure" | "partial";

export interface Equipment {
  barWeightKg: number;
  platesKg: number[];
  /** Rack FIJO de mancuernas (cada valor es una mancuerna entera). */
  dumbbellsKg: number[];
  machineStepKg: number;
  /**
   * Discos POR LADO para mancuernas ARMABLES. Si tiene elementos, las
   * mancuernas se calculan como mango + 2×(discos combinados) y se ignora el
   * rack fijo. Es el caso de gimnasios con mancuernas de barra corta.
   */
  dumbbellPlatesKg?: number[];
  /** Peso del mango de mancuerna armable (kg). */
  dumbbellHandleKg?: number;
}

export interface BaseWeekSlot {
  /** Id estable del slot (A4.4): key de React al reordenar/borrar. Lo asigna el repository. */
  id?: string;
  exerciseId: string;
  targetSets: number;
  repRange: RepRange;
  startingLoadKg: number;
  /** Slots con el mismo grupo se hacen en superserie (descanso al cerrar el último). */
  supersetGroup?: string;
  /** Serie 1 más cerca del fallo como ancla de calibración (A2.4). */
  anchorSet?: boolean;
  /** "apre": la última serie es AMRAP y decide la carga siguiente (A2.8). */
  progression?: "default" | "apre";
}

export interface BaseWeekDay {
  label: string;
  slots: BaseWeekSlot[];
  intensity?: DayIntensity;
}

export interface BaseWeek {
  days: BaseWeekDay[];
}

export interface SetLog {
  id: string;
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  targetLoadKg: number;
  targetReps: number;
  targetRir: number;
  actualLoadKg: number;
  actualReps: number;
  actualRir: number;
  /**
   * false = el RIR es el valor precargado (objetivo) sin tocar: NO informa la
   * percepción del usuario. true = elegido/ajustado explícitamente. Ausente =
   * dato anterior a A1.11 (se asume reportado; la detección de eco lo cubre).
   */
  rirReported?: boolean;
  /** Tipo de serie; ausente = "working". */
  kind?: SetKind;
  /** Índice del slot en el día (distingue el mismo ejercicio dos veces en un día). */
  slotIndex?: number;
  /** Lado en ejercicios unilaterales. */
  side?: "L" | "R";
  note?: string;
  timestamp: string;
}

/** Serie de trabajo = todo salvo aproximación. Las de calentamiento no son estímulo medido. */
export function isWorkingSet(l: Pick<SetLog, "kind">): boolean {
  return l.kind !== "warmup";
}

/**
 * ¿Esta serie decide la progresión? Solo trabajo normal o al fallo. Las drop y
 * las parciales son estímulo (cuentan para volumen y stats) pero se hacen con
 * otra carga u otro ROM: si entraran al mínimo de reps, la carga se congelaría
 * (auditoría Plan A, H2).
 */
export function isProgressionSet(l: Pick<SetLog, "kind">): boolean {
  return l.kind === undefined || l.kind === "working" || l.kind === "failure";
}

/** ¿El RIR de esta serie informa la percepción del usuario? (ver SetLog.rirReported) */
export function isRirReported(l: Pick<SetLog, "rirReported">): boolean {
  return l.rirReported !== false;
}

/** Zona articular/tendinosa para el registro de dolor (A5.5). No es un diagnóstico. */
export type PainZone = "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "lower_back" | "neck" | "other";
export const PAIN_ZONES: PainZone[] = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "lower_back", "neck", "other"];

export interface Checkin {
  id: string;
  sessionId: string;
  date: string;
  /** A5.5: dolor articular/tendinoso por zona (0–10). [] = "no me duele nada". */
  pain?: Array<{ zone: PainZone; score: number }>;
  sleptMinimum: boolean | null;
  proteinSufficient: boolean | null;
  energyBalance: "surplus" | "maintenance" | "deficit" | null;
  readiness?: number | null;
  /** Fatiga física + mental percibida 1–5 (A2.2). Covariable; nunca cambia la sesión. */
  perceivedFatigue?: number | null;
  note?: string;
}

/**
 * Intención declarada de un meso (A5.3): la memoria larga no cuenta mesos de
 * mantenimiento o recuperación como estancamiento. No cambia la prescripción.
 */
export type MesoIntent = "hypertrophy" | "strength" | "maintenance" | "recovery";

// ---- Plan de mesociclo (output de generateMesocycle) ----

export interface PlannedSlot {
  exerciseId: string;
  /** Superserie heredada de la semana base. */
  supersetGroup?: string;
  /** RIR objetivo por serie cuando difiere del general (serie ancla, AMRAP de APRE). */
  setTargets?: Array<{ targetRir: number; amrap?: boolean }>;
  progression?: "default" | "apre";
  sets: number;
  repRange: RepRange;
  targetRir: number;
  targetLoadKg: number;
  dayType?: DupDayType;
  phase?: string;
}

export interface PlannedDay {
  label: string;
  slots: PlannedSlot[];
  intensity?: DayIntensity;
}

export interface PlannedWeek {
  weekIndex: number;
  isDeload: boolean;
  days: PlannedDay[];
  targetVolumeByMuscle: Record<string, number>;
  /** Solo en deload: política de carga (primera mitad carga de semana 1, segunda mitad fracción). */
  deloadLoadPolicy?: { firstHalf: "week1_load"; secondHalfFraction: number };
}

export interface MesocyclePlan {
  progressionModel: ProgressionModel;
  numAccumulationWeeks: number;
  weeks: PlannedWeek[];
  /** Banda de RIR elegida al generar (se conserva al recalcular/continuar). */
  rirBand?: RirBand;
}

// ---- Señales de fatiga / deload ----

/** Resumen por sesión que consume evaluateDeloadTrigger. Se construye con summarizeSessionPair. */
export interface SessionSummary {
  sessionId: string;
  /**
   * Día del split al que pertenece la sesión (ej. dayIndex del plan). Las
   * comparaciones de rendimiento se hacen contra la sesión previa del MISMO
   * día: comparar empuje con piernas no dice nada de fatiga.
   */
  dayKey?: string;
  /** nº de ejercicios que no igualaron reps de la sesión previa a carga fija */
  exercisesWithRepDropAtFixedLoad: number;
  /** mayor aumento de RIR reportado a carga fija vs sesión previa */
  maxRirIncreaseAtFixedLoad: number;
  readiness?: number | null;
  sleptMinimum?: boolean | null;
  perceivedFatigue?: number | null;
  /**
   * A5.6: hubo actividad externa intensa (natación, running…) en los días
   * previos a la sesión. Se calcula fuera del dominio y entra como dato. Solo
   * agrega una nota al motivo de deload; nunca cambia la decisión.
   */
  intenseActivityPrevDay?: boolean;
}

export interface DeloadEvaluation {
  shouldSuggest: boolean;
  reasons: string[];
  forced: boolean;
  /** Suma de pesos de las señales presentes (A2.1). */
  score?: number;
}

// ---- Stats ----

export interface MesoStats {
  perExercise: Array<{
    exerciseId: string;
    /** Etiqueta de la pista ("fuerte", "liviano" o "8–10") si el ejercicio tiene más de una. */
    track?: string;
    firstEst1RmKg: number;
    lastEst1RmKg: number;
    deltaPct: number;
  }>;
  perMuscle: Array<{ muscle: string; avgDeltaPct: number }>;
  volume: {
    plannedFractionalSets: number;
    completedFractionalSets: number;
    completionPct: number;
  };
  rirDrift: Array<{ weekIndex: number; meanDiff: number }>;
  fatigueTrajectory: Array<{
    exerciseId: string;
    loadKg: number;
    points: Array<{ weekIndex: number; reps: number }>;
  }>;
  adherence: {
    completed: number;
    skipped: number;
    pending: number;
    totalPlanned: number;
    pct: number;
  };
  smallSampleWarning: string;
  /**
   * % de series con RIR registrado === objetivo. Si es alto, el e1RM (que usa
   * el RIR) refleja el calendario de RIR más que la fuerza: la UI lo advierte.
   */
  rirEchoPct: number | null;
}
