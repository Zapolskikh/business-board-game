import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/* Доска фиксированного размера, вписанная в экран масштабированием.
 *
 * Проблема: вёрстка доски держится на жёстких пропорциях — 238px левая колонка, 274px
 * правая, шесть карточек рынка в два ряда, четыре игрока без прокрутки. Резиновая
 * раскладка ломает именно это: колонки сжимаются, подписи налезают друг на друга, а
 * карточки перестают помещаться в свои ряды. Media-запросы означали бы отдельную
 * раскладку под каждый размер — четыре доски вместо одной, и каждая правка в четырёх
 * местах.
 *
 * Решение: доска всегда рисуется в одном и том же размере (BOARD_WIDTH × BOARD_HEIGHT),
 * а под экран подгоняется одним множителем. Пропорции не меняются никогда,
 * налезать нечему. Масштаб — по меньшей из сторон, чтобы доска целиком помещалась и по
 * ширине, и по высоте.
 *
 * Всплывающие окна Radix рендерятся порталом в body, вне этого контейнера, поэтому
 * остаются в натуральную величину и читаются на любом экране.
 */

/* Базовый размер доски. Меняя эти числа, вы меняете плотность: доска не станет
 * вмещать больше, она просто нарисуется крупнее или мельче. Отношение 16:9.5 близко
 * к типичному ноутбуку — на нём масштаб выходит около единицы, то есть без искажений. */
export const BOARD_WIDTH = 1520;
export const BOARD_HEIGHT = 860;

/* Верхний предел увеличения. Без него на большом мониторе доска раздувалась бы до
 * размера плаката: шрифт в 30px и половина экрана под шестью карточками. */
const MAX_SCALE = 1.35;

export function BoardScaler({ children }: { children: ReactNode }) {
  /* Меряем сам контейнер, а не окно.
   *
   * Здесь стояло `window.innerWidth / innerHeight`, и на телефоне это другое число:
   * контейнер живёт в `100dvh`, который учитывает панель вкладок и адресную строку, а
   * `innerHeight` — нет. Разница выходила около полусотни точек, доска масштабировалась
   * под несуществующую высоту, и нижний ряд слотов уезжал за край экрана.
   *
   * ResizeObserver вдобавок ловит всё, о чём окно не сообщает вовсе: показ и скрытие
   * панелей Safari при прокрутке, безопасные зоны, смену ориентации до того, как
   * `resize` отдаст новые размеры. Обратной связи нет — наблюдаемый блок занимает вьюпорт
   * и от масштаба ребёнка не зависит.
   */
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setBox({ width: node.clientWidth, height: node.clientHeight });
    measure();
    /* Тесты доски рендерятся в jsdom без ResizeObserver. Масштаб останется единицей —
     * честный ответ: он есть, он просто никого не сжимает, и раскладка в тестах совпадает
     * с базовой. */
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    /* Поворот телефона меняет размеры не сразу: на момент события браузер ещё может
     * отдавать старую ориентацию, а ResizeObserver в этот момент уже отработал. */
    const node = frame.current;
    const onRotate = () =>
      requestAnimationFrame(() => node && setBox({ width: node.clientWidth, height: node.clientHeight }));
    const orientation = window.screen?.orientation;
    orientation?.addEventListener?.("change", onRotate);
    return () => orientation?.removeEventListener?.("change", onRotate);
  }, []);

  const scale = box
    ? Math.min(box.width / BOARD_WIDTH, box.height / BOARD_HEIGHT, MAX_SCALE)
    : 1;

  return (
    <div ref={frame} className="ui-v2 grid h-dvh w-dvw place-content-center overflow-hidden bg-surface">
      <div
        style={{
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          /* `zoom`, а не `transform: scale`.
           *
           * С transform браузер рисует доску в натуральную величину, а потом растягивает
           * готовую картинку — текст размывается тем сильнее, чем дальше масштаб от
           * единицы. `zoom` же меняет размеры до отрисовки: буквы растеризуются сразу в
           * нужном размере и остаются чёткими.
           *
           * Второй, менее заметный выигрыш — анимации. Motion меряет элементы через
           * getBoundingClientRect; под transform эти координаты не совпадают с теми, в
           * которых он считает раскладку, и на каждый кадр уходит лишняя работа с
           * поправками. При zoom измерения совпадают с реальностью.
           *
           * Плата за это — мобильный Safari: он раздувает шрифты в широких блоках, а
           * `zoom` от этого не спасает. Лечится не здесь, а запретом автоувеличения на
           * `.ui-v2` в theme.css.
           *
           * Поддержка: свойство нестандартное, но работает во всех актуальных браузерах,
           * включая Firefox с 126-й версии. */
          zoom: scale,
        }}
      >
        {children}
      </div>
    </div>
  );
}
