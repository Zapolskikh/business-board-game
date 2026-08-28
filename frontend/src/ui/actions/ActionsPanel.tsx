import { useState, type ReactNode } from "react";
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
import { DetailsModal } from "../primitives/Modal";
import { ActionButton, DrawerRow, ListItem, Panel, zoneRule, zoneStyle } from "../primitives/atoms";
import { findActions, resolve, resolveMany, usedThisTurn, type ActionContext } from "../lib/actions";
import { roofPrice, type Indexes } from "../lib/board";
import { RolesDetails } from "./RolesDetails";
import { RolePowersDetails } from "./RolePowersDetails";
import { GreyDetails } from "./GreyDetails";

/* Правая панель. Шесть базовых действий видны всегда, справочники — в больших окнах.
 * Способности роли НЕ в ящике: это активные кнопки хода, а не справка.
 */

/* Цена действия с красным числом того ресурса, которого не хватает, — та же практика,
 * что в городских проектах. Красное число говорит не только «нельзя», но и чего именно
 * не хватает, а значит — что делать следующим ходом. */
function Need({ short, children }: { short: boolean; children: ReactNode }) {
  return <b className={short ? "font-bold text-bad" : "font-normal"}>{children}</b>;
}


/** Чистки роли живут на одной кнопке «Антикризис»: у каждой роли своя цена, действие одно. */
const cleanupPowers = new Set(["politician_cleanup", "mafia_cleanup", "fraudster_cleanup"]);

export function ActionsPanel({
  game,
  meta,
  index,
  context,
  onAction,
  beforeEndTurn,
}: {
  game: GameState;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
  /* Что показать над кнопкой завершения хода. Сюда уехала рука: карты разыгрываются
   * в свой ход, и её место — рядом с остальными действиями, а не внизу доски рядом с городом.
   * Пропом, а не импортом — чтобы панель действий не знала про руку. */
  beforeEndTurn?: ReactNode;
}) {
  const me = context.me;
  const tiers = campaignTiers(meta);
  const patron = patronage(meta);
  const lobby = lobbying(meta);
  /* Какой справочник открыт. Одно поле вместо трёх флагов: окно всё равно может
   * быть только одно, и состояние «открыты два» просто не выразимо. */
  const [drawer, setDrawer] = useState<"roles" | "powers" | "grey" | null>(null);

  const work = resolve(context, "basic_action", { kind: "work" });
  const patronAction = resolve(context, "basic_action", { kind: "patronage" });
  const lobbyAction = resolve(context, "basic_action", { kind: "lobbying" });
  const roof = resolve(context, "buy_roof");
  const endTurn = resolve(context, "end_turn");

  // Антикризис: если у роли есть своя чистка — она дешевле, движок пришлёт именно её.
  const cleanupPower = cleanupPowerFor(me.role);
  const cleanup = cleanupPower
    ? resolve(context, "use_role_power", { power: cleanupPower })
    : resolve(context, "crisis_pr");
  const cleanupLabel = cleanupPower ? cleanupOffer(cleanupPower, meta).label : "Антикризис";

  // Активные способности роли, кроме чисток — они уже на кнопке выше — и кроме тех, чья цель
  // нарисована в другом месте доски. Метку на карту рынка и вето на проект жмут на самой
  // карточке: список из шести одинаковых строк «Цель» в правой панели не сказал бы, на что
  // именно ставится метка, а карточка говорит это сама.
  const onCardPowers = new Set(["capitalist_claim", "mafia_lock", "politician_veto"]);
  const powers = [
    ...new Set(
      findActions(context, "use_role_power")
        .map(action => String(action.payload.power))
        .filter(power => !cleanupPowers.has(power) && !onCardPowers.has(power)),
    ),
  ];
  const role = me.role ? index.roles.get(me.role) : undefined;

  const greyAvailable = findActions(context, "grey_operation").length;
  const greySpent = usedThisTurn(game, "grey_operation_used");
  const freeRoles = meta.roles.filter(item => !game.players.some(player => player.role === item.id)).length;

  return (
    /* Зона задаётся на обёртке, а не на каждой из четырёх панелей внутри: --zone-bg
     * каскадом доходит до всех, и правая колонка остаётся одной зоной, даже если панелей
     * в ней станет больше. */
    <div
      style={zoneStyle("actions")}
      className="grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto_auto] gap-1.5"
    >
      <Panel className="pb-2">
        <div className={`flex items-center gap-2 px-0.5 pt-px pb-[2px] ${zoneRule}`}>
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
          <ActionButton label="Заказ" cost="+2$ в кошелёк" state={work} onClick={() => act(work)} />
          {tiers.map(tier => {
            const campaign = resolve(context, "basic_action", { kind: "campaign", spend: tier.spend });
            return (
              <ActionButton
                key={tier.spend}
                label="Обмен"
                cost={
                  <>
                    <Need short={me.money < tier.spend}>{tier.spend}$</Need> → {tier.gain}◆
                  </>
                }
                state={campaign}
                onClick={() => act(campaign)}
              />
            );
          })}
          <ActionButton
            label="Патронаж"
            cost={
              <>
                <Need short={me.money < patron.money}>{patron.money}$</Need> → {patron.points} оч
              </>
            }
            state={patronAction}
            spent={usedThisTurn(game, "patronage")}
            onClick={() => act(patronAction)}
          />
          <ActionButton
            label="Лоббирование"
            cost={
              <>
                <Need short={me.influence < lobby.influence}>{lobby.influence}◆</Need> →{" "}
                {lobby.points} оч
              </>
            }
            state={lobbyAction}
            spent={usedThisTurn(game, "lobbying")}
            onClick={() => act(lobbyAction)}
          />
          {/* «Антикризис» ничего не говорил о том, что делает кнопка. У ролевой чистки
            * своё название из каталога — оно точнее, его и оставляем. */}
          <ActionButton
            label={cleanupPower ? cleanupLabel : "Чистка"}
            cost={
              cleanupPower ? (
                "−1 ⚠ скандал"
              ) : (
                <>
                  <Need short={me.influence < crisisPrInfluence(meta)}>
                    {crisisPrInfluence(meta)}◆
                  </Need>{" "}
                  → −1 ⚠ скандал
                </>
              )
            }
            state={cleanup}
            onClick={() => act(cleanup)}
          />
          <ActionButton
            label="Крыша"
            cost={
              <>
                <Need short={me.money < roofPrice(game)}>{roofPrice(game)}$</Need> · есть {me.roofs}{" "}
                из {me.roof_limit}
              </>
            }
            state={roof}
            onClick={() => act(roof)}
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
                districts={meta.districts}
                context={context}
                onAction={onAction}
              />
            ))}
          </div>
        </Panel>
      )}

      {/* Справочники. Заголовка у секции нет: три строки со стрелками и так читаются как
        * «нажми, чтобы открыть», а подпись занимала строку и ничего не добавляла.
        *
        * Открываются окнами по центру, а не поповерами сбоку: в них таблицы на всю ширину
        * — в узкой колонке они не помещались. Содержимое то же самое, компоненты общие. */}
      <Panel rows>
        <div className="grid content-start gap-1 overflow-auto p-px">
          <DrawerRow
            icon="🏷️"
            title="Роли"
            hint={role ? `ваша: ${role.title} · свободно ${freeRoles}` : `у вас нет роли · ${game.role_price}◆`}
            onClick={() => setDrawer("roles")}
          />

          <DrawerRow
            icon="⚡"
            title="Возможности роли"
            hint={role ? "пассивные перки и активные способности" : "нужна роль"}
            onClick={() => setDrawer("powers")}
          />

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
            onClick={() => setDrawer("grey")}
          />
        </div>
      </Panel>

      <DetailsModal open={drawer === "roles"} onClose={() => setDrawer(null)} label="Роли">
        <RolesDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />
      </DetailsModal>
      <DetailsModal open={drawer === "powers"} onClose={() => setDrawer(null)} label="Возможности роли">
        <RolePowersDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />
      </DetailsModal>
      <DetailsModal open={drawer === "grey"} onClose={() => setDrawer(null)} label="Серые операции">
        <GreyDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />
      </DetailsModal>

      {beforeEndTurn}

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
  districts,
  context,
  onAction,
}: {
  power: string;
  game: GameState;
  districts: CityMeta["districts"];
  context: ActionContext;
  onAction: (action: LegalAction) => void;
}) {
  const { options, blocked, pending } = resolveMany(context, "use_role_power", { power });
  const label = powerLabels[power] ?? power;
  const byDistrict = options.length > 0 && options[0].payload.district !== undefined;
  const single = options.length === 1 && options[0].payload.target_id === undefined && !byDistrict;
  const danger = /racket|sanction|scam|inflate|publish|inspection|seize|lock/.test(power);

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

  if (byDistrict) {
    return (
      <CardPopover
        side="left"
        content={
          <>
            <PopoverHeader title={label} subtitle="выберите район" />
            <PopoverBody>
              <p className="mb-2">
                Район считается вашим до конца раунда: открывает проекты и серые операции этого
                квартала и входит в синергию. Стоит влияние и скандал, но не действие.
              </p>
              <div className="grid gap-1">
                {options.map((action, position) => {
                  const district = districts.find(item => item.id === action.payload.district);
                  return (
                    <ListItem
                      key={position}
                      icon={district?.icon ?? "🏙"}
                      title={district?.title ?? String(action.payload.district)}
                      onClick={() => onAction(action)}
                    />
                  );
                })}
              </div>
            </PopoverBody>
          </>
        }
      >
        <ActionButton
          label={label}
          cost="3◆ + скандал, без действия"
          tone="plain"
          state={{ kind: "ready", action: options[0] }}
          onClick={() => undefined}
        />
      </CardPopover>
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
