// Cuándo ofrecer/aplicar una versión nueva de la app (A4.3). Puro y testeable.
// Regla: nunca cambiar de versión a mitad de una sesión empezada sin que el
// usuario lo pida explícitamente: el JS nuevo podría no entender un borrador
// a medio escribir y recargar corta el timer de descanso.

export interface UpdateGateInput {
  /** Hay un service worker nuevo instalado esperando. */
  waiting: boolean;
  /** Hay una sesión empezada (startedAt) y sin finalizar. */
  sessionInProgress: boolean;
  /** El usuario eligió "actualizar al terminar". */
  deferred: boolean;
}

/** Mostrar el aviso de versión nueva. Si se pospuso, reaparece al terminar la sesión. */
export function shouldShowUpdatePrompt(i: UpdateGateInput): boolean {
  if (!i.waiting) return false;
  return !(i.deferred && i.sessionInProgress);
}

/** Al tocar el aviso: aplicar directo, o preguntar antes si hay sesión en curso. */
export function updateActionOnTap(i: UpdateGateInput): "apply" | "ask" {
  return i.sessionInProgress ? "ask" : "apply";
}
