import * as Popover from "@radix-ui/react-popover";
import type { ReactNode } from "react";

/* Обёртка поповера — единственное место, знающее про Radix.
 *
 * Контент поповеров пишется отдельными компонентами, которые не знают, во что их обернули.
 * Мобильная версия подменит здесь Popover.Content на выезжающий снизу Sheet, и ни один
 * компонент контента при этом не изменится.
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
