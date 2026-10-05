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
import { ResourceIcon, ResourceText } from "../primitives/ResourceIcon";
import type { ResourceIcon as ResourceIconName } from "../assets/cards";
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
  playerName,
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
  /** Имя игрока по id — для пояснения чужих меток. Без него печатается id. */
  playerName?: (id: string) => string;
}) {
  const owned = district ? districtCount(me, district.id, assets) : 0;
  const points = assetPoints(asset);
  // Строки — для города после покупки, как и сноска на лице карточки.
  const after: PlayerState = { ...me, assets: [...me.assets, { uid: `preview:${item.uid}`, card_id: asset.id }] };
  const lines = assetEffectLines(asset, after, meta, assets, { includeSynergy: true });
  const blocked = state.kind !== "buyable" && state.kind !== "buying";
  const { t } = useTranslation("game");
  const sign = (value: number) => (value >= 0 ? "+" : "−");
  const ruleLines = lines.filter(line => line.kind !== "purchase");
  const purchase = (asset.effects?.purchase ?? {}) as {
    money?: number;
    influence?: number;
    roofs?: number;
    card?: boolean;
    scandals?: number;
  };
  const own = item.own_yield ?? item.preview;
  const purchaseInfluence = asset.influence + (purchase.influence ?? 0);
  const purchaseRewards: { icon: ResourceIconName; value: string }[] = [];
  if (purchaseInfluence) purchaseRewards.push({ icon: "influence", value: `+${purchaseInfluence}` });
  if (purchase.money) purchaseRewards.push({ icon: "money", value: `${sign(purchase.money)}${Math.abs(purchase.money)}` });
  if (purchase.roofs) purchaseRewards.push({ icon: "roof", value: `+${purchase.roofs}` });
  if (purchase.scandals) purchaseRewards.push({ icon: "scandal", value: `+${purchase.scandals}` });

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
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1">
          <dt className="text-ink-dim">{t("ui.market.districtRow")}</dt>
          <dd className="font-medium text-ink">
            {district?.icon} {district?.title} · {t("ui.market.districtValue", { count: owned })}
          </dd>
          <dt className="text-ink-dim">{t("ui.market.priceRow")}</dt>
          <dd className="flex items-center gap-1 font-semibold text-gold"><ResourceIcon name="money" />{state.price}</dd>
          <dt className="text-ink-dim">{t("ui.market.scoreRow")}</dt>
          <dd className="flex items-center gap-1 font-semibold text-points"><ResourceIcon name="score" />{points}</dd>
          <dt className="text-ink-dim">{t("ui.market.saleRow")}</dt>
          <dd className="flex items-center gap-1 font-semibold text-money"><ResourceIcon name="money" />{points}</dd>
          {/* Два числа: напечатанное на карте и доля карты в вашем городе — её же покажет
            * карточка в городе после покупки. */}
          <dt className="text-ink-dim">{t("ui.market.printedRow")}</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
            <YieldValue value={{ money: asset.income, influence: 0 }} sign={sign} />
            <span className="text-ink-muted">{t("ui.market.perRound")}</span>
          </dd>
          {own && (
            <>
              <dt className="text-ink-dim">{t("ui.market.incomeRow")}</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
                <YieldValue value={own} sign={sign} />
                <span className="text-ink-muted">{t("ui.market.perRound")}</span>
              </dd>
            </>
          )}
          {(purchaseRewards.length > 0 || purchase.card) && (
            <>
              <dt className="text-ink-dim">{t("ui.market.purchaseRow")}</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
                {purchaseRewards.map((reward, index) => (
                  <span
                    key={index}
                    className={`flex items-center gap-1 ${
                      reward.icon === "money" ? "text-money" :
                      reward.icon === "influence" ? "text-influence" :
                      reward.icon === "roof" ? "text-defence" : "text-bad"
                    }`}
                  >
                    <ResourceIcon name={reward.icon} />{reward.value}
                  </span>
                ))}
                {purchase.card && <span className="text-ink-muted">{t("effect.purchaseCard")}</span>}
              </dd>
            </>
          )}
        </dl>

        {ruleLines.length > 0 && (
          <section className="mb-2">
            <p className="mb-1 font-semibold text-ink">{t("ui.market.districtRules")}</p>
            <ul className="grid gap-0.5">
              {ruleLines.map((line, index) => (
                <li key={index} className={`flex items-start gap-1.5 ${line.active ? "text-good" : "text-ink-dim"}`}>
                  <span aria-hidden="true">•</span>
                  <span><ResourceText>{line.text}</ResourceText>{line.boosted && <span className="ml-1 text-gold">⚙×2</span>}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Плашка на лице только называет метку; что она значит — здесь, словами. Новичок видит
          * чужую метку и по нажатию узнаёт, что карта работает на другого и кто может её купить. */}
        {item.claimed_by && (
          <MarkInfo
            ui="market-claim-info"
            title={t("ui.market.claimInfoTitle")}
            text={
              item.claimed_by === me.id
                ? t("ui.market.claimInfoMine")
                : t("ui.market.claimInfo", { name: playerName?.(item.claimed_by) ?? item.claimed_by })
            }
          />
        )}
        {item.locked_by && (
          <MarkInfo
            ui="market-lock-info"
            title={t("ui.market.lockInfoTitle")}
            text={
              item.locked_by === me.id
                ? t("ui.market.lockInfoMine", { round: item.locked_round })
                : t("ui.market.lockInfo", { name: playerName?.(item.locked_by) ?? item.locked_by, round: item.locked_round })
            }
          />
        )}

        {item.leaving && (
          <p className="flex items-start gap-1.5 font-semibold text-[var(--color-warning)]">
            <span aria-hidden="true" className="text-lg leading-none">⏳</span>
            <span>{t("ui.market.leavingNote")}</span>
          </p>
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

function YieldValue({ value, sign }: { value: { money: number; influence: number }; sign: (value: number) => string }) {
  return (
    <>
      <span className="flex items-center gap-1 text-money">
        <ResourceIcon name="money" />{sign(value.money)}{Math.abs(value.money)}
      </span>
      {value.influence !== 0 && (
        <span className="flex items-center gap-1 text-influence">
          <ResourceIcon name="influence" />{sign(value.influence)}{Math.abs(value.influence)}
        </span>
      )}
    </>
  );
}

function MarkInfo({ ui, title, text }: { ui: string; title: string; text: string }) {
  return (
    <section data-ui={ui} className="mb-2 rounded-md border border-line-2 bg-panel-2 px-2 py-1.5">
      <p className="mb-0.5 font-semibold text-ink">{title}</p>
      <p className="text-ink-muted">{text}</p>
    </section>
  );
}
