import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { assetEffectLines } from "../../online/gameUi";
import type {
  AssetMeta,
  CityMeta,
  DistrictMeta,
  LegalAction,
  MarketAsset,
  PlayerState,
} from "../../online/types";
import { AssetFace, assetFaceGrid, assetFaceGridPortrait, assetFaceStyle, type AssetBullet } from "../primitives/AssetFace";
import { useIsPortrait } from "../lib/layout";
import { CardPopover } from "../primitives/CardPopover";
import { MarketCardDetails } from "./MarketCardDetails";
import type { MarketCardState } from "./marketCardState";

/* Лицевая сторона карточки рынка.
 *
 * Карточка отвечает на один вопрос: что даст покупка прямо сейчас. Доход — прибавка всей
 * доски, её считает движок (`item.preview`), поэтому в число уже сложены синергии района и
 * карты, которые эта покупка включит у вас в городе. Формулировки условий, правила района и
 * причина, почему купить нельзя, — в окне по нажатию.
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
  /** Метка роли на этот слот, если движок её сейчас разрешает: капиталист или мафиози. */
  mark?: LegalAction;
  onMark: (action: LegalAction) => void;
  /** Пересдача слота «Маркет-мейкером» — тоже только когда движок её предлагает. */
  refresh?: LegalAction;
}) {
  const portrait = useIsPortrait();
  const { t } = useTranslation("game");

  /* Сноска «ещё N условий» — про город после покупки: условие «при наличии объекта своего же
   * района» эта карта выполнит сама. Строки только считаются, правило по-прежнему у движка. */
  const after: PlayerState = { ...me, assets: [...me.assets, { uid: `preview:${item.uid}`, card_id: asset.id }] };
  const lines = assetEffectLines(asset, after, meta, assets, { includeSynergy: true });
  // Без зрителя (галерея, наблюдатель) превью нет — остаётся напечатанный доход.
  const income = item.preview ?? { money: asset.income, influence: 0 };

  /* На лице оставляем только часовую метку уходящего слота; остальные детали доступны в окне. */
  const bullets: AssetBullet[] = [];
  if (item.leaving) {
    bullets.push({ key: "leaving", icon: "⏳", text: t("ui.market.leaving"), tone: "warn", title: t("ui.market.leavingTitle") });
  }

  return (
    <CardPopover
      label={t("ui.market.details", { title: asset.title })}
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
          mark={mark}
          onMark={onMark}
          refresh={refresh}
        />
      }
    >
      <motion.button
        type="button"
        data-ui="asset-card"
        /* Без `layoutId`: он имеет смысл только в паре с таким же узлом в городе, а там
         * стоит обычный `layout`. Если полёт «с рынка в город» понадобится — нужен общий
         * layoutId с обеих сторон. */
        data-state={state.kind}
        data-uid={item.uid}
        style={assetFaceStyle(district?.color, asset.rarity, district?.id)}
        /* Прозрачностью гасим только момент покупки. Недоступными бывают сразу все шесть
         * слотов, и притушение делало рынок целиком нечитаемым; причина — по нажатию. */
        animate={{ opacity: state.kind === "buying" ? 0.55 : 1 }}
        whileHover={state.kind === "buyable" ? { y: -2 } : undefined}
        transition={{ duration: 0.18 }}
        className={`${portrait ? assetFaceGridPortrait : assetFaceGrid} data-[state=buying]:animate-pulse`}
      >
        <AssetFace
          asset={asset}
          district={district}
          lines={lines}
          income={income}
          price={{ value: state.price, short: me.money < state.price }}
          bullets={bullets}
        />
      </motion.button>
    </CardPopover>
  );
}
