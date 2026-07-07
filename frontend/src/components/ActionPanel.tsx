// Right panel: the action area. Shows either the "roll dice" button, the pending
// decision's options, or the game-over banner. A bot's turn can be auto-advanced.
import { CANCEL_OPTION, MAP_PICK, type GameState, type MapPickContext, type RoleMeta } from "../types";

interface Props {
  state: GameState;
  roles: RoleMeta[];
  busy: boolean;
  // The cell currently selected on the map (drives map-pick confirmation).
  selectedCell: string | null;
  onRoll: () => void;
  onResolve: (optionId: string) => void;
}

export function ActionPanel({ state, roles, busy, selectedCell, onRoll, onResolve }: Props) {
  const current = state.players.find((p) => p.id === state.current_player_id);
  const roleTitle = (roleId: string | null) =>
    roles.find((r) => r.id === roleId)?.title ?? "без роли";

  if (state.phase === "game_over") {
    const winner = state.players.find((p) => p.id === state.winner_id);
    return (
      <div className="panel action-panel">
        <h2>Игра окончена</h2>
        <p className="winner">🏆 Победитель: {winner?.name ?? "—"}</p>
        <p>Капитал: {winner ? state.net_worth[winner.id] : "—"}</p>
      </div>
    );
  }

  const pd = state.pending_decision;
  const isMapPick = pd?.type === MAP_PICK;
  // A decision may be addressed to a player other than the current one (auction
  // bids). The action buttons + bot auto-play follow whoever must act now.
  const actorId = pd ? pd.player_id : state.current_player_id;
  const actor = state.players.find((p) => p.id === actorId);
  const addressedElsewhere = !!pd && pd.player_id !== state.current_player_id;

  return (
    <div className="panel action-panel">
      <h2>Действие</h2>
      <p className="turn-info">
        Ход: <strong>{current?.name}</strong> ({roleTitle(current?.role ?? null)})
        <br />
        Раунд {state.round_number + 1}
      </p>

      {addressedElsewhere && (
        <p className="addressee">
          Отвечает: <strong>{actor?.name ?? "—"}</strong> ({roleTitle(actor?.role ?? null)})
        </p>
      )}

      {actor?.is_bot && (
        <p className="bot-playing">🤖 Ход бота — играет автоматически…</p>
      )}

      {state.phase === "await_roll" && (
        <button className="btn primary" onClick={onRoll} disabled={busy}>
          🎲 Бросить кубик
        </button>
      )}

      {state.phase === "await_decision" && pd && !isMapPick && (
        <div className="decision">
          <p className="prompt">{pd.prompt}</p>
          <div className="options">
            {pd.options.map((opt) => (
              <button
                key={opt.id}
                className="btn option"
                onClick={() => onResolve(opt.id)}
                disabled={busy}
                title={opt.hint || undefined}
              >
                {opt.rolls_dice && <span className="dice-badge" aria-label="бросок кубика">🎲</span>}
                {opt.label}
                {opt.hint && <span className="opt-hint">{opt.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.phase === "await_decision" && pd && isMapPick && (
        <MapPickControls
          ctx={pd.context as unknown as MapPickContext}
          prompt={pd.prompt}
          selectedCell={selectedCell}
          busy={busy}
          isBot={!!current?.is_bot}
          onResolve={onResolve}
        />
      )}
    </div>
  );
}

// Confirm / cancel controls for a "pick a cell on the map" decision. The confirm
// button is green only when an *affordable* candidate is selected; unaffordable
// selections show a grey "Недостаточно средств" button, and picking too expensive
// an object never wastes the turn — the player can always cancel or reselect.
function MapPickControls({
  ctx,
  prompt,
  selectedCell,
  busy,
  isBot,
  onResolve,
}: {
  ctx: MapPickContext;
  prompt: string;
  selectedCell: string | null;
  busy: boolean;
  isBot: boolean;
  onResolve: (optionId: string) => void;
}) {
  const candidates = ctx.candidates ?? {};
  const selected = selectedCell ? candidates[selectedCell] : undefined;

  let confirmLabel = ctx.confirm_label ?? "Подтвердить";
  let confirmClass = "btn primary";
  let confirmDisabled = true;
  if (isBot) {
    confirmLabel = "Ход бота — играет автоматически…";
    confirmClass = "btn";
  } else if (!selectedCell) {
    confirmLabel = "Выберите клетку на карте";
    confirmClass = "btn";
  } else if (!selected) {
    confirmLabel = "Эта клетка недоступна";
    confirmClass = "btn";
  } else if (!selected.affordable) {
    confirmLabel = "Недостаточно средств";
    confirmClass = "btn insufficient";
  } else {
    confirmDisabled = false;
    confirmClass = "btn primary";
  }

  return (
    <div className="decision map-pick">
      <p className="prompt">{prompt}</p>
      <p className="hint">Подсвечены клетки, куда можно выбрать. Кликните клетку, затем подтвердите.</p>
      <div className="options">
        <button
          className={confirmClass}
          disabled={busy || confirmDisabled}
          onClick={() => selectedCell && onResolve(selectedCell)}
        >
          {confirmLabel}
        </button>
        <button className="btn option" disabled={busy} onClick={() => onResolve(CANCEL_OPTION)}>
          {ctx.cancel_label ?? "Отмена"}
        </button>
      </div>
    </div>
  );
}

