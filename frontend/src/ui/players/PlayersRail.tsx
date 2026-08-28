import { motion } from "motion/react";
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
  const color = playerColor(game, player.id);
  const shielded = player.roofs > 0;

  /* Четыре квадранта, разделённые линиями: кто это (слева сверху), сколько очков
   * (справа сверху), чем располагает (слева снизу), защищён ли (справа снизу).
   *
   * Линии — border на самих ячейках, а не отдельные элементы: так они всегда упираются
   * в края карточки. Внутренних отступов у карточки нет вовсе, ячейки держат свои поля
   * сами — иначе заливка квадранта не доходила бы до края и разделители повисали в воздухе.
   */
  return (
    <motion.button
      type="button"
      /* Без `layout`: четыре строки стоят в порядке хода и местами не меняются, так что
       * анимировать тут нечего. Зато Motion на каждое обновление партии мерял все четыре
       * карточки и гонял проекцию раскладки — ровно в тот момент, когда рядом идут
       * настоящие анимации карт. */
      data-state={turn ? "turn" : isMe ? "me" : "idle"}
      className={`grid min-h-0 grid-cols-[minmax(0,1fr)_38px] grid-rows-[minmax(0,1fr)_auto]
        overflow-hidden rounded-lg border-2 text-left
        data-[state=idle]:border-line data-[state=idle]:bg-panel-2
        data-[state=me]:border-line-2 data-[state=me]:bg-[#132234]
        data-[state=turn]:border-good data-[state=turn]:bg-[#15271f]
        data-[state=turn]:shadow-[0_0_0_1px_#39c47a55,0_0_12px_#39c47a33]
        hover:border-line-2 data-[state=turn]:hover:border-good
        ${player.jail_turns > 0 ? "opacity-60" : ""}`}
      {...rest}
    >
      {/* ЛЕВО-ВЕРХ: кто играет */}
      <span className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full border-2 text-[13px]"
          style={{ borderColor: role?.color ?? color }}
        >
          {role?.icon ?? "👤"}
        </span>
        <span className="grid min-w-0 gap-px">
          <span className="flex min-w-0 items-center gap-1">
            <b
              className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold"
              style={{ color }}
            >
              {player.name}
            </b>
            {player.is_bot && (
              <span className="shrink-0 rounded bg-[#243549] px-1 text-3xs uppercase text-ink-muted">
                {difficultyLabels[player.difficulty] ?? player.difficulty}
              </span>
            )}
          </span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-2xs text-ink-muted">
            {role?.title ?? "Без роли"} · {player.assets.length} об.
          </span>
        </span>
      </span>

      {/* ПРАВО-ВЕРХ: очки. Колонка узкая и фиксированная — «999» влезает за счёт того,
        * что кегль падает на трёх знаках, а разделитель стоит у всех на одном месте. */}
      <span
        className={`grid place-items-center border-l-2 border-line font-extrabold leading-none
          tabular-nums text-gold ${score > 99 ? "text-[15px]" : "text-[19px]"}`}
      >
        {score}
      </span>

      {/* ЛЕВО-НИЗ: чем располагает */}
      <span className="grid grid-cols-3 items-center gap-1 border-t-2 border-line px-1.5 py-1
        text-[12px] font-semibold text-ink">
        <span title="Деньги">
          <span className="text-ink-dim">💰</span> {player.money}
        </span>
        <span title="Влияние">
          <span className="text-ink-dim">◆</span> {player.influence}
        </span>
        <span title="Скандалы" className={risky ? "text-[var(--color-warning)]" : undefined}>
          <span className={risky ? "text-[var(--color-warning)]" : "text-ink-dim"}>⚠</span> {player.scandals}/
          {scandalLimit(player)}
        </span>
      </span>

      {/* ПРАВО-НИЗ: защита. Голубой квадрант виден боковым зрением — по нему выбирают,
        * кого атаковать, не читая чисел. */}
      <span
        data-shielded={shielded || undefined}
        className="grid place-items-center border-l-2 border-t-2 border-line text-[11px]
          font-semibold leading-none text-ink-dim
          data-[shielded]:bg-[#0e5b82] data-[shielded]:text-white"
      >
        {player.roofs}/{player.roof_limit}
      </span>

      {player.jail_turns > 0 && (
        <span className="col-span-full truncate border-t-2 border-line bg-[#3a1f26] px-1.5 py-0.5
          text-3xs text-[#ffb3b3]">
          🚔 тюрьма: ходов {player.jail_turns}
        </span>
      )}
      {player.jail_turns === 0 && risky && (
        <span className="col-span-full truncate border-t-2 border-line bg-[#3a2d12] px-1.5 py-0.5
          text-3xs text-[var(--color-warning)]">
          ещё 1 скандал — и роль потеряна
        </span>
      )}
    </motion.button>
  );
};
