import { tr } from "../../i18n";
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { MOBILE_DIALOG_ZOOM, useIsMobile } from "../lib/layout";
import { ResourceText } from "./ResourceIcon";

/* Модалка — для того, чему поповера мало: хроника, правила, финальный счёт.
 * Как и с поповером, Radix здесь единственное место, знающее про библиотеку.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 620,
  children,
  footer,
  headerAction,
  area,
  nested = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** Кнопка в шапке окна, между заголовком и крестиком. */
  headerAction?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  /** Окно, в котором печатают: встаёт в видимую часть экрана над клавиатурой (см. `useVisibleArea`)
   * и занимает её по высоте, а не центруется по всей странице. */
  area?: { top: number; height: number };
  /** Окно поверх другого окна: затемнение ложится и на нижнее окно, а не только на доску. */
  nested?: boolean;
}) {
  // Контекст раскладки доходит и сквозь портал: окно рисуется внутри дерева доски.
  const zoom = useIsMobile() ? MOBILE_DIALOG_ZOOM : undefined;
  return (
    <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 bg-[#0009] ${nested ? "z-[55]" : "z-40"}`} />
        <Dialog.Content
          data-ui="modal"
          style={{
            width: `min(${Math.round(width * (zoom ?? 1))}px, calc(var(--app-w) * 0.94))`,
            ...(area ? { top: area.top, height: area.height, maxHeight: "none", translate: "-50% 0" } : {}),
          }}
          className={`ui-v2 fixed left-1/2 top-1/2 grid max-h-[calc(var(--app-h)*0.88)] -translate-x-1/2 -translate-y-1/2
            grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[12px] border border-line-2
            bg-panel font-sans text-ink ${nested ? "z-[56]" : "z-50"}`}
        >
          <div style={{ zoom }} className="flex min-w-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-bold">{title}</Dialog.Title>
            {headerAction}
            {subtitle && <span className="shrink-0 text-2xs text-ink-dim">{subtitle}</span>}
            <Dialog.Close className="px-1 text-base text-ink-dim hover:text-ink" aria-label={tr("game", "ui.common.close")}>
              ✕
            </Dialog.Close>
          </div>
          <div style={{ zoom }} className="overflow-auto px-3.5 py-3 text-xs leading-relaxed text-ink-muted">{children}</div>
          {footer && <div style={{ zoom }} className="border-t border-line px-3.5 py-2.5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* Подтверждение дорогого действия. Отдельное окно, а не второй клик по той же кнопке:
 * случайный двойной клик не должен проходить, а игрок успевает прочитать цену. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  price,
  confirmLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** Строка с ценой — выделяется отдельно, ради неё окно и показывают. */
  price: string;
  confirmLabel: string;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-[13px] hover:bg-panel-3"
          >
            {tr("game", "ui.common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="primary-button rounded-md px-3.5 py-1.5 text-[13px] font-semibold"
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="grid gap-2 text-[13px]">
        <p>{children}</p>
        <p className="font-semibold text-ink"><ResourceText>{price}</ResourceText></p>
      </div>
    </Modal>
  );
}

/* Большое окно по центру для справочников — роли, серые операции, счёт, возможности роли.
 *
 * От `Modal` отличается тем, что не рисует свою шапку: содержимое здесь — те же самые
 * компоненты `*Details`, что идут в поповеры, и у них уже есть `PopoverHeader`.
 * Так один и тот же справочник открывается и в поповере, и в окне без второй копии кода
 * и без двух заголовков подряд.
 */
export function DetailsModal({
  open,
  onClose,
  label,
  width = 720,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Для скринридера: видимого заголовка у окна нет. */
  label: string;
  width?: number;
  children: ReactNode;
}) {
  const zoom = useIsMobile() ? MOBILE_DIALOG_ZOOM : undefined;
  return (
    <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0009]" />
        <Dialog.Content
          data-ui="details-modal"
          style={{ width: `min(${Math.round(width * (zoom ?? 1))}px, calc(var(--app-w) * 0.94))` }}
          className="ui-v2 fixed left-1/2 top-1/2 z-50 grid max-h-[calc(var(--app-h)*0.88)] -translate-x-1/2 -translate-y-1/2
            grid-rows-[minmax(0,1fr)] overflow-auto rounded-[12px] border border-line-2 bg-panel
            font-sans text-xs leading-relaxed text-ink-muted [&>div>div:first-of-type]:pr-10"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <Dialog.Close
            data-ui="details-close"
            className="absolute right-2.5 top-2 z-10 px-1 text-base text-ink-dim hover:text-ink"
            aria-label={tr("game", "ui.common.close")}
          >
            ✕
          </Dialog.Close>
          <div style={{ zoom }} className="min-w-0">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
