import i18next from "./index";
import { ApiError } from "../online/api";

/* Сервер отвечает английскими фразами для разработчика («not enough money»). Игроку показываем
 * понятный текст на его языке по коду ответа, а исходная фраза остаётся только для 422 —
 * там она объясняет, какое поле не так. */
export function errorText(reason: unknown, fallback: "generic" | "roomUnavailable" | "joinFailed" | "loadRooms" | "createRoom" | "deleteRoom" = "generic"): string {
  if (reason instanceof ApiError) {
    // Частные 403 — раньше общего «неверный пароль»: иначе до них не доходит очередь.
    if (reason.status === 403 && reason.message === "only the room creator can do this") return i18next.t("errors.hostOnly");
    if (reason.status === 403 && reason.message === "chat requires this seat's key") return i18next.t("errors.seatKey");
    if (reason.status === 403) return i18next.t("errors.wrongPassword");
    if (reason.status === 404) return i18next.t("errors.notFound");
    // Занятое название — тоже 409, но игроку нужно не «обновляем», а «придумайте другое».
    if (reason.status === 409 && reason.message === "room name already taken") return i18next.t("errors.nameTaken");
    if (reason.status === 409 && reason.message === "player name already taken") return i18next.t("errors.playerNameTaken");
    if (reason.status === 409 && reason.message === "this seat is taken") return i18next.t("errors.seatTaken");
    if (reason.status === 409 && reason.message === "the seat changed; reload the room") return i18next.t("errors.seatChanged");
    if (reason.status === 409) return i18next.t("errors.conflict");
    if (reason.status === 429) return i18next.t("errors.tooMany");
    if (reason.status >= 500) return i18next.t("errors.server");
  }
  return i18next.t(`errors.${fallback}`);
}
