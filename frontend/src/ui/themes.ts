import type { CSSProperties } from "react";

/* Темы доски.
 *
 * Таблица ниже — единственное место, где живут цвета тем. Строка — элемент интерфейса,
 * столбец — тема. Чтобы поправить цвет, меняется одна ячейка; чтобы добавить тему — столбец
 * (и строка в `themes`); чтобы добавить элемент — строка и её CSS-переменная в `rowVariables`.
 *
 * Карточки (объекты, проекты, игроки) от темы не зависят: это бумага на столе, у неё своя
 * палитра в theme.css (`.game-card`). Окна, которые открываются по нажатию, пока тоже живут
 * на старой тёмной палитре.
 */

export type ThemeId = "dark" | "green" | "limestone" | "blue" | "plum";

export const themes: { id: ThemeId; title: string; tone: "dark" | "light" }[] = [
  { id: "blue", title: "Пыльный синий", tone: "dark" },
  { id: "green", title: "Зелёная", tone: "dark" },
  { id: "limestone", title: "Известняк", tone: "light" },
  { id: "plum", title: "Сливовая", tone: "dark" },
  { id: "dark", title: "Тёмная", tone: "dark" },
];

export const DEFAULT_THEME: ThemeId = "blue";

type Row = Record<ThemeId, string>;

//                                    Тёмная      Зелёная     Известняк   Пыльный синий  Сливовая
export const palette = {
  /** Общий фон */
  background: /*                */ { dark: "#0D1014", green: "#243A35", limestone: "#C6BDAE", blue: "#354B60", plum: "#483F4C" },
  /** Фон областей */
  area: /*                      */ { dark: "#191E25", green: "#304740", limestone: "#D8D0C3", blue: "#415B70", plum: "#594D59" },
  /** Шапка */
  header: /*                    */ { dark: "#12161C", green: "#1D302B", limestone: "#B9AE9D", blue: "#2D4053", plum: "#3D3541" },
  /** Пустые слоты */
  slot: /*                      */ { dark: "#13181E", green: "#293E37", limestone: "#C9C0B2", blue: "#344B60", plum: "#504652" },
  /** Кнопки */
  button: /*                    */ { dark: "#252D37", green: "#3A554B", limestone: "#C4B8A6", blue: "#49657C", plum: "#655665" },
  /** Кнопки при наведении */
  buttonHover: /*               */ { dark: "#333E4B", green: "#49685B", limestone: "#D3C7B5", blue: "#58778F", plum: "#766576" },
  /** Тонкие границы */
  border: /*                    */ { dark: "#39434F", green: "#58685B", limestone: "#A3937D", blue: "#627C90", plum: "#80707E" },
  /** Основной текст */
  text: /*                      */ { dark: "#F0ECE3", green: "#F0EBDD", limestone: "#372F29", blue: "#F0ECE3", plum: "#F0E7DC" },
  /** Второстепенный текст */
  textMuted: /*                 */ { dark: "#ADB5BF", green: "#BCC8BE", limestone: "#65594B", blue: "#C0CED8", plum: "#D0C2CB" },
  /** Главная кнопка */
  primary: /*                   */ { dark: "#D0AB65", green: "#D0AB65", limestone: "#99583E", blue: "#D0AB65", plum: "#AD8062" },
  /** Текст главной кнопки */
  primaryText: /*               */ { dark: "#241C12", green: "#241C12", limestone: "#FFF8EE", blue: "#241C12", plum: "#211810" },
} satisfies Record<string, Row>;

export type PaletteRow = keyof typeof palette;

/* Какие токены темы (theme.css) заполняет каждая строка. Компоненты пишут `bg-panel`,
 * `border-line`, `text-ink` — и получают цвет выбранной темы без единой правки. */
const rowVariables: Record<PaletteRow, string[]> = {
  background: ["--color-surface"],
  area: [
    "--color-panel",
    "--color-zone-players",
    "--color-zone-projects",
    "--color-zone-market",
    "--color-zone-city",
    "--color-zone-actions",
    "--color-zone-chronicle",
  ],
  header: ["--color-topbar"],
  slot: ["--color-slot"],
  button: ["--color-panel-2"],
  buttonHover: ["--color-panel-3"],
  border: ["--color-line"],
  text: ["--color-ink"],
  textMuted: ["--color-ink-muted"],
  primary: ["--color-primary"],
  primaryText: ["--color-primary-ink"],
};

/* Цвета смысла (деньги, влияние, очки, «хорошо/плохо») в таблице не заданы: у тёмных тем
 * они общие и лежат в theme.css. Светлой теме пастель не годится — ей нужен тот же
 * насыщенный набор, что у бумажных карточек. */
const lightSemantic: Record<string, string> = {
  "--color-good": "#2f704e",
  "--color-bad": "#a33f49",
  "--color-gold": "#8c5d0a",
  "--color-warning": "#975326",
  "--color-badge": "#4f5d66",
  "--color-money": "#2e7045",
  "--color-influence": "#4e6092",
  "--color-points": "#754d84",
  "--color-defence": "#2f6378",
  "--color-accent": "#5a6f85",
};

export function themeStyle(id: ThemeId): CSSProperties {
  const theme = themes.find(item => item.id === id) ?? themes[0];
  const vars: Record<string, string> = {};
  for (const [row, names] of Object.entries(rowVariables) as [PaletteRow, string[]][]) {
    for (const name of names) vars[name] = palette[row][theme.id];
  }
  // Производные оттенки: вторая граница и третий уровень текста — из тех же ячеек.
  vars["--color-line-2"] = `color-mix(in srgb, ${palette.border[theme.id]} 70%, ${palette.text[theme.id]})`;
  vars["--color-ink-dim"] = `color-mix(in srgb, ${palette.textMuted[theme.id]} 72%, ${palette.area[theme.id]})`;
  // Заголовки зон в этом формате одного цвета — второстепенный текст темы.
  for (const zone of ["players", "projects", "market", "city", "actions", "chronicle"]) {
    vars[`--color-zone-${zone}-accent`] = palette.textMuted[theme.id];
  }
  if (theme.tone === "light") Object.assign(vars, lightSemantic);
  return { ...vars, colorScheme: theme.tone } as CSSProperties;
}
