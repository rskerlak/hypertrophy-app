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
}

export interface Equipment {
  barWeightKg: number;
  platesKg: number[];
  dumbbellsKg: number[];
  machineStepKg: number;
}

export interface BaseWeekSlot {
  exerciseId: string;
  targetSets: number;
  repRange: RepRange;
  startingLoadKg: number;
}

export interface BaseWeekDay {
  label: string;
  slots: BaseWeekSlot[];
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
  timestamp: string;
}

export interface Checkin {
  id: string;
  sessionId: string;
  date: string;
  sleptMinimum: boolean | null;
  proteinSufficient: boolean | null;
  energyBalance: "surplus" | "maintenance" | "deficit" | null;
  readiness?: number | null;
  note?: string;
}

// ---- Plan de mesociclo (output de generateMesocycle) ----

export interface PlannedSlot {
  exerciseId: string;
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
}

// ---- Señales de fatiga / deload ----

/** Resumen por sesión que consume evaluateDeloadTrigger. Se construye con summarizeSessionPair. */
export interface SessionSummary {
  sessionId: string;
  /** nº de ejercicios que no igualaron reps de la sesión previa a carga fija */
  exercisesWithRepDropAtFixedLoad: number;
  /** mayor aumento de RIR reportado a carga fija vs sesión previa */
  maxRirIncreaseAtFixedLoad: number;
  readiness?: number | null;
  sleptMinimum?: boolean | null;
}

export interface DeloadEvaluation {
  shouldSuggest: boolean;
  reasons: string[];
  forced: boolean;
}

// ---- Stats ----

export interface MesoStats {
  perExercise: Array<{
    exerciseId: string;
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
}
