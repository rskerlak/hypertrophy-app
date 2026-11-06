// Validación del archivo de respaldo (A4.1). Sin Dexie ni React: solo Zod,
// para poder testearlo y para rechazar un archivo corrupto ANTES de borrar nada.
//
// Los límites de abajo son de cordura de datos (un registro fuera de ellos es
// un error de tipeo o un archivo dañado), no parámetros de entrenamiento: los
// umbrales científicos siguen viviendo en rules.config.json.

import { z } from "zod";

export const DATA_LIMITS = {
  maxReps: 100,
  maxRir: 10,
  maxLoadKg: 2000,
  maxIndex: 1000,
  maxSetsPerSlot: 50,
  maxSlotsPerDay: 40,
  maxDaysPerWeek: 14,
  maxWeeks: 52,
  maxBarKg: 100,
  maxPlateKg: 100,
  maxDumbbellKg: 200,
  maxInventoryItems: 200,
  maxRestSec: 3600,
  maxNameChars: 200,
  maxTextChars: 4000,
  maxRows: 1_000_000,
  /** Tope del archivo antes de leerlo (un respaldo real de años pesa pocos MB). */
  maxFileBytes: 25 * 1024 * 1024,
} as const;

/** Versiones que este build sabe importar. Exporta siempre la última. */
export const SUPPORTED_BACKUP_VERSIONS = [1, 2] as const;
export const CURRENT_BACKUP_VERSION = 2;

const isoDate = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s)), {
    message: "fecha ISO inválida",
  });
const id = z.string().min(1, "id vacío");
const load = z.number().finite().min(0, "carga negativa").max(DATA_LIMITS.maxLoadKg, "carga fuera de rango");
const reps = z.number().finite().min(0, "reps negativas").max(DATA_LIMITS.maxReps, "reps fuera de rango");
const rir = z.number().finite().min(0, "RIR negativo").max(DATA_LIMITS.maxRir, "RIR fuera de rango");
const index = z.number().int().min(0).max(DATA_LIMITS.maxIndex);
const shortText = z.string().max(DATA_LIMITS.maxNameChars, "texto demasiado largo");
const longText = z.string().max(DATA_LIMITS.maxTextChars, "texto demasiado largo");
const list = <T extends z.ZodTypeAny>(item: T, max: number = DATA_LIMITS.maxRows) => z.array(item).max(max, "demasiadas filas");
const repRange = z.object({ min: reps, max: reps }).refine((r) => r.min <= r.max, { message: "rango de reps con mín > máx" });
const sets = z.number().int().min(0).max(DATA_LIMITS.maxSetsPerSlot, "series fuera de rango");

/** Inventario de equipamiento con topes de cordura (un disco de 1e7 kg congela el redondeo). */
export const equipmentSchema = z
  .object({
    barWeightKg: z.number().finite().min(0).max(DATA_LIMITS.maxBarKg, "barra fuera de rango"),
    platesKg: list(z.number().gt(0).max(DATA_LIMITS.maxPlateKg, "disco fuera de rango"), DATA_LIMITS.maxInventoryItems),
    dumbbellsKg: list(z.number().gt(0).max(DATA_LIMITS.maxDumbbellKg, "mancuerna fuera de rango"), DATA_LIMITS.maxInventoryItems),
    machineStepKg: z.number().finite().min(0).max(DATA_LIMITS.maxPlateKg, "paso de máquina fuera de rango"),
    dumbbellPlatesKg: list(z.number().gt(0).max(DATA_LIMITS.maxPlateKg, "disco fuera de rango"), DATA_LIMITS.maxInventoryItems).optional(),
    dumbbellHandleKg: z.number().finite().min(0).max(DATA_LIMITS.maxBarKg).optional(),
  })
  .passthrough();

const settingsRow = z
  .object({
    id: z.literal("default"),
    experienceProfile: z.enum(["novice", "intermediate", "advanced"]),
    bodyweightKg: z.number().finite().min(0).max(DATA_LIMITS.maxLoadKg),
    prioritizedMuscles: list(shortText, 100),
    equipment: equipmentSchema,
    equipmentProfiles: list(z.object({ id, name: shortText, equipment: equipmentSchema }).passthrough(), 50).optional(),
    activeEquipmentProfileId: shortText.optional(),
    units: z.enum(["kg", "lb"]).optional(),
    theme: z.enum(["light", "dark"]).optional(),
    trainingWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .passthrough();

const baseWeekRow = z
  .object({
    id: z.literal("default"),
    days: list(
      z
        .object({
          label: shortText,
          intensity: z.enum(["heavy", "light"]).optional(),
          slots: list(
            z.object({ exerciseId: id, targetSets: sets, repRange, startingLoadKg: load, id: shortText.optional() }).passthrough(),
            DATA_LIMITS.maxSlotsPerDay,
          ),
        })
        .passthrough(),
      DATA_LIMITS.maxDaysPerWeek,
    ),
  })
  .passthrough();

const exerciseRow = z
  .object({
    id,
    name: shortText.min(1),
    primaryMuscle: shortText.min(1),
    secondaryMuscles: list(shortText, 30),
    equipmentType: z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight"]),
    resistanceProfile: z.enum(["stretch", "mid", "short"]).optional(),
    isSwappable: z.boolean(),
    swapCandidates: list(shortText, 200),
    defaultRepRange: repRange.optional(),
    custom: z.boolean().optional(),
    archived: z.boolean().optional(),
    note: longText.optional(),
    restSec: z.number().finite().min(0).max(DATA_LIMITS.maxRestSec).optional(),
  })
  .passthrough();

const plannedSlot = z
  .object({
    exerciseId: id,
    sets,
    repRange,
    targetRir: rir,
    targetLoadKg: load,
    dayType: z.enum(["heavy", "medium", "light"]).optional(),
    supersetGroup: shortText.optional(),
    progression: z.enum(["default", "apre"]).optional(),
    setTargets: list(z.object({ targetRir: rir, amrap: z.boolean().optional() }).passthrough(), DATA_LIMITS.maxSetsPerSlot).optional(),
  })
  .passthrough();

const mesocycleRow = z
  .object({
    id,
    name: shortText,
    createdAt: isoDate,
    numAccumulationWeeks: z.number().int().min(1).max(DATA_LIMITS.maxWeeks, "semanas fuera de rango"),
    progressionModel: z.enum(["linear", "double", "dup", "block"]),
    status: z.enum(["planned", "active", "paused", "completed"]),
    plan: z
      .object({
        weeks: list(
          z
            .object({
              weekIndex: index,
              isDeload: z.boolean(),
              days: list(
                z.object({ label: shortText, intensity: z.enum(["heavy", "light"]).optional(), slots: list(plannedSlot, DATA_LIMITS.maxSlotsPerDay) }).passthrough(),
                DATA_LIMITS.maxDaysPerWeek,
              ),
            })
            .passthrough(),
          DATA_LIMITS.maxWeeks + 2,
        ),
      })
      .passthrough(),
    continuedFromId: shortText.optional(),
  })
  .passthrough();

const sessionRow = z
  .object({
    id,
    mesocycleId: id,
    weekIndex: index,
    dayIndex: index,
    dayLabel: shortText,
    isDeload: z.boolean(),
    status: z.enum(["pending", "completed", "skipped"]),
    plannedDate: isoDate.optional(),
    completedAt: isoDate.optional(),
    startedAt: isoDate.optional(),
    lastSetAt: isoDate.optional(),
  })
  .passthrough();

const setLogRow = z
  .object({
    id,
    sessionId: id,
    exerciseId: id,
    setIndex: index,
    targetLoadKg: load,
    targetReps: reps,
    targetRir: rir,
    actualLoadKg: load,
    actualReps: reps,
    actualRir: rir,
    rirReported: z.boolean().optional(),
    kind: z.enum(["warmup", "working", "drop", "failure", "partial"]).optional(),
    slotIndex: index.optional(),
    side: z.enum(["L", "R"]).optional(),
    note: longText.optional(),
    timestamp: isoDate,
  })
  .passthrough();

const checkinRow = z
  .object({
    id,
    sessionId: z.string().max(DATA_LIMITS.maxNameChars),
    date: shortText,
    sleptMinimum: z.boolean().nullable(),
    proteinSufficient: z.boolean().nullable(),
    energyBalance: z.enum(["surplus", "maintenance", "deficit"]).nullable(),
    readiness: z.number().int().min(1).max(5).nullable().optional(),
    perceivedFatigue: z.number().int().min(1).max(5).nullable().optional(),
    note: longText.optional(),
  })
  .passthrough();

const datedRow = z.object({ id, date: isoDate, note: longText.optional() }).passthrough();

const bugReportRow = z
  .object({
    id,
    createdAt: isoDate,
    status: z.enum(["open", "resolved"]),
    category: z.enum(["engine", "ui", "data", "other"]),
    text: longText,
    route: longText,
    buildSha: shortText,
    context: z
      .object({
        activeMesocycleId: shortText.optional(),
        activeMesocycleName: shortText.optional(),
        sessionId: shortText.optional(),
        sessionWeekIndex: index.optional(),
        sessionDayLabel: shortText.optional(),
        viewport: shortText.optional(),
        visualViewport: shortText.optional(),
        standalone: z.boolean().optional(),
        userAgent: longText.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const backupFileSchema = z.object({
  app: z.literal("hypertrophy", { errorMap: () => ({ message: "no es un respaldo de esta app" }) }),
  backupVersion: z.number().refine((v) => (SUPPORTED_BACKUP_VERSIONS as readonly number[]).includes(v), {
    message: "versión de respaldo no soportada por esta versión de la app",
  }),
  exportedAt: z.string().max(DATA_LIMITS.maxNameChars).optional(),
  data: z.object({
    settings: list(settingsRow, 1),
    baseWeek: list(baseWeekRow, 1),
    exercises: list(exerciseRow, 10_000),
    mesocycles: list(mesocycleRow, 10_000),
    sessions: list(sessionRow),
    setLogs: list(setLogRow),
    checkins: list(checkinRow),
    measurements: list(datedRow).optional(),
    activities: list(datedRow).optional(),
    bugReports: list(bugReportRow, 10_000).optional(),
  }),
});

export type ValidatedBackup = z.infer<typeof backupFileSchema>;

export type BackupValidation = { ok: true; backup: ValidatedBackup } | { ok: false; error: string };

/**
 * Valida un respaldo y devuelve un mensaje legible que nombra tabla, fila y
 * campo del primer problema (ej. `setLogs[12].actualReps: reps fuera de rango`).
 */
export function validateBackup(raw: unknown): BackupValidation {
  const r = backupFileSchema.safeParse(raw);
  if (r.success) return { ok: true, backup: r.data };
  const issue = r.error.issues[0];
  const path = issue.path;
  let where = "";
  if (path[0] === "data" && typeof path[1] === "string") {
    where = String(path[1]);
    if (typeof path[2] === "number") where += `[${path[2]}]`;
    const rest = path.slice(3).join(".");
    if (rest) where += `.${rest}`;
  } else {
    where = path.join(".") || "archivo";
  }
  const msg =
    issue.code === "invalid_type" && issue.received === "undefined"
      ? path.length === 2 && path[0] === "data"
        ? "falta la tabla"
        : "falta el campo"
      : issue.message;
  return { ok: false, error: `Respaldo inválido en ${where}: ${msg}.` };
}
