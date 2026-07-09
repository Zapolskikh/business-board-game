// Thin API client for the FastAPI backend. All calls go through the Vite proxy
// (/api -> http://127.0.0.1:8000) so there is no host/port coupling in the UI.
import type { GameEvent, GameState, Meta } from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore parse error */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export interface PlayerInput {
  name: string;
  is_bot: boolean;
}

export const api = {
  getMeta: () => request<Meta>("/meta"),

  // The single shared room everyone joins. `game_id` is null when no game exists
  // yet; `persistent` is false on a local dev backend without KV configured.
  getRoom: () => request<{ game_id: string | null; persistent: boolean }>("/room"),

  createRoom: (
    players: PlayerInput[],
    board: string,
    seed?: number,
    config?: Record<string, unknown>,
  ) =>
    request<{ state: GameState }>("/room", {
      method: "POST",
      body: JSON.stringify({ players, board, seed, config }),
    }).then((r) => r.state),

  createGame: (
    players: PlayerInput[],
    board: string,
    seed?: number,
    config?: Record<string, unknown>,
  ) =>
    request<{ state: GameState }>("/games", {
      method: "POST",
      body: JSON.stringify({ players, board, seed, config }),
    }).then((r) => r.state),

  getGame: (gameId: string) =>
    request<{ state: GameState }>(`/games/${gameId}`).then((r) => r.state),

  action: (
    gameId: string,
    playerId: string,
    action: string,
    payload?: Record<string, unknown>,
  ) =>
    request<{ events: GameEvent[]; state: GameState }>(
      `/games/${gameId}/action`,
      {
        method: "POST",
        body: JSON.stringify({ player_id: playerId, action, payload }),
      },
    ),

  simulate: (games: number, players: number, board: string, seed = 0, bot = "random") =>
    request<Record<string, unknown>>("/simulate", {
      method: "POST",
      body: JSON.stringify({ games, players, board, seed, bot }),
    }),
};
