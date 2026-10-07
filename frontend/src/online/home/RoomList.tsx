import { useTranslation } from "react-i18next";
import type { RoomSummary } from "../types";
import { roomAction, sortRooms } from "./rooms";

/* Список комнат: название, состояние, занятость, замок у комнаты с паролем — и одно действие,
 * которое здесь действительно можно сделать. «Войти» — если есть свободное место, «Вернуться» —
 * если этот браузер за столом; остальное — подпись состояния без кнопки. */
export function RoomList({ rooms, loaded, busy, onEnter, onRemove }: {
  rooms: RoomSummary[];
  loaded: boolean;
  busy: boolean;
  onEnter: (room: RoomSummary) => void;
  onRemove: (room: RoomSummary) => void;
}) {
  const { t } = useTranslation("home");
  if (!loaded) return <p className="hm-empty" role="status">{t("rooms.loading")}</p>;
  if (!rooms.length) {
    return (
      <div className="hm-empty">
        <b>{t("rooms.emptyTitle")}</b>
        <span>{t("rooms.emptyText")}</span>
      </div>
    );
  }
  return (
    <ul className="hm-rooms">
      {sortRooms(rooms).map(room => {
        const action = roomAction(room);
        const actionable = action === "enter" || action === "return";
        return (
          <li key={room.id} className={`hm-room status-${room.status}`} data-ui="room-card">
            <span className="hm-room-text">
              <strong title={room.name}>
                {room.name}
                {!room.open && (
                  <svg className="hm-lock" viewBox="0 0 24 24" width="14" height="14" role="img" aria-label={t("rooms.locked")} fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                )}
              </strong>
              <small>
                <span className={`hm-dot status-${room.status}`} aria-hidden="true" />
                {t(`rooms.status.${room.status}`)} · {t("rooms.seats", { players: room.players, capacity: room.capacity })}
              </small>
            </span>
            {actionable ? (
              <button type="button" className={`hm-chip${action === "return" ? " is-accent" : ""}`} disabled={busy} onClick={() => onEnter(room)}>
                {t(`rooms.${action}`)}
              </button>
            ) : (
              <span className="hm-room-state">{t(`rooms.${action}`)}</span>
            )}
            <button type="button" className="hm-icon" onClick={() => onRemove(room)} aria-label={t("rooms.removeNamed", { name: room.name })} title={t("rooms.remove")}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
