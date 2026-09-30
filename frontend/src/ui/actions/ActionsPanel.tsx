import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";
import {
  campaignTiers,
  cleanupOffer,
  cleanupPowerFor,
  lobbying,
  patronage,
  powerDescriptions,
  powerLabels,
  crisisPrInfluence,
} from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { CardPopover, PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { ResourceIcon, ResourceText } from "../primitives/ResourceIcon";
import { statIcon } from "../assets/cards";
import { DetailsModal } from "../primitives/Modal";
import { ActionButton, DrawerRow, ListItem, Panel, sectionTitle, zoneRule, zoneStyle } from "../primitives/atoms";
import { findActions, resolve, resolveMany, usedThisTurn, type ActionContext } from "../lib/actions";
import { roofPrice, type Indexes } from "../lib/board";
import { findPreview, previewCost, previewGain, scoreOf, targetStats } from "../lib/powerPreview";
import { RolesDetails } from "./RolesDetails";
import { RolePowersDetails } from "./RolePowersDetails";
import { GreyDetails } from "./GreyDetails";

/* Правая панель. Шесть базовых действий видны всегда, справочники — в больших окнах.
 * Способности роли НЕ в ящике: это активные кнопки хода, а не справка.
 */

/* Цена действия с красным числом того ресурса, которого не хватает, — та же практика,
 * что в городских проектах. Красное число говорит не только «нельзя», но и чего именно
 * не хватает, а значит — что делать следующим ходом. */
function Need({
  short,
  children,
  tone = "plain",
}: {
  short: boolean;
  children: ReactNode;
  tone?: "plain" | "money" | "influence";
}) {
  const toneClass = tone === "money" ? "text-money" : tone === "influence" ? "text-influence" : "";
  return <b className={short ? "font-bold text-bad" : `font-semibold ${toneClass}`}>{children}</b>;
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
  const { t } = useTranslation("game");
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
  const cleanupLabel = cleanupPower ? cleanupOffer(cleanupPower, meta).label : t("ui.actions.cleanup");

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
      className="grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto_auto] gap-1.5"
    >
      <Panel className="pb-2">
        <div className={`flex items-center gap-2 px-0.5 pt-px pb-[2px] ${zoneRule}`}>
          <h2 className={sectionTitle}>{t("ui.actions.title")}</h2>
          <span className="ml-auto flex gap-1">
            {Array.from({ length: Math.max(3, game.actions_left) }).map((_, position) => (
              <img
                key={position}
                src={statIcon("actions")}
                alt=""
                className={`size-3 object-contain ${position < game.actions_left ? "" : "opacity-30 grayscale"}`}
              />
            ))}
          </span>
        </div>
      </Panel>

      <Panel>
        <div className="px-0.5 text-3xs uppercase tracking-[0.08em] text-ink-dim">{t("ui.actions.basic")}</div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          <ActionButton
            label={t("ui.actions.work")}
            cost={<><span className="font-semibold text-money"><ResourceText>+2$</ResourceText></span>{t("ui.actions.workCost")}</>}
            state={work}
            onClick={() => act(work)}
          />
          {tiers.map(tier => {
            const campaign = resolve(context, "basic_action", { kind: "campaign", spend: tier.spend });
            return (
              <ActionButton
                key={tier.spend}
                label={t("ui.actions.exchange")}
                cost={
                  <>
                    <Need short={me.money < tier.spend} tone="money"><ResourceText>{`${tier.spend}$`}</ResourceText></Need>
                    {" → "}<span className="font-semibold text-influence"><ResourceText>{`${tier.gain}◆`}</ResourceText></span>
                  </>
                }
                state={campaign}
                onClick={() => act(campaign)}
              />
            );
          })}
          <ActionButton
            label={t("ui.actions.patronage")}
            cost={
              <>
                    <Need short={me.money < patron.money} tone="money"><ResourceText>{`${patron.money}$`}</ResourceText></Need>
                    {" → "}<span className="font-semibold text-points">{t("ui.actions.pts", { count: patron.points })}</span>
              </>
            }
            state={patronAction}
            spent={usedThisTurn(game, "patronage")}
            onClick={() => act(patronAction)}
          />
          <ActionButton
            label={t("ui.actions.lobbying")}
            cost={
              <>
                    <Need short={me.influence < lobby.influence} tone="influence"><ResourceText>{`${lobby.influence}◆`}</ResourceText></Need>
                    {" → "}<span className="font-semibold text-points">{t("ui.actions.pts", { count: lobby.points })}</span>
              </>
            }
            state={lobbyAction}
            spent={usedThisTurn(game, "lobbying")}
            onClick={() => act(lobbyAction)}
          />
          {/* «Антикризис» ничего не говорил о том, что делает кнопка. У ролевой чистки
            * своё название из каталога — оно точнее, его и оставляем. */}
          <ActionButton
            label={cleanupPower ? cleanupLabel : t("ui.actions.cleanup")}
            cost={
              cleanupPower ? (
                <ResourceText>{t("ui.actions.scandalMinus")}</ResourceText>
              ) : (
                <>
                  <Need short={me.influence < crisisPrInfluence(meta)} tone="influence">
                    <ResourceText>{`${crisisPrInfluence(meta)}◆`}</ResourceText>
                  </Need>{" → "}
                  <ResourceText>{t("ui.actions.scandalMinus")}</ResourceText>
                </>
              )
            }
            state={cleanup}
            onClick={() => act(cleanup)}
          />
          <ActionButton
            label={t("ui.actions.roof")}
            cost={
              <>
                <Need short={me.money < roofPrice(game)} tone="money"><ResourceText>{`${roofPrice(game)}$`}</ResourceText></Need>
                {t("ui.actions.roofHave", { have: me.roofs, limit: me.roof_limit })}
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
            {t("ui.actions.powers", { icon: role.icon, role: role.title })}
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
            title={t("ui.actions.roles")}
            hint={role ? t("ui.actions.rolesMine", { role: role.title, free: freeRoles }) : t("ui.actions.rolesNone", { price: game.role_price })}
            onClick={() => setDrawer("roles")}
          />

          <DrawerRow
            icon={<ResourceIcon name="actions" size="18px" />}
            title={t("ui.actions.rolePowers")}
            hint={role ? t("ui.actions.rolePowersHint") : t("ui.actions.rolePowersNone")}
            onClick={() => setDrawer("powers")}
          />

          <DrawerRow
            icon="🌒"
            title={t("ui.actions.grey")}
            hint={
              greySpent
                ? t("ui.actions.greySpent")
                : greyAvailable > 0
                  ? t("ui.actions.greyPick")
                  : t("ui.actions.greyNeed")
            }
            badge={greySpent ? "✗" : t("ui.actions.greyBadge", { count: greyAvailable })}
            badgeOn={!greySpent && greyAvailable > 0}
            onClick={() => setDrawer("grey")}
          />
        </div>
      </Panel>

      <DetailsModal open={drawer === "roles"} onClose={() => setDrawer(null)} label={t("ui.actions.roles")} width={1040}>
        <RolesDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />
      </DetailsModal>
      <DetailsModal open={drawer === "powers"} onClose={() => setDrawer(null)} label={t("ui.actions.rolePowers")}>
        <RolePowersDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />
      </DetailsModal>
      <DetailsModal open={drawer === "grey"} onClose={() => setDrawer(null)} label={t("ui.actions.grey")}>
        <GreyDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />
      </DetailsModal>

      {beforeEndTurn}

      <button
        type="button"
        disabled={endTurn.kind !== "ready"}
        onClick={() => act(endTurn)}
        /* Главная кнопка темы — единственная залитая акцентом на всей доске. */
        className="primary-button card-serif rounded-[7px] px-2 py-2.5 text-center text-[16px]
          disabled:opacity-50"
      >
        {endTurn.kind === "pending" ? t("ui.actions.ending") : t("ui.actions.endTurn")}
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
  const { t } = useTranslation("game");
  const { options, blocked, pending } = resolveMany(context, "use_role_power", { power });
  const label = powerLabels[power] ?? power;
  const byDistrict = options.length > 0 && options[0].payload.district !== undefined;
  const single = options.length === 1 && options[0].payload.target_id === undefined && !byDistrict;
  const danger = /racket|sanction|scam|inflate|publish|inspection|seize|lock/.test(power);
  /* Тратит ли способность действие — говорит движок (`spends_action`), а описание и цена лежат
   * в одном словаре на все панели. Зашитые строки на всех подряд — «тратит действие» и «Раз в
   * ход, тратит действие. Крыша цели гасит эффект целиком» — делают бесплатное «Раздуть
   * историю» таким же дорогим на вид, как оплачиваемая «Публикация», а «Отобрать Крышу»,
   * которую Крыша как раз не гасит, обещают обратное. */
  const status = (game.role_powers ?? []).find(item => item.power === power);
  const spendsAction = status?.spends_action ?? true;
  const description = powerDescriptions[power];
  const costLabel = description?.cost ?? (spendsAction ? t("ui.actions.spendsAction") : t("ui.actions.noAction"));
  const blockedByRoof = status?.blocked_by_roof ?? true;

  if (single || options.length === 0) {
    const state = options[0]
      ? ({ kind: "ready", action: options[0] } as const)
      : pending
        ? ({ kind: "pending", action: context.pending as LegalAction } as const)
        : ({ kind: "blocked", reason: blocked ?? t("ui.actions.unavailable") } as const);
    return (
      <ActionButton
        label={label}
        cost={spendsAction ? t("ui.actions.spendsAction") : t("ui.actions.noAction")}
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
            <PopoverHeader title={label} subtitle={t("ui.actions.pickDistrict")} />
            <PopoverBody>
              <p className="mb-2">{t("ui.actions.dealText")}</p>
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
          cost={t("ui.actions.dealCost")}
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
          <PopoverHeader title={label} subtitle={t("ui.actions.pickTarget")} />
          <PopoverBody>
            <p className="mb-2">
              <ResourceText>{description?.what ?? t("ui.actions.powerDefault")}</ResourceText>
            </p>
            <p className="mb-2 text-[var(--color-badge)]"><ResourceText>{t("ui.actions.price", { cost: costLabel })}</ResourceText></p>
            <div className="grid gap-1">
              {options.map((action, position) => {
                const target = game.players.find(player => player.id === action.payload.target_id);
                const preview = findPreview(game, power, target?.id);
                const gain = previewGain(preview);
                const cost = previewCost(preview);
                return (
                  <ListItem
                    key={position}
                    icon="🎯"
                    title={target?.name ?? t("ui.actions.target")}
                    hint={
                      target ? (
                        <>
                          <span className="block"><ResourceText>{targetStats(target, preview, blockedByRoof)}</ResourceText></span>
                          {cost && <span className="block text-gold"><ResourceText>{cost}</ResourceText></span>}
                        </>
                      ) : undefined
                    }
                    right={
                      <span className="grid text-right">
                        {/* Добыча — крупно: ради неё цель и выбирают. Очки — под ней, мельче. */}
                        {gain && <span className="text-good"><ResourceText>{gain}</ResourceText></span>}
                        <span className="text-3xs font-normal text-ink-muted">
                          {t("ui.actions.pts", { count: scoreOf(game, target?.id) })}
                        </span>
                      </span>
                    }
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
          className={`grid min-w-0 gap-px rounded-md border bg-panel-2 px-[7px] py-[5px]
          hover:bg-panel-3 ${danger ? "border-bad/50 hover:border-bad" : "border-line hover:border-line-2"}`}
      >
        <b
          className={`overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-semibold ${
            danger ? "text-bad" : "text-ink"
          }`}
        >
          {label}
        </b>
        <small className="text-3xs text-ink-muted">
          {spendsAction ? t("ui.actions.targetPick") : t("ui.actions.targetPickFree")}
        </small>
      </button>
    </CardPopover>
  );
}
