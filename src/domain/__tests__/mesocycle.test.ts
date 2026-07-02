import { describe, expect, it } from "vitest";
import { generateMesocycle } from "../mesocycle";
import { effectiveLandmarks, rirScheduleForLength } from "../rules";
import type { ProgressionModel } from "../types";
import { baseWeek, exercises, exercisesById, rules } from "./fixtures";

const gen = (model: ProgressionModel = "double", weeks = 5) =>
  generateMesocycle({
    baseWeek,
    exercises,
    profile: "intermediate",
    progressionModel: model,
    numAccumulationWeeks: weeks,
    prioritizedMuscles: [],
    rules,
  });

describe("generateMesocycle — estructura", () => {
  it("produce N semanas de acumulación + 1 deload", () => {
    const plan = gen("double", 5);
    expect(plan.weeks).toHaveLength(6);
    expect(plan.weeks.slice(0, 5).every((w) => !w.isDeload)).toBe(true);
    expect(plan.weeks[5].isDeload).toBe(true);
  });

  it("respeta el máximo de semanas del perfil", () => {
    const plan = gen("double", 20); // intermediate max = 8
    expect(plan.numAccumulationWeeks).toBe(8);
  });

  it("es determinista", () => {
    expect(JSON.stringify(gen())).toBe(JSON.stringify(gen()));
  });
});

describe("generateMesocycle — rampa de volumen", () => {
  it("el volumen por músculo no decrece entre semanas de acumulación", () => {
    const plan = gen();
    for (const muscle of Object.keys(plan.weeks[0].targetVolumeByMuscle)) {
      for (let w = 1; w < plan.numAccumulationWeeks; w++) {
        expect(
          plan.weeks[w].targetVolumeByMuscle[muscle],
        ).toBeGreaterThanOrEqual(plan.weeks[w - 1].targetVolumeByMuscle[muscle]);
      }
    }
  });

  it("ningún músculo supera su MRV efectivo", () => {
    const plan = gen();
    for (const week of plan.weeks) {
      for (const [muscle, vol] of Object.entries(week.targetVolumeByMuscle)) {
        if (vol <= 0) continue;
        let mrv: number;
        try {
          mrv = effectiveLandmarks(rules, "intermediate", muscle).mrv;
        } catch {
          continue;
        }
        expect(vol, `${muscle} semana ${week.weekIndex}`).toBeLessThanOrEqual(mrv + 1e-9);
      }
    }
  });

  it("con músculos priorizados, el volumen extra va a esos músculos", () => {
    const plan = generateMesocycle({
      baseWeek,
      exercises,
      profile: "intermediate",
      progressionModel: "double",
      numAccumulationWeeks: 5,
      prioritizedMuscles: ["chest"],
      rules,
    });
    const first = plan.weeks[0].targetVolumeByMuscle;
    const last = plan.weeks[4].targetVolumeByMuscle;
    expect(last.chest).toBeGreaterThan(first.chest);
    // quads no priorizado: se mantiene en su volumen base (sin rampa directa)
    expect(last.quads).toBe(first.quads);
  });
});

describe("generateMesocycle — RIR", () => {
  it("aplica el rirSchedule del config por semana", () => {
    const plan = gen("double", 5);
    const schedule = rirScheduleForLength(rules, 5); // [3,2,2,1,0]
    for (let w = 0; w < 5; w++) {
      // fly es cable (sin piso de barra): su RIR = schedule[w]
      const fly = plan.weeks[w].days[1].slots.find((s) => s.exerciseId === "fly")!;
      expect(fly.targetRir).toBe(schedule[w]);
    }
  });

  it("los ejercicios de barra nunca bajan del piso de riesgo (RIR 1)", () => {
    const plan = gen("double", 5);
    const lastWeek = plan.weeks[4]; // schedule RIR 0
    for (const day of lastWeek.days) {
      for (const slot of day.slots) {
        const ex = exercisesById.get(slot.exerciseId)!;
        if (ex.equipmentType === "barbell") {
          expect(slot.targetRir).toBeGreaterThanOrEqual(rules.rirSchedule.barbellRiskFloor);
        }
      }
    }
  });
});

describe("generateMesocycle — modelos igualan volumen", () => {
  it("el volumen semanal por músculo es idéntico entre los 4 modelos", () => {
    const models: ProgressionModel[] = ["linear", "double", "dup", "block"];
    const plans = models.map((m) => gen(m, 5));
    for (let w = 0; w < 6; w++) {
      const ref = plans[0].weeks[w].targetVolumeByMuscle;
      for (const plan of plans.slice(1)) {
        expect(plan.weeks[w].targetVolumeByMuscle).toEqual(ref);
      }
    }
  });

  it("DUP asigna tipos de día cíclicos y ajusta rangos de reps", () => {
    const plan = gen("dup", 5);
    const day0 = plan.weeks[0].days[0].slots[0];
    const day1 = plan.weeks[0].days[1].slots[0];
    expect(day0.dayType).toBe("heavy");
    expect(day1.dayType).toBe("medium");
    expect(day0.repRange).toEqual(rules.progressionModels.dup.dayTypes.heavy.repRange);
  });

  it("block cambia de fase según la fracción del meso", () => {
    const plan = gen("block", 5);
    expect(plan.weeks[0].days[0].slots[0].phase).toBe("accumulation");
    expect(plan.weeks[4].days[0].slots[0].phase).toBe("intensification");
  });
});

describe("generateMesocycle — deload", () => {
  it("el volumen del deload queda en o por debajo del MEV efectivo", () => {
    const plan = gen();
    const deload = plan.weeks[plan.weeks.length - 1];
    for (const [muscle, vol] of Object.entries(deload.targetVolumeByMuscle)) {
      if (vol <= 0) continue;
      let mev: number;
      try {
        mev = effectiveLandmarks(rules, "intermediate", muscle).mev;
      } catch {
        continue;
      }
      expect(vol, muscle).toBeLessThanOrEqual(mev + 1e-9);
    }
  });

  it("usa el RIR del deloadStructure y la política de carga por mitades", () => {
    const plan = gen();
    const deload = plan.weeks[plan.weeks.length - 1];
    expect(deload.deloadLoadPolicy).toEqual({
      firstHalf: "week1_load",
      secondHalfFraction: rules.deloadStructure.loadSecondHalf,
    });
    for (const day of deload.days) {
      for (const slot of day.slots) {
        expect(slot.targetRir).toBe(rules.deloadStructure.targetRir);
      }
    }
  });
});
