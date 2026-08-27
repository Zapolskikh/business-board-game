import type { CityMeta, GameState, PlayerState } from "../../online/types";
import { CardPopover } from "../primitives/CardPopover";
import { Panel, SectionHead } from "../primitives/atoms";
import { ScoreDetails } from "../board/headerPopovers";
import { RolesDetails } from "../actions/RolesDetails";
import { SlotsDetails } from "../city/SlotsDetails";
import type { ActionContext } from "../lib/actions";
import { maxCapacity, nextSlotPrice, type Indexes } from "../lib/board";
import type { LegalAction } from "../../online/types";

/* «Ваш ход» — три вопроса, на которые в старом интерфейсе не было ответа на экране:
 * кто я сейчас, сколько придёт в конце раунда и сколько места осталось в городе.
 *
 * Плюс полоска «уже потрачено»: движок присылает turn_flags, клиент их только читает.
 * Без неё игрок узнаёт о лимите «раз в ход» только по погасшей кнопке.
 */

const oncePerTurn: { flag: string; label: string }[] = [
  { flag: "patronage", label: "патронаж" },
  { flag: "lobbying", label: "лоббирование" },
  { flag: "projects_rerolled", label: "реролл" },
  { flag: "grey_operation_used", label: "серая" },
  { flag: "card_played", label: "карта" },
  { flag: "card_converted", label: "сброс" },
];

export function TurnState({
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
  const me: PlayerState = context.me;
  const role = me.role ? index.roles.get(me.role) : undefined;
  const forecast = game.round_forecast;
  const slotPrice = nextSlotPrice(meta, me);
  const free = me.capacity - me.assets.length;

  return (
    <Panel>
      <SectionHead title="Ваш ход" />
      <div className="grid gap-1.5">
        <CardPopover
          content={<RolesDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />}
        >
          <Row
            label="Роль"
            value={role ? `${role.icon} ${role.title}` : "Без роли"}
            right={role ? `⚠ до ${me.scandal_limit}` : `${game.role_price}◆`}
          />
        </CardPopover>

        <CardPopover content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <Row
            label="Доход в конце раунда"
            value={<span className="text-3xs text-ink-dim">объекты · проекты · синергия · роль</span>}
            right={
              forecast ? (
                <span className="text-good">
                  +{forecast.money.total}$ +{forecast.influence.total}◆
                </span>
              ) : (
                "—"
              )
            }
          />
        </CardPopover>

        <CardPopover
          content={<SlotsDetails meta={meta} context={context} onAction={onAction} />}
        >
          <Row
            label="Слоты города"
            value={`${me.assets.length} из ${me.capacity} занято`}
            right={
              free > 0 ? (
                <span className="text-good">свободно {free}</span>
              ) : slotPrice !== undefined ? (
                <span className="text-gold">🔒 {slotPrice}$</span>
              ) : (
                <span className="text-ink-dim">максимум {maxCapacity(meta)}</span>
              )
            }
          />
        </CardPopover>

        <div className="flex flex-wrap gap-[3px] p-px">
          {oncePerTurn.map(item => {
            const used = Boolean(game.turn_flags?.[item.flag]);
            return (
              <span
                key={item.flag}
                data-used={used}
                title={used ? "Уже использовано в этом ходу" : "Доступно один раз за ход"}
                className="rounded-[10px] border border-line bg-panel-2 px-1.5 py-0.5 text-3xs text-ink-muted
                  data-[used=true]:border-[#5c3a3a] data-[used=true]:bg-[#2a1e1e]
                  data-[used=true]:text-[#c78e8e] data-[used=true]:line-through"
              >
                {item.label}
              </span>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

const Row = ({
  label,
  value,
  right,
  ...rest
}: {
  label: string;
  value: React.ReactNode;
  right: React.ReactNode;
}) => (
  <button
    type="button"
    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md
      border border-line bg-panel-2 px-[7px] py-[5px] hover:border-line-2"
    {...rest}
  >
    <span className="min-w-0 text-left">
      <small className="block text-3xs uppercase tracking-wide text-ink-dim">{label}</small>
      <b className="block overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]">{value}</b>
    </span>
    <span className="whitespace-nowrap text-[13px] font-bold">{right}</span>
  </button>
);
