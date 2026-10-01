import { describe, expect, it } from "vitest";
import { assetEffectLines, districtCount } from "../../online/gameUi";
import { meta } from "../dev/fixtures";
import { assetFaceSummary } from "../primitives/AssetFace";
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
    difficulty: "expert",
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

    // Виртуальной связи Капиталиста с Деловым центром нет: роль не заменяет объект.
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

  it("лицо карты: разовое — всё, что даёт покупка, особое — только безусловные свойства", () => {
    const card = asset({
      influence: 1,
      effects: {
        purchase: { influence: 2, money: 2, roofs: 1, card: true },
        roofCapacity: 1,
        turnRoof: 1,
        districtBonus: { district: "government", value: 2 },
      },
    });
    const lines = assetEffectLines(card, player(), meta, catalog, { includeSynergy: true });
    const summary = assetFaceSummary(card, lines);

    // Напечатанное влияние и влияние покупки движок начисляет одним моментом.
    expect(summary.oneTime).toEqual(["+3◆", "+2$", "+1 Защита", "+карта"]);
    expect(summary.oneTimeInfluence).toBe(3);
    expect(summary.unique).toEqual(["+1 Защита/ход", "лимит Защиты +1"]);
    // Условие «при наличии Администрации» не выполнено — оно и есть скрытое.
    expect(summary.hidden).toBe(1);
  });

  it("выполненное условие уже в числе дохода и в сноску не попадает", () => {
    const government = meta.assets.find(item => item.district === "government") as AssetMeta;
    const card = asset({ effects: { districtBonus: { district: "government", value: 2 } } });
    const owner = player({ assets: [{ uid: "g", card_id: government.id }] });
    const summary = assetFaceSummary(card, assetEffectLines(card, owner, meta, catalog, { includeSynergy: true }));
    expect(summary.hidden).toBe(0);
  });

  it("особый бонус любой карты каталога укладывается в одно поле", () => {
    for (const card of meta.assets) {
      const summary = assetFaceSummary(card, assetEffectLines(card, player(), meta, catalog, { includeSynergy: true }));
      // Две строки поля при базовой ширине доски.
      expect(summary.unique.join(" · ").length, card.title).toBeLessThanOrEqual(2 * CELL_LIMIT);
    }
  });
});
