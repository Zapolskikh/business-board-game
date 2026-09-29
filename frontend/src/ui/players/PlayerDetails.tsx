import { assetPoints, greyOperationLabels, powerLabels } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, PlayerState } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue, ListItem } from "../primitives/atoms";
import { findActions, type ActionContext } from "../lib/actions";
import { scandalLimit, turnPosition, type Indexes } from "../lib/board";
import { findPreview, previewCost, previewGain } from "../lib/powerPreview";

/* Карточка игрока в поповере: его город и всё, что можно с ним сделать.
 *
 * Направленные действия собираются из legal_actions по target_id — это единственный
 * способ узнать, кого движок разрешает атаковать (у санкции силовика, например, есть
 * порог по скандалам цели, и клиент его не воспроизводит).
 */
export function PlayerDetails({
  player,
  game,
  meta,
  index,
  context,
  onAction,
}: {
  player: PlayerState;
  game: GameState;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
}) {
  const role = player.role ? index.roles.get(player.role) : undefined;
  const score = game.score_breakdown?.[player.id];
  const mine = player.id === context.me.id;
  const position = turnPosition(game, player.id);

  const targeted: { action: LegalAction; label: string; hint: string; power?: string }[] = mine
    ? []
    : [
        /* Тратит ли способность действие, знает движок: у Журналиста «Раздуть историю» не
         * тратит, и это её единственное преимущество перед «Публикацией». Обе строки печатали
         * «тратит действие». */
        ...findActions(context, "use_role_power", { target_id: player.id }).map(action => ({
          action,
          power: String(action.payload.power),
          label: powerLabels[String(action.payload.power)] ?? String(action.payload.power),
          hint: (game.role_powers ?? []).find(item => item.power === action.payload.power)
            ?.spends_action === false
            ? "Способность роли · без действия"
            : "Способность роли · тратит действие",
        })),
        ...findActions(context, "grey_operation", { target_id: player.id }).map(action => ({
          action,
          label: greyOperationLabels[String(action.payload.asset_id)] ?? String(action.payload.asset_id),
          hint: "Серая операция · одна за ход",
        })),
        ...findActions(context, "play_action_card", { target_id: player.id }).map(action => ({
          action,
          label: index.cards.get(
            context.me.hand?.find(card => card.uid === action.payload.card_uid)?.card_id ?? "",
          )?.title ?? "Карта",
          // Лимит стоит на покупке, а не на розыгрыше: руку можно тратить как угодно быстро.
          hint: "Карта · бесплатно, без лимита за ход",
        })),
      ];

  return (
    <>
      <PopoverHeader
        title={`${role?.icon ?? "👤"} ${player.name}`}
        subtitle={role?.title ?? "Без роли"}
      />
      <PopoverBody>
        <KeyValue
          rows={[
            ["Счёт", <span className="text-points">★ {score?.total ?? 0} очков</span>],
            [
              "Ресурсы",
              <span><span className="text-money">● {player.money}$</span>{" · "}<span className="text-influence">◆ {player.influence}</span></span>,
            ],
            [
              "Скандалы",
              <span className={player.scandals >= scandalLimit(player) - 1 ? "text-[var(--color-warning)]" : undefined}>
                {player.scandals} / {scandalLimit(player)}
                {player.role && player.scandals >= scandalLimit(player) - 1 && " — ещё один, и роль потеряна"}
              </span>,
            ],
            [
              "Крыши",
              <span className={player.roofs > 0 ? "text-defence" : "text-ink-muted"}>
                {player.roofs > 0
                  ? `${player.roofs} из ${player.roof_limit} — направленный эффект будет погашен`
                  : `0 из ${player.roof_limit} — не защищён`}
              </span>,
            ],
            ["Очередь хода", position >= 0 ? `${position + 1}-й в этом раунде` : "—"],
            ...(player.is_bot ? ([["Бот", player.difficulty]] as [string, string][]) : []),
            ...(player.jail_turns > 0
              ? ([["Тюрьма", `пропускает ходов ${player.jail_turns}`]] as [string, string][])
              : []),
          ]}
        />

        {/* Стол соперника целиком, вместе с пустыми слотами: по одному списку купленного
          * не видно, упёрся ли он в вместимость — а это решает, стоит ли его вообще душить. */}
        <p className="mb-1 font-medium text-ink">
          Стол: {player.assets.length} из {player.capacity}
        </p>
        <div className="mb-2 grid grid-cols-2 gap-1">
          {player.assets.map(owned => {
            const asset = index.assets.get(owned.card_id);
            const district = asset ? index.districts.get(asset.district) : undefined;
            return (
              <div
                key={owned.uid}
                style={{ borderLeftColor: district?.color }}
                className="grid gap-px rounded-md border border-line border-l-[3px] bg-panel-2 px-1.5 py-1"
              >
                <b className="flex items-baseline gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-ink">
                  <span style={{ color: district?.color }}>{district?.icon}</span>
                  {asset?.title ?? owned.card_id}
                </b>
                <small className="text-3xs text-ink-dim">
                  <span className="text-money">+{asset?.income ?? 0}$/р</span>
                  {" · "}
                  <span className="text-points">{asset ? assetPoints(asset) : 0} очк</span>
                </small>
              </div>
            );
          })}
          {Array.from({ length: Math.max(0, player.capacity - player.assets.length) }).map(
            (_, slot) => (
              <div
                key={`slot-${slot}`}
                className="grid min-h-[34px] place-content-center rounded-md border border-dashed
                  border-line bg-surface text-3xs text-ink-dim"
              >
                свободный слот
              </div>
            ),
          )}
        </div>

        {player.projects.length > 0 && (
          <>
            <p className="mb-1 font-medium text-ink">Проекты</p>
            <ul className="mb-2 grid gap-0.5">
              {player.projects.map(projectId => {
                const project = meta.projects.find(item => item.id === projectId);
                return (
                  <li key={projectId} className="flex items-baseline gap-1.5">
                    <span className="text-ink">{project?.title ?? projectId}</span>
                    <span className="ml-auto text-points">{project?.points ?? 0} очк</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {role && <p className="mb-2 text-ink-muted">{role.passive}</p>}

        {targeted.length > 0 && (
          <>
            <p className="mb-1 font-medium text-ink">Направить на этого игрока</p>
            <div className="grid gap-1">
              {targeted.map((item, itemIndex) => {
                const preview = item.power ? findPreview(game, item.power, player.id) : undefined;
                const gain = previewGain(preview);
                const cost = previewCost(preview);
                return (
                  <ListItem
                    key={`${item.label}-${itemIndex}`}
                    icon="🎯"
                    title={item.label}
                    hint={
                      <>
                        <span className="block">{item.hint}</span>
                        {cost && <span className="block text-gold">{cost}</span>}
                      </>
                    }
                    right={gain ? <span className="text-good">{gain}</span> : undefined}
                    onClick={() => onAction(item.action)}
                  />
                );
              })}
            </div>
          </>
        )}
      </PopoverBody>
    </>
  );
}
