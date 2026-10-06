import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { chatText } from "../../online/botTalk";
import { describeEventSegments } from "../../online/gameUi";
import type { ChatMessage, CityMeta, GameState } from "../../online/types";
import { playerColor } from "../lib/board";
import { Modal } from "../primitives/Modal";
import { Panel } from "../primitives/atoms";
import { LogSegments } from "./LogSegments";

/* Разговор за столом: чат игроков и лента событий — две вкладки одного окна.
 *
 * Чат стоит первым и открыт по умолчанию: ход соперника игрок видит и на столе, а слова — только
 * здесь. Лента событий оформлена теми же «репликами», что и чат: это тот же разговор, только
 * говорит в нём сам стол.
 *
 * Сообщения живут в комнате, а не в партии (см. `RoomState.chat` на сервере): в читаемый журнал
 * .md они попадают, в воспроизводимый .json — нет.
 */

/** Сколько символов сервер хранит в одной реплике. */
export const CHAT_MESSAGE_LENGTH = 240;
/** Сколько секунд реплика висит облачком над карточкой игрока. */
const BUBBLE_SECONDS = 7;

type Send = (text: string) => void;

/* Свежие реплики — облачками над карточками авторов. История, пришедшая с первой загрузкой,
 * молчит: облачко значит «сказал только что», а не «когда-то говорил». */
export function useChatBubbles(chat: ChatMessage[]): Record<string, ChatMessage> {
  const [bubbles, setBubbles] = useState<Record<string, ChatMessage>>({});
  const last = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const top = chat.length ? chat[chat.length - 1].seq : 0;
    if (last.current === null) {
      last.current = top;
      return;
    }
    const fresh = chat.filter(message => message.seq > (last.current ?? 0));
    last.current = top;
    if (fresh.length === 0) return;
    setBubbles(current => ({ ...current, ...Object.fromEntries(fresh.map(message => [message.player_id, message])) }));
    const gone = new Set(fresh.map(message => message.seq));
    timers.current.push(
      window.setTimeout(() => {
        setBubbles(current => Object.fromEntries(Object.entries(current).filter(([, message]) => !gone.has(message.seq))));
      }, BUBBLE_SECONDS * 1000),
    );
  }, [chat]);

  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);
  return bubbles;
}

/** Номер последней реплики — для счётчика непрочитанного. */
export const chatTop = (chat: ChatMessage[]): number => (chat.length ? chat[chat.length - 1].seq : 0);

/** Есть ли чужие реплики новее прочитанной: своя собственная непрочитанной не бывает. */
export const chatUnread = (chat: ChatMessage[], seen: number, meId: string): boolean =>
  chat.some(message => message.seq > seen && message.player_id !== meId);

function ChatList({ chat, game, meId }: { chat: ChatMessage[]; game: GameState; meId: string }) {
  const { t } = useTranslation("game");
  const end = useRef<HTMLDivElement>(null);
  // Новая реплика — внизу, и лента сама доезжает до неё.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [chat.length]);

  return (
    <div data-ui="chat-list" className="grid min-h-0 content-start gap-1 overflow-y-auto pr-0.5">
      {chat.length === 0 && <p className="px-1 py-2 text-center text-[12.5px] text-ink-dim">{t("ui.chat.empty")}</p>}
      {chat.map(message => {
        const mine = message.player_id === meId;
        return (
          <div key={message.seq} data-mine={mine || undefined} className={`talk-line ${mine ? "justify-self-end" : "justify-self-start"}`}>
            {!mine && (
              <b className="mr-1 font-semibold" style={{ color: playerColor(game, message.player_id) }}>
                {message.name}
              </b>
            )}
            <span className="break-words">{chatText(message, game)}</span>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function ChatInput({ onSend, autoFocus = false }: { onSend?: Send; autoFocus?: boolean }) {
  const { t } = useTranslation("game");
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || !onSend) return;
    onSend(body);
    setText("");
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
      <input
        data-ui="chat-input"
        value={text}
        onChange={event => setText(event.target.value)}
        maxLength={CHAT_MESSAGE_LENGTH}
        disabled={!onSend}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="send"
        placeholder={t("ui.chat.placeholder")}
        aria-label={t("ui.chat.placeholder")}
        className="talk-input min-w-0 rounded-md border px-2.5 py-1.5 text-[14px] outline-none"
      />
      <button
        type="submit"
        disabled={!onSend || !text.trim()}
        aria-label={t("ui.chat.send")}
        title={t("ui.chat.send")}
        className="primary-button rounded-md px-3 text-[15px] font-bold disabled:opacity-40"
      >
        ➤
      </button>
    </form>
  );
}

function Chat({ chat, game, meId, onSend, autoFocus }: { chat: ChatMessage[]; game: GameState; meId: string; onSend?: Send; autoFocus?: boolean }) {
  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-1.5">
      <ChatList chat={chat} game={game} meId={meId} />
      <ChatInput onSend={onSend} autoFocus={autoFocus} />
    </div>
  );
}

/* Лента событий теми же репликами. Свежие сверху: лента короткая, а листать её вниз незачем —
 * вся хроника открывается окном по кнопке. */
function LogTalk({ game, meta, onOpen }: { game: GameState; meta: CityMeta; onOpen: () => void }) {
  const { t } = useTranslation("game");
  const events = [...game.event_log].reverse().slice(0, 40);
  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-1.5">
      <div className="grid min-h-0 content-start gap-1 overflow-y-auto pr-0.5">
        {events.length === 0 && <p className="px-1 py-2 text-center text-[12.5px] text-ink-dim">{t("ui.chronicle.empty")}</p>}
        {events.map(event => {
          const segments = describeEventSegments(event, game, meta);
          if (segments.length === 0) return null;
          return (
            <div key={event.seq} data-system className="talk-line justify-self-start">
              <LogSegments segments={segments} />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[13px] font-semibold text-ink hover:border-accent"
      >
        📜 {t("ui.chronicle.railOpen")}
      </button>
    </div>
  );
}

function Tab({ active, onClick, dot, children }: { active: boolean; onClick: () => void; dot: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-active={active || undefined}
      onClick={onClick}
      className="talk-tab relative rounded-md border px-2 py-1 text-[13.5px] font-semibold"
    >
      {children}
      {dot && !active && <span aria-hidden="true" className="absolute right-1 top-1 size-2 rounded-full bg-gold" />}
    </button>
  );
}

/** Левый нижний угол широкого стола: «Чат» и «Лог» вкладками. */
export function TableTalk({
  game,
  meta,
  meId,
  chat,
  onSend,
  unseenEvents,
  onOpenLog,
}: {
  game: GameState;
  meta: CityMeta;
  meId: string;
  chat: ChatMessage[];
  /** Нет — писать некуда: галерея, наблюдатель-админ. */
  onSend?: Send;
  /** Сколько событий пришло с последнего открытия полной хроники. */
  unseenEvents: number;
  onOpenLog: () => void;
}) {
  const { t } = useTranslation("game");
  const [tab, setTab] = useState<"chat" | "log">("chat");
  const [seen, setSeen] = useState(() => chatTop(chat));
  const top = chatTop(chat);
  useEffect(() => {
    if (tab === "chat") setSeen(top);
  }, [tab, top]);

  return (
    <Panel zone="chronicle" className="grid h-[252px] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1.5">
      <div role="tablist" aria-label={t("ui.chat.tabs")} className="grid grid-cols-2 gap-1">
        <Tab active={tab === "chat"} onClick={() => setTab("chat")} dot={chatUnread(chat, seen, meId)}>💬 {t("ui.chat.tab")}</Tab>
        <Tab active={tab === "log"} onClick={() => setTab("log")} dot={unseenEvents > 0}>📜 {t("ui.chat.logTab")}</Tab>
      </div>
      {tab === "chat" ? (
        <Chat chat={chat} game={game} meId={meId} onSend={onSend} />
      ) : (
        <LogTalk game={game} meta={meta} onOpen={onOpenLog} />
      )}
    </Panel>
  );
}

/** Телефон: тот же чат отдельным окном по центру экрана. */
export function ChatModal({
  open,
  onClose,
  game,
  meId,
  chat,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  game: GameState;
  meId: string;
  chat: ChatMessage[];
  onSend?: Send;
}) {
  const { t } = useTranslation("game");
  return (
    <Modal open={open} onClose={onClose} title={`💬 ${t("ui.chat.title")}`} width={560}>
      <div className="grid h-[250px]">
        <Chat chat={chat} game={game} meId={meId} onSend={onSend} autoFocus />
      </div>
    </Modal>
  );
}

/** Облачко с репликой над карточкой игрока. */
export function ChatBubble({ message, game }: { message: ChatMessage; game: GameState }) {
  return (
    <span data-ui="chat-bubble" className="chat-bubble pointer-events-none absolute right-1.5 top-1 z-20 max-w-[88%]">
      <span className="line-clamp-3 break-words">{chatText(message, game)}</span>
    </span>
  );
}
