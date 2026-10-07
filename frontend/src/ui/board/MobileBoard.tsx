import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { GameState, LegalAction } from "../../online/types";
import { resolve, type ActionContext } from "../lib/actions";
import { fullscreenSupport, toggleFullscreen } from "../lib/fullscreen";
import { useThemeStyle } from "../lib/theme";
import { ConfirmModal } from "../primitives/Modal";
import { useBlockedHint } from "../primitives/BlockedHint";

/* Стол телефона в альбомной ориентации.
 *
 * Состав тот же, что у широкого стола, и компоненты те же самые: слева игроки, справа действия,
 * обе колонки на виду всегда. Меняется центр — проекты, рынок и город в широком столе стоят друг
 * под другом, а здесь это вкладки, по одной за раз: на высоте телефона три зоны сразу означали бы
 * карточки, которые нельзя прочесть. Карточки во вкладке полноразмерные, со всеми полями — ради
 * этого вкладки и сделаны.
 *
 * Хроника, рука и конец хода — в нижней панели. Хроника и рука открываются по нажатию,
 * «Завершить ход» стоит под правым большим пальцем.
 */

export type MobileView = "projects" | "market" | "city";

export function MobileTable({
  game,
  context,
  onAction,
  players,
  actions,
  projects,
  market,
  city,
  hand,
  unseen,
  onChronicle,
  chatUnread,
  onChat,
}: {
  game: GameState;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
  players: ReactNode;
  actions: ReactNode;
  projects: ReactNode;
  market: ReactNode;
  city: ReactNode;
  hand: ReactNode;
  unseen: number;
  onChronicle: () => void;
  /** Есть реплики, пришедшие с последнего открытия чата. */
  chatUnread: boolean;
  onChat: () => void;
}) {
  const { t } = useTranslation("game");
  const [view, setView] = useState<MobileView>("market");
  const [handOpen, setHandOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const blocked = useBlockedHint();
  const me = context.me;
  const endTurn = resolve(context, "end_turn");
  const has = (type: string) => context.legal.some(action => action.type === type);

  /* Точка на вкладке — «здесь сейчас есть что сделать». Сама вкладка закрыта, и без неё доступный
   * проект или покупка на рынке оставались бы незамеченными, пока смотришь в другую. */
  const tabs: { id: MobileView; icon: string; label: string; meta?: string; dot: boolean }[] = [
    { id: "projects", icon: "🏛", label: t("ui.mobile.projects"), dot: has("city_project") },
    { id: "market", icon: "🛒", label: t("ui.mobile.market"), dot: has("buy_asset") },
    {
      id: "city",
      icon: "🏙",
      label: t("ui.mobile.city"),
      meta: `${me.assets.length}/${me.capacity}`,
      dot: has("buy_capacity"),
    },
  ];

  const handCount = me.hand?.length ?? 0;
  const handDot = has("play_action_card") || has("buy_action_card");

  function finish(target: HTMLElement) {
    if (endTurn.kind !== "ready") {
      blocked.show(endTurn.kind === "blocked" ? endTurn.reason : undefined, target);
      return;
    }
    /* Действия сгорают в конце хода. На телефоне по большой кнопке промахиваются чаще, чем мышью,
     * поэтому с неистраченными действиями ход заканчивается только после подтверждения. */
    if (game.actions_left > 0) setConfirmEnd(true);
    else onAction(endTurn.action);
  }

  return (
    <div className="grid min-h-0 grid-cols-[238px_minmax(0,1fr)_274px] grid-rows-[minmax(0,1fr)_auto] gap-1.5">
      {players}

      <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-1.5">
        <div role="tablist" aria-label={t("ui.mobile.board")} className="grid grid-cols-3 gap-1.5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-ui={`mobile-tab-${tab.id}`}
              data-tutorial={`tab-${tab.id}`}
              aria-selected={view === tab.id}
              data-active={view === tab.id || undefined}
              onClick={() => setView(tab.id)}
              className="mobile-tab card-serif relative flex h-11 items-center justify-center gap-2 rounded-panel border
                text-[17px] font-bold"
            >
              <span aria-hidden="true" className="text-[18px]">{tab.icon}</span>
              {tab.label}
              {tab.meta && <small className="font-sans text-[12px] font-semibold opacity-70">{tab.meta}</small>}
              {tab.dot && view !== tab.id && (
                <span aria-hidden="true" className="absolute right-2 top-2 size-2.5 rounded-full bg-gold" />
              )}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
          {view === "projects" ? projects : view === "market" ? market : city}
        </div>
      </div>

      {actions}

      {/* Хроника и чат делят левый нижний угол пополам: подписи короткие, счётчик событий уступил
        * место второй кнопке — он и так стоит в заголовке самой хроники. */}
      <div className="grid min-w-0 grid-cols-2 gap-1.5">
        <BarButton icon="📜" label={t("ui.mobile.chronicle")} meta="" dot={unseen > 0} onClick={onChronicle} ui="mobile-chronicle" />
        <BarButton icon="💬" label={t("ui.mobile.chat")} meta="" dot={chatUnread} onClick={onChat} ui="mobile-chat" />
      </div>

      <BarButton icon="🃏" label={t("ui.mobile.hand")} meta={`${handCount}/3`} dot={handDot}
        onClick={() => setHandOpen(true)} ui="mobile-hand" tutorial="hand-button" />

      <button
        type="button"
        data-ui="mobile-end-turn"
        data-tutorial="end-turn"
        aria-disabled={endTurn.kind !== "ready" || undefined}
        onClick={event => finish(event.currentTarget)}
        className="primary-button card-serif h-12 rounded-[9px] px-3 text-center text-[19px] font-bold aria-disabled:opacity-50"
      >
        {endTurn.kind === "pending" ? t("ui.actions.ending") : t("ui.actions.endTurn")}
      </button>

      {blocked.hint}

      <HandSheet open={handOpen} onClose={() => setHandOpen(false)}>{hand}</HandSheet>

      <ConfirmModal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={() => endTurn.kind === "ready" && onAction(endTurn.action)}
        title={t("ui.mobile.endTurnTitle")}
        price={t("ui.mobile.endTurnLeft", { count: game.actions_left })}
        confirmLabel={t("ui.actions.endTurn")}
      >
        {t("ui.mobile.endTurnText")}
      </ConfirmModal>
    </div>
  );
}

function BarButton({
  icon,
  label,
  meta,
  dot,
  onClick,
  ui,
  tutorial,
}: {
  icon: string;
  label: string;
  meta: string;
  dot: boolean;
  onClick: () => void;
  ui: string;
  /** Метка для подсветки в обучении (online/Tutorial.tsx). */
  tutorial?: string;
}) {
  return (
    <button
      type="button"
      data-ui={ui}
      data-tutorial={tutorial}
      onClick={onClick}
      className={`relative flex h-12 min-w-0 items-center rounded-panel border border-line bg-panel text-left
        hover:bg-panel-2 active:bg-panel-3 ${meta ? "gap-2.5 px-3.5" : "justify-center gap-1 px-1"}`}
    >
      <span aria-hidden="true" className={meta ? "text-[20px]" : "text-[17px]"}>{icon}</span>
      <b className={`card-serif overflow-hidden text-ellipsis whitespace-nowrap ${meta ? "text-[17px]" : "text-[15px]"}`}>
        {label}
      </b>
      {meta && (
        <span className="ml-auto overflow-hidden text-ellipsis whitespace-nowrap pr-2 text-[13px] text-ink-dim">{meta}</span>
      )}
      {dot && <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-gold" />}
    </button>
  );
}

/* Рука — панелью снизу во всю ширину, а не окном: карты в ней — продолжение стола, и доска
 * остаётся видна над панелью.
 *
 * `modal={false}` намеренно: подробности карты открываются отдельным окном поверх панели, а
 * модальный Radix запер бы указатель на своём слое, и окно над ним оказалось бы мёртвым.
 * Затемнение рисуем сами — оно же и кнопка «закрыть». Нажатие мимо панели её не закрывает:
 * «мимо» — это в том числе окно с подробностями карты, открытое поверх.
 */
function HandSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const theme = useThemeStyle();
  const { t } = useTranslation("game");
  return (
    <Dialog.Root open={open} modal={false} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        {/* Затемнение — не кнопка: глобальный стиль кнопок лобби (`button:where(:not(.ui-v2 *))`)
          * лежит вне слоёв и перебивает утилиты, и портал в body получал непрозрачный фон. Закрыть
          * с клавиатуры можно Esc и кнопкой ✕. */}
        {open && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-[#0008]" />}
        <Dialog.Content
          data-ui="hand-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
          style={{ ...theme, ...sheetInsets }}
          className="ui-v2 mobile-sheet fixed inset-x-0 bottom-0 z-50 grid gap-1.5 rounded-t-[14px] border-t
            border-line-2 bg-surface px-3 pt-2 font-sans text-ink shadow-[0_-8px_24px_rgb(0_0_0/0.45)]"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="mx-auto h-1 w-12 rounded-full bg-line-2" />
          </div>
          <Dialog.Title className="sr-only">{t("ui.mobile.hand")}</Dialog.Title>
          <Dialog.Close
            data-ui="hand-close"
            aria-label={t("ui.mobile.closeHand")}
            className="absolute right-3 top-2 z-10 grid size-11 place-items-center rounded-md border border-line
              bg-panel-2 text-[18px] text-ink-muted hover:bg-panel-3"
          >
            ✕
          </Dialog.Close>
          <div className="pr-14">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const sheetInsets: CSSProperties = {
  paddingLeft: "max(12px, env(safe-area-inset-left))",
  paddingRight: "max(12px, env(safe-area-inset-right))",
  paddingBottom: "max(10px, env(safe-area-inset-bottom))",
};

/* Обёртка мобильного стола. Того же назначения, что BoardScaler, но без множителя: масштаб уже
 * задан логической шириной вьюпорта, и здесь размеры настоящие. Отступы — под вырез камеры и
 * полоску «Домой»: в альбомной ориентации вырез стоит сбоку, и рисовать под ним нельзя.
 * Класс `ui-v2` обязателен: на нём висит весь ресет темы. */
export function MobileShell({ children }: { children: ReactNode }) {
  const theme = useThemeStyle();
  return (
    <div
      style={{
        ...theme,
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      className="ui-v2 mobile-shell h-[var(--app-h)] w-[var(--app-w)] overflow-hidden bg-surface select-none"
    >
      {children}
    </div>
  );
}

/* Партия на телефоне — только в альбомной ориентации. Вертикально стол не перестраивается во
 * второй, урезанный вариант: вместо этого просьба повернуть телефон. */
export function RotateNotice({ onExit }: { onExit: () => void }) {
  const theme = useThemeStyle();
  const { t } = useTranslation("game");
  const support = fullscreenSupport();
  return (
    <div
      style={theme}
      data-ui="rotate-notice"
      className="ui-v2 grid h-dvh w-dvw place-content-center justify-items-center gap-4 bg-surface px-8 text-center
        font-sans text-ink"
    >
      <span aria-hidden="true" className="rotate-hint text-[64px] leading-none">📱</span>
      <b className="card-serif text-[22px]">{t("ui.mobile.rotateTitle")}</b>
      <p className="max-w-[320px] text-[15px] leading-snug text-ink-muted">{t("ui.mobile.rotateText")}</p>
      {/* Нажатие — тот самый жест, без которого браузер не пустит в полный экран; заодно он
          закрепляет альбомную ориентацию, и поворачивать телефон руками уже не нужно. */}
      {support === "api" && (
        <button
          type="button"
          data-ui="fullscreen"
          onClick={() => void toggleFullscreen()}
          className="min-h-11 rounded-md border border-line-2 bg-panel-3 px-4 text-[15px] hover:bg-panel-2"
        >
          ⛶ {t("ui.mobile.fullscreen")}
        </button>
      )}
      {support === "ios-home" && (
        <p
          data-ui="add-to-home"
          className="max-w-[320px] rounded-md border border-line bg-panel-2 px-3 py-2 text-left text-[13px] leading-snug
            text-ink-muted"
        >
          <b className="mb-0.5 block text-ink">⛶ {t("ui.mobile.addToHomeTitle")}</b>
          {t("ui.mobile.addToHome")} {t("ui.mobile.addToHomeSeat")}
        </p>
      )}
      <button
        type="button"
        onClick={onExit}
        className="mt-2 min-h-11 rounded-md border border-line bg-panel-2 px-4 text-[14px] text-ink-muted hover:bg-panel-3"
      >
        {t("ui.header.backToRooms")}
      </button>
    </div>
  );
}
