import { motion } from "motion/react";
import { assetEffectLines, assetPoints, districtCount } from "../../online/gameUi";
import type { AssetMeta, CityMeta, DistrictMeta, MarketAsset, PlayerState } from "../../online/types";
import { AssetFace, assetFaceGrid, assetFaceStyle } from "../primitives/AssetFace";
import { CardPopover } from "../primitives/CardPopover";
import { MarketCardDetails } from "./MarketCardDetails";
import { marketCardReason, type MarketCardState } from "./marketCardState";

/* Лицевая сторона карточки рынка.
 *
 * Карточка держит всё, что нужно для решения: цена, очки, доход, синергии и то, что
 * объект уходит в конце раунда. В поповер уходят только пояснения — почему это выгодно
 * и что означают эффекты; сами числа дублировать туда не нужно.
 *
 * Состояние выражено через data-state, а не набором булевых пропсов: так его видно
 * в devtools и в тестах, и варианты Tailwind цепляются к одному атрибуту.
 */
export function MarketCard({
  item,
  asset,
  district,
  me,
  meta,
  assets,
  state,
  onBuy,
}: {
  item: MarketAsset;
  asset: AssetMeta;
  district: DistrictMeta | undefined;
  me: PlayerState;
  meta: CityMeta;
  assets: Map<string, AssetMeta>;
  state: MarketCardState;
  onBuy: () => void;
}) {
  const owned = district ? districtCount(me, district.id, assets) : 0;
  const blocked = state.kind !== "buyable" && state.kind !== "buying";
  const short = me.money < state.price;
  // Синергии — то же, что в поповере: клиент нигде не считает правило заново.
  const lines = assetEffectLines(asset, me, meta, assets, { includeSynergy: true });

  return (
    <CardPopover
      label={`${asset.title} — подробности`}
      content={
        <MarketCardDetails
          item={item}
          asset={asset}
          district={district}
          me={me}
          meta={meta}
          assets={assets}
          state={state}
          onBuy={onBuy}
        />
      }
    >
      <motion.button
        type="button"
        // layoutId общий с будущим слотом города: когда карта туда переедет, Motion
        // перенесёт этот же узел, и «полёт с рынка в город» получится без кода анимации.
        layoutId={`asset-${item.uid}`}
        data-state={state.kind}
        data-uid={item.uid}
        style={assetFaceStyle(district?.color, asset.rarity)}
        /* Прозрачностью гасим только момент покупки. За «нельзя купить» отвечают
         * красная цена и строка внизу; притушение всей карты делало поле нечитаемым —
         * недоступными бывают сразу все шесть слотов, и рынок целиком уходил в муть. */
        animate={{ opacity: state.kind === "buying" ? 0.55 : 1 }}
        whileHover={state.kind === "buyable" ? { y: -2 } : undefined}
        transition={{ duration: 0.18 }}
        className={`${assetFaceGrid} hover:border-accent hover:border-l-[var(--dc)]
          data-[state=buying]:animate-pulse`}
      >
        <AssetFace
          asset={asset}
          district={district}
          lines={lines}
          income={asset.income}
          influence={asset.influence}
          topLeft={
            <span className="whitespace-nowrap text-[11px]">
              <span className="text-3xs text-ink-muted">Цена </span>
              <b className={`font-bold ${short ? "text-bad" : "text-ink"}`}>{state.price}$</b>
            </span>
          }
          topRight={
            <span className="flex items-center gap-1">
              {item.leaving && (
                <span className="text-3xs text-gold" title="Слот уходит в конце раунда">
                  ⏳
                </span>
              )}
              <span className="rounded-[10px] border border-[#6b5518] bg-[#33290e] px-1.5 text-[11px]
                font-extrabold whitespace-nowrap text-gold">
                {assetPoints(asset)} оч
              </span>
            </span>
          }
          /* Причина отказа и мои объекты района. Счётчик крупный: синергия включается
           * на 2 и на 4, и это число решает, брать ли объект вообще. Строка держит
           * высоту всегда, иначе появление «Не хватает» дёргало бы зоны выше. */
          bottom={
            <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
              <span
                className={`h-[13px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1
                  text-3xs font-semibold leading-[13px] ${
                    blocked ? "bg-[#4a2530] text-[#ffb0bd]" : "text-transparent"
                  }`}
              >
                {blocked ? marketCardReason(state) : "—"}
              </span>
              <span
                className={`whitespace-nowrap text-[15px] font-extrabold leading-none tabular-nums ${
                  owned >= 2 ? "text-good" : "text-ink"
                }`}
                title="Ваши объекты этого района. Синергия включается на 2 и на 4."
              >
                {owned}/4
              </span>
            </span>
          }
        />
      </motion.button>
    </CardPopover>
  );
}
