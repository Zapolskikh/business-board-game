import { describeEventSegments } from "../../online/gameUi";
import type { CityMeta, GameState } from "../../online/types";
import { Modal } from "../primitives/Modal";

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
