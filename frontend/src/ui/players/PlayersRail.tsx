import { motion } from "motion/react";
import { forwardRef } from "react";
import { difficultyLabels } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, PlayerState } from "../../online/types";
import { CardPopover } from "../primitives/CardPopover";
import { Panel, SectionHead } from "../primitives/atoms";
import type { ActionContext } from "../lib/actions";
import { atScandalRisk, playerColor, scandalLimit, type Indexes } from "../lib/board";
import { PlayerDetails } from "./PlayerDetails";

/* Игроки — четыре строки на всю высоту колонки, без скролла.
 *
 * Четверо — предел стола (MAX_PLAYERS), поэтому сетка задана жёстко: строки делят высоту
 * поровну и не ездят при партии на двоих или троих. В каждой хватает места на три яруса:
 * имя, роль, ресурсы.
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
    <Panel rows zone="players">
      <SectionHead title="Игроки" meta={`${game.players.length} в партии`} />
      <div className="grid min-h-0 grid-rows-4 gap-1 p-px">
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

type PlayerRowProps = {
  player: PlayerState;
  game: GameState;
  index: Indexes;
  isMe: boolean;
};

/* CardPopover uses Radix `asChild`: its positioning engine needs a ref to the real button.
 * Without forwardRef the details panel was created, but stayed at Radix's hidden
 * `translate(0, -200%)` fallback on wide screens. */
const PlayerRow = forwardRef<HTMLButtonElement, PlayerRowProps>(function PlayerRow({
  player,
  game,
  index,
  isMe,
  ...rest
}, ref) {
  const role = player.role ? index.roles.get(player.role) : undefined;
  const score = game.score_breakdown?.[player.id]?.total ?? 0;
  const turn = game.players[game.current_player_index]?.id === player.id;
  const risky = atScandalRisk(player);
  const color = playerColor(game, player.id);
  const shielded = player.roofs > 0;

  /* Два спокойных яруса: личность и счёт сверху, ресурсы и защита снизу. Цвет принадлежит
   * значениям, а не квадрантам, поэтому четыре игрока не превращаются в таблицу из линий. */
  return (
    <motion.button
      ref={ref}
      type="button"
      data-ui="player-card"
      /* Без `layout`: четыре строки стоят в порядке хода и местами не меняются, так что
       * анимировать тут нечего. Зато Motion на каждое обновление партии мерял все четыре
       * карточки и гонял проекцию раскладки — ровно в тот момент, когда рядом идут
       * настоящие анимации карт. */
      /* `data-state` занят Radix: CardPopover записывает туда open/closed. Собственное
       * состояние игрока держим отдельно, иначе стили хода тихо перетираются. */
      data-player-state={turn ? "turn" : isMe ? "me" : "idle"}
      className={`relative grid min-h-0 grid-rows-[minmax(28px,1fr)_auto] gap-1 overflow-hidden rounded-lg
        border bg-panel-2 px-2 py-1 text-left
        data-[player-state=idle]:border-line data-[player-state=me]:border-line-2
        data-[player-state=me]:bg-panel-3 data-[player-state=turn]:border-good
        data-[player-state=turn]:bg-[#121a15] hover:border-line-2
        data-[player-state=turn]:hover:border-good
        ${turn ? "player-turn" : ""} ${player.jail_turns > 0 ? "opacity-60" : ""}`}
      {...rest}
    >
      {/* ЛЕВО-ВЕРХ: кто играет */}
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full border bg-panel text-[13px]"
          style={{ borderColor: role?.color ?? color }}
        >
          {role?.icon ?? "👤"}
        </span>
        <span className="grid min-w-0 flex-1 gap-px overflow-hidden">
          <span className="flex min-w-0 items-center gap-1">
            <b
              className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-bold"
              style={{ color }}
            >
              {player.name}
            </b>
            {player.is_bot && (
              <span className="shrink-0 rounded bg-panel px-1 text-3xs uppercase text-ink-dim">
                {difficultyLabels[player.difficulty] ?? player.difficulty}
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-2xs text-ink-muted">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {role?.title ?? "Без роли"}
            </span>
            <span className="shrink-0 whitespace-nowrap">· {player.assets.length} об.</span>
            {player.jail_turns > 0 ? (
              <span
                className="ml-auto shrink-0 rounded bg-[#28171b] px-1 font-semibold text-bad"
                title={`В тюрьме: осталось ходов ${player.jail_turns}`}
              >
                🚔 {player.jail_turns}
              </span>
            ) : risky ? (
              <span
                className="ml-auto shrink-0 rounded bg-[#241c13] px-1 font-semibold text-warning"
                title="Ещё один скандал — и роль будет потеряна"
              >
                ⚠ роль
              </span>
            ) : null}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-1 rounded-md bg-panel px-1.5 py-1
          text-points">
          <span className="text-3xs">★</span>
          <b className={`font-extrabold leading-none tabular-nums ${score > 99 ? "text-[14px]" : "text-[17px]"}`}>
            {score}
          </b>
        </span>
      </span>

      {/* Ресурсы собраны в спокойную нижнюю плашку; цвет объясняет смысл числа. */}
      <span className="flex items-center gap-2 rounded-md bg-panel px-1.5 py-1 text-[11.5px] font-semibold">
        <span title="Деньги" className="text-money">
          <span className="text-ink-dim">●</span> {player.money}$
        </span>
        <span title="Влияние" className="text-influence">
          ◆ {player.influence}
        </span>
        <span title="Скандалы" className={risky ? "text-warning" : "text-ink-muted"}>
          <span className={risky ? "text-warning" : "text-ink-dim"}>⚠</span> {player.scandals}/
          {scandalLimit(player)}
        </span>
        <span className={`ml-auto ${shielded ? "text-defence" : "text-ink-dim"}`} title="Крыши">
          🛡 {player.roofs}/{player.roof_limit}
        </span>
      </span>
    </motion.button>
  );
});
