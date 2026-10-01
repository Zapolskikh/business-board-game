from __future__ import annotations

import pytest

from city_bots import normalize_bot_policy
from simulation.cli import parse_bots, parse_specialist
from simulation.report import render_markdown
from simulation.runner import SimulationConfig, run_batch
from simulation.suite import CONFIGS, REBORN_CONTROL


def test_simulation_cli_accepts_bot_names_and_difficulty_aliases() -> None:
    assert parse_bots("reborn,Expert,claude reborn") == ("expert", "expert", "expert")
    assert normalize_bot_policy("Claude Reborn") == "expert"
    assert normalize_bot_policy("Claude Ledger") == "ledger"
    assert parse_bots("ledger,reborn,oracle") == ("ledger", "expert", "oracle")
    assert normalize_bot_policy("Claude Oracle") == "oracle"
    assert parse_specialist("2,MAFIA") == (2, "mafia")


def test_retired_bot_policies_are_no_longer_offered() -> None:
    """Oleg, Codex and Claude played rules that no longer exist; only Reborn is left."""
    for retired in ("oleg", "codex", "claude", "easy", "medium", "hard"):
        with pytest.raises(ValueError):
            normalize_bot_policy(retired)


def test_simulation_config_rejects_mismatched_bot_count() -> None:
    config = SimulationConfig(players=3, bots=("expert", "expert"))
    with pytest.raises(ValueError, match="expected 3, got 2"):
        config.validate()


def test_suite_is_a_reborn_control_table_plus_one_specialist_per_role() -> None:
    assert REBORN_CONTROL == ("expert",) * 4
    assert CONFIGS == 7


def test_production_simulation_reports_engine_games() -> None:
    config = SimulationConfig(
        games=2,
        rounds=5,
        players=3,
        role_price=3,
        bots=("expert", "expert", "expert"),
        specialist_position=2,
        specialist_role="mafia",
        workers=1,
        seed=99,
    )
    result = run_batch(config)
    assert result["games"] == 2
    # Income is split into the lines a player can act on rather than reported as one opaque
    # `operations` number: a row nobody itemises is a row invisible in both the chronicle and the
    # report.
    assert set(result["avg_winner_income_sources"]) == {
        "debt",
        "journalist",
        "objects",
        "projects",
    }
    assert round(sum(result["seat_win_pct"].values()), 2) == 100.0
    assert sum(result["seat_wins"].values()) == 2
    assert set(result["seat_avg_score"]) == {"seat-1", "seat-2", "seat-3"}
    assert result["specialist"]["games"] == 2
    report = render_markdown(result)
    assert "production-симуляции" in report
    assert "2,mafia" in report
    assert "Claude Reborn (expert)" in report
