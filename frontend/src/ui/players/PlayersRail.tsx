import { motion } from "motion/react";
import { difficultyLabels } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, PlayerState } from "../../online/types";
import { CardPopover } from "../primitives/CardPopover";
import { Panel, SectionHead } from "../primitives/atoms";
import type { ActionContext } from "../lib/actions";
import { atScandalRisk, scandalLimit, turnPosition, type Indexes } from "../lib/board";
import { PlayerDetails } from "./PlayerDetails";

/* Игроки — строками, а не карточками: партия бывает на шестерых, и шесть блоков
 * по 105px занимали бы всю высоту колонки. Две строки на игрока держат и 6 мест.
 */
export function PlayersRail({
  game,
  meta,
  index,
  context,
  onAction,
}: {
  game: GameState;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
}) {
  return (
    <Panel rows>
      <SectionHead title="Игроки" meta={`${game.players.length} в партии`} />
      <div className="grid content-start gap-1 overflow-auto p-px">
        {game.players.map(player => (
          <CardPopover
            key={player.id}
            label={`${player.name} — подробности`}
            content={
              <PlayerDetails
                player={player}
                game={game}
                meta={meta}
                index={index}
                context={context}
                onAction={onAction}
              />
            }
          >
            <PlayerRow player={player} game={game} index={index} isMe={player.id === context.me.id} />
          </CardPopover>
        ))}
      </div>
    </Panel>
  );
}

const PlayerRow = ({
  player,
  game,
  index,
  isMe,
  ...rest
}: {
  player: PlayerState;
  game: GameState;
  index: Indexes;
  isMe: boolean;
}) => {
  const role = player.role ? index.roles.get(player.role) : undefined;
  const score = game.score_breakdown?.[player.id]?.total ?? 0;
  const turn = game.players[game.current_player_index]?.id === player.id;
  const risky = atScandalRisk(player);
  const position = turnPosition(game, player.id);

  return (
    <motion.button
      type="button"
      layout
      data-state={turn ? "turn" : isMe ? "me" : "idle"}
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-[7px]
        border border-l-[3px] border-line px-[7px] py-[5px] text-left
        data-[state=idle]:border-l-transparent data-[state=idle]:bg-panel-2
        data-[state=me]:border-accent data-[state=me]:border-l-accent data-[state=me]:bg-[#132234]
        data-[state=turn]:border-l-good data-[state=turn]:bg-[#15271f]
        hover:border-line-2 ${player.jail_turns > 0 ? "opacity-60" : ""}`}
      {...rest}
    >
      <span className="grid size-[14px] place-items-center rounded bg-panel-3 text-3xs text-ink-muted">
        {position >= 0 ? position + 1 : "–"}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span
          className="grid size-6 place-items-center rounded-full border-[1.5px] text-[12px]"
          style={{ borderColor: role?.color ?? "#3d4757" }}
        >
          {role?.icon ?? "👤"}
        </span>
        <b className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold">
          {player.name}
        </b>
        {player.is_bot && (
          <span className="rounded bg-[#243549] px-1 text-3xs uppercase text-ink-muted">
            {difficultyLabels[player.difficulty] ?? player.difficulty}
          </span>
        )}
      </span>
      <span className="text-[15px] font-extrabold text-gold">{score}</span>

      <span className="col-span-full flex gap-[7px] text-2xs text-ink-muted">
        <span>💰{player.money}</span>
        <span>◆{player.influence}</span>
        <span className={risky ? "font-semibold text-gold" : undefined}>
          ⚠{player.scandals}/{scandalLimit(player)}
        </span>
        <span>
          🛡{player.roofs}/{player.roof_limit}
        </span>
        <span className="ml-auto overflow-hidden text-ellipsis whitespace-nowrap text-ink-dim">
          {role?.title ?? "Без роли"} · {player.assets.length} об.
        </span>
      </span>

      {player.jail_turns > 0 && (
        <span className="col-span-full rounded bg-[#3a1f26] px-1.5 text-3xs text-[#ffb3b3]">
          🚔 тюрьма: ходов {player.jail_turns}
        </span>
      )}
      {player.jail_turns === 0 && risky && (
        <span className="col-span-full rounded bg-[#3a2d12] px-1.5 text-3xs text-gold">
          ещё 1 скандал — и роль потеряна
        </span>
      )}
    </motion.button>
  );
};
