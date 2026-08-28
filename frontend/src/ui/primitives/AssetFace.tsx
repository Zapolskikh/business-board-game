import type { CSSProperties, ReactNode } from "react";
import { rarityLabels, type AssetEffectLine } from "../../online/gameUi";
import type { AssetMeta, DistrictMeta } from "../../online/types";

/* Общая форма карточки объекта: и на рынке, и в своём городе.
 *
 * Один и тот же объект должен выглядеть одинаково до и после покупки — иначе игрок
 * заново ищет, где что написано, когда карта переезжает с рынка в город. Различаются
 * только верхний правый угол (цена/очки против состояния) и нижняя строка.
 *
 * Зоны сверху вниз:
 *   1. лево | район | право   — числа стоят на одном месте у всех карточек
 *   2. название
 *   3. редкость и теги
 *   4. доход и синергии — три строки, заполнение по столбцам
 *   5. нижняя строка
 */

const rarityColor: Record<string, string> = {
  common: "#9fb3c8",
  uncommon: "#5ec8f0",
  rare: "#b98cff",
  epic: "#ff9a4d",
  legendary: "#ffd45e",
};

export const assetRarityColor = (rarity: string): string => rarityColor[rarity] ?? rarityColor.common;

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
  return (
    <>
      {/* 1 */}
      <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5">
        {topLeft}
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-center text-3xs
          font-bold uppercase tracking-wide text-[var(--dc)]">
          {district?.icon} {district?.title}
        </span>
        {topRight}
      </span>

      {/* 2 */}
      <h3 className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold text-ink">
        {asset.title}
      </h3>

      {/* 3 — теги на лице карточки потому, что по ним считаются требования проектов */}
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-3xs">
        <span
          className="shrink-0 font-bold uppercase text-[var(--rc)]"
          title={`Редкость: ${rarityLabels[asset.rarity] ?? asset.rarity}`}
        >
          {rarityLabels[asset.rarity] ?? asset.rarity}
        </span>
        {asset.tags.map(tag => (
          <span
            key={tag}
            className="rounded border border-line-2 bg-panel-3 px-1 font-semibold lowercase text-ink"
          >
            {tag}
          </span>
        ))}
      </span>

      {/* 4 — четыре строки на две равные колонки, заполнение по столбцам: сначала
        * сверху вниз, потом следующий столбец. Колонки ровно пополам (1fr каждая), а не
        * по самой длинной строке: иначе одно длинное свойство съедало почти всю карточку
        * и второй столбец обрезался.
        *
        * 4×2 = восемь мест. По каталогу этого хватает 70 объектам из 71: максимум у остальных
        * — семь строк. Единственное исключение — «Штаб-квартира конгломерата» с девятью; у неё
        * последняя строка уйдёт в поповер — ради одной карты сжимать остальные 70 не стоит.
        *
        * Разделители рисуют сами ячейки, а не фон-подложка: подложка красила бы и пустые
        * клетки сетки. */}
      <span className="grid min-h-0 min-w-0 grid-flow-col grid-cols-2 grid-rows-4
        content-start overflow-hidden text-3xs leading-tight
        [&>*]:min-w-0 [&>*]:overflow-hidden [&>*]:text-ellipsis [&>*]:whitespace-nowrap
        [&>*]:border-b [&>*]:border-r [&>*]:border-line/70 [&>*]:px-1 [&>*]:py-px">
        {income > 0 && <b className="whitespace-nowrap font-bold text-good">+{income}$/раунд</b>}
        {influence > 0 && (
          <b className="whitespace-nowrap font-bold text-[#c9a2ff]">+{influence}◆ разово</b>
        )}
        {lines.length === 0 && income === 0 && influence === 0 && (
          <span className="whitespace-nowrap text-ink">без условий и синергий</span>
        )}
        {lines.map((line, position) => (
          <span
            key={position}
            title={line.text}
            className={`overflow-hidden text-ellipsis whitespace-nowrap font-semibold ${
              line.active ? "text-good" : "text-ink"
            }`}
          >
            {line.active ? "✓ " : "· "}
            {line.text}
            {line.boosted && <span className="text-gold"> ⚙×2</span>}
          </span>
        ))}
      </span>

      {/* 5 */}
      {bottom}
    </>
  );
}

/** Общая обвязка: сетка зон, цвета района и редкости. */
export function assetFaceStyle(districtColor: string | undefined, rarity: string): CSSProperties {
  return {
    "--dc": districtColor ?? "#3a4d63",
    "--rc": assetRarityColor(rarity),
    /* Редкость — свечением от краёв к центру, а не точкой в углу: цвет читается
     * боковым зрением, точку же надо было искать и сверять с легендой. */
    backgroundImage:
      "radial-gradient(115% 80% at 50% 50%, transparent 28%, color-mix(in srgb, var(--rc), transparent 58%) 100%)",
  } as CSSProperties;
}

export const assetFaceGrid = `grid h-full w-full min-h-0 min-w-0
  grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-1
  rounded-card border border-line border-l-[3px] border-l-[var(--dc)] bg-panel-2
  px-2 py-1.5 text-left`;
