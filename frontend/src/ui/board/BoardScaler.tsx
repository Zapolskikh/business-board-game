import { useEffect, useState, type ReactNode } from "react";

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
 * а под экран подгоняется одним `transform: scale`. Пропорции не меняются никогда,
 * налезать нечему. Масштаб — по меньшей из сторон, чтобы доска целиком помещалась и по
 * ширине, и по высоте.
 *
 * `transform` выбран вместо `zoom`: он работает во всех браузерах одинаково, не влияет
 * на раскладку родителя и корректно переносит клики — браузер сам пересчитывает
 * координаты. Всплывающие окна Radix рендерятся порталом в body, вне этого контейнера,
 * поэтому остаются в натуральную величину и читаются на любом экране.
 */

/* Базовый размер доски. Меняя эти числа, вы меняете плотность: доска не станет
 * вмещать больше, она просто нарисуется крупнее или мельче. Отношение 16:9.5 близко
 * к типичному ноутбуку — на нём масштаб выходит около единицы, то есть без искажений. */
export const BOARD_WIDTH = 1520;
export const BOARD_HEIGHT = 860;

/* Верхний предел увеличения. Без него на большом мониторе доска раздувалась бы до
 * размера плаката: шрифт в 30px и половина экрана под шестью карточками. */
const MAX_SCALE = 1.35;

function fit(): number {
  /* Тесты доски рендерятся без окна. Единица — честный ответ: масштаб есть, он просто
   * никого не сжимает, и раскладка в тестах совпадает с базовой. */
  if (typeof window === "undefined") return 1;
  const byWidth = window.innerWidth / BOARD_WIDTH;
  const byHeight = window.innerHeight / BOARD_HEIGHT;
  return Math.min(byWidth, byHeight, MAX_SCALE);
}

export function BoardScaler({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(fit);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setScale(fit());
    window.addEventListener("resize", update);
    /* Поворот телефона меняет размеры не сразу: на момент события `resize` браузер
     * ещё может отдавать старую ориентацию. Отдельная подписка на смену ориентации
     * с пересчётом после кадра закрывает этот случай. */
    const orientation = window.screen?.orientation;
    const onRotate = () => requestAnimationFrame(update);
    orientation?.addEventListener?.("change", onRotate);
    return () => {
      window.removeEventListener("resize", update);
      orientation?.removeEventListener?.("change", onRotate);
    };
  }, []);

  return (
    <div className="ui-v2 grid h-dvh w-dvw place-content-center overflow-hidden bg-surface">
      <div
        style={{
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
