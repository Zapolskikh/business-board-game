import { useEffect, useState } from "react";
import { cityApi } from "./api";
import type { RoomSummary } from "./types";

interface Props { onOpen: (roomId: string, initialPassword?: string) => void }

export function RoomBrowser({ onOpen }: Props) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [rounds, setRounds] = useState(15);
  const [rolePrice, setRolePrice] = useState(3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = async () => {
    try { setRooms(await cityApi.rooms()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить комнаты"); }
  };
  useEffect(() => { void reload(); const timer = window.setInterval(reload, 15_000); return () => clearInterval(timer); }, []);

  const create = async () => {
    if (!name.trim() || password.length < 4) return;
    setBusy(true); setError("");
    try {
      const room = await cityApi.create({ name, password, capacity, max_rounds: rounds, role_price: rolePrice });
      onOpen(room.id, password);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать комнату"); }
    finally { setBusy(false); }
  };

  const remove = async (room: RoomSummary) => {
    const roomPassword = window.prompt(`Введите пароль комнаты «${room.name}», чтобы удалить её:`);
    if (roomPassword === null) return;
    if (roomPassword.length < 4) { setError("Для удаления нужен пароль комнаты"); return; }
    setDeletingId(room.id); setError("");
    try {
      await cityApi.remove(room.id, roomPassword);
      setRooms(current => current.filter(item => item.id !== room.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить комнату"); }
    finally { setDeletingId(null); }
  };

  return <main className="online-shell">
    <header className="brand"><div><h1>Город влияния</h1><p>Пошаговая стратегия для браузера</p></div><span>v{__GAME_VERSION__}</span></header>
    <section className="create-room panel">
      <h2>Создать комнату</h2>
      <div className="form-grid">
        <label>Название<input value={name} maxLength={48} onChange={event => setName(event.target.value)} /></label>
        <label>Пароль<input type="password" value={password} maxLength={128} onChange={event => setPassword(event.target.value)} /></label>
        <label>Мест<select value={capacity} onChange={event => setCapacity(Number(event.target.value))}>{[2,3,4,5,6].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Раундов<input type="number" min={5} max={30} value={rounds} onChange={event => setRounds(Number(event.target.value))} /></label>
        <label>Цена роли<input type="number" min={2} max={10} value={rolePrice} onChange={event => setRolePrice(Number(event.target.value))} /></label>
        <button className="primary" disabled={busy || !name.trim() || password.length < 4} onClick={create}>Создать</button>
      </div>
    </section>
    <section className="panel room-list">
      <div className="section-title"><h2>Активные комнаты</h2><button onClick={reload}>Обновить</button></div>
      {error && <p className="error">{error}</p>}
      {!rooms.length ? <p className="muted">Пока нет активных комнат.</p> : rooms.map(room =>
        <article className="room-row" key={room.id}>
          <button className="room-open" onClick={() => onOpen(room.id)}>
            <span><strong>{room.name}</strong><small>{room.status === "waiting" ? "Лобби" : "Игра идёт"}</small></span>
            <span>{room.players}/{room.capacity} · людей {room.humans}</span>
          </button>
          <button className="room-delete danger" disabled={deletingId === room.id} onClick={() => void remove(room)} title="Удалить комнату по паролю" aria-label={`Удалить комнату ${room.name}`}>{deletingId === room.id ? "…" : "🗑"}</button>
        </article>)}
    </section>
  </main>;
}
