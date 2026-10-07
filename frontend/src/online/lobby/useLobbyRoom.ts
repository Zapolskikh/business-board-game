import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, cityApi } from "../api";
import type { RoomView } from "../types";

/* Комната в лобби: кто где сидит и чат.
 *
 * Пока у браузера нет доступа (комната с паролем, пароль ещё не подтверждён), видна только публичная
 * карточка — места и настройки, без чата. С доступом лобби читает приватное состояние: тот же опрос
 * приносит и места, и реплики, а `after_revision` делает пустой опрос дешёвым — сервер отвечает
 * «ничего не изменилось», пока номер ревизии тот же.
 *
 * Отказ сервера в доступе (пароль сменился, место освободили) не роняет лобби: опрос падает на
 * публичную карточку и сообщает об этом через `onDenied`. Потеря связи оставляет последнее
 * состояние на экране и поднимает `offline`.
 */
export function useLobbyRoom(
  roomId: string,
  { password, viewerId, access, onDenied }: { password: string; viewerId: string | undefined; access: boolean; onDenied: () => void },
) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [offline, setOffline] = useState(false);
  const revision = useRef<number | undefined>(undefined);
  // Ответ на действие приходит полным состоянием — его и показываем, не дожидаясь опроса.
  const apply = useCallback((next: RoomView) => {
    revision.current = next.revision;
    setRoom(current => (current && current.chat && !next.chat ? { ...next, chat: current.chat } : next));
    setFailed(null);
    setOffline(false);
  }, []);

  const denied = useRef(onDenied);
  denied.current = onDenied;

  const load = useCallback(async () => {
    try {
      if (access) {
        const next = await cityApi.state(roomId, password, viewerId ?? "", revision.current);
        if (next.changed === false) { setOffline(false); return; }
        apply(next);
      } else {
        // Публичная карточка не несёт чата: пусть ревизия не мешает потом взять полное состояние.
        revision.current = undefined;
        apply(await cityApi.room(roomId));
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        revision.current = undefined;
        denied.current();
        return;
      }
      if (reason instanceof ApiError) setFailed(reason);
      else setOffline(true);
    }
  }, [roomId, password, viewerId, access, apply]);

  useEffect(() => {
    revision.current = undefined;
    void load();
    // С чатом — почаще: реплика должна прийти за пару секунд, а не за пять.
    const timer = window.setInterval(() => void load(), access ? 2_500 : 5_000);
    return () => window.clearInterval(timer);
  }, [load, access]);

  return { room, apply, failed, offline, reload: load };
}
