import { describe, expect, it } from "vitest";
import { CURRENT_BACKUP_VERSION, validateBackup } from "../backupSchema";
import backupV1 from "../__fixtures__/backup-v1.json";

function valid() {
  return {
    app: "hypertrophy",
    backupVersion: CURRENT_BACKUP_VERSION,
    exportedAt: "2026-11-05T10:00:00.000Z",
    data: {
      settings: [{ id: "default", experienceProfile: "intermediate", bodyweightKg: 88, prioritizedMuscles: [], equipment: { barWeightKg: 20, platesKg: [1.25, 2.5], dumbbellsKg: [10], machineStepKg: 5 }, extra: "se conserva" }],
      baseWeek: [{ id: "default", days: [{ label: "A", slots: [{ exerciseId: "bench", targetSets: 3, repRange: { min: 8, max: 12 }, startingLoadKg: 80 }] }] }],
      exercises: [{ id: "bench", name: "Press banca", primaryMuscle: "chest", secondaryMuscles: ["triceps"], equipmentType: "barbell", isSwappable: true, swapCandidates: [] }],
      mesocycles: [{ id: "m", name: "Meso", createdAt: "2026-11-01T10:00:00.000Z", numAccumulationWeeks: 4, deloadWeeks: 1, progressionModel: "double", status: "active", plan: { weeks: [{ weekIndex: 0, isDeload: false, days: [] }] } }],
      sessions: [{ id: "s", mesocycleId: "m", weekIndex: 0, dayIndex: 0, dayLabel: "A", isDeload: false, status: "completed", completedAt: "2026-11-02T11:00:00.000Z", plannedDate: "2026-11-02" }],
      setLogs: [{ id: "l", sessionId: "s", exerciseId: "bench", setIndex: 0, targetLoadKg: 80, targetReps: 10, targetRir: 2, actualLoadKg: 80, actualReps: 10, actualRir: 2, rirReported: true, timestamp: "2026-11-02T10:30:00.000Z" }],
      checkins: [{ id: "c", sessionId: "s", date: "2026-11-02", sleptMinimum: true, proteinSufficient: null, energyBalance: null }],
      measurements: [{ id: "x", date: "2026-11-02T10:00:00.000Z", trigger: "manual", bodyweightKg: 88 }],
    },
  };
}

describe("validateBackup (A4.1)", () => {
  it("acepta un respaldo válido y conserva campos desconocidos", () => {
    const r = validateBackup(valid());
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.backup.data.settings[0] as Record<string, unknown>).extra).toBe("se conserva");
  });
  it("acepta respaldos de la versión 1", () => {
    expect(validateBackup({ ...valid(), backupVersion: 1 }).ok).toBe(true);
  });
  it("acepta un respaldo v1 real (fixture: sin campos de A1–A4, sin bugReports)", () => {
    const r = validateBackup(backupV1);
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.data.setLogs).toHaveLength(1);
  });
  it("rechaza una versión futura", () => {
    const r = validateBackup({ ...valid(), backupVersion: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/versión/);
  });
  it("rechaza un archivo de otra app", () => {
    expect(validateBackup({ ...valid(), app: "otra" }).ok).toBe(false);
    expect(validateBackup(null).ok).toBe(false);
  });
  it("nombra la tabla faltante", () => {
    const b = valid() as { data: Record<string, unknown> };
    delete b.data.setLogs;
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Respaldo inválido en setLogs: falta la tabla.");
  });
  it("nombra tabla, fila y campo de una fila corrupta", () => {
    const b = valid();
    b.data.setLogs.push({ ...b.data.setLogs[0], id: "l2", actualReps: 500 });
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Respaldo inválido en setLogs[1].actualReps: reps fuera de rango.");
  });
  it("rechaza RIR, carga y fechas imposibles", () => {
    const rirBad = valid(); rirBad.data.setLogs[0].actualRir = -1;
    const loadBad = valid(); loadBad.data.setLogs[0].actualLoadKg = -5;
    const dateBad = valid(); dateBad.data.sessions[0].completedAt = "ayer";
    for (const b of [rirBad, loadBad, dateBad]) expect(validateBackup(b).ok).toBe(false);
  });
  it("rechaza un rango de reps invertido en la semana base", () => {
    const b = valid(); b.data.baseWeek[0].days[0].slots[0].repRange = { min: 12, max: 8 };
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/baseWeek\[0\]\.days\.0\.slots\.0\.repRange/);
  });
  it("A5.3: la intención del meso es opcional y solo acepta valores conocidos", () => {
    const ok = valid() as unknown as { data: { mesocycles: Array<Record<string, unknown>> } };
    ok.data.mesocycles[0].intent = "maintenance";
    expect(validateBackup(ok).ok).toBe(true);
    ok.data.mesocycles[0].intent = "bulk";
    const r = validateBackup(ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mesocycles\[0\]\.intent/);
  });
  it("A5.5: dolor por zona 0–10 y ajuste por dolor con topes de cordura", () => {
    const b = valid() as unknown as { data: { checkins: Array<Record<string, unknown>>; sessions: Array<Record<string, unknown>> } };
    b.data.checkins[0].pain = [{ zone: "elbow", score: 4 }];
    b.data.sessions[0].overrides = { painAdjust: [{ slotIndex: 0, loadFactor: 0.9, repsUp: 3, rirDelta: 0, zone: "elbow" }] };
    expect(validateBackup(b).ok).toBe(true);
    b.data.checkins[0].pain = [{ zone: "rodilla", score: 4 }];
    expect(validateBackup(b).ok).toBe(false);
    b.data.checkins[0].pain = [{ zone: "knee", score: 11 }];
    expect(validateBackup(b).ok).toBe(false);
    b.data.checkins[0].pain = [];
    b.data.sessions[0].overrides = { painAdjust: [{ slotIndex: 0, loadFactor: 0.1, repsUp: 3, rirDelta: 0, zone: "elbow" }] };
    expect(validateBackup(b).ok).toBe(false);
  });
  it("A5.6: actividades con origen, distancia y FC validadas con topes de cordura", () => {
    const withActivity = (row: Record<string, unknown>) => {
      const b = valid() as unknown as { data: { activities?: Array<Record<string, unknown>> } };
      b.data.activities = [{ id: "a1", date: "2026-11-05T12:00:00.000Z", type: "running", ...row }];
      return validateBackup(b).ok;
    };
    expect(withActivity({ type: "swimming", durationMin: 40, intensity: 3, source: "strava", externalId: "strava:1", distanceKm: 1.5, avgHr: 140, maxHr: 165 })).toBe(true);
    expect(withActivity({})).toBe(true);
    expect(withActivity({ type: "yoga" })).toBe(false);
    expect(withActivity({ durationMin: -1 })).toBe(false);
    expect(withActivity({ intensity: 4 })).toBe(false);
    expect(withActivity({ source: "fitbit" })).toBe(false);
    expect(withActivity({ avgHr: 400 })).toBe(false);
    expect(withActivity({ distanceKm: 2000 })).toBe(false);
  });
  it("R-01: overrides de sesión con factores imposibles se rechazan", () => {
    const b = valid() as unknown as { data: { sessions: Array<Record<string, unknown>> } };
    b.data.sessions[0].overrides = { exerciseDeload: [{ slotIndex: 0, setsFactor: 0.5, loadFactor: 1e9 }] };
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sessions\[0\]\.overrides\.exerciseDeload\.0\.loadFactor/);
    b.data.sessions[0].overrides = { exercise: "no-es-lista" };
    expect(validateBackup(b).ok).toBe(false);
  });
  it("R-02: con miles de filas inválidas corta en la primera (memoria acotada)", () => {
    const b = valid();
    const bad = { ...b.data.setLogs[0], actualReps: -1 };
    b.data.setLogs = Array.from({ length: 200_000 }, (_, i) => ({ ...bad, id: `x${i}` }));
    const t0 = performance.now();
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Respaldo inválido en setLogs[0].actualReps: reps negativas.");
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("R-02: listas anidadas enormes se cortan por largo antes de validar", () => {
  it("5 M discos en el inventario se rechazan rápido y sin validar cada uno", () => {
    const b = valid();
    (b.data.settings[0].equipment as { platesKg: unknown[] }).platesKg = new Array(5_000_000).fill(1.25);
    const t0 = performance.now();
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/settings\[0\]\.equipment\.platesKg: demasiadas filas/);
    // Lo que importa es no validar 5 M elementos (memoria); el recorrido barato
    // del largo depende de la máquina, así que el umbral es holgado.
    expect(performance.now() - t0).toBeLessThan(20000);
  }, 60000);
});
