"""Game events.

Every state change the engine performs is accompanied by a :class:`GameEvent`.
Events are the human-readable narrative of a turn ("Игрок бросил 5", "Купил
Казино за 300") and are returned to clients and collected for simulation logs.

Messages are in Russian to match the design document and the target UI.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class GameEvent:
    """A single, immutable record of something that happened."""

    type: str
    """Machine-readable event key, e.g. ``dice_rolled``, ``money_gained``."""

    message: str
    """Human-readable Russian description for the log/UI."""

    player_id: str | None = None
    """Player the event primarily concerns, if any."""

    data: dict[str, Any] = field(default_factory=dict)
    """Structured payload (amounts, targets, cell ids) for the UI / analytics."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "message": self.message,
            "player_id": self.player_id,
            "data": self.data,
        }


class EventLog:
    """Accumulates events for a game; the engine appends, clients read."""

    def __init__(self) -> None:
        self._events: list[GameEvent] = []

    def add(
        self,
        type: str,
        message: str,
        player_id: str | None = None,
        **data: Any,
    ) -> GameEvent:
        event = GameEvent(type=type, message=message, player_id=player_id, data=dict(data))
        self._events.append(event)
        return event

    def extend(self, events: list[GameEvent]) -> None:
        self._events.extend(events)

    @property
    def events(self) -> list[GameEvent]:
        return self._events

    def since(self, index: int) -> list[GameEvent]:
        """Return events added after ``index`` (used to report per-action deltas)."""
        return self._events[index:]

    def __len__(self) -> int:
        return len(self._events)
