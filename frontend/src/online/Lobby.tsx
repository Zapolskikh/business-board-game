import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../i18n/errors";
import i18next from "../i18n";
import { cityApi } from "./api";
import type { CityMeta, Difficulty, RoleMeta, RoomSeat, RoomView } from "./types";

interface Props {
  roomId: string;
  meta: CityMeta;
  initialPassword?: string;
  playerId?: string;
  onBack: () => void;
  onJoined: (password: string, playerId: string) => void;
  onPlay: () => void;
}

export function Lobby({ roomId, meta, initialPassword = "", playerId, onBack, onJoined, onPlay }: Props) {
  const { t } = useTranslation("home");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [password, setPassword] = useState(initialPassword);
  const [playerName, setPlayerName] = useState(() => i18next.t("lobby.defaultName", { ns: "home" }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try { setRoom(await cityApi.room(roomId)); setError(""); }
    catch (reason) { setError(errorText(reason, "roomUnavailable")); }
  };
  useEffect(() => { void reload(); const timer = setInterval(reload, 5_000); return () => clearInterval(timer); }, [roomId]);
  useEffect(() => { if (room?.status !== "waiting" && playerId) onPlay(); }, [room?.status, playerId, onPlay]);

  const act = async (operation: () => Promise<RoomView>) => {
    setBusy(true); setError("");
    try { setRoom(await operation()); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const join = async (index: number) => {
    setBusy(true); setError("");
    try {
      const current = room?.seats.find(item => item.kind === "human" && item.player_id === playerId);
      const next = await cityApi.join(roomId, {
        password,
        seat_index: index,
        player_name: playerName.trim() || t("lobby.defaultName"),
        release_seat_index: current && current.index !== index ? current.index : null,
      });
      setRoom(next);
      const joinedId = next.seats[index].player_id;
      if (joinedId) onJoined(password, joinedId);
    } catch (reason) { setError(errorText(reason, "joinFailed")); }
    finally { setBusy(false); }
  };
  const bot = (index: number, difficulty: Difficulty, preferred_role: string | null) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "bot", difficulty, preferred_role }));
  const clear = (index: number) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "empty" }));

  if (!room) return (
    <main className="rooms-app lobby-page lobby-loading">
      <button type="button" className="rooms-button subtle" onClick={onBack}>{t("lobby.allRooms")}</button>
      <div className="rooms-empty"><span className="loading-ring" /> <h2>{error || t("lobby.loading")}</h2></div>
    </main>
  );

  const waiting = room.status === "waiting";
  const canControl = password.length >= 4;
  const enoughPlayers = room.players >= 2;
  const hasHuman = room.humans >= 1;
  const canStart = waiting && canControl && enoughPlayers && hasHuman && !busy;

  return (
    <main className="rooms-app lobby-page" data-ui="lobby">
      <header className="rooms-topbar lobby-topbar">
        <button type="button" className="rooms-button back-button" onClick={onBack}>{t("lobby.back")}</button>
        <div className="lobby-title">
          <span className={`lobby-status status-${room.status}`}><i />{t(`lobby.status.${room.status}`)}</span>
          <h1>{room.name}</h1>
        </div>
        <div className="room-code"><span>{t("lobby.roomCode")}</span><b>{room.id.slice(0, 8)}</b></div>
      </header>

      {error && <p className="rooms-alert" role="alert">⚠ {error}</p>}

      <section className="lobby-intro">
        <div><span className="eyebrow">{t("lobby.eyebrow")}</span><h2>{waiting ? t("lobby.titleWaiting") : t("lobby.titleRunning")}</h2></div>
        <p>{waiting ? t("lobby.leadWaiting") : t("lobby.leadRunning")}</p>
      </section>

      <div className="lobby-layout">
        <section className="rooms-panel seats-panel">
          <div className="rooms-section-head">
            <div><span className="eyebrow">{t("lobby.seatsEyebrow")}</span><h2>{t("lobby.seatsTitle")}</h2></div>
            <span className="seat-total">{t("lobby.seatsTaken", { players: room.players, capacity: room.capacity })}</span>
          </div>
          <div className="seat-grid-v2">
            {room.seats.map(seat => (
              <SeatCard
                key={seat.index}
                seat={seat}
                roles={meta.roles}
                waiting={waiting}
                busy={busy}
                canControl={canControl}
                currentPlayerId={playerId}
                onJoin={() => void join(seat.index)}
                onBot={(difficulty, role) => void bot(seat.index, difficulty, role)}
                onClear={() => void clear(seat.index)}
              />
            ))}
          </div>
        </section>

        <aside className="lobby-sidebar">
          <section className="rooms-panel access-card">
            <div className="rooms-section-head"><div><span className="eyebrow">{t("lobby.accessEyebrow")}</span><h2>{t("lobby.accessTitle")}</h2></div><span className={canControl ? "access-state ready" : "access-state"}>{canControl ? t("lobby.accessReady") : t("lobby.accessNeedPassword")}</span></div>
            <label className="room-field"><span>{t("lobby.playerName")}</span><input value={playerName} maxLength={32} placeholder={t("lobby.playerNamePlaceholder")} onChange={event => setPlayerName(event.target.value)} /></label>
            <label className="room-field"><span>{t("lobby.password")}</span><input type="password" value={password} placeholder={t("lobby.passwordPlaceholder")} onChange={event => setPassword(event.target.value)} /></label>
            <p className="access-note">{t("lobby.accessNote")}</p>
          </section>

          <section className="rooms-panel launch-card">
            <span className="eyebrow">{t("lobby.readyEyebrow")}</span>
            <h2>{waiting ? t("lobby.readyWaiting") : t("lobby.readyRunning")}</h2>
            <ul className="launch-checks">
              <li className={canControl ? "met" : ""}><i>{canControl ? "✓" : "·"}</i><span>{t("lobby.checkPassword")}</span></li>
              <li className={enoughPlayers ? "met" : ""}><i>{enoughPlayers ? "✓" : "·"}</i><span>{t("lobby.checkPlayers")}</span><b>{room.players}/2</b></li>
              <li className={hasHuman ? "met" : ""}><i>{hasHuman ? "✓" : "·"}</i><span>{t("lobby.checkHuman")}</span><b>{room.humans}</b></li>
            </ul>
            {waiting ? (
              <button className="rooms-button primary launch-button" disabled={!canStart} onClick={() => void act(() => cityApi.start(roomId, password))}>
                {busy ? t("lobby.wait") : t("lobby.start")}
              </button>
            ) : playerId ? (
              <button className="rooms-button primary launch-button" onClick={onPlay}>{t("lobby.resume")}</button>
            ) : (
              <p className="launch-hint">{t("lobby.pickSeatFirst")}</p>
            )}
            {waiting && !canStart && <p className="launch-hint">{t("lobby.meetChecks")}</p>}
          </section>
        </aside>
      </div>
    </main>
  );
}

function SeatCard({
  seat,
  roles,
  waiting,
  busy,
  canControl,
  currentPlayerId,
  onJoin,
  onBot,
  onClear,
}: {
  seat: RoomSeat;
  roles: RoleMeta[];
  waiting: boolean;
  busy: boolean;
  canControl: boolean;
  currentPlayerId?: string;
  onJoin: () => void;
  onBot: (difficulty: Difficulty, role: string | null) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  const mine = Boolean(currentPlayerId && seat.player_id === currentPlayerId);
  const preferredRole = roles.find(role => role.id === seat.preferred_role);
  return (
    <article className={`seat-card-v2 seat-${seat.kind} ${mine ? "seat-mine" : ""}`} data-ui="seat-card">
      <header>
        <span className="seat-number">{seat.index + 1}</span>
        <span className="seat-kind">{t(`seat.kind.${seat.kind === "human" && mine ? "mine" : seat.kind}`)}</span>
      </header>

      <div className="seat-identity">
        <span className="seat-avatar">{seat.kind === "bot" ? "◆" : seat.kind === "human" ? "●" : "+"}</span>
        <span>
          <strong>{seat.kind === "empty" ? t("seat.emptyTitle") : seat.name}</strong>
          <small>{seat.kind === "bot" ? `${t(`common:difficulty.${seat.difficulty}`, { defaultValue: seat.difficulty })} · ${preferredRole ? preferredRole.title : t("seat.anyRole")}` : seat.kind === "human" ? (mine ? t("seat.youAreHere") : t("seat.humanPlayer")) : t("seat.emptyHint")}</small>
        </span>
      </div>

      {seat.kind === "human" ? (
        mine ? <div className="seat-confirmed">{t("seat.confirmed")}</div> : <button type="button" className="rooms-button secondary seat-action" disabled={busy || !canControl} onClick={onJoin}>{waiting ? t("seat.sitHere") : t("seat.returnHere")}</button>
      ) : seat.kind === "empty" ? (
        <>
          <button type="button" className="rooms-button secondary seat-action" disabled={busy || !canControl || !waiting} onClick={onJoin}>{t("seat.take")}</button>
          {waiting && (
            <details className="bot-setup">
              <summary>{t("seat.addBot")} <span>⌄</span></summary>
              <BotConfigurator seat={seat} roles={roles} disabled={busy || !canControl} onApply={onBot} />
            </details>
          )}
        </>
      ) : (
        <>
          {waiting && <BotConfigurator seat={seat} roles={roles} disabled={busy || !canControl} onApply={onBot} />}
          {waiting && <button type="button" className="rooms-button text-danger" disabled={busy || !canControl} onClick={onClear}>{t("seat.removeBot")}</button>}
        </>
      )}
    </article>
  );
}

// Only Reborn is offered: the engine still accepts the retired policies, but they play the old economy.
function BotConfigurator({ seat, roles, disabled, onApply }: {
  seat: RoomSeat;
  roles: RoleMeta[];
  disabled: boolean;
  onApply: (difficulty: Difficulty, role: string | null) => void;
}) {
  const { t } = useTranslation("home");
  const [role, setRole] = useState(seat.preferred_role ?? "");
  useEffect(() => { setRole(seat.preferred_role ?? ""); }, [seat.preferred_role]);
  return (
    <div className="bot-controls-v2">
      <div className="bot-model-v2"><span>{t("seat.botModel")}</span><b>Claude Reborn</b></div>
      <label className="room-field">{t("seat.preferredRole")}
        <select value={role} onChange={event => setRole(event.target.value)}>
          <option value="">{t("seat.anyRoleOption")}</option>
          {roles.map(item => <option value={item.id} key={item.id}>{item.icon} {item.title}</option>)}
        </select>
      </label>
      <button type="button" className="rooms-button subtle" disabled={disabled} onClick={() => onApply("expert", role || null)}>{seat.kind === "bot" ? t("seat.saveBot") : t("seat.placeBot")}</button>
    </div>
  );
}
