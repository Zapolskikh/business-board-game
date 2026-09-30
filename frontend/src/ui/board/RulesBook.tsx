import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { buildRulesBook } from "../../online/rulesDocument";
import type { CityMeta } from "../../online/types";
import { MIN_QUERY, highlightHtml, searchRules } from "./rulesSearch";

/* Книга правил города.
 *
 * Раньше правила были одной длинной страницей с оглавлением сбоку, вставленной целиком в узкое
 * окно: таблицы каталога не помещались и уезжали вбок, а оглавление занимало треть ширины. Здесь
 * то же содержимое разложено по главам: слева закладки, справа разворот одной главы, листается
 * стрелками внизу страницы и с клавиатуры. Длинная глава прокручивается только по вертикали.
 *
 * Поиск живёт над закладками: пока в нём есть запрос, вместо оглавления видны найденные места,
 * а в открытой главе совпадения подсвечены и первое из них прокручено в центр.
 */
export function RulesBook({
  open,
  onClose,
  meta,
  rolePrice,
}: {
  open: boolean;
  onClose: () => void;
  meta: CityMeta;
  rolePrice: number;
}) {
  const { t, i18n } = useTranslation("game");
  // Книга собирается на языке игрока; язык в зависимостях — иначе после переключения
  // осталась бы старая книга.
  const chapters = useMemo(() => buildRulesBook(meta, rolePrice), [meta, rolePrice, i18n.language]);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  // Поиск по всей книге — десятки килобайт текста; отложенное значение не даёт вводу подтормаживать.
  const deferred = useDeferredValue(query);
  const searching = deferred.trim().length >= MIN_QUERY;
  const hits = useMemo(() => (searching ? searchRules(chapters, deferred) : []), [chapters, deferred, searching]);
  const total = hits.reduce((sum, hit) => sum + hit.count, 0);

  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const book = useRef<HTMLDivElement>(null);
  const chapter = chapters[Math.min(page, chapters.length - 1)];
  const html = useMemo(
    () => (searching ? highlightHtml(chapter.html, deferred) : chapter.html),
    [chapter, deferred, searching],
  );

  // Новая глава открывается с начала; при поиске — сразу на первом совпадении.
  useEffect(() => {
    const first = searching ? body.current?.querySelector("mark.rules-hit") : null;
    if (first) first.scrollIntoView({ block: "center" });
    else body.current?.scrollTo({ top: 0 });
  }, [page, html, searching]);

  const turn = (delta: number) => setPage(current => Math.max(0, Math.min(chapters.length - 1, current + delta)));

  return (
    <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#000b]" />
        <Dialog.Content
          ref={book}
          data-ui="rules-book"
          aria-describedby={undefined}
          /* Фокус — на самой книге, а не на поле поиска: иначе на телефоне сразу выезжает
           * клавиатура, а стрелки перестают листать страницы. Поиск — по «/» или нажатию. */
          onOpenAutoFocus={event => {
            event.preventDefault();
            book.current?.focus();
          }}
          // Esc сначала очищает поиск и только потом закрывает книгу.
          onEscapeKeyDown={event => {
            if (query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          onKeyDown={event => {
            const typing = event.target instanceof HTMLInputElement;
            if (event.key === "/" && !typing) {
              event.preventDefault();
              search.current?.focus();
            }
            // В поле поиска стрелки двигают курсор, а не листают страницы.
            if (typing) return;
            if (event.key === "ArrowRight") turn(1);
            if (event.key === "ArrowLeft") turn(-1);
          }}
          className="ui-v2 rules-book fixed outline-none left-1/2 top-1/2 z-50 grid h-[min(860px,92dvh)] w-[min(1240px,96vw)]
            -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,270px)_minmax(0,1fr)] font-sans
            max-[760px]:grid-cols-1 max-[760px]:grid-rows-[auto_minmax(0,1fr)]"
        >
          {/* Левая страница: титул, поиск и закладки глав — или найденные места. */}
          <nav className="rules-book-toc grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
            <header className="rules-book-title">
              <Dialog.Title className="card-serif text-[24px] leading-tight">{t("ui.book.title")}</Dialog.Title>
              <p>{t("ui.book.subtitle")}</p>
            </header>

            <label className="rules-book-search">
              <span aria-hidden>⌕</span>
              <input
                ref={search}
                type="search"
                value={query}
                placeholder={t("ui.book.search")}
                aria-label={t("ui.book.search")}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  // Enter открывает первое найденное место.
                  if (event.key === "Enter" && hits[0]) setPage(hits[0].chapter);
                }}
              />
              {query && (
                <button type="button" aria-label={t("ui.book.clear")} onClick={() => setQuery("")}>
                  ✕
                </button>
              )}
            </label>

            {searching ? (
              <div className="rules-book-results min-h-0 overflow-y-auto" aria-live="polite">
                <p className="rules-book-results-count">
                  {total ? t("ui.book.found", { total, count: hits.length }) : t("ui.book.nothing")}
                </p>
                {hits.map(hit => (
                  <button
                    key={hit.chapter}
                    type="button"
                    aria-current={hit.chapter === page ? "page" : undefined}
                    onClick={() => setPage(hit.chapter)}
                    className="rules-book-result"
                  >
                    <span className="rules-book-result-head">
                      <span aria-hidden>{chapters[hit.chapter].icon}</span>
                      <b>{chapters[hit.chapter].title.split(" — ")[0]}</b>
                      <small>{hit.count}</small>
                    </span>
                    {hit.snippets.map((snippet, index) => (
                      <span key={index} className="rules-book-snippet">
                        {snippet.before}
                        <mark className="rules-hit">{snippet.match}</mark>
                        {snippet.after}
                      </span>
                    ))}
                  </button>
                ))}
              </div>
            ) : (
              <ol className="min-h-0 overflow-y-auto max-[760px]:flex max-[760px]:flex-wrap max-[760px]:gap-0.5">
                {chapters.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={index === page ? "page" : undefined}
                      onClick={() => setPage(index)}
                      className="rules-book-tab"
                    >
                      <span className="rules-book-tab-num">{index + 1}</span>
                      <span aria-hidden>{item.icon}</span>
                      <span className="min-w-0">{item.title.split(" — ")[0]}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </nav>

          {/* Правая страница: глава целиком, листается по одной. */}
          <article className="rules-book-page grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            <header className="rules-book-chapter-head">
              <span>{t("ui.book.chapter", { number: page + 1 })}</span>
              <h2 className="card-serif">
                {chapter.icon} {chapter.title}
              </h2>
              <Dialog.Close className="rules-book-close" aria-label={t("ui.book.close")}>
                ✕
              </Dialog.Close>
            </header>
            <div
              ref={body}
              className="rules-book-text min-h-0 overflow-y-auto overflow-x-hidden"
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <footer className="rules-book-footer">
              <button type="button" disabled={page === 0} onClick={() => turn(-1)}>
                ‹ {page > 0 ? chapters[page - 1].title.split(" — ")[0] : ""}
              </button>
              <span>
                {page + 1} / {chapters.length}
              </span>
              <button type="button" disabled={page === chapters.length - 1} onClick={() => turn(1)}>
                {page < chapters.length - 1 ? chapters[page + 1].title.split(" — ")[0] : ""} ›
              </button>
            </footer>
          </article>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
