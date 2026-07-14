"""Use cases shared by REST handlers and future administrative tools."""

from __future__ import annotations

import re
import secrets
from copy import deepcopy

from city_bots import choose_bot_command
from city_engine.commands import Command
from city_engine.engine import CityEngine
from city_engine.errors import CityEngineError, StaleRevisionError
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_rooms.errors import RoomAccessError, RoomConflictError, RoomValidationError
from city_rooms.models import RoomSeat, RoomState
from city_rooms.repository import RoomRepository
from city_rooms.security import hash_password, verify_password

_ROOM_NAME_RE = re.compile(r"\s+")


class CityRoomService:
    def __init__(self, repository: RoomRepository, engine: CityEngine | None = None) -> None:
        self.repository = repository
        self.engine = engine or CityEngine()

    def create_room(
        self,
        *,
        name: str,
        password: str,
        capacity: int = 4,
        max_rounds: int = 15,
        role_price: int = 3,
    ) -> RoomState:
        clean_name = _ROOM_NAME_RE.sub(" ", name).strip()
        if not 1 <= len(clean_name) <= 48:
            raise RoomValidationError("room name must contain 1-48 characters")
        if not 2 <= capacity <= 6:
            raise RoomValidationError("capacity must be between 2 and 6")
        if not 5 <= max_rounds <= 30:
            raise RoomValidationError("max_rounds must be between 5 and 30")
        if not 2 <= role_price <= 10:
            raise RoomValidationError("role_price must be between 2 and 10")
        try:
            password_hash = hash_password(password)
        except ValueError as exc:
            raise RoomValidationError(str(exc)) from exc
        room = RoomState(
            id=secrets.token_urlsafe(8),
            name=clean_name,
            password_hash=password_hash,
            seats=[RoomSeat(index=index) for index in range(capacity)],
            max_rounds=max_rounds,
            role_price=role_price,
        )
        self.repository.create(room)
        return room

    def list_rooms(self, limit: int = 50) -> list[RoomState]:
        return self.repository.list_active(min(max(limit, 1), 100))

    def get_room(self, room_id: str) -> RoomState:
        return self.repository.get(room_id)

    def get_revision(self, room_id: str) -> int:
        return self.repository.get_revision(room_id)

    def delete_room(self, room_id: str, *, password: str) -> None:
        room = self.repository.get(room_id)
        self._authorize(room, password)
        self.repository.delete(room_id)

    def authorize_viewer(self, room: RoomState, password: str, viewer_id: str | None) -> None:
        """Authorize a private game projection without exposing bot-only seats."""
        self._authorize(room, password)
        if viewer_id is None:
            return
        seat = next((item for item in room.seats if item.player_id == viewer_id), None)
        if seat is None or seat.kind != "human":
            raise RoomAccessError("viewer must select an occupied human seat")

    def join(self, room_id: str, *, password: str, seat_index: int, player_name: str) -> RoomState:
        room = self.repository.get(room_id)
        expected = room.revision
        self._authorize(room, password)
        seat = self._seat(room, seat_index)
        clean_name = _ROOM_NAME_RE.sub(" ", player_name).strip()
        if not 1 <= len(clean_name) <= 32:
            raise RoomValidationError("player name must contain 1-32 characters")
        if seat.kind == "bot":
            raise RoomConflictError("a bot occupies this seat")
        if room.status != "waiting" and seat.kind != "human":
            raise RoomConflictError("after start, only an existing human seat can be selected")
        if seat.kind == "empty":
            seat.kind = "human"
            seat.player_id = f"seat-{seat.index + 1}"
            seat.name = clean_name
        room.touch()
        self.repository.save(room, expected)
        return room

    def set_bot(
        self,
        room_id: str,
        *,
        password: str,
        seat_index: int,
        difficulty: str,
        preferred_role: str | None = None,
    ) -> RoomState:
        room = self.repository.get(room_id)
        expected = room.revision
        self._authorize(room, password)
        self._waiting(room)
        seat = self._seat(room, seat_index)
        if seat.kind == "human":
            raise RoomConflictError("a human occupies this seat")
        seat.kind = "bot"
        seat.player_id = f"seat-{seat.index + 1}"
        seat.name = f"Bot {seat.index + 1}"
        seat.difficulty = difficulty
        seat.preferred_role = preferred_role
        try:
            seat.validate()
        except ValueError as exc:
            raise RoomValidationError(str(exc)) from exc
        room.touch()
        self.repository.save(room, expected)
        return room

    def clear_seat(self, room_id: str, *, password: str, seat_index: int) -> RoomState:
        room = self.repository.get(room_id)
        expected = room.revision
        self._authorize(room, password)
        self._waiting(room)
        self._seat(room, seat_index)
        room.seats[seat_index] = RoomSeat(index=seat_index)
        room.touch()
        self.repository.save(room, expected)
        return room

    def start(self, room_id: str, *, password: str, seed: int | None = None) -> RoomState:
        room = self.repository.get(room_id)
        expected = room.revision
        self._authorize(room, password)
        self._waiting(room)
        occupied = [seat for seat in room.seats if seat.kind != "empty"]
        if len(occupied) < 2:
            raise RoomValidationError("at least two occupied seats are required")
        if not any(seat.kind == "human" for seat in occupied):
            raise RoomValidationError("a playable room requires at least one human seat")
        players = [
            PlayerSetup(
                id=seat.player_id or "",
                name=seat.name or "",
                is_bot=seat.kind == "bot",
                difficulty=seat.difficulty,
                preferred_role=seat.preferred_role,
            )
            for seat in occupied
        ]
        room.game = create_game_from_catalog(
            room.id,
            players,
            seed=seed if seed is not None else secrets.randbits(32),
            settings=GameSettings(max_rounds=room.max_rounds, role_price=room.role_price),
        )
        room.status = "playing"
        self._advance_bots(room)
        room.touch()
        self.repository.save(room, expected)
        return room

    def apply_command(self, room_id: str, *, password: str, command: Command) -> RoomState:
        room = self.repository.get(room_id)
        expected = room.revision
        self._authorize(room, password)
        if room.status != "playing" or room.game is None:
            raise RoomValidationError("room is not playing")
        seat = next((seat for seat in room.seats if seat.player_id == command.actor_id), None)
        if seat is None or seat.kind != "human":
            raise RoomAccessError("commands require an occupied human seat")
        try:
            transition = self.engine.apply(room.game, command)
        except StaleRevisionError as exc:
            raise RoomConflictError(str(exc)) from exc
        except CityEngineError as exc:
            raise RoomValidationError(str(exc)) from exc
        room.game = transition.state
        self._advance_bots(room)
        if room.game.status == "finished":
            room.status = "finished"
        room.touch()
        self.repository.save(room, expected)
        return room

    def _advance_bots(self, room: RoomState) -> None:
        if room.game is None:
            return
        for _ in range(500):
            game = room.game
            if game.status == "finished":
                room.status = "finished"
                return
            actor_id = game.pending_decision.actor_id if game.pending_decision is not None else game.current_player.id
            seat = next((item for item in room.seats if item.player_id == actor_id), None)
            if seat is None:
                raise RoomValidationError(f"game player {actor_id} has no room seat")
            if seat.kind != "bot":
                return
            decision = choose_bot_command(self.engine, game, actor_id)
            room.game = self.engine.apply(game, decision.command).state
        raise RoomValidationError("bot execution guard reached; possible policy loop")

    @staticmethod
    def _authorize(room: RoomState, password: str) -> None:
        if not verify_password(password, room.password_hash):
            raise RoomAccessError("invalid room password")

    @staticmethod
    def _waiting(room: RoomState) -> None:
        if room.status != "waiting":
            raise RoomValidationError("room has already started")

    @staticmethod
    def _seat(room: RoomState, seat_index: int) -> RoomSeat:
        if not 0 <= seat_index < len(room.seats):
            raise RoomValidationError("seat index is out of range")
        return room.seats[seat_index]

    @staticmethod
    def clone(room: RoomState) -> RoomState:
        return deepcopy(room)
