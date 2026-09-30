import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES, resources } from "./index";
import { localizeMeta } from "./catalog";
import type { CityMeta } from "../online/types";

/* Каталог сервера — источник id. Каждая карта, роль, район и проект должны быть переведены на все
 * языки: иначе новая карта молча покажется по-русски чешскому игроку. */
const server = JSON.parse(
  readFileSync(resolve(__dirname, "../../../backend/city_engine/content/catalog.json"), "utf8"),
) as CityMeta;

const sections = {
  districts: ["title", "description"],
  roles: ["title", "passive", "power"],
  assets: ["title", "text"],
  action_cards: ["title", "text"],
  projects: ["title", "text"],
} as const;

describe("каталог", () => {
  for (const { id: language } of LANGUAGES) {
    it(`${language}: переведены все объекты каталога`, () => {
      const table = resources[language].catalog as unknown as Record<string, Record<string, Record<string, string>>>;
      const missing: string[] = [];
      for (const [section, fields] of Object.entries(sections)) {
        for (const item of server[section as keyof typeof sections] as { id: string }[]) {
          for (const field of fields) {
            if (!table[section]?.[item.id]?.[field]) missing.push(`${section}.${item.id}.${field}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it("подменяет тексты по id, не трогая числа и id", () => {
    const localized = localizeMeta(server, "en");
    const metro = localized.projects.find(project => project.id === "metro_line")!;
    const original = server.projects.find(project => project.id === "metro_line")!;
    expect(metro.title).toBe("Metro Line");
    expect(metro.points).toBe(original.points);
    expect(metro.cost_money).toBe(original.cost_money);
  });
});
