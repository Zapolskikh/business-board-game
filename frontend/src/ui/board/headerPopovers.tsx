import { forecastRows, influencePerPoint, moneyPerPoint } from "../../online/gameUi";
import type { CityMeta, GameState, PlayerState } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue } from "../primitives/atoms";
import { roofPrice, scandalLimit } from "../lib/board";

const forecastLabels: Record<string, string> = {
  objects: "Объекты",
  projects: "Проекты",
  residents_tax: "Синергия районов",
  journalist: "Рейтинг журналиста",
  debt: "Долг",
  administrative: "Административные объекты",
  synergy: "Синергия",
  news: "Новости",
  rating: "Рейтинг",
};

/** Счёт и доход. Обе таблицы считает движок — клиент печатает подписи. */
export function ScoreDetails({ game, me, meta }: { game: GameState; me: PlayerState; meta: CityMeta }) {
  const score = game.score_breakdown?.[me.id];
  const forecast = game.round_forecast;

  return (
    <>
      <PopoverHeader title="🏆 Счёт и доход" subtitle={`${score?.total ?? 0} очков`} />
      <PopoverBody>
        {score && (
          <KeyValue
            rows={[
              ["Проекты", score.projects],
              ["Объекты", score.assets],
              [`Деньги ${me.money}$`, `${score.money} · ${moneyPerPoint(meta)}$ за очко`],
              [`Влияние ${me.influence}◆`, `${score.influence} · ${influencePerPoint(meta)}◆ за очко`],
              ["Роль", score.role],
              ...(score.bonus ? ([["Карты на очки", score.bonus]] as [string, number][]) : []),
              ["Скандалы", <span className="text-bad">{score.scandals}</span>],
              ["Итого", <b className="text-gold">{score.total}</b>],
            ]}
          />
        )}
        <p className="mb-2">
          Деньги и влияние — топливо, а не счёт: лежащие они дают очко за {moneyPerPoint(meta)}$, а через
          патронаж и лоббирование — заметно дешевле. Копить их до конца партии невыгодно.
        </p>

        {forecast && (
          <>
            <p className="mb-1 font-medium text-ink">Доход в конце раунда</p>
            {game.round_number >= game.max_rounds && (
              <p className="mb-1 text-bad">
                Последний раунд: выплаты в конце него не будет — тратьте деньги и влияние сейчас.
              </p>
            )}
            <KeyValue
              rows={[
                ...forecastRows(forecast.money).map(
                  row => [forecastLabels[row.key] ?? row.key, `${row.value > 0 ? "+" : ""}${row.value}$`] as [string, string],
                ),
                ...forecastRows(forecast.influence).map(
                  row => [forecastLabels[row.key] ?? row.key, `${row.value > 0 ? "+" : ""}${row.value}◆`] as [string, string],
                ),
                [
                  "Итого",
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
  const limit = scandalLimit(me);
  return (
    <>
      <PopoverHeader title="🛡 Защита и репутация" />
      <PopoverBody>
        <KeyValue
          rows={[
            ["Крыши", `${me.roofs} из ${me.roof_limit}`],
            ["Скандалы", `${me.scandals} из ${limit}`],
            ["Цена Крыши", `${roofPrice(game)}$`],
          ]}
        />
        <p className="mb-2">
          <strong>Крыша</strong> — единственная защита в игре. Гасит целиком любой направленный на вас
          эффект: карту, рэкет, санкцию, взлом, попытку отобрать роль и любое начисление скандалов.
          Тратится. Последствия ваших собственных решений — например провал серой операции — она не
          отменяет.
        </p>
        <p>
          <strong>Скандалы:</strong> на {limit}-м роль теряется, на {limit + 1}-м — арест. Снять можно
          Антикризисом. Без роли один скандал уходит сам в начале хода.
        </p>
      </PopoverBody>
    </>
  );
}

/** Что тратит действие, а что нет, и что доступно раз в ход. */
export function ActionsDetails({ game }: { game: GameState }) {
  return (
    <>
      <PopoverHeader title="⚡ Действия" subtitle={`осталось ${game.actions_left}`} />
      <PopoverBody>
        <p className="mb-2">
          В ходу три действия. Неиспользованные сгорают, кроме одного переносимого.
        </p>
        <p className="mb-2">
          <strong className="text-good">Не тратят действие:</strong> продажа объекта, розыгрыш и
          сброс карт, а ещё три ролевые способности — у каждой это написано на ней самой, в
          «Возможностях роли».
        </p>
        {/* Список ролевых способностей здесь не перечисляется: цена и лимит каждой приходят из
          * движка и печатаются на самой способности. Копия правила в другом месте — это копия,
          * которая разъезжается: тут стояло «каждая способность роли» (неправда — половина
          * повторяемая) и «один розыгрыш и один сброс карты» — правило, отменённое в 1.13.0. */}
        <p>
          <strong className="text-[var(--color-warning)]">Раз в ход:</strong> патронаж, лоббирование,
          пересборка проектов, <strong>покупка карт</strong>, одна серая операция и часть ролевых
          способностей. Розыгрыш и сброс карт из руки не ограничены.
        </p>
      </PopoverBody>
    </>
  );
}
