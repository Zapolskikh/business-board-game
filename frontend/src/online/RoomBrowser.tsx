import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../i18n/errors";
import { LanguagePicker } from "../i18n/LanguagePicker";
import { cityApi } from "./api";
import type { RoomSummary } from "./types";
import { AboutDialog } from "./AboutDialog";
import { SupportLinks } from "./SupportLinks";
import { StudioLogo } from "./StudioMark";

interface Props { onOpen: (roomId: string, initialPassword?: string) => void; onFeedback: () => void }


export function RoomBrowser({ onOpen, onFeedback }: Props) {
  const { t, i18n } = useTranslation(["home", "common"]);
  const [about, setAbout] = useState(false);
  const updatedLabel = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("rooms.updatedRecently");
    return t("rooms.updated", { time: date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) });
  };
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
    catch (reason) { setError(errorText(reason, "loadRooms")); }
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
    } catch (reason) { setError(errorText(reason, "createRoom")); }
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
    } catch (reason) { setError(errorText(reason, "deleteRoom")); }
    finally { setDeletingId(null); }
  };

  return (
    <main className="rooms-app room-browser" data-ui="room-browser">
      <header className="rooms-topbar">
        <div className="rooms-wordmark">
          <span className="rooms-mark">{t("brand.mark")}</span>
          <span><b>{t("brand.title")}</b><small>{t("brand.tagline")}</small></span>
        </div>
        <div className="rooms-topbar-end">
          <div className="rooms-presence">
            <span className="presence-dot" />
            {rooms.length ? t("presence.rooms", { count: rooms.length }) : t("presence.serverUp")}
            <small>v{__GAME_VERSION__}</small>
          </div>
          <nav className="rooms-topnav" aria-label={t("nav.about")}>
            <button type="button" className="rooms-button subtle" onClick={() => setAbout(true)}>{t("nav.about")}</button>
            <button type="button" className="rooms-button subtle" onClick={onFeedback}>{t("nav.feedback")}</button>
            <SupportLinks />
            <LanguagePicker className="rooms-language" />
          </nav>
        </div>
      </header>

      {about && <AboutDialog onClose={() => setAbout(false)} onFeedback={() => { setAbout(false); onFeedback(); }} />}

      <section className="rooms-hero">
        <div>
          {/* Как титр перед названием: студия видна сразу, без прокрутки до подвала. */}
          <span className="hero-studio">
            <StudioLogo />
            <span>{t("common:studio.presents")}</span>
          </span>
          <span className="eyebrow">{t("hero.eyebrow")}</span>
          <h1>{t("hero.titleLine1")}<br /><em>{t("hero.titleLine2")}</em></h1>
          <p>{t("hero.lead")}</p>
        </div>
        <div className="hero-rules">
          <span><b>15</b><small>{t("hero.rounds")}</small></span>
          <span><b>3</b><small>{t("hero.actions")}</small></span>
          <span><b>6</b><small>{t("hero.districts")}</small></span>
        </div>
      </section>

      {error && <p className="rooms-alert" role="alert">⚠ {error}</p>}

      <div className="room-browser-layout">
        <section className="rooms-panel room-directory">
          <div className="rooms-section-head">
            <div>
              <span className="eyebrow">{t("rooms.eyebrow")}</span>
              <h2>{t("rooms.title")}</h2>
            </div>
            <div className="directory-actions">
              {waitingCount > 0 && <span className="waiting-count">{t("rooms.waiting", { count: waitingCount })}</span>}
              <button type="button" className="rooms-button subtle" onClick={() => void reload(true)} disabled={refreshing}>
                {refreshing ? t("rooms.refreshing") : t("rooms.refresh")}
              </button>
            </div>
          </div>

          <div className="room-cards">
            {!rooms.length ? (
              <div className="rooms-empty">
                <span>⌂</span>
                <h3>{t("rooms.emptyTitle")}</h3>
                <p>{t("rooms.emptyText")}</p>
              </div>
            ) : rooms.map(room => (
              <article className={`room-card status-${room.status}`} data-ui="room-card" key={room.id}>
                <button className="room-card-main" type="button" onClick={() => onOpen(room.id)}>
                  <span className="room-card-title">
                    <span className="room-status"><i />{t(`rooms.status.${room.status}`)}</span>
                    <strong>{room.name}</strong>
                    <small>{updatedLabel(room.updated_at)}</small>
                  </span>
                  <span className="room-occupancy">
                    <span className="seat-dots" aria-label={t("rooms.seatsLabel", { players: room.players, capacity: room.capacity })}>
                      {Array.from({ length: room.capacity }).map((_, index) => (
                        <i key={index} className={index < room.humans ? "human" : index < room.players ? "bot" : "empty"} />
                      ))}
                    </span>
                    <b>{room.players}/{room.capacity}</b>
                    <small>{t("rooms.humans", { count: room.humans })}</small>
                  </span>
                  <span className="room-enter">{t("rooms.open")} <b>→</b></span>
                </button>
                <button
                  type="button"
                  className="room-remove"
                  onClick={() => { setDeleteTarget(room); setDeletePassword(""); }}
                  title={t("rooms.remove")}
                  aria-label={t("rooms.removeNamed", { name: room.name })}
                >
                  ⋯
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="rooms-panel create-room-card" data-ui="create-room">
          <div className="rooms-section-head">
            <div><span className="eyebrow">{t("create.eyebrow")}</span><h2>{t("create.title")}</h2></div>
            <span className="step-badge">{t("create.badge")}</span>
          </div>
          <form onSubmit={event => { event.preventDefault(); void create(); }}>
            <label className="room-field">
              <span>{t("create.name")}</span>
              <input value={name} maxLength={48} placeholder={t("create.namePlaceholder")} onChange={event => setName(event.target.value)} />
            </label>
            <label className="room-field">
              <span>{t("create.password")}</span>
              <input type="password" value={password} maxLength={128} placeholder={t("create.passwordPlaceholder")} onChange={event => setPassword(event.target.value)} />
              <small>{t("create.passwordHint")}</small>
            </label>

            <div className="quick-settings">
              <label className="room-field"><span>{t("create.players")}</span><select value={capacity} onChange={event => setCapacity(Number(event.target.value))}>{[2,3,4].map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="room-field"><span>{t("create.rounds")}</span><input type="number" min={5} max={30} value={rounds} onChange={event => setRounds(Number(event.target.value))} /></label>
            </div>

            <details className="advanced-settings">
              <summary>{t("create.advanced")} <span>⌄</span></summary>
              <label className="room-field"><span>{t("create.rolePrice")}</span><input type="number" min={2} max={10} value={rolePrice} onChange={event => setRolePrice(Number(event.target.value))} /><small>{t("create.rolePriceHint")}</small></label>
            </details>

            <button className="rooms-button primary create-submit" type="submit" disabled={!canCreate}>
              {busy ? t("create.submitting") : t("create.submit")}
            </button>
            {!name.trim() || password.length < 4 ? <p className="form-hint">{t("create.hintMissing")}</p> : <p className="form-hint ready">{t("create.hintReady")}</p>}
          </form>
        </section>
      </div>

      {deleteTarget && (
        <div className="rooms-dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && setDeleteTarget(null)}>
          <section className="rooms-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-room-title" data-ui="delete-dialog">
            <span className="dialog-icon">!</span>
            <div><span className="eyebrow">{t("delete.eyebrow")}</span><h2 id="delete-room-title">{t("delete.title", { name: deleteTarget.name })}</h2></div>
            <p>{t("delete.text")}</p>
            <label className="room-field"><span>{t("delete.password")}</span><input autoFocus type="password" value={deletePassword} placeholder={t("delete.passwordPlaceholder")} onChange={event => setDeletePassword(event.target.value)} onKeyDown={event => event.key === "Enter" && void remove()} /></label>
            <div className="dialog-actions">
              <button type="button" className="rooms-button subtle" onClick={() => setDeleteTarget(null)}>{t("delete.cancel")}</button>
              <button type="button" className="rooms-button danger" disabled={deletePassword.length < 4 || deletingId === deleteTarget.id} onClick={() => void remove()}>{deletingId === deleteTarget.id ? t("delete.deleting") : t("delete.confirm")}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
