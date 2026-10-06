import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";
import { rolePerkRows } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, RoleMeta } from "../../online/types";
import { findAction, turnBlock, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";
import { useIsMobile } from "../lib/layout";
import { tr } from "../../i18n";
import { ResourceText } from "../primitives/ResourceIcon";
import { useBlockedHint } from "../primitives/BlockedHint";
import { Modal } from "../primitives/Modal";

/* Роли — это справочник правил, а не ещё один плотный список кнопок.
 * Поэтому описание каждой роли всегда остаётся читаемым, даже когда сам захват недоступен:
 * состояние действия меняет только подпись и рамку, но не прозрачность текста.
 *
 * На телефоне шесть полных описаний подряд — это несколько экранов прокрутки ради одной кнопки.
 * Там окно сначала короткое: роли плитками, описание — по нажатию на роль, а работа своей роли —
 * всегда на виду. Полный справочник открывается отдельной кнопкой: он нужен, пока роли ещё не
 * выучены.
 */

type Props = {
  game: GameState;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
};

export function RolesDetails(props: Props) {
  const mobile = useIsMobile();
  const [all, setAll] = useState(false);
  if (mobile && !all) return <CompactRoles {...props} onShowAll={() => setAll(true)} />;
  return <FullRoles {...props} onBack={mobile ? () => setAll(false) : undefined} />;
}

/** Состояние роли для текущего игрока: одна функция на обе раскладки окна. */
function roleView(role: RoleMeta, { game, context }: Pick<Props, "game" | "context">) {
  const t = (key: string, options?: Record<string, unknown>) => tr("game", key, options);
  const me = context.me;
  const holder = game.players.find(player => player.role === role.id);
  const claim = findAction(context, "claim_role", { role_id: role.id });
  const mine = me.role === role.id;
  const price = holder ? game.role_price * 3 : game.role_price;
  const state = mine ? "mine" : holder ? "occupied" : "free";
  const status = mine ? t("ui.roles.mine") : holder ? t("ui.roles.holder", { name: holder.name }) : t("ui.roles.freeState");
  const actionHint = mine
    ? t("ui.roles.already")
    : claim
      ? holder
        ? t("ui.roles.take")
        : t("ui.roles.pick")
      : turnBlock(context) ?? (holder && holder.roofs > 0 ? t("ui.roles.protected") : t("ui.roles.unavailable"));
  return { holder, claim, mine, price, state, status, actionHint };
}

function RolesHeader({ game, meta, children }: { game: GameState; meta: CityMeta; children?: ReactNode }) {
  const { t } = useTranslation("game");
  const free = meta.roles.filter(role => !game.players.some(player => player.role === role.id)).length;
  return (
    <header className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 bg-panel-2 text-lg">
        🏷️
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[17px] font-extrabold leading-tight text-ink">{t("ui.roles.title")}</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">{t("ui.roles.free", { free, total: meta.roles.length })}</p>
      </div>
      {children}
    </header>
  );
}

function PriceNote({ game }: { game: GameState }) {
  const { t } = useTranslation("game");
  return (
    <section className="grid gap-1.5 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[12px] leading-[1.45] text-ink-muted min-[720px]:grid-cols-[1fr_auto] min-[720px]:items-center min-[720px]:gap-5">
      <p>
        {t("ui.roles.priceStart")}
        <strong className="text-influence"><ResourceText>{`${game.role_price}◆`}</ResourceText></strong>
        {t("ui.roles.priceMiddle")}
        <strong className="text-influence"><ResourceText>{`${game.role_price * 3}◆`}</ResourceText></strong>
        {t("ui.roles.priceEnd")}
      </p>
      <p className="text-warning min-[720px]:max-w-[330px]">
        {t("ui.roles.roofNote")}
      </p>
    </section>
  );
}

/** Что своя роль даёт прямо сейчас — или почему без роли хуже. */
function WorkingPerks({ game, meta, index, context }: Pick<Props, "game" | "meta" | "index" | "context">) {
  const { t } = useTranslation("game");
  const me = context.me;
  const perks = rolePerkRows(game, meta);
  if (!me.role) {
    return (
      <p className="rounded-lg border border-warning/50 bg-[#1b1510] px-3 py-2.5 text-[12px] font-semibold leading-[1.4] text-warning">
        {t("ui.roles.noRole")}
      </p>
    );
  }
  if (perks.length === 0) return null;
  return (
    <section data-ui="role-working" className="rounded-lg border border-good/60 bg-[#101a15] px-3 py-2.5">
      <h3 className="text-[13.5px] font-extrabold text-ink">
        {t("ui.roles.working", { role: index.roles.get(me.role)?.title ?? "" })}
      </h3>
      <div className="mt-2 grid gap-1.5 min-[680px]:grid-cols-2">
        {perks.map(perk => (
          <div key={perk.key} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-[11.5px] leading-[1.4]">
            <span className={perk.locked ? "text-ink-dim" : "text-good"}>{perk.locked ? "○" : "✓"}</span>
            <span>
              <b className={perk.locked ? "text-ink-muted" : "text-ink"}><ResourceText>{`${perk.label}: ${perk.text}`}</ResourceText></b>
              <small className="mt-0.5 block text-[10.5px] text-ink-dim">{perk.hint}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoleIcon({ role, size = "size-9 text-[17px]" }: { role: RoleMeta; size?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border ${size}`}
      style={{ borderColor: role.color, backgroundColor: `${role.color}16` }}
      aria-hidden="true"
    >
      {role.icon}
    </span>
  );
}

/* Полный справочник: все роли с описаниями. На ПК — единственный вид окна. */
function FullRoles({ game, meta, index, context, onAction, onBack }: Props & { onBack?: () => void }) {
  const { t } = useTranslation("game");
  const blocked = useBlockedHint();

  return (
    <div data-ui="roles-modal-content">
      <RolesHeader game={game} meta={meta}>
        {onBack && (
          <button
            type="button"
            data-ui="roles-back"
            onClick={onBack}
            className="mr-8 shrink-0 rounded-md border border-line bg-panel-2 px-3 py-1.5 text-[12px] text-ink hover:bg-panel-3"
          >
            {t("ui.roles.back")}
          </button>
        )}
      </RolesHeader>

      <div className="grid gap-3 px-4 py-3.5">
        <PriceNote game={game} />

        <div className="grid grid-cols-1 gap-2.5 min-[860px]:grid-cols-2">
          {meta.roles.map(role => {
            const { claim, mine, price, state, status, actionHint } = roleView(role, { game, context });

            return (
              <button
                key={role.id}
                type="button"
                data-ui="role-card"
                data-state={state}
                aria-disabled={!claim || undefined}
                onClick={event =>
                  claim ? onAction(claim) : blocked.show(mine ? undefined : actionHint, event.currentTarget)
                }
                title={!claim && !mine ? actionHint : undefined}
                style={{ borderLeftColor: role.color }}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-2 rounded-lg
                  border border-l-[3px] border-line bg-panel-2 p-3 text-left
                  data-[state=mine]:border-y-good data-[state=mine]:border-r-good data-[state=mine]:bg-[#101a15]
                  not-aria-disabled:cursor-pointer not-aria-disabled:hover:border-y-line-2 not-aria-disabled:hover:border-r-line-2
                  not-aria-disabled:hover:bg-panel-3 aria-disabled:cursor-default"
              >
                <RoleIcon role={role} />

                <span className="min-w-0">
                  <span className="flex min-w-0 items-start gap-2">
                    <strong className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight text-ink">
                      {role.title}
                    </strong>
                    {!mine && (
                      <span className="shrink-0 text-[13px] font-extrabold text-influence"><ResourceText>{`${price}◆`}</ResourceText></span>
                    )}
                  </span>
                  <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] leading-tight">
                    <span style={{ color: mine ? "var(--color-good)" : role.color }} className="font-bold">
                      {status}
                    </span>
                    <span className={claim ? "font-semibold text-ink" : "text-ink-dim"}>{actionHint}</span>
                  </span>
                </span>

                <RoleText role={role} />
              </button>
            );
          })}
        </div>

        <WorkingPerks game={game} meta={meta} index={index} context={context} />
      </div>
      {blocked.hint}
    </div>
  );
}

function RoleText({ role }: { role: RoleMeta }) {
  const { t } = useTranslation("game");
  return (
    <span className="col-span-2 grid gap-2 border-t border-line pt-2 text-[12px] leading-[1.48]">
      <span className="grid grid-cols-1 gap-1 min-[480px]:grid-cols-[82px_minmax(0,1fr)] min-[480px]:gap-2">
        <b className="text-ink-dim">{t("ui.roles.passive")}</b>
        <span className="text-ink-muted"><ResourceText>{role.passive}</ResourceText></span>
      </span>
      <span className="grid grid-cols-1 gap-1 min-[480px]:grid-cols-[82px_minmax(0,1fr)] min-[480px]:gap-2">
        <b className="text-ink-dim">{t("ui.roles.powers")}</b>
        <span className="text-ink-muted"><ResourceText>{role.power}</ResourceText></span>
      </span>
    </span>
  );
}

/* Короткий вид для телефона: плитки ролей, описание и выбор — в окне по нажатию на роль. */
function CompactRoles({ game, meta, index, context, onAction, onShowAll }: Props & { onShowAll: () => void }) {
  const { t } = useTranslation("game");
  const [picked, setPicked] = useState<string | null>(null);
  const blocked = useBlockedHint();
  const role = picked ? index.roles.get(picked) : undefined;
  const view = role ? roleView(role, { game, context }) : undefined;

  return (
    <div data-ui="roles-modal-content">
      <RolesHeader game={game} meta={meta}>
        <button
          type="button"
          data-ui="roles-show-all"
          onClick={onShowAll}
          className="mr-8 shrink-0 rounded-md border border-line-2 bg-panel-2 px-3 py-1.5 text-[12.5px] font-semibold
            text-ink hover:bg-panel-3"
        >
          📖 {t("ui.roles.showAll")}
        </button>
      </RolesHeader>

      <div className="grid gap-3 px-4 py-3.5">
        <div className="grid grid-cols-3 gap-2">
          {meta.roles.map(item => {
            const { mine, price, state, status } = roleView(item, { game, context });
            return (
              <button
                key={item.id}
                type="button"
                data-ui="role-tile"
                data-state={state}
                onClick={() => setPicked(item.id)}
                style={{ borderLeftColor: item.color }}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border
                  border-l-[3px] border-line bg-panel-2 px-3 py-2.5 text-left hover:bg-panel-3
                  data-[state=mine]:border-y-good data-[state=mine]:border-r-good data-[state=mine]:bg-[#101a15]"
              >
                <RoleIcon role={item} />
                <span className="min-w-0">
                  <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-extrabold leading-tight text-ink">
                    {item.title}
                  </strong>
                  <span
                    style={{ color: mine ? "var(--color-good)" : item.color }}
                    className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-bold"
                  >
                    {status}
                  </span>
                </span>
                {!mine && (
                  <span className="text-[13px] font-extrabold text-influence"><ResourceText>{`${price}◆`}</ResourceText></span>
                )}
              </button>
            );
          })}
        </div>

        <WorkingPerks game={game} meta={meta} index={index} context={context} />
      </div>

      <Modal
        open={Boolean(role && view)}
        onClose={() => setPicked(null)}
        title={role ? `${role.icon} ${role.title}` : ""}
        subtitle={view?.status}
        width={560}
        nested
        footer={
          view && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-[13px] hover:bg-panel-3"
              >
                {view.mine ? t("ui.common.close") : t("ui.common.cancel")}
              </button>
              {!view.mine && (
                <button
                  type="button"
                  data-ui="role-claim"
                  aria-disabled={!view.claim || undefined}
                  onClick={event => {
                    if (!view.claim) return blocked.show(view.actionHint, event.currentTarget);
                    onAction(view.claim);
                    setPicked(null);
                  }}
                  className="primary-button rounded-md px-3.5 py-1.5 text-[13px] font-semibold aria-disabled:opacity-50"
                >
                  <ResourceText>{t("ui.roles.claimFor", { price: view.price })}</ResourceText>
                </button>
              )}
            </div>
          )
        }
      >
        {role && view && (
          <div className="grid gap-2 text-[12.5px]">
            <RoleText role={role} />
            {!view.mine && (
              <p className={view.claim ? "font-semibold text-ink" : "text-warning"}>{view.actionHint}</p>
            )}
          </div>
        )}
        {blocked.hint}
      </Modal>
    </div>
  );
}
