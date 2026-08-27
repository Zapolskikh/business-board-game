import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";
import { assetEffectLines, assetPoints, districtCount } from "../../online/gameUi";
import type { AssetMeta, CityMeta, LegalAction, OwnedAsset } from "../../online/types";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { EffectList, KeyValue, Panel, SectionHead } from "../primitives/atoms";
import { resolve, type ActionContext } from "../lib/actions";
import { maxCapacity, type Indexes } from "../lib/board";
import { SlotsDetails } from "./SlotsDetails";

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

  return (
    <Panel rows>
      <SectionHead
        title="Мой город"
        meta={`${me.assets.length} / ${me.capacity} занято · всего слотов ${total} · продажа бесплатна`}
      />
      <div className="grid min-h-0 grid-cols-3 grid-rows-2 gap-[5px]">
        <AnimatePresence mode="popLayout" initial={false}>
          {me.assets.map(owned => {
            const asset = index.assets.get(owned.card_id);
            if (!asset) return null;
            const district = index.districts.get(asset.district);
            const sell = resolve(context, "sell_asset", { asset_uid: owned.uid });
            return (
              <motion.div
                key={owned.uid}
                // Тот же layoutId, что у карточки на рынке: купленный объект приезжает
                // сюда физически тем же узлом, а не появляется на пустом месте.
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
                      owned={owned}
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
                    color={district?.color}
                    icon={district?.icon}
                    title={district?.title}
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

        {Array.from({ length: locked }).map((_, position) => (
          <CardPopover
            key={`locked-${position}`}
            side="top"
            content={<SlotsDetails meta={meta} context={context} onAction={onAction} />}
          >
            <button
              type="button"
              className="grid place-content-center justify-items-center gap-[3px] rounded-card
                border border-dashed border-[#3d3050] bg-[#141019] px-[7px] py-1.5 hover:border-accent"
            >
              <b className="text-[11.5px] text-ink-muted">🔒 Слот {me.capacity + position + 1}</b>
              <span className="rounded border border-[#52407a] bg-[#2a2140] px-2 py-0.5 text-2xs text-[#c9b3ef]">
                Открыть · {meta.scoring?.capacity_costs?.[String(me.capacity + position)] ?? "?"}$
              </span>
            </button>
          </CardPopover>
        ))}
      </div>
    </Panel>
  );
}

function OwnedSlot({
  owned,
  asset,
  color,
  icon,
  title,
  owns,
  ...rest
}: {
  owned: OwnedAsset;
  asset: AssetMeta;
  color?: string;
  icon?: string;
  title?: string;
  owns: number;
}) {
  return (
    <button
      type="button"
      data-state={owned.blocked ? "blocked" : "active"}
      style={{ "--dc": color ?? "#2d3d50" } as CSSProperties}
      className="grid h-full w-full content-start gap-0.5 rounded-card border border-line
        border-l-[3px] border-l-[var(--dc)] bg-panel-2 px-[7px] py-1.5 text-left
        hover:border-accent hover:border-l-[var(--dc)]
        data-[state=blocked]:border-[#5c3340] data-[state=blocked]:bg-[#1c1418]"
      {...rest}
    >
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-3xs uppercase tracking-wide text-[var(--dc)]">
        {icon} {title} · {owns}/4
      </span>
      <h4 className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-ink">
        {asset.title}
      </h4>
      <span className="flex flex-wrap gap-1.5 text-2xs">
        {owned.blocked ? (
          <b className="text-bad">🚫 заблокирован</b>
        ) : (
          <b className="text-good">+{asset.income}$/р</b>
        )}
        <b className="text-gold">{assetPoints(asset)} очк</b>
      </span>
    </button>
  );
}

function OwnedDetails({
  owned,
  asset,
  districtTitle,
  districtIcon,
  meta,
  index,
  context,
  sellState,
  onSell,
}: {
  owned: OwnedAsset;
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
        {owned.blocked && (
          <p className="mb-2 rounded-md border border-[#5c3340] bg-[#2a1519] px-2 py-1.5 text-[#ffb3b3]">
            <strong>🚫 Объект заблокирован.</strong> Дохода не даёт и не открывает серых операций.
            Снимается только картой разблокировки — отдельного действия для этого в игре нет.
          </p>
        )}
        <KeyValue
          rows={[
            ["Район", `${districtIcon ?? ""} ${districtTitle ?? asset.district} · у вас ${owns} из 4`],
            [
              "Доход",
              owned.blocked ? (
                <span className="text-bad">
                  0$ вместо +{asset.income}$
                </span>
              ) : (
                `+${asset.income}$ за раунд`
              ),
            ],
            ["В счёт", `${value} очков`],
            ["Продажа", `${value}$ · бесплатно, без действия`],
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
