import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, themes, themeStyle, type ThemeId } from "../themes";

/* Выбранная тема — личная настройка игрока, поэтому живёт в браузере, а не в партии.
 *
 * Внешнее хранилище, а не контекст: тему читают корни доски (BoardScaler, мобильная рамка,
 * шторки), а меняет переключатель в шапке — у них нет общего предка ниже самого экрана игры.
 */

const KEY = "city-theme";
const listeners = new Set<() => void>();

function read(): ThemeId {
  try {
    const stored = localStorage.getItem(KEY);
    if (themes.some(theme => theme.id === stored)) return stored as ThemeId;
  } catch {
    // Приватный режим или запрет хранилища: тема просто не запоминается.
  }
  return DEFAULT_THEME;
}

let current: ThemeId = typeof window === "undefined" ? DEFAULT_THEME : read();

export function setTheme(id: ThemeId): void {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // См. read().
  }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_THEME);
}

/** CSS-переменные выбранной темы — вешаются на корень доски рядом с классом `ui-v2`. */
export function useThemeStyle() {
  return themeStyle(useTheme());
}
