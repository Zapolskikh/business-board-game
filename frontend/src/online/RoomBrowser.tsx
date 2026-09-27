import { useEffect, useMemo, useState } from "react";
import { cityApi } from "./api";
import type { RoomStatus, RoomSummary } from "./types";

interface Props { onOpen: (roomId: string, initialPassword?: string) => void }

const statusLabels: Record<RoomStatus, string> = {
  waiting: "Набор игроков",
  playing: "Игра идёт",
  finished: "Партия завершена",
};

function updatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "обновлена недавно";
  return `обновлена ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

export function RoomBrowser({ onOpen }: Props) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [rounds, setRounds] = useState(15);
  const [rolePrice, setRolePrice] = useState(3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoomSummary | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = async (visible = false) => {
    if (visible) setRefreshing(true);
    try { setRooms(await cityApi.rooms()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить комнаты"); }
    finally { if (visible) setRefreshing(false); }
  };
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, []);

  const canCreate = Boolean(name.trim() && password.length >= 4 && !busy);
  const waitingCount = useMemo(() => rooms.filter(room => room.status === "waiting").length, [rooms]);

  const create = async () => {
    if (!canCreate) return;
    setBusy(true); setError("");
    try {
      const room = await cityApi.create({ name: name.trim(), password, capacity, max_rounds: rounds, role_price: rolePrice });
      onOpen(room.id, password);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать комнату"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!deleteTarget || deletePassword.length < 4) return;
    setDeletingId(deleteTarget.id); setError("");
    try {
      await cityApi.remove(deleteTarget.id, deletePassword);
      setRooms(current => current.filter(item => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeletePassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить комнату"); }
    finally { setDeletingId(null); }
  };

  return (
    <main className="rooms-app room-browser" data-ui="room-browser">
      <header className="rooms-topbar">
        <div className="rooms-wordmark">
          <span className="rooms-mark">ГВ</span>
          <span><b>Город влияния</b><small>настольная стратегия</small></span>
        </div>
        <div className="rooms-presence">
          <span className="presence-dot" />
          {rooms.length ? `${rooms.length} ${rooms.length === 1 ? "комната" : "комнаты"} онлайн` : "сервер доступен"}
          <small>v{__GAME_VERSION__}</small>
        </div>
      </header>

      <section className="rooms-hero">
        <div>
          <span className="eyebrow">Стратегия · 2–4 игрока</span>
          <h1>Постройте город.<br /><em>Заберите влияние.</em></h1>
          <p>Выберите открытую комнату или создайте свою партию. Настройки можно закончить уже в лобби вместе с игроками.</p>
        </div>
        <div className="hero-rules" aria-label="Кратко об игре">
          <span><b>15</b><small>раундов по умолчанию</small></span>
          <span><b>3</b><small>действия за ход</small></span>
          <span><b>6</b><small>городских районов</small></span>
        </div>
      </section>

      {error && <p className="rooms-alert" role="alert">⚠ {error}</p>}

      <div className="room-browser-layout">
        <section className="rooms-panel room-directory">
          <div className="rooms-section-head">
            <div>
              <span className="eyebrow">Список партий</span>
              <h2>Активные комнаты</h2>
            </div>
            <div className="directory-actions">
              {waitingCount > 0 && <span className="waiting-count">{waitingCount} ждут игроков</span>}
              <button type="button" className="rooms-button subtle" onClick={() => void reload(true)} disabled={refreshing}>
                {refreshing ? "Обновляем…" : "↻ Обновить"}
              </button>
            </div>
          </div>

          <div className="room-cards">
            {!rooms.length ? (
              <div className="rooms-empty">
                <span>⌂</span>
                <h3>Комнат пока нет</h3>
                <p>Создайте первую партию — она сразу появится в списке.</p>
              </div>
            ) : rooms.map(room => (
              <article className={`room-card status-${room.status}`} data-ui="room-card" key={room.id}>
                <button className="room-card-main" type="button" onClick={() => onOpen(room.id)}>
                  <span className="room-card-title">
                    <span className="room-status"><i />{statusLabels[room.status]}</span>
                    <strong>{room.name}</strong>
                    <small>{updatedLabel(room.updated_at)}</small>
                  </span>
                  <span className="room-occupancy">
                    <span className="seat-dots" aria-label={`${room.players} из ${room.capacity} мест занято`}>
                      {Array.from({ length: room.capacity }).map((_, index) => (
                        <i key={index} className={index < room.humans ? "human" : index < room.players ? "bot" : "empty"} />
                      ))}
                    </span>
                    <b>{room.players}/{room.capacity}</b>
                    <small>{room.humans} {room.humans === 1 ? "человек" : "человека"}</small>
                  </span>
                  <span className="room-enter">Открыть <b>→</b></span>
                </button>
                <button
                  type="button"
                  className="room-remove"
                  onClick={() => { setDeleteTarget(room); setDeletePassword(""); }}
                  title="Удалить комнату"
                  aria-label={`Удалить комнату ${room.name}`}
                >
                  ⋯
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="rooms-panel create-room-card" data-ui="create-room">
          <div className="rooms-section-head">
            <div><span className="eyebrow">Новая партия</span><h2>Создать комнату</h2></div>
            <span className="step-badge">1 минута</span>
          </div>
          <form onSubmit={event => { event.preventDefault(); void create(); }}>
            <label className="room-field">
              <span>Название комнаты</span>
              <input value={name} maxLength={48} placeholder="Например, Вечерняя партия" onChange={event => setName(event.target.value)} />
            </label>
            <label className="room-field">
              <span>Пароль владельца</span>
              <input type="password" value={password} maxLength={128} placeholder="Минимум 4 символа" onChange={event => setPassword(event.target.value)} />
              <small>Он нужен для настройки мест и запуска игры.</small>
            </label>

            <div className="quick-settings">
              <label className="room-field"><span>Игроков</span><select value={capacity} onChange={event => setCapacity(Number(event.target.value))}>{[2,3,4].map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="room-field"><span>Раундов</span><input type="number" min={5} max={30} value={rounds} onChange={event => setRounds(Number(event.target.value))} /></label>
            </div>

            <details className="advanced-settings">
              <summary>Дополнительные настройки <span>⌄</span></summary>
              <label className="room-field"><span>Базовая цена роли</span><input type="number" min={2} max={10} value={rolePrice} onChange={event => setRolePrice(Number(event.target.value))} /><small>Влияние, необходимое для свободной роли.</small></label>
            </details>

            <button className="rooms-button primary create-submit" type="submit" disabled={!canCreate}>
              {busy ? "Создаём комнату…" : "Создать и перейти в лобби →"}
            </button>
            {!name.trim() || password.length < 4 ? <p className="form-hint">Заполните название и пароль от 4 символов.</p> : <p className="form-hint ready">Всё готово к созданию.</p>}
          </form>
        </section>
      </div>

      {deleteTarget && (
        <div className="rooms-dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && setDeleteTarget(null)}>
          <section className="rooms-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-room-title" data-ui="delete-dialog">
            <span className="dialog-icon">!</span>
            <div><span className="eyebrow">Подтверждение</span><h2 id="delete-room-title">Удалить «{deleteTarget.name}»?</h2></div>
            <p>Комната и история партии исчезнут без возможности восстановления.</p>
            <label className="room-field"><span>Пароль комнаты</span><input autoFocus type="password" value={deletePassword} placeholder="Введите пароль" onChange={event => setDeletePassword(event.target.value)} onKeyDown={event => event.key === "Enter" && void remove()} /></label>
            <div className="dialog-actions">
              <button type="button" className="rooms-button subtle" onClick={() => setDeleteTarget(null)}>Отмена</button>
              <button type="button" className="rooms-button danger" disabled={deletePassword.length < 4 || deletingId === deleteTarget.id} onClick={() => void remove()}>{deletingId === deleteTarget.id ? "Удаляем…" : "Удалить комнату"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
