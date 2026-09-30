/* Ссылки поддержки проекта — единственное место, где они записаны.
 *
 * Пока ссылка пустая, иконка на главной показывается приглушённой с подписью «скоро»:
 * страницы на Boosty и Patreon ещё не созданы. Вставьте адрес — иконка оживёт сама.
 */
export const supportLinks: { id: "boosty" | "patreon"; title: string; url: string }[] = [
  { id: "boosty", title: "Boosty", url: "" },
  { id: "patreon", title: "Patreon", url: "" },
];

/** Адрес страницы обратной связи. Через параметр, а не путь: он открывается на любом хостинге. */
export const FEEDBACK_URL = "/?page=feedback";
