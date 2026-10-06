import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { assetEffectLines } from "../../online/gameUi";
import type {
  AssetMeta,
  CityMeta,
  DistrictMeta,
  LegalAction,
  GameState,
  MarketAsset,
  PlayerState,
} from "../../online/types";
import { playerColor } from "../lib/board";
import { tr } from "../../i18n";
import { AssetFace, assetFaceGrid, assetFaceStyle, type AssetBullet } from "../primitives/AssetFace";
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
  game,
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
  game: GameState;
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
  const { t } = useTranslation("game");

  /* Сноска «ещё N условий» — про город после покупки: условие «при наличии объекта своего же
   * района» эта карта выполнит сама. Строки только считаются, правило по-прежнему у движка. */
  const after: PlayerState = { ...me, assets: [...me.assets, { uid: `preview:${item.uid}`, card_id: asset.id }] };
  const lines = assetEffectLines(asset, after, meta, assets, { includeSynergy: true });
  /* На лице — доля самой карты, как и в городе после покупки: прибавка всего города (с синергией
   * чужих объектов и бонусами роли) была больше, и карта будто теряла доход по дороге с рынка.
   * Прибавка города — в окне по нажатию. Без зрителя (галерея) — напечатанный доход. */
  const income = item.own_yield ?? item.preview ?? { money: asset.income, influence: 0 };

  /* Метки слота — плашками поверх карточки, а не значком в поле: метку Капиталиста, серую
   * блокировку Мафиози и уходящий слот надо видеть с одного взгляда на рынок, не открывая карту.
   * Плашка метки — в цвет её хозяина, и рамка карточки тоже. */
  const stamps = marketStamps(game, item, me.id);
  const owner = item.locked_by ?? item.claimed_by;
  const bullets: AssetBullet[] = [];

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
          playerName={id => game.players.find(player => player.id === id)?.name ?? id}
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
        className={`${assetFaceGrid} relative data-[state=buying]:animate-pulse`}
      >
        {owner && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-card"
            style={{ boxShadow: `inset 0 0 0 3px ${playerColor(game, owner)}` }}
          />
        )}
        {stamps.length > 0 && (
          <span className="pointer-events-none absolute -top-2.5 left-1/2 z-20 flex max-w-[calc(100%-12px)] -translate-x-1/2 flex-wrap justify-center gap-1">
            {stamps.map(stamp => (
              <span
                key={stamp.key}
                title={stamp.title}
                data-ui={`market-stamp-${stamp.key}`}
                className="flex items-center gap-1 rounded-full border border-black/40 px-1.5 py-px text-[11px]
                  font-bold leading-tight whitespace-nowrap text-white shadow-[0_1px_3px_rgb(0_0_0/0.6)]"
                style={{ backgroundColor: stamp.color }}
              >
                <span className="text-[13px] leading-none">{stamp.icon}</span>
                {stamp.text}
              </span>
            ))}
          </span>
        )}
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

interface MarketStamp {
  key: "claim" | "lock" | "leaving";
  icon: string;
  text: string;
  title: string;
  color: string;
}

function marketStamps(
  game: GameState,
  item: MarketAsset,
  viewerId: string,
): MarketStamp[] {
  const t = (key: string) => tr("game", key);
  const name = (id: string) => game.players.find(player => player.id === id)?.name ?? id;
  const stamps: MarketStamp[] = [];
  if (item.locked_by) {
    const mine = item.locked_by === viewerId;
    stamps.push({
      key: "lock",
      icon: "🔒",
      text: mine ? t("ui.market.lockedMine") : `${t("ui.market.locked")}: ${name(item.locked_by)}`,
      title: t("ui.market.lockedTitle"),
      color: playerColor(game, item.locked_by),
    });
  }
  if (item.claimed_by) {
    const mine = item.claimed_by === viewerId;
    stamps.push({
      key: "claim",
      icon: "📌",
      text: mine ? t("ui.market.claimMine") : `${t("ui.market.claim")}: ${name(item.claimed_by)}`,
      title: mine ? t("ui.market.claimMineTitle") : t("ui.market.claimTitle"),
      color: playerColor(game, item.claimed_by),
    });
  }
  if (item.leaving) {
    stamps.push({ key: "leaving", icon: "⏳", text: t("ui.market.leaving"), title: t("ui.market.leavingTitle"), color: "#b5651d" });
  }
  return stamps;
}
