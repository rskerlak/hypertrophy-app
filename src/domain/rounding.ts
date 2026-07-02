// Redondeo de cargas a incrementos FÍSICAMENTE disponibles según el
// inventario del usuario. Aritmética en gramos (enteros) para evitar
// errores de coma flotante con discos de 1.25 kg.

import type { Equipment, EquipmentType } from "./types";

const toGrams = (kg: number) => Math.round(kg * 1000);
const toKg = (g: number) => g / 1000;

/** Sumas por lado alcanzables con pares de discos (cantidad ilimitada por denominación). */
function achievableSideSums(maxSideG: number, platesG: number[]): boolean[] {
  const dp = new Array<boolean>(maxSideG + 1).fill(false);
  dp[0] = true;
  for (const p of platesG) {
    if (p <= 0) continue;
    for (let s = p; s <= maxSideG; s++) {
      if (dp[s - p]) dp[s] = true;
    }
  }
  return dp;
}

export interface RoundingContext {
  type: EquipmentType;
  equipment: Equipment;
}

/**
 * Redondea al peso alcanzable más cercano POR DEBAJO O IGUAL al objetivo.
 * - barbell: barra + pares de discos disponibles.
 * - dumbbell: escalón de mancuerna disponible <= objetivo (o la menor si ninguna).
 * - machine/cable: múltiplo de machineStepKg <= objetivo.
 * - bodyweight: identidad.
 */
export function roundToAvailable(targetLoadKg: number, ctx: RoundingContext): number {
  const { type, equipment } = ctx;
  switch (type) {
    case "barbell": {
      const barG = toGrams(equipment.barWeightKg);
      const targetG = toGrams(targetLoadKg);
      if (targetG <= barG) return equipment.barWeightKg;
      const sideTargetG = Math.floor((targetG - barG) / 2);
      const platesG = equipment.platesKg.map(toGrams);
      const dp = achievableSideSums(sideTargetG, platesG);
      for (let s = sideTargetG; s >= 0; s--) {
        if (dp[s]) return toKg(barG + 2 * s);
      }
      return equipment.barWeightKg;
    }
    case "dumbbell": {
      const sorted = [...equipment.dumbbellsKg].sort((a, b) => a - b);
      if (sorted.length === 0) return targetLoadKg;
      let best = sorted[0];
      for (const d of sorted) if (d <= targetLoadKg) best = d;
      return best;
    }
    case "machine":
    case "cable": {
      const step = equipment.machineStepKg;
      if (step <= 0) return targetLoadKg;
      return Math.max(step, Math.floor(targetLoadKg / step + 1e-9) * step);
    }
    case "bodyweight":
      return targetLoadKg;
  }
}

/**
 * Menor carga alcanzable estrictamente MAYOR que la actual (el "salto mínimo").
 * Devuelve la carga actual si no hay progresión de carga posible (p. ej. bodyweight,
 * o mancuerna más pesada ya en uso): la progresión debe añadir reps en ese caso.
 */
export function nextAchievableLoad(currentLoadKg: number, ctx: RoundingContext): number {
  const { type, equipment } = ctx;
  switch (type) {
    case "barbell": {
      const platesG = equipment.platesKg.map(toGrams).filter((p) => p > 0);
      if (platesG.length === 0) return currentLoadKg;
      const barG = toGrams(equipment.barWeightKg);
      const curG = toGrams(Math.max(currentLoadKg, equipment.barWeightKg));
      const sideCurG = Math.floor((curG - barG) / 2);
      const minPlateG = Math.min(...platesG);
      // Con denominaciones ilimitadas, el siguiente lado alcanzable está en
      // (sideCur, sideCur + minPlate]: buscar el menor en ese rango.
      const maxSideG = sideCurG + minPlateG;
      const dp = achievableSideSums(maxSideG, platesG);
      for (let s = sideCurG + 1; s <= maxSideG; s++) {
        if (dp[s]) return toKg(barG + 2 * s);
      }
      return currentLoadKg;
    }
    case "dumbbell": {
      const sorted = [...equipment.dumbbellsKg].sort((a, b) => a - b);
      for (const d of sorted) if (d > currentLoadKg) return d;
      return currentLoadKg;
    }
    case "machine":
    case "cable": {
      const step = equipment.machineStepKg;
      if (step <= 0) return currentLoadKg;
      return (Math.floor(currentLoadKg / step + 1e-9) + 1) * step;
    }
    case "bodyweight":
      return currentLoadKg;
  }
}
