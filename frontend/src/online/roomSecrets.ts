/* Секреты комнаты в этом браузере.
 *
 * Пароль знают все за столом, поэтому он не может доказать, чьё место чьё. Браузер сам придумывает
 * два секрета и отдаёт серверу, а тот хранит только их хеши:
 * - ключ создателя — при создании комнаты: только с ним можно убрать бота или освободить занятое место;
 * - ключ места — при посадке: только с ним можно вернуться на своё место после перезагрузки.
 * Здесь же запоминается, на каком месте вы сидите, — чтобы узнать своё место и после перезагрузки.
 */

interface RoomSecrets {
  owner?: string;
  seat?: string;
  playerId?: string;
}

const key = (roomId: string) => `city-room:${roomId}`;

export function readRoomSecrets(roomId: string): RoomSecrets {
  try {
    return JSON.parse(localStorage.getItem(key(roomId)) ?? "{}") as RoomSecrets;
  } catch {
    return {};
  }
}

function write(roomId: string, patch: RoomSecrets): RoomSecrets {
  const next = { ...readRoomSecrets(roomId), ...patch };
  localStorage.setItem(key(roomId), JSON.stringify(next));
  return next;
}

export function newSecret(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function saveOwnerToken(roomId: string, token: string): void {
  write(roomId, { owner: token });
}

/** Ключ места этого браузера в комнате: один на комнату, создаётся при первой посадке. */
export function seatToken(roomId: string): string {
  const current = readRoomSecrets(roomId).seat;
  return current ?? write(roomId, { seat: newSecret() }).seat!;
}

export function saveSeat(roomId: string, playerId: string): void {
  write(roomId, { playerId });
}
