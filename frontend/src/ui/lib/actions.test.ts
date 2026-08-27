import { describe, expect, it } from "vitest";
import { matches, resolve, resolveMany, turnBlock, usedThisTurn, type ActionContext } from "./actions";
import { ME, makeGame, scenarios } from "../dev/fixtures";
import type { GameState, LegalAction, PlayerState } from "../../online/types";

const act = (type: string, payload: Record<string, unknown> = {}): LegalAction => ({ type, payload });

function contextFor(name: keyof typeof scenarios): ActionContext {
  const room = scenarios[name];
  const game = room.game as GameState;
  return {
    game,
    me: game.players.find(player => player.id === ME) as PlayerState,
    legal: room.legal_actions ?? [],
  };
}

describe("matches", () => {
  it("сравнивает тип и частичный payload", () => {
    const action = act("use_role_power", { power: "journalist_inflate", target_id: "p-bot2" });
    expect(matches(action, "use_role_power")).toBe(true);
    expect(matches(action, "use_role_power", { power: "journalist_inflate" })).toBe(true);
    expect(matches(action, "use_role_power", { power: "mafia_racket" })).toBe(false);
    expect(matches(action, "grey_operation", { power: "journalist_inflate" })).toBe(false);
  });
});

describe("turnBlock", () => {
  it("на чужом ходу называет игрока", () => {
    expect(turnBlock(contextFor("Ход соперника"))).toBe("Ход игрока Bot 2");
  });

  it("отличает исчерпанные действия", () => {
    expect(turnBlock(contextFor("Действия кончились"))).toBe("Действия на этот ход закончились");
  });

  it("тюрьма важнее остатка действий", () => {
    const base = contextFor("Богатый ход");
    const context: ActionContext = { ...base, me: { ...base.me, jail_turns: 2 } };
    expect(turnBlock(context)).toBe("Тюрьма: ходов 2");
  });

  it("законченная партия блокирует всё", () => {
    expect(turnBlock(contextFor("Партия окончена"))).toBe("Партия окончена");
  });

  it("на своём ходу с действиями не блокирует ничего", () => {
    expect(turnBlock(contextFor("Богатый ход"))).toBeUndefined();
  });
});

describe("resolve", () => {
  it("готово, когда движок предложил действие", () => {
    const state = resolve(contextFor("Богатый ход"), "buy_roof");
    expect(state.kind).toBe("ready");
  });

  it("не готово, когда движок не предложил, даже при полном кошельке", () => {
    const base = contextFor("Богатый ход");
    // Ресурсов с запасом, но действие из legal_actions убрано — кнопка обязана погаснуть.
    const context: ActionContext = {
      ...base,
      legal: base.legal.filter(action => action.type !== "buy_roof"),
    };
    expect(resolve(context, "buy_roof").kind).toBe("blocked");
  });

  it("различает варианты одного типа по payload", () => {
    const context = contextFor("Богатый ход");
    expect(resolve(context, "basic_action", { kind: "lobbying" }).kind).toBe("ready");
    expect(resolve(context, "basic_action", { kind: "patronage" }).kind).toBe("blocked");
  });

  it("показывает отправленное действие как pending", () => {
    const base = contextFor("Богатый ход");
    const context: ActionContext = { ...base, pending: act("buy_roof") };
    expect(resolve(context, "buy_roof").kind).toBe("pending");
    // Соседняя кнопка при этом остаётся готовой, а не гаснет заодно.
    expect(resolve(context, "basic_action", { kind: "work" }).kind).toBe("ready");
  });

  it("подставляет свою подсказку вместо общей причины", () => {
    const context = contextFor("Слоты заняты");
    const state = resolve(context, "buy_capacity", undefined, "Нужно 6$");
    expect(state).toEqual({ kind: "blocked", reason: "Нужно 6$" });
  });

  it("без подсказки объясняет общей причиной хода", () => {
    const state = resolve(contextFor("Ход соперника"), "buy_roof");
    expect(state).toEqual({ kind: "blocked", reason: "Ход игрока Bot 2" });
  });
});

describe("resolveMany", () => {
  it("собирает по варианту на каждую разрешённую цель", () => {
    const context = contextFor("Богатый ход");
    const { options, blocked } = resolveMany(context, "use_role_power", {
      power: "journalist_inflate",
    });
    expect(blocked).toBeUndefined();
    expect(options).toHaveLength(context.game.players.length - 1);
    expect(options.every(option => option.payload.target_id !== ME)).toBe(true);
  });

  it("пустой список — это блокировка с причиной", () => {
    const { options, blocked } = resolveMany(contextFor("Ход соперника"), "use_role_power", {
      power: "mafia_racket",
    });
    expect(options).toHaveLength(0);
    expect(blocked).toBe("Ход игрока Bot 2");
  });
});

describe("usedThisTurn", () => {
  it("читает turn_flags движка, а не считает сам", () => {
    const game = makeGame();
    expect(usedThisTurn(game, "patronage")).toBe(true);
    expect(usedThisTurn(game, "lobbying")).toBe(false);
    expect(usedThisTurn(game, "card_played")).toBe(false);
  });
});
