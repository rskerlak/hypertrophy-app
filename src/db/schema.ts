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
  MesoIntent,
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
  /** Unidad para MOSTRAR cargas (A4.7). Todo se guarda en kg. */
  units?: "kg" | "lb";
  /** Perfiles de gimnasio (A4.5). `equipment` es siempre el del perfil activo. */
  equipmentProfiles?: Array<{ id: string; name: string; equipment: Equipment }>;
  activeEquipmentProfileId?: string;
  /** Días de entrenamiento para la agenda (0 = domingo … 6 = sábado). Solo agenda. */
  trainingWeekdays?: number[];
  /** El usuario declara seguros/spotter en barra libre: habilita APRE (serie al fallo) en barra. */
  barbellFailureAllowed?: boolean;
  onboarded: boolean;
  /** Versión de la biblioteca de ejercicios sembrada; dispara re-seed al cambiar. */
  seedVersion?: number;
  /** Altura en cm (se pide una vez en el onboarding; editable en Ajustes). */
  heightCm?: number;
  /** ISO datetime del último respaldo exportado (para el recordatorio). */
  lastBackupAt?: string;
  /** Tema de la UI. Default: claro. */
  theme?: "light" | "dark";
}

/** Actividad extra fuera del plan (cardio, deporte): opcional, no toca el meso. */
export interface ActivityRow {
  id: string;
  /** ISO date de la actividad. */
  date: string;
  type: "running" | "swimming" | "cycling" | "walking" | "sport" | "other";
  durationMin?: number;
  /** 1 = suave · 2 = moderada · 3 = intensa */
  intensity?: 1 | 2 | 3;
  note?: string;
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
  /** paused: empezado pero suspendido para intercalar otro meso; se puede reanudar. */
  status: "planned" | "active" | "paused" | "completed";
  plan: MesocyclePlan;
  /** id del meso del que este es continuación (progresión de cargas heredada). */
  continuedFromId?: string;
  /** Intención declarada (A5.3); ausente = hipertrofia. Solo la usa la memoria larga. */
  intent?: MesoIntent;
}

/**
 * Bug anotado por el usuario desde la app. Viaja en el respaldo JSON para
 * poder reproducirlo después con los mismos datos (ruta, sesión, versión).
 */
export interface BugReportRow {
  id: string;
  createdAt: string;
  status: "open" | "resolved";
  category: "engine" | "ui" | "data" | "other";
  text: string;
  /** Ruta + query donde se anotó (ej. /session?id=…). */
  route: string;
  /** SHA corto del build que estaba corriendo. */
  buildSha: string;
  context: {
    activeMesocycleId?: string;
    activeMesocycleName?: string;
    sessionId?: string;
    sessionWeekIndex?: number;
    sessionDayLabel?: string;
    viewport?: string;
    visualViewport?: string;
    standalone?: boolean;
    userAgent?: string;
  };
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
  /** Primera serie registrada (sesión "en curso"); para duración y Home. */
  startedAt?: string;
  /** Última serie registrada; el timer de descanso sobrevive recargas. */
  lastSetAt?: string;
  /** A5.4: ejercicios que salieron de "Mantener" al completar esta sesión (cargaste más). */
  holdExits?: string[];
  /** Cambios SOLO para esta sesión (no tocan el plan). */
  overrides?: {
    /** Ejercicio reemplazado hoy en un slot. */
    exercise?: Array<{ slotIndex: number; exerciseId: string }>;
    /** Series agregadas (+) o quitadas (−) hoy en un slot. */
    setsDelta?: Array<{ slotIndex: number; delta: number }>;
    /** Deload por ejercicio aplicado a esta sesión: factor de series y carga. */
    exerciseDeload?: Array<{ slotIndex: number; setsFactor: number; loadFactor: number }>;
  };
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
  activities!: EntityTable<ActivityRow, "id">;
  bugReports!: EntityTable<BugReportRow, "id">;

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
    // v3: actividades extra (cardio/deporte) opcionales, correlacionables.
    this.version(3).stores({
      activities: "id, date",
    });
    // v4: bugs anotados por el usuario (viajan en el respaldo JSON).
    this.version(4).stores({
      bugReports: "id, createdAt, status",
    });
  }
}

let _db: HypertrophyDB | null = null;

/** Instancia singleton. Solo se crea en el navegador (IndexedDB). */
export function getDb(): HypertrophyDB {
  if (!_db) _db = new HypertrophyDB();
  return _db;
}
