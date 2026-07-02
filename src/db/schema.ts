// Esquema Dexie / IndexedDB. Única capa que toca la persistencia.
// El resto de la app pasa por los repositories (src/db/repositories.ts).

import Dexie, { type EntityTable } from "dexie";
import type {
  BaseWeek,
  Checkin,
  Equipment,
  Exercise,
  ExperienceProfileId,
  MesocyclePlan,
  ProgressionModel,
  SetLog,
} from "@/domain/types";

export interface SettingsRow {
  id: "default";
  experienceProfile: ExperienceProfileId;
  bodyweightKg: number;
  proteinTargetGperKg: number;
  minSleepHours: number;
  prioritizedMuscles: string[];
  equipment: Equipment;
  wakeLockEnabled: boolean;
  onboarded: boolean;
  /** Versión de la biblioteca de ejercicios sembrada; dispara re-seed al cambiar. */
  seedVersion?: number;
  /** Altura en cm (se pide una vez en el onboarding; editable en Ajustes). */
  heightCm?: number;
}

/** Registro de medidas corporales (circunferencias en cm, peso en kg). */
export interface MeasurementRow {
  id: string;
  /** ISO date del registro. */
  date: string;
  trigger: "onboarding" | "meso_end" | "periodic" | "manual";
  bodyweightKg?: number;
  waistCm?: number;
  /** Torso bajo los hombros (circunferencia de espalda/pecho por debajo del deltoides). */
  chestUnderShouldersCm?: number;
  /** Torso incluyendo hombros (circunferencia a la altura del deltoides). */
  shoulderGirthCm?: number;
  bicepCm?: number;
  quadCm?: number;
  calfCm?: number;
  note?: string;
}

export interface BaseWeekRow extends BaseWeek {
  id: "default";
}

export interface MesocycleRow {
  id: string;
  name: string;
  createdAt: string;
  numAccumulationWeeks: number;
  deloadWeeks: number;
  progressionModel: ProgressionModel;
  status: "planned" | "active" | "completed";
  plan: MesocyclePlan;
}

export interface SessionRow {
  id: string;
  mesocycleId: string;
  weekIndex: number;
  dayIndex: number;
  dayLabel: string;
  isDeload: boolean;
  plannedDate?: string;
  completedAt?: string;
  status: "pending" | "completed" | "skipped";
}

export class HypertrophyDB extends Dexie {
  settings!: EntityTable<SettingsRow, "id">;
  baseWeek!: EntityTable<BaseWeekRow, "id">;
  exercises!: EntityTable<Exercise, "id">;
  mesocycles!: EntityTable<MesocycleRow, "id">;
  sessions!: EntityTable<SessionRow, "id">;
  setLogs!: EntityTable<SetLog, "id">;
  checkins!: EntityTable<Checkin, "id">;
  measurements!: EntityTable<MeasurementRow, "id">;

  constructor() {
    super("hypertrophy");
    this.version(1).stores({
      settings: "id",
      baseWeek: "id",
      exercises: "id, primaryMuscle",
      mesocycles: "id, status, createdAt",
      sessions: "id, mesocycleId, status, [mesocycleId+weekIndex]",
      setLogs: "id, sessionId, exerciseId",
      checkins: "id, sessionId",
    });
    // v2: medidas corporales (circunferencias) para calibración longitudinal.
    this.version(2).stores({
      measurements: "id, date",
    });
  }
}

let _db: HypertrophyDB | null = null;

/** Instancia singleton. Solo se crea en el navegador (IndexedDB). */
export function getDb(): HypertrophyDB {
  if (!_db) _db = new HypertrophyDB();
  return _db;
}
