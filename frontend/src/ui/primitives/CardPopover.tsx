import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { useState, type ReactNode } from "react";
import { useIsPortrait } from "../lib/layout";

/* Обёртка поповера — единственное место, знающее про Radix.
 *
 * Контент поповеров пишется отдельными компонентами, которые не знают, во что их обернули.
 * Вертикально та же начинка открывается окном по центру экрана — и это не косметика:
 * поповер привязан к своей карточке, а карточка на телефоне может стоять у самого края,
 * и половина окна уезжала за экран. По центру помещается всё и всегда, независимо от того,
 * по какой из шести карточек нажали и открыта ли при этом боковая шторка.
 */
export function CardPopover({
  children,
  content,
  side = "right",
  align = "start",
  label,
}: {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  label?: string;
}) {
  const portrait = useIsPortrait();
  const [open, setOpen] = useState(false);

  if (portrait) {
    return (
      /* Немодально и со своим затемнением — по той же причине, что и у шторок: модальный
       * Radix запирает указатель на своём слое, а окно открывается и поверх шторки, то есть
       * слоёв два. Смешивать модальный с немодальным — известный способ получить залипший
       * `pointer-events: none` на всей странице. */
      <Dialog.Root open={open} modal={false} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>{children}</Dialog.Trigger>
        <Dialog.Portal>
          {/* Выше шторок (z-50), потому что открывается и поверх них: карточка игрока
            * лежит в левой шторке, а её подробности должны быть видны целиком. */}
          {open && (
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[60] bg-[#000a]"
            />
          )}
          <Dialog.Content
            aria-describedby={undefined}
            className="ui-v2 fixed left-1/2 top-1/2 z-[61] grid max-h-[85dvh] w-[min(94vw,360px)]
              -translate-x-1/2 -translate-y-1/2 grid-rows-[minmax(0,1fr)_auto] overflow-hidden
              rounded-[12px] border border-line-2 bg-panel font-sans text-ink
              shadow-[0_24px_80px_#000c]"
          >
            <Dialog.Title className="sr-only">{label ?? "Подробности"}</Dialog.Title>
            <div className="overflow-auto">{content}</div>
            {/* Отдельная кнопка, а не только тап мимо окна: мимо окна на телефоне
              * промахиваются в соседнюю карточку, и вместо закрытия открывается она. */}
            <Dialog.Close className="border-t border-line px-3 py-2.5 text-center text-xs text-ink-muted">
              Закрыть
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={10}
          aria-label={label}
          className="ui-v2 z-50 w-[340px] max-h-[min(460px,80vh)] overflow-auto rounded-[10px]
            border border-line-2 bg-panel font-sans text-ink shadow-[0_20px_60px_#000c]"
        >
          {content}
          <Popover.Arrow className="fill-line-2" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Шапка/подвал контента — общие для всех поповеров, поэтому живут рядом с обёрткой. */
export function PopoverHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-line px-3 py-2.5">
      <b className="flex-1 text-[13.5px] font-bold">{title}</b>
      {subtitle && <span className="text-2xs text-ink-dim">{subtitle}</span>}
    </div>
  );
}

export function PopoverBody({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2.5 text-[11.5px] leading-[1.45] text-ink-muted">{children}</div>;
}

export function PopoverFooter({ children }: { children: ReactNode }) {
  return <div className="grid gap-1.5 border-t border-line px-3 py-2.5">{children}</div>;
}
