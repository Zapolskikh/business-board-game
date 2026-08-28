import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameState, PlayerState } from "../../online/types";
import { BoardView } from "./Board";
import type { ActionContext } from "../lib/actions";
import { ME, meta, scenarios, type ScenarioName } from "../dev/fixtures";

/* Дымовой тест раскладки: каждая позиция из фикстур должна отрендериться без исключения.
 *
 * Он не проверяет, как доска выглядит, — он ловит то, из-за чего экран падает в белый:
 * обращение к отсутствующему объекту каталога, пустую руку, ноль игроков, законченную партию.
 * Достать эти состояния в живой партии дорого, поэтому дешёвая проверка стоит своего места.
 */

const names = Object.keys(scenarios) as ScenarioName[];

// SSR разделяет соседние текстовые узлы комментариями `<!-- -->`, из-за чего «6$» лежит
// в разметке как «6<!-- -->$». Для проверок по тексту их надо убрать.
// (split/join, а не replaceAll: проект таргетит ES2020)
const text = (html: string) => html.split("<!-- -->").join("");

function render(name: ScenarioName, overrides: Partial<ActionContext> = {}) {
  const room = scenarios[name];
  const game = room.game as GameState;
  const me = game.players.find(player => player.id === ME) as PlayerState;
  const context: ActionContext = { game, me, legal: room.legal_actions ?? [], ...overrides };
  return text(
    renderToString(
      <BoardView
        game={game}
        meta={meta}
        roomName="тест"
        context={context}
        onAction={() => {}}
        busy={false}
        error=""
        onExit={() => {}}
      />,
    ),
  );
}

describe("BoardView", () => {
  it.each(names)("рендерится: %s", name => {
    expect(() => render(name)).not.toThrow();
  });

  it("печатает лимит скандалов из движка, а не «/5» для всех", () => {
    // Журналисту движок даёт шесть. Раньше это число было зашито в клиенте.
    const html = render("Богатый ход");
    expect(html).toContain("/6");
  });

  it("показывает закрытые слоты города с ценой расширения", () => {
    const html = render("Слоты заняты");
    expect(html).toContain("Открыть");
    expect(html).toContain("6$");
  });

  it("объясняет отсутствие слота на карточке рынка", () => {
    expect(render("Слоты заняты")).toContain("Нет свободного слота");
  });

  it("на чужом ходу показывает, кого ждём", () => {
    expect(render("Ход соперника")).toContain("Ход игрока");
  });

  it("переживает игрока без роли, без карт и без объектов", () => {
    const room = scenarios["Богатый ход"];
    const game = room.game as GameState;
    const bare: PlayerState = {
      ...(game.players.find(player => player.id === ME) as PlayerState),
      role: null,
      hand: [],
      assets: [],
      projects: [],
    };
    const context: ActionContext = { game, me: bare, legal: [] };
    expect(() =>
      renderToString(
        <BoardView
          game={{ ...game, players: game.players.map(player => (player.id === ME ? bare : player)) }}
          meta={meta}
          roomName="тест"
          context={context}
          onAction={() => {}}
          busy={false}
          error=""
          onExit={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it("переживает объект, которого нет в каталоге", () => {
    const room = scenarios["Богатый ход"];
    const game = room.game as GameState;
    const me = game.players.find(player => player.id === ME) as PlayerState;
    const broken: PlayerState = { ...me, assets: [{ uid: "x", card_id: "нет-такого" }] };
    const context: ActionContext = { game, me: broken, legal: [] };
    expect(() =>
      renderToString(
        <BoardView
          game={{ ...game, players: game.players.map(player => (player.id === ME ? broken : player)) }}
          meta={meta}
          roomName="тест"
          context={context}
          onAction={() => {}}
          busy={false}
          error=""
          onExit={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});
