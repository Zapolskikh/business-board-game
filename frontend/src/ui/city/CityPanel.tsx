import { forwardRef, type ForwardedRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { assetEffectLines, assetPoints, districtCount } from "../../online/gameUi";
import type { AssetMeta, CityMeta, DistrictMeta, LegalAction, OwnedAsset } from "../../online/types";
import { AssetFace, assetFaceGrid, assetFaceStyle } from "../primitives/AssetFace";
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
          `${me.assets.length} / ${me.capacity} занято · всего слотов ${total}` +
          ` · продажа не требует действия, возврат — половина цены`
        }
      />
      {/* Панель сразу в полный рост: все шесть слотов занимают своё место с первого раунда,
        * хотя три из них ещё закрыты. Иначе покупка объекта или слота двигала бы всю доску.
        * Разбивка та же, что на рынке, включая вертикальную: 2×3 с фиксированной высотой ряда. */}
      <div
        className={
          portrait
            ? "grid min-w-0 auto-rows-[152px] grid-cols-2 gap-[5px]"
            : "grid min-h-0 min-w-0 grid-cols-3 grid-rows-2 gap-[5px]"
        }
      >
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
              border-dashed border-line bg-[#0e1720] px-[7px] py-1.5 text-ink-dim"
          >
            <b className="text-[11.5px] text-ink-muted">Слот {me.assets.length + position + 1}</b>
            <span className="text-3xs">Свободно</span>
          </div>
        ))}

        {/* Закрытый слот покупается прямо здесь: раньше для этого была отдельная кнопка
          * в панели действий, и связь между ней и замком на доске приходилось угадывать.
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
                border border-dashed border-[#3d3050] bg-[#141019] px-[7px] py-1.5
                enabled:hover:border-accent disabled:opacity-60"
            >
              <b className="text-[11.5px] text-ink-muted">🔒 Слот {slot + 1}</b>
              <span className="rounded border border-[#52407a] bg-[#2a2140] px-2 py-0.5 text-2xs text-[#c9b3ef]">
                Открыть · <b className={short ? "font-bold text-bad" : ""}>{price ?? "?"}$</b>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/* Купленный объект выглядит ровно так же, как выглядел на рынке: те же зоны в том же
 * порядке. Иначе после покупки игрок заново ищет, где что написано. Отличий два —
 * цена наверху означает возврат при продаже, а внизу вместо причины отказа стоит
 * либо цена продажи, либо отметка о блокировке.
 *
 * forwardRef обязателен: Radix с asChild цепляется к кнопке через ref, и без него
 * поповер молча не открывается — а вместе с ним пропадает единственная кнопка продажи. */
const OwnedSlot = forwardRef(function OwnedSlot({
  owned,
  asset,
  district,
  lines,
  owns,
  ...rest
}: {
  owned: OwnedAsset;
  asset: AssetMeta;
  district: DistrictMeta | undefined;
  lines: ReturnType<typeof assetEffectLines>;
  owns: number;
}, ref: ForwardedRef<HTMLButtonElement>) {
  const value = assetPoints(asset);
  return (
    <button
      ref={ref}
      type="button"
      style={assetFaceStyle(district?.color, asset.rarity)}
      className={assetFaceGrid}
      {...rest}
    >
      <AssetFace
        asset={asset}
        district={district}
        lines={lines}
        income={asset.income}
        influence={0}
        /* Возврат при продаже равен очкам объекта — это одно и то же число. Печатать его
         * ещё и слева сверху, где у рынка стоит цена, значит трижды повторить одно; строка
         * продажи внизу и бейдж очков справа уже всё сказали. */
        topLeft={null}
        topRight={
          <span className="rounded-[10px] border border-line-2 bg-panel-3 px-1.5 text-[11px]
            font-extrabold whitespace-nowrap text-[var(--color-badge)]">
            {value} оч
          </span>
        }
        bottom={
          <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
            {/* У карточки рынка здесь стоит причина отказа, у своего объекта — цена продажи.
              * Место пустовало, а продажа — единственный способ освободить слот, когда все
              * шесть заняты. */}
            <span
              className="h-[13px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1
                text-3xs font-semibold leading-[13px] text-good"
            >
              {`Продать за ${value}$`}
            </span>
            <span
              className={`whitespace-nowrap text-[15px] font-extrabold leading-none tabular-nums ${
                owns >= 2 ? "text-good" : "text-ink"
              }`}
              title="Ваши объекты этого района. Синергия включается на 2 и на 4."
            >
              {owns}/4
            </span>
          </span>
        }
      />
    </button>
  );
});

function OwnedDetails({
  asset,
  districtTitle,
  districtIcon,
  meta,
  index,
  context,
  sellState,
  onSell,
}: {
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
  const owns = districtCount(context.me, asset.district, index.assets);

  return (
    <>
      <PopoverHeader title={asset.title} subtitle={districtTitle} />
      <PopoverBody>
        <KeyValue
          rows={[
            ["Район", `${districtIcon ?? ""} ${districtTitle ?? asset.district} · у вас ${owns} из 4`],
            ["Доход", `+${asset.income}$ за раунд`],
            ["В счёт", `${value} очков`],
            ["Продажа", `${value}$ — половина цены · не требует действия`],
          ]}
        />
        <EffectList lines={lines} />
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
          className="rounded-md border border-[#5c3340] px-2 py-2 text-center text-xs font-semibold
            text-[#ff9aa8] enabled:hover:border-bad disabled:opacity-50"
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
