// Left panel (action area): shows roll-dice / decision options / game-over.
// Redundant turn info (player name, round) is removed — the blinking player card
// in PlayerPanel already shows whose turn it is.
import { CANCEL_OPTION, MAP_PICK, type GameState, type MapPickContext, type QuestionCard, type RoleMeta } from "../types";

interface Props {
  state: GameState;
  roles: RoleMeta[];
  busy: boolean;
  // True only when it is THIS browser's seat to act (roll or resolve). Spectators
  // and players waiting for their turn get disabled controls.
  canAct: boolean;
  selectedCell: string | null;
  cards: QuestionCard[];
  onRoll: () => void;
  onResolve: (optionId: string) => void;
  onUseCard: (cardId: string) => void;
}

export function ActionPanel({ state, roles, busy, canAct, selectedCell, cards, onRoll, onResolve, onUseCard }: Props) {
  if (state.phase === "game_over") {
    const winner = state.players.find((p) => p.id === state.winner_id);
    return (
      <div className="action-panel">
        <p className="winner">🏆 {winner?.name ?? "—"}</p>
        <p className="winner-sub">Капитал: {winner ? state.net_worth[winner.id] : "—"}$</p>
      </div>
    );
  }

  const pd = state.pending_decision;
  const isMapPick = pd?.type === MAP_PICK;
  const actorId = pd ? pd.player_id : state.current_player_id;
  const actor = state.players.find((p) => p.id === actorId);
  const currentHand = actor?.cards ?? [];
  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
  // During auctions the bid request goes to a different player than the active one.
  const addressedElsewhere = !!pd && pd.player_id !== state.current_player_id;

  return (
    <div className="action-panel">
      {addressedElsewhere && (
        <p className="addressee">
          Отвечает: <strong style={{ color: "var(--accent)" }}>{actor?.name ?? "—"}</strong>
        </p>
      )}

      {actor?.is_bot && (
        <p className="bot-playing">🤖 авто…</p>
      )}

      {state.phase === "await_roll" && (
        <>
          {currentHand.length > 0 && (
            <div className="hand-panel">
              <div className="hand-title">Карты в руке</div>
              {currentHand.map((cardId, idx) => {
                const card = cardById[cardId];
                return (
                  <button
                    key={`${cardId}-${idx}`}
                    className="btn option card-btn"
                    onClick={() => onUseCard(cardId)}
                    disabled={busy || !canAct}
                    title={card?.text}
                  >
                    {card?.title ?? cardId}
                    {card?.text && <span className="opt-hint">{card.text}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <button className="btn primary full-width" onClick={onRoll} disabled={busy || !canAct}>
            🎲 Бросить кубик
          </button>
        </>
      )}

      {state.phase === "await_decision" && pd && !isMapPick && (
        <div className="decision">
          <p className="prompt">{pd.prompt}</p>
          <div className="options">
            {pd.options.map((opt) => {
              const roleMeta = opt.role ? roles.find((r) => r.id === opt.role) : null;
              return (
                <button
                  key={opt.id}
                  className="btn option"
                  onClick={() => onResolve(opt.id)}
                  disabled={busy || !canAct}
                  title={opt.hint || undefined}
                >
                  {opt.rolls_dice && <span className="dice-badge">🎲</span>}
                  {opt.label}
                  {roleMeta && (
                    <span className="opt-role-badge" style={{ color: roleMeta.color }}> ({roleMeta.title})</span>
                  )}
                  {opt.hint && <span className="opt-hint">{opt.hint}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {state.phase === "await_decision" && pd && isMapPick && (
        <MapPickControls
          ctx={pd.context as unknown as MapPickContext}
          prompt={pd.prompt}
          selectedCell={selectedCell}
          busy={busy}
          canAct={canAct}
          onResolve={onResolve}
        />
      )}
    </div>
  );
}

// Confirm / cancel controls for a "pick a cell on the map" decision.
function MapPickControls({
  ctx,
  prompt,
  selectedCell,
  busy,
  canAct,
  onResolve,
}: {
  ctx: MapPickContext;
  prompt: string;
  selectedCell: string | null;
  busy: boolean;
  canAct: boolean;
  onResolve: (optionId: string) => void;
}) {
  const candidates = ctx.candidates ?? {};
  const selected = selectedCell ? candidates[selectedCell] : undefined;

  let confirmLabel = ctx.confirm_label ?? "Подтвердить";
  let confirmClass = "btn primary";
  let confirmDisabled = true;
  if (!canAct) {
    confirmLabel = "Сейчас не ваш ход";
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
        <button className="btn option" disabled={busy || !canAct} onClick={() => onResolve(CANCEL_OPTION)}>
          {ctx.cancel_label ?? "Отмена"}
        </button>
      </div>
    </div>
  );
}

