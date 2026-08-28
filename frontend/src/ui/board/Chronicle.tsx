import type { ReactNode } from "react";
import { describeEventSegments } from "../../online/gameUi";
import { useGameLogExport } from "../../online/gameLogExport";
import type { CityMeta, GameState, RoomView } from "../../online/types";
import { Modal } from "../primitives/Modal";
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
}: {
  open: boolean;
  onClose: () => void;
  game: GameState;
  meta: CityMeta;
}) {
  const events = [...game.event_log].reverse();

  return (
    <Modal open={open} onClose={onClose} title="📜 Хроника партии" subtitle={`${events.length} событий`}>
      {/* Выгрузка доступна и по ходу партии, не только на финише: комнаты истекают
        * вместе со всем, что в них произошло, и невыгруженная партия пропадает совсем.
        *
        * Панель вынесена отдельно не ради красоты: она ходит в сессию и кеш запросов,
        * а хроника смонтирована всегда — так эти зависимости нужны только при открытом окне. */}
      {open && <ExportBar game={game} meta={meta} />}
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
              {segments.map((segment, position) => {
                if (segment.kind === "player") {
                  return (
                    <b key={position} style={{ color: segment.color }} className="font-semibold">
                      {segment.text}
                    </b>
                  );
                }
                if (segment.kind === "num") {
                  return (
                    <b
                      key={position}
                      className={
                        segment.tone === "good"
                          ? "font-semibold text-good"
                          : segment.tone === "bad"
                            ? "font-semibold text-bad"
                            : "font-semibold text-ink"
                      }
                    >
                      {segment.text}
                    </b>
                  );
                }
                return <span key={position}>{segment.text}</span>;
              })}
            </li>
          );
        })}
        {events.length === 0 && <li className="text-ink-dim">Пока ничего не произошло.</li>}
      </ol>
    </Modal>
  );
}

function ExportBar({ game, meta }: { game: GameState; meta: CityMeta }) {
  const { roomId, password, playerId } = useSession();
  /* Хроника живёт внутри <GameGate>, где партия уже загружена; запасной вариант нужен типам. */
  const room = (useRoom().data ?? { game, revision: game.revision }) as RoomView;
  const { status, copy, download, downloadJournal } = useGameLogExport(room, meta);
  /* Сид и список команд сервер отдаёт только после финиша — до него кнопки нет. */
  const replayable = game.status === "finished";

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-b border-line pb-2.5">
      <ExportButton onClick={() => void copy()} title="Скопировать журнал партии в буфер обмена">
        📋 Копировать
      </ExportButton>
      <ExportButton onClick={download} title="Скачать читаемый журнал партии в формате Markdown">
        💾 Скачать .md
      </ExportButton>
      {replayable && (
        <ExportButton
          onClick={() => void downloadJournal(roomId, password, playerId)}
          title="Скачать полный журнал: сид, все команды и финальный снапшот — по нему партию можно точно воспроизвести"
        >
          🧾 Скачать .json
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
