import { describe, expect, it } from "vitest";
import { meta } from "../ui/dev/fixtures";
import { buildRulesBook } from "./rulesDocument";

describe("buildRulesBook", () => {
  const book = buildRulesBook(meta, 4);

  it("раскладывает правила по главам с уникальными id", () => {
    expect(book.length).toBeGreaterThan(10);
    expect(new Set(book.map(chapter => chapter.id)).size).toBe(book.length);
    for (const chapter of book) expect(chapter.html.trim().length, chapter.id).toBeGreaterThan(0);
  });

  /* Прежний свод был целым HTML-документом со своим <style>: вставленный в окно, он менял
   * body и таблицы всей страницы, пока окно было открыто. */
  it("не несёт собственных стилей и обёртки документа", () => {
    for (const chapter of book) {
      expect(chapter.html, chapter.id).not.toMatch(/<(style|html|body|head)[\s>]/);
    }
  });

  it("не показывает служебные id тегов вместо названий", () => {
    const economy = book.find(chapter => chapter.id === "economy")!;
    expect(economy.html).not.toContain("<code>finance</code>");
    expect(economy.html).toContain("«Финансы»");
  });

  it("начинается с обзора и показывает общие доски и разметку карты проекта", () => {
    expect(book[0].id).toBe("intro");
    expect(book[0].html).toContain("рынок общие");
    expect(book[0].html).toContain('class="rules-resource-icon"');
    expect(book[0].html).not.toContain("◆");
    expect(book[0].html).not.toContain("⚠");

    const market = book.find(chapter => chapter.id === "flow")!;
    expect(market.html).toContain(`${meta.assets.length} карт объектов`);
    expect(market.html).toContain("самых старых слота");

    const projects = book.find(chapter => chapter.id === "projects")!;
    expect(projects.html).toContain("rules-project-card");
    expect(projects.html).toContain("самый старый проект слева");
    expect(projects.html).toContain("правый слот");
  });
});

describe("книга на всех языках", () => {
  it("у каждого языка те же главы, и ни одна не пустая", async () => {
    const i18next = (await import("../i18n")).default;
    const ids: Record<string, string[]> = {};
    for (const language of ["ru", "en", "cs"]) {
      await i18next.changeLanguage(language);
      const chapters = buildRulesBook(meta, 4);
      ids[language] = chapters.map(chapter => chapter.id);
      for (const chapter of chapters) expect(chapter.html.trim().length, `${language}/${chapter.id}`).toBeGreaterThan(50);
    }
    await i18next.changeLanguage("ru");
    expect(ids.en).toEqual(ids.ru);
    expect(ids.cs).toEqual(ids.ru);
  });
});
