import { useEffect, useState } from "react";
import type { GameState, LegalAction, MarketAsset } from "../../online/types";
import { BoardView } from "../board/Board";
import type { ActionContext } from "../lib/actions";
import { ME, meta, scenarios, type ScenarioName } from "./fixtures";
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

const spares: MarketAsset[] = [
  { uid: "n-1", card_id: "insurance", price: 7 },
  { uid: "n-2", card_id: "coworking", price: 5 },
  { uid: "n-3", card_id: "city_ecosystem", price: 16, leaving: true },
];

export function Gallery() {
  const [name, setName] = useState<ScenarioName>(names[1]);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [rotations, setRotations] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [panel, setPanel] = useState(true);

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

  const context: ActionContext = {
    game,
    me,
    legal: room.legal_actions ?? [],
    pending: pendingUid ? { type: "buy_asset", payload: { market_uid: pendingUid } } : undefined,
  };

  const tight = size.h < 820;

  return (
    <div className="relative">
      <BoardView
        game={game}
        meta={meta}
        roomName="фикстура"
        context={context}
        onAction={(action: LegalAction) =>
          window.alert(`Отправили бы на сервер:\n${JSON.stringify(action, null, 2)}`)
        }
        busy={busy}
        error={error}
        onExit={() => window.alert("Выход в комнаты")}
      />

      {/* Пульт галереи. Поверх доски, чтобы не искажать её раскладку. */}
      <div className="ui-v2 fixed bottom-2 left-1/2 z-30 -translate-x-1/2 font-sans">
        {panel ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line-2
            bg-panel/95 px-2.5 py-2 shadow-[0_16px_40px_#000a] backdrop-blur">
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
            className="rounded-full border border-line-2 bg-panel/95 px-3 py-1.5 text-3xs text-ink-muted
              shadow-[0_16px_40px_#000a]"
          >
            ⚙ пульт галереи
          </button>
        )}
      </div>
    </div>
  );
}
