import { useCallback, useState } from "react";
import { cityApi } from "./api";
import { buildGameLogMarkdown } from "./gameUi";
import type { CityMeta, RoomView } from "./types";

/* Выгрузка партии. Комнаты живут недолго и истекают вместе со всем, что в них произошло,
 * поэтому «скачать журнал» — не сервисная мелочь, а единственный способ сохранить партию.
 *
 * Хук лежит отдельно от обоих интерфейсов: и старая доска, и новая показывают одни и те же
 * три кнопки, и расходиться им нельзя — .md пригоден для чтения, .json для повтора партии.
 */
export function useGameLogExport(room: RoomView, meta: CityMeta) {
  const [status, setStatus] = useState("");
  const text = useCallback(() => buildGameLogMarkdown(room, meta, __GAME_VERSION__), [room, meta]);

  const save = useCallback(
    (body: string, extension: string) => {
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.download = `city-of-influence-${room.name.replace(/[^\w\-]+/g, "_")}-${stamp}.${extension}`;
      link.click();
      URL.revokeObjectURL(url);
    },
    [room.name],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text());
      setStatus("Журнал скопирован в буфер");
    } catch {
      // Буфер закрыт вне https и без жеста пользователя — в этом случае файл всё ещё доступен.
      setStatus("Скопировать не удалось — скачайте файл");
    }
  }, [text]);

  const download = useCallback(() => {
    save(text(), "md");
    setStatus("Журнал сохранён (.md)");
  }, [save, text]);

  /* Сид и список команд — то, что делает партию воспроизводимой, а не просто читаемой.
   * Сервер отдаёт его только после финиша, поэтому кнопку показываем тоже только тогда. */
  const downloadJournal = useCallback(
    async (roomId: string, password: string, playerId: string) => {
      try {
        const journal = await cityApi.journal(roomId, password, playerId);
        save(JSON.stringify(journal, null, 2), "json");
        setStatus("Полный журнал сохранён (.json) — партию можно переиграть");
      } catch (reason) {
        setStatus(reason instanceof Error ? reason.message : "Журнал недоступен");
      }
    },
    [save],
  );

  return { status, copy, download, downloadJournal, save, setStatus };
}
