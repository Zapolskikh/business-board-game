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
  const [roundsInput, setRoundsInput] = useState("15");
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

  const parsedRounds = Number(roundsInput);
  const roundsValid = /^\d+$/.test(roundsInput) && parsedRounds >= 5 && parsedRounds <= 30;
  const canCreate = Boolean(name.trim() && password.length >= 4 && roundsValid && !busy);
  const waitingCount = useMemo(() => rooms.filter(room => room.status === "waiting").length, [rooms]);

  const create = async () => {
    if (!canCreate) return;
    setBusy(true); setError("");
    try {
      const room = await cityApi.create({ name: name.trim(), password, capacity, max_rounds: parsedRounds, role_price: rolePrice });
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
          <ol className="hero-steps">
            <li><b>01</b><span>{t("hero.stepBuild")}</span></li>
            <li><b>02</b><span>{t("hero.stepCompete")}</span></li>
            <li><b>03</b><span>{t("hero.stepScore")}</span></li>
          </ol>
        </div>
        <div className="hero-table-wrap" role="img" aria-label={t("hero.artworkAlt")}>
          <div className="hero-table-glow" />
          <svg className="hero-table" viewBox="0 0 520 340" aria-hidden="true">
            <defs>
              <linearGradient id="table-surface" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#18221f" />
                <stop offset="1" stopColor="#0a1110" />
              </linearGradient>
              <radialGradient id="table-light"><stop stopColor="#d9bd78" stopOpacity=".22" /><stop offset="1" stopColor="#d9bd78" stopOpacity="0" /></radialGradient>
              <filter id="table-shadow" x="-30%" y="-30%" width="160%" height="180%"><feGaussianBlur stdDeviation="8" /></filter>
            </defs>
            <ellipse cx="260" cy="286" rx="200" ry="30" fill="#000" opacity=".7" filter="url(#table-shadow)" />
            <g className="table-board">
              <path d="M260 24 476 145 260 266 44 145Z" fill="url(#table-surface)" stroke="#56624f" strokeWidth="1.5" />
              <path d="M260 48 434 145 260 242 86 145Z" fill="none" stroke="#657260" strokeOpacity=".35" />
              <path d="m260 24 0 242M44 145h432M152 84l216 122M368 84 152 206" stroke="#7d846d" strokeOpacity=".22" />
              <path d="M260 35 458 145 260 255 62 145Z" fill="url(#table-light)" />
              <g className="table-buildings" stroke="#d9bd78" strokeOpacity=".8" strokeWidth="1.2">
                <path d="m117 126 34-19 24 14-34 20z" fill="#79694a"/><path d="m141 141 34-20v19l-34 20z" fill="#4a4435"/><path d="m117 126 24 15v19l-24-14z" fill="#60563e"/>
                <path d="m187 91 29-17 24 14-29 17z" fill="#9a8053"/><path d="m211 105 29-17v24l-29 17z" fill="#544831"/><path d="m187 91 24 14v24l-24-14z" fill="#6b593b"/>
                <path d="m283 119 36-21 27 15-36 21z" fill="#718c79" stroke="#a9c5a5"/><path d="m310 134 36-21v24l-36 21z" fill="#3d5748" stroke="#a9c5a5"/><path d="m283 119 27 15v24l-27-15z" fill="#536c59" stroke="#a9c5a5"/>
                <path d="m357 158 27-16 23 13-27 16z" fill="#74648b" stroke="#b9a2d4"/><path d="m380 171 27-16v20l-27 16z" fill="#493e5b" stroke="#b9a2d4"/><path d="m357 158 23 13v20l-23-13z" fill="#5b4e70" stroke="#b9a2d4"/>
              </g>
              <g className="table-streets" fill="none" stroke="#d9bd78" strokeWidth="2" strokeDasharray="3 7" opacity=".72">
                <path d="m93 170 58 32 41-23 54 31 50-28 41 24 87-49" />
              </g>
              <g className="table-tokens">
                <circle cx="129" cy="177" r="9" fill="#91c5a5"/><circle cx="129" cy="174" r="3" fill="#e6f2e8"/>
                <circle cx="252" cy="225" r="9" fill="#9fc4d1"/><circle cx="252" cy="222" r="3" fill="#e7f4f6"/>
                <circle cx="391" cy="128" r="9" fill="#b9a2d4"/><circle cx="391" cy="125" r="3" fill="#f0eafa"/>
              </g>
              <g className="table-project">
                <path d="m239 119 21-12 22 12-22 13z" fill="#d9bd78"/><path d="m260 132 22-13v22l-22 13z" fill="#806b3d"/><path d="m239 119 21 13v22l-21-13z" fill="#a58b50"/>
                <path d="m251 116 9-5 9 5-9 5z" fill="#fff0be" opacity=".9" />
              </g>
            </g>
            <g className="table-orbit" fill="none" stroke="#d9bd78" strokeOpacity=".28" strokeDasharray="2 7">
              <ellipse cx="260" cy="145" rx="239" ry="136" />
            </g>
          </svg>
          <div className="table-callout callout-top"><span className="callout-dot" />{t("hero.artLabel")}</div>
          <div className="table-callout callout-bottom"><b>15</b><span>{t("hero.rounds")}</span><i /> <b>3</b><span>{t("hero.actions")}</span></div>
          <span className="table-caption">{t("hero.districts")}</span>
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
              <label className="room-field">
                <span>{t("create.rounds")}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={roundsInput}
                  aria-invalid={roundsInput !== "" && !roundsValid}
                  aria-describedby="rounds-hint"
                  onChange={event => setRoundsInput(event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))}
                  onBlur={() => {
                    const value = Number(roundsInput);
                    setRoundsInput(String(roundsInput === "" ? 15 : Math.min(30, Math.max(5, value))));
                  }}
                />
                <small id="rounds-hint">{t("create.roundsHint")}</small>
              </label>
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
