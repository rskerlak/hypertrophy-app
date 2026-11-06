// Utilidades de agenda (no científicas): solo deciden fechas para mostrar.
// La progresión del meso nunca depende de esto.

export const WEEKDAY_LETTERS = ["D", "L", "M", "X", "J", "V", "S"];

/** Fecha local de hoy (YYYY-MM-DD). La UI sí puede leer el reloj; el dominio no. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Fecha local (YYYY-MM-DD) de un instante ISO (UTC). La UI puede usar la zona del dispositivo; el dominio no. */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Días de entrenamiento por defecto según cuántos días tiene el split (0 = domingo). */
export function defaultWeekdays(daysPerWeek: number): number[] {
  if (daysPerWeek >= 6) return [1, 2, 3, 4, 5, 6];
  if (daysPerWeek === 5) return [1, 2, 3, 4, 5];
  if (daysPerWeek === 4) return [1, 2, 4, 5];
  if (daysPerWeek === 3) return [1, 3, 5];
  return [1, 4];
}
