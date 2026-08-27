"""Typed access to the versioned, backend-owned City content catalog."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from math import floor
from pathlib import Path
from typing import Any

from city_engine.constants import (
    ACTION_CARD_COST,
    CAMPAIGN_TIERS,
    CAPACITY_COSTS,
    CARD_DISCARD_VALUE,
    CONTENT_VERSION,
    CRISIS_PR_INFLUENCE,
    DISTRICT_IDS,
    GREY_FAILURE_SCANDALS,
    GREY_OPERATION_CHANCE,
    GREY_OPERATION_POINTS,
    GREY_SUCCESS_SCANDALS,
    HACK_INFLUENCE_BASE,
    INFLUENCE_PER_POINT,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MARKET_ROTATION_SIZE,
    MAX_CAPACITY,
    MONEY_PER_POINT,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
    PROJECT_BOARD_SIZE,
    PROJECT_REROLL_MONEY,
    PUMP_DRAIN_BASE,
    ROLE_IDS,
    ROOF_BREAK_POINT_PER_ROOF,
)
from city_engine.errors import StateValidationError

CATALOG_PATH = Path(__file__).with_name("content") / "catalog.json"
RARITIES = {"common", "uncommon", "rare", "epic", "legendary"}


def asset_points(cost: int) -> int:
    """Final-scoring points an object is worth, and what selling it pays back: half its price.

    Lives here rather than in the engine because the number has to reach the card: an object turns
    money into points at 2$ each, five times better than the 10$ a hoarded point costs, which makes
    "sell the weak one, buy the dear one" the strongest late money sink in the game. Both clients
    used to derive `floor(cost / 2)` themselves, so the rate was on screen nowhere and duplicated
    in three places.
    """
    return floor(cost / 2)


# Every project condition is a count of things already visible on the table — never a formula.
PROJECT_REQUIREMENTS = {
    "none",
    "assets",
    "role",
    "max_scandals",
    "district_objects",
    "district_depth",
    "distinct_districts",
    "tag_objects",
}


@dataclass(frozen=True, slots=True)
class DistrictDefinition:
    id: str
    title: str
    icon: str
    color: str
    description: str


@dataclass(frozen=True, slots=True)
class RoleDefinition:
    id: str
    title: str
    icon: str
    color: str
    passive: str
    power: str
    districts: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AssetDefinition:
    id: str
    title: str
    district: str
    rarity: str
    cost: int
    income: int
    influence: int
    text: str
    tags: tuple[str, ...]
    effects: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ActionCardDefinition:
    id: str
    title: str
    tone: str
    text: str
    kind: str
    value: int
    targeted: bool = False
    # May this targeted card be aimed at its own player? Off by default, and a property of the
    # card rather than of its kind: "scandal cards may hit you" would be a rule the player has to
    # learn, while a flag is a line the card prints. The journalist wants their own scandals — the
    # rating pays for them — and nothing else in the game let them buy one on purpose.
    self_target: bool = False


@dataclass(frozen=True, slots=True)
class ProjectDefinition:
    """A unique city project: taken from a shared board, so one player's gain is another's loss."""

    id: str
    title: str
    text: str
    cost_influence: int
    cost_money: int
    points: int
    requirement: dict[str, Any] = field(default_factory=dict)
    perk: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ContentCatalog:
    schema_version: int
    content_version: str
    districts: dict[str, DistrictDefinition]
    roles: dict[str, RoleDefinition]
    assets: dict[str, AssetDefinition]
    action_cards: dict[str, ActionCardDefinition]
    projects: dict[str, ProjectDefinition]
    # Round from which each rarity may appear on the market. Epic and legendary arrive late on
    # purpose: bought early they are unaffordable, and bought out early the late market is empty.
    rarity_min_round: dict[str, int]

    def deck_project_ids(self) -> list[str]:
        """Every project is unique and enters the deck: the board is the only way to reach one.

        Two repeatable initiatives used to sit outside the deck as an always-open scoring outlet.
        They were a second answer to the question patronage and lobbying already answer — turning a
        pile into points — and the weaker one, so the sinks were raised and the initiatives removed.
        """
        return list(self.projects)

    def validate(self) -> None:
        if self.schema_version != 1:
            raise StateValidationError(f"unsupported content schema: {self.schema_version}")
        if self.content_version != CONTENT_VERSION:
            raise StateValidationError(
                f"catalog version {self.content_version!r} does not match engine {CONTENT_VERSION!r}"
            )
        if tuple(self.districts) != DISTRICT_IDS:
            raise StateValidationError("catalog districts do not match engine district ids/order")
        if tuple(self.roles) != ROLE_IDS:
            raise StateValidationError("catalog roles do not match engine role ids/order")
        if len(self.assets) < 6 or len(self.action_cards) < 3:
            raise StateValidationError("catalog does not contain enough cards to start a game")
        if len(self.deck_project_ids()) < PROJECT_BOARD_SIZE:
            raise StateValidationError(f"catalog needs at least {PROJECT_BOARD_SIZE} projects to fill the board")
        for project in self.projects.values():
            if project.cost_influence < 0 or project.cost_money < 0 or project.points < 1:
                raise StateValidationError(f"project {project.id} has invalid numeric values")
            requirement = str(project.requirement.get("type", ""))
            if requirement not in PROJECT_REQUIREMENTS:
                raise StateValidationError(f"project {project.id} has unknown requirement {requirement!r}")
            if requirement == "district_objects" and project.requirement.get("district") not in self.districts:
                raise StateValidationError(f"project {project.id} references an unknown district")
            if requirement == "tag_objects":
                tag = project.requirement.get("tag")
                if not any(tag in asset.tags for asset in self.assets.values()):
                    raise StateValidationError(f"project {project.id} requires tag {tag!r} that no asset carries")
            if any(value < 1 for value in project.perk.values()):
                raise StateValidationError(f"project {project.id} has a non-positive perk value")
        if set(self.rarity_min_round) != RARITIES:
            raise StateValidationError("rarity_min_round must list every rarity exactly once")
        for asset in self.assets.values():
            if asset.district not in self.districts:
                raise StateValidationError(f"asset {asset.id} references unknown district {asset.district}")
            if asset.rarity not in RARITIES:
                raise StateValidationError(f"asset {asset.id} has unknown rarity {asset.rarity}")
            if asset.cost < 1 or asset.income < 0 or asset.influence < 0:
                raise StateValidationError(f"asset {asset.id} has invalid numeric values")
        for role in self.roles.values():
            if any(district not in self.districts for district in role.districts):
                raise StateValidationError(f"role {role.id} references an unknown district")

    def public_meta(self) -> dict[str, Any]:
        """JSON-safe catalog sent to React; no runtime state or deck order.

        The scoring rates ride along so clients state the conversion rather than hardcode it:
        both the React panel and the text client print "N$ = 1 очко" from this block.
        """
        with CATALOG_PATH.open(encoding="utf-8") as handle:
            raw = json.load(handle)
        # Computed, not stored: the scoring rule owns it, so the catalog cannot drift from the score.
        for asset in raw["assets"]:
            asset["points"] = asset_points(int(asset["cost"]))
        raw["scoring"] = {
            "project_board_size": PROJECT_BOARD_SIZE,
            "project_reroll_money": PROJECT_REROLL_MONEY,
            # How many rounds a market slot lasts, so the client can say "rounds" and mean it.
            "market_rotation_size": MARKET_ROTATION_SIZE,
            "money_per_point": MONEY_PER_POINT,
            "influence_per_point": INFLUENCE_PER_POINT,
            "lobbying_influence": LOBBYING_INFLUENCE,
            "lobbying_points": LOBBYING_POINTS,
            "patronage_money": PATRONAGE_MONEY,
            "patronage_points": PATRONAGE_POINTS,
            "crisis_pr_influence": CRISIS_PR_INFLUENCE,
            "action_card_cost": ACTION_CARD_COST,
            # What a discarded card pays back. The client had "+1" written into a label while the
            # engine paid 2, so the cheapest influence line in the game was mislabelled on screen.
            "card_discard_value": CARD_DISCARD_VALUE,
            # Campaign tiers travel as pairs so the client renders one button per tier without
            # knowing the rates; a dict would arrive with string keys through JSON.
            "campaign_tiers": [{"spend": spend, "gain": gain} for spend, gain in sorted(CAMPAIGN_TIERS.items())],
            # The grey layer travels as whole tables now: one score and one chance per operation,
            # so the panel never has to know which operations are the "hard" ones.
            "grey_operation_points": GREY_OPERATION_POINTS,
            "grey_operation_chance": GREY_OPERATION_CHANCE,
            "grey_success_scandals": GREY_SUCCESS_SCANDALS,
            "grey_failure_scandals": GREY_FAILURE_SCANDALS,
            # Both of these grow with the round, so the client is given the base and the formula.
            "hack_influence_base": HACK_INFLUENCE_BASE,
            "pump_drain_base": PUMP_DRAIN_BASE,
            "roof_break_point_per_roof": ROOF_BREAK_POINT_PER_ROOF,
            # What the next city slot costs, keyed by the capacity the player has now. The React
            # client kept its own copy of this table and printed the wrong price the moment the
            # ladder changed; the engine owns the ladder, so the engine ships it.
            "capacity_costs": {str(capacity): cost for capacity, cost in sorted(CAPACITY_COSTS.items())},
            "max_capacity": MAX_CAPACITY,
        }
        return raw


def _unique_by_id(items: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in items:
        item_id = str(item["id"])
        if item_id in result:
            raise StateValidationError(f"duplicate {label} id: {item_id}")
        result[item_id] = item
    return result


@lru_cache(maxsize=1)
def load_catalog(path: Path = CATALOG_PATH) -> ContentCatalog:
    with path.open(encoding="utf-8") as handle:
        raw = json.load(handle)

    district_rows = _unique_by_id(raw["districts"], "district")
    role_rows = _unique_by_id(raw["roles"], "role")
    asset_rows = _unique_by_id(raw["assets"], "asset")
    action_rows = _unique_by_id(raw["action_cards"], "action card")
    project_rows = _unique_by_id(raw["projects"], "project")

    catalog = ContentCatalog(
        schema_version=int(raw["schema_version"]),
        content_version=str(raw["content_version"]),
        districts={key: DistrictDefinition(**row) for key, row in district_rows.items()},
        roles={
            key: RoleDefinition(
                id=row["id"],
                title=row["title"],
                icon=row["icon"],
                color=row["color"],
                passive=row["passive"],
                power=row["power"],
                districts=tuple(row.get("districts", [])),
            )
            for key, row in role_rows.items()
        },
        assets={
            key: AssetDefinition(
                id=row["id"],
                title=row["title"],
                district=row["district"],
                rarity=row["rarity"],
                cost=int(row["cost"]),
                income=int(row["income"]),
                influence=int(row["influence"]),
                text=row["text"],
                tags=tuple(row.get("tags", [])),
                effects=dict(row.get("effects") or {}),
            )
            for key, row in asset_rows.items()
        },
        action_cards={
            key: ActionCardDefinition(
                id=row["id"],
                title=row["title"],
                tone=row["tone"],
                text=row["text"],
                kind=row["kind"],
                value=int(row["value"]),
                targeted=bool(row.get("targeted", False)),
                self_target=bool(row.get("self_target", False)),
            )
            for key, row in action_rows.items()
        },
        projects={
            key: ProjectDefinition(
                id=row["id"],
                title=row["title"],
                text=row["text"],
                cost_influence=int(row["cost_influence"]),
                cost_money=int(row["cost_money"]),
                points=int(row["points"]),
                requirement=dict(row.get("requirement") or {"type": "none"}),
                perk={str(key): int(value) for key, value in (row.get("perk") or {}).items()},
            )
            for key, row in project_rows.items()
        },
        rarity_min_round={str(key): int(value) for key, value in raw["rarity_min_round"].items()},
    )
    catalog.validate()
    return catalog
