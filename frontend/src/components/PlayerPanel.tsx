// Left panel: one card per player. Auto-scales to fit up to 6 players in a fixed
// area. Current player is indicated by a pulsing border — no separate turn panel.
import type { GameState, PlayerState, RoleMeta } from "../types";

interface Props {
  state: GameState;
  roles: RoleMeta[];
  playerColors: Record<string, string>;
  // The seat this browser controls in a shared game (marked with a "вы" badge).
  mySeat?: string | null;
}

export function PlayerPanel({ state, roles, playerColors, mySeat }: Props) {
  const roleTitle = (roleId: string | null) =>
    roles.find((r) => r.id === roleId)?.title ?? "без роли";
  const n = state.players.length;

  return (
    <div className="players-panel" data-count={n}>
      {state.players.map((p: PlayerState) => {
        const isCurrent = p.id === state.current_player_id;
        return (
          <div
            key={p.id}
            className={`player-card${isCurrent ? " current" : ""}`}
            style={{ borderLeftColor: playerColors[p.id] }}
          >
            <div className="player-head">
              <span className="dot" style={{ background: playerColors[p.id] }} />
              <strong>{p.name}</strong>
              {p.is_bot && <span className="badge">бот</span>}
              {p.id === mySeat && <span className="badge you-badge">вы</span>}
            </div>
            <div className="player-stats">
              <span>💰 {p.money}$</span>
              <span>🎓 {p.experience}</span>
              <span>🏷️ {roleTitle(p.role)}</span>
            </div>
            <div className="player-stats secondary">
              <span>Круг {p.ring + 1}</span>
              <span>Скандалы: {p.scandals}</span>
              <span>Крыша: {p.roofs > 0 ? "🎖️".repeat(p.roofs) : "—"}</span>
              <span>Кредит: {p.loan_payments_left > 0 ? p.loan_payments_left : "—"}</span>
              <span>Карты: {p.cards?.length ?? 0}</span>
              <span>Капитал: {state.net_worth[p.id]}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
