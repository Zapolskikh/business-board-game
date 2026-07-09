// Root component. Owns the game state, loads static meta, and orchestrates the
// board + panels. Keeps logic thin: every rule lives on the backend; this just
// sends actions and re-renders the returned state.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PlayerInput } from "./api";
import { Board } from "./components/Board";
import { PlayerPanel } from "./components/PlayerPanel";
import { ActionPanel } from "./components/ActionPanel";
import { CellInfo } from "./components/CellInfo";
import { EventLog } from "./components/EventLog";
import { Chat } from "./components/Chat";
import { GameSetup } from "./components/GameSetup";
import { SimPanel } from "./components/SimPanel";
import { Faq } from "./components/Faq";
import {
  CANCEL_OPTION,
  MAP_PICK,
  type ChatMessage,
  type GameEvent,
  type GameState,
  type MapCandidateInfo,
  type MapPickContext,
  type Meta,
  type PlayerMovedData,
} from "./types";

// Distinct token colours for up to 6 players.
const PLAYER_PALETTE = ["#58a6ff", "#f778ba", "#3fb950", "#e3b341", "#bc8cff", "#ff7b72"];

// Cell types the bot avoids when making map-pick choices (taxi, station travel).
const NEGATIVE_CELL_TYPES = new Set([
  "checkpoint", "ambush", "money_minus", "scandal_plus", "role_loss", "experience_loss",
]);

// Per-room identity is remembered in localStorage so a refresh keeps your seat
// (keyed by game id, so a new room always asks again).
const seatKey = (gameId: string) => `bbg:seat:${gameId}`;
const hostKey = (gameId: string) => `bbg:host:${gameId}`;

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState("board_72");
  const [showFaq, setShowFaq] = useState(false);
  // Multiplayer identity for the single shared room. `mySeat`: undefined = not
  // yet decided (show the seat picker), null = spectator, string = the player id
  // I control. `isHost`: I created the room, so this browser drives the bots.
  const [mySeat, setMySeat] = useState<string | null | undefined>(undefined);
  const [isHost, setIsHost] = useState(false);
  // Host clicked "new game": suppress room auto-join so the setup screen shows.
  const [forceSetup, setForceSetup] = useState(false);
  // Whether the backend has a shared KV store (multiplayer works across devices).
  const [persistent, setPersistent] = useState(true);
  // Seq of the most recent move we already animated — stops polling from
  // re-triggering the same walk animation on every refresh.
  const lastAnimatedSeq = useRef<number>(-1);

  useEffect(() => {
    api.getMeta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  const playerColors = useMemo(() => {
    const colors: Record<string, string> = {};
    state?.players.forEach((p, i) => (colors[p.id] = PLAYER_PALETTE[i % PLAYER_PALETTE.length]));
    return colors;
  }, [state]);

  // When a "pick a cell on the map" decision is pending, expose its candidate
  // cells so the board can highlight them and the panel can confirm/cancel.
  const pending = state?.pending_decision ?? null;
  const mapPick: MapPickContext | null =
    pending?.type === MAP_PICK ? (pending.context as unknown as MapPickContext) : null;
  const candidates: Record<string, MapCandidateInfo> | null = mapPick?.candidates ?? null;
  const selectedCandidate: MapCandidateInfo | null =
    mapPick && selectedCell ? mapPick.candidates[selectedCell] ?? null : null;

  // Clear the map selection each time a fresh map-pick decision arrives.
  useEffect(() => {
    if (pending?.type === MAP_PICK) setSelectedCell(null);
  }, [pending]);

  // The most recent token move, fed to the board to drive the walk animation.
  // `seq` (the event index) guarantees the effect re-fires even for repeat moves.
  const recentMove: PlayerMovedData | null = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "player_moved") {
        return { seq: events[i].seq ?? i, ...(events[i].data as Omit<PlayerMovedData, "seq">) };
      }
    }
    return null;
  }, [events]);

  // Blink the cell that requires interaction: the auction object, or the cell
  // the current player is standing on while making a decision.
  const blinkCellId: string | null = useMemo(() => {
    const pd = state?.pending_decision;
    if (!pd) return null;
    if (pd.handler === "auction" && typeof pd.context?.object_id === "string") {
      return pd.context.object_id as string;
    }
    if (pd.cell_id) return pd.cell_id;
    return null;
  }, [state]);

  // Last meaningful event shown in the board center (skip raw movement noise).
  const centerEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== "player_moved" && e.message) {
        return { message: e.message, player_id: e.player_id };
      }
    }
    return null;
  }, [events]);

  // Adopt a fresh authoritative state — from our own action OR from polling.
  // Events come from the server log tail (state.log) so every client (the actor,
  // other players, spectators) shows the same narrative and animates each token
  // move exactly once. We commit positions one frame after the events so the walk
  // animation starts from the OLD position instead of snapping to the target.
  const adopt = useCallback((s: GameState) => {
    const log = s.log && s.log.length ? s.log : null;
    const nextEvents: GameEvent[] = log ?? [
      { type: "game_start", message: "Игра создана. Ждём ходов…", player_id: null, data: {} },
    ];
    let move: GameEvent | null = null;
    for (let i = nextEvents.length - 1; i >= 0; i--) {
      if (nextEvents[i].type === "player_moved") {
        move = nextEvents[i];
        break;
      }
    }
    const moveSeq = move?.seq ?? -1;
    const isNewMove = !!move && moveSeq !== lastAnimatedSeq.current;

    setEvents(nextEvents);
    if (s.chat) setChat(s.chat);
    if (isNewMove && move) {
      lastAnimatedSeq.current = moveSeq;
      window.requestAnimationFrame(() => {
        setState(s);
        if (s.pending_decision?.type !== MAP_PICK) {
          const d = move!.data as unknown as PlayerMovedData;
          setSelectedCell(`r${d.to_ring}s${d.to_slot}`);
        }
      });
    } else {
      setState(s);
    }
  }, []);

  // Load my saved identity (seat + host flag) for a given room from localStorage.
  const loadSeatFor = useCallback((gameId: string) => {
    setIsHost(localStorage.getItem(hostKey(gameId)) === "1");
    const seat = localStorage.getItem(seatKey(gameId));
    setMySeat(seat === null ? undefined : seat === "spectator" ? null : seat);
  }, []);

  // Claim a seat (or choose to spectate) and remember it for this room.
  const chooseSeat = (playerId: string | null) => {
    if (!state) return;
    localStorage.setItem(seatKey(state.game_id), playerId ?? "spectator");
    setMySeat(playerId);
  };

  const startGame = async (
    players: PlayerInput[],
    boardName: string,
    seed?: number,
    config?: Record<string, unknown>,
  ) => {
    setBusy(true);
    setError(null);
    setBoard(boardName);
    try {
      const s = await api.createRoom(players, boardName, seed, config);
      // I created the room: become host (drive the bots) and take the first human
      // seat automatically. Everyone else who opens the site joins this same room.
      localStorage.setItem(hostKey(s.game_id), "1");
      const firstHuman = s.players.find((p) => !p.is_bot);
      localStorage.setItem(seatKey(s.game_id), firstHuman ? firstHuman.id : "spectator");
      setIsHost(true);
      setMySeat(firstHuman ? firstHuman.id : null);
      setForceSetup(false);
      lastAnimatedSeq.current = -1;
      adopt(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async (action: string, payload?: Record<string, unknown>) => {
    // Only the player a turn/decision is addressed to may act; spectators never.
    if (!state || !mySeat) return;
    const pd = state.pending_decision;
    const actorId = pd ? pd.player_id : state.current_player_id;
    if (actorId !== mySeat) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.action(state.game_id, mySeat, action, payload);
      adopt(res.state);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async (text: string) => {
    if (!state || !mySeat) return;
    try {
      await api.chat(state.game_id, mySeat, text);
      // Optimistically add the message locally; polling will sync others.
      const me = state.players.find((p) => p.id === mySeat);
      setChat((prev) => [
        ...prev,
        { player_id: mySeat, name: me?.name ?? mySeat, text, idx: prev.length },
      ]);
    } catch {
      /* ignore chat errors silently */
    }
  };

  // Who is expected to act right now, and whether that is me or a bot.
  const actorId = state?.pending_decision
    ? state.pending_decision.player_id
    : state?.current_player_id ?? null;
  const actorPlayer = state?.players.find((p) => p.id === actorId) ?? null;
  const isBotTurn = !!actorPlayer?.is_bot;
  const isMyTurn = !!mySeat && actorId === mySeat && !isBotTurn;

  // While NOT in a game, watch the shared room: as soon as the host creates it,
  // everyone already on the page is pulled into that same game automatically.
  useEffect(() => {
    if (state || forceSetup) return;
    let stop = false;
    const check = async () => {
      try {
        const room = await api.getRoom();
        if (stop) return;
        setPersistent(room.persistent);
        if (room.game_id) {
          loadSeatFor(room.game_id);
          const s = await api.getGame(room.game_id);
          if (!stop) {
            lastAnimatedSeq.current = -1;
            adopt(s);
          }
        }
      } catch {
        /* ignore transient errors — keep showing setup */
      }
    };
    check();
    const timer = window.setInterval(check, 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [state, forceSetup, adopt, loadSeatFor]);

  // Poll the shared state so all clients stay in sync. The party that must act
  // (me on my turn, the host for a bot turn) is deliberately NOT polled, so the
  // refresh never resets the bot timer or clobbers an optimistic update. Also
  // detects a room change (host started a new game) and switches to it.
  useEffect(() => {
    if (!state) return;
    const gameId = state.game_id;
    const gameOver = state.phase === "game_over";
    const iAmDriving = isMyTurn || (isHost && isBotTurn);
    if (iAmDriving || gameOver || busy) return;
    let stop = false;
    const tick = async () => {
      try {
        const room = await api.getRoom();
        if (stop) return;
        const targetId = room.game_id && room.game_id !== gameId ? room.game_id : gameId;
        if (targetId !== gameId) {
          loadSeatFor(targetId);
          lastAnimatedSeq.current = -1;
        }
        const s = await api.getGame(targetId);
        if (!stop) adopt(s);
      } catch {
        /* ignore transient errors */
      }
    };
    const timer = window.setInterval(tick, 1500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [state, isMyTurn, isBotTurn, isHost, busy, adopt, loadSeatFor]);

  // Bots play automatically: whenever the actor whose turn/decision it is happens
  // to be a bot, schedule its single next action after a short, watchable delay
  // (so token movement and dice rolls are visible). The effect re-runs after each
  // state change, stepping the bot forward until a human must act. Add a second
  // human player in setup if you want to control more than one seat.
  // Bots play automatically, but only the HOST browser drives them (otherwise
  // every open tab would try to make the same bot move and race each other).
  // Non-host clients simply observe the result via polling. If the host leaves,
  // the bots stop — an acceptable trade-off for this prototype.
  useEffect(() => {
    if (!isHost) return;
    if (!state || busy || state.phase === "game_over") return;
    const s = state;
    const botActorId = s.pending_decision ? s.pending_decision.player_id : s.current_player_id;
    const botActor = s.players.find((p) => p.id === botActorId);
    if (!botActor?.is_bot) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      let action: string;
      let payload: Record<string, unknown> | undefined;
      if (s.phase === "await_roll") {
        action = "roll_dice";
      } else if (s.phase === "await_decision" && s.pending_decision) {
        action = "resolve_decision";
        const isMapPick = s.pending_decision.type === MAP_PICK;
        payload = { option_id: pickBotOption(s.pending_decision.options.map((o) => o.id), s, isMapPick) };
      } else {
        return;
      }
      setBusy(true);
      try {
        const res = await api.action(s.game_id, botActor.id, action, payload);
        // Extra pause after the action so the player can read what happened
        // before the board updates to the next bot turn.
        await new Promise((r) => window.setTimeout(r, 900));
        adopt(res.state);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 1400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy, isHost]);

  if (!meta) {
    return <div className="loading">{error ? `Ошибка: ${error}` : "Загрузка…"}</div>;
  }

  if (!state) {
    return (
      <div className="app">
        <p className="room-hint">
          🟢 Общая комната: все, кто откроют этот адрес, попадут в одну игру.
          {!persistent && " (локальный режим — общая память только внутри одного процесса)"}
        </p>
        <GameSetup busy={busy} onStart={startGame} />
        <SimPanel board={board} />
        {error && <p className="error banner">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app game">
      <header className="topbar">
        <h1 className="topbar-title">Сатирическая бизнес-игра</h1>
        <div className="topbar-actions">
          <IdentityBadge
            state={state}
            mySeat={mySeat}
            isHost={isHost}
            color={mySeat ? playerColors[mySeat] : undefined}
            onChange={() => setMySeat(undefined)}
          />
          <button className="btn small ghost" onClick={() => setShowFaq(true)}>
            📖 Справочник
          </button>
          {isHost && (
            <button
              className="btn small"
              onClick={() => {
                setForceSetup(true);
                setState(null);
              }}
            >
              ← Новая игра
            </button>
          )}
        </div>
      </header>

      {showFaq && <Faq meta={meta} onClose={() => setShowFaq(false)} />}

      {mySeat === undefined && (
        <SeatPicker state={state} colors={playerColors} onPick={chooseSeat} />
      )}

      {error && <p className="error banner">{error}</p>}

      <div className="layout">
        <aside className="col-left">
          <PlayerPanel state={state} roles={meta.roles} playerColors={playerColors} mySeat={mySeat ?? null} />
          {state.last_die != null && (() => {
            const roller = state.players.find((p) => p.id === state.last_die_player_id);
            const faces = ["·", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
            return (
              <div className="last-die-panel" style={{ borderLeftColor: roller ? playerColors[roller.id] : "var(--border)" }}>
                <span className="die-face">{faces[state.last_die] ?? state.last_die}</span>
                <span className="die-info">{roller?.name} → <strong>{state.last_die}</strong></span>
              </div>
            );
          })()}
          <ActionPanel
            state={state}
            roles={meta.roles}
            busy={busy}
            canAct={isMyTurn}
            selectedCell={selectedCell}
            cards={meta.question_cards}
            onRoll={() => send("roll_dice")}
            onResolve={(optionId) => send("resolve_decision", { option_id: optionId })}
            onUseCard={(cardId) => send("use_card", { card_id: cardId })}
          />
        </aside>

        <main className="col-center">
          <div className="turn-indicator">
            <span className="ti-round">
              Раунд <strong>{state.round_number + 1}</strong> / {state.victory.max_turns}
            </span>
            <span className="ti-sep">·</span>
            <span className="ti-turn">Ход №{state.turn_number + 1}</span>
            <span className="ti-sep">·</span>
            <span className="ti-goal">Цель: капитал ≥ {state.victory.target_net_worth}$</span>
          </div>
          <div className="board-area">
            <Board
              board={state.board}
              players={state.players}
              meta={meta.cells}
              economy={meta.economy}
              selectedCellId={selectedCell}
              onSelectCell={setSelectedCell}
              playerColors={playerColors}
              candidates={candidates}
              recentMove={recentMove}
              blinkingCellId={blinkCellId}
              centerEvent={centerEvent}
            />
          </div>
          <div className="bottom-row">
            <div className="bottom-log">
              <EventLog events={events} />
            </div>
            <Chat
              messages={chat}
              players={state.players}
              mySeat={mySeat ?? null}
              playerColors={playerColors}
              onSend={sendChat}
            />
          </div>
        </main>

        <aside className="col-right">
          <CellInfo
            state={state}
            meta={meta}
            selectedCell={selectedCell}
            candidate={selectedCandidate}
          />
        </aside>
      </div>
    </div>
  );
}

// For regular decisions, pick at random. For MAP_PICK decisions, prefer cells
// that are not in the known-negative list (checkpoint, ambush, etc.).
function pickBotOption(ids: string[], state?: GameState, isMapPick?: boolean): string {
  if (!state || !isMapPick || ids.length <= 1) {
    return ids[Math.floor(Math.random() * ids.length)];
  }
  // Build cell-type index from the board.
  const cellType: Record<string, string> = {};
  state.board.rings.flat().forEach((c) => (cellType[c.id] = c.type));
  // Prefer cells that are not negative (keep "cancel" available as last resort).
  const good = ids.filter((id) => id !== CANCEL_OPTION && !NEGATIVE_CELL_TYPES.has(cellType[id] ?? ""));
  const pool = good.length > 0 ? good : ids.filter((id) => id !== CANCEL_OPTION);
  const final = pool.length > 0 ? pool : ids;
  return final[Math.floor(Math.random() * final.length)];
}

// Small badge in the top bar showing which player you control in the shared room
// (or that you are a spectator), with a "change" button to reopen the picker.
function IdentityBadge({
  state,
  mySeat,
  isHost,
  color,
  onChange,
}: {
  state: GameState;
  mySeat: string | null | undefined;
  isHost: boolean;
  color?: string;
  onChange: () => void;
}) {
  const me = mySeat ? state.players.find((p) => p.id === mySeat) : null;
  return (
    <span className="identity-badge" title="Кем вы играете в этой комнате">
      {me ? (
        <>
          <span className="dot" style={{ background: color }} />
          Вы: <strong>{me.name}</strong>
        </>
      ) : (
        <>👁️ Наблюдатель</>
      )}
      {isHost && <span className="badge host-badge">хост</span>}
      <button className="btn tiny ghost" onClick={onChange}>
        сменить
      </button>
    </span>
  );
}

// Full-screen overlay for picking which player you control when joining a room.
// Seats are not reserved server-side (trusted test group), so players just agree
// who takes which — the engine still blocks acting out of turn either way.
function SeatPicker({
  state,
  colors,
  onPick,
}: {
  state: GameState;
  colors: Record<string, string>;
  onPick: (playerId: string | null) => void;
}) {
  const humans = state.players.filter((p) => !p.is_bot);
  return (
    <div className="seat-overlay">
      <div className="seat-picker">
        <h2>Выберите игрока</h2>
        <p className="hint">
          Это общая комната. Займите свободное место или смотрите со стороны.
          Договоритесь, кто за кого — одно место могут занять двое.
        </p>
        <div className="seat-list">
          {humans.map((p) => (
            <button key={p.id} className="btn seat" onClick={() => onPick(p.id)}>
              <span className="dot" style={{ background: colors[p.id] }} />
              {p.name}
            </button>
          ))}
          {humans.length === 0 && (
            <p className="hint">В этой игре нет мест для людей — только боты.</p>
          )}
        </div>
        <button className="btn ghost full-width" onClick={() => onPick(null)}>
          👁️ Наблюдать
        </button>
      </div>
    </div>
  );
}

