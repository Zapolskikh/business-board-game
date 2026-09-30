import { useTranslation } from "react-i18next";
import { forecastRows, influencePerPoint, moneyPerPoint } from "../../online/gameUi";
import type { CityMeta, GameState, PlayerState } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue } from "../primitives/atoms";
import { roofPrice, scandalLimit } from "../lib/board";

/** Счёт и доход. Обе таблицы считает движок — клиент печатает подписи. */
export function ScoreDetails({ game, me, meta }: { game: GameState; me: PlayerState; meta: CityMeta }) {
  const { t } = useTranslation("game");
  const score = game.score_breakdown?.[me.id];
  const forecast = game.round_forecast;

  return (
    <>
      <PopoverHeader title={t("ui.score.title")} subtitle={t("ui.score.points", { count: score?.total ?? 0 })} />
      <PopoverBody>
        {score && (
          <KeyValue
            rows={[
              [t("ui.score.projects"), score.projects],
              [t("ui.score.assets"), score.assets],
              [
                t("ui.score.money", { value: me.money }),
                t("ui.score.moneyRate", { points: score.money, rate: moneyPerPoint(meta) }),
              ],
              [
                t("ui.score.influence", { value: me.influence }),
                t("ui.score.influenceRate", { points: score.influence, rate: influencePerPoint(meta) }),
              ],
              [t("ui.score.role"), score.role],
              ...(score.bonus ? ([[t("ui.score.bonus"), score.bonus]] as [string, number][]) : []),
              [t("ui.score.scandals"), <span className="text-bad">{score.scandals}</span>],
              [t("ui.score.total"), <b className="text-points">{score.total}</b>],
            ]}
          />
        )}
        <p className="mb-2">
          {t("ui.score.leftover", { money: moneyPerPoint(meta), influence: influencePerPoint(meta) })}
        </p>

        {forecast && (
          <>
            <p className="mb-1 font-medium text-ink">{t("ui.score.income")}</p>
            {game.round_number >= game.max_rounds && <p className="mb-1 text-bad">{t("ui.score.lastRound")}</p>}
            <KeyValue
              rows={[
                ...forecastRows(forecast.money).map(
                  row => [row.label, `${row.value > 0 ? "+" : ""}${row.value}$`] as [string, string],
                ),
                ...forecastRows(forecast.influence).map(
                  row => [row.label, `${row.value > 0 ? "+" : ""}${row.value}◆`] as [string, string],
                ),
                [
                  t("ui.score.total"),
                  <b className="text-good">
                    +{forecast.money.total}$ +{forecast.influence.total}◆
                  </b>,
                ],
              ]}
            />
          </>
        )}
      </PopoverBody>
    </>
  );
}

/** Крыши и скандалы: два счётчика, у которых у каждой роли свой потолок. */
export function DefenceDetails({ game, me }: { game: GameState; me: PlayerState }) {
  const { t } = useTranslation("game");
  const limit = scandalLimit(me);
  return (
    <>
      <PopoverHeader title={t("ui.defence.title")} />
      <PopoverBody>
        <KeyValue
          rows={[
            [t("ui.defence.roofs"), t("ui.defence.ofLimit", { have: me.roofs, limit: me.roof_limit })],
            [t("ui.defence.scandals"), t("ui.defence.ofLimit", { have: me.scandals, limit })],
            [t("ui.defence.roofPrice"), `${roofPrice(game)}$`],
          ]}
        />
        <p className="mb-2">
          <strong>{t("ui.defence.roofStrong")}</strong>
          {t("ui.defence.roofText")}
        </p>
        <p>
          <strong>{t("ui.defence.scandalsStrong")}</strong>
          {t("ui.defence.scandalsText", { limit, jail: limit + 1 })}
        </p>
      </PopoverBody>
    </>
  );
}

/** Что тратит действие, а что нет, и что доступно раз в ход. */
export function ActionsDetails({ game }: { game: GameState }) {
  const { t } = useTranslation("game");
  return (
    <>
      <PopoverHeader title={t("ui.actionsInfo.title")} subtitle={t("ui.actionsInfo.left", { count: game.actions_left })} />
      <PopoverBody>
        <p className="mb-2">{t("ui.actionsInfo.base")}</p>
        <p className="mb-2">
          <strong className="text-good">{t("ui.actionsInfo.freeStrong")}</strong>
          {t("ui.actionsInfo.free")}
        </p>
        {/* Список ролевых способностей здесь не перечисляется: цена и лимит каждой приходят из
          * движка и печатаются на самой способности. Копия правила в другом месте — это копия,
          * которая разъезжается с движком. */}
        <p>
          <strong className="text-[var(--color-warning)]">{t("ui.actionsInfo.onceStrong")}</strong>
          {t("ui.actionsInfo.once")}
        </p>
      </PopoverBody>
    </>
  );
}
