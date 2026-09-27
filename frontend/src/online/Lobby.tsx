import { useEffect, useState } from "react";
import { cityApi } from "./api";
import { difficultyLabels } from "./gameUi";
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
  const [room, setRoom] = useState<RoomView | null>(null);
  const [password, setPassword] = useState(initialPassword);
  const [playerName, setPlayerName] = useState("Игрок");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try { setRoom(await cityApi.room(roomId)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Комната недоступна"); }
  };
  useEffect(() => { void reload(); const timer = setInterval(reload, 5_000); return () => clearInterval(timer); }, [roomId]);
  useEffect(() => { if (room?.status !== "waiting" && playerId) onPlay(); }, [room?.status, playerId, onPlay]);

  const act = async (operation: () => Promise<RoomView>) => {
    setBusy(true); setError("");
    try { setRoom(await operation()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  };
  const join = async (index: number) => {
    setBusy(true); setError("");
    try {
      const next = await cityApi.join(roomId, { password, seat_index: index, player_name: playerName.trim() || "Игрок" });
      setRoom(next);
      const joinedId = next.seats[index].player_id;
      if (joinedId) onJoined(password, joinedId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Вход не выполнен"); }
    finally { setBusy(false); }
  };
  const bot = (index: number, difficulty: Difficulty, preferred_role: string | null) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "bot", difficulty, preferred_role }));
  const clear = (index: number) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "empty" }));

  if (!room) return (
    <main className="rooms-app lobby-page lobby-loading">
      <button type="button" className="rooms-button subtle" onClick={onBack}>← Все комнаты</button>
      <div className="rooms-empty"><span className="loading-ring" /> <h2>{error || "Загружаем комнату…"}</h2></div>
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
        <button type="button" className="rooms-button back-button" onClick={onBack}>← Комнаты</button>
        <div className="lobby-title">
          <span className={`lobby-status status-${room.status}`}><i />{waiting ? "Лобби открыто" : room.status === "playing" ? "Игра идёт" : "Партия завершена"}</span>
          <h1>{room.name}</h1>
        </div>
        <div className="room-code"><span>Код комнаты</span><b>{room.id.slice(0, 8)}</b></div>
      </header>

      {error && <p className="rooms-alert" role="alert">⚠ {error}</p>}

      <section className="lobby-intro">
        <div><span className="eyebrow">Подготовка партии</span><h2>{waiting ? "Выберите место и соберите стол" : "Вернитесь на своё место"}</h2></div>
        <p>{waiting ? "Людей и ботов можно комбинировать. Для старта нужны хотя бы два игрока и один человек." : "Игра уже запущена. Введите пароль и выберите своё человеческое место."}</p>
      </section>

      <div className="lobby-layout">
        <section className="rooms-panel seats-panel">
          <div className="rooms-section-head">
            <div><span className="eyebrow">Игровой стол</span><h2>Места игроков</h2></div>
            <span className="seat-total"><b>{room.players}</b> / {room.capacity} занято</span>
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
            <div className="rooms-section-head"><div><span className="eyebrow">Ваши данные</span><h2>Вход в комнату</h2></div><span className={canControl ? "access-state ready" : "access-state"}>{canControl ? "готово" : "нужен пароль"}</span></div>
            <label className="room-field"><span>Имя игрока</span><input value={playerName} maxLength={32} placeholder="Как вас показать за столом" onChange={event => setPlayerName(event.target.value)} /></label>
            <label className="room-field"><span>Пароль комнаты</span><input type="password" value={password} placeholder="Для входа и настройки" onChange={event => setPassword(event.target.value)} /></label>
            <p className="access-note">Выберите свободное место слева. Если вы возвращаетесь в игру, нажмите на своё прежнее место.</p>
          </section>

          <section className="rooms-panel launch-card">
            <span className="eyebrow">Готовность</span>
            <h2>{waiting ? "Можно начинать?" : "Партия уже началась"}</h2>
            <ul className="launch-checks">
              <li className={canControl ? "met" : ""}><i>{canControl ? "✓" : "·"}</i><span>Пароль комнаты введён</span></li>
              <li className={enoughPlayers ? "met" : ""}><i>{enoughPlayers ? "✓" : "·"}</i><span>Не меньше двух игроков</span><b>{room.players}/2</b></li>
              <li className={hasHuman ? "met" : ""}><i>{hasHuman ? "✓" : "·"}</i><span>Есть человек за столом</span><b>{room.humans}</b></li>
            </ul>
            {waiting ? (
              <button className="rooms-button primary launch-button" disabled={!canStart} onClick={() => void act(() => cityApi.start(roomId, password))}>
                {busy ? "Подождите…" : "Начать игру →"}
              </button>
            ) : playerId ? (
              <button className="rooms-button primary launch-button" onClick={onPlay}>Вернуться в игру →</button>
            ) : (
              <p className="launch-hint">Сначала выберите своё человеческое место.</p>
            )}
            {waiting && !canStart && <p className="launch-hint">Выполните условия выше — кнопка станет активной.</p>}
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
  const mine = Boolean(currentPlayerId && seat.player_id === currentPlayerId);
  const preferredRole = roles.find(role => role.id === seat.preferred_role);
  return (
    <article className={`seat-card-v2 seat-${seat.kind} ${mine ? "seat-mine" : ""}`} data-ui="seat-card">
      <header>
        <span className="seat-number">{seat.index + 1}</span>
        <span className="seat-kind">{seat.kind === "empty" ? "свободно" : seat.kind === "bot" ? "бот" : mine ? "ваше место" : "игрок"}</span>
      </header>

      <div className="seat-identity">
        <span className="seat-avatar">{seat.kind === "bot" ? "◆" : seat.kind === "human" ? "●" : "+"}</span>
        <span>
          <strong>{seat.kind === "empty" ? "Свободное место" : seat.name}</strong>
          <small>{seat.kind === "bot" ? `${difficultyLabels[seat.difficulty] ?? seat.difficulty} · ${preferredRole ? preferredRole.title : "любая роль"}` : seat.kind === "human" ? (mine ? "Вы уже за столом" : "Человеческий игрок") : "Можно занять самому или добавить бота"}</small>
        </span>
      </div>

      {seat.kind === "human" ? (
        mine ? <div className="seat-confirmed">✓ Место закреплено за вами</div> : <button type="button" className="rooms-button secondary seat-action" disabled={busy || !canControl} onClick={onJoin}>{waiting ? "Сесть на это место" : "Вернуться на место"}</button>
      ) : seat.kind === "empty" ? (
        <>
          <button type="button" className="rooms-button secondary seat-action" disabled={busy || !canControl || !waiting} onClick={onJoin}>Занять место</button>
          {waiting && (
            <details className="bot-setup">
              <summary>Добавить бота <span>⌄</span></summary>
              <BotConfigurator seat={seat} roles={roles} disabled={busy || !canControl} onApply={onBot} />
            </details>
          )}
        </>
      ) : (
        <>
          {waiting && <BotConfigurator seat={seat} roles={roles} disabled={busy || !canControl} onApply={onBot} />}
          {waiting && <button type="button" className="rooms-button text-danger" disabled={busy || !canControl} onClick={onClear}>Убрать бота</button>}
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
  const [role, setRole] = useState(seat.preferred_role ?? "");
  useEffect(() => { setRole(seat.preferred_role ?? ""); }, [seat.preferred_role]);
  return (
    <div className="bot-controls-v2">
      <div className="bot-model-v2"><span>Модель бота</span><b>Claude Reborn</b></div>
      <label className="room-field">Предпочитаемая роль
        <select value={role} onChange={event => setRole(event.target.value)}>
          <option value="">Любая роль</option>
          {roles.map(item => <option value={item.id} key={item.id}>{item.icon} {item.title}</option>)}
        </select>
      </label>
      <button type="button" className="rooms-button subtle" disabled={disabled} onClick={() => onApply("expert", role || null)}>{seat.kind === "bot" ? "Сохранить настройки" : "Посадить бота"}</button>
    </div>
  );
}
