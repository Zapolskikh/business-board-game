// Compact "whose turn is it, and what did they roll?" panel, shown right under the
// players. Surfaces the current player, the phase, and the last dice value so the
// board state is easy to read at a glance during playtesting.
import type { GameState, RoleMeta } from "../types";

interface Props {
  state: GameState;
  roles: RoleMeta[];
  playerColors: Record<string, string>;
}

const PHASE_LABEL: Record<GameState["phase"], string> = {
  await_roll: "ждём бросок кубика",
  await_decision: "ждём решение",
  game_over: "игра окончена",
};

// Unicode die faces for 1..6 (index 0 unused).
const DIE_FACES = ["·", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export function TurnStatus({ state, roles, playerColors }: Props) {
  const current = state.players.find((p) => p.id === state.current_player_id);
  const roleTitle = (roleId: string | null) =>
    roles.find((r) => r.id === roleId)?.title ?? "без роли";

  // Show the dice only when it belongs to the player currently on turn (so a stale
  // value from a previous player isn't misleading).
  const showDie =
    state.last_die != null && state.last_die_player_id === state.current_player_id;
  const roller = state.players.find((p) => p.id === state.last_die_player_id);

  const color = current ? playerColors[current.id] : "var(--border)";

  return (
    <div className="panel turn-status" style={{ borderLeftColor: color }}>
      <h2>Ход</h2>
      {state.phase === "game_over" ? (
        <p className="ts-current">Игра окончена</p>
      ) : (
        <>
          <div className="ts-current">
            <span className="dot" style={{ background: color }} />
            <strong>{current?.name ?? "—"}</strong>
            {current?.is_bot && <span className="badge">бот</span>}
            <span className="ts-role">{roleTitle(current?.role ?? null)}</span>
          </div>
          <div className="ts-meta">
            <span>Раунд {state.round_number + 1}</span>
            <span>Ход №{state.turn_number + 1}</span>
            <span className="ts-phase">{PHASE_LABEL[state.phase]}</span>
          </div>
        </>
      )}

      <div className="ts-dice">
        <span className={`die-face${showDie ? " rolled" : " empty"}`}>
          {showDie ? DIE_FACES[state.last_die as number] : "🎲"}
        </span>
        <span className="die-caption">
          {showDie
            ? `Выпало: ${state.last_die} (${roller?.name ?? "—"})`
            : "Кубик ещё не брошен"}
        </span>
      </div>
    </div>
  );
}
