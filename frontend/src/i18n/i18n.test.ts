import { describe, expect, it } from "vitest";
import { LANGUAGES, resources } from "./index";

/* Переводы проверяются на полноту: в каждом языке те же ключи, что в русском, и у каждой
 * множественной формы есть все варианты, которые требует язык (у русского и чешского их три-четыре,
 * у английского два). Иначе забытая строка всплывёт уже у игрока — пустым местом или ключом. */

const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nested]) => flatten(nested, prefix ? `${prefix}.${key}` : key));
}

const namespaces = Object.keys(resources.ru) as (keyof typeof resources.ru)[];

describe("переводы", () => {
  for (const namespace of namespaces) {
    const base = new Set(flatten(resources.ru[namespace]).map(key => key.replace(PLURAL, "")));

    for (const { id } of LANGUAGES) {
      it(`${id}/${namespace}: те же ключи, что в ru`, () => {
        const keys = flatten(resources[id][namespace]);
        const mine = new Set(keys.map(key => key.replace(PLURAL, "")));
        expect([...base].filter(key => !mine.has(key)), "не переведено").toEqual([]);
        expect([...mine].filter(key => !base.has(key)), "лишние ключи").toEqual([]);
      });

      it(`${id}/${namespace}: все формы множественного числа`, () => {
        const keys = flatten(resources[id][namespace]);
        const needed = new Intl.PluralRules(id).resolvedOptions().pluralCategories;
        const plurals = new Set(keys.filter(key => PLURAL.test(key)).map(key => key.replace(PLURAL, "")));
        for (const key of plurals) {
          const missing = needed.filter(category => !keys.includes(`${key}_${category}`));
          expect(missing, key).toEqual([]);
        }
      });

      // Пустой бывает только единица измерения («Четыре действия за ход» — без единицы).
      it(`${id}/${namespace}: нет пустых строк`, () => {
        const walk = (value: unknown, path: string): string[] =>
          typeof value === "string"
            ? value.trim() || path.endsWith(".unit") ? [] : [path]
            : Object.entries(value as object).flatMap(([key, nested]) => walk(nested, `${path}.${key}`));
        expect(walk(resources[id][namespace], namespace)).toEqual([]);
      });
    }
  }
});
