import { describe, expect, it } from "vitest";
import { generateMesocycle, plannedRir } from "../mesocycle";
import { sameProgressionTrack } from "../progression";
import { suggestLoadFromHistory } from "../oneRepMax";
import { rirScheduleForLength } from "../rules";
import { baseWeek, equipment, exercises, rules, sessionLogs } from "./fixtures";
import type { BaseWeek } from "../types";

const heavy = rules.dayIntensity.heavy.rirOffset; // -1
const light = rules.dayIntensity.light.rirOffset; // +1

describe("plannedRir — día fuerte/liviano + banda de RIR", () => {
  it("el día fuerte baja el RIR y el liviano lo sube", () => {
    expect(plannedRir({ baseRir: 2, intensity: "heavy", isBarbell: false, rules })).toBe(2 + heavy);
    expect(plannedRir({ baseRir: 2, intensity: "light", isBarbell: false, rules })).toBe(2 + light);
    expect(plannedRir({ baseRir: 2, isBarbell: false, rules })).toBe(2);
  });

  it("la banda acota TODO: ni por debajo del mínimo ni por encima del máximo", () => {
    const band = { min: 1, max: 3 };
    // semana final (RIR 0) en día fuerte → -1 → acotado a 1
    expect(plannedRir({ baseRir: 0, intensity: "heavy", band, isBarbell: false, rules })).toBe(1);
    // semana 1 (RIR 4) en día liviano → 5 → acotado a 3
    expect(plannedRir({ baseRir: 4, intensity: "light", band, isBarbell: false, rules })).toBe(3);
  });

  it("sin banda nunca baja de 0", () => {
    expect(plannedRir({ baseRir: 0, intensity: "heavy", isBarbell: false, rules })).toBe(0);
  });

  it("el piso de barra manda sobre la banda (seguridad)", () => {
    const band = { min: 0, max: 3 };
    expect(plannedRir({ baseRir: 0, band, isBarbell: true, rules })).toBe(rules.rirSchedule.barbellRiskFloor);
  });
});

describe("generateMesocycle — intensidad por día y banda", () => {
  const bw: BaseWeek = {
    days: [
      { ...baseWeek.days[0], label: "Fuerte", intensity: "heavy" },
      { ...baseWeek.days[0], label: "Liviano", intensity: "light" },
    ],
  };

  it("todo RIR planificado (deload incluido) queda dentro de la banda 1–3", () => {
    const plan = generateMesocycle({
      baseWeek: bw, exercises, profile: "intermediate", progressionModel: "double",
      numAccumulationWeeks: 5, prioritizedMuscles: [], rules, rirBand: { min: 1, max: 3 },
    });
    expect(plan.rirBand).toEqual({ min: 1, max: 3 });
    for (const w of plan.weeks) {
      for (const d of w.days) {
        for (const s of d.slots) {
          expect(s.targetRir, `sem${w.weekIndex} ${d.label}`).toBeGreaterThanOrEqual(1);
          expect(s.targetRir, `sem${w.weekIndex} ${d.label}`).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it("el día fuerte tiene menos RIR que el liviano en la misma semana, y la intensidad viaja al plan", () => {
    const plan = generateMesocycle({
      baseWeek: bw, exercises, profile: "intermediate", progressionModel: "double",
      numAccumulationWeeks: 5, prioritizedMuscles: [], rules, rirBand: { min: 1, max: 3 },
    });
    const week = plan.weeks[1]; // semana 2: calendario 2 → fuerte 1, liviano 3
    const base = rirScheduleForLength(rules, 5)[1];
    // "curl" es de mancuerna: no le aplica el piso de barra.
    const curl = (d: number) => week.days[d].slots.find((s) => s.exerciseId === "curl")!;
    expect(curl(0).targetRir).toBe(Math.max(1, base + heavy));
    expect(curl(1).targetRir).toBe(Math.min(3, base + light));
    expect(week.days[0].intensity).toBe("heavy");
    expect(week.days[1].intensity).toBe("light");
    expect(plan.weeks[5].days[0].intensity).toBe("heavy"); // deload también
  });

  it("sin banda ni intensidad el plan es idéntico al de antes (compatibilidad)", () => {
    const plan = generateMesocycle({
      baseWeek, exercises, profile: "intermediate", progressionModel: "double",
      numAccumulationWeeks: 5, prioritizedMuscles: [], rules,
    });
    expect(plan.rirBand).toBeUndefined();
    const sched = rirScheduleForLength(rules, 5);
    plan.weeks.filter((w) => !w.isDeload).forEach((w) => {
      const curl = w.days[0].slots.find((s) => s.exerciseId === "curl")!; // mancuerna: sin piso de barra
      expect(curl.targetRir).toBe(sched[w.weekIndex]);
    });
  });
});

describe("sameProgressionTrack — un ejercicio en día fuerte y liviano progresa aparte", () => {
  const slot = (min: number, max: number) => ({ repRange: { min, max } });
  it("distinta intensidad → pistas distintas aunque el rango coincida", () => {
    expect(sameProgressionTrack({ slot: slot(8, 12), intensity: "heavy" }, { slot: slot(8, 12), intensity: "light" }, "double")).toBe(false);
  });
  it("misma intensidad y mismo rango → misma pista; distinto rango → distinta", () => {
    expect(sameProgressionTrack({ slot: slot(8, 12) }, { slot: slot(8, 12) }, "double")).toBe(true);
    expect(sameProgressionTrack({ slot: slot(6, 8) }, { slot: slot(10, 12) }, "double")).toBe(false);
  });
  it("DUP compara por zona; bloques nunca separa por rango (cambia por fase a propósito)", () => {
    expect(sameProgressionTrack({ slot: { ...slot(5, 8), dayType: "heavy" } }, { slot: { ...slot(16, 25), dayType: "heavy" } }, "dup")).toBe(true);
    expect(sameProgressionTrack({ slot: { ...slot(5, 8), dayType: "heavy" } }, { slot: { ...slot(5, 8), dayType: "light" } }, "dup")).toBe(false);
    expect(sameProgressionTrack({ slot: slot(8, 15) }, { slot: slot(5, 10) }, "block")).toBe(true);
  });
});

describe("suggestLoadFromHistory — carga inicial desde el 1RM real", () => {
  const ctx = { type: "barbell" as const, equipment };
  const history = sessionLogs({
    sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 100, reps: 10, rir: 2,
    targetReps: 10, targetRir: 2, timestamp: "2026-10-22T10:00:00Z",
  });

  it("día fuerte (piso 6 reps, RIR 1) sugiere más carga que día liviano (piso 10, RIR 3)", () => {
    const strong = suggestLoadFromHistory({ history, targetReps: 6, targetRir: 1, rules, ctx })!;
    const easy = suggestLoadFromHistory({ history, targetReps: 10, targetRir: 3, rules, ctx })!;
    expect(strong).toBeGreaterThan(100);
    expect(easy).toBeLessThan(100);
    expect(strong).toBeGreaterThan(easy);
    // redondeado al equipamiento (múltiplo de 2.5 con discos de 1.25)
    expect((strong * 10) % 25).toBe(0);
  });

  it("mismo objetivo que la sesión real → devuelve (≈) la misma carga", () => {
    expect(suggestLoadFromHistory({ history, targetReps: 10, targetRir: 2, rules, ctx })).toBe(100);
  });

  it("sin historial con carga → null (conserva la plantilla)", () => {
    expect(suggestLoadFromHistory({ history: [], targetReps: 8, targetRir: 2, rules, ctx })).toBeNull();
    const bw = sessionLogs({ sessionId: "s", exerciseId: "pullup", sets: 3, loadKg: 0, reps: 10, rir: 2, timestamp: "2026-01-01T10:00:00Z" });
    expect(suggestLoadFromHistory({ history: bw, targetReps: 8, targetRir: 2, rules, ctx })).toBeNull();
  });
});
