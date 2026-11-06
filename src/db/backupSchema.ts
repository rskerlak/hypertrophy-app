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
  maxActivityMin: 24 * 60,
  maxDistanceKm: 1000,
  maxHeartRate: 250,
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
// Primero el tope (sobre elementos sin validar, barato) y recién después cada
// elemento: `z.array(item).max(n)` valida TODO antes de mirar el largo y una
// lista anidada enorme agotaba la memoria (auditoría R-02).
const list = <T extends z.ZodTypeAny>(item: T, max: number = DATA_LIMITS.maxRows) =>
  z.array(z.unknown()).max(max, "demasiadas filas").pipe(z.array(item));
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
    holdLoad: z.boolean().optional(),
    loadedZones: list(z.enum(["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "lower_back", "neck", "other"]), 9).optional(),
    holdSince: isoDate.optional(),
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
    intent: z.enum(["hypertrophy", "strength", "maintenance", "recovery"]).optional(),
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
    holdExits: list(id, DATA_LIMITS.maxSlotsPerDay).optional(),
    // Cambios "solo hoy" (A1): sin validar, un factor de 1e9 rompe el redondeo (R-01).
    overrides: z
      .object({
        exercise: list(z.object({ slotIndex: index, exerciseId: id }).passthrough(), DATA_LIMITS.maxSlotsPerDay).optional(),
        setsDelta: list(
          z.object({ slotIndex: index, delta: z.number().int().min(-DATA_LIMITS.maxSetsPerSlot).max(DATA_LIMITS.maxSetsPerSlot) }).passthrough(),
          DATA_LIMITS.maxSlotsPerDay,
        ).optional(),
        exerciseDeload: list(
          z.object({ slotIndex: index, setsFactor: z.number().min(0).max(1), loadFactor: z.number().min(0).max(1) }).passthrough(),
          DATA_LIMITS.maxSlotsPerDay,
        ).optional(),
        painAdjust: list(
          z
            .object({
              slotIndex: index,
              loadFactor: z.number().min(0.5).max(1),
              repsUp: z.number().int().min(0).max(10),
              rirDelta: z.number().int().min(0).max(3),
              zone: shortText,
            })
            .passthrough(),
          DATA_LIMITS.maxSlotsPerDay,
        ).optional(),
      })
      .passthrough()
      .optional(),
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
    pain: list(z.object({ zone: z.enum(["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "lower_back", "neck", "other"]), score: z.number().int().min(0).max(10) }).passthrough(), 9).optional(),
    note: longText.optional(),
  })
  .passthrough();

const datedRow = z.object({ id, date: isoDate, note: longText.optional() }).passthrough();

const hr = z.number().finite().min(0).max(DATA_LIMITS.maxHeartRate, "frecuencia cardíaca fuera de rango");
const activityRow = z
  .object({
    id,
    date: isoDate,
    type: z.enum(["running", "swimming", "cycling", "walking", "sport", "other", "strength_external"]),
    durationMin: z.number().finite().min(0).max(DATA_LIMITS.maxActivityMin, "duración fuera de rango").optional(),
    intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    note: longText.optional(),
    source: z.enum(["manual", "strava", "garmin"]).optional(),
    externalId: shortText.optional(),
    distanceKm: z.number().finite().min(0).max(DATA_LIMITS.maxDistanceKm, "distancia fuera de rango").optional(),
    avgHr: hr.optional(),
    maxHr: hr.optional(),
  })
  .passthrough();

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
    activities: list(activityRow).optional(),
    bugReports: list(bugReportRow, 10_000).optional(),
  }),
});

export type ValidatedBackup = z.infer<typeof backupFileSchema>;

export type BackupValidation = { ok: true; backup: ValidatedBackup } | { ok: false; error: string };

/**
 * Valida un respaldo y devuelve un mensaje legible que nombra tabla, fila y
 * campo del primer problema (ej. `setLogs[12].actualReps: reps fuera de rango`).
 */
const TABLES = {
  settings: { row: settingsRow, max: 1, required: true },
  baseWeek: { row: baseWeekRow, max: 1, required: true },
  exercises: { row: exerciseRow, max: 10_000, required: true },
  mesocycles: { row: mesocycleRow, max: 10_000, required: true },
  sessions: { row: sessionRow, max: DATA_LIMITS.maxRows, required: true },
  setLogs: { row: setLogRow, max: DATA_LIMITS.maxRows, required: true },
  checkins: { row: checkinRow, max: DATA_LIMITS.maxRows, required: true },
  measurements: { row: datedRow, max: DATA_LIMITS.maxRows, required: false },
  activities: { row: activityRow, max: DATA_LIMITS.maxRows, required: false },
  bugReports: { row: bugReportRow, max: 10_000, required: false },
} as const;

function fail(where: string, issue: z.ZodIssue, missingWhat: string): BackupValidation {
  const missing = issue.code === "invalid_type" && issue.received === "undefined";
  return { ok: false, error: `Respaldo inválido en ${where}: ${missing ? missingWhat : issue.message}.` };
}

/**
 * Valida un respaldo y devuelve un mensaje legible que nombra tabla, fila y
 * campo del primer problema (ej. `setLogs[12].actualReps: reps fuera de rango`).
 * Fila por fila y cortando en el primer error: Zod 3 acumula issues de TODAS
 * las filas antes de aplicar `.max()`, y un archivo armado de pocos MB podía
 * usar más de 1 GB de memoria (auditoría R-02).
 */
export function validateBackup(raw: unknown): BackupValidation {
  const header = z
    .object({
      app: backupFileSchema.shape.app,
      backupVersion: backupFileSchema.shape.backupVersion,
      exportedAt: backupFileSchema.shape.exportedAt,
      data: z.record(z.unknown()),
    })
    .safeParse(raw);
  if (!header.success) {
    const issue = header.error.issues[0];
    return fail(issue.path.join(".") || "archivo", issue, "falta el campo");
  }
  const data: Record<string, unknown[]> = {};
  for (const [table, spec] of Object.entries(TABLES)) {
    const rows = header.data.data[table];
    if (rows === undefined && !spec.required) continue;
    if (!Array.isArray(rows)) return { ok: false, error: `Respaldo inválido en ${table}: ${rows === undefined ? "falta la tabla" : "no es una lista"}.` };
    if (rows.length > spec.max) return { ok: false, error: `Respaldo inválido en ${table}: demasiadas filas.` };
    const out: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = (spec.row as z.ZodTypeAny).safeParse(rows[i]);
      if (!r.success) {
        const issue = r.error.issues[0];
        const rest = issue.path.join(".");
        return fail(`${table}[${i}]${rest ? `.${rest}` : ""}`, issue, "falta el campo");
      }
      out.push(r.data);
    }
    data[table] = out;
  }
  const backup = { ...header.data, data } as unknown as ValidatedBackup;
  return { ok: true, backup };
}
