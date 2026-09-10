import { describe, expect, it } from "vitest";
import { nextPrescription, rirCapForRepRange } from "../progression";
import { equipment, equipmentNoSmallPlates, rules, sessionLogs } from "./fixtures";

const base = {
  model: "double" as const,
  targetRir: 2,
  repRange: { min: 8, max: 12 },
  currentLoadKg: 80,
  equipmentType: "barbell" as const,
  equipment,
  rules,
};

describe("nextPrescription — sin historial", () => {
  it("usa la carga actual y el piso del rango", () => {
    const p = nextPrescription({ ...base, exerciseHistory: [] });
    expect(p.nextLoadKg).toBe(80);
    expect(p.nextReps).toBe(8);
  });
});

describe("nextPrescription — doble progresión", () => {
  it("debajo del tope: sube una rep a misma carga", () => {
    const history = sessionLogs({
      sessionId: "s1",
      exerciseId: "bench",
      sets: 3,
      loadKg: 80,
      reps: 10,
      rir: 2,
      timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, exerciseHistory: history });
    expect(p.nextLoadKg).toBe(80);
    expect(p.nextReps).toBe(11);
  });

  it("tope alcanzado con discos finos (salto 3.1%): sube carga y vuelve al piso", () => {
    // El rango es un límite duro: al tocar 12 se sube al mínimo alcanzable
    // (80 → 82.5) aunque el salto (3.125%) exceda el % objetivo (2.5%).
    const atCeiling = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 12, rir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, exerciseHistory: atCeiling });
    expect(p.nextLoadKg).toBe(82.5);
    expect(p.nextReps).toBe(8);
  });

  it("salto mínimo grande (sin discos de 1.25, 6.25%): sube igual y AVISA que el salto es grande", () => {
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 12, rir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, equipment: equipmentNoSmallPlates, exerciseHistory: history });
    expect(p).toMatchObject({ nextLoadKg: 85, nextReps: 8 });
    expect(p.rationale).toContain("salto mínimo");
    expect(p.rationale).toContain("6.3%");
  });

  it("mancuerna en el tope del rack: sube por el paso del rack, sin acumular reps sobre el tope", () => {
    // Antes: al llegar a la mancuerna más pesada del rack la carga quedaba
    // clavada para siempre. Ahora el rack extrapola por su paso típico.
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "db-press", sets: 3, loadKg: 30,
      reps: 12, rir: 2, targetReps: 12, targetRir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({
      ...base, equipmentType: "dumbbell", currentLoadKg: 30, exerciseHistory: history,
    });
    expect(p.nextLoadKg).toBeGreaterThan(30);
    expect(p.nextReps).toBe(8);
  });
});

describe("nextPrescription — doble progresión ajustada por RIR", () => {
  it("si te sobró RIR, las reps ajustadas cuentan de más y sube la carga antes", () => {
    // 12 reps @ RIR 4 con objetivo 2 → ajustadas 14 (excedente 2) → crédito
    // 7.5% ≥ salto mínimo 3.125% (discos de 1.25) → sube carga.
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 12, rir: 4, targetReps: 12, targetRir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, exerciseHistory: history });
    expect(p.nextLoadKg).toBe(82.5);
    expect(p.nextReps).toBe(8);
  });

  it("si llegaste al tope moliéndote (RIR < objetivo), prescribe consolidar, no subir", () => {
    // 12 reps @ RIR 0 con objetivo 2 → ajustadas 10 → repetir 12, misma carga.
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 12, rir: 0, targetReps: 12, targetRir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, exerciseHistory: history });
    expect(p.nextLoadKg).toBe(80);
    expect(p.nextReps).toBe(12); // consolidar el tope, no 13
  });

  it("en rangos de reps ALTAS el tope del ajuste baja (RIR más ruidoso a reps altas)", () => {
    // Rango 16–25 (≥ umbral 15) → tope 1 en vez de 2. Con 25 reps @ RIR 4
    // objetivo 2, el ajuste se topea en +1 → ajustadas 26 (excedente 1),
    // crédito 5%; en un rango bajo el mismo caso daría excedente 2.
    const cfg = rules.progressionModels.double;
    expect(rirCapForRepRange({ min: 16, max: 25 }, cfg)).toBe(cfg.rirAdjustmentCapRepsHighRep);
    expect(rirCapForRepRange({ min: 8, max: 12 }, cfg)).toBe(cfg.rirAdjustmentCapReps);
  });

  it("un RIR reportado lejísimo del fallo se topea Y se atenúa (reporte de baja información)", () => {
    // 10 reps @ RIR 8 objetivo 0: el ajuste crudo sería +8 → el tope lo baja a
    // +2 → y como 8 ≥ highRirDampenFrom, se atenúa a la mitad (+1). Ajustadas
    // 11 < tope 12 → prescribe llegar al tope, sin saltar carga.
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 10, rir: 8, targetReps: 10, targetRir: 0, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, exerciseHistory: history });
    expect(p.nextLoadKg).toBe(80);
    expect(p.nextReps).toBe(12);
  });

  it("con el mismo excedente pero cerca del fallo, el ajuste NO se atenúa", () => {
    // 10 reps @ RIR 3 objetivo 1 → excedente +2 sin atenuar → ajustadas 12 =
    // tope → sube carga. (Con atenuación quedarían en 11 y pediría 12.)
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 10, rir: 3, targetReps: 10, targetRir: 1, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, exerciseHistory: history });
    expect(p.nextLoadKg).toBe(82.5);
    expect(p.nextReps).toBe(8);
  });
});

describe("nextPrescription — el rango configurado es un LÍMITE DURO", () => {
  // Regresión (bug reportado con laterales 14 kg, rango 10–12): el motor
  // prescribía 13 y 14 reps "aunque supere el tope" porque el salto de
  // mancuernas (14→16 = +14%) excedía el % objetivo. El rango es
  // configuración explícita del usuario: nunca se prescribe por encima.
  const rack = { ...equipment, dumbbellsKg: [2, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30] };

  it("laterales 14 kg × 12 (10–12) → 16 kg × 10, nunca 13 ni 14 reps", () => {
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "lat", sets: 3, loadKg: 14,
      reps: 12, rir: 1, targetReps: 12, targetRir: 1, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({
      ...base, repRange: { min: 10, max: 12 }, targetRir: 1,
      equipmentType: "dumbbell", currentLoadKg: 14, equipment: rack, exerciseHistory: history,
    });
    expect(p.nextLoadKg).toBe(16);
    expect(p.nextReps).toBe(10);
    expect(p.rationale).toContain("+14.3%");
  });

  it("INVARIANTE: para cualquier historial, nextReps ≤ tope del rango (con salto de carga posible)", () => {
    const range = { min: 10, max: 12 };
    for (const reps of [8, 10, 11, 12, 13, 14, 16, 20]) {
      for (const rir of [0, 1, 2, 4]) {
        const history = sessionLogs({
          sessionId: "s1", exerciseId: "lat", sets: 3, loadKg: 14,
          reps, rir, targetReps: 12, targetRir: 1, timestamp: "2026-01-05T10:00:00Z",
        });
        const p = nextPrescription({
          ...base, repRange: range, targetRir: 1,
          equipmentType: "dumbbell", currentLoadKg: 14, equipment: rack, exerciseHistory: history,
        });
        expect(p.nextReps, `reps=${reps} rir=${rir}`).toBeLessThanOrEqual(range.max);
        expect(p.nextReps, `reps=${reps} rir=${rir}`).toBeGreaterThanOrEqual(range.min);
      }
    }
  });

  it("si el usuario registra MÁS reps que el tope, igual se sube carga al piso (no se premia con más reps)", () => {
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "lat", sets: 3, loadKg: 14,
      reps: 15, rir: 1, targetReps: 12, targetRir: 1, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({
      ...base, repRange: { min: 10, max: 12 }, targetRir: 1,
      equipmentType: "dumbbell", currentLoadKg: 14, equipment: rack, exerciseHistory: history,
    });
    expect(p).toMatchObject({ nextLoadKg: 16, nextReps: 10 });
  });

  it("colchón opcional (maxRepsOverCeiling > 0): solo entonces suma reps sobre el tope, y las muestra", () => {
    const cushion = {
      ...rules,
      progressionModels: {
        ...rules.progressionModels,
        double: { ...rules.progressionModels.double, maxRepsOverCeiling: 2 },
      },
    };
    const mk = (reps: number) => sessionLogs({
      sessionId: "s1", exerciseId: "lat", sets: 3, loadKg: 14,
      reps, rir: 1, targetReps: reps, targetRir: 1, timestamp: "2026-01-05T10:00:00Z",
    });
    const args = { ...base, rules: cushion, repRange: { min: 10, max: 12 }, targetRir: 1, equipmentType: "dumbbell" as const, currentLoadKg: 14, equipment: rack };
    expect(nextPrescription({ ...args, exerciseHistory: mk(12) })).toMatchObject({ nextLoadKg: 14, nextReps: 13 });
    expect(nextPrescription({ ...args, exerciseHistory: mk(13) })).toMatchObject({ nextLoadKg: 14, nextReps: 14 });
    expect(nextPrescription({ ...args, exerciseHistory: mk(14) })).toMatchObject({ nextLoadKg: 16, nextReps: 10 });
    expect(nextPrescription({ ...args, exerciseHistory: mk(12) }).rationale).toContain("colchón 1/2");
  });
});

describe("nextPrescription — la carga base es la REAL registrada", () => {
  // Regresión: la app pasaba la carga del snapshot del plan en vez de la última
  // carga registrada, así que subir carga a mano no se heredaba a la sesión
  // siguiente (se detectó verificando el flujo real end-to-end).
  it("el % de salto se calcula sobre la carga real, no sobre la del plan", () => {
    // Registré 85 kg (el plan decía 80) y toqué el tope del rango: el salto
    // mínimo debe calcularse desde 85 → 87.5, no desde 80 → 82.5.
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 85,
      reps: 14, rir: 2, targetReps: 12, targetRir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, currentLoadKg: 85, exerciseHistory: history });
    expect(p.nextLoadKg).toBe(87.5);
    expect(p.nextReps).toBe(8);
  });

  it("si bajé la carga, la progresión sigue desde ahí (no vuelve al plan)", () => {
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 70,
      reps: 10, rir: 2, targetReps: 10, targetRir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, currentLoadKg: 70, exerciseHistory: history });
    expect(p.nextLoadKg).toBe(70);
    expect(p.nextReps).toBe(11);
  });
});

describe("nextPrescription — lineal", () => {
  it("objetivo cumplido: sube carga al incremento disponible", () => {
    const history = sessionLogs({
      sessionId: "s1",
      exerciseId: "bench",
      sets: 3,
      loadKg: 80,
      reps: 8,
      rir: 2,
      targetReps: 8,
      targetRir: 2,
      timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, model: "linear", exerciseHistory: history });
    // 80 × 1.025 = 82 → redondeo hacia abajo da 80 → usar salto mínimo 82.5.
    expect(p.nextLoadKg).toBe(82.5);
  });

  it("sin progreso en el umbral de sesiones: mantiene carga", () => {
    const s1 = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 6, rir: 2, targetReps: 8, targetRir: 2, timestamp: "2026-01-05T10:00:00Z",
    });
    const s2 = sessionLogs({
      sessionId: "s2", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 6, rir: 2, targetReps: 8, targetRir: 2, timestamp: "2026-01-08T10:00:00Z",
    });
    const p = nextPrescription({ ...base, model: "linear", exerciseHistory: [...s1, ...s2] });
    expect(p.nextLoadKg).toBe(80);
  });
});

describe("nextPrescription — DUP y block", () => {
  it("DUP día liviano: usa el rango del día y suma el offset de RIR", () => {
    const history = sessionLogs({
      sessionId: "s1",
      exerciseId: "fly",
      sets: 2,
      loadKg: 25,
      reps: 18,
      rir: 3,
      timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({
      ...base,
      model: "dup",
      dayType: "light",
      equipmentType: "cable",
      currentLoadKg: 25,
      exerciseHistory: history,
    });
    // light repRange 16–25; 18 < 25 → sube rep.
    expect(p.nextReps).toBe(19);
    expect(p.nextLoadKg).toBe(25);
  });

  it("block: la fase de intensificación usa su rango de reps", () => {
    const history = sessionLogs({
      sessionId: "s1",
      exerciseId: "bench",
      sets: 3,
      loadKg: 80,
      reps: 7,
      rir: 1,
      timestamp: "2026-01-05T10:00:00Z",
    });
    // Semana 4 de 5 → frac 0.8 ≥ 0.6 → intensificación (5–10 reps).
    const p = nextPrescription({
      ...base,
      model: "block",
      weekIndex: 4,
      numAccumulationWeeks: 5,
      exerciseHistory: history,
    });
    expect(p.nextReps).toBe(8); // 7 < 10 → +1 rep dentro del rango de la fase
    expect(p.nextLoadKg).toBe(80);
  });
});
