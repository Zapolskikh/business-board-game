import { assetEffectLines, assetPoints, districtCount, moneyPerPoint } from "../../online/gameUi";
import type {
  AssetMeta,
  CityMeta,
  DistrictMeta,
  LegalAction,
  MarketAsset,
  PlayerState,
} from "../../online/types";
import { PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { marketCardReason, type MarketCardState } from "./marketCardState";

/* Содержимое поповера карточки рынка.
 *
 * Компонент ничего не знает о поповере: на телефоне тот же JSX поедет в нижний Sheet.
 *
 * Сюда переезжает то, что раньше лежало в атрибуте title= одной строкой на 400 символов
 * (см. Game.tsx в старом UI): текст перестал быть простынёй и стал разделами — что даёт,
 * чего требует, почему это выгодно.
 */
export function MarketCardDetails({
  item,
  asset,
  district,
  me,
  meta,
  assets,
  state,
  onBuy,
  mark,
  onMark,
}: {
  item: MarketAsset;
  asset: AssetMeta;
  district: DistrictMeta | undefined;
  me: PlayerState;
  meta: CityMeta;
  assets: Map<string, AssetMeta>;
  state: MarketCardState;
  onBuy: () => void;
  mark?: LegalAction;
  onMark: (action: LegalAction) => void;
}) {
  const owned = district ? districtCount(me, district.id, assets) : 0;
  const points = assetPoints(asset);
  const lines = assetEffectLines(asset, me, meta, assets, { includeSynergy: true });
  const perPoint = (state.price / Math.max(1, points)).toFixed(1);

  return (
    <>
      <PopoverHeader title={asset.title} subtitle={district?.title} />
      <PopoverBody>
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5">
          <dt className="text-ink-dim">Район</dt>
          <dd className="font-medium text-ink">
            {district?.icon} {district?.title} · у вас {owned} из 4
          </dd>
          <dt className="text-ink-dim">Цена вам</dt>
          <dd className="font-medium text-ink">
            {state.price}${" "}
            {item.price !== undefined && item.price !== asset.cost && (
              <span className="text-ink-dim">(базовая {asset.cost}$)</span>
            )}
          </dd>
          <dt className="text-ink-dim">В финальный счёт</dt>
          <dd className="font-medium text-ink">{points} очков</dd>
          <dt className="text-ink-dim">Доход</dt>
          <dd className="font-medium text-ink">
            +{asset.income}$ за раунд
            {asset.influence > 0 && ` · +${asset.influence}◆ разово`}
          </dd>
        </dl>

        {lines.length > 0 && (
          <>
            <p className="mb-1 font-medium text-ink">Эффекты</p>
            <ul className="mb-2 grid gap-0.5">
              {lines.map((line, index) => (
                <li
                  key={index}
                  className={
                    line.active
                      ? "relative pl-3.5 text-good before:absolute before:left-0 before:content-['✓']"
                      : "relative pl-3.5 text-ink-dim before:absolute before:left-1 before:content-['·']"
                  }
                >
                  {line.text}
                  {line.boosted && <span className="ml-1 text-gold">⚙×2</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mb-2">
          Объект отдаёт очко за {perPoint}$ против {moneyPerPoint(meta)}$ за очко у денег в кошельке —
          поэтому объекты и есть главный сток денег.
        </p>

        {item.leaving && (
          <p className="text-[var(--color-warning)]">⏳ Слот уходит в конце раунда: карта вернётся в низ колоды.</p>
        )}
      </PopoverBody>

      <PopoverFooter>
        {/* Метка ставится там, где нарисована её цель. Кнопка появляется только когда движок
          * действительно разрешает ход, поэтому она же и есть ответ на вопрос «а могу ли я». */}
        {mark && (
          <button
            onClick={() => onMark(mark)}
            className="mb-1 rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              font-semibold hover:border-accent"
          >
            {mark.payload.power === "mafia_lock"
              ? "🔒 Серая метка — закрыть слот всем, кроме себя (Крыша)"
              : "🏷️ Метка — карта работает на вас (действие + скандал)"}
          </button>
        )}
        <button
          disabled={state.kind !== "buyable"}
          onClick={onBuy}
          className="rounded-md border px-2 py-2 text-center text-xs font-semibold
            border-good bg-good text-[#04130b] disabled:border-line
            disabled:bg-panel-2 disabled:text-ink-muted disabled:opacity-60"
        >
          {marketCardReason(state)}
        </button>
      </PopoverFooter>
    </>
  );
}
