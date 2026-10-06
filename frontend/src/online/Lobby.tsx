import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../i18n/errors";
import { cityApi } from "./api";
import { readRoomSecrets, saveSeat, seatToken } from "./roomSecrets";
import type { CityMeta, Difficulty, RoleMeta, RoomSeat, RoomView } from "./types";

interface Props {
  roomId: string;
  meta: CityMeta;
  initialPassword?: string;
  /** Имя, под которым игрок сам садится на первое свободное место — после создания или «случайной игры». */
  autoJoinName?: string | null;
  playerId?: string;
  onBack: () => void;
  onJoined: (password: string, playerId: string) => void;
  onPlay: () => void;
}

export function Lobby({ roomId, meta, initialPassword = "", autoJoinName = null, playerId, onBack, onJoined, onPlay }: Props) {
  const { t } = useTranslation("home");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [password, setPassword] = useState(initialPassword);
  // Имя — то, что игрок ввёл на главной; пустым оно за стол не пускает.
  const [playerName, setPlayerName] = useState(() => autoJoinName || localStorage.getItem("city-player-name") || "");
  // Автопосадка — один раз: если игрок потом пересядет или встанет, лобби его не вернёт.
  const [autoJoinTried, setAutoJoinTried] = useState(false);
  // Секреты этого браузера: создатель ли он и на каком месте сидел (переживает перезагрузку).
  const [secrets, setSecrets] = useState(() => readRoomSecrets(roomId));
  const isOwner = Boolean(secrets.owner);
  const knownPlayerId = playerId ?? secrets.playerId;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(roomId); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* буфер обмена недоступен (http без localhost) — код и так виден */ }
  };

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
  const join = async (index: number, asName?: string) => {
    const nameToUse = (asName ?? playerName).trim();
    if (!nameToUse) { setError(t("lobby.nameRequired")); return; }
    setBusy(true); setError("");
    try {
      const current = room?.seats.find(item => item.kind === "human" && item.player_id === knownPlayerId);
      const next = await cityApi.join(roomId, {
        password,
        seat_index: index,
        player_name: nameToUse,
        release_seat_index: current && current.index !== index ? current.index : null,
        seat_token: seatToken(roomId),
      });
      setRoom(next);
      const joinedId = next.seats[index].player_id;
      if (joinedId) {
        saveSeat(roomId, joinedId);
        setSecrets(readRoomSecrets(roomId));
        onJoined(password, joinedId);
      }
    } catch (reason) { setError(errorText(reason, "joinFailed")); }
    finally { setBusy(false); }
  };
  const bot = (index: number, difficulty: Difficulty, preferred_role: string | null) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "bot", difficulty, preferred_role, owner_token: secrets.owner }));
  const clear = (index: number) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "empty", owner_token: secrets.owner }));

  useEffect(() => {
    if (!room || autoJoinTried || !autoJoinName || playerId || room.status !== "waiting") return;
    setAutoJoinTried(true);
    const free = room.seats.find(seat => seat.kind === "empty");
    if (free) void join(free.index, autoJoinName);
  }, [room, autoJoinTried, autoJoinName, playerId]);

  if (!room) return (
    <main className="rooms-app lobby-page lobby-loading">
      <button type="button" className="rooms-button subtle" onClick={onBack}>{t("lobby.allRooms")}</button>
      <div className="rooms-empty"><span className="loading-ring" /> <h2>{error || t("lobby.loading")}</h2></div>
    </main>
  );

  const waiting = room.status === "waiting";
  // Открытое лобби пароля не спрашивает: управлять столом может любой, кто в нём.
  const isOpen = Boolean(room.open);
  const canControl = isOpen || password.length >= 4;
  const enoughPlayers = room.players >= 2;
  const hasHuman = room.humans >= 1;
  // Начинает игру только создатель лобби: гость не может оборвать сбор стола.
  const canStart = waiting && isOwner && canControl && enoughPlayers && hasHuman && !busy;

  return (
    <main className="rooms-app lobby-page lobby-screen" data-ui="lobby">
      {/* Фон лобби — стол с городом по краям: центр тёмный, туда и встаёт панель. */}
      <div className="lobby-art" aria-hidden="true" />
      <header className="rooms-topbar lobby-topbar">
        <button type="button" className="rooms-button back-button" onClick={onBack}>{t("lobby.back")}</button>
        <div className="lobby-title">
          <span className={`lobby-status status-${room.status}`}><i />{t(`lobby.status.${room.status}`)}</span>
          <h1>{room.name}</h1>
        </div>
        <div className="room-code">
          <span><small>{t("lobby.roomCode")}</small><b>{room.id.slice(0, 8)}</b></span>
          <button type="button" className="code-copy" onClick={() => void copyCode()} aria-label={t("lobby.copyCode")} title={copied ? t("lobby.copied") : t("lobby.copyCode")}>
            {copied ? "✓" : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
            )}
          </button>
        </div>
      </header>

      {error && <p className="rooms-alert" role="alert">⚠ {error}</p>}

      <section className="lobby-intro">
        <h2>{waiting ? t("lobby.titleWaiting") : t("lobby.titleRunning")}</h2>
        <p>{waiting ? t("lobby.leadWaiting") : t("lobby.leadRunning")}</p>
      </section>

      <div className="lobby-layout">
        <section className="rooms-panel seats-panel">
          <div className="rooms-section-head">
            <h2>{t("lobby.seatsEyebrow")}</h2>
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
                isOwner={isOwner}
                currentPlayerId={playerId}
                knownPlayerId={knownPlayerId}
                onJoin={() => void join(seat.index)}
                onBot={(difficulty, role) => void bot(seat.index, difficulty, role)}
                onClear={() => void clear(seat.index)}
              />
            ))}
          </div>
        </section>

        <aside className="lobby-sidebar">
          <section className="rooms-panel access-card">
            <div className="rooms-section-head"><h2>{t("lobby.accessTitle")}</h2></div>
            <label className="room-field"><span>{t("lobby.playerName")}</span><input value={playerName} maxLength={32} placeholder={t("lobby.playerNamePlaceholder")} onChange={event => setPlayerName(event.target.value)} /></label>
            {isOpen ? (
              <p className="open-note"><b>{t("lobby.openTitle")}</b><span>{t("lobby.openNote")}</span></p>
            ) : (
            <label className="room-field">
              <span>{t("lobby.password")}</span>
              <span className="input-with-action">
                <input type={showPassword ? "text" : "password"} value={password} placeholder={t("lobby.passwordPlaceholder")} onChange={event => setPassword(event.target.value)} />
                <button type="button" className="input-action" aria-pressed={showPassword} aria-label={t(showPassword ? "create.hidePassword" : "create.showPassword")} onClick={() => setShowPassword(value => !value)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                    {showPassword && <path d="M4 4l16 16" />}
                  </svg>
                </button>
              </span>
            </label>
            )}
            <p className="access-note"><i aria-hidden="true">i</i>{canControl ? t("lobby.accessNote") : t("lobby.accessNeedPasswordNote")}</p>
          </section>

          <section className="rooms-panel launch-card">
            <span className="launch-eyebrow">{t("lobby.readyEyebrow")}</span>
            <h2>{waiting ? t("lobby.readyWaiting") : t("lobby.readyRunning")}</h2>
            <ul className="launch-checks">
              {!isOpen && <li className={canControl ? "met" : ""}><i>{canControl ? "✓" : ""}</i><span>{t("lobby.checkPassword")}</span></li>}
              <li className={enoughPlayers ? "met" : ""}><i>{enoughPlayers ? "✓" : ""}</i><span>{t("lobby.checkPlayers")}</span><b>{room.players}/2</b></li>
              <li className={hasHuman ? "met" : ""}><i>{hasHuman ? "✓" : ""}</i><span>{t("lobby.checkHuman")}</span><b>{room.humans}</b></li>
            </ul>
            {waiting && !isOwner ? (
              <p className="launch-hint host-wait">{t("lobby.waitHost")}</p>
            ) : waiting ? (
              <button className="rooms-button primary launch-button" disabled={!canStart} onClick={() => void act(() => cityApi.start(roomId, password, secrets.owner))}>
                <span>{busy ? t("lobby.wait") : t("lobby.start")}</span><span aria-hidden="true">→</span>
              </button>
            ) : playerId ? (
              <button className="rooms-button primary launch-button" onClick={onPlay}><span>{t("lobby.resume")}</span><span aria-hidden="true">→</span></button>
            ) : (
              <p className="launch-hint">{t("lobby.pickSeatFirst")}</p>
            )}
            {waiting && isOwner && !canStart && <p className="launch-hint">{!canControl ? t("lobby.meetPassword") : !hasHuman ? t("lobby.meetHuman") : t("lobby.meetChecks")}</p>}
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
  isOwner,
  currentPlayerId,
  knownPlayerId,
  onJoin,
  onBot,
  onClear,
}: {
  seat: RoomSeat;
  roles: RoleMeta[];
  waiting: boolean;
  busy: boolean;
  canControl: boolean;
  /** Создатель лобби: только он убирает ботов и освобождает занятые места. */
  isOwner: boolean;
  currentPlayerId?: string;
  /** Место, на котором этот браузер сидел раньше, — его можно занять снова и после перезагрузки. */
  knownPlayerId?: string;
  onJoin: () => void;
  onBot: (difficulty: Difficulty, role: string | null) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  const mine = Boolean(currentPlayerId && seat.player_id === currentPlayerId);
  const wasMine = !mine && Boolean(knownPlayerId && seat.player_id === knownPlayerId);
  const preferredRole = roles.find(role => role.id === seat.preferred_role);
  return (
    /* Цвет места — по номеру, как фишка игрока за столом: так места различимы и пока свободны. */
    <article className={`seat-card-v2 seat-${seat.kind} ${mine ? "seat-mine" : ""}`} data-ui="seat-card" style={{ "--seat-color": SEAT_COLORS[seat.index % SEAT_COLORS.length] } as CSSProperties}>
      <header>
        <span className="seat-number">{seat.index + 1}</span>
        <span className="seat-kind">{t(`seat.kind.${seat.kind === "human" && mine ? "mine" : seat.kind}`)}</span>
      </header>

      <div className="seat-identity">
        <span className="seat-avatar">
          {seat.kind === "bot" ? "🤖" : (
            <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true" fill="currentColor"><circle cx="24" cy="17" r="8" /><path d="M8 42c1.5-9 8-14 16-14s14.5 5 16 14Z" /></svg>
          )}
        </span>
        <span>
          <strong>{seat.kind === "empty" ? t("seat.emptyTitle") : seat.name}</strong>
          <small>{seat.kind === "bot" ? USES_PREFERRED_ROLE.has(seat.difficulty) ? `${t(`common:difficulty.${seat.difficulty}`, { defaultValue: seat.difficulty })} · ${preferredRole ? preferredRole.title : t("seat.anyRole")}` : t(`common:difficulty.${seat.difficulty}`, { defaultValue: seat.difficulty }) : seat.kind === "human" ? (mine ? t("seat.youAreHere") : t("seat.humanPlayer")) : t(isOwner ? "seat.emptyHintHost" : "seat.emptyHint")}</small>
        </span>
      </div>

      {seat.kind === "human" ? (
        /* Чужое место занять нельзя — ни человеку, ни на место бота: сервер проверяет ключ места.
         * Вернуться можно только на своё прежнее; освободить чужое — только создателю. */
        mine ? <div className="seat-confirmed">{t("seat.confirmed")}</div>
        : wasMine ? <button type="button" className="rooms-button secondary seat-action" disabled={busy || !canControl} onClick={onJoin}>{t("seat.returnHere")}</button>
        : (
          <>
            <div className="seat-taken">{t("seat.taken")}</div>
            {waiting && isOwner && <button type="button" className="rooms-button text-danger" disabled={busy || !canControl} onClick={onClear}>{t("seat.freeSeat")}</button>}
          </>
        )
      ) : seat.kind === "empty" ? (
        <>
          <button type="button" className="rooms-button secondary seat-action" disabled={busy || !canControl || !waiting} onClick={onJoin}>{t("seat.take")}</button>
          {/* Ботов сажает только создатель лобби. */}
          {waiting && isOwner && (
            <details className="bot-setup">
              <summary>{t("seat.addBot")} <span>⌄</span></summary>
              <BotConfigurator seat={seat} roles={roles} disabled={busy || !canControl} onApply={onBot} />
            </details>
          )}
        </>
      ) : (
        <>
          {/* Настройки бота свёрнуты, как «Добавить бота» у свободного места: карточки стола одной высоты.
            * Менять и убирать уже сидящего бота может только создатель лобби. */}
          {waiting && !isOwner && <div className="seat-taken">{t("seat.botSeat")}</div>}
          {waiting && isOwner && (
            <details className="bot-setup">
              <summary>{t("seat.configureBot")} <span>⌄</span></summary>
              <BotConfigurator seat={seat} roles={roles} disabled={busy || !canControl} onApply={onBot} />
            </details>
          )}
          {waiting && isOwner && <button type="button" className="rooms-button text-danger" disabled={busy || !canControl} onClick={onClear}>{t("seat.removeBot")}</button>}
        </>
      )}
    </article>
  );
}

const SEAT_COLORS = ["#b9a2d4", "#7fc8bd", "#8fb3dd", "#df9a7a"];

// The engine still accepts the retired policies, but they play the old economy, so they are not
// offered. Reborn went the same way: it was written for rules long gone and loses to a newcomer by
// the fifth round. A seat that already holds it keeps playing — the server still knows the id.
// Names come from the locale (`common:difficulty.*`) and carry no vendor prefix: players took a
// «Claude …» seat for a live AI agent rather than a scripted bot.
const BOT_POLICIES: { id: Difficulty; level: "easy" | "normal" | "hard" | "strategy" }[] = [
  { id: "ledger", level: "normal" },
  { id: "oracle", level: "hard" },
  { id: "boris", level: "strategy" },
  { id: "raider", level: "strategy" },
  { id: "builder", level: "strategy" },
];
// Only Reborn reads a favourite role; the other policies pick their seat from the position, so the
// selector would promise them something they ignore.
const USES_PREFERRED_ROLE: ReadonlySet<Difficulty> = new Set<Difficulty>(["expert"]);

function BotConfigurator({ seat, roles, disabled, onApply }: {
  seat: RoomSeat;
  roles: RoleMeta[];
  disabled: boolean;
  onApply: (difficulty: Difficulty, role: string | null) => void;
}) {
  const { t } = useTranslation("home");
  const [role, setRole] = useState(seat.preferred_role ?? "");
  const [policy, setPolicy] = useState<Difficulty>(seat.kind === "bot" && BOT_POLICIES.some(item => item.id === seat.difficulty) ? seat.difficulty : "ledger");
  useEffect(() => { setRole(seat.preferred_role ?? ""); }, [seat.preferred_role]);
  useEffect(() => { if (seat.kind === "bot") setPolicy(seat.difficulty); }, [seat.kind, seat.difficulty]);
  return (
    <div className="bot-controls-v2">
      <label className="room-field">{t("seat.botModel")}
        <select value={policy} onChange={event => setPolicy(event.target.value as Difficulty)}>
          {BOT_POLICIES.map(item => <option value={item.id} key={item.id}>{t(`seat.botLevel.${item.level}`)} · {t(`difficulty.${item.id}`, { ns: "common" })}</option>)}
        </select>
      </label>
      {USES_PREFERRED_ROLE.has(policy) && (
        <label className="room-field">{t("seat.preferredRole")}
          <select value={role} onChange={event => setRole(event.target.value)}>
            <option value="">{t("seat.anyRoleOption")}</option>
            {roles.map(item => <option value={item.id} key={item.id}>{item.icon} {item.title}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="rooms-button subtle" disabled={disabled} onClick={() => onApply(policy, USES_PREFERRED_ROLE.has(policy) ? role || null : null)}>{seat.kind === "bot" ? t("seat.saveBot") : t("seat.placeBot")}</button>
    </div>
  );
}
