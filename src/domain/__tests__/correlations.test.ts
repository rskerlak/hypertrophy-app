import { describe, expect, it } from "vitest";
import {
  activityAggregates,
  buildMesoObservation,
  checkinAggregates,
  correlationMatrix,
  measurementDeltas,
  pearson,
  summarizeByModel,
  type MesoObservation,
} from "../correlations";
import type { Checkin } from "../types";

describe("pearson", () => {
  it("correlación perfecta positiva y negativa", () => {
    expect(pearson([[1, 2], [2, 4], [3, 6]])).toBe(1);
    expect(pearson([[1, 6], [2, 4], [3, 2]])).toBe(-1);
  });

  it("null con menos de 3 pares o series constantes", () => {
    expect(pearson([[1, 2], [2, 4]])).toBeNull();
    expect(pearson([[1, 5], [2, 5], [3, 5]])).toBeNull();
  });
});

describe("measurementDeltas", () => {
  it("calcula end - start por campo y null si falta alguno", () => {
    const d = measurementDeltas(
      { date: "2026-01-01", bicepCm: 38, waistCm: 84 },
      { date: "2026-02-15", bicepCm: 39.5, quadCm: 60 },
    );
    expect(d.d_bicepCm).toBe(1.5);
    expect(d.d_waistCm).toBeNull(); // falta en end
    expect(d.d_quadCm).toBeNull(); // falta en start
  });

  it("todo null sin mediciones", () => {
    const d = measurementDeltas(undefined, undefined);
    expect(Object.values(d).every((v) => v === null)).toBe(true);
  });
});

describe("checkinAggregates", () => {
  const mk = (sleptMinimum: boolean | null, proteinSufficient: boolean | null, energyBalance: Checkin["energyBalance"]): Checkin => ({
    id: "x", sessionId: "s", date: "2026-01-01", sleptMinimum, proteinSufficient, energyBalance,
  });

  it("porcentajes y balance medio", () => {
    const agg = checkinAggregates([
      mk(true, true, "surplus"),
      mk(false, true, "deficit"),
      mk(true, null, "maintenance"),
      mk(null, null, null),
    ]);
    expect(agg.sleepOkPct).toBe(67); // 2/3
    expect(agg.proteinOkPct).toBe(100); // 2/2
    expect(agg.energyBalanceAvg).toBe(0); // (1 - 1 + 0) / 3
  });

  it("null sin datos", () => {
    const agg = checkinAggregates([]);
    expect(agg.sleepOkPct).toBeNull();
    expect(agg.proteinOkPct).toBeNull();
    expect(agg.energyBalanceAvg).toBeNull();
  });
});

describe("activityAggregates", () => {
  it("normaliza por semana dentro de la ventana del meso", () => {
    const acts = [
      { date: "2026-01-02T10:00:00Z", durationMin: 30 }, // dentro
      { date: "2026-01-10T10:00:00Z", durationMin: 45 }, // dentro
      { date: "2026-02-20T10:00:00Z", durationMin: 60 }, // fuera
    ];
    // Ventana de 14 días = 2 semanas exactas.
    const agg = activityAggregates(acts, "2026-01-01T00:00:00Z", "2026-01-15T00:00:00Z");
    expect(agg.extraSessionsPerWeek).toBe(1); // 2 sesiones / 2 semanas
    expect(agg.extraMinutesPerWeek).toBe(37.5); // 75 min / 2 semanas
  });

  it("cero actividades en la ventana = 0 (dato real, no falta de dato)", () => {
    const agg = activityAggregates([], "2026-01-01", "2026-02-01");
    expect(agg.extraSessionsPerWeek).toBe(0);
    expect(agg.extraMinutesPerWeek).toBe(0);
  });

  it("ventanas menores a una semana no inflan el promedio (mínimo 1 semana)", () => {
    const agg = activityAggregates(
      [{ date: "2026-01-02T10:00:00Z", durationMin: 30 }],
      "2026-01-01T00:00:00Z",
      "2026-01-03T00:00:00Z",
    );
    expect(agg.extraSessionsPerWeek).toBe(1);
  });
});

describe("correlationMatrix", () => {
  const obs = (id: string, values: Record<string, number | null>): MesoObservation => ({
    mesoId: id, mesoName: id, progressionModel: "double", values,
  });

  it("matriz simétrica con diagonal 1 y filtra variables sin datos", () => {
    const observations = [
      obs("a", { x: 1, y: 2, z: null }),
      obs("b", { x: 2, y: 4, z: null }),
      obs("c", { x: 3, y: 6, z: 5 }),
    ];
    const r = correlationMatrix(observations, ["x", "y", "z"]);
    expect(r.variables).toEqual(["x", "y"]); // z tiene un solo dato
    expect(r.matrix[0][0]).toBe(1);
    expect(r.matrix[0][1]).toBe(1); // x e y perfectamente correlacionadas
    expect(r.matrix[0][1]).toBe(r.matrix[1][0]);
    expect(r.n).toBe(3);
  });
});

describe("buildMesoObservation y summarizeByModel", () => {
  it("arma la observación con deltas y agregados", () => {
    const o = buildMesoObservation({
      mesoId: "m1",
      mesoName: "Meso 1",
      progressionModel: "double",
      avg1RmDeltaPct: 4.2,
      adherencePct: 90,
      checkins: [],
      startMeasurement: { date: "2026-01-01", bicepCm: 38 },
      endMeasurement: { date: "2026-02-10", bicepCm: 39 },
    });
    expect(o.values.d1rmPct).toBe(4.2);
    expect(o.values.d_bicepCm).toBe(1);
    expect(o.values.sleepOkPct).toBeNull();
  });

  it("promedia por modelo de progresión", () => {
    const observations: MesoObservation[] = [
      { mesoId: "a", mesoName: "a", progressionModel: "double", values: { d1rmPct: 4 } },
      { mesoId: "b", mesoName: "b", progressionModel: "double", values: { d1rmPct: 6 } },
      { mesoId: "c", mesoName: "c", progressionModel: "dup", values: { d1rmPct: 2 } },
    ];
    const s = summarizeByModel(observations, ["d1rmPct"]);
    const double = s.find((x) => x.model === "double")!;
    expect(double.n).toBe(2);
    expect(double.means.d1rmPct).toBe(5);
  });
});
