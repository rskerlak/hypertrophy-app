import { describe, expect, it } from "vitest";
import { displayStep, fmtLoad, fromDisplay, parseLoadList, toDisplay } from "../units";

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
  it("M1: mostrar en lb y volver a guardar sin editar no altera los discos", () => {
    const kg = [1.25, 2.5, 5, 10, 15, 20, 25];
    const shown = kg.map((k) => fmtLoad(k, "lb")).join(", ");
    expect(parseLoadList(shown, kg, "lb")).toEqual(kg);
    // Un disco nuevo tipeado en lb sí se convierte.
    const withNew = parseLoadList(shown + ", 45", kg, "lb");
    expect(withNew).toHaveLength(8);
    expect(withNew.some((k) => Math.abs(k - 20.41) < 0.01)).toBe(true);
  });
});
