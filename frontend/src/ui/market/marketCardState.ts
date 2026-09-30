import { tr } from "../../i18n";
import { marketPrice, stringValue } from "../../online/gameUi";
import type { AssetMeta, GameState, LegalAction, MarketAsset, PlayerState } from "../../online/types";

/* Состояние карточки рынка.
 *
 * Правило, от которого нельзя отступать: покупку разрешает ТОЛЬКО `legal_actions` от движка.
 * Клиент не воспроизводит условия покупки — он спрашивает, есть ли действие в списке.
 *
 * Причина отказа считается здесь, но это не вычисление правила: сравниваются значения,
 * которые сервер уже прислал (персональная цена карты, ёмкость города, остаток действий).
 * Если движок завтра добавит ещё одно условие покупки, кнопка погаснет сама — поменяется
 * только текст подсказки, и это ровно та часть, которой можно ошибаться безопасно.
 */
export type MarketCardState =
  | { kind: "buyable"; action: LegalAction; price: number }
  | { kind: "buying"; price: number }
  | { kind: "not-your-turn"; price: number }
  | { kind: "no-actions"; price: number }
  | { kind: "no-slot"; price: number }
  | { kind: "no-money"; price: number; missing: number }
  | { kind: "unavailable"; price: number };

export interface MarketCardStateInput {
  item: MarketAsset;
  asset: AssetMeta;
  game: GameState;
  me: PlayerState;
  legal: LegalAction[];
  /** Действие, уже отправленное на сервер: карточка «покупается» до прихода ответа. */
  pending?: LegalAction;
}

export function marketCardState({
  item,
  asset,
  game,
  me,
  legal,
  pending,
}: MarketCardStateInput): MarketCardState {
  const price = marketPrice(asset, item);
  const targets = (action: LegalAction | undefined): boolean =>
    action?.type === "buy_asset" && stringValue(action.payload.market_uid) === item.uid;

  if (targets(pending)) return { kind: "buying", price };

  const action = legal.find(targets);
  if (action) return { kind: "buyable", action, price };

  // Дальше — только объяснение, почему действия нет. Порядок от непреодолимого к поправимому.
  if (game.players[game.current_player_index]?.id !== me.id) return { kind: "not-your-turn", price };
  if (game.actions_left <= 0) return { kind: "no-actions", price };
  if (me.assets.length >= me.capacity) return { kind: "no-slot", price };
  if (me.money < price) return { kind: "no-money", price, missing: price - me.money };
  return { kind: "unavailable", price };
}

export function marketCardReason(state: MarketCardState): string {
  switch (state.kind) {
    case "buyable":
      return tr("game", "ui.buy.buy", { price: state.price });
    case "buying":
      return tr("game", "ui.buy.buying");
    case "not-your-turn":
      return tr("game", "ui.buy.notYourTurn");
    case "no-actions":
      return tr("game", "ui.buy.noActions");
    case "no-slot":
      return tr("game", "ui.buy.noSlot");
    case "no-money":
      return tr("game", "ui.buy.noMoney", { missing: state.missing });
    case "unavailable":
      return tr("game", "ui.buy.unavailable");
  }
}


