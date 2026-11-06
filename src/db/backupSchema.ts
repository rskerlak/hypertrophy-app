// Validación del archivo de respaldo (A4.1). Sin Dexie ni React: solo Zod,
// para poder testearlo y para rechazar un archivo corrupto ANTES de borrar nada.
//
// Los límites de abajo son de cordura de datos (un registro fuera de ellos es
// un error de tipeo o un archivo dañado), no parámetros de entrenamiento: los
// umbrales científicos siguen viviendo en rules.config.json.

import { z } from "zod";

const DATA_LIMITS = { maxReps: 100, maxRir: 10, maxLoadKg: 2000 } as const;

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
const index = z.number().int().min(0);

const settingsRow = z
  .object({
    id: z.literal("default"),
    experienceProfile: z.enum(["novice", "intermediate", "advanced"]),
    bodyweightKg: z.number().finite().min(0),
    prioritizedMuscles: z.array(z.string()),
    equipment: z
      .object({
        barWeightKg: z.number().min(0),
        platesKg: z.array(z.number().gt(0)),
        dumbbellsKg: z.array(z.number().gt(0)),
        machineStepKg: z.number().min(0),
      })
      .passthrough(),
    trainingWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
  })
  .passthrough();

const baseWeekRow = z
  .object({
    id: z.literal("default"),
    days: z.array(
      z
        .object({
          label: z.string(),
          slots: z.array(
            z
              .object({
                exerciseId: id,
                targetSets: z.number().int().min(0),
                repRange: z.object({ min: reps, max: reps }).refine((r) => r.min <= r.max, { message: "rango de reps con mín > máx" }),
                startingLoadKg: load,
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const exerciseRow = z
  .object({
    id,
    name: z.string().min(1),
    primaryMuscle: z.string().min(1),
    secondaryMuscles: z.array(z.string()),
    equipmentType: z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight"]),
    isSwappable: z.boolean(),
    swapCandidates: z.array(z.string()),
  })
  .passthrough();

const mesocycleRow = z
  .object({
    id,
    name: z.string(),
    createdAt: isoDate,
    numAccumulationWeeks: z.number().int().min(1),
    progressionModel: z.enum(["linear", "double", "dup", "block"]),
    status: z.enum(["planned", "active", "paused", "completed"]),
    plan: z.object({ weeks: z.array(z.object({ weekIndex: index, isDeload: z.boolean(), days: z.array(z.unknown()) }).passthrough()) }).passthrough(),
  })
  .passthrough();

const sessionRow = z
  .object({
    id,
    mesocycleId: id,
    weekIndex: index,
    dayIndex: index,
    dayLabel: z.string(),
    isDeload: z.boolean(),
    status: z.enum(["pending", "completed", "skipped"]),
    plannedDate: isoDate.optional(),
    completedAt: isoDate.optional(),
    startedAt: isoDate.optional(),
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
    side: z.enum(["L", "R"]).optional(),
    timestamp: isoDate,
  })
  .passthrough();

const checkinRow = z
  .object({
    id,
    sessionId: z.string(),
    date: z.string(),
    sleptMinimum: z.boolean().nullable(),
    proteinSufficient: z.boolean().nullable(),
    energyBalance: z.enum(["surplus", "maintenance", "deficit"]).nullable(),
  })
  .passthrough();

const looseRow = z.object({ id }).passthrough();

export const backupFileSchema = z.object({
  app: z.literal("hypertrophy", { errorMap: () => ({ message: "no es un respaldo de esta app" }) }),
  backupVersion: z.number().refine((v) => (SUPPORTED_BACKUP_VERSIONS as readonly number[]).includes(v), {
    message: "versión de respaldo no soportada por esta versión de la app",
  }),
  exportedAt: z.string().optional(),
  data: z.object({
    settings: z.array(settingsRow),
    baseWeek: z.array(baseWeekRow),
    exercises: z.array(exerciseRow),
    mesocycles: z.array(mesocycleRow),
    sessions: z.array(sessionRow),
    setLogs: z.array(setLogRow),
    checkins: z.array(checkinRow),
    measurements: z.array(looseRow.extend({ date: isoDate })).optional(),
    activities: z.array(looseRow.extend({ date: isoDate })).optional(),
    bugReports: z.array(looseRow).optional(),
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
