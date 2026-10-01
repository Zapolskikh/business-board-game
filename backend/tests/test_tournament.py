from __future__ import annotations

import city_bots.oracle as oracle
from simulation.tournament import TournamentConfig, run_tournament, seating, tournament_seed
from simulation.tournament_report import render, verdict, wilson


def test_every_deal_seats_every_bot_on_every_seat_once() -> None:
    """A deal is replayed with the seating rotated, so its luck cancels out of the bot comparison."""
    config = TournamentConfig(games=24, rotations=4)
    for block in range(6):
        games = range(block * 4, block * 4 + 4)
        assert len({tournament_seed(config, index) for index in games}) == 1
        for seat in range(4):
            assert sorted(seating(config, index)[seat] for index in games) == sorted(config.lineup)
    assert tournament_seed(config, 0) != tournament_seed(config, 4)


def test_a_short_tournament_measures_what_the_engine_pays(monkeypatch) -> None:
    monkeypatch.setattr(oracle, "TURN_BUDGET", 0.3)
    config = TournamentConfig(games=1, rounds=5, workers=1, forks=0)
    tally = run_tournament(config, progress=False)

    assert tally.games == 1
    assert sum(tally.seats.values()) == 4
    # The split of each settlement into objects must add back up to what the engine paid.
    assert tally.settlements == 5 and tally.settle_mismatch == 0
    # The calibration anchors are exact: patronage and lobbying pay their printed points.
    for key, expected in (("basic_action:patronage", 5), ("basic_action:lobbying", 6)):
        valued = sum(count for (_bot, name, _bucket), count in tally.valued.items() if name == key)
        points = sum(value for (_bot, name, _bucket), value in tally.self_pts.items() if name == key)
        if valued:
            assert points / valued == expected
    assert oracle.TELEMETRY is None  # the tournament switches Oracle's recording back off
    report = render(tally, config)
    sections = (
        "## Боты",
        "## Динамика партии",
        "## Разнообразие победных стратегий",
        "## Объекты рынка",
        "## Показ на рынке",
        "## Проекты",
        "## Карты действий",
        "## Взаимодействие и защита",
        "## По третям партии",
        "## Мнение Oracle",
        "## Аномалии",
    )
    for section in sections:
        assert section in report
    # Testers read the game's own titles, not the code ids.
    assert "Робототехника" in report or "«" in report


def test_the_statistics_mark_only_real_effects_as_significant() -> None:
    low, high = wilson(50, 100)
    assert low < 0.5 < high
    assert verdict(5.0, 1.0) == "**значимо**"
    assert verdict(1.5, 1.0) == "тенденция"
    assert verdict(0.5, 1.0) == "шум"


def test_suspects_read_a_tournament_report_and_focused_forks_stay_on_them(monkeypatch) -> None:
    from simulation.suspects import find_suspects
    from simulation.tournament import machine_report

    monkeypatch.setattr(oracle, "TURN_BUDGET", 0.3)
    config = TournamentConfig(games=1, rounds=5, workers=1, forks=0)
    report = machine_report(run_tournament(config, progress=False), config)
    suspects = find_suspects(report)
    assert all(
        ":" in key or key in {"reroll_projects", "buy_roof", "buy_capacity", "crisis_pr", "buy_action_card"}
        for key, _ in suspects
    )

    focus = ("basic_action:patronage",)
    focused = TournamentConfig(games=1, rounds=5, workers=1, forks=8, fork_focus=focus)
    tally = run_tournament(focused, progress=False)
    assert {key for key, _bucket in tally.cf_n} <= set(focus)
