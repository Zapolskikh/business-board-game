import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../i18n/errors";
import { useVisibleArea } from "../ui/lib/layout";
import { cityApi } from "./api";
import { BotPicker, useBotLabel } from "./lobby/BotPicker";
import { LobbyChat } from "./lobby/LobbyChat";
import { useLobbyRoom } from "./lobby/useLobbyRoom";
import { forgetSeat, readRoomSecrets, saveSeat, seatToken } from "./roomSecrets";
import type { CityMeta, Difficulty, RoomSeat, RoomView } from "./types";
import "./lobby/lobby.css";

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

/** Когда лобби — две колонки (игроки и чат): широкий экран или телефон в альбоме. Иначе — вкладки. */
const WIDE_QUERY = "(min-width: 900px), (orientation: landscape) and (min-width: 600px)";
/** Низкий экран (телефон в альбоме, маленький ноутбук с панелями): лобби ровно в экран, без прокрутки страницы. */
const SHORT_QUERY = "(max-height: 560px)";

function useMedia(query: string): boolean {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

type Toast = { text: string; undo?: () => void };

/* Лобби: кто за столом, приглашение, боты, чат и запуск.
 *
 * Права — серверные: ботов, освобождение мест и запуск сервер принимает только с ключом создателя
 * (`owner_token`), который знает лишь браузер, создавший комнату. Интерфейс показывает эти кнопки
 * только ему же, но и без этого гость получил бы отказ.
 *
 * Пароль спрашивается один раз — в карточке «Вы ещё не за столом», вместе с именем. После того как
 * место занято, форм в лобби нет: пароль живёт в сессии, а ключ места — в браузере (roomSecrets).
 */
export function Lobby({ roomId, initialPassword = "", autoJoinName = null, playerId, onBack, onJoined, onPlay }: Props) {
  const { t } = useTranslation("home");
  const botLabel = useBotLabel();
  const wide = useMedia(WIDE_QUERY);
  const short = useMedia(SHORT_QUERY);
  // Лобби, вписанное в экран: на телефоне — во вкладках, на низком экране — в две колонки.
  const fitted = !wide || short;

  const [password, setPassword] = useState(initialPassword);
  // Пароль подтверждён сервером (вход удался или состояние комнаты отдано): лобби читает чат.
  const [verified, setVerified] = useState(Boolean(initialPassword));
  const [secrets, setSecrets] = useState(() => readRoomSecrets(roomId));
  const isOwner = Boolean(secrets.owner);
  const knownPlayerId = playerId ?? secrets.playerId;

  const [playerName, setPlayerName] = useState(() => autoJoinName || localStorage.getItem("city-player-name") || "");
  const [autoJoinTried, setAutoJoinTried] = useState(false);
  const [error, setError] = useState("");
  // Номер места, по которому сейчас идёт запрос: кнопки этого места ждут ответа, остальные живы.
  const [pendingSeat, setPendingSeat] = useState<number | "start" | null>(null);
  const [picker, setPicker] = useState<RoomSeat | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [tab, setTab] = useState<"players" | "chat">("players");
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  const [confirmFree, setConfirmFree] = useState<number | null>(null);
  const [inviteNote, setInviteNote] = useState("");

  const onDenied = useCallback(() => setVerified(false), []);
  const { room, apply, failed, offline, reload } = useLobbyRoom(roomId, {
    password,
    viewerId: playerId,
    access: verified,
    onDenied,
  });

  // Открытая комната пароля не спрашивает: доступ есть сразу.
  useEffect(() => { if (room?.open && !verified) setVerified(true); }, [room?.open, verified]);
  useEffect(() => { if (room && room.status !== "waiting" && playerId) onPlay(); }, [room?.status, playerId, onPlay]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7_000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (confirmFree === null) return;
    const timer = window.setTimeout(() => setConfirmFree(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirmFree]);

  const seats = room?.seats ?? [];
  const mySeat = seats.find(seat => seat.kind === "human" && seat.player_id === playerId);
  const formerSeat = !mySeat ? seats.find(seat => seat.kind === "human" && seat.player_id === knownPlayerId) : undefined;
  const firstFree = seats.find(seat => seat.kind === "empty");
  const waiting = room?.status === "waiting";

  const run = async (seat: number | "start", operation: () => Promise<RoomView>): Promise<RoomView | null> => {
    setPendingSeat(seat);
    setError("");
    try {
      const next = await operation();
      apply(next);
      return next;
    } catch (reason) {
      setError(errorText(reason));
      void reload();
      return null;
    } finally {
      setPendingSeat(null);
    }
  };

  const join = async (index: number, asName?: string) => {
    // Возврат на своё место — под тем именем, что уже на нём: поле имени в этом случае не показано.
    const returning = seats[index]?.kind === "human" ? seats[index].name ?? "" : "";
    const name = (asName ?? (returning || playerName)).trim();
    if (!name) { setError(t("lobby.nameRequired")); return; }
    if (!room?.open && !password) { setError(t("lobby.passwordRequired")); return; }
    setPendingSeat(index);
    setError("");
    try {
      const next = await cityApi.join(roomId, {
        password,
        seat_index: index,
        player_name: name,
        release_seat_index: mySeat && mySeat.index !== index ? mySeat.index : null,
        seat_token: seatToken(roomId),
      });
      localStorage.setItem("city-player-name", name);
      const joinedId = next.seats[index].player_id;
      if (joinedId) {
        saveSeat(roomId, joinedId);
        setSecrets(readRoomSecrets(roomId));
        setVerified(true);
        onJoined(password, joinedId);
      }
      apply(next);
    } catch (reason) {
      setError(errorText(reason, "joinFailed"));
      void reload();
    } finally {
      setPendingSeat(null);
    }
  };

  useEffect(() => {
    if (!room || autoJoinTried || !autoJoinName || playerId || room.status !== "waiting") return;
    setAutoJoinTried(true);
    if (firstFree) void join(firstFree.index, autoJoinName);
  }, [room, autoJoinTried, autoJoinName, playerId]);

  const owner = secrets.owner;
  const pickBot = async (seat: RoomSeat, difficulty: Difficulty) => {
    setPicker(null);
    const wasBot = seat.kind === "bot";
    const next = await run(seat.index, () =>
      cityApi.seat(roomId, { password, seat_index: seat.index, kind: "bot", difficulty, preferred_role: null, owner_token: owner }),
    );
    if (!next) return;
    const name = botLabel(difficulty);
    setToast(wasBot
      ? { text: t("bots.changed", { name }) }
      : {
        text: t("bots.added", { name }),
        // «Отменить» убирает бота, только пока на месте всё ещё бот: севшего туда игрока сервер не тронет.
        undo: () => {
          setToast(null);
          void run(seat.index, () =>
            cityApi.seat(roomId, { password, seat_index: seat.index, kind: "empty", owner_token: owner, expected_kind: "bot" }),
          ).then(done => done && setToast({ text: t("bots.undone") }));
        },
      });
  };
  const clearSeat = (seat: RoomSeat) =>
    void run(seat.index, () =>
      cityApi.seat(roomId, { password, seat_index: seat.index, kind: "empty", owner_token: owner, expected_kind: seat.kind }),
    );
  const start = () => void run("start", () => cityApi.start(roomId, password, owner));

  /* «← Комнаты» из лобби, где игра ещё не началась, — это и есть «выйти»: место освобождается само,
   * организатору не нужно чистить его руками. Не удалось (нет связи) — уходим всё равно: место
   * останется за этим браузером, и из списка на него можно вернуться. После старта место — рука в
   * игре, его не отдаём. */
  const leave = async () => {
    if (waiting && mySeat) {
      try {
        await cityApi.leave(roomId, { password, seat_index: mySeat.index, seat_token: seatToken(roomId) });
        forgetSeat(roomId);
      } catch { /* место осталось — вернуться на него можно из списка */ }
    }
    onBack();
  };

  const invite = async () => {
    const link = `${location.origin}/?room=${encodeURIComponent(roomId)}`;
    const share = (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share;
    try {
      if (share && !wide) { await share.call(navigator, { title: room?.name, url: link }); return; }
      await navigator.clipboard.writeText(link);
      setInviteNote(t("lobby.inviteCopied"));
    } catch (reason) {
      // Отменённое «Поделиться» — не ошибка; без буфера обмена (http не на localhost) — ссылка текстом.
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setInviteNote(t("lobby.inviteManual", { link }));
    }
    window.setTimeout(() => setInviteNote(""), 4_000);
  };

  const messages = room?.chat ?? [];
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;
  // История до входа в лобби — не «непрочитанное»: отсчёт начинается с первой загрузки чата.
  useEffect(() => { if (seen === null && room?.chat) setSeen(lastSeq); }, [room?.chat, seen, lastSeq]);
  const markSeen = useCallback((seq: number) => setSeen(current => (current === null || seq > current ? seq : current)), []);
  const unread = useMemo(
    () => (seen === null ? 0 : messages.filter(message => message.seq > seen && message.player_id !== playerId).length),
    [messages, seen, playerId],
  );
  const chatVisible = wide || tab === "chat";
  const sendChat = (text: string, cid: string) => {
    if (!playerId) return Promise.reject(new Error("not seated"));
    return cityApi.chat(roomId, password, playerId, text, seatToken(roomId), cid).then(apply);
  };

  // Телефон: лобби занимает ровно видимую часть экрана — над клавиатурой, когда она открыта.
  const area = useVisibleArea(fitted);
  const shellStyle: CSSProperties | undefined = fitted ? { top: area.top, height: area.height } : undefined;

  if (!room) {
    return (
      <main className="lb lb-loading">
        <button type="button" className="lb-back" onClick={onBack}>{t("lobby.back")}</button>
        <p role="status">{failed ? errorText(failed, "roomUnavailable") : t("lobby.loading")}</p>
      </main>
    );
  }

  const enoughPlayers = room.players >= 2;
  const hasHuman = room.humans >= 1;
  const canStart = waiting && isOwner && enoughPlayers && hasHuman && verified;
  const reason = !verified ? t("lobby.passwordRequired")
    : !hasHuman ? t("lobby.needHuman")
    : !enoughPlayers ? t("lobby.needRival")
    : t("lobby.readyToStart");
  const lead = !waiting ? t("lobby.runningLead") : isOwner ? t("lobby.hostLead") : mySeat ? t("lobby.seatedLead") : t("lobby.guestLead");
  const settings = room.max_rounds
    ? t("lobby.settings", { rounds: room.max_rounds, price: room.role_price ?? 3 })
    : t("lobby.settingsNoRounds", { capacity: room.capacity });

  const entry = !mySeat && (
    <EntryCard
      waiting={waiting}
      needsPassword={!room.open && !verified}
      playerName={playerName}
      password={password}
      busy={pendingSeat !== null}
      former={formerSeat}
      free={firstFree}
      onName={setPlayerName}
      onPassword={value => { setPassword(value); setVerified(false); }}
      onJoin={index => void join(index)}
    />
  );

  const players = (
    <section className="lb-players" aria-labelledby="lb-players-title">
      <header className="lb-section-head">
        <h2 id="lb-players-title">{t("lobby.playersTitle")}</h2>
        <span>{t("lobby.playersCount", { players: room.players, capacity: room.capacity })}</span>
      </header>
      {entry}
      <ul className="lb-seats">
        {seats.map(seat => (
          <SeatRow
            key={seat.index}
            seat={seat}
            mine={seat === mySeat || seat === formerSeat}
            isOwner={isOwner}
            waiting={waiting}
            busy={pendingSeat === seat.index}
            locked={pendingSeat !== null}
            seated={Boolean(mySeat)}
            confirmFree={confirmFree === seat.index}
            botLabel={botLabel}
            onTake={() => void join(seat.index)}
            onBot={() => setPicker(seat)}
            onRemoveBot={() => clearSeat(seat)}
            onFree={() => (confirmFree === seat.index ? (setConfirmFree(null), clearSeat(seat)) : setConfirmFree(seat.index))}
          />
        ))}
      </ul>
      <p className="lb-settings">{settings}</p>
    </section>
  );

  const chat = (
    <LobbyChat
      messages={messages}
      myId={playerId}
      canWrite={Boolean(mySeat) && waiting}
      draft={draft}
      onDraft={setDraft}
      onSend={sendChat}
      onSeen={markSeen}
      visible={chatVisible && verified}
      onFocusChange={setTyping}
    />
  );
  const chatPanel = verified ? chat : <section className="lb-chat"><p className="lb-chat-locked">{t("chat.seatFirst")}</p></section>;

  const launch = (
    <footer className={`lb-launch${typing && fitted ? " is-collapsed" : ""}`}>
      {!waiting ? (
        mySeat ? <button type="button" className="lb-primary" onClick={onPlay}>{t("lobby.resume")} <span aria-hidden="true">→</span></button>
        : <p className="lb-launch-note">{t("lobby.runningLead")}</p>
      ) : isOwner ? (
        <>
          <p className={`lb-launch-note${canStart ? " is-ready" : ""}`} id="lb-start-reason">{reason}</p>
          <button
            type="button"
            className="lb-primary"
            disabled={!canStart || pendingSeat !== null}
            aria-describedby="lb-start-reason"
            onClick={start}
          >
            {pendingSeat === "start" ? t("lobby.starting") : t("lobby.start")} <span aria-hidden="true">→</span>
          </button>
        </>
      ) : (
        <p className="lb-launch-note">{mySeat ? t("lobby.waitHost") : t("lobby.waitSeat")}</p>
      )}
    </footer>
  );

  return (
    <main className={`lb${wide ? " is-wide" : " is-narrow"}${fitted ? " is-fitted" : ""}${short ? " is-short" : ""}`} style={shellStyle} data-ui="lobby">
      <div className="lb-art" aria-hidden="true" />
      <header className="lb-head">
        <button type="button" className="lb-back" onClick={() => void leave()}>{t("lobby.back")}</button>
        <div className="lb-title">
          <span className={`lb-status status-${room.status}`}>{t(`lobby.status.${room.status}`)}</span>
          <h1 title={room.name}>{room.name}</h1>
          <p className="lb-lead">{lead}</p>
        </div>
        <div className="lb-invite">
          <button type="button" className="lb-secondary" onClick={() => void invite()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
            {t("lobby.invite")}
          </button>
          <small className="lb-code">{inviteNote || t("lobby.inviteCode", { code: room.id })}</small>
        </div>
      </header>

      {(error || offline) && (
        <p className="lb-alert" role="alert">{error || t("chat.offline")}</p>
      )}

      {wide ? (
        <div className="lb-columns">
          {players}
          <div className="lb-chat-column">
            <h2 className="lb-chat-title">{t("chat.title")}</h2>
            {chatPanel}
          </div>
        </div>
      ) : (
        <>
          <div className="lb-tabs" role="tablist" aria-label={t("lobby.tabs")}>
            <TabButton id="players" active={tab === "players"} onSelect={() => setTab("players")}>
              {t("lobby.tabPlayers", { players: room.players, capacity: room.capacity })}
            </TabButton>
            <TabButton id="chat" active={tab === "chat"} onSelect={() => setTab("chat")}>
              {t("lobby.tabChat")}
              {unread > 0 && <span className="lb-badge" aria-label={t("lobby.unread", { count: unread })}>{unread}</span>}
            </TabButton>
          </div>
          {/* Обе вкладки в DOM: черновик, история и место чтения переживают переключение. */}
          <div className="lb-panel" role="tabpanel" id="lb-panel-players" aria-labelledby="lb-tab-players" hidden={tab !== "players"}>{players}</div>
          <div className="lb-panel lb-panel-chat" role="tabpanel" id="lb-panel-chat" aria-labelledby="lb-tab-chat" hidden={tab !== "chat"}>{chatPanel}</div>
        </>
      )}

      {launch}

      {toast && (
        <div className="lb-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="lb-link" onClick={toast.undo}>{t("bots.undo")}</button>}
        </div>
      )}

      {picker && (
        <BotPicker
          seatNumber={picker.index + 1}
          current={picker.kind === "bot" ? picker.difficulty : undefined}
          onPick={difficulty => void pickBot(picker, difficulty)}
          onClose={() => setPicker(null)}
        />
      )}
    </main>
  );
}

function TabButton({ id, active, onSelect, children }: { id: string; active: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      id={`lb-tab-${id}`}
      aria-selected={active}
      aria-controls={`lb-panel-${id}`}
      tabIndex={active ? 0 : -1}
      className="lb-tab"
      onClick={onSelect}
      onKeyDown={event => {
        // Стрелки переключают вкладки, как в любом tablist: вкладок две, любая стрелка — на соседнюю.
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const other = document.querySelector<HTMLButtonElement>(`.lb-tab:not(#lb-tab-${id})`);
        other?.focus();
        other?.click();
      }}
    >
      {children}
    </button>
  );
}

/* Вход за стол: имя, пароль (если комната закрыта), «Занять место». Тот, кто уже сидел на месте и
 * перезагрузил страницу, видит «Вернуться на своё место» — его узнаёт ключ места, а не имя. */
function EntryCard({ waiting, needsPassword, playerName, password, busy, former, free, onName, onPassword, onJoin }: {
  waiting: boolean;
  needsPassword: boolean;
  playerName: string;
  password: string;
  busy: boolean;
  former?: RoomSeat;
  free?: RoomSeat;
  onName: (name: string) => void;
  onPassword: (password: string) => void;
  onJoin: (index: number) => void;
}) {
  const { t } = useTranslation("home");
  const [show, setShow] = useState(false);
  const target = former ?? (waiting ? free : undefined);
  if (!waiting && !former) return <p className="lb-entry-note">{t("lobby.entryRunning")}</p>;
  return (
    <form className="lb-entry" onSubmit={event => { event.preventDefault(); if (target) onJoin(target.index); }}>
      {/* Возврат на своё место — одна кнопка, без заголовка: имени и пароля спрашивать не о чем. */}
      {(!former || needsPassword) && <h3>{t("lobby.entryTitle")}</h3>}
      <div className="lb-entry-fields">
        {!former && (
          <label className="lb-field">
            <span>{t("lobby.entryName")}</span>
            <input value={playerName} maxLength={32} autoComplete="nickname" placeholder={t("lobby.entryNamePlaceholder")} onChange={event => onName(event.target.value)} />
          </label>
        )}
        {needsPassword && (
          <label className="lb-field">
            <span>{t("lobby.entryPassword")}</span>
            <span className="lb-input-action">
              <input type={show ? "text" : "password"} value={password} maxLength={128} autoComplete="current-password" placeholder={t("lobby.entryPasswordPlaceholder")} onChange={event => onPassword(event.target.value)} />
              <button type="button" className="lb-icon-button" aria-pressed={show} aria-label={t(show ? "lobby.hidePassword" : "lobby.showPassword")} onClick={() => setShow(value => !value)}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{show && <path d="M4 4l16 16" />}</svg>
              </button>
            </span>
          </label>
        )}
      </div>
      <button type="submit" className="lb-primary" disabled={busy || !target}>
        {former ? t("lobby.entryReturn") : target ? t("lobby.entryJoin") : t("lobby.entryFull")}
      </button>
    </form>
  );
}

function SeatRow({ seat, mine, isOwner, waiting, busy, locked, seated, confirmFree, botLabel, onTake, onBot, onRemoveBot, onFree }: {
  seat: RoomSeat;
  mine: boolean;
  isOwner: boolean;
  waiting: boolean;
  /** Запрос по этому месту в пути. */
  busy: boolean;
  /** Запрос по какому-то месту в пути — повторные нажатия ждут. */
  locked: boolean;
  /** Этот браузер уже сидит за столом: свободное место для него — «пересесть», а не «занять». */
  seated: boolean;
  confirmFree: boolean;
  botLabel: (difficulty: Difficulty) => string;
  onTake: () => void;
  onBot: () => void;
  onRemoveBot: () => void;
  onFree: () => void;
}) {
  const { t } = useTranslation("home");
  const n = seat.index + 1;
  const title = seat.kind === "empty" ? t("seat.empty") : seat.name ?? "";
  const detail = seat.kind === "empty" ? t("seat.number", { n })
    : seat.kind === "bot" ? t("seat.bot", { level: botLabel(seat.difficulty) })
    : mine ? [t("seat.you"), isOwner ? t("seat.host") : null].filter(Boolean).join(" · ")
    : t("seat.human");
  return (
    <li className={`lb-seat seat-${seat.kind}${mine ? " is-mine" : ""}${busy ? " is-busy" : ""}`} aria-busy={busy || undefined}>
      <span className="lb-avatar" aria-hidden="true">
        {seat.kind === "bot" ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" /></svg>
        ) : seat.kind === "human" ? (
          <b>{(seat.name ?? "?").trim().charAt(0).toUpperCase()}</b>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10" cy="8" r="3.5" /><path d="M3.5 19c.8-3.6 3.4-5.5 6.5-5.5 1.3 0 2.5.3 3.5 1M18 13v6M15 16h6" /></svg>
        )}
      </span>
      <span className="lb-seat-text">
        <strong title={title}>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="lb-seat-actions">
        {waiting && seat.kind === "empty" && isOwner && seated && (
          <button type="button" className="lb-chip" disabled={locked} aria-label={t("seat.addBotLabel", { n })} onClick={onBot}>{t("seat.addBot")}</button>
        )}
        {/* Пересесть — отдельное действие для сидящего гостя; у организатора на свободном месте «+ Бот». */}
        {waiting && seat.kind === "empty" && seated && !isOwner && (
          <button type="button" className="lb-chip" disabled={locked} onClick={onTake}>{t("seat.move")}</button>
        )}
        {waiting && seat.kind === "empty" && !seated && (
          <button type="button" className="lb-chip is-accent" disabled={locked} onClick={onTake}>{t("seat.take")}</button>
        )}
        {waiting && seat.kind === "empty" && isOwner && !seated && (
          <button type="button" className="lb-chip" disabled={locked} aria-label={t("seat.addBotLabel", { n })} onClick={onBot}>{t("seat.addBot")}</button>
        )}
        {waiting && seat.kind === "bot" && isOwner && (
          <>
            <button type="button" className="lb-icon-button" disabled={locked} aria-label={t("seat.changeBotLabel", { n })} title={t("seat.changeBot")} onClick={onBot}>
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></svg>
            </button>
            <button type="button" className="lb-icon-button" disabled={locked} aria-label={t("seat.removeBot", { n })} onClick={onRemoveBot}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </>
        )}
        {waiting && seat.kind === "human" && !mine && isOwner && (
          <button type="button" className={`lb-chip${confirmFree ? " is-danger" : ""}`} disabled={locked} aria-label={t("seat.freeSeatLabel", { n })} onClick={onFree}>
            {confirmFree ? `${t("seat.freeSeat")}?` : t("seat.freeSeat")}
          </button>
        )}
        {busy && <span className="lb-spinner" aria-hidden="true" />}
      </span>
    </li>
  );
}
