import { describe, expect, it } from "vitest";
import rulesJson from "../../../rules.config.json";
import { effectiveLandmarks, parseRules, rirScheduleForLength } from "../rules";

describe("parseRules", () => {
  it("valida el rules.config.json real sin errores", () => {
    expect(() => parseRules(rulesJson)).not.toThrow();
  });

  it("falla ruidoso si falta un campo requerido", () => {
    const broken = JSON.parse(JSON.stringify(rulesJson));
    delete broken.schemaVersion;
    expect(() => parseRules(broken)).toThrow();
  });
});

describe("effectiveLandmarks", () => {
  const rules = parseRules(rulesJson);

  it("aplica el multiplicador del perfil sobre la base", () => {
    const base = rules.volumeLandmarksBase.chest as { mev: number };
    const inter = effectiveLandmarks(rules, "intermediate", "chest");
    expect(inter.mev).toBe(base.mev * 1.0);
    const adv = effectiveLandmarks(rules, "advanced", "chest");
    expect(adv.mev).toBeCloseTo(base.mev * 1.2, 5);
    const nov = effectiveLandmarks(rules, "novice", "chest");
    expect(nov.mev).toBeCloseTo(base.mev * 0.65, 5);
  });

  it("lanza error para un músculo sin landmarks", () => {
    expect(() => effectiveLandmarks(rules, "intermediate", "inventado")).toThrow();
  });
});

describe("rirScheduleForLength", () => {
  const rules = parseRules(rulesJson);

  it("devuelve la tabla del config para longitudes conocidas", () => {
    expect(rirScheduleForLength(rules, 5)).toEqual([3, 2, 2, 1, 0]);
    expect(rirScheduleForLength(rules, 4)).toEqual([3, 2, 1, 0]);
  });

  it("genera un fallback descendente terminando en 0 para longitudes no tabuladas", () => {
    const s = rirScheduleForLength(rules, 7);
    expect(s).toHaveLength(7);
    expect(s[s.length - 1]).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThanOrEqual(s[i - 1]);
  });
});
