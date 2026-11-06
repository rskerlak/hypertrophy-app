// Unidad de VISUALIZACIÓN de cargas (A4.7). El dominio y la base guardan todo en
// kg; esto solo convierte al mostrar y al tipear. 1 lb = 0.45359237 kg es la
// definición internacional (constante física, no un parámetro de entrenamiento).

export type LoadUnit = "kg" | "lb";

export const KG_PER_LB = 0.45359237;

let current: LoadUnit = "kg";

/** Lo fija AppProviders al arrancar desde settings.units. Cambiarlo recarga la app. */
export function setLoadUnit(u: LoadUnit | undefined): void {
  current = u === "lb" ? "lb" : "kg";
}

export function getLoadUnit(): LoadUnit {
  return current;
}

export function unitLabel(): string {
  return current;
}

/** kg → unidad de pantalla. */
export function toDisplay(kg: number, unit: LoadUnit = current): number {
  return unit === "lb" ? kg / KG_PER_LB : kg;
}

/** Unidad de pantalla → kg (lo que se guarda). */
export function fromDisplay(v: number, unit: LoadUnit = current): number {
  return unit === "lb" ? v * KG_PER_LB : v;
}

/** Formatea una carga guardada en kg en la unidad de pantalla, sin sufijo. */
export function fmtLoad(kg: number, unit: LoadUnit = current): string {
  if (unit === "kg") return Number.isInteger(kg) ? `${kg}` : kg.toFixed(kg * 2 === Math.round(kg * 2) ? 1 : 2);
  const lb = Math.round(toDisplay(kg, unit) * 10) / 10;
  return Number.isInteger(lb) ? `${lb}` : lb.toFixed(1);
}

/** Paso razonable en la unidad de pantalla para un paso pensado en kg (2.5 kg ≈ 5 lb). */
export function displayStep(stepKg: number, unit: LoadUnit = current): number {
  if (unit === "kg") return stepKg;
  const lb = toDisplay(stepKg, unit);
  return lb >= 4 ? 5 : lb >= 1.5 ? 2.5 : 1;
}

/**
 * Lista de pesos tipeada en la unidad de pantalla → kg. Un valor que se ve
 * igual que uno ya guardado conserva el kg exacto: re-convertir lo redondeado
 * corrompería el inventario al mostrarlo en lb (auditoría M1). Ordenada.
 */
export function parseLoadList(raw: string, originalKg: number[], unit: LoadUnit = current): number[] {
  const byText = new Map(originalKg.map((k) => [fmtLoad(k, unit), k]));
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => byText.get(x) ?? fromDisplay(parseFloat(x), unit))
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
}
