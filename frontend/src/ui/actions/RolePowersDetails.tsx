import { useTranslation } from "react-i18next";
import { powerDescriptions, powerGateText, powerLabels, rolePerkRows } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { EffectList } from "../primitives/atoms";
import { findActions, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";
import { ResourceText } from "../primitives/ResourceIcon";

/* Возможности своей роли в одном месте: пассивные перки и активные способности.
 *
 * Разнесённые по экрану — перки внизу справочника ролей, способности кнопками в правой
 * панели — они нигде не видны вместе. Причём пассивные перки зависят от объектов, и без
 * этого списка игрок не понимает, почему заявленный бонус не приходит.
 *
 * Числа берутся из `game.role_perks` — их считает движок. Клиент ничего не пересчитывает.
 */
export function RolePowersDetails({
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
  const role = me.role ? index.roles.get(me.role) : undefined;
  const perks = rolePerkRows(game, meta);
  // Активные способности: движок присылает те, что доступны сейчас; каталог роли —
  // те, что есть у неё вообще. Показываем всё, доступность — по наличию действия.
  /* Список способностей, их цена и то, чего не хватает, приходят из движка: собственная
   * копия каталога ролей в клиенте расходится с ним и показывает несуществующие способности. */
  const statuses = game.role_powers ?? [];

  if (!role) {
    return (
      <>
        <PopoverHeader title={t("ui.powers.title")} subtitle={t("ui.powers.noRoleSubtitle")} />
        <PopoverBody>
          <p className="text-warning">
            {t("ui.powers.noRoleStart")}
            <strong><ResourceText>{`${game.role_price}◆`}</ResourceText></strong>
            {t("ui.powers.noRoleEnd")}
          </p>
        </PopoverBody>
      </>
    );
  }

  return (
    <>
      <PopoverHeader title={`${role.icon} ${role.title}`} subtitle={t("ui.powers.subtitle")} />
      <PopoverBody>
        <p className="mb-2"><ResourceText>{role.passive}</ResourceText></p>

        <p className="mb-1 font-medium text-ink">{t("ui.roles.passive")}</p>
        {perks.length > 0 ? (
          <>
            <EffectList
              lines={perks.map(perk => ({
                text: `${perk.label}: ${perk.text}`,
                active: !perk.locked,
              }))}
            />
            <p className="mb-2 text-2xs text-ink-dim">
              {perks.find(perk => perk.locked)?.hint ?? t("ui.powers.allPerks")}
            </p>
          </>
        ) : (
          <p className="mb-2 text-ink-dim">{t("ui.powers.noPerks")}</p>
        )}

        <p className="mb-1 font-medium text-ink">{t("ui.powers.active")}</p>
        {statuses.length > 0 ? (
          <div className="mb-2 grid gap-1.5">
            {statuses.map(status => {
              const options = findActions(context, "use_role_power", { power: status.power });
              const description = powerDescriptions[status.power];
              const unmet = status.gates.filter(gate => !gate.met);
              const single = status.available && options.length === 1;
              return (
                <div
                  key={status.power}
                  data-on={status.available || undefined}
                  className="rounded-md border border-line bg-panel-2 px-2 py-1.5
                    data-[on]:border-good"
                >
                  <div className="flex items-baseline gap-1.5">
                    <b className="flex-1 text-xs font-semibold text-ink">
                      {powerLabels[status.power] ?? status.power}
                    </b>
                    <span
                      className={`rounded px-1 text-3xs font-semibold ${
                        status.spends_action
                          ? "bg-panel-3 text-ink-muted"
                          : "bg-[#17231c] text-good"
                      }`}
                    >
                      {status.spends_action ? t("ui.powers.action") : t("ui.powers.noAction")}
                    </span>
                  </div>

                  {description && (
                    <>
                      <p className="mt-0.5 text-2xs leading-snug text-ink-muted"><ResourceText>{description.what}</ResourceText></p>
                      <p className="mt-0.5 text-2xs text-[var(--color-badge)]"><ResourceText>{t("ui.powers.price", { cost: description.cost })}</ResourceText></p>
                    </>
                  )}

                  {/* Почему нельзя — списком, а не одним «недоступна»: причин обычно несколько,
                    * и игрок должен видеть все, иначе чинит одну и упирается в следующую. */}
                  {!status.available && unmet.length > 0 && (
                    <ul className="mt-1 grid gap-0.5">
                      {unmet.map(gate => (
                        <li key={gate.key} className="text-2xs text-bad">
                          ✕ <ResourceText>{powerGateText(gate, meta)}</ResourceText>
                        </li>
                      ))}
                    </ul>
                  )}

                  {status.available && (
                    <button
                      type="button"
                      disabled={!single}
                      onClick={() => single && onAction(options[0])}
                      className="mt-1 w-full rounded border border-line bg-panel-3 px-2 py-1
                        text-2xs font-semibold text-ink enabled:hover:border-accent
                        disabled:cursor-default disabled:text-ink-muted"
                    >
                      {single ? t("ui.powers.apply") : t("ui.powers.choose", { count: options.length })}
                    </button>
                  )}
                </div>
              );
            })}
            <p className="text-2xs text-ink-dim">{t("ui.powers.where")}</p>
          </div>
        ) : (
          <p className="text-ink-dim">{t("ui.powers.noPowers")}</p>
        )}
      </PopoverBody>
    </>
  );
}

