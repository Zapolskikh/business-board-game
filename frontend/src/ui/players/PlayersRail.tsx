import { motion } from "motion/react";
import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { difficultyLabels } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, PlayerState } from "../../online/types";
import { CardPopover } from "../primitives/CardPopover";
import { Panel, SectionHead } from "../primitives/atoms";
import type { ActionContext } from "../lib/actions";
import { atScandalRisk, playerColor, scandalLimit, type Indexes } from "../lib/board";
import { PlayerDetails } from "./PlayerDetails";
import { playerFrame, projectIcon, roleIcon, statIcon } from "../assets/cards";

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
            width={520}
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
  const star = projectIcon("score");

  const avatar = roleIcon(player.role ?? undefined);

  /* Макет из presets: пергамент в золотой рамке, цветная полоса игрока слева, круглый значок
   * роли, крупный счёт справа и плашка ресурсов снизу. Цвет игрока — полоса, кольцо и счёт;
   * у ресурсов свои смысловые цвета, как и на всей доске. */
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
      style={{ "--player-color": color, "--player-frame": playerFrame ? `url(${playerFrame})` : "none" } as CSSProperties}
      className={`game-card player-card grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-1 overflow-hidden
        py-1 pr-1 pl-3 text-left ${player.jail_turns > 0 ? "opacity-60" : ""}`}
      {...rest}
    >
      <span className="player-card-stripe" aria-hidden />
      {turn && (
        <span
          aria-hidden
          className="absolute top-1/2 left-[3px] size-0 -translate-y-1/2 border-y-[5px] border-l-[6px]
            border-y-transparent border-l-[#c9a55a]"
        />
      )}

      <span className="flex min-h-0 min-w-0 items-center gap-2">
        <span className="player-card-avatar grid size-12 shrink-0 place-items-center rounded-full">
          {avatar ? (
            <img src={avatar} alt={role?.title ?? "Без роли"} className="size-[30px] object-contain" />
          ) : (
            <span className="text-[16px]">{role?.icon ?? "👤"}</span>
          )}
        </span>

        <span className="grid min-w-0 flex-1 gap-px overflow-hidden">
          <span className="flex min-w-0 items-center gap-1">
            <b className="card-serif min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[16px]
              leading-tight">
              {player.name}
            </b>
            <span
              className="player-card-plate flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5"
              title="Победные очки"
            >
              {star && <img src={star} alt="" className="size-3.5" />}
              <b
                className={`card-serif player-card-score leading-none tabular-nums ${
                  score > 99 ? "text-[15px]" : "text-[18px]"
                }`}
              >
                {score}
              </b>
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-2xs text-ink-muted">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {role?.title ?? "Без роли"}
            </span>
            <span className="shrink-0 whitespace-nowrap">· {player.assets.length} об.</span>
          </span>
          <span className="flex min-h-[15px] min-w-0 items-center gap-1 overflow-hidden text-3xs">
            {player.is_bot && (
              <span className="shrink-0 rounded bg-panel/60 px-1 uppercase text-ink-dim">
                {difficultyLabels[player.difficulty] ?? player.difficulty}
              </span>
            )}
            {turn && (
              <span className="player-card-turn-pill shrink-0 rounded-full px-1.5 font-semibold">
                ✦ Ходит
              </span>
            )}
            {player.jail_turns > 0 ? (
              <span
                className="shrink-0 rounded bg-[#e6c8c4] px-1 font-semibold text-bad"
                title={`В тюрьме: осталось ходов ${player.jail_turns}`}
              >
                🚔 {player.jail_turns}
              </span>
            ) : risky ? (
              <span
                className="shrink-0 rounded bg-[#ecd3b4] px-1 font-semibold text-warning"
                title="Ещё один скандал — и роль будет потеряна"
              >
                ⚠ роль
              </span>
            ) : null}
          </span>
        </span>
      </span>

      {/* Ресурсы — плашка из четырёх равных ячеек, у каждой свой значок и смысловой цвет. */}
      <span className="player-card-plate grid grid-cols-4 items-center rounded-md py-0.5 text-[12px] font-bold">
        <Stat icon={statIcon("money")} label="Деньги" className="text-money">
          {player.money}$
        </Stat>
        <Stat icon={statIcon("influence")} label="Влияние" className="text-influence">
          {player.influence}
        </Stat>
        <Stat icon={statIcon("scandal")} label="Скандалы" className={risky ? "text-bad" : "text-ink-muted"}>
          {player.scandals}/{scandalLimit(player)}
        </Stat>
        <Stat icon={statIcon("roof")} label="Крыши" className={shielded ? "text-defence" : "text-ink-dim"}>
          {player.roofs}/{player.roof_limit}
        </Stat>
      </span>
    </motion.button>
  );
});

function Stat({
  icon,
  label,
  className,
  children,
}: {
  icon: string | undefined;
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      title={label}
      className={`flex min-w-0 items-center justify-center gap-0.5 whitespace-nowrap border-l border-[#d8c59d]
        tabular-nums first:border-l-0 ${className}`}
    >
      {icon && <img src={icon} alt="" className="size-4 shrink-0" />}
      {children}
    </span>
  );
}
