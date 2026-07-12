// New-game setup: choose board size and 2–6 players (human or bot) with an
// optional seed for reproducible games.
import { useState } from "react";
import type { PlayerInput } from "../api";

interface Props {
  busy: boolean;
  onStart: (players: PlayerInput[], board: string, seed?: number, config?: Record<string, unknown>) => void;
}

const DEFAULT_PLAYERS: PlayerInput[] = [
  { name: "Игрок 1", is_bot: false },
  { name: "Бот 2", is_bot: true },
  { name: "Бот 3", is_bot: true },
  { name: "Бот 4", is_bot: true },
];

export function GameSetup({ busy, onStart }: Props) {
  const [players, setPlayers] = useState<PlayerInput[]>(DEFAULT_PLAYERS);
  const [board, setBoard] = useState("board_72");
  const [seed, setSeed] = useState<string>("");
  // Victory conditions (either reaching the capital target OR the round cap ends
  // the game). Defaults mirror the backend balance.json.
  const [targetCapital, setTargetCapital] = useState<string>("4000");
  const [maxRounds, setMaxRounds] = useState<string>("60");
  const [startExperience, setStartExperience] = useState<string>("1");

  const update = (i: number, patch: Partial<PlayerInput>) =>
    setPlayers((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const addPlayer = () =>
    players.length < 6 &&
    setPlayers([...players, { name: `Игрок ${players.length + 1}`, is_bot: true }]);

  const removePlayer = (i: number) =>
    players.length > 2 && setPlayers(players.filter((_, idx) => idx !== i));

  return (
    <div className="setup">
      <h1>Сатирическая бизнес-игра</h1>
      <p className="subtitle">Прототип · 3 круга · борьба за роли · v{__GAME_VERSION__}</p>

      <div className="setup-row">
        <label>
          Поле:
          <select value={board} onChange={(e) => setBoard(e.target.value)}>
            <option value="board_72">board_72 (72 клетки)</option>
            <option value="board_60">board_60 (60 клеток)</option>
          </select>
        </label>
        <label>
          Seed:
          <input
            type="number"
            placeholder="случайно"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </label>
      </div>

      <div className="setup-row">
        <label>
          Опыт за Старт (1-й круг)
          <input type="number" min={0} step={1} value={startExperience} onChange={(e) => setStartExperience(e.target.value)} />
          <small>2-й круг ×2, 3-й ×0</small>
        </label>
        <label>
          Победа: капитал ≥
          <input
            type="number"
            min={100}
            step={100}
            value={targetCapital}
            onChange={(e) => setTargetCapital(e.target.value)}
          />
        </label>
        <label>
          Лимит раундов
          <input
            type="number"
            min={1}
            step={1}
            value={maxRounds}
            onChange={(e) => setMaxRounds(e.target.value)}
          />
        </label>
      </div>

      <div className="players-setup">
        {players.map((p, i) => (
          <div key={i} className="player-setup-row">
            <input value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
            <label className="bot-toggle">
              <input
                type="checkbox"
                checked={p.is_bot}
                onChange={(e) => update(i, { is_bot: e.target.checked })}
              />
              бот
            </label>
            <button className="btn small" onClick={() => removePlayer(i)} disabled={players.length <= 2}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="setup-row">
        <button className="btn" onClick={addPlayer} disabled={players.length >= 6}>
          + Игрок
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            const victory: Record<string, number> = {};
            if (targetCapital) victory.target_net_worth = Number(targetCapital);
            if (maxRounds) victory.max_turns = Number(maxRounds);
            const config: Record<string, unknown> = {
              victory,
              extra: { start_experience: Math.max(0, Number(startExperience) || 0) },
            };
            onStart(players, board, seed ? Number(seed) : undefined, config);
          }}
        >
          🚀 Начать игру
        </button>
      </div>
    </div>
  );
}
