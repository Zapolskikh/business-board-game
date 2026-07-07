// Scrolling event log — the narrative of the game. Newest events at the bottom;
// auto-scrolls as events arrive.
import { useEffect, useRef } from "react";
import type { GameEvent } from "../types";

interface Props {
  events: GameEvent[];
}

// A few event types get an icon for quick scanning.
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="panel log-panel">
      <h2>Лог событий</h2>
      <div className="log">
        {events
          .filter((e) => e.type !== "player_moved" && e.message)
          .map((e, i) => (
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
