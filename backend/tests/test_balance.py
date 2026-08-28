from __future__ import annotations

import random
from types import SimpleNamespace

from city_engine.engine import CityEngine
from simulation.balance import (
    BalanceConfig,
    _actions_consumed,
    _exploration_command,
    _sample_sd,
    game_seed,
    machine_report,
    run_balance,
)
from simulation.static_checks import dominated_objects
from simulation.static_checks import render as render_static


def _turn(*, player: str, actions: int, serial: int = 1, status: str = "playing") -> SimpleNamespace:
    return SimpleNamespace(
        current_player=SimpleNamespace(id=player),
        actions_left=actions,
        turn_serial=serial,
        status=status,
    )


def test_action_accounting_uses_the_old_budget_after_an_arrest_advances_the_turn() -> None:
    before = _turn(player="a", actions=3)
    after = _turn(player="b", actions=3, serial=2)
    command = SimpleNamespace(type="grey_operation")

    assert _actions_consumed(before, after, "a", command) == 3
    assert _actions_consumed(before, _turn(player="a", actions=2), "a", command) == 1
    assert _actions_consumed(before, before, "a", SimpleNamespace(type="sell_asset")) == 0
    assert _actions_consumed(before, after, "a", SimpleNamespace(type="end_turn")) == 0


def test_exploration_never_passes_while_an_action_can_be_spent() -> None:
    state = _turn(player="a", actions=2)
    state.game_id = "test"
    state.revision = 0
    actor = SimpleNamespace(id="a")
    transitions = [
        ({"type": "end_turn", "payload": {}}, None),
        ({"type": "basic_action", "payload": {"kind": "work"}}, None),
    ]

    command = _exploration_command(state, actor, transitions, random.Random(1))

    assert command.type == "basic_action"


def test_balance_run_has_exact_settlement_sources_and_no_exploration_passes() -> None:
    config = BalanceConfig(games=1, seed=20260828, epsilon=1.0, workers=1)

    ledger = run_balance(config)

    assert ledger.settlements == 15
    assert ledger.settlement_rows == 60
    assert ledger.settle_mismatch == 0
    assert ledger.passes_with_actions == 0


def test_parallel_seed_is_derived_only_from_config_and_game_index() -> None:
    one = BalanceConfig(seed=123, workers=1)
    many = BalanceConfig(seed=123, workers=8)

    assert [game_seed(one, index) for index in range(5)] == [game_seed(many, index) for index in range(5)]


def test_variance_and_machine_report_are_stable() -> None:
    assert _sample_sd(6.0, 14.0, 3) == 1.0
    config = BalanceConfig(games=1, seed=7)
    ledger = run_balance(config)
    report = machine_report(ledger, config)

    assert report["schema"] == "city-balance-2"
    assert report["config"]["seed"] == 7
    assert "self_delta_sq" in report["ledger"]["counters"]


def test_static_checks_are_conservative_and_complete() -> None:
    engine = CityEngine()
    report = render_static(engine)

    assert isinstance(dominated_objects(engine), list)
    assert "OBJECT DOMINANCE" in report
    assert "ACTION CARDS VS DISCARD" in report
    assert "CITY PROJECTS: IMMEDIATE NET AND REACHABILITY" in report
    assert "GREY OPERATION GATES" in report
