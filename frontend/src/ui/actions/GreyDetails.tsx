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
  const spent = usedThisTurn(game, "grey_operation_used");
  const success = meta.scoring?.grey_success_scandals ?? 1;
  const failure = meta.scoring?.grey_failure_scandals ?? 2;

  return (
    <>
      <PopoverHeader title="🌒 Серые операции" subtitle={spent ? "уже проведена" : "одна за ход"} />
      <PopoverBody>
        <p className="mb-2">
          Операцию открывает любой ваш <strong>активный</strong> объект нужного района — роль не нужна,
          заблокированный объект не считается. Одна операция за ход, попытка тратится и при провале:
          успех даёт {success} скандал себе, провал — {failure}. Свои скандалы Крыша не гасит.
        </p>

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
                  hint={spent ? "операция в этом ходу уже была" : `нужен активный объект: ${gates}`}
                  right={`${chance}% · ${points}оч`}
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
                  right={`${chance}% · ${points}оч`}
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
