import type { CSSProperties, ReactNode } from "react";
import { rarityLabels, type AssetEffectLine } from "../../online/gameUi";
import { useIsPortrait } from "../lib/layout";
import type { AssetMeta, DistrictMeta } from "../../online/types";

/* Общая форма карточки объекта: и на рынке, и в своём городе.
 *
 * Один и тот же объект должен выглядеть одинаково до и после покупки — иначе игрок
 * заново ищет, где что написано, когда карта переезжает с рынка в город. Различаются
 * только верхний правый угол (цена/очки против состояния) и нижняя строка.
 *
 * Зоны сверху вниз: категория и теги, название с очками, экономика, условия, состояние.
 * Цвет остаётся у семантических чисел и небольших маркеров, а не у поверхности целиком.
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

/* На светлой карточке пастель рамки слишком бледна для мелкой надписи. Подпись получает
 * отдельный, насыщенный цвет той же редкости; у обычной карты это почти чёрный. */
const rarityTextColor: Record<string, string> = {
  common: "#171717",
  uncommon: "#17713d",
  rare: "#1d5f9f",
  epic: "#713b9e",
  legendary: "#ad5908",
};

export const assetRarityColor = (rarity: string): string => rarityColor[rarity] ?? rarityColor.common;

export const ASSET_FACE_EFFECT_CAP = 4;

/**
 * Лицевая сторона — резюме, не полный лист правил. Общие правила района всегда остаются
 * в раскрытии; уникальные свойства приоритетнее, а при переполнении одна из четырёх ячеек
 * резервируется под явный переход к полному описанию.
 */
export function assetFaceEffectSummary(lines: AssetEffectLine[]): {
  visible: AssetEffectLine[];
  hidden: number;
  standard: number;
} {
  const priority: Record<AssetEffectLine["kind"], number> = {
    purchase: 0,
    passive: 1,
    object: 2,
    district: 3,
    sector: 4,
  };
  const unique = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.kind !== "district" && line.kind !== "sector")
    .sort((left, right) =>
      priority[left.line.kind] - priority[right.line.kind]
      || Number(right.line.active) - Number(left.line.active)
      || left.index - right.index,
    )
    .map(({ line }) => line);
  const standard = lines.length - unique.length;
  const needsOverflow = unique.length > ASSET_FACE_EFFECT_CAP;
  const limit = needsOverflow ? ASSET_FACE_EFFECT_CAP - 1 : ASSET_FACE_EFFECT_CAP;
  const visible = unique.slice(0, limit);
  return { visible, hidden: unique.length - visible.length, standard };
}

export function AssetFace({
  asset,
  district,
  lines,
  topLeft,
  topRight,
  bottom,
  income,
  influence,
}: {
  asset: AssetMeta;
  district: DistrictMeta | undefined;
  lines: AssetEffectLine[];
  topLeft: ReactNode;
  topRight: ReactNode;
  bottom: ReactNode;
  /** Доход и влияние показываются в таблице свойств первыми строками. */
  income: number;
  influence: number;
}) {
  /* Вертикально карточка та же по сетке, но краткая по содержанию: на телефоне все шесть
   * слотов рынка и все шесть слотов города должны быть видны сразу, без прокрутки — иначе
   * решение «купить или подождать» принимается по половине доски. Поэтому от карточки
   * остаётся то, по чему выбирают: цена, очки, название и доход. Редкость несёт рамка, а
   * теги, синергии и условия — поповер по нажатию. */
  const portrait = useIsPortrait();
  const summary = assetFaceEffectSummary(lines);

  if (portrait) {
    return (
      <>
        <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1">
          {topLeft}
          <span className="overflow-hidden text-center text-ellipsis whitespace-nowrap text-3xs
            font-bold text-[var(--card-district)]">
            {district?.icon}
          </span>
          {topRight}
        </span>

        <h3 className="overflow-hidden text-[11px] leading-[1.15] font-semibold text-ink">
          {asset.title}
        </h3>

        <span className="flex items-center gap-1.5 overflow-hidden text-3xs whitespace-nowrap">
          {income > 0 && <b className="font-bold text-money">+{income}$</b>}
          {influence > 0 && <b className="font-bold text-influence">+{influence}◆</b>}
          {summary.visible[0] ? (
            <span className="overflow-hidden text-ellipsis text-ink-dim" title={summary.visible[0].text}>
              {summary.visible[0].short}
            </span>
          ) : summary.hidden > 0 && (
            <span className="text-ink-dim">↗ {summary.hidden} эффекта</span>
          )}
        </span>

        {bottom}
      </>
    );
  }

  return (
    <>
      {/* Категория и служебные метки — тихая строка над названием. */}
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-3xs">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-bold
          uppercase tracking-wide text-[var(--card-district)]">
          {district?.icon} {district?.title}
        </span>
        {asset.tags.map(tag => (
          <span
            key={tag}
            className="shrink-0 rounded bg-panel-3 px-1 font-semibold lowercase text-ink-muted"
          >
            {tag}
          </span>
        ))}
        <span
          className="ml-auto shrink-0 rounded border border-[var(--rc)] bg-panel px-1 font-bold
            uppercase tracking-wide text-[var(--rt)]"
          title={`Редкость: ${rarityLabels[asset.rarity] ?? asset.rarity}`}
        >
          {rarityLabels[asset.rarity] ?? asset.rarity}
        </span>
      </span>

      {/* Название и очки получают отдельный ярус, чтобы метрики не давили на категорию. */}
      <span className="flex min-w-0 items-start gap-2">
        <h3 className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]
          font-semibold leading-tight text-ink">
          {asset.title}
        </h3>
        {topRight}
      </span>

      {/* Экономика — одна спокойная плашка по центру карточки. */}
      <span className="flex min-h-[27px] min-w-0 items-center gap-2 rounded-md bg-panel px-2 py-1
        text-[10.5px]">
        {topLeft}
        {topLeft && income > 0 && <span className="h-3 w-px bg-line" />}
        {income > 0 && (
          <b className="whitespace-nowrap font-semibold text-money">
            +{income}$ <small className="font-normal text-ink-dim">за раунд</small>
          </b>
        )}
        {influence > 0 && (
          <b className="whitespace-nowrap font-semibold text-influence">
            +{influence}◆ <small className="font-normal text-ink-dim">разово</small>
          </b>
        )}
      </span>

      {/* Две строки — жёсткий контракт лица карты. Полные правила района и хвост сложных
        * объектов находятся в поповере; поэтому никакой объём контента не меняет высоту. */}
      <span className="grid min-h-0 min-w-0 grid-cols-2 grid-rows-2 content-start gap-x-3 gap-y-1
        overflow-hidden text-3xs leading-tight">
        {summary.visible.length === 0 && summary.hidden === 0 && income === 0 && influence === 0 && (
          <span className="col-span-2 text-ink-dim">Без условий и синергий</span>
        )}
        {summary.visible.map((line, position) => (
          <span
            key={position}
            title={line.text}
            className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${
              line.active ? "font-semibold text-good" : "text-ink-muted"
            }`}
          >
            <span className={line.active ? "text-good" : "text-ink-dim"}>{line.active ? "✓" : "·"}</span>{" "}
            {line.short}
            {line.boosted && <span className="text-gold"> ⚙×2</span>}
          </span>
        ))}
        {summary.hidden > 0 && (
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold
            text-[var(--card-district)]" title="Нажмите на карточку, чтобы увидеть все эффекты">
            ↗ ещё {summary.hidden} · открыть
          </span>
        )}
      </span>

      {bottom}
    </>
  );
}

/** Общая обвязка: сетка зон, цвета района и редкости. */
export function assetFaceStyle(districtColor: string | undefined, rarity: string): CSSProperties {
  return {
    "--dc": districtColor ?? "var(--color-line)",
    "--rc": assetRarityColor(rarity),
    "--rt": rarityTextColor[rarity] ?? rarityTextColor.common,
  } as CSSProperties;
}

/* Бежевая поверхность отделяет игровой объект от интерфейса, а тонкая рамка целиком
 * принадлежит редкости. Наведение меняет только тон бумаги и не стирает этот сигнал. */
export const assetFaceGrid = `game-card grid h-full w-full min-h-0 min-w-0
  grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-1.5
  rounded-card border border-[var(--rc)] bg-panel-2
  px-2.5 py-2 text-left transition-colors hover:bg-panel-3`;

/** Та же карточка вертикально: четыре зоны вместо пяти, поля вдвое уже. */
export const assetFaceGridPortrait = `game-card grid h-full w-full min-h-0 min-w-0
  grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-0.5
  rounded-card border border-[var(--rc)] bg-panel-2
  px-1 py-1 text-left transition-colors hover:bg-panel-3`;
