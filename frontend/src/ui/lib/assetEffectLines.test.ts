import { describe, expect, it } from "vitest";
import { assetEffectLines, districtCount } from "../../online/gameUi";
import { meta } from "../dev/fixtures";
import { ASSET_FACE_EFFECT_CAP, assetFaceEffectSummary } from "../primitives/AssetFace";
import type { AssetMeta, PlayerState } from "../../online/types";

/* Таблица свойств на карточке объекта — четыре строки в два столбца, ячейка не переносится и
 * режется многоточием. Поэтому у каждой строки две формы: `text` для поповера и `short` для
 * ячейки. Тест держит вторую в размере и заодно проверяет правила, по которым строка считается
 * активной: и роль профильного района, и связь с районом здесь уже разъезжались с движком.
 */

/** Половина карточки при базовой ширине доски — примерно 29 знаков шрифтом 9px. */
const CELL_LIMIT = 26;

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "p-me",
    name: "Я",
    is_bot: false,
    difficulty: "medium",
    money: 0,
    influence: 0,
    scandals: 0,
    roofs: 0,
    roof_limit: 1,
    scandal_limit: 5,
    role: null,
    jail_turns: 0,
    assets: [],
    hand: [],
    projects: [],
    bonus_points: 0,
    capacity: 6,
    debt: 0,
    zoning_district: null,
    turns: 1,
    ...overrides,
  } as PlayerState;
}

function asset(overrides: Partial<AssetMeta>): AssetMeta {
  return {
    id: "test",
    title: "Тестовый объект",
    district: "shadows",
    rarity: "epic",
    cost: 10,
    income: 3,
    influence: 0,
    text: "",
    tags: [],
    ...overrides,
  };
}

const catalog = new Map(meta.assets.map(item => [item.id, item]));

describe("assetEffectLines", () => {
  it("ярлык короче фразы и помещается в ячейку", () => {
    const card = asset({
      effects: {
        roleBonus: { role: "mafia", value: 2 },
        districtBonus: { district: "government", value: 2 },
        districtLinks: [{ district: "tech", value: 1 }],
        synergyInfluence: 1,
        marketRefresh: 1,
        purchase: { card: true },
      },
    });

    const lines = assetEffectLines(card, player(), meta, catalog, { includeSynergy: true });

    expect(lines.map(line => line.short)).toContain("Мафиози +2$");
    expect(lines.map(line => line.short)).toContain("Администрация +2$");
    expect(lines.map(line => line.short)).toContain("Пересдача рынка");
    for (const line of lines) {
      expect(line.short.length, `ярлык «${line.short}»`).toBeLessThanOrEqual(CELL_LIMIT);
    }
  });

  it("профильный район роли — тот же, что в движке: у Политика Администрация, не жильё", () => {
    const shorts = (district: string): string[] =>
      assetEffectLines(asset({ district }), player(), meta, catalog, { includeSynergy: true })
        .map(line => line.short);

    expect(shorts("government")).toContain("Политик: район +1$");
    expect(shorts("residential")).not.toContain("Политик: район +1$");
    expect(shorts("shadows")).toContain("Мафиози: район +1$");
  });

  it("роль больше не заменяет объект: связь с районом — это район, который у вас есть", () => {
    const card = asset({ district: "tech", effects: { districtBonus: { district: "business", value: 2 } } });
    const capitalist = player({ role: "capitalist" });

    const [line] = assetEffectLines(card, capitalist, meta, catalog).filter(item =>
      item.short.startsWith("Деловой"),
    );

    // Виртуальная связь Капиталиста с Деловым центром удалена в 1.12.0 вместе с чартером.
    expect(line.active).toBe(false);
  });

  it("глубина района считается так же, как в движке: с меткой и с удвоением", () => {
    const housing = meta.assets.find(item => item.district === "residential") as AssetMeta;
    const doubler = { ...housing, id: "agglo", effects: { districtDouble: "residential" } };
    const index = new Map(catalog).set(doubler.id, doubler);
    const owner = player({
      assets: [
        { uid: "a", card_id: housing.id },
        { uid: "b", card_id: doubler.id },
      ],
      marked_card_id: housing.id,
    });

    // Два построенных объекта, каждый считается за два, плюс помеченная карта рынка.
    expect(districtCount(owner, "residential", index)).toBe(5);
  });

  it("самые насыщенные карты никогда не переполняют четыре ячейки лица", () => {
    const fullCity = player({
      role: "politician",
      assets: meta.assets.map((item, index) => ({ uid: `owned-${index}`, card_id: item.id })),
    });
    // Стресс-профиль повторяет самые тяжёлые карты каталога: четыре межрайонные связи,
    // награда за полный район, постоянный перк и разовый эффект покупки.
    const crowded = asset({
      title: "Центр с максимальным числом свойств",
      district: "government",
      effects: {
        districtLinks: [
          { district: "residential", value: 1 },
          { district: "business", value: 1 },
          { district: "industrial", value: 1 },
          { district: "tech", value: 1 },
        ],
        synergyInfluence: 2,
        marketRefresh: 1,
        purchase: { card: true, scandals: 1 },
      },
    });
    const all = [...meta.assets, crowded].map(card => ({
      card,
      lines: assetEffectLines(card, fullCity, meta, catalog, { includeSynergy: true }),
    }));
    const largest = all.reduce((left, right) => right.lines.length > left.lines.length ? right : left);

    // Проверяем путь через настоящий построитель строк, а не готовый игрушечный массив.
    expect(largest.lines.length).toBeGreaterThan(ASSET_FACE_EFFECT_CAP);
    for (const { card, lines } of all) {
      const summary = assetFaceEffectSummary(lines);
      const occupiedCells = summary.visible.length + (summary.hidden > 0 ? 1 : 0);
      const uniqueCount = lines.filter(line => line.kind !== "district" && line.kind !== "sector").length;
      expect(occupiedCells, card.title).toBeLessThanOrEqual(ASSET_FACE_EFFECT_CAP);
      expect(summary.hidden, card.title).toBe(uniqueCount - summary.visible.length);
      expect(summary.standard, card.title).toBe(lines.length - uniqueCount);
      expect(summary.visible.every(line => line.kind !== "district" && line.kind !== "sector"), card.title)
        .toBe(true);
    }
  });

  it("повторяющиеся правила района отделены от уникальных свойств объекта", () => {
    const card = asset({
      district: "government",
      effects: { marketRefresh: 1, roleBonus: { role: "politician", value: 2 } },
    });
    const lines = assetEffectLines(card, player({ role: "politician" }), meta, catalog, {
      includeSynergy: true,
    });
    const summary = assetFaceEffectSummary(lines);

    expect(lines.some(line => line.kind === "sector")).toBe(true);
    expect(summary.visible.map(line => line.short)).toContain("Пересдача рынка");
    expect(summary.visible.some(line => line.kind === "sector")).toBe(false);
    expect(summary.standard).toBeGreaterThan(0);
  });
});
