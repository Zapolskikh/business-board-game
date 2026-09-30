import type { RulesChapter } from "../../online/rulesDocument";

/* Поиск по книге правил.
 *
 * Работает по строкам, а не по DOM: главы приходят строками разметки, и так поиск можно
 * проверить тестом без браузера. «Е» и «ё» считаются одной буквой, регистр не важен —
 * иначе «ещё» не находится по «еще», а так пишет большинство.
 */

export const MIN_QUERY = 2;

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Текст главы без тегов и сущностей — то, что видит читатель. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => entities[name])
    .replace(/\s+/g, " ")
    // Теги заменены пробелами, и у знаков препинания после них остаётся лишний: «действий : гасит».
    .replace(/\s+([,.;:!?»)])/g, "$1")
    .replace(/([«(])\s+/g, "$1")
    .trim();
}

/** Шаблон запроса: спецсимволы экранированы, «е» совпадает и с «ё». */
function pattern(query: string): RegExp | null {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY) return null;
  const source = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[её]/gi, letter => (letter === letter.toUpperCase() ? "[ЕЁ]" : "[её]"))
    .replace(/\s+/g, "\\s+");
  return new RegExp(source, "giu");
}

export interface RulesHit {
  chapter: number;
  count: number;
  /** До трёх фрагментов вокруг совпадений: текст до, само совпадение, текст после. */
  snippets: { before: string; match: string; after: string }[];
}

const SNIPPET_SIDE = 48;
const SNIPPETS_PER_CHAPTER = 3;

export function searchRules(chapters: RulesChapter[], query: string): RulesHit[] {
  const regex = pattern(query);
  if (!regex) return [];
  const hits: RulesHit[] = [];
  chapters.forEach((chapter, index) => {
    // Заголовок главы — тоже текст книги: «Крыша» должна находить главу «Крыша и защита».
    const text = `${chapter.title}. ${plainText(chapter.html)}`;
    const matches = [...text.matchAll(regex)];
    if (!matches.length) return;
    hits.push({
      chapter: index,
      count: matches.length,
      snippets: matches.slice(0, SNIPPETS_PER_CHAPTER).map(match => {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const from = Math.max(0, start - SNIPPET_SIDE);
        const to = Math.min(text.length, end + SNIPPET_SIDE);
        return {
          before: (from > 0 ? "…" : "") + text.slice(from, start),
          match: match[0],
          after: text.slice(end, to) + (to < text.length ? "…" : ""),
        };
      }),
    });
  });
  return hits;
}

/** Разметка главы с подсвеченными совпадениями. Теги не трогаются — подсвечивается только текст. */
export function highlightHtml(html: string, query: string): string {
  const regex = pattern(query);
  if (!regex) return html;
  return html.replace(/(<[^>]+>)|([^<]+)/g, (whole, tag: string | undefined, text: string | undefined) =>
    tag ? tag : (text ?? whole).replace(regex, found => `<mark class="rules-hit">${found}</mark>`),
  );
}
