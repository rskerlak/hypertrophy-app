// Recomendación de agenda ante sesión perdida. La progresión es POR SESIÓN,
// no por fecha: perder un día no rompe nada; la sesión N sigue siendo N.
// Esta función solo recomienda cómo reacomodar la agenda; nunca altera cargas.

export interface CalendarShiftInput {
  daysMissed: number;
}

export interface CalendarShiftRecommendation {
  action: "shift" | "skip";
  rationale: string;
}

// Umbral de agenda (no científico): si el retraso ya alcanza una semana,
// correr todo pisaría la semana siguiente; saltar preserva mejor la
// frecuencia semanal objetivo de cada músculo.
const SKIP_THRESHOLD_DAYS = 6;

export function recommendCalendarShift(
  input: CalendarShiftInput,
): CalendarShiftRecommendation {
  if (input.daysMissed >= SKIP_THRESHOLD_DAYS) {
    return {
      action: "skip",
      rationale:
        "Pasó casi una semana: saltar esta sesión mantiene mejor la frecuencia semanal por músculo. La progresión no se pierde: avanza por sesión completada, no por fecha.",
    };
  }
  return {
    action: "shift",
    rationale:
      "Correr la agenda unos días no pierde estímulo: la progresión avanza por sesión completada, no por fecha. La sesión pendiente sigue siendo la misma.",
  };
}
