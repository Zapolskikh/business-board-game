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
    const districts = book.find(chapter => chapter.id === "districts")!;
    expect(districts.html).not.toContain("<code>finance</code>");
    expect(districts.html).toContain("«Финансы»");
  });

  it("идёт по печатным правилам: обзор, скриншоты интерфейса, значки у терминов и ролей", () => {
    expect(book[0].id).toBe("intro");
    expect(book[0].html).toContain("рынок с его объектами");
    expect(book[0].html).toContain('class="rules-shot"');
    expect(book[0].html).toContain('class="rules-resource-icon"');
    expect(book[0].html).not.toContain("◆");
    expect(book[0].html).not.toContain("⚠");
    expect(book[0].html).toContain(`всего объектов в игре — ${meta.assets.length}`);

    const flow = book.find(chapter => chapter.id === "flow")!;
    // «действия» в тексте несут значок молнии и не отрываются от него при переносе.
    expect(flow.html).toMatch(/<span class="rules-term">действия<img class="rules-resource-icon"/);
    expect(flow.html).toContain("Крайний левый проект");

    const roles = book.find(chapter => chapter.id === "roles")!;
    expect(roles.html).toContain('class="rules-role-badge"');
    expect(roles.html).toContain('class="rules-role-icon"');
    expect(roles.html).toContain("отобрать его роль нельзя");

    const end = book.find(chapter => chapter.id === "end")!;
    expect(end.html).toContain("купивший больше городских проектов");
  });

  it("не ставит значки в заголовках, таблицах и названиях в кавычках", () => {
    const memo = book.find(chapter => chapter.id === "memo")!;
    expect(memo.html).not.toContain('class="rules-term"');
    const scandals = book.find(chapter => chapter.id === "scandals")!;
    expect(scandals.html).toContain("«Чистка»");
  });

  it("описывает серые операции кубиком: таблица граней на каждую операцию, без шансов и очков", () => {
    const grey = book.find(chapter => chapter.id === "grey")!;
    expect(grey.html.match(/class="grey-dice"/g)?.length).toBe(5);
    expect(grey.html).toContain("⚅");
    expect(grey.html).not.toMatch(/\d+%/);
    expect(grey.html).toContain("Пробить защиту");
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
