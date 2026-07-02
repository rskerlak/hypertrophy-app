import { describe, expect, it } from "vitest";
import { suggestExerciseSwap } from "../swap";
import { exercises, rules, sessionLogs } from "./fixtures";

const bench = exercises.find((e) => e.id === "bench")!;
const row = exercises.find((e) => e.id === "row")!;
const candidates = exercises.filter((e) => bench.swapCandidates.includes(e.id));

const stagnantHistory = (loadKg: number, reps: number) => [
  ...sessionLogs({ sessionId: "s1", exerciseId: "bench", sets: 3, loadKg, reps, rir: 2, timestamp: "2026-01-01T10:00:00Z" }),
  ...sessionLogs({ sessionId: "s2", exerciseId: "bench", sets: 3, loadKg, reps, rir: 2, timestamp: "2026-01-04T10:00:00Z" }),
  ...sessionLogs({ sessionId: "s3", exerciseId: "bench", sets: 3, loadKg, reps, rir: 2, timestamp: "2026-01-07T10:00:00Z" }),
  ...sessionLogs({ sessionId: "s4", exerciseId: "bench", sets: 3, loadKg, reps, rir: 2, timestamp: "2026-01-10T10:00:00Z" }),
];

describe("suggestExerciseSwap", () => {
  it("no actúa sobre ejercicios no swappable", () => {
    const r = suggestExerciseSwap({ exercise: row, candidates: [], history: stagnantHistory(70, 8), rules });
    expect(r.suggest).toBe(false);
  });

  it("no sugiere sin suficiente historial", () => {
    const r = suggestExerciseSwap({
      exercise: bench,
      candidates,
      history: sessionLogs({ sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80, reps: 8, rir: 2, timestamp: "2026-01-01T10:00:00Z" }),
      rules,
    });
    expect(r.suggest).toBe(false);
  });

  it("no sugiere si hay progreso (1RM estimado sube)", () => {
    const progressing = [
      ...sessionLogs({ sessionId: "s1", exerciseId: "bench", sets: 3, loadKg: 80, reps: 8, rir: 2, timestamp: "2026-01-01T10:00:00Z" }),
      ...sessionLogs({ sessionId: "s2", exerciseId: "bench", sets: 3, loadKg: 80, reps: 9, rir: 2, timestamp: "2026-01-04T10:00:00Z" }),
      ...sessionLogs({ sessionId: "s3", exerciseId: "bench", sets: 3, loadKg: 80, reps: 10, rir: 2, timestamp: "2026-01-07T10:00:00Z" }),
      ...sessionLogs({ sessionId: "s4", exerciseId: "bench", sets: 3, loadKg: 82.5, reps: 8, rir: 2, timestamp: "2026-01-10T10:00:00Z" }),
    ];
    const r = suggestExerciseSwap({ exercise: bench, candidates, history: progressing, rules });
    expect(r.suggest).toBe(false);
  });

  it("sugiere ante estancamiento y prefiere reemplazo con perfil stretch", () => {
    const r = suggestExerciseSwap({ exercise: bench, candidates, history: stagnantHistory(80, 8), rules });
    expect(r.suggest).toBe(true);
    // db-press y fly son stretch; el primero encontrado es db-press
    expect(r.candidateId).toBe("db-press");
    expect(r.reason).toContain("estiramiento");
  });
});
