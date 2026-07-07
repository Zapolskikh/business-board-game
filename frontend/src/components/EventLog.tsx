// Event log pinned to the bottom of the board column. Collapsed by default
// (shows last 3 events); expands upward to overlay the board on demand.
import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "../types";

interface Props {
  events: GameEvent[];
}

const ICONS: Record<string, string> = {
  dice_rolled: "🎲",
  money_gained: "💰",
  money_paid: "💸",
  property_bought: "🏢",
  scandal: "📰",
  role_taken: "🏷️",
  role_lost: "❌",
  hospital: "🏥",
  jail: "🚔",
  bankruptcy: "📉",
  game_over: "🏆",
  promotion: "⬆️",
};

export function EventLog({ events }: Props) {
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const filtered = events.filter((e) => e.type !== "player_moved" && e.message);

  return (
    <div className={`log-panel-wrap${expanded ? " expanded" : ""}`}>
      <button className="log-toggle-btn" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "▼ Скрыть лог" : "▲ Лог событий"}
        {!expanded && filtered.length > 0 && (
          <span className="log-peek">{filtered[filtered.length - 1]?.message}</span>
        )}
      </button>
      <div className="log">
        {filtered.map((e, i) => (
          <div key={i} className={`log-line ev-${e.type}`}>
            <span className="log-icon">{ICONS[e.type] ?? "•"}</span>
            <span>{e.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
