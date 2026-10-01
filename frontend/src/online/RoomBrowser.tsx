import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../i18n/errors";
import { LanguagePicker } from "../i18n/LanguagePicker";
import { ApiError, cityApi } from "./api";
import { newSecret, saveOwnerToken } from "./roomSecrets";
import type { CityMeta, RoomSummary } from "./types";
import { AboutDialog } from "./AboutDialog";
import { SupportLinks } from "./SupportLinks";
import { StudioLogo } from "./StudioMark";

interface Props {
  meta: CityMeta;
  /** `joinAs` — имя, под которым игрок сразу сядет за стол (после создания или «случайной игры»). */
  onOpen: (roomId: string, initialPassword?: string, joinAs?: string) => void;
  onFeedback: () => void;
}

const PLAYER_NAME_KEY = "city-player-name";
// Названия сравниваются так, как их читает человек: без регистра и лишних пробелов — как на сервере.
const nameKey = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

// Серые операции для карточки «Серая сторона» — названия из переводов игры, без модуля правил
// доски: он тяжёлый, а главной нужны только пять подписей.
const GREY_OPERATIONS = ["smear", "crypto", "roof_break", "datacenter", "influence_broker"] as const;

// Книга правил грузится по первому нажатию: со скриншотами и темой доски она тяжелее всей главной.
const RulesBook = lazy(() => import("../ui/RulesBookEntry"));


export function RoomBrowser({ meta, onOpen, onFeedback }: Props) {
  const { t, i18n } = useTranslation(["home", "common", "game"]);
  const [about, setAbout] = useState(false);
  const [rules, setRules] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // На самых узких телефонах полное название языка не помещается рядом с меню — только код.
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 420px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 420px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [showPassword, setShowPassword] = useState(false);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [randomNote, setRandomNote] = useState("");
  const savePlayerName = (value: string) => { setPlayerName(value); localStorage.setItem(PLAYER_NAME_KEY, value); };
  // Имя обязательно в обоих путях в игру — и при создании лобби, и в «случайной игре».
  const playerNameOk = playerName.trim().length > 0;
  const joinName = () => playerName.trim();
  // Правая панель — одна на две вкладки: так главная помещается в экран без прокрутки.
  const [tab, setTab] = useState<"create" | "rooms">("create");
  // «Начать партию»: вкладка создания и сразу курсор в поле названия.
  const startGame = () => {
    setTab("create");
    requestAnimationFrame(() => nameRef.current?.focus());
  };
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
  // Значение для кнопок «−/+»: пустое поле считается значением по умолчанию.
  const roundsValue = roundsInput === "" ? 15 : parsedRounds;
  const nameTaken = Boolean(name.trim()) && rooms.some(room => nameKey(room.name) === nameKey(name));
  const passwordOk = isOpen || password.length >= 4;
  const canCreate = Boolean(playerNameOk && name.trim() && !nameTaken && passwordOk && roundsValid && !busy);
  const waitingCount = useMemo(() => rooms.filter(room => room.status === "waiting").length, [rooms]);

  const create = async () => {
    if (!canCreate) return;
    setBusy(true); setError("");
    try {
      const roomPassword = isOpen ? "" : password;
      // Ключ создателя придумывает браузер: с ним — и только с ним — можно убирать ботов и освобождать места.
      const ownerToken = newSecret();
      const room = await cityApi.create({ name: name.trim(), password: roomPassword, capacity, max_rounds: parsedRounds, role_price: rolePrice, open: isOpen, owner_token: ownerToken });
      saveOwnerToken(room.id, ownerToken);
      onOpen(room.id, roomPassword, joinName());
    } catch (reason) { setError(errorText(reason, "createRoom")); }
    finally { setBusy(false); }
  };

  /* «Случайная игра»: любое открытое лобби, которое ещё ждёт игроков и где есть свободное место.
   * Если таких нет — игрок сам открывает лобби с базовыми настройками и становится его хозяином:
   * следующий, кто нажмёт «Случайная игра», попадёт уже к нему. */
  const joinRandom = async () => {
    if (!playerNameOk) return;
    setBusy(true); setError(""); setRandomNote("");
    try {
      const fresh = await cityApi.rooms();
      setRooms(fresh);
      const candidates = fresh.filter(room => room.open && room.status === "waiting" && room.players < room.capacity);
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        onOpen(pick.id, "", joinName());
        return;
      }
      const room = await createQuickLobby(fresh);
      onOpen(room.id, "", joinName());
    } catch (reason) { setError(errorText(reason, "createRoom")); }
    finally { setBusy(false); }
  };

  /* Название — первое свободное «lobbyN». Два игрока могут нажать одновременно и выбрать одно и то
   * же имя: сервер отклонит второе как занятое, и тогда берётся следующий номер. */
  const createQuickLobby = async (listed: RoomSummary[]) => {
    const taken = new Set(listed.map(room => nameKey(room.name)));
    let number = 1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      while (taken.has(nameKey(`lobby${number}`))) number += 1;
      const ownerToken = newSecret();
      try {
        const room = await cityApi.create({ name: `lobby${number}`, password: "", capacity: 4, max_rounds: 15, role_price: 3, open: true, owner_token: ownerToken });
        saveOwnerToken(room.id, ownerToken);
        return room;
      } catch (reason) {
        if (!(reason instanceof ApiError && reason.status === 409)) throw reason;
        taken.add(nameKey(`lobby${number}`));
      }
    }
    throw new Error("no free lobby name");
  };

  const remove = async () => {
    if (!deleteTarget || (deletePassword.length < 4 && !deleteTarget.open)) return;
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
    <main className="rooms-app room-browser home-screen" data-ui="room-browser">
      {/* Фон всего экрана. Картинка — `--hero-art` в styles.css: слева текст, справа панель,
        * поэтому смысловой центр картинки — между ними и правее. */}
      <div className="hero-art" aria-hidden="true" />
      <header className="rooms-topbar">
        {/* В панели — студия: название игры и так крупно стоит ниже, в титуле. */}
        <div className="rooms-wordmark home-studio"><StudioLogo /></div>
        <div className="rooms-topbar-end">
          <div className="rooms-presence">
            <span className="presence-dot" />
            {rooms.length ? t("presence.rooms", { count: rooms.length }) : t("presence.serverUp")}
            <small>v{__GAME_VERSION__}</small>
          </div>
          <nav className="rooms-topnav" aria-label={t("nav.about")}>
            <button type="button" className="rooms-button subtle" onClick={() => setRules(true)}>{t("nav.rules")}</button>
            <button type="button" className="rooms-button subtle" onClick={() => setAbout(true)}>{t("nav.about")}</button>
            <button type="button" className="rooms-button subtle" onClick={onFeedback}>{t("nav.feedback")}</button>
            <SupportLinks />
            <LanguagePicker className="rooms-language" compact={narrow} />
          </nav>
        </div>
      </header>

      {/* Цена роли — та, что выставлена в форме создания комнаты: книга описывает партию, которую вы создаёте. */}
      {rules && (
        <Suspense fallback={null}>
          <RulesBook open onClose={() => setRules(false)} meta={meta} rolePrice={rolePrice} />
        </Suspense>
      )}
      {about && <AboutDialog onClose={() => setAbout(false)} onFeedback={() => { setAbout(false); onFeedback(); }} />}

      {/* Титульный экран в один экран: слева — что это за игра, справа — создание партии и
        * открытые комнаты, чтобы игрок понял, куда попал, ещё до лобби. */}
      <div className="home-main">
      <section className="rooms-hero" data-ui="home-hero">
        <div className="hero-copy">
          <h1 className="hero-title">{t("brand.title")}</h1>
          <span className="eyebrow">{t("hero.eyebrow")}</span>
          <p className="hero-slogan">{t("hero.titleLine1")}<br /><em>{t("hero.titleLine2")}</em></p>
          <p className="hero-lead">{t("hero.lead")}</p>
          <p className="hero-hook">{t("hero.hook")}</p>
          <div className="hero-actions">
            <button type="button" className="rooms-button primary hero-cta" onClick={startGame}>{t("hero.ctaPlay")}</button>
            <button type="button" className="rooms-button hero-cta ghost" onClick={() => setRules(true)}>{t("hero.ctaRules")}</button>
          </div>
          <ul className="hero-facts">
            <li><b>2–4</b><span>{t("hero.factPlayers")}</span></li>
            <li><b>5–30</b><span>{t("hero.factRounds")}</span></li>
            <li><b>3</b><span>{t("hero.factActions")}</span></li>
            <li><b>{meta.assets.length}</b><span>{t("hero.factAssets")}</span></li>
            <li><b>{meta.projects.length}</b><span>{t("hero.factProjects")}</span></li>
          </ul>
        </div>
      </section>

      <aside className="home-side">
      <div className="home-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "create"} className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>{t("create.eyebrow")}</button>
        <button type="button" role="tab" aria-selected={tab === "rooms"} className={tab === "rooms" ? "active" : ""} onClick={() => setTab("rooms")}>
          {t("rooms.title")}{rooms.length > 0 && <span className="tab-count">{rooms.length}</span>}
        </button>
      </div>
      {error && <p className="rooms-alert" role="alert">⚠ {error}</p>}

        {tab === "rooms" && (
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
                    <strong>{room.name}{room.open && <span className="open-badge">{t("rooms.openBadge")}</span>}</strong>
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

        )}

        {tab === "create" && (
        <section className="rooms-panel create-room-card" data-ui="create-room">
          <header className="create-head">
            <h2>{t("create.heading")}</h2>
            <span className="ornament-rule" aria-hidden="true" />
            <p>{t("create.subheading")}</p>
          </header>
          <form onSubmit={event => { event.preventDefault(); void create(); }}>
            <label className="room-field">
              <span>{t("create.playerName")}</span>
              <input ref={nameRef} value={playerName} maxLength={32} placeholder={t("create.playerNamePlaceholder")} onChange={event => savePlayerName(event.target.value)} />
            </label>
            <label className="room-field">
              <span>{t("create.name")}</span>
              <input value={name} maxLength={48} placeholder={t("create.namePlaceholder")} aria-invalid={nameTaken} onChange={event => setName(event.target.value)} />
              {nameTaken && <small className="field-error">{t("create.nameTaken")}</small>}
            </label>

            <label className="open-toggle">
              <input type="checkbox" checked={isOpen} onChange={event => setIsOpen(event.target.checked)} />
              <span className="switch" aria-hidden="true" />
              <span><b>{t("create.openLobby")}</b><small>{t("create.openLobbyHint")}</small></span>
            </label>

            {!isOpen && (
              <label className="room-field">
                <span>{t("create.password")}</span>
                <span className="input-with-action">
                  <input type={showPassword ? "text" : "password"} value={password} maxLength={128} placeholder={t("create.passwordPlaceholder")} onChange={event => setPassword(event.target.value)} />
                  <button
                    type="button"
                    className="input-action"
                    aria-label={t(showPassword ? "create.hidePassword" : "create.showPassword")}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(value => !value)}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                      {showPassword && <path d="M4 4l16 16" />}
                    </svg>
                  </button>
                </span>
              </label>
            )}

            <div className="quick-settings">
              <div className="room-field">
                <span>{t("create.players")}</span>
                <div className="segmented" role="radiogroup" aria-label={t("create.players")}>
                  {[2, 3, 4].map(value => (
                    <button key={value} type="button" role="radio" aria-checked={capacity === value} className={capacity === value ? "active" : ""} onClick={() => setCapacity(value)}>{value}</button>
                  ))}
                </div>
              </div>
              <div className="room-field">
                <span>{t("create.rounds")}</span>
                <div className="stepper">
                  <button type="button" aria-label={t("create.roundsLess")} disabled={roundsValue <= 5} onClick={() => setRoundsInput(String(Math.max(5, roundsValue - 1)))}>−</button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={roundsInput}
                    aria-label={t("create.rounds")}
                    aria-invalid={roundsInput !== "" && !roundsValid}
                    onChange={event => setRoundsInput(event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))}
                    onBlur={() => {
                      const value = Number(roundsInput);
                      setRoundsInput(String(roundsInput === "" ? 15 : Math.min(30, Math.max(5, value))));
                    }}
                  />
                  <button type="button" aria-label={t("create.roundsMore")} disabled={roundsValue >= 30} onClick={() => setRoundsInput(String(Math.min(30, roundsValue + 1)))}>+</button>
                </div>
              </div>
            </div>

            <details className="advanced-settings">
              <summary>{t("create.advanced")} <span aria-hidden="true">⌄</span></summary>
              <label className="room-field"><span>{t("create.rolePrice")}</span><input type="number" min={2} max={10} value={rolePrice} onChange={event => setRolePrice(Number(event.target.value))} /><small>{t("create.rolePriceHint")}</small></label>
            </details>

            <button className="rooms-button primary create-submit" type="submit" disabled={!canCreate}>
              <span>{busy ? t("create.submitting") : t("create.submit")}</span><span aria-hidden="true">→</span>
            </button>
            <p className={`form-hint ${canCreate ? "" : "missing"}`}>
              {canCreate ? t("create.hintReady") : !playerNameOk ? t("create.hintPlayerName") : !name.trim() ? t("create.hintName") : nameTaken ? t("create.nameTaken") : !passwordOk ? t("create.hintPassword") : t("create.hintReady")}
            </p>

            {/* Внизу панели — второй путь в игру: без своей комнаты, в любое открытое лобби. */}
            <div className="random-join">
              <span className="or-divider" aria-hidden="true"><i>{t("random.or")}</i></span>
              <button type="button" className="rooms-button primary create-submit random-submit" disabled={busy || !playerNameOk} onClick={() => void joinRandom()}>
                <span>{t("random.button")}</span><span aria-hidden="true">→</span>
              </button>
              <p className="form-hint">{randomNote || (playerNameOk ? t("random.hint") : t("create.hintPlayerName"))}</p>
            </div>
          </form>
        </section>
        )}
      </aside>
      <ul className="hero-pillars" aria-label={t("hero.pillarsLabel")}>
        <li>
          <span className="pillar-icon">🏙️</span>
          <b>{t("hero.districtsTitle", { count: meta.districts.length })}</b>
          <span>{t("hero.districtsText")}</span>
          <ul className="pillar-chips">
            {meta.districts.map(district => (
              <li key={district.id} style={{ "--chip": district.color } as CSSProperties}>{district.icon} {district.title}</li>
            ))}
          </ul>
        </li>
        <li>
          <span className="pillar-icon">🎭</span>
          <b>{t("hero.rolesTitle", { count: meta.roles.length })}</b>
          <span>{t("hero.rolesText")}</span>
          <ul className="pillar-chips">
            {meta.roles.map(role => (
              <li key={role.id} style={{ "--chip": role.color } as CSSProperties}>{role.icon} {role.title}</li>
            ))}
          </ul>
        </li>
        <li>
          <span className="pillar-icon">🏛️</span>
          <b>{t("hero.projectsTitle")}</b>
          <span>{t("hero.projectsText")}</span>
          <ul className="pillar-chips plain">
            {[...meta.projects].sort((a, b) => b.points - a.points).slice(0, 4).map(project => (
              <li key={project.id}>★{project.points} {project.title}</li>
            ))}
          </ul>
        </li>
        <li className="pillar-grey">
          <span className="pillar-icon">🌒</span>
          <b>{t("hero.greyTitle")}</b>
          <span>{t("hero.greyText")}</span>
          <ul className="pillar-chips grey">
            {GREY_OPERATIONS.map(id => <li key={id}>{t(`game:grey.${id}.label`)}</li>)}
          </ul>
        </li>
      </ul>
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
              <button type="button" className="rooms-button danger" disabled={(deletePassword.length < 4 && !deleteTarget.open) || deletingId === deleteTarget.id} onClick={() => void remove()}>{deletingId === deleteTarget.id ? t("delete.deleting") : t("delete.confirm")}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
