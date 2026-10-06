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
} from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, PlayerState } from "../../online/types";
import { CardPopover, PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { ResourceIcon, ResourceText } from "../primitives/ResourceIcon";
import { statIcon } from "../assets/cards";
import { DetailsModal } from "../primitives/Modal";
import { ActionButton, DrawerRow, ListItem, Panel, sectionTitle, zoneRule, zoneStyle } from "../primitives/atoms";
import { findActions, resolve, resolveMany, usedThisTurn, type ActionContext } from "../lib/actions";
import { roofPrice, type Indexes } from "../lib/board";
import { findPreview, previewGain } from "../lib/powerPreview";
import { PowerResultTable, PowerTrigger } from "./PowerTargets";
import { RolesDetails } from "./RolesDetails";
import { RolePowersDetails } from "./RolePowersDetails";
import { GreyDetails } from "./GreyDetails";
import { useBlockedHint } from "../primitives/BlockedHint";

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
  endTurnButton = true,
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
  /** На телефоне «Завершить ход» стоит в нижней панели, под рукой большого пальца. */
  endTurnButton?: boolean;
}) {
  const { t } = useTranslation("game");
  const me = context.me;
  const tiers = campaignTiers(meta);
  const patron = patronage(meta);
  const lobby = lobbying(meta);
  /* Какой справочник открыт. Одно поле вместо трёх флагов: окно всё равно может
   * быть только одно, и состояние «открыты два» просто не выразимо. */
  const [drawer, setDrawer] = useState<"roles" | "powers" | "grey" | null>(null);
  const blocked = useBlockedHint();

  const work = resolve(context, "basic_action", { kind: "work" });
  const patronAction = resolve(context, "basic_action", { kind: "patronage" });
  const lobbyAction = resolve(context, "basic_action", { kind: "lobbying" });
  const roof = resolve(context, "buy_roof");
  const endTurn = resolve(context, "end_turn");

  // Антикризис: если у роли есть своя чистка — она дешевле, движок пришлёт именно её. Когда своя
  // чистка закрыта (у Мафиози нет объекта Администрации, не хватает 2◆ у Политика), а обычный PR
  // доступен — кнопка предлагает PR, как и обещает подсказка, а не висит серой.
  const rolePower = cleanupPowerFor(me.role);
  const roleCleanup = rolePower ? resolve(context, "use_role_power", { power: rolePower }) : undefined;
  const crisis = resolve(context, "crisis_pr");
  const useRole = roleCleanup !== undefined && (roleCleanup.kind !== "blocked" || crisis.kind === "blocked");
  const cleanupPower = useRole ? rolePower : undefined;
  const cleanup = useRole && roleCleanup ? roleCleanup : crisis;
  const cleanupInfo = cleanupOffer(cleanupPower, meta);

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
                className={`size-4 object-contain ${position < game.actions_left ? "" : "opacity-30 grayscale"}`}
              />
            ))}
          </span>
        </div>
      </Panel>

      <Panel>
        <div className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-dim">{t("ui.actions.basic")}</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <ActionButton
            label={t("ui.actions.work")}
            cost={<><span className="font-semibold text-money"><ResourceText>+2$</ResourceText></span>{t("ui.actions.workCost")}</>}
            state={work}
            tutorial="work"
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
                tutorial="campaign"
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
            tutorial="lobbying"
            spent={usedThisTurn(game, "lobbying")}
            onClick={() => act(lobbyAction)}
          />
          {/* «Антикризис» ничего не говорил о том, что делает кнопка. У ролевой чистки
            * своё название из каталога — оно точнее, его и оставляем. */}
          <ActionButton
            label={cleanupInfo.label}
            hint={cleanupInfo.tooltip}
            cost={
              <>
                {cleanupInfo.cost.money > 0 && (
                  <Need short={me.money < cleanupInfo.cost.money} tone="money">
                    <ResourceText>{`${cleanupInfo.cost.money}$`}</ResourceText>
                  </Need>
                )}
                {cleanupInfo.cost.money > 0 && cleanupInfo.cost.influence > 0 && " + "}
                {cleanupInfo.cost.influence > 0 && (
                  <Need short={me.influence < cleanupInfo.cost.influence} tone="influence">
                    <ResourceText>{`${cleanupInfo.cost.influence}◆`}</ResourceText>
                  </Need>
                )}
                {cleanupInfo.cost.money === 0 && cleanupInfo.cost.influence === 0 && t("cleanup.free")}
                {" → "}
                <ResourceText>{`−${cleanupInfo.cost.scandals}⚠`}</ResourceText>
              </>
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
            tutorial="roof"
            onClick={() => act(roof)}
          />
        </div>
      </Panel>

      {role && powers.length > 0 && (
        <Panel>
          <div className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-dim">
            {t("ui.actions.powers", { icon: role.icon, role: role.title })}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {powers.map(power => (
              <div key={power} data-tutorial={`power-${power}`} className="grid min-w-0">
                <PowerButton
                  power={power}
                  game={game}
                  districts={meta.districts}
                  context={context}
                  onAction={onAction}
                />
              </div>
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
        <div className="grid content-start gap-1.5 overflow-auto p-px">
          <DrawerRow
            icon="🏷️"
            data-tutorial="roles"
            title={t("ui.actions.roles")}
            hint={role ? t("ui.actions.rolesMine", { role: role.title, free: freeRoles }) : t("ui.actions.rolesNone", { price: game.role_price })}
            onClick={() => setDrawer("roles")}
          />

          <DrawerRow
            icon={<ResourceIcon name="actions" size="22px" />}
            title={t("ui.actions.rolePowers")}
            hint={role ? t("ui.actions.rolePowersHint") : t("ui.actions.rolePowersNone")}
            onClick={() => setDrawer("powers")}
          />

          <DrawerRow
            icon="🌒"
            data-tutorial="grey"
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
      <DetailsModal open={drawer === "grey"} onClose={() => setDrawer(null)} label={t("ui.actions.grey")} width={1120}>
        <GreyDetails game={game} meta={meta} index={index} context={context} onAction={onAction} />
      </DetailsModal>

      {beforeEndTurn}

      {endTurnButton && <button
        type="button"
        aria-disabled={endTurn.kind !== "ready" || undefined}
        data-tutorial="end-turn"
        onClick={event =>
          endTurn.kind === "ready"
            ? act(endTurn)
            : blocked.show(endTurn.kind === "blocked" ? endTurn.reason : undefined, event.currentTarget)
        }
        /* Главная кнопка темы — единственная залитая акцентом на всей доске. */
        className="primary-button card-serif rounded-[7px] px-2 py-2.5 text-center text-[16px]
          aria-disabled:opacity-50"
      >
        {endTurn.kind === "pending" ? t("ui.actions.ending") : t("ui.actions.endTurn")}
      </button>}
      {blocked.hint}
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

  // Недоступна: обычная кнопка с причиной в подсказке — открывать нечего.
  if (options.length === 0) {
    const state = pending
      ? ({ kind: "pending", action: context.pending as LegalAction } as const)
      : ({ kind: "blocked", reason: blocked ?? t("ui.actions.unavailable") } as const);
    return (
      <ActionButton
        label={label}
        cost={spendsAction ? t("ui.actions.spendsAction") : t("ui.actions.noAction")}
        tone={danger ? "danger" : "plain"}
        state={state}
        onClick={() => undefined}
      />
    );
  }

  /* Без цели (проверка Силовика, крипто-схема): цели выбирает правило, поэтому окно сначала
   * показывает, кого и как заденет, и только кнопка «Подтвердить» тратит действие. Раньше
   * способность срабатывала с первого клика, и что она сделает, можно было узнать только из лога. */
  if (single) {
    const reached = game.players
      .filter(player => player.id !== context.me.id)
      .filter(player => {
        const preview = findPreview(game, power, player.id);
        return Boolean(preview && previewGain(preview));
      })
      .map(target => ({ target }));
    return (
      <CardPopover
        side="left"
        width={reached.length ? 460 : 340}
        content={
          <>
            <PopoverHeader title={label} subtitle={t("ui.preview.confirmTitle")} />
            <PopoverBody>
              <p className="mb-2">
                <ResourceText>{description?.what ?? t("ui.actions.powerDefault")}</ResourceText>
              </p>
              <p className="mb-2 text-[var(--color-badge)]"><ResourceText>{t("ui.actions.price", { cost: costLabel })}</ResourceText></p>
              {reached.length > 0 && (
                <div className="mb-2">
                  <PowerResultTable game={game} power={power} rows={reached} blockedByRoof={blockedByRoof} />
                </div>
              )}
              <button
                type="button"
                data-ui="power-confirm"
                onClick={() => onAction(options[0])}
                className={`w-full rounded-md border px-2 py-1.5 font-semibold ${
                  danger ? "border-bad/60 text-bad hover:bg-bad/10" : "border-accent text-ink hover:bg-panel-3"
                }`}
              >
                {t("ui.preview.confirm")}
              </button>
            </PopoverBody>
          </>
        }
      >
        <PowerTrigger
          label={label}
          danger={danger}
          hint={spendsAction ? t("ui.actions.spendsAction") : t("ui.actions.noAction")}
        />
      </CardPopover>
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
        <PowerTrigger label={label} hint={t("ui.actions.dealCost")} />
      </CardPopover>
    );
  }

  const rows = options
    .map(action => ({ action, target: game.players.find(player => player.id === action.payload.target_id) }))
    .filter((row): row is { action: LegalAction; target: PlayerState } => Boolean(row.target));

  return (
    <CardPopover
      side="left"
      width={460}
      content={
        <>
          <PopoverHeader title={label} subtitle={t("ui.actions.pickTarget")} />
          <PopoverBody>
            <p className="mb-2">
              <ResourceText>{description?.what ?? t("ui.actions.powerDefault")}</ResourceText>
            </p>
            <p className="mb-2 text-[var(--color-badge)]"><ResourceText>{t("ui.actions.price", { cost: costLabel })}</ResourceText></p>
            <PowerResultTable game={game} power={power} rows={rows} blockedByRoof={blockedByRoof} onPick={onAction} />
          </PopoverBody>
        </>
      }
    >
      <PowerTrigger
        label={label}
        danger={danger}
        hint={spendsAction ? t("ui.actions.targetPick") : t("ui.actions.targetPickFree")}
      />
    </CardPopover>
  );
}
