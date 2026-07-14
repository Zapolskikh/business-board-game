"""Storage boundary for rooms and an in-process implementation for tests/dev."""

from __future__ import annotations

from copy import deepcopy
from threading import RLock
from typing import Protocol

from city_rooms.errors import RoomConflictError, RoomNotFoundError
from city_rooms.models import RoomState


class RoomRepository(Protocol):
    def create(self, room: RoomState) -> None: ...

    def get(self, room_id: str) -> RoomState: ...

    def get_revision(self, room_id: str) -> int: ...

    def list_active(self, limit: int = 50) -> list[RoomState]: ...

    def save(self, room: RoomState, expected_revision: int) -> None: ...


class InMemoryRoomRepository:
    """Thread-safe repository with the same optimistic-lock contract as Redis."""

    def __init__(self) -> None:
        self._rooms: dict[str, RoomState] = {}
        self._lock = RLock()

    def create(self, room: RoomState) -> None:
        room.validate()
        with self._lock:
            if room.id in self._rooms:
                raise RoomConflictError("room id already exists")
            self._rooms[room.id] = deepcopy(room)

    def get(self, room_id: str) -> RoomState:
        with self._lock:
            try:
                return deepcopy(self._rooms[room_id])
            except KeyError as exc:
                raise RoomNotFoundError("room not found") from exc

    def get_revision(self, room_id: str) -> int:
        with self._lock:
            try:
                return self._rooms[room_id].revision
            except KeyError as exc:
                raise RoomNotFoundError("room not found") from exc

    def list_active(self, limit: int = 50) -> list[RoomState]:
        with self._lock:
            rooms = [room for room in self._rooms.values() if room.status != "finished"]
            rooms.sort(key=lambda room: room.updated_at, reverse=True)
            return deepcopy(rooms[:limit])

    def save(self, room: RoomState, expected_revision: int) -> None:
        room.validate()
        with self._lock:
            current = self._rooms.get(room.id)
            if current is None:
                raise RoomNotFoundError("room not found")
            if current.revision != expected_revision:
                raise RoomConflictError("room changed; reload and retry")
            if room.revision != expected_revision + 1:
                raise RoomConflictError("saved room must increment revision exactly once")
            self._rooms[room.id] = deepcopy(room)
