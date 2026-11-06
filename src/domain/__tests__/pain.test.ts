// A5.5 — Dolor articular/tendinoso: niveles, opciones por ejercicio, persistencia.

import { describe, expect, it } from "vitest";
import { evaluatePainSignal, exerciseZones, painLoadDownAdjust, shouldAskPain, type PainReport } from "../pain";
import type { Exercise, PainZone } from "../types";
import { exercises, exercisesById, rules } from "./fixtures";

const day = (d: number) => new Date(Date.UTC(2026, 9, 1 + d, 10)).toISOString();
const r = (d: number, pain: Array<[PainZone, number]>): PainReport => ({ date: day(d), pain: pain.map(([zone, score]) => ({ zone, score })) });
const ev = (reports: PainReport[], exs: Exercise[] = exercises) => evaluatePainSignal({ reports, exercises: exs, library: exercises, rules });

describe("evaluatePainSignal (A5.5.2)", () => {
  it("una sola vez 4/10 → watch, sin opciones", () => {
    const s = ev([r(0, [["elbow", 4]])]);
    expect(s.zones).toEqual([expect.objectContaining({ zone: "elbow", level: "watch", consecutiveSessions: 1 })]);
    expect(s.perExercise).toEqual([]);
  });

  it("dos sesiones seguidas 4/10 en codo → act, opciones solo para ejercicios que cargan el codo", () => {
    const s = ev([r(0, [["elbow", 4]]), r(2, [["elbow", 4]])]);
    expect(s.zones[0].level).toBe("act");
    const ids = new Set(s.perExercise.map((x) => x.exerciseId));
    for (const ex of exercises) expect(ids.has(ex.id)).toBe(exerciseZones(ex, rules).includes("elbow"));
    expect(ids.has("squat")).toBe(false);
  });

  it("7/10 una sola vez → act", () => {
    expect(ev([r(0, [["knee", 7]])]).zones[0].level).toBe("act");
  });

  it("sube 2 → 4 → 6 en tres semanas → rising y act", () => {
    const s = ev([r(0, [["shoulder", 2]]), r(7, [["shoulder", 4]]), r(14, [["shoulder", 6]])]);
    expect(s.zones[0].trend).toBe("rising");
    expect(s.zones[0].level).toBe("act");
  });

  it("un reporte sin dolor corta la racha", () => {
    const s = ev([r(0, [["elbow", 4]]), r(2, []), r(4, [["elbow", 4]])]);
    expect(s.zones[0].consecutiveSessions).toBe(1);
    expect(s.zones[0].level).toBe("watch");
  });

  it("si el último reporte dice que no duele, no hay señal", () => {
    expect(ev([r(0, [["elbow", 8]]), r(2, [])]).zones).toEqual([]);
  });

  it("el swap propuesto nunca carga la misma zona", () => {
    const s = ev([r(0, [["shoulder", 6]])]);
    for (const x of s.perExercise) {
      if (!x.swapCandidateId) continue;
      expect(exerciseZones(exercisesById.get(x.swapCandidateId)!, rules)).not.toContain("shoulder");
    }
  });

  it("el swap respeta loadedZones propios del ejercicio", () => {
    const bench = { ...exercisesById.get("bench")!, swapCandidates: ["curl"] };
    const curl = { ...exercisesById.get("curl")!, loadedZones: ["wrist" as PainZone] };
    const s = evaluatePainSignal({ reports: [r(0, [["shoulder", 6]])], exercises: [bench], library: [bench, curl], rules });
    expect(s.perExercise[0].swapCandidateId).toBe("curl");
    expect(s.perExercise[0].options).toContain("swap-candidate");
  });

  it("tres semanas seguidas ≥ watch → persistente (sugerir consultar)", () => {
    const s = ev([r(0, [["knee", 3]]), r(8, [["knee", 3]]), r(15, [["knee", 3]]), r(22, [["knee", 3]])]);
    expect(s.persistent).toBe(true);
  });

  it("sin reportes → nada", () => {
    expect(ev([])).toEqual({ zones: [], perExercise: [], persistent: false });
  });
});

describe("ajustes y pregunta periódica", () => {
  it("bajar carga y subir reps sin pasar las 30 reps", () => {
    expect(painLoadDownAdjust({ min: 8, max: 10 }, rules)).toEqual({ loadFactor: 0.9, repRange: { min: 11, max: 13 } });
    expect(painLoadDownAdjust({ min: 25, max: 30 }, rules).repRange.max).toBe(rules.repRanges.globalValid.max);
  });
  it("pregunta cada askEverySessions sesiones", () => {
    expect(shouldAskPain(rules.pain.askEverySessions - 1, rules)).toBe(false);
    expect(shouldAskPain(rules.pain.askEverySessions, rules)).toBe(true);
  });
});

describe("re-auditoría A5-11: tendencia que baja", () => {
  it("6 → 4 → 3 en tres semanas → falling", () => {
    const s = ev([r(0, [["knee", 6]]), r(7, [["knee", 4]]), r(14, [["knee", 3]])]);
    expect(s.zones[0].trend).toBe("falling");
  });
});
