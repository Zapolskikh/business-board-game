import { tr } from "../../i18n";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { useState, type ReactNode } from "react";
import { useIsMobile } from "../lib/layout";
import { ResourceText } from "./ResourceIcon";

/* Обёртка поповера — единственное место, знающее про Radix.
 *
 * Контент поповеров пишется отдельными компонентами, которые не знают, во что их обернули.
 * На телефоне та же начинка открывается окном по центру экрана — и это не косметика: стол там
 * низкий, и у поповера, привязанного к карточке среднего ряда, не оставалось высоты ни сверху,
 * ни снизу — кнопка покупки уезжала под край. По центру помещается всё и всегда, по какой бы
 * карточке ни нажали.
 */
export function CardPopover({
  children,
  content,
  side = "right",
  align = "start",
  label,
  width = 340,
}: {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  label?: string;
  /** Ширина в пикселях: карточке игрока нужен его стол, а он в 340px не помещается. */
  width?: number;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (mobile) {
    return (
      /* Немодально и со своим затемнением: модальный Radix запирает указатель на своём слое, а
       * окно открывается и поверх панели руки, то есть слоёв два. Смешивать модальный с
       * немодальным — известный способ получить залипший `pointer-events: none` на всей
       * странице. */
      <Dialog.Root open={open} modal={false} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>{children}</Dialog.Trigger>
        <Dialog.Portal>
          {/* Выше панели руки (z-50), потому что открывается и поверх неё: подробности карты
            * в руке должны быть видны целиком. */}
          {/* Не кнопка: глобальный стиль кнопок лобби перебивает утилиты вне `.ui-v2` и красит
            * затемнение непрозрачным. Закрыть можно Esc и кнопкой внизу окна. */}
          {open && <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-[60] bg-[#000a]" />}
          <Dialog.Content
            data-ui="card-details"
            aria-describedby={undefined}
            style={{ width: `min(94vw, ${Math.max(width, 360)}px)` }}
            className="ui-v2 fixed left-1/2 top-1/2 z-[61] grid max-h-[85dvh]
              -translate-x-1/2 -translate-y-1/2 grid-rows-[minmax(0,1fr)_auto] overflow-hidden
              rounded-[12px] border border-line-2 bg-panel font-sans text-ink"
          >
            <Dialog.Title className="sr-only">{label ?? tr("game", "ui.common.details")}</Dialog.Title>
            <div className="overflow-auto">{content}</div>
            {/* Отдельная кнопка, а не только тап мимо окна: мимо окна на телефоне
              * промахиваются в соседнюю карточку, и вместо закрытия открывается она. */}
            <Dialog.Close className="border-t border-line px-3 py-2.5 text-center text-xs text-ink-muted">
              {tr("game", "ui.common.close")}
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
          data-ui="card-details"
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={10}
          aria-label={label}
          style={{ width: `min(94vw, ${width}px)` }}
          /* Высота — сколько реально есть места от карточки до края экрана (Radix считает это
           * сам), а не плоские 460px: окно игрока и длинный объект в них не влезали, и кнопка
           * покупки уезжала под край. Прокручивается только содержимое — стрелка снаружи,
           * иначе её 6px давали лишнюю полосу прокрутки почти каждому окну. */
          className="ui-v2 z-50 flex max-h-[min(720px,var(--radix-popover-content-available-height,80vh))]
            flex-col rounded-[10px] border border-line-2 bg-panel font-sans text-ink"
        >
          <div className="min-h-0 overflow-auto rounded-[10px]">{content}</div>
          <Popover.Arrow className="fill-line-2" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Шапка/подвал контента — общие для всех поповеров, поэтому живут рядом с обёрткой. */
export function PopoverHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 border-b border-line px-3 py-2.5">
      {/* Заголовки вроде «🛡 Защита» несут символ ресурса: строку показываем иконками игры. */}
      <b className="min-w-0 flex-1 text-[13.5px] font-bold">
        {typeof title === "string" ? <ResourceText>{title}</ResourceText> : title}
      </b>
      {subtitle && <span className="shrink-0 text-2xs text-ink-dim">{subtitle}</span>}
    </div>
  );
}

export function PopoverBody({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2.5 text-[11.5px] leading-[1.45] text-ink-muted">{children}</div>;
}

/* Подвал прилипает к низу прокрутки: в нём кнопка действия — купить, взять, продать, — и она
 * должна быть видна сразу, а не после прокрутки длинного описания. */
export function PopoverFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 grid gap-1.5 border-t border-line bg-panel px-3 py-2.5">
      {children}
    </div>
  );
}
