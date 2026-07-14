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
    uid: str
    card_id: str
    automated: bool = False
    scaled: bool = False
    blocked: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "uid": self.uid,
            "card_id": self.card_id,
            "automated": self.automated,
            "scaled": self.scaled,
            "blocked": self.blocked,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OwnedAsset:
        return cls(
            uid=str(data["uid"]),
            card_id=str(data["card_id"]),
            automated=bool(data.get("automated", False)),
            scaled=bool(data.get("scaled", False)),
            blocked=bool(data.get("blocked", False)),
        )


@dataclass(slots=True)
class MarketAsset:
    uid: str
    card_id: str
    expires_at_turn: int

    def to_dict(self) -> dict[str, Any]:
        return {"uid": self.uid, "card_id": self.card_id, "expires_at_turn": self.expires_at_turn}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MarketAsset:
        return cls(
            uid=str(data["uid"]),
            card_id=str(data["card_id"]),
            expires_at_turn=int(data["expires_at_turn"]),
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
class PendingDecision:
    id: str
    actor_id: str
    type: str
    options: list[str]
    context: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "actor_id": self.actor_id,
            "type": self.type,
            "options": list(self.options),
            "context": deepcopy(self.context),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PendingDecision:
        return cls(
            id=str(data["id"]),
            actor_id=str(data["actor_id"]),
            type=str(data["type"]),
            options=[str(option) for option in data["options"]],
            context=dict(data.get("context") or {}),
        )


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
    copied_role: str | None = None
    pending_role: str | None = None
    jail_turns: int = 0
    assets: list[OwnedAsset] = field(default_factory=list)
    hand: list[HeldCard] = field(default_factory=list)
    projects: int = 0
    capacity: int = 3
    scandal_gained_this_round: int = 0
    debt: int = 0
    role_shields: int = 0
    scandal_shields: int = 0
    zoning_district: str | None = None
    district_levels: dict[str, int] = field(default_factory=empty_district_levels)
    turns: int = 0
    banked_actions: int = 0

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
            "copied_role": self.copied_role,
            "pending_role": self.pending_role,
            "jail_turns": self.jail_turns,
            "assets": [asset.to_dict() for asset in self.assets],
            "hand": [card.to_dict() for card in self.hand],
            "projects": self.projects,
            "capacity": self.capacity,
            "scandal_gained_this_round": self.scandal_gained_this_round,
            "debt": self.debt,
            "role_shields": self.role_shields,
            "scandal_shields": self.scandal_shields,
            "zoning_district": self.zoning_district,
            "district_levels": dict(self.district_levels),
            "turns": self.turns,
            "banked_actions": self.banked_actions,
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
            copied_role=data.get("copied_role"),
            pending_role=data.get("pending_role"),
            jail_turns=int(data.get("jail_turns", 0)),
            assets=[OwnedAsset.from_dict(item) for item in data.get("assets", [])],
            hand=[HeldCard.from_dict(item) for item in data.get("hand", [])],
            projects=int(data.get("projects", 0)),
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
    turns_taken_in_round: int = 0
    turn_serial: int = 0
    actions_left: int = 3
    investment_actions: int = 0
    event_id: str = "stable_year"
    market_deck: list[str] = field(default_factory=list)
    market: list[MarketAsset] = field(default_factory=list)
    action_deck: list[str] = field(default_factory=list)
    action_market: list[str] = field(default_factory=list)
    turn_flags: dict[str, Any] = field(default_factory=dict)
    antitrust_active: bool = False
    pending_decision: PendingDecision | None = None
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
        cloned.action_market = list(self.action_market)
        cloned.turn_flags = deepcopy(self.turn_flags)
        cloned.final_scores = dict(self.final_scores)
        cloned.processed_command_ids = list(self.processed_command_ids)
        cloned.command_log = list(self.command_log)
        cloned.event_log = list(self.event_log)
        cloned.pending_decision = deepcopy(self.pending_decision)
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
        if self.pending_decision is not None:
            if self.pending_decision.actor_id not in ids:
                raise StateValidationError("pending decision actor is not a player")
            if not self.pending_decision.options or len(self.pending_decision.options) != len(
                set(self.pending_decision.options)
            ):
                raise StateValidationError("pending decision options must be non-empty and unique")
        if self.final_scores and set(self.final_scores) != set(ids):
            raise StateValidationError("final scores must contain every player exactly once")

        all_uids: list[str] = [item.uid for item in self.market]
        held_roles = [player.role for player in self.players if player.role is not None]
        if len(held_roles) != len(set(held_roles)):
            raise StateValidationError("permanent roles must be unique")
        for player in self.players:
            if player.difficulty not in BOT_DIFFICULTIES:
                raise StateValidationError(f"unknown bot difficulty: {player.difficulty}")
            for role in (player.role, player.copied_role, player.pending_role, player.preferred_role):
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
            "current_player_index": self.current_player_index,
            "turns_taken_in_round": self.turns_taken_in_round,
            "turn_serial": self.turn_serial,
            "actions_left": self.actions_left,
            "investment_actions": self.investment_actions,
            "event_id": self.event_id,
            "players": [player.to_dict() for player in self.players],
            "market_deck": list(self.market_deck),
            "market": [item.to_dict() for item in self.market],
            "action_deck": list(self.action_deck),
            "action_market": list(self.action_market),
            "turn_flags": deepcopy(self.turn_flags),
            "antitrust_active": self.antitrust_active,
            "pending_decision": self.pending_decision.to_dict() if self.pending_decision else None,
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
            current_player_index=int(data.get("current_player_index", 0)),
            turns_taken_in_round=int(data.get("turns_taken_in_round", 0)),
            turn_serial=int(data.get("turn_serial", 0)),
            actions_left=int(data.get("actions_left", 3)),
            investment_actions=int(data.get("investment_actions", 0)),
            event_id=str(data.get("event_id", "stable_year")),
            players=[PlayerState.from_dict(item) for item in data["players"]],
            market_deck=[str(item) for item in data.get("market_deck", [])],
            market=[MarketAsset.from_dict(item) for item in data.get("market", [])],
            action_deck=[str(item) for item in data.get("action_deck", [])],
            action_market=[str(item) for item in data.get("action_market", [])],
            turn_flags=dict(data.get("turn_flags") or {}),
            antitrust_active=bool(data.get("antitrust_active", False)),
            pending_decision=(
                PendingDecision.from_dict(data["pending_decision"]) if data.get("pending_decision") else None
            ),
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
