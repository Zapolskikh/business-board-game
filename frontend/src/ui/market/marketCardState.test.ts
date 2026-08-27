import { describe, expect, it } from "vitest";
import { marketCardState } from "./marketCardState";
import { ME, assetIndex, makeGame, scenarios } from "../dev/fixtures";
import type { GameState, LegalAction, MarketAsset, PlayerState } from "../../online/types";

const buy = (uid: string): LegalAction => ({ type: "buy_asset", payload: { market_uid: uid } });

function setup(room = scenarios["Слоты заняты"]) {
  const game = room.game as GameState;
  const me = game.players.find(player => player.id === ME) as PlayerState;
  const item = game.market[0] as MarketAsset;
  const asset = assetIndex.get(item.card_id)!;
  return { game, me, item, asset, legal: room.legal_actions ?? [] };
}

describe("marketCardState", () => {
  it("разрешает покупку только по действию от движка", () => {
    const { game, me, item, asset } = setup();
    expect(marketCardState({ item, asset, game, me, legal: [buy(item.uid)] })).toMatchObject({
      kind: "buyable",
    });
  });

  it("не разрешает покупку, если движок её не предложил, даже когда ресурсов хватает", () => {
    const { item, asset } = setup();
    const game = makeGame();
    const me = { ...game.players.find(player => player.id === ME)!, money: 999, capacity: 6 };
    // Ресурсов с запасом, но legal_actions пуст — клиент обязан остаться заблокированным.
    expect(marketCardState({ item, asset, game, me, legal: [] }).kind).not.toBe("buyable");
  });

  it("показывает покупку в полёте до ответа сервера", () => {
    const { game, me, item, asset } = setup();
    const state = marketCardState({ item, asset, game, me, legal: [buy(item.uid)], pending: buy(item.uid) });
    expect(state.kind).toBe("buying");
  });

  it("не путает карточки: pending на соседний uid эту не трогает", () => {
    const { game, me, item, asset } = setup();
    const state = marketCardState({ item, asset, game, me, legal: [buy(item.uid)], pending: buy("m-6") });
    expect(state.kind).toBe("buyable");
  });

  it("на чужом ходу объясняет очередь, а не деньги", () => {
    const room = scenarios["Ход соперника"];
    const { game, me, item, asset, legal } = setup(room);
    expect(marketCardState({ item, asset, game, me, legal }).kind).toBe("not-your-turn");
  });

  it("отличает исчерпанные действия от нехватки ресурсов", () => {
    const room = scenarios["Действия кончились"];
    const { game, me, item, asset, legal } = setup(room);
    expect(marketCardState({ item, asset, game, me, legal }).kind).toBe("no-actions");
  });

  it("сообщает про слот, когда город полон", () => {
    const { game, me, item, asset, legal } = setup();
    expect(me.assets.length).toBe(me.capacity);
    expect(marketCardState({ item, asset, game, me, legal }).kind).toBe("no-slot");
  });

  it("считает нехватку денег, когда слот есть", () => {
    const game = makeGame();
    const me = { ...game.players.find(player => player.id === ME)!, capacity: 6, money: 3 };
    const item = game.market.find(entry => entry.uid === "m-4")!;
    const asset = assetIndex.get(item.card_id)!;
    const state = marketCardState({ item, asset, game, me, legal: [] });
    expect(state).toMatchObject({ kind: "no-money", price: 16, missing: 13 });
  });

  it("берёт персональную цену из market, а не базовую из каталога", () => {
    // Движок считает скидки на игрока и присылает их в MarketAsset.price. Если клиент
    // once возьмёт asset.cost, скидки ролей и объектов перестанут быть видны на доске.
    const game = makeGame();
    const me = { ...game.players.find(player => player.id === ME)!, capacity: 6, money: 100 };
    const asset = assetIndex.get("datacenter")!;
    const discounted: MarketAsset = { uid: "m-x", card_id: "datacenter", price: 9 };
    expect(asset.cost).toBe(12);
    expect(marketCardState({ item: discounted, asset, game, me, legal: [] }).price).toBe(9);
  });
});
