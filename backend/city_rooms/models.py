"""Serializable room and lobby models."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from city_engine.constants import BOT_DIFFICULTIES, MAX_PLAYERS, MIN_PLAYERS, ROLE_IDS
from city_engine.models import GameState
from city_engine.serialization import canonical_json


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class RoomSeat:
    index: int
    kind: str = "empty"
    player_id: str | None = None
    name: str | None = None
    difficulty: str = "medium"
    preferred_role: str | None = None

    def validate(self) -> None:
        if self.kind not in {"empty", "human", "bot"}:
            raise ValueError(f"unknown seat kind: {self.kind}")
        if self.kind == "empty":
            if self.player_id is not None or self.name is not None:
                raise ValueError("an empty seat cannot have an occupant")
        elif not self.player_id or not self.name or not self.name.strip():
            raise ValueError("an occupied seat needs player_id and name")
        if self.difficulty not in BOT_DIFFICULTIES:
            raise ValueError(f"unknown bot difficulty: {self.difficulty}")
        if self.preferred_role is not None and self.preferred_role not in ROLE_IDS:
            raise ValueError(f"unknown preferred role: {self.preferred_role}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "kind": self.kind,
            "player_id": self.player_id,
            "name": self.name,
            "difficulty": self.difficulty,
            "preferred_role": self.preferred_role,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RoomSeat:
        return cls(
            index=int(data["index"]),
            kind=str(data.get("kind", "empty")),
            player_id=data.get("player_id"),
            name=data.get("name"),
            difficulty=str(data.get("difficulty", "medium")),
            preferred_role=data.get("preferred_role"),
        )


@dataclass(slots=True)
class RoomState:
    id: str
    name: str
    password_hash: str
    seats: list[RoomSeat]
    max_rounds: int = 15
    role_price: int = 3
    status: str = "waiting"
    revision: int = 0
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    game: GameState | None = None

    def validate(self) -> None:
        if not self.id or not self.name.strip():
            raise ValueError("room id and name are required")
        if self.status not in {"waiting", "playing", "finished"}:
            raise ValueError(f"unknown room status: {self.status}")
        if not MIN_PLAYERS <= len(self.seats) <= MAX_PLAYERS:
            raise ValueError(f"a room must contain {MIN_PLAYERS}-{MAX_PLAYERS} seats")
        if [seat.index for seat in self.seats] != list(range(len(self.seats))):
            raise ValueError("seat indexes must be contiguous")
        for seat in self.seats:
            seat.validate()
        ids = [seat.player_id for seat in self.seats if seat.player_id]
        if len(ids) != len(set(ids)):
            raise ValueError("room player ids must be unique")
        if self.status == "waiting" and self.game is not None:
            raise ValueError("a waiting room cannot contain a game")
        if self.status in {"playing", "finished"} and self.game is None:
            raise ValueError("a started room must contain a game")
        if self.game is not None:
            self.game.validate()

    def touch(self) -> None:
        self.revision += 1
        self.updated_at = utc_now()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "password_hash": self.password_hash,
            "seats": [seat.to_dict() for seat in self.seats],
            "max_rounds": self.max_rounds,
            "role_price": self.role_price,
            "status": self.status,
            "revision": self.revision,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "game": self.game.to_dict() if self.game else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RoomState:
        state = cls(
            id=str(data["id"]),
            name=str(data["name"]),
            password_hash=str(data["password_hash"]),
            seats=[RoomSeat.from_dict(item) for item in data["seats"]],
            max_rounds=int(data.get("max_rounds", 15)),
            role_price=int(data.get("role_price", 3)),
            status=str(data.get("status", "waiting")),
            revision=int(data.get("revision", 0)),
            created_at=str(data["created_at"]),
            updated_at=str(data["updated_at"]),
            game=GameState.from_dict(data["game"]) if data.get("game") else None,
        )
        state.validate()
        return state

    def to_json(self) -> str:
        return canonical_json(self.to_dict())

    def public_summary(self) -> dict[str, Any]:
        occupied = sum(seat.kind != "empty" for seat in self.seats)
        humans = sum(seat.kind == "human" for seat in self.seats)
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "revision": self.revision,
            "players": occupied,
            "humans": humans,
            "capacity": len(self.seats),
            "updated_at": self.updated_at,
        }
