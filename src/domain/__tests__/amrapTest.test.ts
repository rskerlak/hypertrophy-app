import { describe, expect, it } from "vitest";
import {
  amrapTestEligibility,
  amrapTestError,
  assessRirCalibration,
  rirAccuracyFromTests,
  sessionsSinceLastAmrapTest,
} from "../rirCalibration";
import { nextPrescription } from "../progression";
import { summarizeSessionPair } from "../deload";
import { isProgressionSet, type SetLog } from "../types";
import { equipment, rules } from "./fixtures";

let n = 0;
const log = (p: Partial<SetLog>): SetLog => ({
  id: `l${n++}`,
  sessionId: "s1",
  exerciseId: "leg-press",
  setIndex: 0,
  targetLoadKg: 100,
  targetReps: 10,
  targetRir: 2,
  actualLoadKg: 100,
  actualReps: 10,
  actualRir: 2,
  rirReported: true,
  timestamp: "2026-11-01T10:00:00.000Z",
  ...p,
});
const test = (repsAt: number, predicted: number, total: number, sessionId = "t") =>
  log({ sessionId, kind: "failure", actualRir: 0, actualReps: total, amrapTest: { predictedRir: predicted, repsAtPrediction: repsAt } });

const elig = {
  equipmentType: "machine" as const,
  isDeload: false,
  slotIsApre: false,
  loadKg: 100,
  e1rmKg: 130,
  loadedZones: ["knee" as const, "hip" as const],
  activePainZones: [],
  sessionsSinceLastTest: null,
  barbellFailureAllowed: false,
  rules,
};

describe("amrapTestError / rirAccuracyFromTests (A5.8)", () => {
  it("error = reps que quedaban de verdad − RIR que creías", () => {
    expect(amrapTestError(test(10, 2, 14))).toBe(2); // creías 2, quedaban 4
    expect(amrapTestError(test(10, 3, 12))).toBe(-1);
    expect(amrapTestError(log({}))).toBeNull();
  });
  it("errores positivos = subestimás tu reserva", () => {
    const r = rirAccuracyFromTests([test(10, 2, 14), test(10, 2, 13), test(8, 3, 12)], rules)!;
    expect(r.n).toBe(3);
    expect(r.meanErrorReps).toBeCloseTo((2 + 1 + 1) / 3, 2);
    expect(r.madReps).toBeCloseTo(4 / 3, 2);
    expect(r.bias).toBe("underestimates");
  });
  it("sesgo neutral dentro de la banda y negativo = sobreestimás", () => {
    expect(rirAccuracyFromTests([test(10, 2, 12), test(10, 2, 13), test(10, 2, 11)], rules)!.bias).toBe("neutral");
    expect(rirAccuracyFromTests([test(10, 3, 11), test(10, 3, 12)], rules)!.bias).toBe("overestimates");
    expect(rirAccuracyFromTests([log({})], rules)).toBeNull();
  });
});

describe("assessRirCalibration con tests (A5.8)", () => {
  it("con menos de minTests sigue en proxy pero informa los tests", () => {
    const c = assessRirCalibration([test(10, 2, 12)], rules);
    expect(c.source).toBe("proxy");
    expect(c.measured?.n).toBe(1);
  });
  it("con ≥ minTests pasa a medido y decide la calibración, aun con eco", () => {
    // 12 series con RIR = objetivo (eco) + 3 tests precisos.
    const echo = Array.from({ length: 12 }, (_, k) => log({ sessionId: `e${k}`, setIndex: k % 3, actualLoadKg: 100 + (k % 2) * 5 }));
    const tests = [test(10, 2, 12, "a"), test(10, 2, 13, "b"), test(10, 1, 11, "c")];
    const c = assessRirCalibration([...echo, ...tests], rules);
    expect(c.echoDetected).toBe(true);
    expect(c.source).toBe("measured");
    expect(c.samples).toBe(3);
    expect(c.wellCalibrated).toBe(true);
    expect(c.insufficientData).toBe(false);
  });
  it("tests imprecisos (error medio absoluto > umbral) → no calibrado", () => {
    const c = assessRirCalibration([test(10, 1, 15, "a"), test(10, 1, 14, "b"), test(10, 0, 13, "c")], rules);
    expect(c.source).toBe("measured");
    expect(c.wellCalibrated).toBe(false);
  });
  it("los tests pueden venir de otros mesos (tercer argumento)", () => {
    const c = assessRirCalibration([], rules, [test(10, 2, 12, "a"), test(10, 2, 12, "b"), test(10, 2, 12, "c")]);
    expect(c.source).toBe("measured");
  });
});

describe("la serie del test no decide la progresión (A5.8)", () => {
  it("isProgressionSet la excluye aunque sea 'failure'", () => {
    expect(isProgressionSet(test(10, 2, 15))).toBe(false);
    expect(isProgressionSet(log({ kind: "failure" }))).toBe(true);
  });
  it("una AMRAP de 15 reps en 8–12 no hace subir la carga si las series normales no llegaron al tope", () => {
    const history = [
      log({ setIndex: 0, actualReps: 10, targetReps: 10 }),
      log({ setIndex: 1, actualReps: 10, targetReps: 10 }),
      test(10, 2, 15),
    ].map((l, k) => ({ ...l, setIndex: k }));
    const p = nextPrescription({
      exerciseHistory: history,
      model: "double",
      targetRir: 2,
      repRange: { min: 8, max: 12 },
      currentLoadKg: 100,
      equipmentType: "machine",
      equipment,
      rules,
    });
    expect(p.nextLoadKg).toBe(100);
    expect(p.nextReps).toBeLessThanOrEqual(12);
  });
});

describe("sessionsSinceLastAmrapTest", () => {
  const sessions = ["a", "b", "c", "d"].map((id, k) => ({ id, status: "completed", completedAt: `2026-11-0${k + 1}T10:00:00.000Z` }));
  it("null si nunca se testeó; cuenta sesiones completadas posteriores", () => {
    const logs = sessions.map((s) => ({ sessionId: s.id }));
    expect(sessionsSinceLastAmrapTest(logs, sessions)).toBeNull();
    expect(sessionsSinceLastAmrapTest([...logs, { sessionId: "b", amrapTest: { predictedRir: 2, repsAtPrediction: 10 } }], sessions)).toBe(2);
    expect(sessionsSinceLastAmrapTest([...logs, { sessionId: "d", amrapTest: { predictedRir: 2, repsAtPrediction: 10 } }], sessions)).toBe(0);
  });
  it("ignora sesiones no completadas", () => {
    const s2 = [...sessions, { id: "e", status: "pending" }];
    const logs = [...s2.map((s) => ({ sessionId: s.id })), { sessionId: "c", amrapTest: { predictedRir: 1, repsAtPrediction: 8 } }];
    expect(sessionsSinceLastAmrapTest(logs, s2)).toBe(1);
  });
});

describe("amrapTestEligibility (A5.8)", () => {
  it("máquina con carga suficiente y sin dolor → elegible", () => {
    expect(amrapTestEligibility(elig).eligible).toBe(true);
  });
  it("barra libre sin seguros → no; con seguros → sí", () => {
    expect(amrapTestEligibility({ ...elig, equipmentType: "barbell" }).eligible).toBe(false);
    expect(amrapTestEligibility({ ...elig, equipmentType: "barbell", barbellFailureAllowed: true }).eligible).toBe(true);
  });
  it("deload, APRE y dolor activo en una zona cargada → no", () => {
    expect(amrapTestEligibility({ ...elig, isDeload: true }).eligible).toBe(false);
    expect(amrapTestEligibility({ ...elig, slotIsApre: true }).eligible).toBe(false);
    expect(amrapTestEligibility({ ...elig, activePainZones: ["knee"] }).eligible).toBe(false);
    expect(amrapTestEligibility({ ...elig, activePainZones: ["elbow"] }).eligible).toBe(true);
  });
  it("carga liviana (< minLoadPctE1rm) o sin e1RM → no; peso corporal no necesita e1RM", () => {
    expect(amrapTestEligibility({ ...elig, loadKg: 80, e1rmKg: 130 }).eligible).toBe(false);
    expect(amrapTestEligibility({ ...elig, e1rmKg: null }).eligible).toBe(false);
    expect(amrapTestEligibility({ ...elig, equipmentType: "bodyweight", loadKg: 0, e1rmKg: null }).eligible).toBe(true);
  });
  it("como máximo una vez cada everySessionsPerExercise sesiones", () => {
    const every = rules.amrapTest.everySessionsPerExercise;
    expect(amrapTestEligibility({ ...elig, sessionsSinceLastTest: every - 1 }).eligible).toBe(false);
    expect(amrapTestEligibility({ ...elig, sessionsSinceLastTest: every }).eligible).toBe(true);
  });
  it("deshabilitado en config → no", () => {
    expect(amrapTestEligibility({ ...elig, rules: { ...rules, amrapTest: { ...rules.amrapTest, enabled: false } } }).eligible).toBe(false);
  });
});

describe("la serie del test no finge fatiga en la sesión siguiente (A5.8)", () => {
  it("summarizeSessionPair ignora el test al comparar reps a carga fija", () => {
    const prev = [log({ sessionId: "p", setIndex: 0, actualReps: 10 }), { ...test(10, 2, 15, "p"), setIndex: 1 }];
    const curr = [log({ sessionId: "c", setIndex: 0, actualReps: 10 }), log({ sessionId: "c", setIndex: 1, actualReps: 10 })];
    expect(summarizeSessionPair(prev, curr, "c").exercisesWithRepDropAtFixedLoad).toBe(0);
  });
});
