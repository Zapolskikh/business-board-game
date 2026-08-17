"""Typed access to the versioned, backend-owned City content catalog."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from city_engine.constants import (
    ACTION_CARD_COST,
    AUTOMATION_COST,
    CONTENT_VERSION,
    CRISIS_PR_INFLUENCE,
    DISTRICT_IDS,
    INFLUENCE_PER_POINT,
    MARKET_REROLL_COST,
    MONEY_PER_POINT,
    PROJECT_BOARD_SIZE,
    PROJECT_REROLL_INFLUENCE,
    REPEATABLE_PROJECT_IDS,
    ROLE_IDS,
)
from city_engine.errors import StateValidationError

CATALOG_PATH = Path(__file__).with_name("content") / "catalog.json"
RARITIES = {"common", "uncommon", "rare", "epic", "legendary"}
# Every project condition is a count of things already visible on the table — never a formula.
PROJECT_REQUIREMENTS = {
    "none",
    "assets",
    "automation",
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
    # Repeatable initiatives never enter the deck and never leave: they are the floor that keeps
    # the last rounds from having no scoring outlet at all, priced worse than a real project.
    repeatable: bool = False


@dataclass(frozen=True, slots=True)
class EventDefinition:
    id: str
    title: str
    text: str
    district: str | None = None
    income_multiplier: float | None = None
    market_discount: int = 0
    global_income: int = 0
    global_market_discount: int = 0


@dataclass(frozen=True, slots=True)
class ContentCatalog:
    schema_version: int
    content_version: str
    districts: dict[str, DistrictDefinition]
    roles: dict[str, RoleDefinition]
    assets: dict[str, AssetDefinition]
    action_cards: dict[str, ActionCardDefinition]
    projects: dict[str, ProjectDefinition]
    events: dict[str, EventDefinition]
    # Round from which each rarity may appear on the market. Epic and legendary arrive late on
    # purpose: bought early they are unaffordable, and bought out early the late market is empty.
    rarity_min_round: dict[str, int]

    def deck_project_ids(self) -> list[str]:
        """Unique projects only: repeatable initiatives are always available and never drawn."""
        return [project.id for project in self.projects.values() if not project.repeatable]

    def repeatable_project_ids(self) -> list[str]:
        return [project.id for project in self.projects.values() if project.repeatable]

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
        if len(self.assets) < 6 or len(self.action_cards) < 3 or not self.events:
            raise StateValidationError("catalog does not contain enough cards/events to start a game")
        if len(self.deck_project_ids()) < PROJECT_BOARD_SIZE:
            raise StateValidationError(f"catalog needs at least {PROJECT_BOARD_SIZE} projects to fill the board")
        if tuple(sorted(self.repeatable_project_ids())) != tuple(sorted(REPEATABLE_PROJECT_IDS)):
            raise StateValidationError(
                "repeatable projects in the catalog must match REPEATABLE_PROJECT_IDS, "
                "which state validation uses to exempt them from the uniqueness rule"
            )
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
        raw["scoring"] = {
            "money_per_point": MONEY_PER_POINT,
            "influence_per_point": INFLUENCE_PER_POINT,
            "project_board_size": PROJECT_BOARD_SIZE,
            "market_reroll_cost": MARKET_REROLL_COST,
            "automation_cost": AUTOMATION_COST,
            "project_reroll_influence": PROJECT_REROLL_INFLUENCE,
            "crisis_pr_influence": CRISIS_PR_INFLUENCE,
            "action_card_cost": ACTION_CARD_COST,
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
    event_rows = _unique_by_id(raw["events"], "event")

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
                repeatable=bool(row.get("repeatable", False)),
            )
            for key, row in project_rows.items()
        },
        rarity_min_round={str(key): int(value) for key, value in raw["rarity_min_round"].items()},
        events={
            key: EventDefinition(
                id=row["id"],
                title=row["title"],
                text=row["text"],
                district=row.get("district"),
                income_multiplier=row.get("incomeMultiplier"),
                market_discount=int(row.get("marketDiscount", 0)),
                global_income=int(row.get("globalIncome", 0)),
                global_market_discount=int(row.get("globalMarketDiscount", 0)),
            )
            for key, row in event_rows.items()
        },
    )
    catalog.validate()
    return catalog
