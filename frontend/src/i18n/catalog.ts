import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CityMeta } from "../online/types";
import { resources, type Language } from "./index";

/* Каталог на языке игрока.
 *
 * Сервер присылает каталог по-русски: для движка важны только id и числа. Названия и описания
 * берутся из locales/<язык>/catalog.json по id и подставляются в копию каталога. Поэтому
 * компонентам не нужно знать о переводе — они читают `meta.assets[i].title`, как и раньше.
 * Если строки нет (новая карта ещё не переведена), остаётся серверный текст, а не пустое место.
 */

type Section = "districts" | "roles" | "assets" | "action_cards" | "projects";
type Entry = Record<string, string | undefined>;

export function localizeMeta(meta: CityMeta, language: Language): CityMeta {
  const table = resources[language]?.catalog as unknown as Record<Section, Record<string, Entry>> | undefined;
  if (!table) return meta;
  const apply = <T extends { id: string }>(section: Section, items: T[], fields: (keyof T & string)[]): T[] =>
    items.map(item => {
      const entry = table[section]?.[item.id];
      if (!entry) return item;
      const next = { ...item };
      for (const field of fields) {
        const value = entry[field];
        if (value) (next as Record<string, unknown>)[field] = value;
      }
      return next;
    });
  return {
    ...meta,
    districts: apply("districts", meta.districts, ["title", "description"]),
    roles: apply("roles", meta.roles, ["title", "passive", "power"]),
    assets: apply("assets", meta.assets, ["title", "text"]),
    action_cards: apply("action_cards", meta.action_cards, ["title", "text"]),
    projects: apply("projects", meta.projects, ["title", "text"]),
  };
}

/** Каталог на текущем языке; пересчитывается при смене языка. */
export function useLocalizedMeta(meta: CityMeta): CityMeta;
export function useLocalizedMeta(meta: CityMeta | null): CityMeta | null;
export function useLocalizedMeta(meta: CityMeta | null): CityMeta | null {
  const { i18n } = useTranslation();
  const language = i18n.language as Language;
  return useMemo(() => (meta ? localizeMeta(meta, language) : null), [meta, language]);
}
