import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
 * остаются как есть, а текст, отступы и кнопки растут вместе — шрифт 11.5px становится ~14px. */
export const MOBILE_DIALOG_ZOOM = 1.2;

/* Масштаб — через meta viewport, а не через `zoom` на контейнере, как у широкого стола.
 *
 * Окна, поповеры и подсказки Radix рендерятся порталом в body, вне контейнера доски. С `zoom`
 * они остались бы в натуральную величину: окно ролей шириной 1040 точек на экране в 844 — и
 * каждое пришлось бы подгонять отдельно. Логическая ширина вьюпорта масштабирует страницу
 * целиком: браузер сам считает, что экран шириной 1300 точек, и всё — доска, окна, поповеры —
 * рисуется в одних и тех же единицах. Шрифты при этом растеризуются в итоговом размере и
 * остаются чёткими.
 *
 * Включается только на время партии в альбомной ориентации: лобби и вертикальный экран
 * «поверните устройство» живут в обычной ширине устройства.
 *
 * iOS Safari после поворота и после входа в полноэкранный режим оставляет старое смещение
 * видимой области: слева чёрная полоса, стол уехал вправо и обрезан, и на место он вставал только
 * после движения пальцем. Поэтому при каждом таком событии meta переписывается дважды — сначала с
 * чуть другим масштабом, кадром позже с точным (одинаковое значение Safari пропускает и не
 * пересчитывает), — и страница несколько раз за полсекунды возвращается в левый верхний угол:
 * Safari досчитывает поворот с задержкой, и одного сброса сразу после события не хватает.
 * Прокрутка документа на время партии выключена: стол занимает ровно экран, листать нечего.
 */
export function useMobileViewport(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta || !screenSides()) return;
    const original = meta.getAttribute("content") ?? "width=device-width, initial-scale=1.0";
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
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    };
    /* Не чаще раза в 700 мс: переписанная meta сама вызывает resize видимой области, и без
     * паузы застрявшее смещение (например, от открытой клавиатуры) крутило бы сброс по кругу.
     * Пропущенный вызов не теряется: после паузы пропорции сверяются ещё раз. */
    let last = 0;
    let applied = 0;
    let retry = 0;
    const settle = () => {
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
      if (Math.abs(logicalWidth() - applied) > 4) settle();
    };
    // Смещение видимой области (не прокрутка документа) — тоже сигнал вернуть стол на место.
    const drift = () => {
      home();
      const view = window.visualViewport;
      if (view && (view.offsetLeft > 0.5 || view.offsetTop > 0.5)) settle();
      else resync();
    };

    const root = document.documentElement;
    const previous = { html: root.style.overflow, body: document.body.style.overflow, behavior: root.style.overscrollBehavior };
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    document.body.style.overflow = "hidden";

    settle();
    window.addEventListener("orientationchange", settle);
    document.addEventListener("fullscreenchange", settle);
    document.addEventListener("webkitfullscreenchange", settle);
    window.addEventListener("resize", resync);
    window.visualViewport?.addEventListener("resize", drift);
    window.visualViewport?.addEventListener("scroll", drift);
    return () => {
      timers.forEach(timer => window.clearTimeout(timer));
      window.clearTimeout(retry);
      window.removeEventListener("resize", resync);
      window.removeEventListener("orientationchange", settle);
      document.removeEventListener("fullscreenchange", settle);
      document.removeEventListener("webkitfullscreenchange", settle);
      window.visualViewport?.removeEventListener("resize", drift);
      window.visualViewport?.removeEventListener("scroll", drift);
      root.style.overflow = previous.html;
      root.style.overscrollBehavior = previous.behavior;
      document.body.style.overflow = previous.body;
      meta.setAttribute("content", original);
    };
  }, [active]);
}
