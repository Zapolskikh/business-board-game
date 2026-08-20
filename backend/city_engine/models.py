"""JSON-safe state models for the authoritative City engine."""

from __future__ import annotations

from copy import copy, deepcopy
from dataclasses import dataclass, field
from typing import Any

from city_engine.constants import (
    BOT_DIFFICULTIES,
    CONTENT_VERSION,
    DISTRICT_IDS,
    MAX_CAPACITY,
    MAX_PLAYERS,
    MAX_ROLE_PRICE,
    MAX_ROUNDS,
    MIN_PLAYERS,
    MIN_ROLE_PRICE,
    MIN_ROUNDS,
    REPEATABLE_PROJECT_IDS,
    ROLE_IDS,
    RULES_VERSION,
    SCHEMA_VERSION,
)
from city_engine.errors import StateValidationError
from city_engine.rng import RNGState


def empty_district_levels() -> dict[str, int]:
    return {district: 0 for district in DISTRICT_IDS}


@dataclass(slots=True)
class OwnedAsset:
    """An object in a portfolio. Automation is no longer a property of the object.

    Per-object upgrades were a ritual: three or four identical purchases per player, and they
    welded value into objects that then could never be replaced. Automation is now a single
    the market or a player's tableau.
    """

    uid: str
    card_id: str
    blocked: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {"uid": self.uid, "card_id": self.card_id, "blocked": self.blocked}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OwnedAsset:
        return cls(
            uid=str(data["uid"]),
            card_id=str(data["card_id"]),
            blocked=bool(data.get("blocked", False)),
        )


@dataclass(slots=True)
class MarketAsset:
    uid: str
    card_id: str
    # The round this slot rotates out at, not a turn counter: players plan in rounds, and a
    # per-turn deadline expired before the reader's next turn at any table above two seats.
    expires_at_round: int

    def to_dict(self) -> dict[str, Any]:
        return {"uid": self.uid, "card_id": self.card_id, "expires_at_round": self.expires_at_round}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MarketAsset:
        return cls(
            uid=str(data["uid"]),
            card_id=str(data["card_id"]),
            expires_at_round=int(data["expires_at_round"]),
        )


@dataclass(slots=True)
class HeldCard:
    uid: str
    card_id: str

    def to_dict(self) -> dict[str, str]:
        return {"uid": self.uid, "card_id": self.card_id}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HeldCard:
        return cls(uid=str(data["uid"]), card_id=str(data["card_id"]))


@dataclass(slots=True)
class PlayerState:
    id: str
    name: str
    is_bot: bool = False
    difficulty: str = "medium"
    preferred_role: str | None = None
    money: int = 10
    influence: int = 2
    scandals: int = 0
    roofs: int = 0
    role: str | None = None
    jail_turns: int = 0
    assets: list[OwnedAsset] = field(default_factory=list)
    hand: list[HeldCard] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    # Points that come from neither projects nor objects — today the cards that buy score outright.
    # Deliberately one general field: a pseudo-project would have broken every project statistic.
    bonus_points: int = 0
    capacity: int = 3
    scandal_gained_this_round: int = 0
    debt: int = 0
    role_shields: int = 0
    scandal_shields: int = 0
    zoning_district: str | None = None
    district_levels: dict[str, int] = field(default_factory=empty_district_levels)
    turns: int = 0
    banked_actions: int = 0
    # Round in which this player last attempted a compromat leak. ``turn_flags`` cannot hold it:
    # they are cleared on every turn boundary, and the leak is limited per round, not per turn.
    compromat_round: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "is_bot": self.is_bot,
            "difficulty": self.difficulty,
            "preferred_role": self.preferred_role,
            "money": self.money,
            "influence": self.influence,
            "scandals": self.scandals,
            "roofs": self.roofs,
            "role": self.role,
            "jail_turns": self.jail_turns,
            "assets": [asset.to_dict() for asset in self.assets],
            "hand": [card.to_dict() for card in self.hand],
            "projects": list(self.projects),
            "bonus_points": self.bonus_points,
            "capacity": self.capacity,
            "scandal_gained_this_round": self.scandal_gained_this_round,
            "debt": self.debt,
            "role_shields": self.role_shields,
            "scandal_shields": self.scandal_shields,
            "zoning_district": self.zoning_district,
            "district_levels": dict(self.district_levels),
            "turns": self.turns,
            "banked_actions": self.banked_actions,
            "compromat_round": self.compromat_round,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PlayerState:
        return cls(
            id=str(data["id"]),
            name=str(data["name"]),
            is_bot=bool(data.get("is_bot", False)),
            difficulty=str(data.get("difficulty", "medium")),
            preferred_role=data.get("preferred_role"),
            money=int(data.get("money", 10)),
            influence=int(data.get("influence", 2)),
            scandals=int(data.get("scandals", 0)),
            roofs=int(data.get("roofs", 0)),
            role=data.get("role"),
            jail_turns=int(data.get("jail_turns", 0)),
            assets=[OwnedAsset.from_dict(item) for item in data.get("assets", [])],
            hand=[HeldCard.from_dict(item) for item in data.get("hand", [])],
            projects=[str(item) for item in data.get("projects", [])],
            bonus_points=int(data.get("bonus_points", 0)),
            capacity=int(data.get("capacity", 3)),
            scandal_gained_this_round=int(data.get("scandal_gained_this_round", 0)),
            debt=int(data.get("debt", 0)),
            role_shields=int(data.get("role_shields", 0)),
            scandal_shields=int(data.get("scandal_shields", 0)),
            zoning_district=data.get("zoning_district"),
            district_levels={key: int(value) for key, value in data.get("district_levels", {}).items()}
            or empty_district_levels(),
            turns=int(data.get("turns", 0)),
            banked_actions=int(data.get("banked_actions", 0)),
            compromat_round=int(data.get("compromat_round", 0)),
        )


@dataclass(slots=True)
class DomainEvent:
    seq: int
    type: str
    actor_id: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "type": self.type, "actor_id": self.actor_id, "data": dict(self.data)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DomainEvent:
        return cls(
            seq=int(data["seq"]),
            type=str(data["type"]),
            actor_id=data.get("actor_id"),
            data=dict(data.get("data") or {}),
        )


@dataclass(slots=True)
class GameState:
    game_id: str
    players: list[PlayerState]
    rng: RNGState
    max_rounds: int = 15
    role_price: int = 3
    schema_version: int = SCHEMA_VERSION
    rules_version: str = RULES_VERSION
    content_version: str = CONTENT_VERSION
    revision: int = 0
    status: str = "playing"
    round_number: int = 1
    starting_player_index: int = 0
    current_player_index: int = 0
    # Who plays when, recomputed every round from the standings: the trailing player opens the
    # round and gets first pick of the market. Empty only in legacy snapshots.
    turn_order: list[str] = field(default_factory=list)
    turns_taken_in_round: int = 0
    turn_serial: int = 0
    actions_left: int = 3
    event_id: str = "stable_year"
    market_deck: list[str] = field(default_factory=list)
    market: list[MarketAsset] = field(default_factory=list)
    action_deck: list[str] = field(default_factory=list)
    project_board: list[str] = field(default_factory=list)
    project_deck: list[str] = field(default_factory=list)
    turn_flags: dict[str, Any] = field(default_factory=dict)
    antitrust_active: bool = False
    final_scores: dict[str, int] = field(default_factory=dict)
    processed_command_ids: list[str] = field(default_factory=list)
    command_log: list[dict[str, Any]] = field(default_factory=list)
    event_log: list[DomainEvent] = field(default_factory=list)

    @property
    def current_player(self) -> PlayerState:
        return self.players[self.current_player_index]

    def player_by_id(self, player_id: str) -> PlayerState:
        for player in self.players:
            if player.id == player_id:
                return player
        raise KeyError(player_id)

    def clone(self) -> GameState:
        # Historical events are append-only, so sharing their immutable objects
        # avoids copying an ever-growing replay log for every legal-action preview.
        cloned = copy(self)
        cloned.players = deepcopy(self.players)
        cloned.rng = deepcopy(self.rng)
        cloned.market_deck = list(self.market_deck)
        cloned.market = deepcopy(self.market)
        cloned.action_deck = list(self.action_deck)
        cloned.project_board = list(self.project_board)
        cloned.project_deck = list(self.project_deck)
        cloned.turn_order = list(self.turn_order)
        cloned.turn_flags = deepcopy(self.turn_flags)
        cloned.final_scores = dict(self.final_scores)
        cloned.processed_command_ids = list(self.processed_command_ids)
        cloned.command_log = list(self.command_log)
        cloned.event_log = list(self.event_log)
        return cloned

    def append_event(self, event_type: str, actor_id: str | None = None, **data: Any) -> DomainEvent:
        event = DomainEvent(
            seq=self.event_log[-1].seq + 1 if self.event_log else 1,
            type=event_type,
            actor_id=actor_id,
            data=data,
        )
        self.event_log.append(event)
        return event

    def validate(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise StateValidationError(f"unsupported schema_version: {self.schema_version}")
        if self.rules_version != RULES_VERSION:
            raise StateValidationError(f"unsupported rules_version: {self.rules_version}")
        if self.content_version != CONTENT_VERSION:
            raise StateValidationError(f"unsupported content_version: {self.content_version}")
        if not MIN_PLAYERS <= len(self.players) <= MAX_PLAYERS:
            raise StateValidationError("a game must contain between 2 and 6 players")
        ids = [player.id for player in self.players]
        if len(ids) != len(set(ids)):
            raise StateValidationError("player ids must be unique")
        if not 0 <= self.current_player_index < len(self.players):
            raise StateValidationError("current_player_index is out of range")
        if not 0 <= self.starting_player_index < len(self.players):
            raise StateValidationError("starting_player_index is out of range")
        if self.revision < 0 or self.round_number < 1 or self.turn_serial < 0:
            raise StateValidationError("revision, round and turn counters must be non-negative")
        if self.status not in {"playing", "finished"}:
            raise StateValidationError(f"unknown game status: {self.status}")
        if not MIN_ROUNDS <= self.max_rounds <= MAX_ROUNDS:
            raise StateValidationError("max_rounds is outside supported bounds")
        if not MIN_ROLE_PRICE <= self.role_price <= MAX_ROLE_PRICE:
            raise StateValidationError("role_price is outside supported bounds")
        if self.final_scores and set(self.final_scores) != set(ids):
            raise StateValidationError("final scores must contain every player exactly once")
        if self.turn_order and sorted(self.turn_order) != sorted(ids):
            raise StateValidationError("turn order must contain every player exactly once")
        if self.turn_order and self.turn_order[self.turns_taken_in_round] != ids[self.current_player_index]:
            raise StateValidationError("current player must match the turn order position")
        # Repeatable initiatives are deliberately exempt: they never enter the deck and may be
        # taken again by anybody, so only the unique projects have to be globally unique.
        project_ids = [*self.project_board, *self.project_deck]
        for player in self.players:
            project_ids.extend(player.projects)
        deck_ids = [item for item in project_ids if item not in REPEATABLE_PROJECT_IDS]
        if len(deck_ids) != len(set(deck_ids)):
            raise StateValidationError("every unique city project may exist only once")

        all_uids: list[str] = [item.uid for item in self.market]
        held_roles = [player.role for player in self.players if player.role is not None]
        if len(held_roles) != len(set(held_roles)):
            raise StateValidationError("permanent roles must be unique")
        for player in self.players:
            if player.difficulty not in BOT_DIFFICULTIES:
                raise StateValidationError(f"unknown bot difficulty: {player.difficulty}")
            for role in (player.role, player.preferred_role):
                if role is not None and role not in ROLE_IDS:
                    raise StateValidationError(f"unknown role: {role}")
            if player.capacity < 3 or player.capacity > MAX_CAPACITY:
                raise StateValidationError(f"invalid capacity for {player.id}")
            if len(player.assets) > player.capacity:
                raise StateValidationError(f"player {player.id} owns more assets than capacity")
            if set(player.district_levels) != set(DISTRICT_IDS):
                raise StateValidationError(f"district levels are incomplete for {player.id}")
            if any(level < 0 or level > 2 for level in player.district_levels.values()):
                raise StateValidationError(f"invalid district level for {player.id}")
            if min(player.money, player.influence, player.scandals, player.roofs) < 0:
                raise StateValidationError(f"negative public resource for {player.id}")
            all_uids.extend(asset.uid for asset in player.assets)
            all_uids.extend(card.uid for card in player.hand)
        if len(all_uids) != len(set(all_uids)):
            raise StateValidationError("market, asset and held-card uids must be globally unique")

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "rules_version": self.rules_version,
            "content_version": self.content_version,
            "game_id": self.game_id,
            "revision": self.revision,
            "status": self.status,
            "max_rounds": self.max_rounds,
            "role_price": self.role_price,
            "round_number": self.round_number,
            "starting_player_index": self.starting_player_index,
            "turn_order": list(self.turn_order),
            "current_player_index": self.current_player_index,
            "turns_taken_in_round": self.turns_taken_in_round,
            "turn_serial": self.turn_serial,
            "actions_left": self.actions_left,
            "event_id": self.event_id,
            "players": [player.to_dict() for player in self.players],
            "market_deck": list(self.market_deck),
            "market": [item.to_dict() for item in self.market],
            "action_deck": list(self.action_deck),
            "project_board": list(self.project_board),
            "project_deck": list(self.project_deck),
            "turn_flags": deepcopy(self.turn_flags),
            "antitrust_active": self.antitrust_active,
            "final_scores": dict(self.final_scores),
            "processed_command_ids": list(self.processed_command_ids),
            "command_log": deepcopy(self.command_log),
            "event_log": [event.to_dict() for event in self.event_log],
            "rng": self.rng.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GameState:
        state = cls(
            schema_version=int(data["schema_version"]),
            rules_version=str(data["rules_version"]),
            content_version=str(data["content_version"]),
            game_id=str(data["game_id"]),
            revision=int(data.get("revision", 0)),
            status=str(data.get("status", "playing")),
            max_rounds=int(data.get("max_rounds", 15)),
            role_price=int(data.get("role_price", 3)),
            round_number=int(data.get("round_number", 1)),
            starting_player_index=int(data.get("starting_player_index", 0)),
            turn_order=[str(item) for item in data.get("turn_order", [])],
            current_player_index=int(data.get("current_player_index", 0)),
            turns_taken_in_round=int(data.get("turns_taken_in_round", 0)),
            turn_serial=int(data.get("turn_serial", 0)),
            actions_left=int(data.get("actions_left", 3)),
            event_id=str(data.get("event_id", "stable_year")),
            players=[PlayerState.from_dict(item) for item in data["players"]],
            market_deck=[str(item) for item in data.get("market_deck", [])],
            market=[MarketAsset.from_dict(item) for item in data.get("market", [])],
            action_deck=[str(item) for item in data.get("action_deck", [])],
            project_board=[str(item) for item in data.get("project_board", [])],
            project_deck=[str(item) for item in data.get("project_deck", [])],
            turn_flags=dict(data.get("turn_flags") or {}),
            antitrust_active=bool(data.get("antitrust_active", False)),
            final_scores={str(key): int(value) for key, value in (data.get("final_scores") or {}).items()},
            processed_command_ids=[str(item) for item in data.get("processed_command_ids", [])],
            command_log=[dict(item) for item in data.get("command_log", [])],
            event_log=[DomainEvent.from_dict(item) for item in data.get("event_log", [])],
            rng=RNGState.from_dict(data["rng"]),
        )
        state.validate()
        return state


@dataclass(slots=True)
class Transition:
    state: GameState
    events: list[DomainEvent]
