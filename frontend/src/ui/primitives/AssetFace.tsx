import { useTranslation } from "react-i18next";
import { tr } from "../../i18n";
import type { CSSProperties, ReactNode } from "react";
import { rarityLabels, tagLabel, type AssetEffectLine } from "../../online/gameUi";
import { useIsPortrait } from "../lib/layout";
import type { AssetMeta, AssetYield, DistrictMeta } from "../../online/types";
import {
  districtArt,
  districtIcon,
  pricePlaque,
  projectIcon,
  rarityIcon,
  rarityRibbon,
  statIcon,
} from "../assets/cards";
import { ResourceText } from "./ResourceIcon";

/* Общая форма карточки объекта: и на рынке, и в своём городе.
 *
 * Один и тот же объект должен выглядеть одинаково до и после покупки — иначе игрок
 * заново ищет, где что написано, когда карта переезжает с рынка в город.
 *
 * Лицо карточки — не лист правил, а ответ на вопрос «что это даст мне сейчас». Четыре
 * поля с фиксированными местами: деньги за раунд, влияние сразу, влияние за раунд, особый
 * бонус. Условия и синергии уже сложены в эти числа движком; сами формулировки живут в
 * подробностях по нажатию, а на лице остаётся только сноска, сколько условий не выполнено.
 */

/* Один источник правды на редкость — токены темы, а не копия хексов здесь. Копия уже
 * разъезжалась с theme.css: карточка красилась одним набором, легенда в галерее другим. */
const rarityColor: Record<string, string> = {
  common: "var(--color-rar-common)",
  uncommon: "var(--color-rar-uncommon)",
  rare: "var(--color-rar-rare)",
  epic: "var(--color-rar-epic)",
  legendary: "var(--color-rar-legendary)",
};

export const assetRarityColor = (rarity: string): string => rarityColor[rarity] ?? rarityColor.common;

export interface AssetFaceSummary {
  /** Что покупка даёт один раз: «+2◆», «+2$», «+1 Крыша», «карта». */
  oneTime: string[];
  /** Постоянные особые свойства — короткими ярлыками. */
  unique: string[];
  /** Полные формулировки особых свойств — для подсказки. */
  uniqueText: string[];
  /** Собственные условия карты, которые сейчас не выполнены: они не входят в числа на лице. */
  hidden: number;
}

/**
 * Сводка для лица карточки. Числа дохода сюда не входят — их считает движок (`preview` у слота
 * рынка, `asset_yields` у своего объекта). Здесь только напечатанное на карте: разовая
 * награда за покупку и особые свойства, которые действуют без условий.
 */
export function assetFaceSummary(asset: AssetMeta, lines: AssetEffectLine[]): AssetFaceSummary {
  const purchase = (asset.effects?.purchase ?? {}) as {
    money?: number;
    influence?: number;
    roofs?: number;
    card?: boolean;
  };
  const oneTime: string[] = [];
  // Влияние покупки и напечатанное влияние объекта движок начисляет одним моментом.
  const influence = asset.influence + (purchase.influence ?? 0);
  if (influence) oneTime.push(`+${influence}◆`);
  if (purchase.money) oneTime.push(`${purchase.money > 0 ? "+" : "−"}${Math.abs(purchase.money)}$`);
  if (purchase.roofs) oneTime.push(tr("game", "ui.asset.roof", { count: purchase.roofs }));
  if (purchase.card) oneTime.push(tr("game", "ui.asset.card"));

  const passive = lines.filter(line => line.kind === "passive");
  return {
    oneTime,
    unique: passive.map(line => line.short),
    uniqueText: passive.map(line => line.text),
    // Общие правила района одинаковы для всех карт района и объяснены в подробностях;
    // сноска считает только то, что написано на этой карте.
    hidden: lines.filter(line => line.kind === "object" && !line.active).length,
  };
}

/** Значок справа от полей: уходит, метки, счётчик района, цена продажи. */
export interface AssetBullet {
  key: string;
  icon: string;
  text: string;
  title: string;
  tone?: "warn" | "good" | "bad" | "dim";
}

const bulletTone: Record<NonNullable<AssetBullet["tone"]>, string> = {
  warn: "text-warning",
  good: "text-good",
  bad: "text-bad",
  dim: "text-ink-dim",
};


const signed = (value: number, unit: string): string => `${value >= 0 ? "+" : "−"}${Math.abs(value)}${unit}`;

export function AssetFace({
  asset,
  district,
  lines,
  income,
  price,
  bullets,
  owned = false,
}: {
  asset: AssetMeta;
  district: DistrictMeta | undefined;
  lines: AssetEffectLine[];
  /** Доход за раунд от движка: прибавка при покупке на рынке, доля объекта в городе. */
  income: AssetYield;
  /** Плашка цены — только на рынке. `short` красит её, когда денег не хватает. */
  price?: { value: number; short: boolean };
  bullets: AssetBullet[];
  /** Объект уже куплен: разовая награда получена и показывается приглушённо. */
  owned?: boolean;
}) {
  const portrait = useIsPortrait();
  const { t } = useTranslation("game");
  const summary = assetFaceSummary(asset, lines);
  const points = asset.points ?? 0;
  const star = statIcon("score");
  const icon = districtIcon(district?.id);

  /* Вертикально карточка краткая: цена, название, очки и доход. Всё остальное — по нажатию.
   * Мобильная раскладка будет пересобрана отдельно, здесь она только не должна ломаться. */
  if (portrait) {
    return (
      <>
        <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1">
          {price ? (
            <b className={`text-3xs font-bold ${price.short ? "text-bad" : "text-gold"}`}><ResourceText>{`${price.value}$`}</ResourceText></b>
          ) : (
            <span />
          )}
          {icon ? <img src={icon} alt={district?.title} className="mx-auto size-3.5" /> : <span />}
          <span className="flex items-center gap-0.5 text-3xs font-bold text-points">
            {star && <img src={star} alt="" className="size-2.5" />}
            {points}
          </span>
        </span>
        <h3 className="overflow-hidden text-[11px] leading-[1.15] font-semibold text-ink">{asset.title}</h3>
        <span className="flex items-center gap-1.5 overflow-hidden text-3xs whitespace-nowrap">
          <b className={income.money ? "font-bold text-money" : "text-ink-dim"}><ResourceText>{signed(income.money, "$")}</ResourceText></b>
          {income.influence !== 0 && <b className="font-bold text-influence"><ResourceText>{signed(income.influence, "◆")}</ResourceText></b>}
          {summary.unique.length > 0 && <span className="text-ink-dim">✦</span>}
        </span>
        <span className="flex items-center gap-1 overflow-hidden text-3xs whitespace-nowrap text-ink-dim">
          {bullets.map(bullet => (
            <span key={bullet.key} title={bullet.title} className={bullet.tone ? bulletTone[bullet.tone] : ""}>
              <ResourceText>{bullet.icon}</ResourceText>
              <ResourceText>{bullet.text}</ResourceText>
            </span>
          ))}
        </span>
      </>
    );
  }

  const ribbon = rarityRibbon(asset.rarity);
  const gem = rarityIcon(asset.rarity);
  const rarity = rarityLabels[asset.rarity] ?? asset.rarity;

  return (
    <>
      {/* Цена, название, редкость — одна строка, как в макете. */}
      <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        {price ? (
          <b
            className={`asset-price card-serif grid h-[21px] min-w-[40px] place-items-center px-1.5 text-[13px]
              leading-none ${price.short ? "text-bad" : ""}`}
            style={pricePlaque ? { backgroundImage: `url(${pricePlaque})` } : undefined}
            title={price.short ? t("ui.asset.priceShort") : t("ui.asset.priceMine")}
          >
            <ResourceText>{`${price.value}$`}</ResourceText>
          </b>
        ) : (
          <span />
        )}
        <h3
          title={asset.title}
          className="card-serif line-clamp-2 min-w-0 overflow-hidden text-[13.5px] leading-[1.08]"
        >
          {asset.title}
        </h3>
        <span
          data-rarity={asset.rarity}
          className="asset-ribbon flex h-[17px] items-center gap-0.5 px-2.5 text-[8px] font-bold uppercase"
          style={ribbon ? { backgroundImage: `url(${ribbon})` } : undefined}
          title={t("ui.asset.rarity", { rarity })}
        >
          {gem && <img src={gem} alt="" className="size-2.5" />}
          {rarity}
        </span>
      </span>

      {/* Теги слева, сноска о скрытых условиях — под лентой редкости. */}
      <span className="flex min-w-0 items-center gap-1 overflow-hidden text-3xs">
        {asset.tags.map(tag => (
          <span key={tag} className="asset-tag shrink-0 rounded-full px-1.5 font-semibold text-ink-muted">
            {tagLabel(tag)}
          </span>
        ))}
        {summary.hidden > 0 && (
          <span
            className="ml-auto shrink-0 whitespace-nowrap font-semibold text-[var(--card-district)]"
            title={t("ui.asset.conditionsTitle")}
          >
            {t("ui.asset.conditions", { count: summary.hidden })}
          </span>
        )}
      </span>

      {/* Четыре поля на своих местах: деньги и влияние за раунд слева, разовое и особое справа.
        * Пустое поле приглушено, а не убрано — шесть карт сравниваются одним взглядом. */}
      <span className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <span className="asset-fields grid min-h-0 min-w-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-md">
          <Field icon={statIcon("money")} empty={income.money === 0} title={t("ui.asset.moneyTitle")} label={t("ui.asset.moneyEmpty")}>
            <b className="text-[13px] text-money"><ResourceText>{signed(income.money, "$")}</ResourceText></b>
            <small>{t("ui.asset.perRound")}</small>
          </Field>
          <Field
            icon={statIcon("influence")}
            empty={summary.oneTime.length === 0}
            faded={owned}
            label={t("ui.asset.oneTime")}
            title={owned ? t("ui.asset.oneTimeOwned") : t("ui.asset.oneTimeMarket")}
          >
            <b className="min-w-0 overflow-hidden text-ellipsis text-[12px] text-influence">
              {summary.oneTime.length ? <ResourceText>{summary.oneTime.join(", ")}</ResourceText> : "—"}
            </b>
            <small>{owned ? t("ui.asset.received") : t("ui.asset.now")}</small>
          </Field>
          <Field icon={statIcon("influence")} empty={income.influence === 0} title={t("ui.asset.influenceTitle")} label={t("ui.asset.influenceEmpty")}>
            <b className="text-[13px] text-influence"><ResourceText>{signed(income.influence, "◆")}</ResourceText></b>
            <small>{t("ui.asset.perRound")}</small>
          </Field>
          <Field
            icon={projectIcon("unique")}
            empty={summary.unique.length === 0}
            label={t("ui.asset.unique")}
            title={summary.uniqueText.join("\n") || t("ui.asset.noUnique")}
          >
            <b className="line-clamp-2 min-w-0 text-[10px] leading-[1.15] whitespace-normal text-[var(--color-badge)]">
              {summary.unique.length ? <ResourceText>{summary.unique.join(" · ")}</ResourceText> : "—"}
            </b>
          </Field>
        </span>

        {bullets.length > 0 && (
          <ul className="grid content-center gap-0.5 text-3xs leading-tight">
            {bullets.map(bullet => (
              <li
                key={bullet.key}
                title={bullet.title}
                className={`flex items-center gap-1 whitespace-nowrap font-semibold ${
                  bullet.tone ? bulletTone[bullet.tone] : "text-ink-muted"
                }`}
              >
                <span className="text-ink-dim">•</span>
                <span><ResourceText>{bullet.icon}</ResourceText></span>
                <ResourceText>{bullet.text}</ResourceText>
              </li>
            ))}
          </ul>
        )}
      </span>

      {/* Очки и район — нижняя строка карточки. */}
      <span className="asset-footer grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 pt-1">
        <span className="flex items-center gap-1 whitespace-nowrap" title={t("ui.asset.pointsTitle")}>
          {star && <img src={star} alt="" className="size-4" />}
          <b className="card-serif text-[15px] leading-none">{points}</b>
          <small className="text-2xs text-ink-muted">{t("ui.asset.points")}</small>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1 overflow-hidden border-l border-line pl-2
          text-2xs font-semibold text-[var(--card-district)]">
          {icon && <img src={icon} alt="" className="size-4 shrink-0" />}
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{district?.title}</span>
        </span>
      </span>
    </>
  );
}

function Field({
  icon,
  empty,
  faded = false,
  title,
  label,
  children,
}: {
  icon: string | undefined;
  empty: boolean;
  /** Подпись пустого поля: что здесь было бы. */
  label: string;
  faded?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      data-empty={empty || undefined}
      className={`asset-field flex min-w-0 items-center gap-1.5 overflow-hidden px-1.5 whitespace-nowrap
        [&_small]:text-3xs [&_small]:font-semibold [&_small]:text-ink-dim ${empty || faded ? "opacity-45" : ""}`}
    >
      {icon && <img src={icon} alt="" className={`size-[18px] shrink-0 ${empty ? "grayscale" : ""}`} />}
      {empty ? (
        <b className="text-[12px] text-ink-dim">—</b>
      ) : (
        <span className="flex min-w-0 items-baseline gap-1">{children}</span>
      )}
      {empty && <small className="overflow-hidden text-ellipsis"><ResourceText>{label}</ResourceText></small>}
    </span>
  );
}

/** Общая обвязка: цвета района и редкости, иллюстрация района на фоне. */
export function assetFaceStyle(districtColor: string | undefined, rarity: string, district?: string): CSSProperties {
  const art = districtArt(district);
  return {
    ...(art ? { "--asset-art": `url(${art})` } : {}),
    "--dc": districtColor ?? "var(--color-line)",
    "--rc": assetRarityColor(rarity),
  } as CSSProperties;
}

/* Бумага с улицей района справа; тонкая рамка целиком принадлежит редкости. */
export const assetFaceGrid = `game-card asset-card grid h-full w-full min-h-0 min-w-0
  grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-1
  rounded-card border border-[var(--rc)]
  px-2.5 pt-1.5 pb-1 text-left`;

/** Та же карточка вертикально: четыре зоны, поля вдвое уже. */
export const assetFaceGridPortrait = `game-card asset-card grid h-full w-full min-h-0 min-w-0
  grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-0.5
  rounded-card border border-[var(--rc)]
  px-1 py-1 text-left`;
