// Left panel: one card per player showing money, experience, role, status.
import type { GameState, PlayerState, RoleMeta } from "../types";

interface Props {
  state: GameState;
  roles: RoleMeta[];
  playerColors: Record<string, string>;
}

export function PlayerPanel({ state, roles, playerColors }: Props) {
  const roleTitle = (roleId: string | null) =>
    roles.find((r) => r.id === roleId)?.title ?? "без роли";

  return (
    <div className="panel">
      <h2>Игроки</h2>
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
              {isCurrent && <span className="badge current-badge">ход</span>}
            </div>
            <div className="player-stats">
              <span>💰 {p.money}$</span>
              <span>🎓 {p.experience}</span>
              <span>🏷️ {roleTitle(p.role)}</span>
            </div>
            <div className="player-stats secondary">
              <span>Круг {p.ring + 1}</span>
              <span>Скандалы: {p.scandals}</span>
              <span title={`Крыша: ${p.roofs}`}>
                Крыша: {p.roofs > 0 ? "🎖️".repeat(p.roofs) : "—"}
              </span>
              <span>Капитал: {state.net_worth[p.id]}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
