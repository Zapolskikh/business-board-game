/* Скриншоты интерфейса для книги правил: те же, что в печатной версии правил.
 * Интерфейс на них русский, поэтому их показывает только русская книга. */
const files = import.meta.glob<string>("./*.webp", { eager: true, import: "default" });

export type RulesShot =
  | "hud"
  | "market"
  | "city"
  | "market-card"
  | "card-details"
  | "owned-card"
  | "project-board"
  | "project-card"
  | "project-price"
  | "project-bonus"
  | "reroll"
  | "actions";

export const rulesShot = (name: RulesShot): string | undefined => files[`./${name}.webp`];
