import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameState, PlayerState } from "../../online/types";
import { BoardView } from "./Board";
import { MarketCardDetails } from "../market/MarketCardDetails";
import { marketCardState } from "../market/marketCardState";
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

  it("проект, доступный только по Хартии, не горит как «можно взять» и помечен 📜", () => {
    // Раньше поиск по project_id находил вариант use_waiver, и обычное «Взять» молча
    // тратило Хартию — право на один проект за всю партию.
    const legal = [
      { type: "city_project", payload: { project_id: "metro", use_waiver: true } },
      { type: "end_turn", payload: {} },
    ];
    const html = render("Богатый ход", { legal });
    expect(html).toContain("📜");
    expect(html).not.toMatch(/data-ui="project-card"[^>]*data-state="ready"/);
  });

  it("заряженная Хартия видна на карте объекта, потраченная — нет", () => {
    const charged = render("Хартия заряжена");
    expect(charged).toContain('data-ui="charter-charge"');
    expect(charged).toContain('data-ui="project-charter-badge"');
    const room = scenarios["Хартия заряжена"];
    const game = room.game as GameState;
    const spent = {
      ...game,
      players: game.players.map(player => (player.id === ME ? { ...player, project_waiver_ready: false } : player)),
    };
    const me = spent.players.find(player => player.id === ME) as PlayerState;
    const html = text(renderToString(
      <BoardView game={spent} meta={meta} context={{ game: spent, me, legal: [] }} onAction={() => {}}
        busy={false} error="" onExit={() => {}} />,
    ));
    expect(html).not.toContain('data-ui="charter-charge"');
  });

  it("печатает лимит скандалов из движка, а не «/5» для всех", () => {
    // Журналисту движок даёт шесть — зашивать это число в клиент нельзя.
    const html = render("Богатый ход");
    expect(html).toContain("/6");
  });

  it("показывает закрытые слоты города с ценой расширения", () => {
    const html = render("Слоты заняты");
    expect(html).toContain("Открыть");
    expect(html).toContain("stat-money.webp");
  });

  it("причина «нельзя купить» — в окне подробностей, а не на лице карточки рынка", () => {
    expect(render("Слоты заняты")).not.toContain("Нет свободного слота");

    const room = scenarios["Слоты заняты"];
    const game = room.game as GameState;
    const me = game.players.find(player => player.id === ME) as PlayerState;
    const assets = new Map(meta.assets.map(asset => [asset.id, asset]));
    const item = game.market[0];
    const asset = assets.get(item.card_id)!;
    const state = marketCardState({ item, asset, game, me, legal: room.legal_actions ?? [] });
    const details = text(
      renderToString(
        <MarketCardDetails
          item={item}
          asset={asset}
          district={meta.districts.find(district => district.id === asset.district)}
          me={me}
          meta={meta}
          assets={assets}
          state={state}
          onBuy={() => {}}
          onMark={() => {}}
        />,
      ),
    );
    expect(details).toContain("Нет свободного слота");
    expect(details).toContain("Стоимость продажи");
    expect(details).toContain("project-icon-points.webp");
    expect(details).toContain("Условия района");
    expect(details).not.toContain("На столько вырастет весь ваш доход");
    expect(details).not.toContain("Цена для вас");
    expect(details).not.toContain("В счёт");
  });

  it("на чужом ходу подсвечивает ровно одну карточку вместо отдельной строки статуса", () => {
    const html = render("Ход соперника");
    expect(html).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(html.match(/data-player-state="turn"/g)).toHaveLength(1);
    expect(html.match(/player-card-turn-pill/g)).toHaveLength(1);
  });

  it("не занимает место строкой «Ваш ход»", () => {
    expect(render("Богатый ход")).not.toContain("Ваш ход");
  });

  it("на карточках рынка ставит заметную плашку уходящего слота", () => {
    const html = render("Богатый ход");

    expect(html).toContain("data-ui=\"market-stamp-leaving\"");
    expect(html).toContain("title=\"Слот уходит в конце раунда\"");
    expect(html).not.toContain("район 0/4");
  });

  it("показывает метку Капиталиста на лице карточки рынка", () => {
    const room = scenarios["Богатый ход"];
    const game = room.game as GameState;
    const rival = game.players.find(player => player.id !== ME) as PlayerState;
    const market = game.market.map((item, position) => (position === 0 ? { ...item, claimed_by: rival.id } : item));
    const me = game.players.find(player => player.id === ME) as PlayerState;
    const html = renderToString(
      <BoardView
        game={{ ...game, market }}
        meta={meta}
        context={{ game: { ...game, market }, me, legal: [] }}
        onAction={() => {}}
        busy={false}
        error=""
        onExit={() => {}}
      />,
    );
    expect(html).toContain("data-ui=\"market-stamp-claim\"");
    expect(html).toContain(rival.name);
  });

  it("объясняет чужие метку и серую блокировку в окне карточки рынка", () => {
    const room = scenarios["Богатый ход"];
    const game = room.game as GameState;
    const me = game.players.find(player => player.id === ME) as PlayerState;
    const rival = game.players.find(player => player.id !== ME) as PlayerState;
    const assets = new Map(meta.assets.map(asset => [asset.id, asset]));
    const item = { ...game.market[0], claimed_by: rival.id, locked_by: rival.id, locked_round: 7 };
    const asset = assets.get(item.card_id)!;
    const details = text(
      renderToString(
        <MarketCardDetails
          item={item}
          asset={asset}
          district={meta.districts.find(district => district.id === asset.district)}
          me={me}
          meta={meta}
          assets={assets}
          state={marketCardState({ item, asset, game, me, legal: [] })}
          onBuy={() => {}}
          onMark={() => {}}
          playerName={id => game.players.find(player => player.id === id)?.name ?? id}
        />,
      ),
    );
    expect(details).toContain('data-ui="market-claim-info"');
    expect(details).toContain('data-ui="market-lock-info"');
    expect(details).toContain(`${rival.name} поставил метку`);
    expect(details).toContain("до конца раунда 7");
  });

  it("на кнопке чистки Мафиози — цена и два скандала, а не «−1»", () => {
    const room = scenarios["Богатый ход"];
    const game = room.game as GameState;
    const players = game.players.map(player => (player.id === ME ? { ...player, role: "mafia", scandals: 3 } : player));
    const me = players.find(player => player.id === ME) as PlayerState;
    const html = render("Богатый ход", {
      game: { ...game, players },
      me,
      legal: [{ type: "use_role_power", payload: { power: "mafia_cleanup" } }],
    });
    expect(html).toContain("🧯 Замять дело");
    // Цена 3$ и результат −2⚠; символы $ и ⚠ рисуются иконками.
    expect(html).toMatch(/<span>3<img[^>]*stat-money[^>]*><\/span><\/b> → <span>−2<img[^>]*stat-scandal/);
    expect(html).not.toContain("−1 ⚠ скандал");
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

  it("вертикально: карточка краткая, а сетка та же", () => {
    const portrait = render("Богатый ход", {}, "portrait");
    const wide = render("Богатый ход", {}, "wide");

    // Шесть слотов рынка и шесть слотов города видны сразу в обеих раскладках.
    expect(portrait).toContain("grid-cols-3");
    // Проекты вчетвером в ряд помещаются только на широком столе.
    expect(portrait).toContain("grid-cols-2");
    expect(wide).toContain("grid-cols-4");
    // Редкость словом, теги и таблица свойств — только на широкой карточке; вертикально
    // они уезжают в поповер, иначе шесть карточек в высоту экрана не встают.
    expect(wide).toContain("Обычный");
    expect(portrait).not.toContain("Обычный");
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
