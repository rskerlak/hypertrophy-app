import { describe, expect, it } from "vitest";
import { displayStep, fmtLoad, fromDisplay, toDisplay } from "../units";

describe("unidades de visualización (A4.7)", () => {
  it("ida y vuelta lb ↔ kg sin pérdida visible", () => {
    expect(fmtLoad(fromDisplay(225, "lb"), "lb")).toBe("225");
    expect(fmtLoad(fromDisplay(132.5, "lb"), "lb")).toBe("132.5");
    expect(toDisplay(fromDisplay(45, "lb"), "lb")).toBeCloseTo(45, 9);
  });
  it("en kg no cambia nada", () => {
    expect(fmtLoad(107.5, "kg")).toBe("107.5");
    expect(fromDisplay(80, "kg")).toBe(80);
  });
  it("pasos de 2.5 kg se muestran como 5 lb", () => {
    expect(displayStep(2.5, "lb")).toBe(5);
    expect(displayStep(1, "lb")).toBe(2.5);
    expect(displayStep(2.5, "kg")).toBe(2.5);
  });
});
