// Event log panel. Shown in the bottom-left section of the board column on
// desktop; hidden on mobile (chat replaces it there).
import { useEffect, useRef } from "react";
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
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events.length]);

  const filtered = events.filter((e) => e.type !== "player_moved" && e.message);

  return (
    <div className="log-panel">
      <div className="log-head">📋 Лог событий</div>
      <div className="log" ref={logRef}>
        {filtered.map((e, i) => (
          <div key={i} className={`log-line ev-${e.type}`}>
            <span className="log-icon">{ICONS[e.type] ?? "•"}</span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

