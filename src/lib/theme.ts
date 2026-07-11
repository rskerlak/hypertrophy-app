// Tema claro/oscuro. La fuente de verdad es settings.theme (Dexie); localStorage
// es solo un caché de pre-pintado para evitar el flash de tema equivocado.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mn-theme";

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // almacenamiento bloqueado (incógnito estricto): el data-theme igual aplica
  }
}
