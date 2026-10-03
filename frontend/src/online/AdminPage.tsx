import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { ApiError, cityApi } from "./api";
import type { AdminRoom, AdminSeat, CityMeta } from "./types";

const GameScreen = lazy(() => import("../ui/GameScreen").then(module => ({ default: module.GameScreen })));

/* Скрытая страница администратора: /admin или ?page=admin.
 *
 * Только для владельца сервера: без ADMIN_TOKEN сервер отвечает 404, как будто страницы нет.
 * Админ видит все комнаты, кто на каком месте (адрес и браузер при входе и последние, с которых
 * ходили) и может смотреть партию глазами любого места — как невидимое пятое место: ничего не
 * нажимает, игроки его не видят. Тексты только на русском: это инструмент, а не часть игры.
 */

const TOKEN_KEY = "city-admin-token";

export const onAdminPage = () =>
  location.pathname.startsWith("/admin") || new URLSearchParams(location.search).get("page") === "admin";

interface Watching { roomId: string; playerId: string }

export function AdminPage({ meta, onExit }: { meta: CityMeta; onExit: () => void }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [draft, setDraft] = useState(token);
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [error, setError] = useState("");
  const [watching, setWatching] = useState<Watching | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setRooms(await cityApi.adminRooms(token));
      setError("");
    } catch (reason) {
      setRooms(null);
      setError(reason instanceof ApiError && reason.status === 404 ? "Неверный токен или админка выключена на сервере." : String(reason));
    }
  }, [token]);

  useEffect(() => {
    if (watching) return;
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load, watching]);

  const signIn = () => { localStorage.setItem(TOKEN_KEY, draft.trim()); setToken(draft.trim()); };
  const signOut = () => { localStorage.removeItem(TOKEN_KEY); setToken(""); setDraft(""); setRooms(null); };

  if (watching) {
    return (
      <Suspense fallback={<div className="rooms-app app-state"><span className="loading-ring" /><p>Загружаем стол…</p></div>}>
        <GameScreen roomId={watching.roomId} password="" playerId={watching.playerId} meta={meta} adminToken={token} onExit={() => setWatching(null)} />
      </Suspense>
    );
  }

  return (
    <main className="rooms-app admin-page">
      <section className="rooms-panel admin-panel">
        <div className="admin-head">
          <div>
            <span className="eyebrow">Администратор</span>
            <h1>Комнаты и игроки</h1>
          </div>
          <div className="admin-actions">
            {token && <button className="rooms-button subtle" onClick={() => void load()}>Обновить</button>}
            {token && <button className="rooms-button subtle" onClick={signOut}>Выйти</button>}
            <button className="rooms-button subtle" onClick={onExit}>На главную</button>
          </div>
        </div>

        {!token && (
          <form className="admin-login" onSubmit={event => { event.preventDefault(); signIn(); }}>
            <label className="room-field">
              <span>Токен администратора (ADMIN_TOKEN на сервере)</span>
              <input type="password" value={draft} onChange={event => setDraft(event.target.value)} autoComplete="off" />
            </label>
            <button className="rooms-button primary" type="submit" disabled={!draft.trim()}>Войти</button>
          </form>
        )}

        {error && <p className="rooms-alert">{error}</p>}
        {token && rooms && rooms.length === 0 && <p className="rooms-empty">Активных комнат нет.</p>}
        {rooms?.map(room => <RoomCard key={room.id} room={room} onWatch={playerId => setWatching({ roomId: room.id, playerId })} />)}
      </section>
    </main>
  );
}

const STATUS = { waiting: "лобби", playing: "идёт партия", finished: "закончена" } as const;

function RoomCard({ room, onWatch }: { room: AdminRoom; onWatch: (playerId: string) => void }) {
  const shared = new Set(Object.keys(room.shared_ips));
  const started = room.status !== "waiting";
  return (
    <article className="admin-room">
      <header>
        <strong>{room.name}</strong>
        <span>{STATUS[room.status]}{room.round ? ` · раунд ${room.round}/${room.max_rounds}` : ""}</span>
        <span>{room.open ? "открытая" : "с паролем"} · {room.humans} чел. из {room.capacity}</span>
        <span>обновлена {time(room.updated_at)}</span>
      </header>
      {Object.entries(room.shared_ips).map(([ip, names]) => (
        <p key={ip} className="admin-warning">Один адрес {ip}: {names.join(", ")}</p>
      ))}
      <div className="admin-table">
        <table>
          <thead>
            <tr><th>#</th><th>Место</th><th>Счёт</th><th>IP при входе</th><th>Последний IP</th><th>Браузер</th><th>Сел</th><th>Ходил</th><th /></tr>
          </thead>
          <tbody>
            {room.seats.map(seat => (
              <SeatRow key={seat.index} seat={seat} shared={shared} canWatch={started} onWatch={onWatch} />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function SeatRow({ seat, shared, canWatch, onWatch }: { seat: AdminSeat; shared: Set<string>; canWatch: boolean; onWatch: (playerId: string) => void }) {
  const client = seat.client;
  const who = seat.kind === "empty" ? "свободно" : seat.kind === "bot" ? `${seat.name} · бот ${seat.difficulty}` : seat.name;
  const flagged = (ip: string | undefined) => (ip && shared.has(ip) ? "admin-shared" : undefined);
  return (
    <tr>
      <td>{seat.index + 1}</td>
      <td>{who}</td>
      <td>{seat.score ?? "—"}</td>
      <td className={flagged(client?.ip)}>{client?.ip || "—"}</td>
      <td className={flagged(client?.last_ip)} title={client?.ips.join(", ")}>{client?.last_ip || "—"}</td>
      <td title={client?.last_user_agent || client?.user_agent}>{browser(client?.last_user_agent || client?.user_agent)}</td>
      <td>{client ? time(client.joined_at) : "—"}</td>
      <td>{client ? time(client.last_seen_at) : "—"}</td>
      <td>{canWatch && seat.player_id && <button className="rooms-button subtle" onClick={() => onWatch(seat.player_id!)}>Смотреть</button>}</td>
    </tr>
  );
}

function time(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Коротко: браузер и система из User-Agent. Полная строка — во всплывающей подсказке. */
function browser(agent: string | undefined): string {
  if (!agent) return "—";
  const name = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /Firefox\//.test(agent) ? "Firefox"
    : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : agent.slice(0, 24);
  const system = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows"
    : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${name} · ${system}` : name;
}
