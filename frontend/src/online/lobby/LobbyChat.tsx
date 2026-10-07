import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../../i18n/errors";
import { ApiError } from "../api";
import { chatText } from "../botTalk";
import { newSecret } from "../roomSecrets";
import type { ChatMessage } from "../types";

/** Предел реплики на сервере (`CHAT_MESSAGE_LENGTH`): длиннее он обрежет — поле не даст набрать больше. */
export const CHAT_LIMIT = 240;

interface Pending { cid: string; text: string; failed: boolean }

/* Чат комнаты в лобби.
 *
 * История — с сервера, целиком при каждом опросе, поэтому повторное соединение не плодит дублей:
 * экран показывает ровно то, что хранит комната. Своё сообщение до подтверждения висит отдельно,
 * «отправляется…»; сервер возвращает его с тем же `cid`, и тогда черновик-призрак исчезает. Ошибка
 * оставляет сообщение на месте с кнопкой «Повторить» — повтор идёт с тем же `cid`, и если первая
 * попытка на самом деле дошла, сервер не скажет её второй раз.
 *
 * Прокрутка: пока читатель внизу — новые реплики подтягивают ленту; если он листает старое, позиция
 * не трогается, а внизу появляется «Новые сообщения». Текст реплик выводится как текст (React
 * экранирует его сам), длинные слова переносятся по CSS.
 */
export function LobbyChat({
  messages,
  myId,
  canWrite,
  draft,
  onDraft,
  onSend,
  onSeen,
  visible,
  onFocusChange,
}: {
  messages: ChatMessage[];
  myId?: string;
  canWrite: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string, cid: string) => Promise<unknown>;
  /** Читатель увидел ленту до конца: номер последней реплики. */
  onSeen: (seq: number) => void;
  /** Панель на экране — на телефоне чат живёт во вкладке и может быть скрыт. */
  visible: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState("");
  const [behind, setBehind] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;

  // Подтверждённые сервером — из очереди долой.
  const delivered = useMemo(() => new Set(messages.map(message => message.cid).filter(Boolean)), [messages]);
  useEffect(() => {
    setPending(current => (current.some(item => delivered.has(item.cid)) ? current.filter(item => !delivered.has(item.cid)) : current));
  }, [delivered]);

  const scrollDown = () => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
    atBottom.current = true;
    setBehind(false);
  };
  useLayoutEffect(() => {
    if (!visible) return;
    if (atBottom.current) scrollDown();
    else setBehind(true);
  }, [lastSeq, pending.length, visible]);
  useEffect(() => {
    if (visible && atBottom.current && lastSeq) onSeen(lastSeq);
  }, [visible, lastSeq, onSeen]);

  const onScroll = () => {
    const node = list.current;
    if (!node) return;
    atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    if (atBottom.current) {
      setBehind(false);
      if (lastSeq) onSeen(lastSeq);
    }
  };

  const deliver = async (item: Pending) => {
    setNotice("");
    try {
      await onSend(item.text, item.cid);
    } catch (reason) {
      setPending(current => current.map(entry => (entry.cid === item.cid ? { ...entry, failed: true } : entry)));
      setNotice(reason instanceof ApiError && reason.status === 429 ? t("chat.tooFast") : errorText(reason));
    }
  };
  const send = () => {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!text || !canWrite) return;
    const item = { cid: newSecret(), text, failed: false };
    setPending(current => [...current, item]);
    onDraft("");
    atBottom.current = true;
    void deliver(item);
  };
  const retry = (item: Pending) => {
    setPending(current => current.map(entry => (entry.cid === item.cid ? { ...entry, failed: false } : entry)));
    void deliver({ ...item, failed: false });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Набор через IME (иероглифы, подсказки клавиатуры телефона) подтверждает слово тем же Enter —
    // такое нажатие отправлять нельзя.
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  const time = (at: string) => {
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
  };
  const left = CHAT_LIMIT - draft.length;

  return (
    <section className="lb-chat" aria-label={t("chat.title")}>
      <div className="lb-chat-scroll">
        <ol ref={list} className="lb-chat-list" onScroll={onScroll} aria-live="polite" aria-relevant="additions">
          {!messages.length && !pending.length && <li className="lb-chat-empty">{t("chat.empty")}</li>}
          {messages.map(message => {
            const mine = message.player_id === myId;
            return (
              <li key={message.seq} className={`lb-message${mine ? " is-mine" : ""}`}>
                <span className="lb-message-meta">
                  <b>{mine ? t("chat.you") : message.name}</b>
                  <time dateTime={message.at}>{time(message.at)}</time>
                </span>
                <span className="lb-message-text">{chatText(message, null)}</span>
              </li>
            );
          })}
          {pending.map(item => (
            <li key={item.cid} className={`lb-message is-mine is-pending${item.failed ? " is-failed" : ""}`}>
              <span className="lb-message-meta">
                <b>{t("chat.you")}</b>
                <span>{item.failed ? t("chat.failed") : t("chat.sending")}</span>
                {item.failed && <button type="button" className="lb-link" onClick={() => retry(item)}>{t("chat.retry")}</button>}
              </span>
              <span className="lb-message-text">{item.text}</span>
            </li>
          ))}
        </ol>
        {behind && <button type="button" className="lb-chat-new" onClick={scrollDown}>{t("chat.newMessages")}</button>}
      </div>
      {notice && <p className="lb-chat-notice" role="alert">{notice}</p>}
      {canWrite ? (
        <form className="lb-chat-form" onSubmit={event => { event.preventDefault(); send(); }}>
          <label className="lb-visually-hidden" htmlFor="lb-chat-input">{t("chat.placeholder")}</label>
          <input
            id="lb-chat-input"
            value={draft}
            maxLength={CHAT_LIMIT}
            placeholder={t("chat.placeholder")}
            autoComplete="off"
            enterKeyHint="send"
            onChange={event => onDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            aria-describedby={left <= 40 ? "lb-chat-left" : undefined}
          />
          <button type="submit" className="lb-icon-button lb-send" aria-label={t("chat.send")} disabled={!draft.trim()}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></svg>
          </button>
          {left <= 40 && <small id="lb-chat-left" className="lb-chat-left">{t("chat.limit", { left })}</small>}
        </form>
      ) : (
        <p className="lb-chat-locked">{t("chat.seatFirst")}</p>
      )}
    </section>
  );
}
