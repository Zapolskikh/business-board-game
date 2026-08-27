import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { assetPoints, districtCount } from "../../online/gameUi";
import type { AssetMeta, CityMeta, DistrictMeta, MarketAsset, PlayerState } from "../../online/types";
import { CardPopover } from "../primitives/CardPopover";
import { MarketCardDetails } from "./MarketCardDetails";
import { marketCardReason, type MarketCardState } from "./marketCardState";

const rarityDot: Record<string, string> = {
  common: "bg-rar-common",
  uncommon: "bg-rar-uncommon",
  rare: "bg-rar-rare",
  epic: "bg-rar-epic",
  legendary: "bg-rar-legendary",
};

/* Лицевая сторона карточки рынка.
 *
 * На доске остаются только цифры, которые сканируют глазами. Всё, что надо читать —
 * в поповере. Состояние выражено через data-state, а не через набор булевых пропсов:
 * так его видно в devtools и в тестах, и варианты Tailwind цепляются к одному атрибуту.
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
        style={{ "--dc": district?.color ?? "#2d3d50" } as CSSProperties}
        animate={{ opacity: state.kind === "buying" ? 0.55 : blocked ? 0.5 : 1 }}
        whileHover={state.kind === "buyable" ? { y: -2 } : undefined}
        transition={{ duration: 0.18 }}
        className="grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-[3px]
          rounded-card border border-line border-l-[3px] border-l-[var(--dc)] bg-panel-2
          px-[7px] py-1.5 text-left
          hover:border-accent hover:border-l-[var(--dc)]
          data-[state=buying]:animate-pulse"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex items-center gap-1 overflow-hidden whitespace-nowrap text-3xs uppercase tracking-wide text-[var(--dc)]">
            {district?.icon} {district?.title}
          </span>
          <span
            className={`rounded px-1 text-3xs ${
              owned >= 2 ? "bg-[#1d3b2a] text-[#7fdaa6]" : "bg-panel-3 text-ink-muted"
            }`}
            title="Ваши объекты этого района. Синергия включается на 2 и на 4."
          >
            {owned}/4
          </span>
          <span className={`ml-auto size-[7px] shrink-0 rounded-full ${rarityDot[asset.rarity] ?? "bg-rar-common"}`} />
          {item.leaving && (
            <span className="rounded bg-[#3a2d12] px-1 text-3xs text-gold" title="Слот уходит в конце раунда">
              ⏳
            </span>
          )}
        </span>

        <h3 className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold text-ink">
          {asset.title}
        </h3>

        <span className="flex flex-wrap gap-1.5 text-[11px]">
          <b className="font-bold text-ink">{state.price}$</b>
          <b className="font-bold text-gold">{assetPoints(asset)} очк</b>
          {asset.income > 0 && <b className="font-bold text-good">+{asset.income}$/р</b>}
          {asset.influence > 0 && <b className="font-bold text-rar-rare">+{asset.influence}◆</b>}
        </span>

        {blocked ? (
          <span className="self-end rounded bg-[#33202a] px-1.5 text-3xs text-[#e59aa9]">
            {marketCardReason(state)}
          </span>
        ) : (
          <p className="line-clamp-2 overflow-hidden text-2xs leading-tight text-ink-muted">{asset.text}</p>
        )}
      </motion.button>
    </CardPopover>
  );
}
