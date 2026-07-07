// In-app balance simulator: runs N bot games on the backend and shows the
// per-role win-rate table — the primary imbalance signal from the design.
import { useState } from "react";
import { api } from "../api";

interface RoleStat {
  appearances: number;
  wins: number;
  win_rate: number;
  avg_net_worth: number;
  avg_bankruptcies: number;
  avg_roles_lost: number;
}

interface Report {
  games: number;
  avg_rounds: number;
  roles: Record<string, RoleStat>;
}

export function SimPanel({ board }: { board: string }) {
  const [games, setGames] = useState(200);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = (await api.simulate(games, 4, board, 0, "random")) as unknown as Report;
      setReport(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rows = report
    ? Object.entries(report.roles).sort((a, b) => b[1].win_rate - a[1].win_rate)
    : [];

  return (
    <div className="panel sim-panel">
      <h2>Симулятор баланса</h2>
      <div className="setup-row">
        <label>
          Партий:
          <input
            type="number"
            min={10}
            max={5000}
            value={games}
            onChange={(e) => setGames(Number(e.target.value))}
          />
        </label>
        <button className="btn primary" onClick={run} disabled={busy}>
          {busy ? "Считаю…" : "▶️ Прогнать"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {report && (
        <>
          <p className="sim-meta">
            {report.games} партий · средн. {report.avg_rounds} раундов
          </p>
          <table className="sim-table">
            <thead>
              <tr>
                <th>Роль</th>
                <th>Win%</th>
                <th>Капитал</th>
                <th>Банкр.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([role, s]) => (
                <tr key={role}>
                  <td>{role}</td>
                  <td>{(s.win_rate * 100).toFixed(1)}%</td>
                  <td>{s.avg_net_worth}</td>
                  <td>{s.avg_bankruptcies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
