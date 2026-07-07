"""Tests for role assignment and simulation reproducibility/stats."""
from __future__ import annotations

from game_engine import build_game
from game_engine.config_loader import load_role_ids
from simulation.runner import play_game, run_batch
from simulation.stats import compute_report, format_report


def test_players_start_without_roles_by_default():
    """Real games now begin role-less; roles are earned/assigned in play."""
    state = build_game(
        "r",
        [{"name": str(i), "is_bot": True} for i in range(4)],
        board_name="board_60",
        seed=3,
    )
    assert all(p.role is None for p in state.players)


def test_six_players_get_all_distinct_roles():
    state = build_game(
        "r",
        [{"name": str(i), "is_bot": True} for i in range(6)],
        board_name="board_60",
        seed=3,
        config_overrides={"starting_roles_mode": "distinct"},
    )
    roles = [p.role for p in state.players]
    assert len(set(roles)) == 6
    assert set(roles) == set(load_role_ids())


def test_fewer_players_get_unique_roles():
    state = build_game(
        "r",
        [{"name": str(i), "is_bot": True} for i in range(3)],
        board_name="board_60",
        seed=7,
        config_overrides={"starting_roles_mode": "distinct"},
    )
    roles = [p.role for p in state.players if p.role]
    assert len(roles) == len(set(roles))


def test_simulation_batch_produces_winners():
    results = run_batch(games=8, num_players=4, board_name="board_60", base_seed=0)
    assert len(results) == 8
    assert all(r.winner_id is not None for r in results)


def test_report_has_role_breakdown():
    results = run_batch(games=12, num_players=4, board_name="board_60", base_seed=0)
    report = compute_report(results)
    assert report["games"] == 12
    assert report["roles"]  # non-empty
    for role_stats in report["roles"].values():
        assert 0.0 <= role_stats["win_rate"] <= 1.0
    # format should not raise
    assert isinstance(format_report(report), str)


def test_simulation_is_deterministic_for_same_seed():
    a = play_game(seed=5, num_players=4, board_name="board_60")
    b = play_game(seed=5, num_players=4, board_name="board_60")
    assert a.winner_id == b.winner_id
    assert a.rounds == b.rounds
    assert a.turns == b.turns
