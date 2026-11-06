import { describe, expect, it } from "vitest";
import { assessRirCalibration, rirEchoPct } from "../rirCalibration";
import { nextPrescription } from "../progression";
import { summarizeSessionPair } from "../deload";
import { computeMesoStats } from "../stats";
import { generateMesocycle } from "../mesocycle";
import { baseWeek, equipment, exercises, rules, sessionLogs } from "./fixtures";
import { isRirReported, type SetLog } from "../types";

// A1.11: solo el RIR reportado (elegido o tocado) informa la percepción.
const unreported = (logs: SetLog[]) => logs.map((l) => ({ ...l, rirReported: false }));
const reported = (logs: SetLog[]) => logs.map((l) => ({ ...l, rirReported: true }));

describe("isRirReported", () => {
  it("false solo si se marcó explícitamente como precargado; los datos viejos cuentan", () => {
    expect(isRirReported({ rirReported: false })).toBe(false);
    expect(isRirReported({ rirReported: true })).toBe(true);
    expect(isRirReported({})).toBe(true);
  });
});

describe("calibración y eco ignoran el RIR no reportado", () => {
  const echoedButUnreported = unreported(
    [3, 2, 1, 0].flatMap((rir, i) =>
      sessionLogs({ sessionId: `u${i}`, exerciseId: "fly", sets: 3, loadKg: 30, reps: 8, rir, targetReps: 8, targetRir: rir, timestamp: `2026-05-0${i + 1}T10:00:00Z` }),
    ),
  );
  it("solo precargados → sin datos (no 'eco', no 'calibrado')", () => {
    const c = assessRirCalibration(echoedButUnreported, rules);
    expect(c.insufficientData).toBe(true);
    expect(c.echoDetected).toBe(false);
    expect(rirEchoPct(echoedButUnreported)).toBeNull();
  });
  it("las series reportadas (última de cada ejercicio) sí calibran", () => {
    const lastSets = reported(
      [{ reps: 10, rir: 2 }, { reps: 11, rir: 1 }, { reps: 9, rir: 3 }, { reps: 10, rir: 2 }, { reps: 12, rir: 0 }, { reps: 10, rir: 2 }].flatMap((r, i) =>
        sessionLogs({ sessionId: `r${i}`, exerciseId: "bench", sets: 1, loadKg: 80, reps: r.reps, rir: r.rir, targetReps: 10, targetRir: 1, timestamp: `2026-06-0${i + 1}T10:00:00Z` }),
      ),
    );
    const c = assessRirCalibration([...echoedButUnreported, ...lastSets], rules);
    expect(c.insufficientData).toBe(false);
    expect(c.wellCalibrated).toBe(true); // reps + RIR = 12 siempre
  });
});

describe("progresión: el RIR no reportado no ajusta reps", () => {
  const base = { model: "double" as const, targetRir: 2, repRange: { min: 8, max: 12 }, currentLoadKg: 80, equipmentType: "barbell" as const, equipment, rules };
  it("RIR 4 precargado (no tocado) no acredita reps virtuales; reportado sí", () => {
    const logs = sessionLogs({ sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80, reps: 12, rir: 4, targetReps: 12, targetRir: 2, timestamp: "2026-01-05T10:00:00Z" });
    const pUn = nextPrescription({ ...base, exerciseHistory: unreported(logs) });
    const pRep = nextPrescription({ ...base, exerciseHistory: reported(logs) });
    expect(pUn.nextLoadKg).toBe(82.5); // tope por reps reales → sube igual (rango duro)
    expect(pRep.nextLoadKg).toBe(82.5);
    // la diferencia aparece debajo del tope: 10 reps @ RIR 4 (objetivo 2)
    const mid = sessionLogs({ sessionId: "s2", exerciseId: "bench", sets: 3, loadKg: 80, reps: 10, rir: 4, targetReps: 10, targetRir: 2, timestamp: "2026-01-08T10:00:00Z" });
    expect(nextPrescription({ ...base, exerciseHistory: unreported(mid) }).nextReps).toBe(11);
    expect(nextPrescription({ ...base, exerciseHistory: reported(mid) }).nextReps).toBe(12);
  });
});

describe("deload: RIR creep solo entre series reportadas", () => {
  it("un salto de RIR en series precargadas no cuenta como creep", () => {
    const prev = sessionLogs({ sessionId: "p", exerciseId: "bench", sets: 2, loadKg: 80, reps: 10, rir: 1, timestamp: "2026-01-01T10:00:00Z" });
    const curr = unreported(sessionLogs({ sessionId: "c", exerciseId: "bench", sets: 2, loadKg: 80, reps: 10, rir: 4, timestamp: "2026-01-08T10:00:00Z" }));
    expect(summarizeSessionPair(prev, curr, "c").maxRirIncreaseAtFixedLoad).toBe(0);
    expect(summarizeSessionPair(prev, reported(curr), "c").maxRirIncreaseAtFixedLoad).toBe(3);
  });
});

describe("stats: e1RM prefiere la serie con RIR reportado", () => {
  const plan = generateMesocycle({ baseWeek, exercises, profile: "intermediate", progressionModel: "double", numAccumulationWeeks: 3, prioritizedMuscles: [], rules });
  const sessions = [
    { id: "a", weekIndex: 0, status: "completed" as const },
    { id: "b", weekIndex: 1, status: "completed" as const },
  ];
  it("con RIR precargado 3→0 y mismas reps, el Δ no cae si la última serie reportada mantiene reps+RIR", () => {
    // semana 1: precargadas @3 + última reportada 8 @1 ; semana 2: precargadas @0 + última reportada 8 @1
    const w = (sid: string, ts: string, pre: number) => [
      ...unreported(sessionLogs({ sessionId: sid, exerciseId: "bench", sets: 2, loadKg: 80, reps: 8, rir: pre, timestamp: ts })),
      ...reported(sessionLogs({ sessionId: sid, exerciseId: "bench", sets: 1, loadKg: 80, reps: 8, rir: 1, timestamp: ts })).map((l) => ({ ...l, setIndex: 2, id: l.id + "-last" })),
    ];
    const logs = [...w("a", "2026-01-01T10:00:00Z", 3), ...w("b", "2026-01-08T10:00:00Z", 0)];
    const s = computeMesoStats({ plan, sessions, setLogs: logs, checkins: [], exercises, rules });
    const bench = s.perExercise.find((e) => e.exerciseId === "bench")!;
    expect(bench.deltaPct).toBe(0);
  });
});
