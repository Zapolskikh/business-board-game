import { rolePerkRows } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { EffectList, ListItem } from "../primitives/atoms";
import { findAction, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";

/* Роли. Цену захвата (обычную и тройную) считает движок и присылает вариантом действия —
 * клиент печатает `game.role_price` только как подпись, а доступность берёт из legal_actions.
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
  const me = context.me;
  const perks = rolePerkRows(game, meta);
  const free = meta.roles.filter(role => !game.players.some(player => player.role === role.id)).length;

  return (
    <>
      <PopoverHeader title="🏷️ Роли" subtitle={`свободно ${free} из ${meta.roles.length}`} />
      <PopoverBody>
        <p className="mb-2">
          Роль стоит <strong>{game.role_price}◆</strong>, переворот занятой — <strong>{game.role_price * 3}◆</strong>.
          Смена роли тратит действие. Крыша владельца может отбить попытку захвата.
        </p>

        <div className="mb-2 grid gap-1">
          {meta.roles.map(role => {
            const holder = game.players.find(player => player.role === role.id);
            const claim = findAction(context, "claim_role", { role_id: role.id });
            const mine = me.role === role.id;
            const price = holder ? game.role_price * 3 : game.role_price;
            return (
              <ListItem
                key={role.id}
                icon={<span style={{ color: role.color }}>{role.icon}</span>}
                title={mine ? `${role.title} · ваша` : role.title}
                hint={
                  mine
                    ? role.passive
                    : holder
                      ? `занята: ${holder.name} · ${role.passive}`
                      : role.passive
                }
                right={mine ? "—" : `${price}◆`}
                disabled={!claim}
                onClick={() => claim && onAction(claim)}
              />
            );
          })}
        </div>

        {me.role && perks.length > 0 && (
          <>
            <p className="mb-1 font-medium text-ink">
              Перки роли {index.roles.get(me.role)?.title}
            </p>
            <EffectList
              lines={perks.map(perk => ({
                text: `${perk.label}: ${perk.text}`,
                active: !perk.locked,
              }))}
            />
            <p className="text-2xs text-ink-dim">
              {perks.find(perk => perk.locked)?.hint ?? "Все перки работают на полную."}
            </p>
          </>
        )}

        {!me.role && (
          <p className="text-gold">
            У вас нет роли. Без роли один скандал снимается сам в начале хода, но пассивных доходов нет.
          </p>
        )}
      </PopoverBody>
    </>
  );
}
