import { describe, expect, it } from "vitest";
import { suggestVolumeTrim, trimRoleBySlot } from "../volumeTrim";
import { weeklyVolumeByMuscle } from "../volume";
import { exercisesById, rules } from "./fixtures";
import type { BaseWeek } from "../types";

const run = (baseWeek: BaseWeek, profile: "intermediate" | "advanced" = "intermediate") => {
  const volumeByMuscle = weeklyVolumeByMuscle(baseWeek, exercisesById, rules);
  return suggestVolumeTrim({ baseWeek, exercisesById, volumeByMuscle, profile, rules });
};

const slot = (exerciseId: string, targetSets = 4) => ({
  exerciseId,
  targetSets,
  repRange: { min: 8, max: 12 },
  startingLoadKg: 40,
});

describe("suggestVolumeTrim", () => {
  it("no marca nada si el volumen está dentro de lo aconsejable", () => {
    const bw: BaseWeek = { days: [{ label: "A", slots: [slot("bench", 3)] }] };
    const r = run(bw);
    expect(r.muscles).toHaveLength(0);
    expect(r.decisions).toHaveLength(0);
  });

  it("con pecho excedido, conserva anclas y marca las series de más como recortables", () => {
    // 5 slots de pecho × 4 series = 20 directas > MAV 16 (intermediate).
    const bw: BaseWeek = {
      days: [
        { label: "A", slots: [slot("bench"), slot("db-press"), slot("fly")] },
        { label: "B", slots: [slot("bench"), slot("fly")] },
      ],
    };
    const r = run(bw);
    const chest = r.muscles.find((m) => m.muscle === "chest")!;
    // 20 series directas: entre MAV (16) y MRV (22) → nivel "alto", no "exceso".
    expect(chest.level).toBe("mav");
    expect(chest.current).toBe(20);
    const roles = r.decisions.filter((d) => d.muscle === "chest");
    expect(roles.some((d) => d.role === "anchor")).toBe(true);
    expect(roles.some((d) => d.role === "trim")).toBe(true);
    // El volumen conservado no debería exceder mucho el objetivo.
    const kept = roles.filter((d) => d.role === "anchor").reduce((a, d) => a + d.contribution, 0);
    expect(kept).toBeLessThanOrEqual(chest.target + 4); // + margen del perfil no cubierto
  });

  it("conserva al menos un ejercicio de cada perfil de resistencia (no recorta la variedad)", () => {
    // bench = mid, db-press = stretch, fly = stretch (todos pecho).
    const bw: BaseWeek = {
      days: [
        { label: "A", slots: [slot("bench", 8), slot("db-press", 8), slot("fly", 8)] },
      ],
    };
    const r = run(bw);
    const anchors = r.decisions.filter((d) => d.muscle === "chest" && d.role === "anchor");
    const profiles = new Set(
      anchors.map((a) => exercisesById.get(a.exerciseId)!.resistanceProfile),
    );
    // Aunque el volumen esté muy excedido, quedan anclas de perfil mid y stretch.
    expect(profiles.has("mid")).toBe(true);
    expect(profiles.has("stretch")).toBe(true);
  });

  it("prioriza el aporte directo sobre el sinergista al elegir anclas", () => {
    // curl (bíceps directo) + row (bíceps sinergista), bíceps excedido.
    const bw: BaseWeek = {
      days: [
        { label: "A", slots: [slot("row", 10), slot("curl", 10)] },
        { label: "B", slots: [slot("row", 10), slot("curl", 10)] },
      ],
    };
    const r = run(bw);
    const biceps = r.decisions.filter((d) => d.muscle === "biceps");
    const firstAnchor = biceps.find((d) => d.role === "anchor")!;
    // El primer ancla de bíceps es un curl (directo), no un remo (sinergista).
    expect(firstAnchor.exerciseId).toBe("curl");
    // Y algún remo queda marcado como prescindible PARA BÍCEPS.
    expect(biceps.some((d) => d.exerciseId === "row" && d.role === "trim")).toBe(true);
  });

  it("trimRoleBySlot: un slot que es ancla de un músculo no se marca recortable por otro", () => {
    const bw: BaseWeek = {
      days: [
        { label: "A", slots: [slot("row", 10), slot("curl", 10)] },
        { label: "B", slots: [slot("row", 10), slot("curl", 10)] },
      ],
    };
    const r = run(bw);
    const bySlot = trimRoleBySlot(r);
    // row es ancla de espalda (directo) aunque sea recortable para bíceps.
    const rowKey = "0:0";
    expect(bySlot.get(rowKey)?.role).toBe("anchor");
  });

  it("NO marca recortable un ejercicio cuyo exceso viene solo del aporte sinergista", () => {
    // squat es quads-primario y glutes-sinergista. Con glúteos excedidos pero
    // cuádriceps dentro de rango, la sentadilla NO debe salir "prescindible":
    // sacarla perdería el trabajo directo de cuádriceps.
    const bw: BaseWeek = {
      days: [
        { label: "A", slots: [slot("squat", 4), slot("curl", 12)] },
        { label: "B", slots: [slot("squat", 4)] },
      ],
    };
    const r = run(bw, "advanced");
    const bySlot = trimRoleBySlot(r);
    expect(bySlot.get("0:0")?.role).not.toBe("trim");
    expect(bySlot.get("1:0")?.role).not.toBe("trim");
    // pero la decisión sigue existiendo en el detalle del dominio
    const glute = r.decisions.filter((d) => d.muscle === "glutes" && d.exerciseId === "squat");
    expect(glute.every((d) => d.direct === false)).toBe(true);
  });

  it("es determinista", () => {
    const bw: BaseWeek = {
      days: [{ label: "A", slots: [slot("bench", 6), slot("db-press", 6), slot("fly", 6)] }],
    };
    expect(JSON.stringify(run(bw))).toBe(JSON.stringify(run(bw)));
  });
});
