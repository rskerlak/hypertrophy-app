import { describe, expect, it } from "vitest";
import { estimate1RM, loadForTarget } from "../oneRepMax";
import { equipment, rules } from "./fixtures";

describe("estimate1RM (Epley ajustado por RIR)", () => {
  it("a 1 rep y 0 RIR devuelve ~la carga", () => {
    expect(estimate1RM(100, 1, 0, rules)).toBeCloseTo(100 * (1 + 0.0333 * 1), 5);
  });

  it("suma reps + RIR como reps efectivas", () => {
    // 5 reps a 2 RIR = 7 reps efectivas
    expect(estimate1RM(100, 5, 2, rules)).toBeCloseTo(100 * (1 + 0.0333 * 7), 5);
  });

  it("más reps/RIR estima un 1RM mayor a igual carga", () => {
    expect(estimate1RM(100, 10, 2, rules)).toBeGreaterThan(estimate1RM(100, 5, 2, rules));
  });
});

describe("loadForTarget", () => {
  it("invierte la fórmula y redondea al incremento disponible", () => {
    const oneRm = estimate1RM(100, 5, 2, rules); // ~123.3
    const load = loadForTarget(oneRm, 8, 2, rules, { type: "barbell", equipment });
    // carga cruda = 1RM / (1 + 0.0333*10) ≈ 92.5 → redondeo a alcanzable ≤
    expect(load).toBeLessThanOrEqual(92.5 + 1e-9);
    expect(load).toBeGreaterThan(85);
  });
});
