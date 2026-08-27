import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0009]" />
        <Dialog.Content
          style={{ width: `min(${width}px, 94vw)` }}
          className="ui-v2 fixed left-1/2 top-1/2 z-50 grid max-h-[88vh] -translate-x-1/2 -translate-y-1/2
            grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[12px] border border-line-2
            bg-panel font-sans text-ink shadow-[0_24px_80px_#000c]"
        >
          <div className="flex items-baseline gap-2 border-b border-line px-3.5 py-2.5">
            <Dialog.Title className="flex-1 text-sm font-bold">{title}</Dialog.Title>
            {subtitle && <span className="text-2xs text-ink-dim">{subtitle}</span>}
            <Dialog.Close className="px-1 text-base text-ink-dim hover:text-ink" aria-label="Закрыть">
              ✕
            </Dialog.Close>
          </div>
          <div className="overflow-auto px-3.5 py-3 text-xs leading-relaxed text-ink-muted">{children}</div>
          {footer && <div className="border-t border-line px-3.5 py-2.5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
