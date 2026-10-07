import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { buildRulesBook } from "../../online/rulesDocument";
import type { CityMeta } from "../../online/types";
import { MIN_QUERY, highlightHtml, searchRules } from "./rulesSearch";
import { ResourceText } from "../primitives/ResourceIcon";

/* Книга правил города.
 *
 * Раньше правила были одной длинной страницей с оглавлением сбоку, вставленной целиком в узкое
 * окно: таблицы каталога не помещались и уезжали вбок, а оглавление занимало треть ширины. Здесь
 * то же содержимое разложено по главам: слева закладки, справа разворот одной главы, листается
 * стрелками внизу страницы и с клавиатуры. Длинная глава прокручивается только по вертикали.
 *
 * Поиск живёт над закладками: пока в нём есть запрос, вместо оглавления видны найденные места,
 * а в открытой главе совпадения подсвечены и первое из них прокручено в центр.
 *
 * Узкий или низкий экран (телефон вертикально и в альбоме): шестнадцать закладок в два ряда
 * съедали экран, и на текст главы оставалась полоска. Там сверху одна строка — поиск и кнопка
 * «Главы»; оглавление и найденное открываются на месте страницы и закрываются выбором главы.
 */
const COMPACT_QUERY = "(max-width: 760px), (max-height: 560px)";

function useCompact(): boolean {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
  const [compact, setCompact] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return compact;
}
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

  const compact = useCompact();
  // Компактная книга: открыт ли список (оглавление или найденное) вместо страницы.
  const [listOpen, setListOpen] = useState(false);
  const showList = !compact || listOpen;
  const choose = (index: number) => {
    setPage(index);
    setListOpen(false);
  };
  // Страница появилась снова после списка — как новая: к первому совпадению поиска или в начало.
  useEffect(() => {
    if (!compact || listOpen) return;
    const first = searching ? body.current?.querySelector("mark.rules-hit") : null;
    if (first) first.scrollIntoView({ block: "center" });
  }, [compact, listOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
          className={`ui-v2 rules-book fixed outline-none left-1/2 top-1/2 z-50 grid h-[min(860px,calc(var(--app-h)*0.92))] w-[min(1240px,calc(var(--app-w)*0.96))]
            -translate-x-1/2 -translate-y-1/2 font-sans ${
              compact
                ? `is-compact grid-cols-1 ${listOpen ? "grid-rows-[minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]"}`
                : "grid-cols-[minmax(0,270px)_minmax(0,1fr)]"
            }`}
        >
          {/* Левая страница: титул, поиск и закладки глав — или найденные места. */}
          <nav className={`rules-book-toc grid min-h-0 overflow-hidden ${compact ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[auto_auto_minmax(0,1fr)]"}`}>
            <header className="rules-book-title">
              <Dialog.Title className="card-serif text-[24px] leading-tight">{t("ui.book.title")}</Dialog.Title>
              <p>{t("ui.book.subtitle")}</p>
            </header>

            <div className={compact ? "rules-book-searchbar" : "contents"}>
            <label className="rules-book-search">
              <span aria-hidden>⌕</span>
              <input
                ref={search}
                type="search"
                value={query}
                placeholder={t("ui.book.search")}
                aria-label={t("ui.book.search")}
                onChange={event => {
                  setQuery(event.target.value);
                  if (compact && event.target.value.trim().length >= MIN_QUERY) setListOpen(true);
                }}
                onKeyDown={event => {
                  // Enter открывает первое найденное место.
                  if (event.key === "Enter" && hits[0]) choose(hits[0].chapter);
                }}
              />
              {query && (
                <button type="button" aria-label={t("ui.book.clear")} onClick={() => setQuery("")}>
                  ✕
                </button>
              )}
            </label>
            {compact && (
              <button
                type="button"
                className="rules-book-contents"
                aria-expanded={listOpen}
                onClick={() => setListOpen(open => !open)}
              >
                {listOpen ? t("ui.book.backToPage") : t("ui.book.contents")}
              </button>
            )}
            </div>

            {!showList ? null : searching ? (
              <div className="rules-book-results min-h-0 overflow-y-auto" aria-live="polite">
                <p className="rules-book-results-count">
                  {total ? t("ui.book.found", { total, count: hits.length }) : t("ui.book.nothing")}
                </p>
                {hits.map(hit => (
                  <button
                    key={hit.chapter}
                    type="button"
                    aria-current={hit.chapter === page ? "page" : undefined}
                    onClick={() => choose(hit.chapter)}
                    className="rules-book-result"
                  >
                    <span className="rules-book-result-head">
                      <span aria-hidden><ResourceText>{chapters[hit.chapter].icon}</ResourceText></span>
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
              <ol className="min-h-0 overflow-y-auto">
                {chapters.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={index === page ? "page" : undefined}
                      onClick={() => choose(index)}
                      className="rules-book-tab"
                    >
                      <span className="rules-book-tab-num">{index + 1}</span>
                      <span aria-hidden><ResourceText>{item.icon}</ResourceText></span>
                      <span className="min-w-0">{item.title.split(" — ")[0]}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </nav>

          {/* Правая страница: глава целиком, листается по одной. */}
          {/* Компактная книга с открытым списком показывает только его: страница вернётся по выбору главы
            * или по «К главе». Не `hidden` — класс раскладки сетки его перебивает. */}
          {!(compact && listOpen) && <article className="rules-book-page grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            <header className="rules-book-chapter-head">
              <span>{t("ui.book.chapter", { number: page + 1 })}</span>
              <h2 className="card-serif">
                <ResourceText>{`${chapter.icon} ${chapter.title}`}</ResourceText>
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
          </article>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
