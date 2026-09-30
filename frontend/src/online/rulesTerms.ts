import type { CityMeta } from "./types";
import { roleIcon } from "../ui/assets/cards";

/* Значки у терминов в книге правил: «действие ⚡», «очки ★», «скандал ⚠», «Защита 🛡», деньги $,
 * влияние ◆ — и значок роли перед её названием. Так игрок запоминает, как термин выглядит в игре.
 *
 * Правило одно на всю книгу, поэтому расставляется здесь, а не руками в каждой главе. Не трогаем:
 * разметку, заголовки, таблицы (там значки уже в числах), код и всё в кавычках — это названия карт,
 * способностей и глав. Слово и значок склеены неразрывным блоком, чтобы значок не уезжал на
 * следующую строку.
 */

interface Terms {
  /** Слово-форма → значок. Порядок не важен: регулярка берёт самую длинную форму. */
  words: [RegExp, string][];
  /** Слово перед «действием», при котором это название типа карт, а не действие хода. */
  cardsBefore: RegExp;
  quotes: RegExp;
}

const TERMS: Record<string, Terms> = {
  ru: {
    words: [
      [/^действи(?:е|я|й|ем|ями|ям|ях)$/i, "⚡"],
      [/^очк(?:о|а|ов|и|ам|ами|ах)$/i, "★"],
      [/^скандал(?:ы|а|ов|у|ом|ам|ами|ах)?$/i, "⚠"],
      [/^защит(?:а|у|ы|е|ой|ами|ам)?$/i, "🛡"],
      [/^(?:деньг(?:и|ами|ах)|денег)$/i, "$"],
      [/^влияни(?:е|я|ем|ю)$/i, "◆"],
    ],
    cardsBefore: /карт\p{L}*\s+$/iu,
    quotes: /«[^»]*»/g,
  },
  en: {
    words: [
      [/^actions?$/i, "⚡"],
      [/^points?$/i, "★"],
      [/^scandals?$/i, "⚠"],
      [/^protection$/i, "🛡"],
      [/^money$/i, "$"],
      [/^influence$/i, "◆"],
    ],
    cardsBefore: /^$/,
    quotes: /[“"][^”"]*[”"]/g,
  },
  cs: {
    words: [
      [/^akc(?:e|i|í|emi|ím|ích)$/i, "⚡"],
      [/^bod(?:y|ů|u|em|ech|ům)?$/i, "★"],
      [/^skandál(?:y|ů|u|em|ech|ům)?$/i, "⚠"],
      [/^ochran(?:a|u|y|ě|ou)$/i, "🛡"],
      [/^(?:peníze|peněz|penězi|penězům|penězích)$/i, "$"],
      [/^vliv(?:u|em)?$/i, "◆"],
    ],
    cardsBefore: /kar(?:ta|ty|et|tu|tami|tách)\s+$/iu,
    quotes: /„[^“]*“/g,
  },
};

/* «action card» — тип карт: значок действия после него сбивал бы с толку. */
const EN_CARD_AFTER = /^\s+cards?\b/i;

const VOID_TAGS = new Set(["img", "br", "hr", "input", "source"]);
const SKIP_TAGS = new Set(["table", "h1", "h2", "h3", "h4", "h5", "code", "figcaption", "header"]);
const WORD = /\p{L}+/gu;

function roleMatchers(meta: CityMeta): { stem: string; src: string }[] {
  return meta.roles
    .map(role => ({ stem: role.title, src: roleIcon(role.id) ?? "" }))
    .filter(role => role.src && role.stem);
}

function annotateText(text: string, terms: Terms, roles: { stem: string; src: string }[], language: string): string {
  // Кавычки пропускаем целиком: внутри названия карт и способностей.
  let out = "";
  let last = 0;
  for (const quoted of text.matchAll(terms.quotes)) {
    out += annotatePlain(text.slice(last, quoted.index), terms, roles, language) + quoted[0];
    last = (quoted.index ?? 0) + quoted[0].length;
  }
  return out + annotatePlain(text.slice(last), terms, roles, language);
}

function annotatePlain(text: string, terms: Terms, roles: { stem: string; src: string }[], language: string): string {
  return text.replace(WORD, (word, offset: number) => {
    const role = roles.find(item => word.startsWith(item.stem) && word.length - item.stem.length <= 3);
    if (role) return `<span class="rules-term"><img class="rules-role-icon" src="${role.src}" alt="">${word}</span>`;
    const glyph = terms.words.find(([pattern]) => pattern.test(word))?.[1];
    if (!glyph) return word;
    const before = text.slice(0, offset);
    const after = text.slice(offset + word.length);
    if (glyph === "⚡" && (terms.cardsBefore.test(before) || (language === "en" && EN_CARD_AFTER.test(after)))) return word;
    if (after.trimStart().startsWith(glyph)) return word;
    return `<span class="rules-term">${word}${glyph}</span>`;
  });
}

export function annotateTerms(html: string, language: string, meta: CityMeta): string {
  const terms = TERMS[language];
  if (!terms) return html;
  const roles = roleMatchers(meta);
  // Пропускаемый элемент и глубина вложенных одноимённых тегов внутри него.
  const skip: { name: string; depth: number }[] = [];
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_match, tag: string | undefined, text: string | undefined) => {
    if (tag) {
      const name = /^<\/?([a-z0-9]+)/i.exec(tag)?.[1]?.toLowerCase();
      if (!name || tag.endsWith("/>") || VOID_TAGS.has(name)) return tag;
      const top = skip[skip.length - 1];
      if (tag.startsWith("</")) {
        if (top?.name === name && --top.depth === 0) skip.pop();
      } else if (top?.name === name) {
        top.depth += 1;
      } else if (SKIP_TAGS.has(name) || /\bdata-terms="off"/.test(tag)) {
        skip.push({ name, depth: 1 });
      }
      return tag;
    }
    return skip.length ? (text ?? "") : annotateText(text ?? "", terms, roles, language);
  });
}
