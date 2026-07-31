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

  it("tope alcanzado con discos finos (salto 3.1% vs credit 2.5%): añade rep; con una rep de excedente sí salta", () => {
    // Con discos de 1.25: salto mínimo desde 80 = 82.5 (+3.125%) > 2.5% → añadir rep.
    const atCeiling = sessionLogs({
      sessionId: "s1",
      exerciseId: "bench",
      sets: 3,
      loadKg: 80,
      reps: 12,
      rir: 2,
      timestamp: "2026-01-05T10:00:00Z",
    });
    const p1 = nextPrescription({ ...base, exerciseHistory: atCeiling });
    expect(p1.nextLoadKg).toBe(80);
    expect(p1.nextReps).toBe(13);

    // Con 13 reps (1 de excedente): crédito 5% ≥ 3.125% → subir a 82.5 y volver al piso.
    const overCeiling = sessionLogs({
      sessionId: "s2",
      exerciseId: "bench",
      sets: 3,
      loadKg: 80,
      reps: 13,
      rir: 2,
      timestamp: "2026-01-08T10:00:00Z",
    });
    const p2 = nextPrescription({ ...base, exerciseHistory: [...atCeiling, ...overCeiling] });
    expect(p2.nextLoadKg).toBe(82.5);
    expect(p2.nextReps).toBe(8);
  });

  it("salto mínimo grande (sin discos de 1.25, 6.25%): acumula reps hasta que el salto sea proporcional", () => {
    const mk = (id: string, reps: number, ts: string) =>
      sessionLogs({ sessionId: id, exerciseId: "bench", sets: 3, loadKg: 80, reps, rir: 2, timestamp: ts });
    const noSmall = { ...base, equipment: equipmentNoSmallPlates };

    // 12 reps (tope): crédito 2.5% < 6.25% → rep 13.
    let p = nextPrescription({ ...noSmall, exerciseHistory: mk("s1", 12, "2026-01-05T10:00:00Z") });
    expect(p).toMatchObject({ nextLoadKg: 80, nextReps: 13 });

    // 13 reps: crédito 5% < 6.25% → rep 14.
    p = nextPrescription({ ...noSmall, exerciseHistory: mk("s2", 13, "2026-01-08T10:00:00Z") });
    expect(p).toMatchObject({ nextLoadKg: 80, nextReps: 14 });

    // 14 reps: crédito 7.5% ≥ 6.25% → saltar a 85 y volver al piso.
    p = nextPrescription({ ...noSmall, exerciseHistory: mk("s3", 14, "2026-01-11T10:00:00Z") });
    expect(p).toMatchObject({ nextLoadKg: 85, nextReps: 8 });
  });

  it("mancuerna en el tope del inventario: sigue añadiendo reps (sin salto posible)", () => {
    const history = sessionLogs({
      sessionId: "s1",
      exerciseId: "db-press",
      sets: 3,
      loadKg: 30,
      reps: 12,
      rir: 2,
      timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({
      ...base,
      equipmentType: "dumbbell",
      currentLoadKg: 30,
      exerciseHistory: history,
    });
    expect(p.nextLoadKg).toBe(30);
    expect(p.nextReps).toBe(13);
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
    // 10 reps @ RIR 3 objetivo 1 → excedente +2, por debajo del umbral de
    // atenuación: ajustadas 12 = tope → añade rep (crédito insuficiente aún).
    const history = sessionLogs({
      sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80,
      reps: 10, rir: 3, targetReps: 10, targetRir: 1, timestamp: "2026-01-05T10:00:00Z",
    });
    const p = nextPrescription({ ...base, exerciseHistory: history });
    expect(p.nextReps).toBe(13);
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
