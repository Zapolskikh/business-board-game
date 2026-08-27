import { useState } from "react";
import type { CityMeta } from "../online/types";
import { Board } from "./board/Board";
import { GameQueryProvider, GameSession, createGameQueryClient, useRoom } from "./lib/session";
import "./theme.css";

/* Точка входа нового интерфейса. Держит QueryClient и ждёт первой загрузки партии,
 * чтобы внутри доски `useGame()` уже гарантированно имел состояние.
 */
export function GameScreen({
  roomId,
  password,
  playerId,
  meta,
  roomName,
  onExit,
}: {
  roomId: string;
  password: string;
  playerId: string;
  meta: CityMeta;
  roomName: string;
  onExit: () => void;
}) {
  const [client] = useState(createGameQueryClient);

  return (
    <GameQueryProvider client={client}>
      <GameSession roomId={roomId} password={password} playerId={playerId} meta={meta}>
        <Gate roomName={roomName} onExit={onExit} />
      </GameSession>
    </GameQueryProvider>
  );
}

function Gate({ roomName, onExit }: { roomName: string; onExit: () => void }) {
  const { data, error, isLoading } = useRoom();

  if (data?.game) return <Board roomName={roomName} onExit={onExit} />;

  return (
    <div className="ui-v2 grid h-dvh place-content-center gap-3 justify-items-center bg-surface
      font-sans text-ink">
      <p className="text-ink-muted">
        {isLoading
          ? "Загрузка партии…"
          : error instanceof Error
            ? error.message
            : "Партия ещё не начата"}
      </p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-md border border-line bg-panel-2 px-3 py-2 text-xs hover:border-accent"
      >
        ← К комнатам
      </button>
    </div>
  );
}
