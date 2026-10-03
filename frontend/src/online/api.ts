import type { AdminRoom, CityMeta, Difficulty, LegalAction, RoomSummary, RoomView } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json() as { detail?: string }).detail ?? message; } catch { /* noop */ }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const cityApi = {
  meta: () => request<CityMeta>("/api/city/meta"),
  rooms: () => request<RoomSummary[]>("/api/city/rooms"),
  feedback: (body: { kind: "bug" | "idea" | "other"; message: string; contact: string; version: string; user_agent: string; website: string }) =>
    request<{ id: string }>("/api/feedback", json(body)),
  room: (id: string) => request<RoomView>(`/api/city/rooms/${id}`),
  remove: (id: string, password: string) => request<void>(`/api/city/rooms/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }),
  create: (body: { name: string; password: string; capacity: number; max_rounds: number; role_price: number; open?: boolean; owner_token?: string }) =>
    request<RoomView>("/api/city/rooms", json(body)),
  join: (id: string, body: { password: string; seat_index: number; player_name: string; release_seat_index?: number | null; seat_token?: string }) =>
    request<RoomView>(`/api/city/rooms/${id}/join`, json(body)),
  seat: (id: string, body: { password: string; seat_index: number; kind: "bot" | "empty"; difficulty?: Difficulty; preferred_role?: string | null; owner_token?: string }) =>
    request<RoomView>(`/api/city/rooms/${id}/seats`, json(body)),
  start: (id: string, password: string, ownerToken?: string) =>
    request<RoomView>(`/api/city/rooms/${id}/start`, json({ password, owner_token: ownerToken })),
  state: (id: string, password: string, viewerId: string, afterRevision?: number, adminToken?: string) => {
    const params = new URLSearchParams({ viewer_id: viewerId });
    if (afterRevision !== undefined) params.set("after_revision", String(afterRevision));
    const headers: Record<string, string> = { "X-Room-Password": password };
    if (adminToken) headers["X-Admin-Token"] = adminToken;
    return request<RoomView>(`/api/city/rooms/${id}/state?${params}`, { headers });
  },
  // Админка: все комнаты с местами, адресами и браузерами. Без верного токена сервер отвечает 404.
  adminRooms: (token: string) =>
    request<AdminRoom[]>("/api/city/admin/rooms", { headers: { "X-Admin-Token": token } }),
  // Replayable record of a finished match: the seed and the command journal, which `/state` hides
  // while the game is running. Rooms expire, so an unexported game is gone for good.
  journal: (id: string, password: string, viewerId: string) =>
    request<unknown>(`/api/city/rooms/${id}/journal?${new URLSearchParams({ viewer_id: viewerId })}`, {
      headers: { "X-Room-Password": password },
    }),
  command: (id: string, password: string, actorId: string, gameRevision: number, action: LegalAction) =>
    request<RoomView>(`/api/city/rooms/${id}/commands`, json({
      password,
      actor_id: actorId,
      type: action.type,
      payload: action.payload,
      command_id: crypto.randomUUID(),
      expected_revision: gameRevision,
    })),
};
