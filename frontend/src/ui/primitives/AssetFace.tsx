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
 * Зоны сверху вниз:
 *   1. лево | район | право   — числа стоят на одном месте у всех карточек
 *   2. название
 *   3. редкость и теги
 *   4. доход и синергии — три строки, заполнение по столбцам
 *   5. нижняя строка
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

/** Толщина рамки редкости. Внутренняя тень, а не бордер: не участвует в раскладке. */
const rarityRing = "inset 0 0 0 2px var(--rc)";

/* Легендарная получает мягкое свечение, эпическая — послабее, остальные только рамку и бейдж.
 * Ступенька в оформлении, а не только в цвете: две верхние редкости должны быть видны с другого
 * конца доски, не считываясь как «просто ещё один оттенок». */
const rarityGlow: Record<string, string> = {
  epic: "0 0 10px -2px color-mix(in srgb, var(--rc), transparent 55%)",
  legendary: "0 0 14px -2px color-mix(in srgb, var(--rc), transparent 40%)",
};

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
  /* Вертикально карточка вдвое уже, и два столбца свойств превращаются в два многоточия.
   * Один столбец на те же четыре строки: видно вчетверо меньше строк, зато каждая целиком,
   * а остальные — в поповере по нажатию, куда на телефоне и так приходится ходить. */
  const portrait = useIsPortrait();

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
        {/* Бейдж, а не просто цветное слово: третий носитель редкости после рамки и
          * градиента. Цветное слово в общем ряду с тегами читалось как ещё один тег. */}
        <span
          className="shrink-0 rounded border px-1 font-bold uppercase tracking-wide
            border-[var(--rc)] bg-[color-mix(in_srgb,var(--rc),transparent_82%)] text-[var(--rc)]"
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
        * 4×2 = восемь мест, и в них помещается 70 объектов каталога из 71: у остальных максимум
        * семь строк. Единственное исключение — «Центр городского управления» с девятью: четыре
        * связи районов плюс синергии; девятая строка уйдёт в поповер, ради одной карты сжимать
        * остальные семьдесят не стоит.
        *
        * Влезает это только потому, что в ячейке стоит `line.short` — ярлык вроде «Мафиози +1$»,
        * а не фраза «+1$ пока вы „Мафиози“ (синергия сектора)», от которой оставалась половина.
        *
        * Разделители рисуют сами ячейки, а не фон-подложка: подложка красила бы и пустые
        * клетки сетки. */}
      <span
        className={`grid min-h-0 min-w-0 grid-rows-4 content-start overflow-hidden text-3xs
          leading-tight
          [&>*]:min-w-0 [&>*]:overflow-hidden [&>*]:text-ellipsis [&>*]:whitespace-nowrap
          [&>*]:border-b [&>*]:border-r [&>*]:border-line/70 [&>*]:px-1 [&>*]:py-px
          ${portrait ? "grid-cols-1" : "grid-flow-col grid-cols-2"}`}
      >
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
            {/* Ярлык, а не полная фраза: ячейка не переносится и режется многоточием, а полный
              * текст лежит во всплывающей подсказке ячейки и в поповере карточки. */}
            {line.short}
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
    "--dc": districtColor ?? "var(--color-line)",
    "--rc": assetRarityColor(rarity),
    /* Редкость — свечением от краёв к центру, а не точкой в углу: цвет читается
     * боковым зрением, точку же надо было искать и сверять с легендой. */
    backgroundImage:
      "radial-gradient(115% 80% at 50% 50%, transparent 28%, color-mix(in srgb, var(--rc), transparent 58%) 100%)",
    /* Толщина рамки — внутренней тенью поверх 1px бордера, а не самим бордером.
     *
     * Тень не участвует в раскладке, поэтому редкость читается тремя пикселями, а карточка
     * внутри остаётся ровно того же размера, что и до перекраски. Настоящий `border-[3px]`
     * забирал по 2px сверху и снизу, и таблица свойств — четыре фиксированные строки на
     * `minmax(0,1fr)` — переставала помещаться: строки наезжали друг на друга.
     */
    boxShadow: [rarityRing, rarityGlow[rarity]].filter(Boolean).join(", "),
  } as CSSProperties;
}

/* Внешняя рамка принадлежит редкости целиком, и только ей.
 *
 * Раньше левый край в 3px красился районом, а редкость жила в градиенте и маленькой
 * подписи — то есть цвет по краю карточки означал то одно, то другое, и система была
 * неоднозначной. Район никуда не делся: он стоит иконкой и названием в первой строке
 * карточки, где его и читают. Наведение поднимает подложку на ступень (--color-panel-3),
 * а не перекрашивает рамку — иначе оно стирало бы редкость ровно в тот момент, когда
 * игрок разглядывает карточку.
 */
/* Рамка редкости рисуется внутренней тенью, а не толстой рамкой — см. `rarityRing` в
 * `assetFaceStyle`. Здесь остаётся ровно 1px, как было до перекраски: `border-[3px]` по всему
 * периметру забирал у карточки 4px высоты, а таблица свойств стоит на `minmax(0,1fr)` и четырёх
 * фиксированных строках — эти 4px её и переполняли, строки наезжали друг на друга. */
export const assetFaceGrid = `grid h-full w-full min-h-0 min-w-0
  grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-1
  rounded-card border border-[var(--rc)] bg-panel-2
  px-2 py-1.5 text-left transition-colors hover:bg-panel-3`;
