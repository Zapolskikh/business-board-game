import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameState, PlayerState } from "../../online/types";
import { BoardView } from "./Board";
import type { ActionContext } from "../lib/actions";
import { ME, meta, scenarios, type ScenarioName } from "../dev/fixtures";
import type { BoardLayout } from "../lib/layout";

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

function render(name: ScenarioName, overrides: Partial<ActionContext> = {}, layout?: BoardLayout) {
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
        layout={layout}
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

  /* Вертикальная раскладка — вторая полноценная доска, а не «то же самое поуже»: три колонки
   * превращаются в одну и две шторки. Проверяем то, что отличает её от широкой, и то, ради
   * чего она вообще нужна: центр на экране, бока по кнопке, карточки в два столбца. */
  it.each(names)("рендерится вертикально: %s", name => {
    expect(() => render(name, {}, "portrait")).not.toThrow();
  });

  it("вертикально: центр на месте, бока за язычками", () => {
    const html = render("Богатый ход", {}, "portrait");

    expect(html).toContain("Рынок");
    expect(html).toContain("Мой город");
    expect(html).toContain("aria-label=\"Игроки и хроника\"");
    expect(html).toContain("aria-label=\"Действия и рука\"");
    // Трёхколоночная сетка стола не должна остаться ни в каком виде.
    expect(html).not.toContain("238px");
    // Шторки закрыты, поэтому панели игроков и действий в разметке ещё нет.
    expect(html).not.toContain("Способности ·");
  });

  it("вертикально: карточки идут в два столбца, а не в три", () => {
    const portrait = render("Богатый ход", {}, "portrait");
    const wide = render("Богатый ход", {}, "wide");

    expect(portrait).toContain("grid-cols-2");
    expect(portrait).not.toContain("grid-cols-3");
    expect(wide).toContain("grid-cols-3");
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
