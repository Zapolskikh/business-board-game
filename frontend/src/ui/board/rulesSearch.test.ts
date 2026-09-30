import { describe, expect, it } from "vitest";
import type { RulesChapter } from "../../online/rulesDocument";
import { highlightHtml, plainText, searchRules } from "./rulesSearch";

const chapters: RulesChapter[] = [
  { id: "a", icon: "🏆", title: "Цель и очки", html: "<p>Скандалы — минус <b>1 очко</b> за каждый.</p>" },
  { id: "b", icon: "🛡", title: "Крыша и защита", html: "<p>Крыша гасит ещё и <b>рэкет</b> &amp; санкции.</p>" },
];

describe("rulesSearch", () => {
  it("ищет по тексту без тегов и сущностей", () => {
    expect(plainText(chapters[1].html)).toBe("Крыша гасит ещё и рэкет & санкции.");
    expect(plainText("<p>от <b>чужих действий</b>: гасит «<i>карту</i>»</p>")).toBe("от чужих действий: гасит «карту»");
  });

  it("не различает регистр и «е»/«ё», находит и заголовок главы", () => {
    const hits = searchRules(chapters, "КРЫША");
    expect(hits.map(hit => hit.chapter)).toEqual([1]);
    expect(hits[0].count).toBe(2);
    expect(searchRules(chapters, "еще")[0].snippets[0].match).toBe("ещё");
  });

  it("слишком короткий запрос и спецсимволы не ломают поиск", () => {
    expect(searchRules(chapters, "к")).toEqual([]);
    expect(() => searchRules(chapters, "(3$ + ⌊")).not.toThrow();
  });

  it("подсветка трогает только текст, не теги", () => {
    const html = highlightHtml('<p class="очко">1 очко</p>', "очко");
    expect(html).toBe('<p class="очко">1 <mark class="rules-hit">очко</mark></p>');
  });
});
