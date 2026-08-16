"""Design metrics for the balance work described in DESIGN_V2.md.

Not a balance report on roles — those live in ``simulation.cli``. This answers four questions
about the shape of the game itself:

* **Score composition** — what final points are actually made of. Before the v2 rebase, 90% of
  every score was the untouched wallet, which is why the game rewarded hoarding.
* **Action mix** — which button players press. Before, 60% of all actions were ``work`` (+2$).
* **Portfolio shape** — depth in one district versus spread, i.e. whether mono is still forced.
* **Lead stability** — the round after which the eventual winner never loses first place.

Run it after every balance change and compare against the table in DESIGN_V2.md::

    python -m simulation.design_metrics --games=40
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
from statistics import mean

from city_bots import choose_bot_command, normalize_bot_policy
from city_engine.constants import DISTRICT_IDS
from city_engine.engine import CityEngine
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_engine.models import GameState

SCORE_KEYS = ("projects", "assets", "money", "influence", "role", "scandals")


@dataclass
class Metrics:
    score_parts: Counter[str] = field(default_factory=Counter)
    action_mix: Counter[str] = field(default_factory=Counter)
    players_seen: int = 0
    district_depth: list[int] = field(default_factory=list)
    distinct_districts: list[int] = field(default_factory=list)
    leftover_cash: list[int] = field(default_factory=list)
    projects_taken: list[int] = field(default_factory=list)
    lead_locked_round: list[int] = field(default_factory=list)
    score_spread: list[float] = field(default_factory=list)


def _play_one(
    engine: CityEngine,
    metrics: Metrics,
    *,
    index: int,
    seed: int,
    rounds: int,
    bots: tuple[str, ...],
) -> None:
    setups = [
        PlayerSetup(id=f"p{seat}", name=f"P{seat}", is_bot=True, difficulty=policy) for seat, policy in enumerate(bots)
    ]
    state: GameState = create_game_from_catalog(
        f"metrics-{index}",
        setups,
        seed=seed + index,
        settings=GameSettings(max_rounds=rounds),
    )
    leader_by_round: dict[int, str] = {}
    while state.status == "playing":
        command = choose_bot_command(engine, state, state.current_player.id).command
        key = command.type
        if command.type == "basic_action":
            key = f"basic:{command.payload.get('kind')}"
        metrics.action_mix[key] += 1
        state = engine.apply(state, command).state
        leader_by_round[state.round_number] = engine.ranking(state)[0].id

    winner = engine.ranking(state)[0].id
    rounds_played = sorted(leader_by_round)
    locked = next(
        (
            candidate
            for candidate in rounds_played
            if all(leader_by_round[later] == winner for later in rounds_played if later >= candidate)
        ),
        rounds_played[-1],
    )
    metrics.lead_locked_round.append(locked)

    for player in state.players:
        for key, value in engine.score_breakdown(player).items():
            metrics.score_parts[key] += value
        counts = [engine.district_count(player, district) for district in DISTRICT_IDS]
        metrics.district_depth.append(max(counts))
        metrics.distinct_districts.append(sum(1 for count in counts if count > 0))
        metrics.leftover_cash.append(player.money)
        metrics.players_seen += 1
    metrics.projects_taken.append(sum(len(player.projects) for player in state.players))
    scores = state.final_scores
    best, worst = max(scores.values()), min(scores.values())
    metrics.score_spread.append((best - worst) / best if best else 0.0)


def render(metrics: Metrics, engine: CityEngine, games: int) -> str:
    seen = metrics.players_seen
    total = metrics.score_parts["total"]
    lines = [f"games={games} players={seen}", "", "=== score composition ==="]
    for key in SCORE_KEYS:
        share = 100 * metrics.score_parts[key] / total if total else 0
        lines.append(f"  {key:<10} {metrics.score_parts[key] / seen:7.1f}  {share:5.1f}%")
    lines.append(f"  {'TOTAL':<10} {total / seen:7.1f}")

    actions = sum(count for key, count in metrics.action_mix.items() if key != "end_turn")
    lines += ["", "=== action mix (excl. end_turn) ==="]
    for key, count in metrics.action_mix.most_common():
        if key == "end_turn":
            continue
        lines.append(f"  {key:<22} {count:5d}  {100 * count / actions:5.1f}%")

    lines += [
        "",
        "=== shape ===",
        f"  projects taken per game:  {mean(metrics.projects_taken):.1f} of {len(engine.catalog.projects)}",
        f"  max objects in district:  {mean(metrics.district_depth):.2f}",
        f"  distinct districts:       {mean(metrics.distinct_districts):.2f}",
        f"  leftover cash:            {mean(metrics.leftover_cash):.0f}$",
        f"  lead locked at round:     {mean(metrics.lead_locked_round):.1f}",
        f"  (win-lose)/win spread:    {100 * mean(metrics.score_spread):.1f}%",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--games", type=int, default=25)
    parser.add_argument("--rounds", type=int, default=15)
    parser.add_argument("--seed", type=int, default=1000)
    parser.add_argument("--bots", default="codex,codex,codex,codex", help="comma-separated bot policies")
    args = parser.parse_args(argv)

    bots = tuple(normalize_bot_policy(item) for item in args.bots.split(",") if item.strip())
    if not 2 <= len(bots) <= 6:
        parser.error("between 2 and 6 bots are required")

    engine = CityEngine()
    metrics = Metrics()
    for index in range(args.games):
        _play_one(engine, metrics, index=index, seed=args.seed, rounds=args.rounds, bots=bots)
    print(render(metrics, engine, args.games))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
