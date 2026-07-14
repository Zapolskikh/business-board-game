import { useEffect, useState } from "react";
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
      const next = await cityApi.join(roomId, { password, seat_index: index, player_name: playerName });
      setRoom(next);
      const playerId = next.seats[index].player_id;
      if (playerId) onJoined(password, playerId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Вход не выполнен"); }
    finally { setBusy(false); }
  };
  const bot = (index: number, difficulty: Difficulty, preferred_role: string | null) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "bot", difficulty, preferred_role }));
  const clear = (index: number) => act(() => cityApi.seat(roomId, { password, seat_index: index, kind: "empty" }));

  if (!room) return <main className="online-shell"><button onClick={onBack}>← Комнаты</button><p>{error || "Загрузка…"}</p></main>;
  return <main className="online-shell">
    <header className="brand"><div><button onClick={onBack}>← Комнаты</button><h1>{room.name}</h1><p>{room.status === "waiting" ? "Настройте места и запустите игру" : "Выберите своё человеческое место"}</p></div></header>
    <section className="panel lobby-auth"><label>Пароль комнаты<input type="password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Имя нового игрока<input value={playerName} maxLength={32} onChange={event => setPlayerName(event.target.value)} /></label></section>
    {error && <p className="error">{error}</p>}
    <section className="seat-grid">{room.seats.map(seat => <article className={`panel seat ${seat.kind}`} key={seat.index}>
      <h3>Место {seat.index + 1}</h3>
      <strong>{seat.kind === "empty" ? "Свободно" : seat.name}</strong>
      {seat.kind === "bot" && <small>{seat.difficulty} · {seat.preferred_role ? `цель: ${meta.roles.find(role => role.id === seat.preferred_role)?.title}` : "любая роль"}</small>}
      {(seat.kind === "empty" || seat.kind === "human") && <button className="primary" disabled={busy || !password || (seat.kind === "empty" && room.status !== "waiting")} onClick={() => join(seat.index)}>{seat.kind === "human" ? "Сесть на это место" : "Занять"}</button>}
      {room.status === "waiting" && seat.kind !== "human" && <BotConfigurator seat={seat} roles={meta.roles} disabled={busy || !password} onApply={(difficulty, role) => bot(seat.index, difficulty, role)} />}
      {room.status === "waiting" && seat.kind !== "empty" && <button className="danger" disabled={busy} onClick={() => clear(seat.index)}>Освободить</button>}
    </article>)}</section>
    {room.status === "waiting" && <button className="start-game primary" disabled={busy || !password || room.players < 2 || room.humans < 1} onClick={() => act(() => cityApi.start(roomId, password))}>Начать игру</button>}
  </main>;
}

function BotConfigurator({ seat, roles, disabled, onApply }: {
  seat: RoomSeat;
  roles: RoleMeta[];
  disabled: boolean;
  onApply: (difficulty: Difficulty, role: string | null) => void;
}) {
  const [difficulty, setDifficulty] = useState<Difficulty>(seat.difficulty ?? "medium");
  const [role, setRole] = useState(seat.preferred_role ?? "");
  useEffect(() => {
    setDifficulty(seat.difficulty ?? "medium");
    setRole(seat.preferred_role ?? "");
  }, [seat.difficulty, seat.preferred_role]);
  return <div className="bot-controls">
    <label>Модель
      <select value={difficulty} onChange={event => setDifficulty(event.target.value as Difficulty)}>
        <option value="easy">Олег · easy</option>
        <option value="medium">Codex · medium</option>
        <option value="hard">Claude · hard</option>
      </select>
    </label>
    <label>Роль
      <select value={role} onChange={event => setRole(event.target.value)}>
        <option value="">Любая</option>
        {roles.map(item => <option value={item.id} key={item.id}>{item.icon} {item.title}</option>)}
      </select>
    </label>
    <button disabled={disabled} onClick={() => onApply(difficulty, role || null)}>{seat.kind === "bot" ? "Применить" : "Посадить бота"}</button>
  </div>;
}
