import { useEffect, useRef, useState } from "react";
import type { ChatMessage, PlayerState } from "../types";

interface Props {
  messages: ChatMessage[];
  players: PlayerState[];
  mySeat: string | null;
  playerColors: Record<string, string>;
  onSend: (text: string) => void;
}

export function Chat({ messages, players, mySeat, playerColors, onSend }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || !mySeat) return;
    onSend(trimmed);
    setText("");
  };

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="chat-panel">
      <div className="chat-head">💬 Чат</div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <span className="chat-empty">Пусто. Напишите что-нибудь!</span>
        )}
        {messages.map((m) => (
          <div key={m.idx} className="chat-msg">
            <span
              className="chat-author"
              style={{ color: playerColors[m.player_id] ?? "var(--text-dim)" }}
            >
              {nameOf(m.player_id)}:
            </span>{" "}
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      {mySeat && (
        <div className="chat-input-row">
          <input
            className="chat-input"
            type="text"
            placeholder="Сообщение…"
            maxLength={200}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn small" onClick={send} disabled={!text.trim()}>
            ↵
          </button>
        </div>
      )}
    </div>
  );
}
