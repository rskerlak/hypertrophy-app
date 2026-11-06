import { describe, expect, it } from "vitest";
import rulesJson from "../../../rules.config.json";
import { parseRules } from "../rules";

// Auditoría B6: los `.default` de Zod (para configs/respaldos viejos) no pueden
// divergir en silencio de los valores del config.
const strip = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(strip)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("_")).map(([k, x]) => [k, strip(x)]))
      : v;

describe("defaults de Zod = valores del config", () => {
  const full = parseRules(rulesJson) as unknown as Record<string, unknown>;
  for (const key of ["warmup", "rest", "measurements", "baseWeekDefaults", "anchorSet", "intraSession", "apre", "dayIntensity", "longTermTrend", "pain", "externalActivity", "amrapTest"]) {
    it(`sin "${key}" en el config se obtiene lo mismo`, () => {
      const cfg = { ...(rulesJson as Record<string, unknown>) };
      if (!(key in cfg)) return;
      delete cfg[key];
      const parsed = parseRules(cfg) as unknown as Record<string, unknown>;
      expect(strip(parsed[key])).toEqual(strip(full[key]));
    });
  }
});

describe("defaults de Zod de claves anidadas de A5", () => {
  it("sin progression.continuity se obtiene lo mismo", () => {
    const full = parseRules(rulesJson);
    const cfg = JSON.parse(JSON.stringify(rulesJson));
    delete cfg.progression.continuity;
    expect(strip(parseRules(cfg).progression.continuity)).toEqual(strip(full.progression.continuity));
  });
});
