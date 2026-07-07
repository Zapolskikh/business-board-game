// Root component. Owns the game state, loads static meta, and orchestrates the
// board + panels. Keeps logic thin: every rule lives on the backend; this just
// sends actions and re-renders the returned state.
import { useEffect, useMemo, useState } from "react";
import { api, type PlayerInput } from "./api";
import { Board } from "./components/Board";
import { PlayerPanel } from "./components/PlayerPanel";
import { ActionPanel } from "./components/ActionPanel";
import { CellInfo } from "./components/CellInfo";
import { EventLog } from "./components/EventLog";
import { GameSetup } from "./components/GameSetup";
import { SimPanel } from "./components/SimPanel";
import { Faq } from "./components/Faq";
import {
  CANCEL_OPTION,
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

// Cell types the bot avoids when making map-pick choices (taxi, station travel).
const NEGATIVE_CELL_TYPES = new Set([
  "checkpoint", "ambush", "money_minus", "scandal_plus", "role_loss", "experience_loss",
]);

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

  // Apply an action result: update state + log, and auto-select the cell
  // a token just landed on so its details show below the board without a click.
  // When the result includes movement, we update events FIRST so the Board
  // animation effect can start from the OLD player position, then we commit the
  // new game state one frame later so the token never snaps to the destination
  // before the hop animation gets a chance to run.
  const applyResult = (res: { events: GameEvent[]; state: GameState }) => {
    const moveEvent = [...res.events].reverse().find((e) => e.type === "player_moved");
    if (moveEvent) {
      // Step 1 – add the events so recentMove.seq changes and animation starts.
      setEvents((prev) => [...prev, ...res.events]);
      // Step 2 – one frame later, commit the new positions and pending decisions.
      window.requestAnimationFrame(() => {
        setState(res.state);
        if (res.state.pending_decision?.type !== MAP_PICK) {
          setSelectedCell(`r${moveEvent.data.to_ring}s${moveEvent.data.to_slot}`);
        }
      });
    } else {
      // No movement – apply everything atomically.
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
        const isMapPick = s.pending_decision.type === MAP_PICK;
        payload = { option_id: pickBotOption(s.pending_decision.options.map((o) => o.id), s, isMapPick) };
      } else {
        return;
      }
      setBusy(true);
      try {
        const res = await api.action(s.game_id, actor.id, action, payload);
        // Extra pause after the action so the player can read what happened
        // before the board updates to the next bot turn.
        await new Promise((r) => window.setTimeout(r, 900));
        applyResult(res);
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
            selectedCell={selectedCell}
            onRoll={() => send("roll_dice")}
            onResolve={(optionId) => send("resolve_decision", { option_id: optionId })}
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
          <EventLog events={events} />
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
