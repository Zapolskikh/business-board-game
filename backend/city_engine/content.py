"""Typed access to the versioned, backend-owned City content catalog."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from city_engine.constants import CONTENT_VERSION, DISTRICT_IDS, ROLE_IDS
from city_engine.errors import StateValidationError

CATALOG_PATH = Path(__file__).with_name("content") / "catalog.json"
RARITIES = {"common", "uncommon", "rare", "epic", "legendary"}


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
    events: dict[str, EventDefinition]

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
        """JSON-safe catalog sent to React; no runtime state or deck order."""
        with CATALOG_PATH.open(encoding="utf-8") as handle:
            return json.load(handle)


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
