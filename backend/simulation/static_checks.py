"""Fast, policy-free balance checks for content that can be ruled weak without simulations.

The checks are deliberately conservative: an object is called dominated only when the replacement
is no worse in every catalog-visible dimension, and cards with delayed or hostile effects are
labelled contextual instead of assigned a made-up scalar value.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from city_engine.constants import (
    CARD_DISCARD_INFLUENCE,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
)
from city_engine.engine import CityEngine

ACTION_BENCHMARK = 2.0
# The engine scores a pile at nothing, so the yardstick for a currency is its one way out: what
# patronage pays for a dollar and lobbying for a point of influence.
MONEY_POINT_VALUE = PATRONAGE_POINTS / PATRONAGE_MONEY
INFLUENCE_POINT_VALUE = LOBBYING_POINTS / LOBBYING_INFLUENCE


def _deep_subset(left: Any, right: Any) -> bool:
    if isinstance(left, dict):
        return isinstance(right, dict) and all(
            key in right and _deep_subset(value, right[key]) for key, value in left.items()
        )
    if isinstance(left, (list, tuple)):
        return isinstance(right, (list, tuple)) and all(item in right for item in left)
    return left == right


def dominated_objects(engine: CityEngine) -> list[tuple[str, str]]:
    """Return ``(weaker, stronger)`` pairs proven by catalog-visible attributes."""

    result: list[tuple[str, str]] = []
    for weaker in engine.catalog.assets.values():
        for stronger in engine.catalog.assets.values():
            if weaker.id == stronger.id or weaker.district != stronger.district:
                continue
            no_worse = (
                stronger.cost <= weaker.cost
                and stronger.income >= weaker.income
                and stronger.influence >= weaker.influence
                and set(weaker.tags) <= set(stronger.tags)
                and _deep_subset(weaker.effects, stronger.effects)
                and engine.catalog.rarity_min_round[stronger.rarity] <= engine.catalog.rarity_min_round[weaker.rarity]
            )
            strictly_better = (
                stronger.cost < weaker.cost
                or stronger.income > weaker.income
                or stronger.influence > weaker.influence
                or set(weaker.tags) < set(stronger.tags)
                or weaker.effects != stronger.effects
                or engine.catalog.rarity_min_round[stronger.rarity] < engine.catalog.rarity_min_round[weaker.rarity]
            )
            if no_worse and strictly_better:
                result.append((weaker.id, stronger.id))
    return sorted(result)


def _requirement_supply(engine: CityEngine, requirement: dict[str, Any]) -> tuple[str, int | None]:
    assets = list(engine.catalog.assets.values())
    unlock = engine.catalog.rarity_min_round
    kind = str(requirement.get("type", "none"))
    count = int(requirement.get("count", 0))

    if kind == "assets":
        rounds = sorted(unlock[asset.rarity] for asset in assets)
        return f"{len(assets)} objects", rounds[count - 1] if count and len(rounds) >= count else None
    if kind == "district_objects":
        district = str(requirement.get("district"))
        matches = [asset for asset in assets if asset.district == district]
        rounds = sorted(unlock[asset.rarity] for asset in matches)
        return f"{len(matches)} in {district}", rounds[count - 1] if count and len(rounds) >= count else None
    if kind == "tag_objects":
        tag = str(requirement.get("tag"))
        matches = [asset for asset in assets if tag in asset.tags]
        rounds = sorted(unlock[asset.rarity] for asset in matches)
        return f"{len(matches)} tagged {tag}", rounds[count - 1] if count and len(rounds) >= count else None
    if kind == "distinct_districts":
        first_by_district = []
        for district in engine.catalog.districts:
            rounds = [unlock[asset.rarity] for asset in assets if asset.district == district]
            if rounds:
                first_by_district.append(min(rounds))
        first_by_district.sort()
        earliest = first_by_district[count - 1] if count and len(first_by_district) >= count else None
        return f"{len(first_by_district)} represented districts", earliest
    if kind == "district_depth":
        candidates = []
        for district in engine.catalog.districts:
            rounds = sorted(unlock[asset.rarity] for asset in assets if asset.district == district)
            if count and len(rounds) >= count:
                candidates.append(rounds[count - 1])
        return f"{len(candidates)} districts can reach depth {count}", min(candidates) if candidates else None
    return "no catalog gate", 1


def _perk_per_round(perk: dict[str, int]) -> float:
    return perk.get("passiveMoney", 0) * MONEY_POINT_VALUE + perk.get("passiveInfluence", 0) * INFLUENCE_POINT_VALUE


def render(engine: CityEngine | None = None) -> str:
    engine = engine or CityEngine()
    lines: list[str] = ["STATIC BALANCE CHECKS", f"action benchmark: {ACTION_BENCHMARK:.1f} points"]

    pairs = dominated_objects(engine)
    lines.append("\n=== OBJECT DOMINANCE ===")
    if pairs:
        lines.extend(f"  {weaker}  <=  {stronger}" for weaker, stronger in pairs)
    else:
        lines.append("  none (cost/income/influence/tags/effects/unlock all checked)")

    discard_points = CARD_DISCARD_INFLUENCE * INFLUENCE_POINT_VALUE
    delayed = {"roof", "market_discount", "zoning", "extra_action", "capacity", "project"}
    hostile = {"scandal", "fine", "steal", "role_pressure", "double_scandal", "blackmail", "expose", "mixed_fine"}
    lines.append("\n=== ACTION CARDS VS DISCARD ===")
    lines.append(f"  best discard: {CARD_DISCARD_INFLUENCE} influence = {discard_points:.2f} immediate points")
    for card in sorted(engine.catalog.action_cards.values(), key=lambda item: item.id):
        if card.kind in delayed:
            verdict = "DELAYED — simulation/counterfactual required"
        elif card.kind in hostile:
            verdict = "HOSTILE/CONTEXTUAL — compare self and rival deltas"
        else:
            verdict = "MEASURE DIRECTLY — deterministic terminal resource effect"
        lines.append(f"  {card.id:<24} kind={card.kind:<16} value={card.value:<2} {verdict}")

    lines.append("\n=== CITY PROJECTS: IMMEDIATE NET AND REACHABILITY ===")
    project_suspects: list[str] = []
    for project in sorted(engine.catalog.projects.values(), key=lambda item: item.id):
        immediate = (
            project.points
            - project.cost_influence * INFLUENCE_POINT_VALUE
            - project.cost_money * MONEY_POINT_VALUE
        )
        supply, earliest = _requirement_supply(engine, project.requirement)
        earliest_text = str(earliest) if earliest is not None else "NEVER"
        per_round = _perk_per_round(project.perk)
        verdict = "SUSPECT" if immediate < ACTION_BENCHMARK else "OK"
        if earliest is None or immediate < ACTION_BENCHMARK:
            project_suspects.append(project.id)
        lines.append(
            f"  {project.id:<26} net={immediate:>5.2f} perk/round={per_round:>4.2f}"
            f" earliest={earliest_text:<5} supply={supply:<34} {verdict}"
        )

    lines.append("\n=== GREY OPERATION GATES ===")
    for operation, districts in engine.GREY_OPERATION_DISTRICTS.items():
        matches = [asset for asset in engine.catalog.assets.values() if asset.district in districts]
        earliest = min(engine.catalog.rarity_min_round[asset.rarity] for asset in matches) if matches else None
        joiner = "+" if operation in engine.GREY_OPERATION_NEEDS_ALL else ","
        lines.append(
            f"  {operation:<20} districts={joiner.join(districts):<28}"
            f" objects={len(matches):>2} earliest={earliest if earliest is not None else 'NEVER'}"
        )

    lines.append("\n=== STATIC SHORTLIST ===")
    lines.append("  dominated objects: " + (", ".join(sorted({left for left, _ in pairs})) or "(none)"))
    lines.append("  weak/unreachable immediate projects: " + (", ".join(project_suspects) or "(none)"))
    lines.append("  delayed and hostile cards stay out of static verdicts by design")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    report = render()
    print(report)
    if args.output:
        Path(args.output).write_text(report + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
