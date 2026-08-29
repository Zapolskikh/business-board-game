import { powerDescriptions, powerGateText, powerLabels, rolePerkRows } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { EffectList } from "../primitives/atoms";
import { findActions, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";

/* Возможности своей роли в одном месте: пассивные перки и активные способности.
 *
 * Раньше это было размазано: перки — внизу справочника ролей, активные способности —
 * кнопками в правой панели, и увидеть их вместе было негде. Причём пассивные перки
 * зависят от объектов, поэтому игрок не понимал, почему заявленный бонус не приходит.
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
  const me = context.me;
  const role = me.role ? index.roles.get(me.role) : undefined;
  const perks = rolePerkRows(game, meta);
  // Активные способности: движок присылает те, что доступны сейчас; каталог роли —
  // те, что есть у неё вообще. Показываем всё, доступность — по наличию действия.
  /* Список способностей, их цена и то, чего не хватает, приходят из движка: клиент держал
   * собственную копию каталога ролей, и в ней всё ещё числилась способность, удалённая в 1.12.0. */
  const statuses = game.role_powers ?? [];

  if (!role) {
    return (
      <>
        <PopoverHeader title="⚡ Возможности роли" subtitle="роли нет" />
        <PopoverBody>
          <p className="text-gold">
            У вас нет роли. Без роли один скандал снимается сам в начале хода, но пассивных
            доходов и активных способностей нет. Роль стоит <strong>{game.role_price}◆</strong> и
            берётся из справочника ролей.
          </p>
        </PopoverBody>
      </>
    );
  }

  return (
    <>
      <PopoverHeader title={`${role.icon} ${role.title}`} subtitle="возможности роли" />
      <PopoverBody>
        <p className="mb-2">{role.passive}</p>

        <p className="mb-1 font-medium text-ink">Пассивные перки</p>
        {perks.length > 0 ? (
          <>
            <EffectList
              lines={perks.map(perk => ({
                text: `${perk.label}: ${perk.text}`,
                active: !perk.locked,
              }))}
            />
            <p className="mb-2 text-2xs text-ink-dim">
              {perks.find(perk => perk.locked)?.hint ?? "Все перки работают на полную."}
            </p>
          </>
        ) : (
          <p className="mb-2 text-ink-dim">У этой роли нет пассивных перков.</p>
        )}

        <p className="mb-1 font-medium text-ink">Активные способности</p>
        {statuses.length > 0 ? (
          <div className="mb-2 grid gap-1.5">
            {statuses.map(status => {
              const options = findActions(context, "use_role_power", { power: status.power });
              const description = powerDescriptions[status.power];
              const unmet = status.gates.filter(gate => !gate.met);
              /* Одна кнопка — сразу применяем; несколько (выбор цели, района, карты) — только
               * рассказываем, где её нажимают: цель нарисована на своей карточке, и дублировать
               * её список ещё и здесь значит поддерживать два списка одного и того же. */
              const single = status.available && options.length === 1;
              return (
                <div
                  key={status.power}
                  data-on={status.available || undefined}
                  className="rounded-md border border-line bg-panel-2 px-2 py-1.5
                    data-[on]:border-[#2f7a4d]"
                >
                  <div className="flex items-baseline gap-1.5">
                    <b className="flex-1 text-xs font-semibold text-ink">
                      {powerLabels[status.power] ?? status.power}
                    </b>
                    <span
                      className={`rounded px-1 text-3xs font-semibold ${
                        status.spends_action
                          ? "bg-panel-3 text-ink-muted"
                          : "bg-[#1d3b2a] text-[#7fdaa6]"
                      }`}
                    >
                      {status.spends_action ? "⚡ действие" : "без действия"}
                    </span>
                  </div>

                  {description && (
                    <>
                      <p className="mt-0.5 text-2xs leading-snug text-ink-muted">{description.what}</p>
                      <p className="mt-0.5 text-2xs text-[var(--color-badge)]">Цена: {description.cost}</p>
                    </>
                  )}

                  {/* Почему нельзя — списком, а не одним «недоступна»: причин обычно несколько,
                    * и игрок должен видеть все, иначе чинит одну и упирается в следующую. */}
                  {!status.available && unmet.length > 0 && (
                    <ul className="mt-1 grid gap-0.5">
                      {unmet.map(gate => (
                        <li key={gate.key} className="text-2xs text-bad">
                          ✕ {powerGateText(gate, meta)}
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
                      {single ? "Применить" : `Доступна · выбор цели: ${options.length}`}
                    </button>
                  )}
                </div>
              );
            })}
            <p className="text-2xs text-ink-dim">
              Способности с выбором цели применяются там, где эта цель нарисована: по игрокам —
              кнопкой в правой панели, по картам рынка и проектам — прямо на самой карточке.
            </p>
          </div>
        ) : (
          <p className="text-ink-dim">У этой роли нет активных способностей.</p>
        )}
      </PopoverBody>
    </>
  );
}

