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
      })
      .passthrough(),
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
    deloadTriggers: z
      .object({
        minSignalsToSuggest: z.number().int(),
        signals: z
          .object({
            performanceDropSessions: z
              .object({
                enabled: z.boolean(),
                consecutiveSessions: z.number().int(),
                exercisesAffected: z.number().int(),
              })
              .passthrough(),
            rirCreepAtFixedLoad: z
              .object({ enabled: z.boolean(), reps: z.number() })
              .passthrough(),
            reachedMrv: z.object({ enabled: z.boolean() }).passthrough(),
            chronicPoorReadiness: z
              .object({ enabled: z.boolean(), windowSessions: z.number().int() })
              .passthrough(),
          })
          .passthrough(),
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
        machineStepKg: z.number(),
      })
      .passthrough(),
    oneRepMax: z
      .object({
        formula: z.string(),
        epleyCoefficient: z.number(),
      })
      .passthrough(),
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
