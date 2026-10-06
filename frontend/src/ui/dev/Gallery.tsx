import { useEffect, useState } from "react";
import type { ChatMessage, GameState, LegalAction, MarketAsset } from "../../online/types";
import { BoardView } from "../board/Board";
import type { ActionContext } from "../lib/actions";
import { ME, meta as fixtureMeta, scenarios, type ScenarioName } from "./fixtures";
import { useLocalizedMeta } from "../../i18n/catalog";
import "../theme.css";

/* Галерея состояний.
 *
 * Открывается на /dev (или ?dev=1). Смысл — увидеть доску во всех состояниях, не играя
 * до них: «нет слота при полном кошельке», «действия кончились», «ход соперника»,
 * «партия окончена» в живой партии достигаются подгадыванием на двадцать минут.
 *
 * Ротацию рынка можно запустить кнопкой — единственный способ посмотреть анимацию
 * переворота, пока на бэкенде нет покадровой отдачи ходов ботов.
 */

const names = Object.keys(scenarios) as ScenarioName[];
const query = new URLSearchParams(location.search);
const requestedScenario = query.get("scenario");
const initialScenario = names.find(item => item === requestedScenario) ?? names[1];

const spares: MarketAsset[] = [
  { uid: "n-1", card_id: "insurance", price: 7 },
  { uid: "n-2", card_id: "coworking", price: 5 },
  { uid: "n-3", card_id: "city_ecosystem", price: 16, leaving: true },
];

export function Gallery() {
  const meta = useLocalizedMeta(fixtureMeta);
  const [name, setName] = useState<ScenarioName>(initialScenario);
  const [pendingUid, setPendingUid] = useState<string | null>(query.has("pending") ? "__first__" : null);
  const [rotations, setRotations] = useState(0);
  const [busy, setBusy] = useState(query.has("busy"));
  const [error, setError] = useState(query.has("error") ? "Команда не выполнена: ревизия устарела" : "");
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [panel, setPanel] = useState(query.get("panel") !== "0");
  /* Чат в галерее живёт в памяти страницы. `?chat=1` — сразу с парой реплик и облачком: первая
   * реплика приходит с загрузкой и молчит, вторая появляется следом, как только что сказанная. */
  const [chat, setChat] = useState<ChatMessage[]>(() =>
    query.has("chat") ? [{ seq: 1, player_id: "p-bot2", name: "Bot 2", text: "Кто взял мой проект?", at: "", round: 6, after_event: 0 }] : [],
  );
  const say = (player_id: string, name: string, text: string) =>
    setChat(current => [...current, { seq: current.length + 1, player_id, name, text, at: "", round: 6, after_event: 0 }]);
  useEffect(() => {
    if (!query.has("chat")) return;
    const timer = window.setTimeout(() => {
      say(ME, "Вы", "Я. И рынок сейчас тоже заберу.");
      say("p-bot3", "Bot 3", "Посмотрим, хватит ли влияния 🙂");
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const room = scenarios[name];
  const base = room.game as GameState;
  const me = base.players.find(player => player.id === ME)!;

  // Ротация: три старших слота заменяются новыми uid — ровно то, что делает движок
  // в начале раунда (MARKET_ROTATION_SIZE = 3).
  const market =
    rotations % 2 === 0
      ? base.market
      : [...spares.map(item => ({ ...item, uid: `${item.uid}-${rotations}` })), ...base.market.slice(3)];
  const game: GameState = { ...base, market };
  const effectivePendingUid = pendingUid === "__first__" ? game.market[0]?.uid ?? null : pendingUid;

  const context: ActionContext = {
    game,
    me,
    legal: room.legal_actions ?? [],
    pending: effectivePendingUid ? { type: "buy_asset", payload: { market_uid: effectivePendingUid } } : undefined,
  };

  const tight = size.h < 820;

  return (
    <div className="relative">
      <BoardView
        game={game}
        meta={meta}
        context={context}
        onAction={(action: LegalAction) =>
          window.alert(`Отправили бы на сервер:\n${JSON.stringify(action, null, 2)}`)
        }
        busy={busy}
        error={error}
        onExit={() => window.alert("Выход в комнаты")}
        chat={chat}
        onChat={text => say(ME, "Вы", text)}
        /* `?layout=mobile` — мобильный стол в окне браузера, без эмуляции телефона; `?layout=wide` —
         * широкий стол, даже если экран по размеру похож на телефон (безголовый браузер). Настоящий
         * масштаб и экран «поверните устройство» видны только в режиме устройства DevTools. */
        layout={query.get("layout") === "mobile" ? "mobile" : query.get("layout") === "wide" ? "wide" : undefined}
      />

      {/* Пульт галереи. Поверх доски, чтобы не искажать её раскладку. */}
      <div className="ui-v2 fixed bottom-2 left-1/2 z-30 -translate-x-1/2 font-sans">
        {panel ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line-2
            bg-panel px-2.5 py-2">
            <b className="text-2xs uppercase tracking-wide text-ink-dim">Сценарий</b>
            {names.map(item => (
              <button
                key={item}
                onClick={() => setName(item)}
                className={`rounded-md border px-2 py-1 text-3xs ${
                  item === name
                    ? "border-accent bg-panel-3 text-ink"
                    : "border-line bg-panel-2 text-ink-muted hover:border-line-2"
                }`}
              >
                {item}
              </button>
            ))}

            <span className="mx-1 h-4 w-px bg-line-2" />

            <button
              onClick={() => setPendingUid(current => (current ? null : game.market[0]?.uid ?? null))}
              className={`rounded-md border px-2 py-1 text-3xs ${
                pendingUid ? "border-accent bg-panel-3 text-ink" : "border-line bg-panel-2 text-ink-muted"
              }`}
            >
              покупка в полёте
            </button>
            <button
              onClick={() => setRotations(value => value + 1)}
              className="rounded-md border border-line bg-panel-2 px-2 py-1 text-3xs text-ink-muted
                hover:border-line-2"
            >
              🔄 прокрутить рынок
            </button>
            <button
              onClick={() => setBusy(value => !value)}
              className={`rounded-md border px-2 py-1 text-3xs ${
                busy ? "border-accent bg-panel-3 text-ink" : "border-line bg-panel-2 text-ink-muted"
              }`}
            >
              боты ходят
            </button>
            <button
              onClick={() => setError(value => (value ? "" : "Команда не выполнена: ревизия устарела"))}
              className={`rounded-md border px-2 py-1 text-3xs ${
                error ? "border-accent bg-panel-3 text-ink" : "border-line bg-panel-2 text-ink-muted"
              }`}
            >
              ошибка
            </button>

            <span className="mx-1 h-4 w-px bg-line-2" />

            <span
              className={`rounded-full px-2 py-0.5 text-3xs ${
                tight ? "bg-[#3a2d12] text-gold" : "bg-panel-2 text-ink-muted"
              }`}
            >
              {size.w}×{size.h}
              {tight ? " · центр скроллится" : " · влезает целиком"}
            </span>
            <button
              onClick={() => setPanel(false)}
              className="rounded-md border border-line bg-panel-2 px-2 py-1 text-3xs text-ink-dim"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPanel(true)}
            className="rounded-full border border-line-2 bg-panel px-3 py-1.5 text-3xs text-ink-muted"
          >
            ⚙ пульт галереи
          </button>
        )}
      </div>
    </div>
  );
}
