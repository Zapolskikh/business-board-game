import { useTranslation } from "react-i18next";
import { assetEffectLines, assetPoints, districtCount } from "../../online/gameUi";
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
import { ResourceText } from "../primitives/ResourceIcon";
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
  // Строки — для города после покупки, как и сноска на лице карточки.
  const after: PlayerState = { ...me, assets: [...me.assets, { uid: `preview:${item.uid}`, card_id: asset.id }] };
  const lines = assetEffectLines(asset, after, meta, assets, { includeSynergy: true });
  const blocked = state.kind !== "buyable" && state.kind !== "buying";
  const { t } = useTranslation("game");
  const sign = (value: number) => (value >= 0 ? "+" : "−");
  const objectLines = lines.filter(line => line.kind !== "district" && line.kind !== "sector");
  const districtLines = lines.filter(line => line.kind === "district" || line.kind === "sector");

  return (
    <>
      <PopoverHeader title={asset.title} subtitle={district?.title} />
      <PopoverBody>
        {/* Почему купить нельзя — первым делом, а не серой кнопкой внизу: с лица карточки эта
          * строка ушла, и окно по нажатию — единственное место, где игрок её увидит. */}
        {blocked && (
          <p
            role="alert"
            className="mb-2 rounded-md border border-[#6b3a41] bg-[#2a171b] px-2 py-1.5 font-semibold text-bad"
          >
            ⛔ {marketCardReason(state)}
          </p>
        )}
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5">
          <dt className="text-ink-dim">{t("ui.market.districtRow")}</dt>
          <dd className="font-medium text-ink">
            {district?.icon} {district?.title} · {t("ui.market.districtValue", { count: owned })}
          </dd>
          <dt className="text-ink-dim">{t("ui.market.priceRow")}</dt>
          <dd className="font-semibold text-gold">
            <ResourceText>{`${state.price}$`}</ResourceText>{" "}
            {item.price !== undefined && item.price !== asset.cost && (
              <span className="text-ink-dim">{t("ui.market.basePrice", { cost: asset.cost })}</span>
            )}
          </dd>
          <dt className="text-ink-dim">{t("ui.market.scoreRow")}</dt>
          <dd className="font-semibold text-points">{t("ui.market.scoreValue", { count: points })}</dd>
          <dt className="text-ink-dim">{t("ui.market.incomeRow")}</dt>
          <dd className="font-medium text-money">
            {item.preview ? (
              <>
                <ResourceText>{`${sign(item.preview.money)}${Math.abs(item.preview.money)}$`}</ResourceText> {t("ui.market.perRound")}
                {item.preview.influence !== 0 && (
                  <span className="text-influence">
                    {" · "}<ResourceText>{`${sign(item.preview.influence)}${Math.abs(item.preview.influence)}◆`}</ResourceText> {t("ui.market.perRound")}
                  </span>
                )}
                <span className="block text-2xs font-normal text-ink-dim">
                  {t("ui.market.incomeNote", { printed: asset.income })}
                </span>
              </>
            ) : (
              <><ResourceText>{`+${asset.income}$`}</ResourceText> {t("ui.market.perRound")}</>
            )}
          </dd>
          {asset.influence > 0 && (
            <>
              <dt className="text-ink-dim">{t("ui.market.nowRow")}</dt>
              <dd className="font-medium text-influence"><ResourceText>{t("ui.market.nowValue", { value: asset.influence })}</ResourceText></dd>
            </>
          )}
        </dl>

        <EffectList title={t("ui.market.properties")} lines={objectLines} />
        <EffectList title={t("ui.market.districtRules")} lines={districtLines} />

        {item.leaving && (
          <p className="text-[var(--color-warning)]">{t("ui.market.leavingNote")}</p>
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
              ? t("ui.market.lock")
              : t("ui.market.mark")}
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
            {t("ui.market.refresh")}
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
