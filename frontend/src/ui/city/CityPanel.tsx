import { forwardRef, type ForwardedRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { assetEffectLines, assetPoints, districtCount, districtSynergyValue } from "../../online/gameUi";
import type { AssetMeta, AssetYield, CityMeta, DistrictMeta, LegalAction, OwnedAsset } from "../../online/types";
import { AssetFace, assetFaceGrid, assetFaceGridPortrait, assetFaceStyle, type AssetBullet } from "../primitives/AssetFace";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { useIsPortrait } from "../lib/layout";
import { EffectList, KeyValue, Panel, SectionHead } from "../primitives/atoms";
import { resolve, type ActionContext } from "../lib/actions";
import { maxCapacity, type Indexes } from "../lib/board";

/* Мой город: занятые слоты, свободные и закрытые.
 *
 * Закрытый слот — не «пусто», а замок с ценой: ёмкость стартует на трёх и покупается.
 * Без этого доска врёт про то, сколько места на самом деле есть.
 */
export function CityPanel({
  meta,
  index,
  context,
  onAction,
}: {
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
}) {
  const me = context.me;
  const total = maxCapacity(meta);
  const free = Math.max(0, me.capacity - me.assets.length);
  const locked = Math.max(0, total - me.capacity);
  const capacity = resolve(context, "buy_capacity");
  const portrait = useIsPortrait();

  return (
    <Panel rows zone="city">
      <SectionHead
        title="Мой город"
        /* «Продажа бесплатна» читалось как «отдаёте объект даром»: два игрока подряд решили,
         * что возврата нет вовсе. Бесплатным было действие, а не сделка — теперь так и написано,
         * и цена возврата стоит рядом, потому что это половина, а не полная цена. */
        meta={
          portrait
            ? `${me.assets.length}/${me.capacity} · всего ${total}`
            : `${me.assets.length} / ${me.capacity} занято · всего слотов ${total}` +
              ` · продажа не требует действия, возврат — половина цены`
        }
      />
      {/* Панель сразу в полный рост: все шесть слотов занимают своё место с первого раунда,
        * хотя три из них ещё закрыты. Иначе покупка объекта или слота двигала бы всю доску.
        * Разбивка та же, что на рынке, и та же в обеих раскладках. */}
      <div className="grid min-h-0 min-w-0 grid-cols-3 grid-rows-2 gap-[5px]">
        <AnimatePresence mode="popLayout" initial={false}>
          {me.assets.map(owned => {
            const asset = index.assets.get(owned.card_id);
            if (!asset) return null;
            const district = index.districts.get(asset.district);
            const sell = resolve(context, "sell_asset", { asset_uid: owned.uid });
            return (
              <motion.div
                key={owned.uid}
                // Продажа сдвигает оставшиеся объекты по сетке — `layout` переводит этот
                // скачок в движение, чтобы карточки не перескакивали мгновенно.
                layout
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="min-w-0"
              >
                <CardPopover
                  side="top"
                  label={`${asset.title} — подробности`}
                  content={
                    <OwnedDetails
                      uid={owned.uid}
                      asset={asset}
                      districtTitle={district?.title}
                      districtIcon={district?.icon}
                      meta={meta}
                      index={index}
                      context={context}
                      sellState={sell}
                      onSell={() => sell.kind === "ready" && onAction(sell.action)}
                    />
                  }
                >
                  <OwnedSlot
                    owned={owned}
                    asset={asset}
                    district={district}
                    lines={assetEffectLines(asset, me, meta, index.assets, {
                      includeSynergy: true,
                    })}
                    owns={district ? districtCount(me, district.id, index.assets) : 0}
                    // Без доли от движка (галерея) — напечатанный доход.
                    income={me.asset_yields?.[owned.uid] ?? { money: asset.income, influence: 0 }}
                  />
                </CardPopover>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {Array.from({ length: free }).map((_, position) => (
          <div
            key={`free-${position}`}
            className="grid place-content-center justify-items-center gap-1 rounded-card border
              border-dashed border-line bg-surface px-[7px] py-1.5 text-ink-dim"
          >
            <b className="text-[11.5px] text-ink-muted">Слот {me.assets.length + position + 1}</b>
            <span className="text-3xs">Свободно</span>
          </div>
        ))}

        {/* Закрытый слот покупается прямо здесь: отдельная кнопка в панели действий
          * заставляет угадывать связь между ней и замком на доске.
          * Открыть можно только ближайший — движок присылает ровно одно действие, поэтому
          * остальные замки показывают цену, но не нажимаются. */}
        {Array.from({ length: locked }).map((_, position) => {
          const slot = me.capacity + position;
          const price = meta.scoring?.capacity_costs?.[String(slot)];
          const next = position === 0;
          const ready = next && capacity.kind === "ready";
          const short = price !== undefined && me.money < price;
          return (
            <button
              key={`locked-${position}`}
              type="button"
              disabled={!ready}
              onClick={() => capacity.kind === "ready" && onAction(capacity.action)}
              title={
                next && capacity.kind === "blocked"
                  ? capacity.reason
                  : next
                    ? "Открыть слот"
                    : "Сначала откройте предыдущий слот"
              }
              className="grid place-content-center justify-items-center gap-[3px] rounded-card
                border border-dashed border-line bg-surface px-[7px] py-1.5
                enabled:hover:border-accent disabled:opacity-60"
            >
              <b className="text-[11.5px] text-ink-muted">🔒 Слот {slot + 1}</b>
              <span className="rounded bg-panel-3 px-2 py-0.5 text-2xs text-influence">
                Открыть · <b className={short ? "font-bold text-bad" : ""}>{price ?? "?"}$</b>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/* Купленный объект выглядит ровно так же, как выглядел на рынке: те же поля в том же порядке.
 * Иначе после покупки игрок заново ищет, где что написано. Отличия: плашки цены нет, доход —
 * доля этого объекта в выплате раунда (её присылает движок), разовая награда уже получена,
 * а среди значков справа — цена продажи.
 *
 * forwardRef обязателен: Radix с asChild цепляется к кнопке через ref, и без него
 * поповер молча не открывается — а вместе с ним пропадает единственная кнопка продажи. */
const OwnedSlot = forwardRef(function OwnedSlot({
  owned,
  asset,
  district,
  lines,
  owns,
  income,
  ...rest
}: {
  owned: OwnedAsset;
  asset: AssetMeta;
  district: DistrictMeta | undefined;
  lines: ReturnType<typeof assetEffectLines>;
  owns: number;
  income: AssetYield;
}, ref: ForwardedRef<HTMLButtonElement>) {
  const value = assetPoints(asset);
  const portrait = useIsPortrait();
  const districtSynergy = districtSynergyValue(owns);
  const bullets: AssetBullet[] = [
    {
      key: "district",
      icon: "▦",
      text: `район ${owns}/4${districtSynergy > 0 ? ` +${districtSynergy}$` : ""}`,
      tone: owns >= 2 ? "good" : undefined,
      title: "Ваши объекты этого района. Синергия включается на 2 и на 4.",
    },
    /* Возврат при продаже равен очкам объекта. Продажа — единственный способ освободить слот,
     * когда все шесть заняты, поэтому цена стоит на лице, а не только в окне. */
    { key: "sell", icon: "💰", text: `${value}$`, tone: "dim", title: `Продажа за ${value}$ — не тратит действие` },
  ];
  return (
    <button
      ref={ref}
      type="button"
      data-ui="asset-card"
      data-uid={owned.uid}
      style={assetFaceStyle(district?.color, asset.rarity, district?.id)}
      className={portrait ? assetFaceGridPortrait : assetFaceGrid}
      {...rest}
    >
      <AssetFace asset={asset} district={district} lines={lines} income={income} bullets={bullets} owned />
    </button>
  );
});

function OwnedDetails({
  uid,
  asset,
  districtTitle,
  districtIcon,
  meta,
  index,
  context,
  sellState,
  onSell,
}: {
  uid: string;
  asset: AssetMeta;
  districtTitle?: string;
  districtIcon?: string;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  sellState: ReturnType<typeof resolve>;
  onSell: () => void;
}) {
  const value = assetPoints(asset);
  const lines = assetEffectLines(asset, context.me, meta, index.assets, { includeSynergy: true });
  const objectLines = lines.filter(line => line.kind !== "district" && line.kind !== "sector");
  const districtLines = lines.filter(line => line.kind === "district" || line.kind === "sector");
  const owns = districtCount(context.me, asset.district, index.assets);

  return (
    <>
      <PopoverHeader title={asset.title} subtitle={districtTitle} />
      <PopoverBody>
        <KeyValue
          rows={[
            ["Район", `${districtIcon ?? ""} ${districtTitle ?? asset.district} · у вас ${owns} из 4`],
            [
              "Доход",
              (() => {
                const share = context.me.asset_yields?.[uid];
                return share
                  ? `+${share.money}$${share.influence ? ` и +${share.influence}◆` : ""} за раунд сейчас · напечатано +${asset.income}$`
                  : `+${asset.income}$ за раунд`;
              })(),
            ],
            ["В счёт", `${value} очков`],
            ["Продажа", `${value}$ — половина цены · не требует действия`],
          ]}
        />
        <EffectList title="Свойства объекта" lines={objectLines} />
        <EffectList title="Правила района" lines={districtLines} />
        <p>
          Продажа возвращает ровно столько, сколько объект даёт очков, — смысл только в том, что
          покупается вместо. Слот освобождается сразу, действие не тратится.
        </p>
      </PopoverBody>
      <PopoverFooter>
        <button
          type="button"
          disabled={sellState.kind !== "ready"}
          onClick={onSell}
          className="rounded-md border border-[#594047] bg-[#21161a] px-2 py-2 text-center text-xs
            font-semibold text-bad enabled:hover:border-bad disabled:opacity-50"
        >
          {sellState.kind === "ready"
            ? `Продать за ${value}$`
            : sellState.kind === "pending"
              ? "Продаём…"
              : sellState.reason}
        </button>
      </PopoverFooter>
    </>
  );
}
