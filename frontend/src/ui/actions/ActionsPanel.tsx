import {
  campaignTiers,
  cleanupOffer,
  cleanupPowerFor,
  lobbying,
  patronage,
  powerLabels,
  crisisPrInfluence,
} from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { CardPopover, PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { ActionButton, DrawerRow, ListItem, Panel } from "../primitives/atoms";
import { findActions, resolve, resolveMany, usedThisTurn, type ActionContext } from "../lib/actions";
import { nextSlotPrice, roofPrice, type Indexes } from "../lib/board";
import { RolesDetails } from "./RolesDetails";
import { GreyDetails } from "./GreyDetails";
import { ScoreDetails } from "../board/headerPopovers";

/* Правая панель. Восемь базовых действий видны всегда, справочное и многовариантное —
 * за ящиками. Способности роли НЕ в ящике: это активные кнопки хода, а не справка.
 */

/** Чистки роли живут на одной кнопке «Антикризис»: у каждой роли своя цена, действие одно. */
const cleanupPowers = new Set(["politician_cleanup", "mafia_cleanup", "fraudster_cleanup"]);

export function ActionsPanel({
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
  const me = context.me;
  const tiers = campaignTiers(meta);
  const patron = patronage(meta);
  const lobby = lobbying(meta);
  const slotPrice = nextSlotPrice(meta, me);

  const work = resolve(context, "basic_action", { kind: "work" });
  const patronAction = resolve(context, "basic_action", { kind: "patronage" });
  const lobbyAction = resolve(context, "basic_action", { kind: "lobbying" });
  const roof = resolve(context, "buy_roof");
  const capacity = resolve(context, "buy_capacity");
  const endTurn = resolve(context, "end_turn");

  // Антикризис: если у роли есть своя чистка — она дешевле, движок пришлёт именно её.
  const cleanupPower = cleanupPowerFor(me.role);
  const cleanup = cleanupPower
    ? resolve(context, "use_role_power", { power: cleanupPower })
    : resolve(context, "crisis_pr");
  const cleanupLabel = cleanupPower ? cleanupOffer(cleanupPower, meta).label : "Антикризис";

  // Активные способности роли, кроме чисток — они уже на кнопке выше.
  const powers = [
    ...new Set(
      findActions(context, "use_role_power")
        .map(action => String(action.payload.power))
        .filter(power => !cleanupPowers.has(power)),
    ),
  ];
  const role = me.role ? index.roles.get(me.role) : undefined;

  const greyAvailable = findActions(context, "grey_operation").length;
  const greySpent = usedThisTurn(game, "grey_operation_used");
  const freeRoles = meta.roles.filter(item => !game.players.some(player => player.role === item.id)).length;
  const score = game.score_breakdown?.[me.id];

  return (
    <div className="grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-1.5">
      <Panel className="pb-2">
        <div className="flex items-center gap-2 px-0.5 pt-px">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">Действия</h2>
          <span className="ml-auto flex gap-1">
            {Array.from({ length: Math.max(3, game.actions_left) }).map((_, position) => (
              <i
                key={position}
                className={`size-[9px] rounded-full ${
                  position < game.actions_left ? "bg-good shadow-[0_0_6px_#39c47a66]" : "bg-line-2"
                }`}
              />
            ))}
          </span>
        </div>
      </Panel>

      <Panel>
        <div className="px-0.5 text-3xs uppercase tracking-[0.08em] text-ink-dim">Базовые</div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          <ActionButton label="Заказ" cost="+2$" state={work} onClick={() => act(work)} />
          {tiers.map(tier => {
            const campaign = resolve(context, "basic_action", { kind: "campaign", spend: tier.spend });
            return (
              <ActionButton
                key={tier.spend}
                label="Обмен"
                cost={`${tier.spend}$ → ${tier.gain}◆`}
                state={campaign}
                onClick={() => act(campaign)}
              />
            );
          })}
          <ActionButton
            label="Патронаж"
            cost={`${patron.money}$ → ${patron.points} оч`}
            state={patronAction}
            spent={usedThisTurn(game, "patronage")}
            onClick={() => act(patronAction)}
          />
          <ActionButton
            label="Лоббирование"
            cost={`${lobby.influence}◆ → ${lobby.points} оч`}
            state={lobbyAction}
            spent={usedThisTurn(game, "lobbying")}
            onClick={() => act(lobbyAction)}
          />
          <ActionButton
            label={cleanupLabel}
            cost={cleanupPower ? "снять скандал" : `${crisisPrInfluence(meta)}◆ → −1 ⚠`}
            state={cleanup}
            onClick={() => act(cleanup)}
          />
          <ActionButton
            label="Крыша"
            cost={`${roofPrice(game)}$ · ${me.roofs} из ${me.roof_limit}`}
            state={roof}
            onClick={() => act(roof)}
          />
          <ActionButton
            label="Открыть слот"
            cost={slotPrice !== undefined ? `${slotPrice}$ → ${me.capacity + 1}-й` : "максимум"}
            state={capacity}
            onClick={() => act(capacity)}
          />
        </div>
      </Panel>

      {role && powers.length > 0 && (
        <Panel>
          <div className="px-0.5 text-3xs uppercase tracking-[0.08em] text-ink-dim">
            Способности · {role.icon} {role.title}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {powers.map(power => (
              <PowerButton
                key={power}
                power={power}
                game={game}
                context={context}
                onAction={onAction}
              />
            ))}
          </div>
        </Panel>
      )}

      <Panel rows>
        <div className="px-0.5 pb-1.5 text-3xs uppercase tracking-[0.08em] text-ink-dim">Открыть</div>
        <div className="grid content-start gap-1 overflow-auto p-px">
          <CardPopover
            side="left"
            content={<RolesDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />}
          >
            <DrawerRow
              icon="🏷️"
              title="Роли"
              hint={role ? `ваша: ${role.title} · свободно ${freeRoles}` : `у вас нет роли · ${game.role_price}◆`}
            />
          </CardPopover>

          <CardPopover
            side="left"
            content={<GreyDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />}
          >
            <DrawerRow
              icon="🌒"
              title="Серые операции"
              hint={
                greySpent
                  ? "в этом ходу уже проведена"
                  : greyAvailable > 0
                    ? "выберите операцию и цель"
                    : "нужен активный объект нужного района"
              }
              badge={greySpent ? "✗" : `${greyAvailable} из 5`}
              badgeOn={!greySpent && greyAvailable > 0}
            />
          </CardPopover>

          <CardPopover side="left" content={<ScoreDetails game={game} me={me} meta={meta} />}>
            <DrawerRow
              icon="🏆"
              title="Счёт и доход"
              hint={
                score
                  ? `объекты ${score.assets} · проекты ${score.projects} · скандалы ${score.scandals}`
                  : "разбивка счёта"
              }
              badge={score?.total ?? 0}
              badgeOn
            />
          </CardPopover>
        </div>
      </Panel>

      <button
        type="button"
        disabled={endTurn.kind !== "ready"}
        onClick={() => act(endTurn)}
        className="rounded-[7px] bg-good px-2 py-2.5 text-center text-[13.5px] font-extrabold
          text-[#04130b] enabled:hover:brightness-110 disabled:bg-panel-2 disabled:text-ink-muted
          disabled:opacity-60"
      >
        {endTurn.kind === "pending" ? "Завершаем…" : "Завершить ход"}
      </button>
    </div>
  );

  function act(state: ReturnType<typeof resolve>) {
    if (state.kind === "ready") onAction(state.action);
  }
}

/** Способность с целью: кнопка открывает список тех, кого движок разрешил атаковать. */
function PowerButton({
  power,
  game,
  context,
  onAction,
}: {
  power: string;
  game: GameState;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
}) {
  const { options, blocked, pending } = resolveMany(context, "use_role_power", { power });
  const label = powerLabels[power] ?? power;
  const single = options.length === 1 && options[0].payload.target_id === undefined;
  const danger = /racket|sanction|scam|inflate|publish/.test(power);

  if (single || options.length === 0) {
    const state = options[0]
      ? ({ kind: "ready", action: options[0] } as const)
      : pending
        ? ({ kind: "pending", action: context.pending as LegalAction } as const)
        : ({ kind: "blocked", reason: blocked ?? "Недоступно" } as const);
    return (
      <ActionButton
        label={label}
        cost="тратит действие"
        tone={danger ? "danger" : "plain"}
        state={state}
        onClick={() => state.kind === "ready" && onAction(state.action)}
      />
    );
  }

  return (
    <CardPopover
      side="left"
      content={
        <>
          <PopoverHeader title={label} subtitle="выберите цель" />
          <PopoverBody>
            <p className="mb-2">
              Раз в ход, тратит действие. Крыша цели гасит эффект целиком и тратится.
            </p>
            <div className="grid gap-1">
              {options.map((action, position) => {
                const target = game.players.find(player => player.id === action.payload.target_id);
                return (
                  <ListItem
                    key={position}
                    icon="🎯"
                    title={target?.name ?? "Цель"}
                    hint={
                      target
                        ? `⚠${target.scandals}/${target.scandal_limit} · 🛡${target.roofs}${
                            target.roofs > 0 ? " — Крыша погасит" : ""
                          }`
                        : undefined
                    }
                    right={`${game.score_breakdown?.[target?.id ?? ""]?.total ?? 0} оч`}
                    onClick={() => onAction(action)}
                  />
                );
              })}
            </div>
          </PopoverBody>
        </>
      }
    >
      <button
        type="button"
        className={`grid min-w-0 gap-px rounded-md border bg-panel-2 px-[7px] py-[5px] hover:border-accent
          ${danger ? "border-[#5c3340]" : "border-line"}`}
      >
        <b
          className={`overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-semibold ${
            danger ? "text-[#ff9aa8]" : "text-ink"
          }`}
        >
          {label}
        </b>
        <small className="text-3xs text-ink-muted">выбрать цель ›</small>
      </button>
    </CardPopover>
  );
}
