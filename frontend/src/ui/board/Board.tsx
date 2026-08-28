import { useEffect, useMemo, useState } from "react";
import { scoreOf } from "../../online/gameUi";
import { buildRulesHtml } from "../../online/rulesDocument";
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
import { ChronicleRail } from "./ChronicleRail";
import { BoardScaler } from "./BoardScaler";
import { Header, StatusBar } from "./Header";
import { ScoreDetails } from "./headerPopovers";

/* Сборка доски.
 *
 * Сетка: 238 / 1fr / 274. Рынок — единственная строка с `minmax(280px, 1fr)`, поэтому на
 * высоких экранах он растягивается, а ниже ~820px центральная колонка начинает скроллиться,
 * вместо того чтобы сжимать текст до нечитаемого. Шапка, игроки и действия не двигаются.
 */
export function BoardView({
  game,
  meta,
  roomName,
  context,
  onAction,
  busy,
  error,
  onExit,
}: {
  game: GameState;
  meta: CityMeta;
  roomName: string;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
  busy: boolean;
  error: string;
  onExit: () => void;
}) {
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

  const ranking = useMemo(
    () => [...game.players].sort((left, right) => scoreOf(game, right) - scoreOf(game, left)),
    [game],
  );

  return (
    <BoardScaler>
      <div className="grid h-full w-full grid-rows-[auto_auto_minmax(0,1fr)] gap-1.5 p-2 font-sans text-ink">
      <Header
        game={game}
        me={context.me}
        meta={meta}
        roomName={roomName}
        unseenEvents={unseen}
        onChronicle={() => setChronicle(true)}
        onScore={() => setScore(true)}
        onRules={() => setRules(true)}
        onExit={onExit}
      />
      <StatusBar game={game} me={context.me} busy={busy} error={error} />

      <div className="grid min-h-0 grid-cols-[238px_minmax(0,1fr)_274px] gap-1.5">
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-1.5">
          <PlayersRail game={game} meta={meta} index={index} context={context} onAction={onAction} />
          <ChronicleRail game={game} meta={meta} unseen={unseen} onOpen={() => setChronicle(true)} />
        </div>

        {/* Рынок и город делят остаток экрана поровну — у обоих по два ряда карточек, и так
          * один и тот же объект до и после покупки остаётся одного размера. Доли равные
          * и постоянные: содержимое панелей на высоту не влияет, поэтому покупка ничего
          * не перекраивает. */}
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
          <Projects game={game} meta={meta} index={index} context={context} onAction={onAction} />
          <MarketGrid
            game={game}
            me={context.me}
            meta={meta}
            legal={context.legal}
            pending={context.pending}
            onBuy={onAction}
          />
          <CityPanel meta={meta} index={index} context={context} onAction={onAction} />
        </div>

        <ActionsPanel
          game={game}
          meta={meta}
          index={index}
          context={context}
          onAction={onAction}
          beforeEndTurn={
            <Hand game={game} meta={meta} index={index} context={context} onAction={onAction} />
          }
        />
      </div>

      <Chronicle open={chronicle} onClose={() => setChronicle(false)} game={game} meta={meta} />

      <DetailsModal open={score} onClose={() => setScore(false)} label="Счёт и доход">
        <ScoreDetails game={game} me={context.me} meta={meta} />
      </DetailsModal>

      <Modal open={rules} onClose={() => setRules(false)} title="📖 Правила" width={720}>
        <div
          className="[&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:text-ink
            [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_h3]:text-ink
            [&_li]:mb-0.5 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_strong]:text-ink"
          dangerouslySetInnerHTML={{ __html: buildRulesHtml(meta, game.role_price) }}
        />
      </Modal>

      <Modal
        open={game.status === "finished" && finishOpen}
        onClose={() => setFinishOpen(false)}
        title="🏁 Партия окончена"
        subtitle={`${game.round_number} раундов`}
        footer={
          <button
            type="button"
            onClick={onExit}
            className="w-full rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              hover:border-accent"
          >
            ← Вернуться в комнаты
          </button>
        }
      >
        <ol className="grid gap-1">
          {ranking.map((player, position) => (
            <li
              key={player.id}
              className="flex items-baseline gap-2 rounded-md bg-panel-2 px-2.5 py-2"
            >
              <b className="w-5 text-gold">{position + 1}.</b>
              <b className="flex-1 text-ink">{player.name}</b>
              <span className="text-ink-dim">
                {index.roles.get(player.role ?? "")?.title ?? "без роли"}
              </span>
              <b className="text-sm text-gold">{scoreOf(game, player)}</b>
            </li>
          ))}
        </ol>
      </Modal>
      </div>
    </BoardScaler>
  );
}

/** Подключённая версия: всё то же самое, но из живой партии. */
export function Board({ roomName, onExit }: { roomName: string; onExit: () => void }) {
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
      roomName={roomName}
      context={context}
      onAction={send}
      busy={isPending}
      error={error || (room.error instanceof Error ? room.error.message : "")}
      onExit={onExit}
    />
  );
}
