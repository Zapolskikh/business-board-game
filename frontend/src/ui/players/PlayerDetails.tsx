import { useTranslation } from "react-i18next";
import { assetPoints, greyOperationLabels, powerLabels } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, PlayerState } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue, ListItem } from "../primitives/atoms";
import { findActions, type ActionContext } from "../lib/actions";
import { scandalLimit, turnPosition, type Indexes } from "../lib/board";
import { findPreview, previewCost, previewGain } from "../lib/powerPreview";
import { ResourceText } from "../primitives/ResourceIcon";
import { statIcon } from "../assets/cards";

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
  const { t } = useTranslation("game");
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
            ? t("ui.players.powerFree")
            : t("ui.players.powerAction"),
        })),
        ...findActions(context, "grey_operation", { target_id: player.id }).map(action => ({
          action,
          label: greyOperationLabels[String(action.payload.asset_id)] ?? String(action.payload.asset_id),
          hint: t("ui.players.greyHint"),
        })),
        ...findActions(context, "play_action_card", { target_id: player.id }).map(action => ({
          action,
          label: index.cards.get(
            context.me.hand?.find(card => card.uid === action.payload.card_uid)?.card_id ?? "",
          )?.title ?? t("ui.players.card"),
          // Лимит стоит на покупке, а не на розыгрыше: руку можно тратить как угодно быстро.
          hint: t("ui.players.cardHint"),
        })),
      ];

  return (
    <>
      <PopoverHeader
        title={`${role?.icon ?? "👤"} ${player.name}`}
        subtitle={role?.title ?? t("ui.players.noRole")}
      />
      <PopoverBody>
        <KeyValue
          rows={[
            [t("ui.players.score"), <span className="flex items-center gap-1 text-points"><img src={statIcon("score")} alt="" className="size-4" />{t("ui.players.scoreValue", { count: score?.total ?? 0 })}</span>],
            [
              t("ui.players.resources"),
              <span><span className="text-money"><ResourceText>{`${player.money}$`}</ResourceText></span>{" · "}<span className="text-influence"><ResourceText>{`${player.influence}◆`}</ResourceText></span></span>,
            ],
            [
              t("ui.players.scandals"),
              <span className={player.scandals >= scandalLimit(player) - 1 ? "text-[var(--color-warning)]" : undefined}>
                <ResourceText>{`${player.scandals}⚠ / ${scandalLimit(player)}⚠`}</ResourceText>
                {player.role && player.scandals >= scandalLimit(player) - 1 && t("ui.players.roleRisk")}
              </span>,
            ],
            [
              t("ui.players.roofs"),
              <span className={player.roofs > 0 ? "text-defence" : "text-ink-muted"}>
                <ResourceText>{player.roofs > 0
                  ? t("ui.players.roofsOn", { have: player.roofs, limit: player.roof_limit })
                  : t("ui.players.roofsOff", { limit: player.roof_limit })}</ResourceText>
              </span>,
            ],
            [t("ui.players.order"), position >= 0 ? t("ui.players.orderValue", { position: position + 1 }) : "—"],
            ...(player.is_bot
              ? ([[t("ui.players.bot"), t(`common:difficulty.${player.difficulty}`, { defaultValue: player.difficulty })]] as [string, string][])
              : []),
            ...(player.jail_turns > 0
              ? ([[t("ui.players.jailRow"), t("ui.players.jailValue")]] as [string, string][])
              : []),
          ]}
        />

        {/* Стол соперника целиком, вместе с пустыми слотами: по одному списку купленного
          * не видно, упёрся ли он в вместимость — а это решает, стоит ли его вообще душить. */}
        <p className="mb-1 font-medium text-ink">
          {t("ui.players.table", { used: player.assets.length, capacity: player.capacity })}
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
                  <span className="text-money"><ResourceText>{t("ui.players.perRound", { value: asset?.income ?? 0 })}</ResourceText></span>
                  {" · "}
                  <span className="text-points">{t("ui.players.pts", { count: asset ? assetPoints(asset) : 0 })}</span>
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
                {t("ui.players.freeSlot")}
              </div>
            ),
          )}
        </div>

        {player.projects.length > 0 && (
          <>
            <p className="mb-1 font-medium text-ink">{t("ui.players.projects")}</p>
            <ul className="mb-2 grid gap-0.5">
              {player.projects.map(projectId => {
                const project = meta.projects.find(item => item.id === projectId);
                return (
                  <li key={projectId} className="flex items-baseline gap-1.5">
                    <span className="text-ink">{project?.title ?? projectId}</span>
                    <span className="ml-auto text-points">{t("ui.players.pts", { count: project?.points ?? 0 })}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {role && <p className="mb-2 text-ink-muted"><ResourceText>{role.passive}</ResourceText></p>}

        {targeted.length > 0 && (
          <>
            <p className="mb-1 font-medium text-ink">{t("ui.players.target")}</p>
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
                        {cost && <span className="block text-gold"><ResourceText>{cost}</ResourceText></span>}
                      </>
                    }
                    right={gain ? <span className="text-good"><ResourceText>{gain}</ResourceText></span> : undefined}
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
