import { motion } from "motion/react";
import { assetEffectLines, districtCount } from "../../online/gameUi";
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
  const owned = district ? districtCount(me, district.id, assets) : 0;
  const claimedByMe = item.claimed_by === me.id;
  const lockedForMe = Boolean(item.locked_by) && item.locked_by !== me.id;
  const portrait = useIsPortrait();

  /* Сноска «ещё N условий» — про город после покупки: условие «при наличии объекта своего же
   * района» эта карта выполнит сама. Строки только считаются, правило по-прежнему у движка. */
  const after: PlayerState = { ...me, assets: [...me.assets, { uid: `preview:${item.uid}`, card_id: asset.id }] };
  const lines = assetEffectLines(asset, after, meta, assets, { includeSynergy: true });
  // Без зрителя (галерея, наблюдатель) превью нет — остаётся напечатанный доход.
  const income = item.preview ?? { money: asset.income, influence: 0 };

  /* Метки обеих ролей публичны и меняют решение «покупать ли», поэтому стоят на лице. */
  const bullets: AssetBullet[] = [];
  if (item.leaving) {
    bullets.push({ key: "leaving", icon: "⏳", text: "уходит", tone: "warn", title: "Слот уходит в конце раунда" });
  }
  if (item.claimed_by) {
    bullets.push({
      key: "claim",
      icon: "🏷",
      text: claimedByMe ? "ваша метка" : "метка",
      tone: claimedByMe ? "good" : undefined,
      title: claimedByMe ? "Ваша метка: карта уже работает на вас" : "Метка капиталиста: карта работает на него",
    });
  }
  if (item.locked_by) {
    bullets.push({
      key: "lock",
      icon: "🔒",
      text: lockedForMe ? "закрыт" : "ваша блокировка",
      tone: lockedForMe ? "bad" : "good",
      title: "Серая метка мафиози: слот закрыт для всех, кроме него, до конца раунда",
    });
  }
  bullets.push({
    key: "district",
    icon: "▦",
    text: `район ${owned}/4`,
    tone: owned >= 2 ? "good" : undefined,
    title: "Ваши объекты этого района. Синергия включается на 2 и на 4.",
  });

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
