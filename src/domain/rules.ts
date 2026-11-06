// Schema Zod de rules.config.json. El shape del config es la fuente de verdad
// de todos los números científicos: NUNCA duplicar esos valores en código.
// Los campos que empiezan con "_" son documentación: se ignoran en la lógica
// (passthrough) pero no se borran del archivo.

import { z } from "zod";

const repRangeSchema = z.object({ min: z.number(), max: z.number() });

const landmarksSchema = z.object({
  mv: z.number(),
  mev: z.number(),
  mav: z.number(),
  mrv: z.number(),
});

const experienceProfileSchema = z
  .object({
    label: z.string(),
    volumeMultiplier: z.number().positive(),
    defaultProgressionModel: z.enum(["linear", "double", "dup", "block"]),
    defaultAccumulationWeeks: z.number().int().positive(),
    maxAccumulationWeeks: z.number().int().positive(),
    startingWeeklyVolumeTarget: z.literal("mev"),
    rampAggressiveness: z.number().min(0).max(1),
    pushToMrv: z.boolean().optional().default(false),
  })
  .passthrough();

export const rulesSchema = z
  .object({
    schemaVersion: z.string(),
    volumeCounting: z
      .object({
        directSetWeight: z.number(),
        synergistSetWeight: z.number(),
        softSessionCapFractionalSets: z.number().min(0).default(11),
      })
      .passthrough(),
    muscles: z.array(z.string()).nonempty(),
    volumeLandmarksBase: z.record(z.string(), landmarksSchema.or(z.any())),
    experienceProfiles: z.object({
      novice: experienceProfileSchema,
      intermediate: experienceProfileSchema,
      advanced: experienceProfileSchema,
    }),
    rirSchedule: z
      .object({
        byAccumulationLength: z.record(z.string(), z.array(z.number())),
        barbellRiskFloor: z.number(),
        selectableBand: z
          .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
          .default({ min: 0, max: 4 }),
      })
      .passthrough(),
    measurements: z
      .object({ weightTrendAlpha: z.number().gt(0).max(1) })
      .passthrough()
      .default({ weightTrendAlpha: 0.1 }),
    warmup: z
      .object({
        enabled: z.boolean(),
        scheme: z.array(z.object({ pct: z.number().gt(0).lt(1), reps: z.number().int().min(1) })),
        minWorkingLoadKg: z.number().min(0),
      })
      .passthrough()
      .default({ enabled: true, scheme: [{ pct: 0.5, reps: 8 }, { pct: 0.75, reps: 4 }], minWorkingLoadKg: 40 }),
    rest: z
      .object({
        defaultCompoundSec: z.number().int().min(0),
        defaultIsolationSec: z.number().int().min(0),
        minSec: z.number().int().min(0),
      })
      .passthrough()
      .default({ defaultCompoundSec: 120, defaultIsolationSec: 90, minSec: 60 }),
    dayIntensity: z
      .object({
        heavy: z.object({ label: z.string(), rirOffset: z.number().int() }).passthrough(),
        light: z.object({ label: z.string(), rirOffset: z.number().int() }).passthrough(),
        startingLoadReferenceRir: z.number().min(0),
      })
      .passthrough()
      .default({
        heavy: { label: "Fuerte", rirOffset: -1 },
        light: { label: "Liviano", rirOffset: 1 },
        startingLoadReferenceRir: 2,
      }),
    repRanges: z
      .object({
        compound: repRangeSchema,
        accessory: repRangeSchema,
        isolation: repRangeSchema,
        globalValid: repRangeSchema,
      })
      .passthrough(),
    progressionModels: z
      .object({
        linear: z
          .object({
            loadIncrementPctPerSession: z.number(),
            failToProgressThreshold: z.number().int(),
          })
          .passthrough(),
        double: z
          .object({
            loadIncrementPctOnRepCeiling: z.number(),
            repStepWhenBelowCeiling: z.number().int(),
            maxRepsOverCeiling: z.number().int().min(0).default(0),
            rirAdjustmentCapReps: z.number().int().min(0).default(2),
            rirAdjustmentCapRepsHighRep: z.number().int().min(0).default(1),
            rirAdjustmentHighRepThreshold: z.number().int().min(1).default(15),
          })
          .passthrough(),
        dup: z
          .object({
            dayTypes: z.object({
              heavy: z
                .object({ repRange: repRangeSchema, targetRirOffset: z.number() })
                .passthrough(),
              medium: z
                .object({ repRange: repRangeSchema, targetRirOffset: z.number() })
                .passthrough(),
              light: z
                .object({ repRange: repRangeSchema, targetRirOffset: z.number() })
                .passthrough(),
            }),
          })
          .passthrough(),
        block: z
          .object({
            phases: z.array(
              z
                .object({
                  name: z.string(),
                  fractionOfMeso: z.number(),
                  repRange: repRangeSchema,
                  rirBias: z.number(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      })
      .passthrough(),
    rirCalibration: z
      .object({
        minSamplesToAssess: z.number().int().min(1),
        echoThresholdPct: z.number().min(0).max(100).default(90),
        wellCalibratedMadReps: z.number().min(0),
        capWhenUncalibrated: z.number().int().min(0),
        raiseFloorWhenUncalibrated: z.boolean(),
        rirFloorWhenUncalibrated: z.number().int().min(0),
        highRirDampenFrom: z.number().int().min(1).default(4),
        lowLoadDampenBelowPctE1rm: z.number().min(0).max(100).default(60),
        firstSetWeight: z.number().min(0).max(1).default(0.5),
      })
      .passthrough()
      .default({
        minSamplesToAssess: 6,
        echoThresholdPct: 90,
        wellCalibratedMadReps: 1.5,
        highRirDampenFrom: 4,
        capWhenUncalibrated: 1,
        raiseFloorWhenUncalibrated: true,
        rirFloorWhenUncalibrated: 1,
      }),
    volumeRamp: z
      .object({
        mode: z.enum(["none", "finalWeeksBump", "linear"]),
        bumpWeeks: z.number().int().min(1),
        maxExtraSetsPerMusclePerWeek: z.number().int().min(0),
        maxExtraSetsPerSlotPerWeek: z.number().int().min(0),
      })
      .passthrough()
      .default({
        mode: "finalWeeksBump",
        bumpWeeks: 1,
        maxExtraSetsPerMusclePerWeek: 2,
        maxExtraSetsPerSlotPerWeek: 1,
      }),
    deloadTriggers: z
      .object({
        minSignalsToSuggest: z.number().int(),
        recentWindowSessions: z.number().int().min(1).default(6),
        signals: z
          .object({
            performanceDropSessions: z
              .object({
                enabled: z.boolean(),
                consecutiveSessions: z.number().int(),
                exercisesAffected: z.number().int(),
                weight: z.number().min(0).default(2),
              })
              .passthrough(),
            rirCreepAtFixedLoad: z
              .object({ enabled: z.boolean(), reps: z.number(), weight: z.number().min(0).default(1) })
              .passthrough(),
            reachedMrv: z.object({ enabled: z.boolean(), weight: z.number().min(0).default(1) }).passthrough(),
            chronicPoorReadiness: z
              .object({ enabled: z.boolean(), windowSessions: z.number().int(), weight: z.number().min(0).default(1) })
              .passthrough(),
            perceivedFatigue: z
              .object({
                enabled: z.boolean(),
                threshold: z.number().int().min(1).max(5),
                windowSessions: z.number().int().min(1),
                weight: z.number().min(0),
              })
              .passthrough()
              .default({ enabled: true, threshold: 4, windowSessions: 3, weight: 1 }),
          })
          .passthrough(),
        exerciseDeload: z
          .object({
            enabled: z.boolean(),
            e1rmDropPct: z.number().min(0),
            sessions: z.number().int().min(1),
            setsFactor: z.number().gt(0).max(1),
            loadFactor: z.number().gt(0).max(1),
          })
          .passthrough()
          .default({ enabled: true, e1rmDropPct: 5, sessions: 2, setsFactor: 0.5, loadFactor: 0.9 }),
      })
      .passthrough(),
    deloadStructure: z
      .object({
        durationDays: z.number(),
        volumeTarget: z.literal("mev"),
        volumeFractionFallback: z.number(),
        loadFirstHalf: z.literal("week1_load"),
        loadSecondHalf: z.number(),
        repsFraction: z.number(),
        targetRir: z.number(),
      })
      .passthrough(),
    loadIncrements: z
      .object({
        defaultBarWeightKg: z.number(),
        commonPlatesKg: z.array(z.number()),
        commonDumbbellsKg: z.array(z.number()),
        commonDumbbellPlatesKg: z.array(z.number()).default([1.25, 2.5, 5, 10, 15, 20]),
        defaultDumbbellHandleKg: z.number().default(2),
        machineStepKg: z.number(),
      })
      .passthrough(),
    oneRepMax: z
      .object({
        formula: z.string(),
        epleyCoefficient: z.number(),
        model: z.enum(["epley", "weightDependent"]).default("epley"),
        weightDependent: z
          .object({ exponent: z.number(), intercept: z.number(), slope: z.number() })
          .default({ exponent: 0.85, intercept: -2.55, slope: 4.58 }),
      })
      .passthrough(),
    anchorSet: z.object({ rirDelta: z.number().int().min(0) }).passthrough().default({ rirDelta: 1 }),
    intraSession: z
      .object({ rirShortfall: z.number().int().min(1), loadDropPct: z.number().min(0).max(50) })
      .passthrough()
      .default({ rirShortfall: 2, loadDropPct: 5 }),
    apre: z
      .object({
        belowMinPct: z.number(),
        inRangePct: z.number(),
        aboveMaxPct: z.number(),
        wellAboveMaxReps: z.number().int().min(1),
        wellAboveMaxPct: z.number(),
      })
      .passthrough()
      .default({ belowMinPct: -5, inRangePct: 0, aboveMaxPct: 2.5, wellAboveMaxReps: 3, wellAboveMaxPct: 5 }),
    exerciseRotation: z
      .object({
        suggestSwapWhen: z
          .object({
            stagnationSessions: z.number().int(),
            endOfMesoOnly: z.boolean(),
            preferStretchBiasedReplacement: z.boolean(),
          })
          .passthrough(),
      })
      .passthrough(),
    nutrition: z
      .object({
        proteinFloorGperKg: z.number(),
        proteinUpperGperKg: z.number(),
        energyBalanceOptions: z.array(z.string()),
      })
      .passthrough(),
    sleep: z
      .object({
        defaultMinimumHours: z.number(),
        modifiesSession: z.boolean(),
      })
      .passthrough(),
    checkin: z
      .object({
        optional: z.boolean(),
        blocksSessionStart: z.boolean(),
        tone: z.string(),
      })
      .passthrough(),
    statsPolicy: z
      .object({
        validProgressMetrics: z.array(z.string()),
        excludedVanityMetrics: z.array(z.string()),
        smallSampleWarning: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export type Rules = z.infer<typeof rulesSchema>;
export type VolumeLandmarks = z.infer<typeof landmarksSchema>;

/** Valida el JSON crudo del config. Falla ruidoso si el schema no coincide. */
export function parseRules(json: unknown): Rules {
  return rulesSchema.parse(json);
}

/** Landmarks efectivos = base del músculo × multiplicador del perfil. */
export function effectiveLandmarks(
  rules: Rules,
  profile: "novice" | "intermediate" | "advanced",
  muscle: string,
): VolumeLandmarks {
  const base = rules.volumeLandmarksBase[muscle] as VolumeLandmarks | undefined;
  if (!base || typeof base.mev !== "number") {
    throw new Error(`Sin landmarks de volumen para el músculo "${muscle}"`);
  }
  const m = rules.experienceProfiles[profile].volumeMultiplier;
  return {
    mv: base.mv * m,
    mev: base.mev * m,
    mav: base.mav * m,
    mrv: base.mrv * m,
  };
}

/**
 * RIR objetivo por semana de acumulación. Usa la tabla del config si existe la
 * longitud exacta; si no, genera un fallback descendente que termina en 0.
 */
export function rirScheduleForLength(rules: Rules, weeks: number): number[] {
  const exact = rules.rirSchedule.byAccumulationLength[String(weeks)];
  if (exact && exact.length === weeks) return exact;
  const out: number[] = [];
  for (let i = 0; i < weeks; i++) out.push(Math.min(4, weeks - 1 - i));
  return out;
}
