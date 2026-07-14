from __future__ import annotations

from simulation.report import render_markdown
from simulation.runner import SimulationConfig, run_batch


def test_production_simulation_reports_engine_games() -> None:
    config = SimulationConfig(
        games=2,
        rounds=5,
        players=3,
        role_price=3,
        bots=("easy", "medium", "hard"),
        specialist_position=2,
        specialist_role="mafia",
        workers=1,
        seed=99,
    )
    result = run_batch(config)
    assert result["games"] == 2
    assert set(result["avg_winner_income_sources"]) == {
        "debt",
        "journalist",
        "mafia_tribute",
        "operations",
    }
    assert round(sum(result["seat_win_pct"].values()), 2) == 100.0
    assert result["specialist"]["games"] == 2
    report = render_markdown(result)
    assert "production-симуляции" in report
    assert "2,mafia" in report
