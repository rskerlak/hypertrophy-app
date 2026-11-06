// A5.2 — Memoria larga: e1RM por meso y "techo sugerido" probabilístico.

import { describe, expect, it } from "vitest";
import { longTermTrend, type ExercisePoint } from "../analytics";
import type { MesoIntent } from "../types";
import { rules } from "./fixtures";

/** Puntos de un meso: `sessions` sesiones con el e1RM dado y RIR reportado `rir`. */
function mesoPoints(
  mesocycleId: string,
  month: number,
  e1rmKg: number,
  opts: { rir?: number; reported?: boolean; range?: [number, number]; sessions?: number } = {},
): ExercisePoint[] {
  const { rir = 1, reported = true, range = [8, 10], sessions = 4 } = opts;
  return Array.from({ length: sessions }, (_, i) => ({
    sessionId: `${mesocycleId}-${i}`,
    date: `2026-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
    mesocycleId,
    trackKey: `normal|${range[0]}-${range[1]}`,
    trackLabel: `${range[0]}–${range[1]}`,
    e1rmKg,
    e1rmFromReported: reported,
    topLoadKg: 100,
    repsAtTopLoad: 8,
    repRange: { min: range[0], max: range[1] },
    sets: [
      { loadKg: 100, reps: 8, rir, rirReported: reported },
      { loadKg: 100, reps: 8, rir, rirReported: reported },
    ],
  }));
}

const mesos = (ids: string[], intents: Partial<Record<string, MesoIntent>> = {}) => ids.map((id) => ({ id, intent: intents[id] }));

describe("longTermTrend (A5.2.1)", () => {
  it("3 mesos planos cerca del fallo → techo sugerido", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 117), ...mesoPoints("b", 5, 118), ...mesoPoints("c", 7, 117.5)],
      mesos: mesos(["a", "b", "c"]),
      rules,
    });
    expect(t.flatMesos).toBe(3);
    expect(t.plateauSuggested).toBe(true);
    expect(t.approximate).toBe(false);
    expect(t.points.map((p) => p.mesocycleId)).toEqual(["a", "b", "c"]);
  });

  it("planos pero lejos del fallo → no sugiere (todavía hay margen de esfuerzo)", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 117, { rir: 3 }), ...mesoPoints("b", 5, 118, { rir: 3 }), ...mesoPoints("c", 7, 117.5, { rir: 3 })],
      mesos: mesos(["a", "b", "c"]),
      rules,
    });
    expect(t.flatMesos).toBe(3);
    expect(t.plateauSuggested).toBe(false);
  });

  it("un meso de mantenimiento en el medio no cuenta: se compara el 1 con el 3", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 117), ...mesoPoints("m", 5, 110), ...mesoPoints("c", 7, 117.5)],
      mesos: mesos(["a", "m", "c"], { m: "maintenance" }),
      rules,
    });
    expect(t.points.find((p) => p.mesocycleId === "m")?.countable).toBe(false);
    expect(t.flatMesos).toBe(2);
    expect(t.plateauSuggested).toBe(false);
  });

  it("progreso real → sin techo y pendiente positiva", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 110), ...mesoPoints("b", 5, 115), ...mesoPoints("c", 7, 120)],
      mesos: mesos(["a", "b", "c"]),
      rules,
    });
    expect(t.plateauSuggested).toBe(false);
    expect(t.flatMesos).toBe(0);
    expect(t.slopePctPerMeso).toBeGreaterThan(3);
  });

  it("rangos muy distintos (12 vs 6 reps) → comparación aproximada", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 117, { range: [10, 12] }), ...mesoPoints("b", 5, 118, { range: [4, 6] })],
      mesos: mesos(["a", "b"]),
      rules,
    });
    expect(t.approximate).toBe(true);
  });

  it("eco de RIR o sin RIR reportado → no confiable y nunca sugiere", () => {
    const pts = [...mesoPoints("a", 3, 117), ...mesoPoints("b", 5, 118), ...mesoPoints("c", 7, 117.5)];
    const echo = longTermTrend({ points: pts, mesos: mesos(["a", "b", "c"]), echoMesoIds: new Set(["b"]), rules });
    expect(echo.points.find((p) => p.mesocycleId === "b")?.reliable).toBe(false);
    expect(echo.plateauSuggested).toBe(false);
    const unreported = longTermTrend({
      points: [...mesoPoints("a", 3, 117, { reported: false }), ...mesoPoints("b", 5, 118, { reported: false }), ...mesoPoints("c", 7, 117, { reported: false })],
      mesos: mesos(["a", "b", "c"]),
      rules,
    });
    expect(unreported.plateauSuggested).toBe(false);
  });

  it("rango con tope mayor a highRepUnreliableFrom → no confiable", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 117, { range: [15, 20] })],
      mesos: mesos(["a"]),
      rules,
    });
    expect(t.points[0].reliable).toBe(false);
  });

  it("con 2 mesos nunca sugiere techo", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 117), ...mesoPoints("b", 5, 117)],
      mesos: mesos(["a", "b"]),
      rules,
    });
    expect(t.flatMesos).toBe(2);
    expect(t.plateauSuggested).toBe(false);
  });

  it("ejercicio en Mantener → ningún meso cuenta", () => {
    const t = longTermTrend({
      points: [...mesoPoints("a", 3, 117), ...mesoPoints("b", 5, 118), ...mesoPoints("c", 7, 117.5)],
      mesos: mesos(["a", "b", "c"]),
      holdLoad: true,
      rules,
    });
    expect(t.plateauSuggested).toBe(false);
    expect(t.points.every((p) => !p.countable)).toBe(true);
  });

  it("el e1RM del meso es la mediana de las mejores sesiones (un pico aislado no manda)", () => {
    const pts = mesoPoints("a", 3, 100, { sessions: 5 });
    pts[4] = { ...pts[4], e1rmKg: 130 };
    const t = longTermTrend({ points: pts, mesos: mesos(["a"]), rules });
    expect(t.points[0].e1rmKg).toBe(100);
  });
});

describe("auditoría A5S-03: escala con muchos puntos", () => {
  it("200 000 puntos no desbordan la pila y terminan rápido", () => {
    const points = Array.from({ length: 200_000 }, (_, i) => ({
      sessionId: `s${i}`,
      date: `2026-01-01T10:00:00Z`,
      mesocycleId: `m${i % 4}`,
      trackKey: "normal|8-10",
      trackLabel: "8–10",
      e1rmKg: 100,
      e1rmFromReported: true,
      topLoadKg: 100,
      repsAtTopLoad: 8,
      repRange: { min: 8, max: 10 },
      sets: [{ loadKg: 100, reps: 8, rir: 1, rirReported: true }],
    }));
    const t0 = performance.now();
    const t = longTermTrend({ points, mesos: ["m0", "m1", "m2", "m3"].map((id) => ({ id })), rules });
    expect(t.points).toHaveLength(4);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
