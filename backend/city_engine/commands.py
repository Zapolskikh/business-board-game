"""Transport-neutral command envelope used by humans, bots and simulations."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from city_engine.errors import InvalidCommandError


@dataclass(frozen=True, slots=True)
class Command:
    type: str
    actor_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    command_id: str | None = None
    expected_revision: int | None = None

    def __post_init__(self) -> None:
        if not self.type or not self.type.strip():
            raise InvalidCommandError("command type is required")
        if not self.actor_id or not self.actor_id.strip():
            raise InvalidCommandError("actor_id is required")
        if self.expected_revision is not None and self.expected_revision < 0:
            raise InvalidCommandError("expected_revision must be non-negative")

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "actor_id": self.actor_id,
            "payload": dict(self.payload),
            "command_id": self.command_id,
            "expected_revision": self.expected_revision,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Command:
        return cls(
            type=str(data.get("type", "")),
            actor_id=str(data.get("actor_id", "")),
            payload=dict(data.get("payload") or {}),
            command_id=str(data["command_id"]) if data.get("command_id") else None,
            expected_revision=int(data["expected_revision"]) if data.get("expected_revision") is not None else None,
        )
