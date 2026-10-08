import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

/* Какой раскладкой сейчас рисуется доска.
 *
 * Раскладок ровно две. `wide` — стол фиксированного размера, вписанный в экран множителем:
 * три колонки, проекты, рынок и город друг под другом. `mobile` — телефон в альбомной
 * ориентации: те же колонки игроков и действий по бокам, а проекты, рынок и город — вкладками
 * в центре, по одной за раз.
 *
 * Раскладка приходит контекстом, а не пропом через семь уровней: её спрашивают несколько
 * компонентов в разных ветках дерева, и пробрасывать флаг до каждого — значит менять
 * сигнатуры всем, кто просто стоит по дороге.
 */
export type BoardLayout = "wide" | "mobile";

const LayoutContext = createContext<BoardLayout>("wide");

export function BoardLayoutProvider({ layout, children }: { layout: BoardLayout; children: ReactNode }) {
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>;
}

export function useBoardLayout(): BoardLayout {
  return useContext(LayoutContext);
}

export function useIsMobile(): boolean {
  return useBoardLayout() === "mobile";
}

/* Телефон узнаём по размеру экрана, а не окна.
 *
 * Окно на телефоне мы сами подменяем логической шириной (см. useMobileViewport), и после этого
 * `innerWidth` говорит 1300 — по нему раскладка тут же переключилась бы обратно на широкую.
 * Размер экрана от meta viewport не зависит. Короткая сторона до 640 — это телефоны и
 * маленькие планшеты в альбоме (1024×600); iPad и ноутбуки играют широкой доской.
 */
const PHONE_SHORT_SIDE = 640;

function screenSides(): { long: number; short: number } | null {
  if (typeof window === "undefined" || !window.screen) return null;
  const { width, height } = window.screen;
  if (!width || !height) return null;
  return { long: Math.max(width, height), short: Math.min(width, height) };
}

export function isPhoneScreen(): boolean {
  const sides = screenSides();
  return Boolean(sides && sides.short <= PHONE_SHORT_SIDE);
}

function isPortrait(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") return window.matchMedia("(orientation: portrait)").matches;
  return window.innerHeight > window.innerWidth;
}

/** Телефон ли это и как его держат. Вне браузера (SSR, тесты) — широкий стол. */
export function useDeviceLayout(): { mobile: boolean; portrait: boolean } {
  const read = () => ({ mobile: isPhoneScreen(), portrait: isPortrait() });
  const [state, setState] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () =>
      setState(current => {
        const next = read();
        return next.mobile === current.mobile && next.portrait === current.portrait ? current : next;
      });
    update();
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(orientation: portrait)") : null;
    query?.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      query?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return state;
}

/* Логический размер мобильного стола.
 *
 * Стол рисуется в постоянной высоте и вписывается в экран целиком, как картинка: на любом
 * телефоне видно одно и то же, меняется только множитель. Ширина — по пропорциям экрана, чтобы
 * стол занимал его без полос: на вытянутом телефоне центральное поле чуть шире.
 *
 * MOBILE_HEIGHT — главная ручка плотности: больше — всё мельче и просторнее, меньше — крупнее.
 * Ширина не опускается ниже MOBILE_MIN_WIDTH: на планшете 16:10 три колонки иначе сжались бы,
 * и тогда стол становится выше, а не уже.
 */
export const MOBILE_HEIGHT = 600;
export const MOBILE_MIN_WIDTH = 1200;

/* Окна и подсказки на телефоне — крупнее стола. Стол плотный, потому что на нём видно всё сразу;
 * окно открыто одно, места вокруг него много, и его текст читают, а не окидывают взглядом.
 * Множитель применяется к содержимому окна (`zoom`), а не к самому окну: центрирование и рамка
 * остаются как есть, а текст, отступы и кнопки растут вместе.
 *
 * Считать надо от экрана, а не от стола: стол на телефоне ужат примерно до 0.65, и при множителе
 * 1.2 шрифт 11.5px выходил на экране в ~9px — не читался. С 1.5 это ~11px, подписи 10px — ~10px.
 *
 * У широких справочников (роли, серые операции) множитель меньше: они упираются в ширину экрана,
 * и каждая десятая множителя отнимает у таблицы колонку. */
export const MOBILE_DIALOG_ZOOM = 1.5;
export const MOBILE_DETAILS_ZOOM = 1.4;
/* Ниже этого окно не мельчим — это прежний множитель, с которым текст уже едва читался. */
export const MOBILE_MIN_ZOOM = 1.2;

/* Множитель окна подбирается под его содержимое: крупный текст не должен стоить прокрутки.
 *
 * Окно открывается с множителем `max`. Если содержимое при нём не помещается в высоту экрана,
 * множитель опускается ровно настолько, чтобы прокрутка исчезла, но не ниже `min`. Если и при
 * `min` не помещается (полный справочник ролей — три экрана), прокрутка всё равно останется, и
 * тогда мельчить незачем: остаётся `max`.
 *
 * Множитель живёт в переменной `--win-zoom` на самом окне, а не в состоянии React: от неё считаются
 * и `zoom` частей окна, и его ширина, и подбор идёт до отрисовки кадра, без промежуточного рендера.
 * Прокручиваемая часть окна помечается `data-fit-scroll`; ею может быть и само окно. */
export function useFitZoom(max: number, min = MOBILE_MIN_ZOOM): (node: HTMLElement | null) => void {
  const mobile = useIsMobile();
  const [win, setWin] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!win || !mobile) return;
    const scroller = win.matches("[data-fit-scroll]") ? win : win.querySelector<HTMLElement>("[data-fit-scroll]");
    if (!scroller) return;

    const set = (value: number) => win.style.setProperty("--win-zoom", String(value));
    const overflows = () => scroller.scrollHeight > scroller.clientHeight + 1;
    const fit = () => {
      set(max);
      if (!overflows()) return;
      // Первая прикидка — по отношению высот, дальше мелкими шагами: шапка и подвал окна тоже
      // масштабируются, и точного ответа одно деление не даёт.
      let value = Math.min(max, Math.floor(((max * scroller.clientHeight) / scroller.scrollHeight) * 50) / 50);
      while (value >= min) {
        set(value);
        if (!overflows()) return;
        value = Math.round((value - 0.02) * 100) / 100;
      }
      set(max);
    };

    fit();
    // Содержимое меняется и в открытом окне: вкладки серых операций, полный справочник ролей.
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    resize?.observe(win);
    for (const child of scroller.children) resize?.observe(child);
    const mutation = typeof MutationObserver === "function" ? new MutationObserver(fit) : null;
    mutation?.observe(scroller, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", fit);
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [win, mobile, max, min]);

  return setWin;
}

/** `zoom` части окна: множитель, подобранный `useFitZoom`, а до подбора — `max`. */
export function fitZoom(max: number): string {
  return `var(--win-zoom, ${max})`;
}

/* Крестик окна на телефоне — кнопка с рамкой и фоном, а не серый значок в углу: по значку не
 * попадали и не сразу его находили. */
export const MOBILE_CLOSE_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-md border border-line-2 bg-panel-3 text-[16px] font-bold leading-none text-ink active:bg-panel-2";

/* Мобильный стол в логическом размере: MOBILE_HEIGHT точек в высоту, ширина — по пропорциям
 * экрана. Масштабируется страница целиком, а не контейнер доски: окна, поповеры и подсказки
 * Radix рендерятся порталом в body, и с `zoom` на контейнере они остались бы в натуральную
 * величину — окно ролей шириной 1040 точек на экране в 844.
 *
 * Включается только на время партии в альбомной ориентации: лобби и вертикальный экран
 * «поверните устройство» живут в обычной ширине устройства.
 *
 * Способов два, по браузеру:
 * - iPhone — подменой meta viewport (`metaViewport`): Safari честно раскладывает страницу в
 *   заданную ширину, и шрифты растеризуются в итоговом размере.
 * - Остальные — `zoom` на корне документа (`rootZoom`). Chrome и Mi Browser на Android подмену
 *   meta принимают через раз: на Xiaomi 14 стол раскладывался в родную ширину экрана (~900 точек
 *   вместо ~1300), сетка вписывалась, а шрифты и отступы наезжали друг на друга, — и по-разному на
 *   разных моделях. `zoom` от meta не зависит и в Chromium работает одинаково везде.
 */
export function useMobileViewport(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined" || !screenSides()) return;
    return isAppleTouch() ? metaViewport() : rootZoom();
  }, [active]);
}

/* iPhone, iPod и iPad — iPadOS представляется Маком, выдаёт его только сенсорный экран. */
function isAppleTouch(): boolean {
  const agent = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
}

/* Пока игрок печатает (чат), стол не трогаем: клавиатура сама сдвигает видимую область, чтобы
 * показать поле ввода, а пересчёт масштаба увёл бы поле обратно под клавиатуру или сбросил фокус.
 * Всё выровняется, когда клавиатура закроется. */
function typing(): boolean {
  const focused = document.activeElement;
  return focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement;
}

/* Прокрутка документа на время партии выключена: стол занимает ровно экран, листать нечего. */
function lockScroll(): () => void {
  const root = document.documentElement;
  const previous = { html: root.style.overflow, body: document.body.style.overflow, behavior: root.style.overscrollBehavior };
  root.style.overflow = "hidden";
  root.style.overscrollBehavior = "none";
  document.body.style.overflow = "hidden";
  return () => {
    root.style.overflow = previous.html;
    root.style.overscrollBehavior = previous.behavior;
    document.body.style.overflow = previous.body;
  };
}

/* Текущий `zoom` корня — 1, если стол масштабируется не им. Координаты, которые браузер отдаёт в
 * точках экрана (видимая область, getBoundingClientRect), делятся на него, прежде чем стать
 * размерами внутри страницы: там каждая точка ещё раз умножится на `zoom`. */
let rootScale = 1;

export function pageZoom(): number {
  return rootScale;
}

/* `zoom` на корне документа.
 *
 * Размер окна (`innerWidth`, `innerHeight`) от `zoom` не зависит — его и меряем. Множитель — чтобы
 * логический стол встал в экран и по ширине, и по высоте; остаток по длинной стороне достаётся
 * центральному полю, как и с meta.
 *
 * Единицы экрана (`100dvh`, `94vw`) под `zoom` считаются от настоящего окна и затем ещё раз
 * умножаются на `zoom`: `h-dvh` занял бы две трети экрана. Поэтому логический размер окна кладётся
 * в `--app-w` / `--app-h`, и всё, что на мобильном столе меряется экраном, меряется ими
 * (по умолчанию в styles.css это обычные `100vw` / `100dvh`). Поповеры Radix под `zoom` ставятся
 * мимо якоря — их обёртку выправляет правило `html[data-root-zoom]` там же. */
function rootZoom(): () => void {
  const root = document.documentElement;
  const unlock = lockScroll();
  let frame = 0;

  const apply = () => {
    frame = 0;
    if (typing()) return;
    const { innerWidth: width, innerHeight: height } = window;
    // Поворот ещё не досчитан — окно пока вертикальное; следующий resize придёт с настоящим.
    if (!width || !height || width < height) return;
    const logical = Math.max(MOBILE_MIN_WIDTH, Math.round((MOBILE_HEIGHT * width) / height));
    const scale = Math.min(width / logical, height / MOBILE_HEIGHT);
    rootScale = scale;
    root.style.zoom = String(scale);
    root.style.setProperty("--app-w", `${width / scale}px`);
    root.style.setProperty("--app-h", `${height / scale}px`);
    root.style.setProperty("--app-zoom", String(scale));
    root.dataset.rootZoom = "";
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };
  // Клавиатура закрылась — фокус ушёл из поля: теперь можно пересчитать.
  const released = () => window.setTimeout(schedule, 350);

  apply();
  const stopProbe = viewportProbe(() => `rootZoom ${rootScale.toFixed(3)}`);
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  document.addEventListener("fullscreenchange", schedule);
  document.addEventListener("focusout", released);
  return () => {
    stopProbe();
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    document.removeEventListener("fullscreenchange", schedule);
    document.removeEventListener("focusout", released);
    rootScale = 1;
    root.style.zoom = "";
    root.style.removeProperty("--app-w");
    root.style.removeProperty("--app-h");
    root.style.removeProperty("--app-zoom");
    delete root.dataset.rootZoom;
    unlock();
  };
}

/* Подмена meta viewport — для Safari.
 *
 * iOS Safari после поворота и после входа в полноэкранный режим оставляет старое смещение
 * видимой области: слева чёрная полоса, стол уехал вправо и обрезан, и на место он вставал только
 * после движения пальцем. Поэтому при каждом таком событии meta переписывается дважды — сначала с
 * чуть другим масштабом, кадром позже с точным (одинаковое значение Safari пропускает и не
 * пересчитывает), — и страница несколько раз за полсекунды возвращается в левый верхний угол:
 * Safari досчитывает поворот с задержкой, и одного сброса сразу после события не хватает.
 */
function metaViewport(): (() => void) | undefined {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return undefined;
  /* Исходную meta запоминаем один раз: если телефон повернули обратно, пока release ещё не
   * вернул её, в атрибуте лежит временная, прижатая к единице. */
  meta.dataset.original ??= meta.getAttribute("content") ?? "width=device-width, initial-scale=1.0";
  const original = meta.dataset.original;
  meta.dataset.board = "1";
  const timers: number[] = [];

  /* Пропорции берём у видимой области, а не у экрана: в браузере панели (шапка Safari в
   * альбоме) съедают часть высоты, и стол, посчитанный по экрану, в остаток не помещался —
   * сплющивался, тексты наезжали друг на друга. Отношение сторон окна от масштаба не зависит,
   * поэтому его можно мерить и после подмены meta. Уже экрана видимая область не бывает;
   * сверху — потолок, чтобы случайно схлопнувшееся окно не превратило стол в ленту. */
  const logicalWidth = () => {
    const sides = screenSides()!;
    const screenRatio = sides.long / sides.short;
    const { innerWidth, innerHeight } = window;
    const visible = innerWidth > innerHeight && innerHeight > 0 ? innerWidth / innerHeight : screenRatio;
    const ratio = Math.min(Math.max(visible, screenRatio), screenRatio * 1.5);
    return Math.max(MOBILE_MIN_WIDTH, Math.round(MOBILE_HEIGHT * ratio));
  };
  const content = (width: number, nudge: number) => {
    const scale = (screenSides()!.long / width + nudge).toFixed(4);
    return `width=${width}, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no, viewport-fit=cover`;
  };
  const home = () => {
    if (typing()) return;
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  };
  /* Не чаще раза в 700 мс: переписанная meta сама вызывает resize видимой области, и без
   * паузы застрявшее смещение (например, от открытой клавиатуры) крутило бы сброс по кругу.
   * Пропущенный вызов не теряется: после паузы пропорции сверяются ещё раз. */
  let last = 0;
  let applied = 0;
  let retry = 0;
  const settle = () => {
    if (typing()) return;
    const now = Date.now();
    if (now - last < 700) {
      if (!retry) {
        retry = window.setTimeout(() => {
          retry = 0;
          resync();
        }, 700 - (now - last));
      }
      return;
    }
    last = now;
    const width = logicalWidth();
    applied = width;
    meta.setAttribute("content", content(width, 0.0001));
    requestAnimationFrame(() => {
      meta.setAttribute("content", content(width, 0));
      home();
    });
    for (const delay of [60, 250, 600]) timers.push(window.setTimeout(home, delay));
  };
  // Панели браузера появились или спрятались — видимая область другой формы, стол пересчитывается.
  const resync = () => {
    if (!typing() && Math.abs(logicalWidth() - applied) > 4) settle();
  };
  // Смещение видимой области (не прокрутка документа) — тоже сигнал вернуть стол на место.
  const drift = () => {
    home();
    const view = window.visualViewport;
    if (view && (view.offsetLeft > 0.5 || view.offsetTop > 0.5)) settle();
    else resync();
  };

  const unlock = lockScroll();
  settle();
  const stopProbe = viewportProbe(() => `meta ${meta.getAttribute("content")}`);
  window.addEventListener("orientationchange", settle);
  document.addEventListener("fullscreenchange", settle);
  document.addEventListener("webkitfullscreenchange", settle);
  // Клавиатура закрылась — фокус ушёл из поля: теперь можно вернуть стол на место.
  const released = () => timers.push(window.setTimeout(drift, 350));
  document.addEventListener("focusout", released);
  window.addEventListener("resize", resync);
  window.visualViewport?.addEventListener("resize", drift);
  window.visualViewport?.addEventListener("scroll", drift);
  return () => {
    stopProbe();
    timers.forEach(timer => window.clearTimeout(timer));
    window.clearTimeout(retry);
    document.removeEventListener("focusout", released);
    window.removeEventListener("resize", resync);
    window.removeEventListener("orientationchange", settle);
    document.removeEventListener("fullscreenchange", settle);
    document.removeEventListener("webkitfullscreenchange", settle);
    window.visualViewport?.removeEventListener("resize", drift);
    window.visualViewport?.removeEventListener("scroll", drift);
    unlock();
    delete meta.dataset.board;
    release(meta, original);
  };
}

/* Возврат к обычной ширине устройства — при повороте в вертикаль и при выходе из партии.
 *
 * Просто вернуть исходную meta мало: браузер оставляет прежний масштаб (стол был вписан
 * множителем меньше единицы), пересчитывает его к новой ширине уже после поворота, и экран
 * «поверните устройство» открывается в огромном увеличении — виден только угол фона. Поэтому
 * масштаб сначала прижимается к единице и минимумом, и максимумом (тем же двойным переписыванием,
 * что и в metaViewport: одинаковое значение Safari пропускает), страница возвращается в угол,
 * и только когда поворот досчитан, meta становится исходной — с обычным зумом пальцами.
 *
 * Если за это время стол снова включился (телефон повернули обратно), поздний возврат meta не
 * трогает: её уже переписал стол. */
let session = 0;

function release(meta: HTMLMetaElement, original: string): void {
  const mine = ++session;
  const pinned = (scale: string) =>
    `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, viewport-fit=cover`;
  const ours = () => mine === session && !meta.dataset.board;
  const home = () => {
    if (ours() && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
  };
  meta.setAttribute("content", pinned("1.0001"));
  requestAnimationFrame(() => {
    if (!ours()) return;
    meta.setAttribute("content", pinned("1"));
    home();
  });
  for (const delay of [60, 250, 600]) window.setTimeout(home, delay);
  window.setTimeout(() => {
    if (ours()) meta.setAttribute("content", original);
  }, 900);
}

/* Диагностика вьюпорта на чужом телефоне: `?vp` в адресе (запоминается до закрытия вкладки)
 * показывает поверх стола, что браузер на самом деле дал странице и каким способом вписан стол.
 * Временная — пока мобильный стол проверяют на разных телефонах. */
function viewportProbe(mode: () => string): () => void {
  try {
    if (new URLSearchParams(window.location.search).has("vp")) sessionStorage.setItem("vp", "1");
    if (!sessionStorage.getItem("vp")) return () => {};
  } catch {
    return () => {};
  }
  const box = document.createElement("pre");
  box.style.cssText =
    "position:fixed;left:4px;bottom:4px;z-index:99999;margin:0;padding:6px 8px;max-width:600px;white-space:pre-wrap;" +
    "font:12px/1.35 monospace;color:#fff;background:rgba(0,0,0,.8);border-radius:6px;pointer-events:none";
  document.body.appendChild(box);
  const draw = () => {
    const view = window.visualViewport;
    const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "—";
    box.textContent = [
      `screen ${window.screen.width}×${window.screen.height}  dpr ${window.devicePixelRatio}  chrome ${chrome}`,
      `inner ${window.innerWidth}×${window.innerHeight}  client ${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`,
      `visual ${view ? `${Math.round(view.width)}×${Math.round(view.height)} scale ${view.scale.toFixed(3)}` : "—"}`,
      mode(),
    ].join("\n");
  };
  draw();
  const timer = window.setInterval(draw, 500);
  return () => {
    window.clearInterval(timer);
    box.remove();
  };
}

/* Видимая часть экрана: без того, что закрыла экранная клавиатура.
 *
 * `position: fixed` на телефоне считается от всей страницы, а не от того, что видно, поэтому окно
 * «по центру экрана» при открытой клавиатуре оказывается под ней. Окно, в котором печатают, ставят
 * по этим координатам: `top` — где видимая область начинается, `height` — сколько её осталось.
 * Видимая область меряется в точках экрана, поэтому под `zoom` корня делится на него. */
export function useVisibleArea(active: boolean): { top: number; height: number } {
  const read = () => {
    const view = typeof window === "undefined" ? undefined : window.visualViewport;
    const scale = pageZoom();
    if (view) return { top: view.offsetTop / scale, height: view.height / scale };
    return { top: 0, height: typeof window === "undefined" ? 600 : window.innerHeight / scale };
  };
  const [area, setArea] = useState(read);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const update = () =>
      setArea(current => {
        const next = read();
        return Math.abs(next.top - current.top) < 0.5 && Math.abs(next.height - current.height) < 0.5 ? current : next;
      });
    update();
    const view = window.visualViewport;
    view?.addEventListener("resize", update);
    view?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      view?.removeEventListener("resize", update);
      view?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return area;
}
