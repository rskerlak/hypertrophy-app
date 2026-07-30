import { describe, expect, it } from "vitest";
import {
  assessRirCalibration,
  calibratedRirCap,
  calibratedRirFloor,
} from "../rirCalibration";
import { rules, sessionLogs } from "./fixtures";

/** n sesiones del mismo ejercicio a la misma carga con reps/RIR dados. */
const history = (rows: Array<{ reps: number; rir: number }>) =>
  rows.flatMap((r, i) =>
    sessionLogs({
      sessionId: `s${i}`,
      exerciseId: "bench",
      sets: 2,
      loadKg: 80,
      reps: r.reps,
      rir: r.rir,
      targetReps: 10,
      targetRir: 2,
      timestamp: `2026-01-0${i + 1}T10:00:00Z`,
    }),
  );

describe("assessRirCalibration", () => {
  it("sin datos suficientes: no opina y el motor desconfía", () => {
    const c = assessRirCalibration(history([{ reps: 10, rir: 2 }]), rules);
    expect(c.insufficientData).toBe(true);
    expect(c.wellCalibrated).toBe(false);
    expect(calibratedRirCap(2, c, rules)).toBe(rules.rirCalibration.capWhenUncalibrated);
    expect(calibratedRirFloor(c, rules)).toBe(rules.rirCalibration.rirFloorWhenUncalibrated);
  });

  it("capacidad implícita consistente = bien calibrado (tope y piso plenos)", () => {
    // reps + RIR siempre 12 → dispersión 0.
    const c = assessRirCalibration(
      history([
        { reps: 10, rir: 2 },
        { reps: 11, rir: 1 },
        { reps: 9, rir: 3 },
        { reps: 10, rir: 2 },
      ]),
      rules,
    );
    expect(c.insufficientData).toBe(false);
    expect(c.meanAbsDeviationReps).toBe(0);
    expect(c.wellCalibrated).toBe(true);
    expect(calibratedRirCap(2, c, rules)).toBe(2); // confía plenamente
    expect(calibratedRirFloor(c, rules)).toBeNull(); // no eleva el piso
  });

  it("capacidad implícita errática = mal calibrado (recorta el tope y sube el piso)", () => {
    // reps + RIR salta entre 12 y 20 → dispersión muy alta.
    const c = assessRirCalibration(
      history([
        { reps: 10, rir: 2 },
        { reps: 18, rir: 2 },
        { reps: 10, rir: 2 },
        { reps: 18, rir: 2 },
      ]),
      rules,
    );
    expect(c.wellCalibrated).toBe(false);
    expect(c.meanAbsDeviationReps).toBeGreaterThan(rules.rirCalibration.wellCalibratedMadReps);
    expect(calibratedRirCap(2, c, rules)).toBe(1);
    expect(calibratedRirFloor(c, rules)).toBe(1);
  });

  it("reporta el sesgo con signo (entrenar más lejos del fallo que el objetivo)", () => {
    const c = assessRirCalibration(
      history([
        { reps: 10, rir: 4 },
        { reps: 10, rir: 4 },
        { reps: 10, rir: 4 },
        { reps: 10, rir: 4 },
      ]),
      rules,
    );
    expect(c.meanSignedBiasReps).toBe(2); // objetivo 2, reportado 4
  });

  it("ignora series a peso corporal (la carga no identifica el estímulo)", () => {
    const bw = sessionLogs({
      sessionId: "bw",
      exerciseId: "pullup",
      sets: 4,
      loadKg: 0,
      reps: 10,
      rir: 2,
      timestamp: "2026-01-05T10:00:00Z",
    });
    const c = assessRirCalibration(bw, rules);
    expect(c.insufficientData).toBe(true);
  });
});
