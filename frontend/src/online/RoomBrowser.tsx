import { Suspense, lazy, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../i18n/errors";
import { LanguagePicker } from "../i18n/LanguagePicker";
import { ApiError, cityApi } from "./api";
import { newSecret, saveOwnerToken } from "./roomSecrets";
import type { CityMeta, RoomSummary } from "./types";
import { AboutDialog } from "./AboutDialog";
import { StudioLogo } from "./StudioMark";
import { ResourceText } from "../ui/primitives/ResourceIcon";
import { isPhoneScreen } from "../ui/lib/layout";
import { CodeEntry } from "./home/CodeEntry";
import { CreateRoomForm, EMPTY_DRAFT, nameKey, type CreateDraft } from "./home/CreateRoomForm";
import { EnterDialog } from "./home/EnterDialog";
import { RoomList } from "./home/RoomList";
import { roomAction } from "./home/rooms";
import "./home/home.css";

interface Props {
  meta: CityMeta;
  /** `joinAs` — имя, под которым игрок сразу сядет за стол (после создания или входа в комнату). */
  onOpen: (roomId: string, initialPassword?: string, joinAs?: string) => void;
  onFeedback: () => void;
  /** Обучение с проводником. */
  onTutorial: () => void;
}

const PLAYER_NAME_KEY = "city-player-name";
/** С какой ширины главная — две колонки (о игре и панель). Уже — компактные экраны, как на телефоне. */
const WIDE_QUERY = "(min-width: 981px)";
/** Раунды по умолчанию — те же, что предлагает форма создания. */
const DEFAULT_ROUNDS = 15;

// Серые операции для карточки «Серая сторона» — названия из переводов игры, без модуля правил
// доски: он тяжёлый, а главной нужны только пять подписей.
const GREY_OPERATIONS = ["smear", "crypto", "roof_break", "datacenter", "influence_broker"] as const;

// Книга правил грузится по первому нажатию: со скриншотами и темой доски она тяжелее всей главной.
const RulesBook = lazy(() => import("../ui/RulesBookEntry"));

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

type MobileView = "home" | "create" | "rooms" | "code";

export function RoomBrowser({ meta, onOpen, onFeedback, onTutorial }: Props) {
  const { t } = useTranslation(["home", "common", "game", "tutorial"]);
  const wide = useMedia(WIDE_QUERY);
  const narrowLanguage = useMedia("(max-width: 420px)");
  const [about, setAbout] = useState(false);
  const [rules, setRules] = useState(false);
  const [menu, setMenu] = useState(false);

  const [playerName, setPlayerName] = useState(() => localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const savePlayerName = (value: string) => {
    setPlayerName(value);
    localStorage.setItem(PLAYER_NAME_KEY, value);
  };
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const patchDraft = useCallback((patch: Partial<CreateDraft>) => setDraft(current => ({ ...current, ...patch })), []);
  const [code, setCode] = useState("");

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoomSummary | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [entering, setEntering] = useState<{ room: RoomSummary; returning: boolean } | null>(null);

  // ПК: правая панель — одна на две вкладки. Телефон: отдельные экраны с «Назад».
  const [tab, setTab] = useState<"create" | "rooms">("create");
  const [view, setView] = useState<MobileView>("home");
  const sideRef = useRef<HTMLElement>(null);

  const reload = async () => {
    try { setRooms(await cityApi.rooms()); setError(""); }
    catch (reason) { setError(errorText(reason, "loadRooms")); }
    finally { setLoaded(true); }
  };
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, []);

  /* Экраны телефона — в истории браузера: системная «назад» возвращает на главную, а не уводит с
   * сайта. Поля формы при этом живут здесь, выше экранов, и возврат их не теряет. */
  useEffect(() => {
    const onPop = () => setView(((history.state as { home?: MobileView } | null)?.home) ?? "home");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (next: MobileView) => {
    history.pushState({ home: next }, "");
    setView(next);
    window.scrollTo(0, 0);
  };
  const back = () => {
    if ((history.state as { home?: MobileView } | null)?.home) history.back();
    else setView("home");
  };

  // «Создать комнату» в титуле на ПК: вкладка создания и курсор в первое пустое поле.
  const focusCreate = () => {
    setTab("create");
    requestAnimationFrame(() => sideRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  };

  /* Вход в комнату. Открытая комната — сразу в лобби: лобби само посадит игрока на первое свободное
   * место, а без имени спросит его. Комнате с паролем пароль нужен до лобби — его спрашивает окно. */
  const enter = (room: RoomSummary) => {
    const returning = roomAction(room) === "return";
    if (room.open) {
      onOpen(room.id, "", returning ? undefined : playerName.trim() || undefined);
      return;
    }
    setEntering({ room, returning });
  };
  const confirmEnter = (name: string, password: string) => {
    if (!entering) return;
    if (name) savePlayerName(name);
    onOpen(entering.room.id, password, entering.returning ? undefined : name);
    setEntering(null);
  };

  /* «Войти в любую открытую комнату»: открытое лобби, которое ещё ждёт игроков и где есть свободное
   * место. Если таких нет — игрок сам открывает лобби с базовыми настройками и становится его
   * организатором: следующий, кто нажмёт эту кнопку, попадёт уже к нему. */
  const joinAny = async () => {
    setBusy(true); setError("");
    try {
      const fresh = await cityApi.rooms();
      setRooms(fresh);
      const candidates = fresh.filter(room => room.open && room.status === "waiting" && room.players < room.capacity);
      const name = playerName.trim() || undefined;
      if (candidates.length) {
        onOpen(candidates[Math.floor(Math.random() * candidates.length)].id, "", name);
        return;
      }
      const room = await createQuickLobby(fresh);
      onOpen(room.id, "", name);
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
        const room = await cityApi.create({ name: `lobby${number}`, password: "", capacity: 4, max_rounds: DEFAULT_ROUNDS, role_price: 3, open: true, owner_token: ownerToken });
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

  // Своя комната, куда можно вернуться: её узнаёт ключ места в этом браузере, а не имя.
  const resume = rooms.find(room => roomAction(room) === "return");
  const resumeButton = resume && (
    <button type="button" className="hm-resume" onClick={() => enter(resume)}>
      <span>{t(resume.status === "playing" ? "home:home.resumeGame" : "home:home.resumeRoom", { name: resume.name })}</span>
      <span aria-hidden="true">→</span>
    </button>
  );
  // Обучение показывает места широкого стола; на телефоне у стола своя раскладка, и обучения для неё пока нет.
  const tutorialCard = !isPhoneScreen() && (
    <div className="hm-tutorial">
      <span><b>{t("home:tutorialCard.title")}</b><small>{t("home:tutorialCard.text")}</small></span>
      <button type="button" className="hm-link" onClick={onTutorial}>{t("home:tutorialCard.cta")}</button>
    </div>
  );
  const roomList = (
    <RoomList rooms={rooms} loaded={loaded} busy={busy} onEnter={enter} onRemove={room => { setDeleteTarget(room); setDeletePassword(""); }} />
  );
  const quickJoin = (
    <div className="hm-quick">
      <button type="button" className="hm-secondary" disabled={busy} onClick={() => void joinAny()}>{t("home:rooms.quick")}</button>
      <p className="hm-hint">{t("home:rooms.quickHint")}</p>
    </div>
  );
  const createForm = (compact: boolean) => (
    <CreateRoomForm
      draft={draft}
      onDraft={patchDraft}
      playerName={playerName}
      onPlayerName={savePlayerName}
      rooms={rooms}
      compact={compact}
      onCreated={(roomId, password, name) => onOpen(roomId, password, name)}
    />
  );

  const overlays = (
    <>
      {/* Цена роли — та, что выставлена в форме создания комнаты: книга описывает партию, которую вы создаёте. */}
      {rules && (
        <Suspense fallback={null}>
          <RulesBook open onClose={() => setRules(false)} meta={meta} rolePrice={draft.rolePrice} />
        </Suspense>
      )}
      {about && <AboutDialog onClose={() => setAbout(false)} onFeedback={() => { setAbout(false); onFeedback(); }} />}
      {entering && (
        <EnterDialog room={entering.room} playerName={playerName} returning={entering.returning} onSubmit={confirmEnter} onClose={() => setEntering(null)} />
      )}
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
    </>
  );

  if (!wide) {
    return (
      <main className="rooms-app hm-mobile" data-ui="room-browser">
        <header className="hm-bar">
          {view === "home"
            ? <b className="hm-brand">{t("brand.title")}</b>
            : <button type="button" className="hm-back" onClick={back}>{t("home:home.back")}</button>}
          <button type="button" className="hm-icon hm-menu" aria-label={t("home:nav.menu")} aria-haspopup="dialog" onClick={() => setMenu(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </header>
        {error && <p className="hm-alert" role="alert">{error}</p>}

        {view === "home" && (
          <>
            <div className="hm-home">
            <section className="hm-hero" data-ui="home-hero">
              <span className="hm-eyebrow">{t("hero.eyebrow")}</span>
              <h1>{t("hero.titleLine1")} <em>{t("hero.titleLine2")}</em></h1>
              <p>{t("hero.lead")}</p>
            </section>
            <div className="hm-actions">
              {resumeButton}
              <button type="button" className="hm-primary hm-wide" onClick={() => go("create")}>{t("hero.ctaPlay")} <span aria-hidden="true">→</span></button>
              <button type="button" className="hm-secondary hm-wide" onClick={() => go("rooms")}>{t("home:home.findRoom")}</button>
              <button type="button" className="hm-secondary hm-wide" onClick={() => go("code")}>{t("home:home.byCode")}</button>
              {tutorialCard}
              <p className="hm-facts">{t("hero.factsLine", { districts: meta.districts.length, roles: meta.roles.length, rounds: DEFAULT_ROUNDS })}</p>
            </div>
            </div>
            <footer className="hm-footer">
              <button type="button" onClick={() => setRules(true)}>{t("nav.rules")}</button>
              <button type="button" onClick={() => setAbout(true)}>{t("nav.about")}</button>
              <button type="button" onClick={onFeedback}>{t("nav.feedback")}</button>
            </footer>
          </>
        )}
        {view === "create" && (
          <section className="hm-view">
            <h1>{t("create.heading")}</h1>
            <p className="hm-hint">{t("create.subheading")}</p>
            <div className="home-side hm-form">{createForm(true)}</div>
          </section>
        )}
        {view === "rooms" && (
          <section className="hm-view">
            <h1>{t("rooms.title")}</h1>
            {roomList}
            {quickJoin}
          </section>
        )}
        {view === "code" && (
          <section className="hm-view">
            <h1>{t("code.title")}</h1>
            <CodeEntry code={code} onCode={setCode} onFound={enter} />
          </section>
        )}

        {menu && (
          <MenuSheet onClose={() => setMenu(false)}>
            <button type="button" onClick={() => { setMenu(false); setRules(true); }}>{t("nav.rules")}</button>
            <button type="button" onClick={() => { setMenu(false); setAbout(true); }}>{t("nav.about")}</button>
            <button type="button" onClick={() => { setMenu(false); onFeedback(); }}>{t("nav.feedback")}</button>
            <div className="hm-menu-language"><span>{t("home:nav.language")}</span><LanguagePicker /></div>
          </MenuSheet>
        )}
        {overlays}
      </main>
    );
  }

  return (
    <main className="rooms-app room-browser home-screen" data-ui="room-browser">
      {/* Фон всего экрана. Картинка — `--hero-art` в styles.css: слева текст, справа панель,
        * поэтому смысловой центр картинки — между ними и правее. */}
      <div className="hero-art" aria-hidden="true" />
      <header className="rooms-topbar">
        {/* В панели — студия, компактно: название игры и так крупно стоит ниже, в титуле. */}
        <div className="rooms-wordmark home-studio"><StudioLogo /></div>
        <div className="rooms-topbar-end">
          <div className="rooms-presence">
            <span className="presence-dot" />
            {rooms.length ? t("presence.rooms", { count: rooms.length }) : t("presence.serverUp")}
          </div>
          <nav className="rooms-topnav" aria-label={t("home:nav.menu")}>
            <button type="button" className="rooms-button subtle" onClick={() => setRules(true)}>{t("nav.rules")}</button>
            <button type="button" className="rooms-button subtle" onClick={() => setAbout(true)}>{t("nav.about")}</button>
            <button type="button" className="rooms-button subtle" onClick={onFeedback}>{t("nav.feedback")}</button>
            <LanguagePicker className="rooms-language" compact={narrowLanguage} />
          </nav>
        </div>
      </header>

      {/* Титульный экран в один экран: слева — что это за игра, справа — создание комнаты и поиск,
        * чтобы игрок понял, куда попал, ещё до лобби. */}
      <div className="home-main">
        <section className="rooms-hero" data-ui="home-hero">
          <div className="hero-copy">
            <h1 className="hero-title">{t("brand.title")}</h1>
            <span className="eyebrow">{t("hero.eyebrow")}</span>
            <p className="hero-slogan">{t("hero.titleLine1")}<br /><em>{t("hero.titleLine2")}</em></p>
            <p className="hero-lead">{t("hero.lead")}</p>
            <div className="hero-actions">
              <button type="button" className="rooms-button primary hero-cta" onClick={focusCreate}>{t("hero.ctaPlay")}</button>
              <button type="button" className="rooms-button hero-cta ghost" onClick={() => setRules(true)}>{t("hero.ctaRules")}</button>
            </div>
            {tutorialCard}
            <ul className="hero-facts">
              <li><b>2–4</b><span>{t("hero.factPlayers")}</span></li>
              <li><b>5–30</b><span>{t("hero.factRounds")}</span></li>
              <li><b>{meta.districts.length}</b><span>{t("hero.factDistricts")}</span></li>
              <li><b>{meta.roles.length}</b><span>{t("hero.factRoles")}</span></li>
            </ul>
          </div>
        </section>

        <aside className="home-side" ref={sideRef}>
          {resumeButton && <div className="hm-side-resume">{resumeButton}</div>}
          <div className="home-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "create"} className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>{t("create.eyebrow")}</button>
            <button type="button" role="tab" aria-selected={tab === "rooms"} className={tab === "rooms" ? "active" : ""} onClick={() => setTab("rooms")}>
              {t("rooms.title")}{rooms.length > 0 && <span className="tab-count">{rooms.length}</span>}
            </button>
          </div>
          {error && <p className="rooms-alert" role="alert">{error}</p>}
          {tab === "create" ? createForm(false) : (
            <section className="rooms-panel hm-directory">
              <CodeEntry code={code} onCode={setCode} onFound={enter} />
              {roomList}
              {quickJoin}
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
                <li key={project.id}><ResourceText>{`★${project.points} ${project.title}`}</ResourceText></li>
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
      {overlays}
    </main>
  );
}

/* Меню телефона: правила, «О проекте», обратная связь и язык — нижней панелью. */
function MenuSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation("home");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className="hm-dialog hm-sheet" aria-label={t("nav.menu")} onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
      <div className="hm-dialog-body hm-menu-list">
        <div className="hm-sheet-head">
          <b>{t("brand.title")}</b>
          <button type="button" className="hm-icon" aria-label={t("nav.closeMenu")} onClick={() => ref.current?.close()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
