// Root component. Owns the game state, loads static meta, and orchestrates the
// board + panels. Keeps logic thin: every rule lives on the backend; this just
// sends actions and re-renders the returned state.
import { useEffect, useMemo, useState } from "react";
import { api, type PlayerInput } from "./api";
import { Board } from "./components/Board";
import { PlayerPanel } from "./components/PlayerPanel";
import { TurnStatus } from "./components/TurnStatus";
import { ActionPanel } from "./components/ActionPanel";
import { CellInfo } from "./components/CellInfo";
import { EventLog } from "./components/EventLog";
import { GameSetup } from "./components/GameSetup";
import { SimPanel } from "./components/SimPanel";
import { Faq } from "./components/Faq";
import {
  MAP_PICK,
  type GameEvent,
  type GameState,
  type MapCandidateInfo,
  type MapPickContext,
  type Meta,
  type PlayerMovedData,
} from "./types";

// Distinct token colours for up to 6 players.
const PLAYER_PALETTE = ["#58a6ff", "#f778ba", "#3fb950", "#e3b341", "#bc8cff", "#ff7b72"];

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState("board_72");
  const [showFaq, setShowFaq] = useState(false);

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
        return { seq: i, ...(events[i].data as Omit<PlayerMovedData, "seq">) };
      }
    }
    return null;
  }, [events]);

  // The object currently under the hammer — its board cell blinks during bidding.
  const blinkCellId: string | null = useMemo(() => {
    const pd = state?.pending_decision;
    if (pd?.handler === "auction" && typeof pd.context?.object_id === "string") {
      return pd.context.object_id as string;
    }
    return null;
  }, [state]);

  // Apply an action result: update state + log, and (task 7) auto-select the cell
  // a token just landed on so its details show below the board without a click.
  // Skipped during a map-pick, where selection is driven by the user's clicks.
  const applyResult = (res: { events: GameEvent[]; state: GameState }) => {
    setState(res.state);
    setEvents((prev) => [...prev, ...res.events]);
    if (res.state.pending_decision?.type !== MAP_PICK) {
      for (let i = res.events.length - 1; i >= 0; i--) {
        const e = res.events[i];
        if (e.type === "player_moved") {
          setSelectedCell(`r${e.data.to_ring}s${e.data.to_slot}`);
          break;
        }
      }
    }
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
      const s = await api.createGame(players, boardName, seed, config);
      setState(s);
      // Seed the log with a start banner; subsequent events come from actions.
      setEvents([{ type: "game_start", message: "Игра создана.", player_id: null, data: {} }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async (action: string, payload?: Record<string, unknown>) => {
    if (!state) return;
    // A decision is answered by the player it is addressed to (during an auction
    // that is often NOT the current player); everything else is the current turn.
    const actor =
      action === "resolve_decision" && state.pending_decision
        ? state.pending_decision.player_id
        : state.current_player_id;
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.action(state.game_id, actor, action, payload);
      applyResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Bots play automatically: whenever the actor whose turn/decision it is happens
  // to be a bot, schedule its single next action after a short, watchable delay
  // (so token movement and dice rolls are visible). The effect re-runs after each
  // state change, stepping the bot forward until a human must act. Add a second
  // human player in setup if you want to control more than one seat.
  useEffect(() => {
    if (!state || busy || state.phase === "game_over") return;
    const s = state;
    const actorId = s.pending_decision ? s.pending_decision.player_id : s.current_player_id;
    const actor = s.players.find((p) => p.id === actorId);
    if (!actor?.is_bot) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      let action: string;
      let payload: Record<string, unknown> | undefined;
      if (s.phase === "await_roll") {
        action = "roll_dice";
      } else if (s.phase === "await_decision" && s.pending_decision) {
        action = "resolve_decision";
        payload = { option_id: pickBotOption(s.pending_decision.options.map((o) => o.id)) };
      } else {
        return;
      }
      setBusy(true);
      try {
        const res = await api.action(s.game_id, actor.id, action, payload);
        applyResult(res);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 650);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy]);

  if (!meta) {
    return <div className="loading">{error ? `Ошибка: ${error}` : "Загрузка…"}</div>;
  }

  if (!state) {
    return (
      <div className="app">
        <GameSetup busy={busy} onStart={startGame} />
        <SimPanel board={board} />
        {error && <p className="error banner">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app game">
      <header className="topbar">
        <h1>Сатирическая бизнес-игра</h1>
        <div className="topbar-actions">
          <button className="btn small ghost" onClick={() => setShowFaq(true)}>
            📖 Справочник
          </button>
          <button className="btn small" onClick={() => setState(null)}>
            ← Новая игра
          </button>
        </div>
      </header>

      {showFaq && <Faq meta={meta} onClose={() => setShowFaq(false)} />}

      {error && <p className="error banner">{error}</p>}

      <div className="layout">
        <aside className="col-left">
          <PlayerPanel state={state} roles={meta.roles} playerColors={playerColors} />
          <TurnStatus state={state} roles={meta.roles} playerColors={playerColors} />
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
          />
          <CellInfo
            state={state}
            meta={meta}
            selectedCell={selectedCell}
            candidate={selectedCandidate}
          />
        </main>

        <aside className="col-right">
          <ActionPanel
            state={state}
            roles={meta.roles}
            busy={busy}
            selectedCell={selectedCell}
            onRoll={() => send("roll_dice")}
            onResolve={(optionId) => send("resolve_decision", { option_id: optionId })}
          />
          <EventLog events={events} />
        </aside>
      </div>
    </div>
  );
}

// A tiny inline detail panel for the selected cell (kept here to avoid a file for
// a 20-line component).
function pickBotOption(ids: string[]): string {
  return ids[Math.floor(Math.random() * ids.length)];
}
