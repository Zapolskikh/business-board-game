import { useTranslation } from "react-i18next";
import { rolePerkRows } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { findAction, turnBlock, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";
import { ResourceText } from "../primitives/ResourceIcon";

/* Роли — это справочник правил, а не ещё один плотный список кнопок.
 * Поэтому описание каждой роли всегда остаётся читаемым, даже когда сам захват недоступен:
 * состояние действия меняет только подпись и рамку, но не прозрачность текста.
 */
export function RolesDetails({
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
  const { t } = useTranslation("game");
  const me = context.me;
  const perks = rolePerkRows(game, meta);
  const free = meta.roles.filter(role => !game.players.some(player => player.role === role.id)).length;
  const turnBlocked = turnBlock(context);

  return (
    <div data-ui="roles-modal-content">
      <header className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 bg-panel-2 text-lg">
          🏷️
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-extrabold leading-tight text-ink">{t("ui.roles.title")}</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">{t("ui.roles.free", { free, total: meta.roles.length })}</p>
        </div>
      </header>

      <div className="grid gap-3 px-4 py-3.5">
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

        <div className="grid grid-cols-1 gap-2.5 min-[860px]:grid-cols-2">
          {meta.roles.map(role => {
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
                : turnBlocked ?? t("ui.roles.unavailable");

            return (
              <button
                key={role.id}
                type="button"
                data-ui="role-card"
                data-state={state}
                disabled={!claim}
                onClick={() => claim && onAction(claim)}
                title={!claim && !mine ? actionHint : undefined}
                style={{ borderLeftColor: role.color }}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-2 rounded-lg
                  border border-l-[3px] border-line bg-panel-2 p-3 text-left
                  data-[state=mine]:border-y-good data-[state=mine]:border-r-good data-[state=mine]:bg-[#101a15]
                  enabled:cursor-pointer enabled:hover:border-y-line-2 enabled:hover:border-r-line-2 enabled:hover:bg-panel-3
                  disabled:cursor-default"
              >
                <span
                  className="grid size-9 place-items-center rounded-full border text-[17px]"
                  style={{ borderColor: role.color, backgroundColor: `${role.color}16` }}
                  aria-hidden="true"
                >
                  {role.icon}
                </span>

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
              </button>
            );
          })}
        </div>

        {me.role && perks.length > 0 && (
          <section className="rounded-lg border border-good/60 bg-[#101a15] px-3 py-2.5">
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
        )}

        {!me.role && (
          <p className="rounded-lg border border-warning/50 bg-[#1b1510] px-3 py-2.5 text-[12px] font-semibold leading-[1.4] text-warning">
            {t("ui.roles.noRole")}
          </p>
        )}
      </div>
    </div>
  );
}
