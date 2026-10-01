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
    ACTION_DECK_COPIES,
    CAMPAIGN_TIERS,
    CAPACITY_COSTS,
    CAPACITY_INFLUENCE,
    CARD_DISCARD_INFLUENCE,
    CARD_DISCARD_MONEY,
    CONTENT_VERSION,
    CRISIS_PR_INFLUENCE,
    DISTRICT_IDS,
    FRAUDSTER_GREY_ROLL,
    GREY_DIE_SIDES,
    GREY_ROLL_CAP,
    GREY_SCANDALS,
    GREY_SCANDALS_BY_OPERATION,
    HACK_INFLUENCE,
    LEAK_INFLUENCE,
    LEAK_STRIPS_ROLE,
    LEAK_TARGET_SCANDALS,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MAFIA_GREY_ROLL_MAX,
    MAFIA_GREY_ROLL_PER_OBJECT,
    MARKET_ROTATION_SIZE,
    MAX_CAPACITY,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
    PROJECT_BOARD_SIZE,
    PROJECT_REROLL_MONEY,
    PUMP_MONEY_EACH,
    ROLE_IDS,
    ROOF_BREAK_INFLUENCE_PER_ROOF,
    SMEAR_INFLUENCE_PER_HIT,
    UNDERDOG_INFLUENCE,
)
from city_engine.errors import StateValidationError

CATALOG_PATH = Path(__file__).with_name("content") / "catalog.json"
RARITIES = {"common", "uncommon", "rare", "epic", "legendary"}


def asset_points(cost: int) -> int:
    """Final-scoring points an object is worth, and what selling it pays back: half its price.

    Lives here rather than in the engine because the number has to reach the card: an object turns
    money into points at 2$ each, while a hoarded dollar scores nothing, which makes
    "sell the weak one, buy the dear one" the strongest late money sink in the game. Clients that
    derive `floor(cost / 2)` themselves put the rate on screen nowhere and duplicate it in three
    places.
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
    # How many copies the deck holds. Printed on the card rather than fixed for the whole deck: the
    # cards that are only ever used to take a Защита off a rival come in threes, the rest in pairs.
    copies: int = ACTION_DECK_COPIES


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

        No repeatable initiative sits outside the deck as an always-open scoring outlet: it would
        be a second, weaker answer to the question patronage and lobbying already answer — turning
        a pile into points.
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
            "lobbying_influence": LOBBYING_INFLUENCE,
            "lobbying_points": LOBBYING_POINTS,
            "patronage_money": PATRONAGE_MONEY,
            "patronage_points": PATRONAGE_POINTS,
            "crisis_pr_influence": CRISIS_PR_INFLUENCE,
            "action_card_cost": ACTION_CARD_COST,
            # What a discarded card pays back, one figure per currency. The client had "+1" written
            # into a label while the engine paid 2, so the line was mislabelled on screen.
            "card_discard_money": CARD_DISCARD_MONEY,
            "card_discard_influence": CARD_DISCARD_INFLUENCE,
            # Campaign tiers travel as pairs so the client renders one button per tier without
            # knowing the rates; a dict would arrive with string keys through JSON.
            "campaign_tiers": [{"spend": spend, "gain": gain} for spend, gain in sorted(CAMPAIGN_TIERS.items())],
            # The grey die. The face-by-face table of every operation is computed for the viewer and
            # ships with the game view (``grey_tables``); these are the constants the rules quote.
            "grey_die_sides": GREY_DIE_SIDES,
            "grey_roll_cap": GREY_ROLL_CAP,
            "fraudster_grey_roll": FRAUDSTER_GREY_ROLL,
            "mafia_grey_roll_per_object": MAFIA_GREY_ROLL_PER_OBJECT,
            "mafia_grey_roll_max": MAFIA_GREY_ROLL_MAX,
            "underdog_influence": UNDERDOG_INFLUENCE,
            # Face by face, per third of the game: what the rules book prints. The panel gets the
            # same rows already recomputed for the viewer, in the game view.
            "grey_faces": grey_faces_meta(),
            # What the next city slot costs, keyed by the capacity the player has now. The React
            # client kept its own copy of this table and printed the wrong price the moment the
            # ladder changed; the engine owns the ladder, so the engine ships it.
            "capacity_costs": {str(capacity): cost for capacity, cost in sorted(CAPACITY_COSTS.items())},
            "capacity_influence": {str(capacity): cost for capacity, cost in sorted(CAPACITY_INFLUENCE.items())},
            "max_capacity": MAX_CAPACITY,
        }
        return raw


GREY_OPERATION_IDS = ("smear", "crypto", "roof_break", "datacenter", "influence_broker")


def grey_face_effect(asset_id: str, face: int, third: int) -> dict[str, Any]:
    """The printed effect of one face of a grey operation, for one third of the game.

    Pure, so the engine resolves with it, the panel draws it and the rules book prints it from the
    same table.
    """
    index = face - 1
    if asset_id == "smear":
        return {"scandal_each": int(face >= 3), "influence_per_hit": SMEAR_INFLUENCE_PER_HIT[index]}
    if asset_id == "crypto":
        return {"money_each": PUMP_MONEY_EACH[third][index]}
    if asset_id == "datacenter":
        return {"influence": HACK_INFLUENCE[third][index]}
    if asset_id == "influence_broker":
        return {
            "target_scandals": LEAK_TARGET_SCANDALS[index],
            "strip_role": LEAK_STRIPS_ROLE[index],
            "influence": LEAK_INFLUENCE[index],
        }
    if asset_id == "roof_break":
        return {"strip_roofs": face >= 3, "influence_per_roof": ROOF_BREAK_INFLUENCE_PER_ROOF[index]}
    raise StateValidationError(f"unknown grey operation: {asset_id}")


def grey_faces_meta() -> dict[str, Any]:
    """Every operation's die for the rules book: scandals per face and effects per third."""
    return {
        asset_id: {
            "scandals": list(GREY_SCANDALS_BY_OPERATION.get(asset_id, GREY_SCANDALS)),
            "effects": [
                [grey_face_effect(asset_id, face, third) for face in range(1, GREY_DIE_SIDES + 1)] for third in range(3)
            ],
        }
        for asset_id in GREY_OPERATION_IDS
    }


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
                copies=int(row.get("copies", ACTION_DECK_COPIES)),
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
