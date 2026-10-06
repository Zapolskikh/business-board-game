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
 */
export function useMobileViewport(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const sides = screenSides();
    if (!meta || !sides) return;
    const original = meta.getAttribute("content") ?? "width=device-width, initial-scale=1.0";
    const width = Math.max(MOBILE_MIN_WIDTH, Math.round((MOBILE_HEIGHT * sides.long) / sides.short));
    const scale = (sides.long / width).toFixed(4);
    meta.setAttribute(
      "content",
      `width=${width}, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no, viewport-fit=cover`,
    );
    return () => meta.setAttribute("content", original);
  }, [active]);
}
