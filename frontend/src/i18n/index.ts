import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import enCommon from "./locales/en/common.json";
import enHome from "./locales/en/home.json";
import ruCommon from "./locales/ru/common.json";
import ruHome from "./locales/ru/home.json";
import csCommon from "./locales/cs/common.json";
import csHome from "./locales/cs/home.json";
import ruCatalog from "./locales/ru/catalog.json";
import enCatalog from "./locales/en/catalog.json";
import csCatalog from "./locales/cs/catalog.json";
import ruGame from "./locales/ru/game.json";
import enGame from "./locales/en/game.json";
import csGame from "./locales/cs/game.json";

/* Локализация.
 *
 * Тексты лежат в locales/<язык>/<раздел>.json. Русский — исходный язык: новый ключ сначала
 * появляется в ru, затем в en и cs (тест i18n.test.ts не даст забыть). Множественные формы —
 * суффиксы i18next (_one, _few, _many, _other); какие нужны, решает Intl.PluralRules языка,
 * поэтому у русского и чешского их больше, чем у английского.
 *
 * Словарь игровых терминов — в README рядом, его держим одинаковым во всех разделах.
 */

export const LANGUAGES = [
  { id: "ru", title: "Русский", short: "RU" },
  { id: "en", title: "English", short: "EN" },
  { id: "cs", title: "Čeština", short: "CS" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

export const DEFAULT_LANGUAGE: Language = "en";
const STORAGE_KEY = "city-lang";

export const resources = {
  ru: { common: ruCommon, home: ruHome, catalog: ruCatalog, game: ruGame },
  en: { common: enCommon, home: enHome, catalog: enCatalog, game: enGame },
  cs: { common: csCommon, home: csHome, catalog: csCatalog, game: csGame },
} as const;

const isLanguage = (value: string | null | undefined): value is Language =>
  LANGUAGES.some(language => language.id === value);

/** Сохранённый выбор, затем ?lang= из ссылки, затем язык браузера, иначе английский. */
export function detectLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (isLanguage(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Хранилище недоступно (приватный режим) — просто не помним выбор.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag?.slice(0, 2).toLowerCase();
    if (isLanguage(base)) return base;
    // Словацкий читается почти как чешский — лучше, чем английский по умолчанию.
    if (base === "sk") return "cs";
    // Украинский и белорусский: большинству удобнее русский интерфейс, чем английский.
    if (base === "uk" || base === "be") return "ru";
  }
  return DEFAULT_LANGUAGE;
}

void i18next.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: ["en", "ru"],
  ns: ["common", "home", "catalog", "game"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

function syncDocument(language: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  // Название во вкладке и в поиске — тоже на языке игрока.
  document.title = i18next.t("brand.title", { ns: "home", lng: language });
}
syncDocument(i18next.language as Language);

export function setLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // См. detectLanguage().
  }
  syncDocument(language);
  void i18next.changeLanguage(language);
}

/** Текущий язык и переключатель — для выпадающего списка языков. */
export function useLanguage(): [Language, (language: Language) => void] {
  const { i18n } = useTranslation();
  const current = (isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE) as Language;
  return [current, setLanguage];
}

export default i18next;

/** Перевод по ключу, собранному в коде (`power.${id}.label`). Для логики вне компонентов:
 * там нет хука, а ключи динамические, и строгая типизация i18next их не пропускает. */
export function tr(namespace: "common" | "home" | "game" | "catalog", key: string, options?: Record<string, unknown>): string {
  return (i18next.t as unknown as (key: string, options: Record<string, unknown>) => string)(key, { ns: namespace, ...options });
}
