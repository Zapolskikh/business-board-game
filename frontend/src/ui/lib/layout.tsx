import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/* Какой раскладкой сейчас рисуется доска.
 *
 * Раскладок ровно две, и это принципиально. `wide` — стол фиксированного размера, вписанный
 * в экран множителем: три колонки, шесть карточек рынка в два ряда, ничего не переносится.
 * `portrait` — телефон вертикально: колонка одна, боковые панели выезжают шторками, а сетки
 * карточек становятся 2×N.
 *
 * Раскладка приходит контекстом, а не пропом через семь уровней: её спрашивают три компонента
 * (рынок, город, проекты) в разных ветках дерева, и пробрасывать флаг до каждого — значит
 * менять сигнатуры всем, кто просто стоит по дороге.
 *
 * Промежуточных состояний нет намеренно. Резиновая раскладка между этими двумя — это ровно та
 * задача, из-за которой стол и сделали фиксированным: колонки сжимаются, подписи налезают,
 * и каждая правка требует проверки в четырёх ширинах.
 */
export type BoardLayout = "wide" | "portrait";

const LayoutContext = createContext<BoardLayout>("wide");

export function BoardLayoutProvider({ layout, children }: { layout: BoardLayout; children: ReactNode }) {
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>;
}

export function useBoardLayout(): BoardLayout {
  return useContext(LayoutContext);
}

/** Короткая форма для сеток: `cols(portrait, "grid-cols-2", "grid-cols-3")`. */
export function useIsPortrait(): boolean {
  return useBoardLayout() === "portrait";
}

/* Порог, ниже которого стол шириной 1520 точек перестаёт иметь смысл: множитель уходит за 0.6,
 * и текст в 9px превращается в серую рябь. Меряется ширина вьюпорта, а не «телефон ли это»:
 * узкое окно на ноутбуке — та же задача, а планшет в альбоме прекрасно играет широкой доской.
 */
const PORTRAIT_QUERY = "(max-width: 900px)";

/** Следит за шириной вьюпорта. Вне браузера (SSR, тесты) всегда `wide`. */
export function usePortraitViewport(): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [portrait, setPortrait] = useState(() => (supported ? window.matchMedia(PORTRAIT_QUERY).matches : false));

  useEffect(() => {
    if (!supported) return;
    const query = window.matchMedia(PORTRAIT_QUERY);
    const update = () => setPortrait(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [supported]);

  return portrait;
}
