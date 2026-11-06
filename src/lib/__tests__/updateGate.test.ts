import { describe, expect, it } from "vitest";
import { shouldShowUpdatePrompt, updateActionOnTap } from "../updateGate";

describe("guard de actualización (A4.3)", () => {
  const base = { waiting: true, sessionInProgress: false, deferred: false };
  it("sin SW esperando no hay aviso", () => {
    expect(shouldShowUpdatePrompt({ ...base, waiting: false })).toBe(false);
  });
  it("sin sesión en curso: aviso y aplicar al tocar", () => {
    expect(shouldShowUpdatePrompt(base)).toBe(true);
    expect(updateActionOnTap(base)).toBe("apply");
  });
  it("con sesión en curso: tocar pregunta en vez de aplicar", () => {
    expect(updateActionOnTap({ ...base, sessionInProgress: true })).toBe("ask");
  });
  it("pospuesto: se oculta mientras dure la sesión y vuelve al terminarla", () => {
    expect(shouldShowUpdatePrompt({ ...base, sessionInProgress: true, deferred: true })).toBe(false);
    expect(shouldShowUpdatePrompt({ ...base, sessionInProgress: false, deferred: true })).toBe(true);
  });
});
