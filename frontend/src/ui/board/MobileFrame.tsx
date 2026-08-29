import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";

/* Вертикальная раскладка телефона: центр всегда на экране, бока приезжают по требованию.
 *
 * Втиснуть три колонки стола в 390 точек нельзя — их и не втискиваем. На экране остаётся то,
 * ради чего игрок смотрит на доску: проекты, рынок, свой город. Игроки с хроникой и панель
 * действий уходят в шторки к левому и правому краю, и каждая открывается нажатием по язычку
 * во всю высоту экрана — промахнуться по нему большим пальцем невозможно.
 *
 * Цикл хода получается такой: посмотрел доску → открыл действия справа → сходил → закрыл →
 * снова посмотрел доску → при желании открыл игроков слева.
 *
 * Язычки стоят колонками сетки, а не поверх содержимого: перекрывать карточки нельзя — по
 * закрытому краю игрок и промахивается, пытаясь попасть по карточке.
 */

type Side = "left" | "right";

export function MobileFrame({
  center,
  left,
  right,
}: {
  center: ReactNode;
  left: ReactNode;
  right: ReactNode;
}) {
  const [open, setOpen] = useState<Side | null>(null);

  return (
    <div className="grid min-h-0 grid-cols-[24px_minmax(0,1fr)_24px] gap-1">
      <EdgeTab side="left" label="Игроки и хроника" glyph="👥" onOpen={() => setOpen("left")} />

      {/* Центр никуда не едет: он ровно между язычками и ровно по высоте экрана. `overflow-hidden`
        * здесь страховка, а не прокрутка — если содержимое всё же окажется шире, оно обрежется,
        * а не начнёт ездить по горизонтали вместе со всей доской. */}
      <div className="min-h-0 min-w-0 overflow-hidden">{center}</div>

      <EdgeTab side="right" label="Действия и рука" glyph="⚡" onOpen={() => setOpen("right")} />

      <Sheet side="left" label="Игроки и хроника" open={open === "left"} onClose={() => setOpen(null)}>
        {left}
      </Sheet>
      <Sheet side="right" label="Действия и рука" open={open === "right"} onClose={() => setOpen(null)}>
        {right}
      </Sheet>
    </div>
  );
}

/** Язычок во всю высоту колонки: значок сверху, стрелка снизу, всё остальное — площадь нажатия. */
function EdgeTab({
  side,
  label,
  glyph,
  onOpen,
}: {
  side: Side;
  label: string;
  glyph: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className={`grid h-full min-h-0 place-items-center content-center gap-2 border border-line
        bg-panel-2 text-[11px] text-ink-muted active:bg-panel-3
        ${side === "left" ? "rounded-r-[10px] border-l-0" : "rounded-l-[10px] border-r-0"}`}
    >
      <span>{glyph}</span>
      <span className="text-[13px] leading-none">{side === "left" ? "›" : "‹"}</span>
    </button>
  );
}

/* Шторка от края.
 *
 * `modal={false}` намеренно: внутри шторки живут те же карточки с поповерами, а модальный
 * Radix запирает указатель на своём слое, и поповер, отрисованный порталом рядом, оказался бы
 * мёртвым. Затемнение рисуем сами — оно же и кнопка «закрыть», а Esc и клик мимо Radix
 * обрабатывает и без модального режима.
 */
function Sheet({
  side,
  label,
  open,
  onClose,
  children,
}: {
  side: Side;
  label: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} modal={false} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        {open && (
          <button
            type="button"
            aria-label="Закрыть панель"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-[#0009]"
          />
        )}
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={event => event.preventDefault()}
          className={`ui-v2 fixed inset-y-0 z-50 grid w-[min(88vw,340px)] grid-rows-[auto_minmax(0,1fr)]
            gap-1 border-line bg-surface p-1.5 font-sans text-ink shadow-[0_0_60px_#000c]
            ${side === "left" ? "left-0 border-r" : "right-0 border-l"}`}
        >
          <div className="flex items-center gap-2 px-1">
            <Dialog.Title className="flex-1 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
              {label}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] text-ink-muted"
              aria-label="Закрыть"
            >
              {side === "left" ? "‹ Скрыть" : "Скрыть ›"}
            </Dialog.Close>
          </div>
          {/* Панели внутри — те же самые, что и на широком столе, и они рассчитывают на высоту
            * колонки: `minmax(0,1fr)` здесь и есть эта высота. */}
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)]">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
