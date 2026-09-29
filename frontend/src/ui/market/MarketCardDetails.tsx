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
import { EffectList } from "../primitives/atoms";
import { marketCardReason, type MarketCardState } from "./marketCardState";

/* Содержимое поповера карточки рынка.
 *
 * Компонент ничего не знает о поповере: на телефоне тот же JSX поедет в нижний Sheet.
 *
 * Всё, что иначе легло бы в атрибут title= одной строкой на 400 символов, живёт здесь
 * разделами: что даёт, чего требует, почему это выгодно.
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
  refresh,
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
  refresh?: LegalAction;
}) {
  const owned = district ? districtCount(me, district.id, assets) : 0;
  const points = assetPoints(asset);
  const lines = assetEffectLines(asset, me, meta, assets, { includeSynergy: true });
  const objectLines = lines.filter(line => line.kind !== "district" && line.kind !== "sector");
  const districtLines = lines.filter(line => line.kind === "district" || line.kind === "sector");
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
          <dd className="font-semibold text-gold">
            {state.price}${" "}
            {item.price !== undefined && item.price !== asset.cost && (
              <span className="text-ink-dim">(базовая {asset.cost}$)</span>
            )}
          </dd>
          <dt className="text-ink-dim">В финальный счёт</dt>
          <dd className="font-semibold text-points">{points} очков</dd>
          <dt className="text-ink-dim">Доход</dt>
          <dd className="font-medium text-money">
            +{asset.income}$ за раунд
            {asset.influence > 0 && <span className="text-influence"> · +{asset.influence}◆ разово</span>}
          </dd>
        </dl>

        <EffectList title="Свойства объекта" lines={objectLines} />
        <EffectList title="Правила района" lines={districtLines} />

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
        {/* Пересдача стоит рядом с покупкой не случайно: это второй ответ на тот же
          * вопрос «что делать с этим слотом» — и единственный способ снять чужую серую метку. */}
        {refresh && (
          <button
            onClick={() => onMark(refresh)}
            className="mb-1 rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              font-semibold hover:border-accent"
          >
            🔁 Пересдать слот — раз в раунд, без действия
          </button>
        )}
        <button
          disabled={state.kind !== "buyable"}
          onClick={onBuy}
          className="rounded-md border px-2 py-2 text-center text-xs font-semibold
            border-good bg-[#1a2a21] text-good disabled:border-line
            disabled:bg-panel-2 disabled:text-ink-muted disabled:opacity-60"
        >
          {marketCardReason(state)}
        </button>
      </PopoverFooter>
    </>
  );
}
