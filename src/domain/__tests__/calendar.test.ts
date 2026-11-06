import { describe, expect, it } from "vitest";
import { recommendCalendarShift } from "../calendar";

describe("recommendCalendarShift con días reales (A3.2)", () => {
  it("pocos días de atraso: correr la agenda", () => {
    for (const d of [0, 1, 3, 5]) expect(recommendCalendarShift({ daysMissed: d }).action).toBe("shift");
  });
  it("casi una semana o más: sugerir saltar", () => {
    for (const d of [6, 7, 14]) expect(recommendCalendarShift({ daysMissed: d }).action).toBe("skip");
  });
  it("el motivo siempre aclara que la progresión es por sesión, no por fecha", () => {
    for (const d of [1, 10]) expect(recommendCalendarShift({ daysMissed: d }).rationale).toMatch(/por sesión completada/);
  });
});
