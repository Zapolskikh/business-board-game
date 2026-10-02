import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { describeEventSegments } from "../../online/gameUi";
import { useGameLogExport } from "../../online/gameLogExport";
import type { CityMeta, GameState, RoomView } from "../../online/types";
import { Modal } from "../primitives/Modal";
import { LogSegments } from "./LogSegments";
import { useRoom, useSession } from "../lib/session";

/* Хроника. Единственное место, которому поповера мало: события идут списком и их много.
 *
 * Когда на бэкенде появится покадровая отдача ходов ботов, эта же разметка станет
 * подписью под проигрыванием — сегменты уже размечены по типам (игрок, число, текст).
 */
export function Chronicle({
  open,
  onClose,
  game,
  meta,
  exportEnabled = true,
}: {
  open: boolean;
  onClose: () => void;
  game: GameState;
  meta: CityMeta;
  /** В /dev нет серверной сессии; сама хроника работает, сетевые кнопки экспорта — нет. */
  exportEnabled?: boolean;
}) {
  const { t } = useTranslation("game");
  const events = [...game.event_log].reverse();

  return (
    <Modal open={open} onClose={onClose} title={t("ui.chronicle.title")} subtitle={t("ui.chronicle.events", { count: events.length })}>
      {/* Выгрузка доступна и по ходу партии, не только на финише: комнаты истекают
        * вместе со всем, что в них произошло, и невыгруженная партия пропадает совсем.
        *
        * Панель вынесена отдельно не ради красоты: она ходит в сессию и кеш запросов,
        * а хроника смонтирована всегда — так эти зависимости нужны только при открытом окне. */}
      {open && exportEnabled && <ExportBar game={game} meta={meta} />}
      <ol className="grid gap-1">
        {events.map(event => {
          const segments = describeEventSegments(event, game, meta);
          if (segments.length === 0) return null;
          return (
            <li
              key={event.seq}
              className="flex flex-wrap items-baseline gap-x-1 rounded-md bg-panel-2 px-2 py-1.5"
            >
              <span className="mr-1 text-3xs text-ink-dim">#{event.seq}</span>
              <LogSegments segments={segments} />
            </li>
          );
        })}
        {events.length === 0 && <li className="text-ink-dim">{t("ui.chronicle.empty")}</li>}
      </ol>
    </Modal>
  );
}

function ExportBar({ game, meta }: { game: GameState; meta: CityMeta }) {
  const { t } = useTranslation("game");
  const { roomId, password, playerId } = useSession();
  /* Хроника живёт внутри <GameGate>, где партия уже загружена; запасной вариант нужен типам. */
  const room = (useRoom().data ?? { game, revision: game.revision }) as RoomView;
  const { status, copy, download, downloadJournal } = useGameLogExport(room, meta);
  /* Сид и список команд сервер отдаёт только после финиша — до него кнопки нет. */
  const replayable = game.status === "finished";

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-b border-line pb-2.5">
      <ExportButton onClick={() => void copy()} title={t("ui.chronicle.copyTitle")}>
        {t("ui.chronicle.copy")}
      </ExportButton>
      <ExportButton onClick={download} title={t("ui.chronicle.mdTitle")}>
        {t("ui.chronicle.md")}
      </ExportButton>
      {replayable && (
        <ExportButton
          onClick={() => void downloadJournal(roomId, password, playerId)}
          title={t("ui.chronicle.jsonTitle")}
        >
          {t("ui.chronicle.json")}
        </ExportButton>
      )}
      {status && <small className="w-full text-3xs text-good">{status}</small>}
    </div>
  );
}

function ExportButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-md border border-line bg-panel-2 px-2 py-1 text-3xs font-semibold text-ink
        hover:border-accent"
    >
      {children}
    </button>
  );
}
