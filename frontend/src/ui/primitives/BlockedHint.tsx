import * as Popover from "@radix-ui/react-popover";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ResourceText } from "./ResourceIcon";

/* Плашка «почему нельзя» у недоступной кнопки.
 *
 * Причина отказа у каждой кнопки и так посчитана — её давно кладут в `title`. Но `title` живёт
 * только под мышью: на телефоне наведения нет, а атрибут `disabled` вдобавок глотает нажатие,
 * и серая кнопка не отвечала вообще ничем. Поэтому недоступная кнопка здесь не `disabled`, а
 * `aria-disabled`: она нажимается, и нажатие показывает причину вместо действия.
 *
 * Плашка, а не окно: отказ — короткий ответ, его не надо закрывать. Через пару секунд она уходит
 * сама, раньше — от нажатия мимо или Esc. Фокус не забирает: кнопка остаётся под пальцем.
 *
 * Якорь — `virtualRef` на ту кнопку, по которой нажали: обёртка вокруг кнопки сдвинула бы сетку
 * панели, а Radix с виртуальным якорем ничего в разметку не добавляет. Заодно одна плашка годится
 * на целый ряд кнопок — например, на все закрытые слоты города.
 */

const HINT_MS = 2600;

export function useBlockedHint(): {
  /** Показать причину у кнопки `target`. Без причины ничего не делает. */
  show: (reason: string | undefined, target: HTMLElement) => void;
  hint: ReactNode;
} {
  const ref = useRef<HTMLElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /* Счётчик, а не флаг: второе нажатие по той же кнопке перезапускает таймер, и плашка не
   * исчезает через полсекунды после него только потому, что первая успела отсчитать своё. */
  const [shown, setShown] = useState(0);

  const show = useCallback((reason: string | undefined, target: HTMLElement) => {
    if (!reason) return;
    ref.current = target;
    setMessage(reason);
    setShown(count => count + 1);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [message, shown]);

  const hint = (
    <Popover.Root open={message !== null} onOpenChange={open => !open && setMessage(null)}>
      <Popover.Anchor virtualRef={ref} />
      <Popover.Portal>
        <Popover.Content
          data-ui="blocked-hint"
          role="status"
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={10}
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
          /* Выше окон карточек (z-61) и панели руки: недоступная кнопка бывает и внутри них. */
          className="ui-v2 z-[70] max-w-[280px] rounded-md border border-bad/50 bg-panel px-2.5 py-1.5 font-sans
            text-[12.5px] leading-snug text-ink shadow-[0_4px_14px_rgb(0_0_0/0.45)]"
        >
          <span aria-hidden="true" className="mr-1">⛔</span>
          <ResourceText>{message ?? ""}</ResourceText>
          <Popover.Arrow className="fill-[var(--color-panel)]" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );

  return { show, hint };
}
