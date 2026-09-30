import { useTranslation } from "react-i18next";
import {
  greyOperationDistricts,
  greyOperationInfo,
  greyOperationLabels,
  greyOperationPoints,
} from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { ListItem } from "../primitives/atoms";
import { findActions, usedThisTurn, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";

/* Серые операции. Шанс берётся из /meta (scoring.grey_operation_chance), а не из копии
 * таблицы в клиенте: движок уже присылает и шансы, и очки, и базы формул.
 */
export function GreyDetails({
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
  const spent = usedThisTurn(game, "grey_operation_used");
  const success = meta.scoring?.grey_success_scandals ?? 1;
  const failure = meta.scoring?.grey_failure_scandals ?? 2;

  return (
    <>
      <PopoverHeader title={t("ui.grey.title")} subtitle={spent ? t("ui.grey.spent") : t("ui.grey.once")} />
      <PopoverBody>
        <p className="mb-2">{t("ui.grey.intro", { success, failure })}</p>

        <div className="grid gap-1">
          {Object.entries(greyOperationLabels).map(([operationId, label]) => {
            const options = findActions(context, "grey_operation", { asset_id: operationId });
            const info = greyOperationInfo[operationId];
            // Шанс из движка; hardcoded значение в gameUi — только запасное.
            const chance = Math.round(
              (meta.scoring?.grey_operation_chance?.[operationId] ?? info.chance / 100) * 100,
            );
            const points = greyOperationPoints(meta, operationId);
            const gates = (greyOperationDistricts[operationId] ?? [])
              .map(id => index.districts.get(id)?.title ?? id)
              .join(" / ");

            if (options.length === 0) {
              return (
                <ListItem
                  key={operationId}
                  icon="🌒"
                  title={label}
                  hint={spent ? t("ui.grey.spentHint") : t("ui.grey.needHint", { districts: gates })}
                  right={t("ui.grey.chance", { chance, points })}
                  disabled
                />
              );
            }

            // Операции с целью приходят по варианту на игрока — раскрываем их списком.
            return options.map((action, position) => {
              const targetId = action.payload.target_id as string | undefined;
              const target = targetId ? game.players.find(player => player.id === targetId) : undefined;
              return (
                <ListItem
                  key={`${operationId}-${position}`}
                  icon="🌒"
                  title={target ? `${label} → ${target.name}` : label}
                  hint={info.effect(game.round_number, meta)}
                  right={t("ui.grey.chance", { chance, points })}
                  onClick={() => onAction(action)}
                />
              );
            });
          })}
        </div>
      </PopoverBody>
    </>
  );
}
