import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { rankPlayers, scoreOf } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { ActionsPanel } from "../actions/ActionsPanel";
import { CityPanel } from "../city/CityPanel";
import { Hand } from "../hand/Hand";
import { MarketGrid } from "../market/Market";
import { PlayersRail } from "../players/PlayersRail";
import { Projects } from "../projects/Projects";
import { Modal, DetailsModal } from "../primitives/Modal";
import type { ActionContext } from "../lib/actions";
import { indexMaps } from "../lib/board";
import { useCommand, useGame, useLegalActions, useMe, useMeta, useRoom } from "../lib/session";
import { Chronicle } from "./Chronicle";
import { RulesBook } from "./RulesBook";
import { ChronicleRail } from "./ChronicleRail";
import { useTurnBriefing } from "./briefing";
import { TurnBriefingModal } from "./TurnBriefing";
import { GreyResult } from "./GreyResult";
import { BoardScaler } from "./BoardScaler";
import { MobileShell, MobileTable, RotateNotice } from "./MobileBoard";
import { Header, StatusBar } from "./Header";
import { ScoreDetails } from "./headerPopovers";
import { BoardLayoutProvider, useDeviceLayout, useMobileViewport, type BoardLayout } from "../lib/layout";

/* Сборка доски.
 *
 * Сетка: 238 / 1fr / 274. Рынок — единственная строка с `minmax(280px, 1fr)`, поэтому на
 * высоких экранах он растягивается, а ниже ~820px центральная колонка начинает скроллиться,
 * вместо того чтобы сжимать текст до нечитаемого. Шапка, игроки и действия не двигаются.
 */
export function BoardView({
  game,
  meta,
  context,
  onAction,
  busy,
  error,
  onExit,
  layout,
  liveSession = false,
}: {
  game: GameState;
  meta: CityMeta;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
  busy: boolean;
  error: string;
  onExit: () => void;
  /** Раскладка принудительно — для галереи и тестов. Без неё решает экран устройства. */
  layout?: BoardLayout;
  /** Подключённая партия разрешает сетевой экспорт хроники; /dev работает без сессии. */
  liveSession?: boolean;
}) {
  // Хук перевода на корне доски: смена языка перерисовывает всё дерево, и подписи из
  // gameUi (они берут язык в момент вызова) обновляются вместе с компонентами.
  const { t } = useTranslation("game");
  const index = useMemo(() => indexMaps(meta), [meta]);
  const [chronicle, setChronicle] = useState(false);
  const [score, setScore] = useState(false);
  const [rules, setRules] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  const [finishOpen, setFinishOpen] = useState(true);

  const logCount = game.event_log.length;
  useEffect(() => {
    setSeen(current => (current === null || chronicle ? logCount : current));
  }, [chronicle, logCount]);
  const unseen = seen === null ? 0 : Math.max(0, logCount - seen);

  /* Сводка своего хода: собирается из снимка на конец прошлого хода и всплывает сама,
   * когда ход возвращается. Хроника на это не годится — в ней всё подряд и без дельт. */
  const { briefing, close: closeBriefing } = useTurnBriefing(game, context.me, meta);

  const ranking = useMemo(
    () => rankPlayers(game),
    [game],
  );

  /* Раскладка одна на всё дерево: её спрашивают карточки, проекты и поповеры. Экран меряем
   * здесь, а не в каждом из них. Телефон в альбоме получает мобильный стол в логическом размере
   * (см. useMobileViewport), телефон вертикально — просьбу повернуть его. */
  const device = useDeviceLayout();
  const mobile = layout ? layout === "mobile" : device.mobile;
  const rotate = !layout && device.mobile && device.portrait;
  useMobileViewport(!layout && device.mobile && !device.portrait);

  /* Панели собираются одинаково для обеих раскладок и различаются только тем, куда их ставят.
   * Иначе это были бы две копии доски, расходящиеся при первой же правке. */
  const rail = <PlayersRail game={game} meta={meta} index={index} context={context} onAction={onAction} />;
  const players = (
    <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-1.5">
      {rail}
      <ChronicleRail game={game} meta={meta} unseen={unseen} onOpen={() => setChronicle(true)} />
    </div>
  );

  /* Рынок и город делят остаток экрана поровну — у обоих по два ряда карточек, и так
    * один и тот же объект до и после покупки остаётся одного размера. Доли равные
    * и постоянные: содержимое панелей на высоту не влияет, поэтому покупка ничего
    * не перекраивает.
    *
    * Вертикально — то же самое, и это осознанно: прокрутка центра означала бы, что рынок и
    * свой город нельзя увидеть одновременно, а решение всегда принимается по ним обоим.
    * Помещается всё за счёт краткой карточки, а не за счёт лишней высоты. */
  const projectsPanel = <Projects game={game} meta={meta} index={index} context={context} onAction={onAction} />;
  const marketPanel = (
    <MarketGrid
      game={game}
      me={context.me}
      meta={meta}
      legal={context.legal}
      pending={context.pending}
      onBuy={onAction}
    />
  );
  const cityPanel = <CityPanel meta={meta} index={index} context={context} onAction={onAction} />;
  const city = (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
      {projectsPanel}
      {marketPanel}
      {cityPanel}
    </div>
  );

  const hand = (row: boolean) => (
    <Hand game={game} meta={meta} index={index} context={context} onAction={onAction} row={row} />
  );
  const actions = (
    <ActionsPanel
      game={game}
      meta={meta}
      index={index}
      context={context}
      onAction={onAction}
      beforeEndTurn={mobile ? undefined : hand(false)}
      endTurnButton={!mobile}
    />
  );

  if (rotate) return <RotateNotice onExit={onExit} />;

  const Frame = mobile ? MobileShell : BoardScaler;
  const currentPlayer = game.players[game.current_player_index];
  const showStatus = Boolean(
    error || busy || game.status === "finished" || (currentPlayer?.id === context.me.id && context.me.jail_turns > 0),
  );

  return (
    <BoardLayoutProvider layout={mobile ? "mobile" : "wide"}>
    <Frame>
      <div
        className={`grid h-full w-full gap-1.5 p-2 font-sans text-ink ${
          showStatus ? "grid-rows-[auto_auto_minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]"
        }`}
      >
      <Header
        game={game}
        me={context.me}
        meta={meta}
        unseenEvents={unseen}
        mobile={mobile}
        onChronicle={() => setChronicle(true)}
        onScore={() => setScore(true)}
        onRules={() => setRules(true)}
        onExit={onExit}
      />
      {showStatus && <StatusBar game={game} me={context.me} busy={busy} error={error} />}

      {mobile ? (
        <MobileTable
          game={game}
          context={context}
          onAction={onAction}
          players={rail}
          actions={actions}
          projects={projectsPanel}
          market={marketPanel}
          city={cityPanel}
          hand={hand(true)}
          unseen={unseen}
          onChronicle={() => setChronicle(true)}
        />
      ) : (
        <div className="grid min-h-0 grid-cols-[238px_minmax(0,1fr)_274px] gap-1.5">
          {players}
          {city}
          {actions}
        </div>
      )}

      <Chronicle
        open={chronicle}
        onClose={() => setChronicle(false)}
        game={game}
        meta={meta}
        exportEnabled={liveSession}
      />

      <TurnBriefingModal briefing={briefing} onClose={closeBriefing} />
      <GreyResult game={game} meta={meta} meId={context.me.id} />

      <DetailsModal open={score} onClose={() => setScore(false)} label={t("ui.finish.scoreModal")}>
        <ScoreDetails game={game} me={context.me} meta={meta} />
      </DetailsModal>

      <RulesBook open={rules} onClose={() => setRules(false)} meta={meta} rolePrice={game.role_price} />

      <Modal
        open={game.status === "finished" && finishOpen}
        onClose={() => setFinishOpen(false)}
        title={t("ui.finish.title")}
        subtitle={t("ui.finish.rounds", { count: game.round_number })}
        footer={
          <button
            type="button"
            onClick={onExit}
            className="w-full rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              hover:border-accent"
          >
            {t("ui.finish.back")}
          </button>
        }
      >
        <ol className="grid gap-1">
          {ranking.map((player, position) => (
            <li
              key={player.id}
              className="flex items-baseline gap-2 rounded-md bg-panel-2 px-2.5 py-2"
            >
              <b className="w-5 text-points">{position + 1}.</b>
              <b className="flex-1 text-ink">{player.name}</b>
              <span className="text-ink-dim">
                {index.roles.get(player.role ?? "")?.title ?? t("ui.finish.noRole")}
              </span>
              <b className="text-sm text-points">{scoreOf(game, player)}</b>
            </li>
          ))}
        </ol>
      </Modal>
      </div>
    </Frame>
    </BoardLayoutProvider>
  );
}

/** Подключённая версия: всё то же самое, но из живой партии. */
export function Board({ onExit }: { onExit: () => void }) {
  const room = useRoom();
  const game = useGame();
  const me = useMe();
  const meta = useMeta();
  const legal = useLegalActions();
  const { send, pending, isPending, error } = useCommand();

  const context: ActionContext = { game, me, legal, pending };

  return (
    <BoardView
      game={game}
      meta={meta}
      context={context}
      onAction={send}
      busy={isPending}
      error={error || (room.error instanceof Error ? room.error.message : "")}
      onExit={onExit}
      liveSession
    />
  );
}
