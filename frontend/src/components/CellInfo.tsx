// Detailed panel for the currently selected cell, shown full-width *below* the
// board. It is intentionally verbose ("максимально подробно для тестов"): the base
// effect, the per-ring economy numbers, and what the cell means for every role —
// with the current player's role highlighted.
import type { CellState, Economy, GameState, MapCandidateInfo, Meta } from "../types";

interface Props {
  state: GameState;
  meta: Meta;
  selectedCell: string | null;
  // When a map-pick is in progress, the affordability info for the selected cell.
  candidate?: MapCandidateInfo | null;
}

interface EcoRow {
  label: string;
  values: number[];
}
interface EcoScalar {
  label: string;
  value: string;
}

// Ring-indexed balance numbers relevant to a given cell type.
function economyRows(type: string, eco: Economy): EcoRow[] {
  const rows: EcoRow[] = [];
  const push = (label: string, values?: number[]) => {
    if (Array.isArray(values)) rows.push({ label, values });
  };
  switch (type) {
    case "start":
      push("Бонус за проход, $", eco.start_bonus);
      push("Опыт за проход", eco.start_experience);
      push("Опыта нужно для круга", eco.promotion?.experience_required);
      break;
    case "taxi":
      push("Цена поездки, $", eco.taxi?.price);
      break;
    case "station":
      push("Стоимость проезда, $", eco.station?.fare);
      push("Цена вокзала, $", eco.prices?.station);
      break;
    case "casino":
      push("Цена казино, $", eco.prices?.casino);
      break;
    case "newspaper":
      push("Цена газеты, $", eco.prices?.newspaper);
      break;
    case "auction":
      push("Мин. ставка, $", eco.auction?.min_bid);
      break;
    case "military":
      push("Цена крыши, $", eco.roof_price);
      break;
    case "food":
      push("Цена объекта, $", eco.prices?.food);
      push("Аренда владельцу, $", eco.rent?.food);
      break;
    case "dormitory":
      push("Цена объекта, $", eco.prices?.dormitory);
      push("Аренда владельцу, $", eco.rent?.dormitory);
      break;
  }
  return rows;
}

function economyScalars(type: string, eco: Economy): EcoScalar[] {
  const out: EcoScalar[] = [];
  if (type === "station" && eco.station?.capitalist_buyout_multiplier != null) {
    out.push({ label: "Выкуп капиталистом", value: `×${eco.station.capitalist_buyout_multiplier}` });
  }
  if (type === "auction" && eco.auction) {
    out.push({ label: "Старт от номинала", value: `${Math.round(eco.auction.start_fraction * 100)}%` });
    out.push({ label: "Шаг ставки", value: `${Math.round(eco.auction.increment_fraction * 100)}% номинала` });
  }
  return out;
}

export function CellInfo({ state, meta, selectedCell, candidate }: Props) {
  if (!selectedCell) {
    return (
      <div className="panel cell-info muted">
        <h2>Информация о клетке</h2>
        <p className="hint">Кликните клетку на поле, чтобы увидеть подробности для тестов.</p>
      </div>
    );
  }
  const cell: CellState | undefined = state.board.rings.flat().find((c) => c.id === selectedCell);
  if (!cell) return null;

  const cellMeta = meta.cells[cell.type];
  const effect = meta.cell_effects[cell.type];
  const eco = meta.economy;
  const owner = state.players.find((p) => p.id === cell.owner_id);
  const current = state.players.find((p) => p.id === state.current_player_id);
  const currentRoleId = current?.role ?? null;

  const rows = economyRows(cell.type, eco);
  const scalars = economyScalars(cell.type, eco);
  const numRings = state.board.rings.length;

  return (
    <div className="panel cell-info">
      <div className="ci-head">
        <span className="ci-swatch" style={{ background: cellMeta?.color ?? "#30363d" }} />
        <h2>{cell.title || cellMeta?.title || cell.type}</h2>
        <code className="ci-id">{cell.id}</code>
      </div>

      <div className="player-stats secondary ci-basics">
        <span>Круг {cell.ring + 1}</span>
        <span>Тип: {cell.type}</span>
        <span>{cell.buyable ? "покупаемая" : "не покупается"}</span>
        {cell.buyable && <span>Цена: {cell.price}$</span>}
        {cell.buyable && <span>Владелец: {owner?.name ?? "свободно"}</span>}
      </div>

      {cellMeta?.ring_titles?.length ? (
        <p className="ci-ring-titles">
          По кругам:{" "}
          {cellMeta.ring_titles.map((t, r) => (
            <span key={r} className={r === cell.ring ? "cur" : ""}>
              {r > 0 ? " → " : ""}
              {t}
            </span>
          ))}
        </p>
      ) : null}

      {candidate && (
        <p className={`afford ${candidate.affordable ? "ok" : "bad"}`}>
          {candidate.cost > 0 ? `Стоимость: ${candidate.cost}$ — ` : ""}
          {candidate.affordable ? "доступно" : "недостаточно средств"}
        </p>
      )}

      {effect?.base && <p className="ci-base">{effect.base}</p>}

      {(rows.length > 0 || scalars.length > 0) && (
        <div className="ci-section">
          <h3>Экономика по кругам</h3>
          {rows.length > 0 && (
            <table className="eco-table">
              <thead>
                <tr>
                  <th></th>
                  {Array.from({ length: numRings }, (_, r) => (
                    <th key={r} className={r === cell.ring ? "cur" : ""}>
                      Круг {r + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td className="eco-label">{row.label}</td>
                    {Array.from({ length: numRings }, (_, r) => (
                      <td key={r} className={r === cell.ring ? "cur" : ""}>
                        {row.values[r] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {scalars.length > 0 && (
            <ul className="eco-scalars">
              {scalars.map((s) => (
                <li key={s.label}>
                  <span>{s.label}:</span> <strong>{s.value}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="ci-section">
        <h3>Эффекты по ролям</h3>
        <ul className="role-effects">
          {meta.roles.map((role) => {
            const text = effect?.roles?.[role.id];
            const isCurrent = role.id === currentRoleId;
            return (
              <li key={role.id} className={`role-effect${isCurrent ? " current" : ""}`}>
                <span className="re-dot" style={{ background: role.color }} />
                <span className="re-title">{role.title}</span>
                {isCurrent && <span className="badge current-badge">вы</span>}
                <span className={`re-text${text ? "" : " none"}`}>
                  {text ?? "без особого эффекта — как у всех"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {cellMeta?.tags?.length ? (
        <p className="tags">Тэги: {cellMeta.tags.join(", ")}</p>
      ) : null}
    </div>
  );
}
