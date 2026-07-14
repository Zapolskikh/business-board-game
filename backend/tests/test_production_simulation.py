from __future__ import annotations

import pytest

from city_bots import normalize_bot_policy
from simulation.cli import parse_bots, parse_specialist
from simulation.report import render_markdown
from simulation.runner import SimulationConfig, run_batch
from simulation.suite import BOT_MATCHUPS


def test_simulation_cli_accepts_bot_names_and_difficulty_aliases() -> None:
    assert parse_bots("oleg,Codex,hard") == ("easy", "medium", "hard")
    assert normalize_bot_policy("Claude") == "hard"
    assert parse_specialist("2,MAFIA") == (2, "mafia")


def test_simulation_config_rejects_mismatched_bot_count() -> None:
    config = SimulationConfig(players=3, bots=("easy", "medium"))
    with pytest.raises(ValueError, match="expected 3, got 2"):
        config.validate()


def test_bot_matchups_balance_policies_and_seats() -> None:
    assert all(len(matchup) == 4 for matchup in BOT_MATCHUPS)
    for difficulty in ("easy", "medium", "hard"):
        assert sum(matchup.count(difficulty) for matchup in BOT_MATCHUPS) == 4
        assert {matchup.index(difficulty) for matchup in BOT_MATCHUPS} == {0, 1, 2}


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
    assert sum(result["seat_wins"].values()) == 2
    assert set(result["seat_avg_score"]) == {"seat-1", "seat-2", "seat-3"}
    assert result["specialist"]["games"] == 2
    report = render_markdown(result)
    assert "production-симуляции" in report
    assert "2,mafia" in report
    assert "Олег (easy)" in report
    assert "Codex (medium)" in report
    assert "Claude (hard)" in report
