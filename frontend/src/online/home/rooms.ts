import { readRoomSecrets } from "../roomSecrets";
import type { RoomSummary } from "../types";

/** Что можно сделать с комнатой из списка: войти, вернуться на своё место — или ничего. */
export type RoomAction = "enter" | "return" | "full" | "inGame" | "over";

/** Этот браузер сидел в комнате: ключ места и номер места лежат в его секретах (roomSecrets). */
export function sitsIn(room: RoomSummary): boolean {
  const secrets = readRoomSecrets(room.id);
  return Boolean(secrets.seat && secrets.playerId);
}

export function roomAction(room: RoomSummary): RoomAction {
  // Вернуться можно по ключу места, а не по совпадению имени: его знает только этот браузер.
  if (room.status !== "finished" && sitsIn(room)) return "return";
  if (room.status === "playing") return "inGame";
  if (room.status === "finished") return "over";
  return room.players < room.capacity ? "enter" : "full";
}

const ORDER: Record<RoomAction, number> = { return: 0, enter: 1, full: 2, inGame: 3, over: 4 };

/** Сначала свои комнаты, потом те, куда можно сесть; внутри — свежие выше. */
export function sortRooms(rooms: RoomSummary[]): RoomSummary[] {
  return [...rooms].sort(
    (a, b) => ORDER[roomAction(a)] - ORDER[roomAction(b)] || b.updated_at.localeCompare(a.updated_at),
  );
}
