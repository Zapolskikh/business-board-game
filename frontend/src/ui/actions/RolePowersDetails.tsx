import { powerLabels, rolePerkRows } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { EffectList, ListItem } from "../primitives/atoms";
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
  const available = new Set(
    findActions(context, "use_role_power").map(action => String(action.payload.power)),
  );
  const all = [...new Set([...available, ...(role ? rolePowerIds(role.id) : [])])];

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
        {all.length > 0 ? (
          <div className="mb-2 grid gap-1">
            {all.map(power => {
              const options = findActions(context, "use_role_power", { power });
              const ready = options.length > 0;
              return (
                <ListItem
                  key={power}
                  icon="⚡"
                  title={powerLabels[power] ?? power}
                  hint={ready ? "тратит действие · раз в ход" : "сейчас недоступна"}
                  right={ready ? "применить" : "—"}
                  disabled={!ready || options.length > 1}
                  onClick={() => options.length === 1 && onAction(options[0])}
                />
              );
            })}
            <p className="text-2xs text-ink-dim">
              Способности с выбором цели применяются кнопкой в правой панели: там виден список
              игроков и их Крыши.
            </p>
          </div>
        ) : (
          <p className="text-ink-dim">У этой роли нет активных способностей.</p>
        )}
      </PopoverBody>
    </>
  );
}

/* Каталог способностей по ролям. Дублирует движок, поэтому используется только для того,
 * чтобы показать недоступную сейчас способность серой строкой, — применить её всё равно
 * можно лишь через legal_actions. Расхождение здесь не сломает правила, максимум покажет
 * лишний пункт в справке. */
function rolePowerIds(role: string): string[] {
  switch (role) {
    case "politician":
      return ["politician_cleanup"];
    case "journalist":
      return ["journalist_inflate", "journalist_publish"];
    case "mafia":
      return ["mafia_racket", "mafia_cleanup"];
    case "military":
      return ["military_sanction"];
    case "fraudster":
      return ["fraudster_cleanup", "fraudster_crypto_scam"];
    default:
      return [];
  }
}
