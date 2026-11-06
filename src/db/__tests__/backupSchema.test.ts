import { describe, expect, it } from "vitest";
import { CURRENT_BACKUP_VERSION, validateBackup } from "../backupSchema";

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
});
