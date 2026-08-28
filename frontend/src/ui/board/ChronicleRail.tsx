import { describeEventSegments } from "../../online/gameUi";
import type { CityMeta, GameState } from "../../online/types";
import { Panel, SectionHead } from "../primitives/atoms";

/* Лента хроники в левой колонке.
 *
 * Раньше здесь была панель «Ваш ход» — сводка того, что и так видно в шапке и на карточках.
 * Последние события видно нигде не было: ходы ботов проходили молча, и о том, что кто-то
 * перехватил роль или устроил рэкет, игрок узнавал по изменившимся числам.
 *
 * Клик открывает полную хронику в окне по центру — тот же список, но целиком.
 */
export function ChronicleRail({
  game,
  meta,
  unseen,
  onOpen,
}: {
  game: GameState;
  meta: CityMeta;
  /** Сколько событий пришло с последнего открытия полной хроники. */
  unseen: number;
  onOpen: () => void;
}) {
  // Свежие сверху: лента короткая, и листать её некуда.
  const events = [...game.event_log].reverse();

  return (
    <Panel rows zone="chronicle">
      <SectionHead
        title="Хроника"
        meta={unseen > 0 ? `${unseen} новых · открыть` : `${events.length} событий · открыть`}
      />
      <button
        type="button"
        onClick={onOpen}
        aria-label="Открыть полную хронику"
        className="grid min-h-0 content-start gap-[3px] overflow-hidden rounded-md p-px text-left
          hover:bg-panel-2"
      >
        {events.length === 0 && <span className="text-3xs text-ink-dim">Пока ничего не произошло.</span>}
        {events.slice(0, 12).map(event => {
          const segments = describeEventSegments(event, game, meta);
          if (segments.length === 0) return null;
          return (
            <span
              key={event.seq}
              className="flex flex-wrap items-baseline gap-x-1 overflow-hidden rounded bg-panel-2
                px-1.5 py-[3px] text-3xs leading-tight text-ink-muted"
            >
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
            </span>
          );
        })}
      </button>
    </Panel>
  );
}
