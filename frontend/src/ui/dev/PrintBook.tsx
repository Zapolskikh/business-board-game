import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalizedMeta } from "../../i18n/catalog";
import { cityApi } from "../../online/api";
import { buildRulesBook } from "../../online/rulesDocument";
import { TUTORIAL_STEPS } from "../../online/Tutorial";
import type { CityMeta } from "../../online/types";
import { ResourceText } from "../primitives/ResourceIcon";
import "../theme.css";

/* Книга правил и диалоги обучения одним листом — для печати в PDF.
 *
 * Открывается по `/?print` (язык — `&lang=ru|en|cs`); `?print=rules` и `?print=tutorial` — половины. Это не вторая копия текстов: главы собирает
 * тот же `buildRulesBook`, реплики обучения берутся из того же словаря и рисуются теми же классами,
 * что и в игре, — поэтому лист показывает ровно то, что видит игрок, и не может от игры отстать.
 * В игре книга листается по главе, а реплика висит над доской; здесь всё развёрнуто подряд.
 *
 * Каталог (объекты, карты, проекты, роли) приходит с сервера, как и в игре: нужен запущенный бэкенд.
 */
export function PrintBook() {
  const { t, i18n } = useTranslation("game");
  const tutorial = useTranslation("tutorial").t;
  const [serverMeta, setMeta] = useState<CityMeta | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    cityApi.meta().then(setMeta).catch(() => setError("Нет связи с сервером: каталог не загружен."));
  }, []);
  const meta = useLocalizedMeta(serverMeta);

  if (error) return <p style={{ padding: 24 }}>{error}</p>;
  if (!meta) return <p style={{ padding: 24 }}>…</p>;

  const only = new URLSearchParams(location.search).get("print");
  const chapters = only === "tutorial" ? [] : buildRulesBook(meta, 3);
  // Реплика «после» — отдельное окно в игре, поэтому и здесь она идёт отдельной карточкой.
  const lines = TUTORIAL_STEPS.flatMap((step, position) => [
    { key: step.id, text: step.id, step, position, waiting: Boolean(step.done), after: false },
    ...(step.after ? [{ key: step.after, text: step.after, step, position, waiting: false, after: true }] : []),
  ]);

  return (
    <div className="print-book" data-ready>
      <style>{PRINT_CSS}</style>

      {only !== "tutorial" && <header className="print-cover">
        <h1>{t("ui.book.title")}</h1>
        <p>{t("ui.book.subtitle")}</p>
        <p className="print-cover-meta">
          {meta.content_version} · {i18n.language} · v{__GAME_VERSION__}
        </p>
        <ol>
          {chapters.map((chapter, index) => (
            <li key={chapter.id}>
              <ResourceText>{`${index + 1}. ${chapter.icon} ${chapter.title}`}</ResourceText>
            </li>
          ))}
          {only !== "rules" && <li>{chapters.length + 1}. 🎓 {tutorial("menu.button")}: {tutorial("narrator.name")}</li>}
        </ol>
      </header>}

      {chapters.map((chapter, index) => (
        <div key={chapter.id} className="ui-v2 rules-book print-chapter">
          <article className="rules-book-page">
            <header className="rules-book-chapter-head">
              <span>{t("ui.book.chapter", { number: index + 1 })}</span>
              <h2 className="card-serif">
                <ResourceText>{`${chapter.icon} ${chapter.title}`}</ResourceText>
              </h2>
            </header>
            <div className="rules-book-text" dangerouslySetInnerHTML={{ __html: chapter.html }} />
          </article>
        </div>
      ))}

      {only !== "rules" && <section className="print-tutorial">
        <h1>🎓 {tutorial("menu.button")}</h1>
        <p className="print-cover-meta">{tutorial("menu.hint")}</p>
        <div className="print-guides">
          {lines.map(line => {
            const text = tutorial(`steps.${line.text}` as never) as string;
            const last = line.position === TUTORIAL_STEPS.length - 1;
            return (
              <aside key={line.key} className="ui-v2 tutorial-guide print-guide">
                <header className="tutorial-guide-head">
                  <div className="tutorial-narrator">
                    <strong>{tutorial("narrator.name")}</strong>
                    <span>{tutorial(`narrator.look.${line.step.look}` as never) as string}</span>
                  </div>
                  <span className="tutorial-counter">
                    {tutorial("ui.step", { current: line.position + 1, total: TUTORIAL_STEPS.length })}
                  </span>
                </header>
                <div className="tutorial-guide-body">
                  {text.split("\n\n").map((paragraph, index) => {
                    const rows = paragraph.split("\n").filter(Boolean);
                    const firstBullet = rows.findIndex(row => row.startsWith("•"));
                    if (firstBullet < 0) return <p key={index}><ResourceText>{paragraph}</ResourceText></p>;
                    return (
                      <Fragment key={index}>
                        {firstBullet > 0 && <p><ResourceText>{rows.slice(0, firstBullet).join("\n")}</ResourceText></p>}
                        <ul>
                          {rows.slice(firstBullet).map((row, item) => (
                            <li key={item}><ResourceText>{row.slice(1).trim()}</ResourceText></li>
                          ))}
                        </ul>
                      </Fragment>
                    );
                  })}
                </div>
                <footer className="tutorial-guide-foot">
                  {last ? (
                    <>
                      <span className="tutorial-button primary">{tutorial("ui.play")}</span>
                      <span className="tutorial-button">{tutorial("ui.menu")}</span>
                    </>
                  ) : line.waiting ? (
                    <span className="tutorial-hint">{tutorial("ui.doThis")}</span>
                  ) : (
                    <span className="tutorial-button primary">
                      {line.step.info && !line.after ? tutorial("ui.understood") : tutorial("ui.next")}
                    </span>
                  )}
                  {!last && <span className="tutorial-skip">{tutorial("ui.skip")}</span>}
                </footer>
              </aside>
            );
          })}
        </div>
      </section>}
    </div>
  );
}

/* Стили листа. Всё, что в игре прокручивается или висит поверх доски, здесь развёрнуто в поток;
 * цвета, шрифты и рамки — из игровых классов, без изменений. */
const PRINT_CSS = `
@page { size: A4 landscape; margin: 9mm; }
html, body { margin: 0; background: #fff !important; min-height: 0 !important; color: #201b15; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.print-book { width: 1010px; margin: 0 auto; font-family: Georgia, "Times New Roman", serif; }
.print-cover { padding: 40px 34px; break-after: page; }
.print-cover h1, .print-tutorial h1 { margin: 0 0 6px; font-size: 34px; }
.print-cover p { margin: 0 0 4px; font-size: 16px; }
.print-cover-meta { color: #6d5d49; font: 12px/1.4 ui-monospace, Consolas, monospace !important; }
.print-cover ol { margin: 22px 0 0; padding: 0; list-style: none; font-size: 16px; line-height: 1.9; }
.print-chapter { position: static !important; display: block !important; margin: 0 0 18px; break-before: page; }
.print-chapter .rules-book-page { display: block; border-radius: 8px; box-shadow: none; }
.print-chapter .rules-book-text { overflow: visible !important; }
.print-chapter .rules-book-text table { break-inside: auto; }
.print-chapter .rules-book-text tr, .print-chapter .rules-book-text li { break-inside: avoid; }
.print-chapter .rules-book-text h3, .print-chapter .rules-book-text h4 { break-after: avoid; }
.print-tutorial { break-before: page; padding: 8px 0 0; }
.print-guides { display: grid; grid-template-columns: repeat(2, 470px); gap: 16px 28px; justify-content: center; margin-top: 16px; }
.print-guide { position: static !important; width: auto !important; max-height: none !important; box-shadow: none !important;
  break-inside: avoid; align-self: start; font-family: Inter, "Segoe UI", system-ui, sans-serif; }
.print-guide .tutorial-guide-body { overflow: visible; }
.print-guide .tutorial-button, .print-guide .tutorial-skip { cursor: default; }
`;
