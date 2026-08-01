import { describe, expect, it } from "vitest";
import { nextAchievableLoad, roundToAvailable } from "../rounding";
import { equipment, equipmentNoSmallPlates } from "./fixtures";
import type { Equipment } from "../types";

describe("roundToAvailable — barbell", () => {
  it("redondea 82.1 kg hacia abajo a 80 con discos que incluyen 1.25 (82.5 > objetivo)", () => {
    // 82.5 = barra 20 + 2×31.25 es alcanzable con par de 1.25, pero queda POR ENCIMA
    // del objetivo 82.1 → el alcanzable ≤ objetivo es 80.
    expect(roundToAvailable(82.1, { type: "barbell", equipment })).toBe(80);
  });

  it("alcanza exactamente 82.5 si es el objetivo y hay discos de 1.25", () => {
    expect(roundToAvailable(82.5, { type: "barbell", equipment })).toBe(82.5);
  });

  it("sin disco de 1.25, el paso es 5: 84.9 → 80", () => {
    expect(
      roundToAvailable(84.9, { type: "barbell", equipment: equipmentNoSmallPlates }),
    ).toBe(80);
  });

  it("devuelve el peso de la barra si el objetivo es menor que la barra", () => {
    expect(roundToAvailable(15, { type: "barbell", equipment })).toBe(20);
  });
});

describe("roundToAvailable — dumbbell / machine / bodyweight", () => {
  it("mancuernas: redondea al escalón disponible ≤ objetivo", () => {
    expect(roundToAvailable(27.3, { type: "dumbbell", equipment })).toBe(26);
    expect(roundToAvailable(26, { type: "dumbbell", equipment })).toBe(26);
  });

  it("mancuernas: si el objetivo es menor que la más liviana, devuelve la más liviana", () => {
    expect(roundToAvailable(1, { type: "dumbbell", equipment })).toBe(2);
  });

  it("machine: múltiplo de machineStepKg ≤ objetivo", () => {
    expect(roundToAvailable(52.4, { type: "machine", equipment })).toBe(50);
    expect(roundToAvailable(55, { type: "cable", equipment })).toBe(55);
  });

  it("bodyweight: identidad", () => {
    expect(roundToAvailable(77.7, { type: "bodyweight", equipment })).toBe(77.7);
  });
});

describe("nextAchievableLoad (salto mínimo)", () => {
  it("barbell con 1.25: siguiente desde 80 es 82.5", () => {
    expect(nextAchievableLoad(80, { type: "barbell", equipment })).toBe(82.5);
  });

  it("barbell sin 1.25: siguiente desde 80 es 85", () => {
    expect(
      nextAchievableLoad(80, { type: "barbell", equipment: equipmentNoSmallPlates }),
    ).toBe(85);
  });

  it("dumbbell: siguiente desde 26 es 30; en el tope extrapola por el paso típico", () => {
    expect(nextAchievableLoad(26, { type: "dumbbell", equipment })).toBe(30);
    // Antes devolvía 30 (progresión congelada); ahora sigue por la mediana (2).
    expect(nextAchievableLoad(30, { type: "dumbbell", equipment })).toBe(32);
  });

  it("machine: siguiente múltiplo del paso", () => {
    expect(nextAchievableLoad(50, { type: "machine", equipment })).toBe(55);
  });

  it("bodyweight: sin progresión de carga (devuelve la actual)", () => {
    expect(nextAchievableLoad(80, { type: "bodyweight", equipment })).toBe(80);
  });
});

describe("mancuernas ARMABLES (discos que se combinan)", () => {
  // Caso real: mango de 2 kg + discos por lado. Una mancuerna de 37.5 kg no
  // existe en ningún rack fijo, pero sí se arma.
  const loadable: Equipment = {
    ...equipment,
    dumbbellPlatesKg: [1.25, 2.5, 5, 10, 15, 20],
    dumbbellHandleKg: 2,
  };

  it("alcanza pesos que ningún rack fijo tiene", () => {
    // 2 + 2×17.5 = 37 (17.5 = 15+2.5); 37.5 no es alcanzable con estos discos
    expect(roundToAvailable(37.5, { type: "dumbbell", equipment: loadable })).toBe(37);
    expect(roundToAvailable(52, { type: "dumbbell", equipment: loadable })).toBe(52); // 2+2×25
  });

  it("progresa por encima de la mancuerna más pesada del rack fijo", () => {
    // Con rack fijo (máx 30) desde 37.5 el motor quedaba CONGELADO.
    expect(nextAchievableLoad(37.5, { type: "dumbbell", equipment: loadable })).toBe(39.5);
  });

  it("el salto mínimo es un par del disco más chico", () => {
    expect(nextAchievableLoad(22, { type: "dumbbell", equipment: loadable })).toBe(24.5);
  });
});

describe("rack fijo: nunca congelar la progresión por encima del máximo", () => {
  it("por encima de la mancuerna más pesada, extrapola por el paso típico (mediana)", () => {
    // Rack [2,4,5,6,8,…,26,30]: saltos mayormente de 2 → mediana 2.
    expect(nextAchievableLoad(37.5, { type: "dumbbell", equipment })).toBe(39.5);
    expect(nextAchievableLoad(30, { type: "dumbbell", equipment })).toBe(32);
  });

  it("dentro del rack sigue eligiendo el escalón real", () => {
    expect(nextAchievableLoad(20, { type: "dumbbell", equipment })).toBe(22);
  });
});
