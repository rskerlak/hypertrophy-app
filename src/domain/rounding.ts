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

/**
 * Implemento cargable con discos a los lados (barra o mancuerna armable):
 * mayor peso alcanzable ≤ objetivo.
 */
function roundLoadable(targetKg: number, baseKg: number, platesKg: number[]): number {
  const baseG = toGrams(baseKg);
  const targetG = toGrams(targetKg);
  if (targetG <= baseG) return baseKg;
  const sideTargetG = Math.floor((targetG - baseG) / 2);
  const dp = achievableSideSums(sideTargetG, platesKg.map(toGrams));
  for (let s = sideTargetG; s >= 0; s--) {
    if (dp[s]) return toKg(baseG + 2 * s);
  }
  return baseKg;
}

/** Implemento cargable: menor peso alcanzable estrictamente > actual. */
function nextLoadable(currentKg: number, baseKg: number, platesKg: number[]): number {
  const platesG = platesKg.map(toGrams).filter((p) => p > 0);
  if (platesG.length === 0) return currentKg;
  const baseG = toGrams(baseKg);
  const curG = toGrams(Math.max(currentKg, baseKg));
  const sideCurG = Math.floor((curG - baseG) / 2);
  const minPlateG = Math.min(...platesG);
  // Con denominaciones ilimitadas, el siguiente lado alcanzable está en
  // (sideCur, sideCur + minPlate]: buscar el menor en ese rango.
  const maxSideG = sideCurG + minPlateG;
  const dp = achievableSideSums(maxSideG, platesG);
  for (let s = sideCurG + 1; s <= maxSideG; s++) {
    if (dp[s]) return toKg(baseG + 2 * s);
  }
  return currentKg;
}

/** ¿El inventario describe mancuernas ARMABLES (discos que se combinan)? */
function loadableDumbbell(equipment: Equipment): { base: number; plates: number[] } | null {
  const plates = equipment.dumbbellPlatesKg;
  if (!plates || plates.length === 0) return null;
  return { base: equipment.dumbbellHandleKg ?? 0, plates };
}

/**
 * Paso de respaldo para un rack FIJO de mancuernas cuando la carga actual ya
 * está en (o por encima de) la más pesada del rack: el salto típico del rack.
 * Sin esto, la progresión de carga quedaba congelada en silencio.
 */
function fixedRackFallbackStep(dumbbellsKg: number[]): number {
  const sorted = [...dumbbellsKg].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return sorted[0] ?? 1;
  // Mediana: más representativa que el mínimo (un rack suele tener un salto
  // chico atípico entre las más livianas) y que el último salto.
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

export interface RoundingContext {
  type: EquipmentType;
  equipment: Equipment;
}

/**
 * Redondea al peso alcanzable más cercano POR DEBAJO O IGUAL al objetivo.
 * - barbell: barra + pares de discos disponibles.
 * - dumbbell: armable (mango + pares de discos) si hay `dumbbellPlatesKg`;
 *   si no, al escalón del rack fijo ≤ objetivo (o el más liviano si ninguno).
 * - machine/cable: múltiplo de machineStepKg ≤ objetivo.
 * - bodyweight: identidad.
 */
export function roundToAvailable(targetLoadKg: number, ctx: RoundingContext): number {
  const { type, equipment } = ctx;
  switch (type) {
    case "barbell":
      return roundLoadable(targetLoadKg, equipment.barWeightKg, equipment.platesKg);
    case "dumbbell": {
      const loadable = loadableDumbbell(equipment);
      if (loadable) return roundLoadable(targetLoadKg, loadable.base, loadable.plates);
      const sorted = [...equipment.dumbbellsKg].sort((a, b) => a - b);
      if (sorted.length === 0) return targetLoadKg;
      let best = sorted[0];
      for (const d of sorted) if (d <= targetLoadKg) best = d;
      // Por encima del rack: mantener el objetivo redondeado al paso del rack,
      // en vez de tirarlo abajo hasta la mancuerna más pesada.
      if (targetLoadKg > sorted[sorted.length - 1]) {
        const step = fixedRackFallbackStep(sorted);
        const over = targetLoadKg - sorted[sorted.length - 1];
        return sorted[sorted.length - 1] + Math.floor(over / step + 1e-9) * step;
      }
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
 * Devuelve la carga actual solo si de verdad no hay progresión posible
 * (bodyweight, o inventario vacío): la progresión añade reps en ese caso.
 */
export function nextAchievableLoad(currentLoadKg: number, ctx: RoundingContext): number {
  const { type, equipment } = ctx;
  switch (type) {
    case "barbell":
      return nextLoadable(currentLoadKg, equipment.barWeightKg, equipment.platesKg);
    case "dumbbell": {
      const loadable = loadableDumbbell(equipment);
      if (loadable) return nextLoadable(currentLoadKg, loadable.base, loadable.plates);
      const sorted = [...equipment.dumbbellsKg].sort((a, b) => a - b);
      for (const d of sorted) if (d > currentLoadKg) return d;
      // Ya estás en (o sobre) la más pesada del rack: seguir por el paso del
      // rack en vez de congelar la progresión.
      if (sorted.length > 0) return currentLoadKg + fixedRackFallbackStep(sorted);
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
