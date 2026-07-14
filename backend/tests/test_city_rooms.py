from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

from city_engine.commands import Command
from city_rooms.errors import RoomAccessError, RoomConflictError, RoomNotFoundError
from city_rooms.models import RoomState
from city_rooms.repository import InMemoryRoomRepository
from city_rooms.security import hash_password, verify_password
from city_rooms.service import CityRoomService
from city_rooms.upstash import UpstashRoomRepository
from city_rooms.views import room_view


def create_started_room() -> tuple[CityRoomService, str]:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Test city", password="secret", capacity=3)
    service.join(room.id, password="secret", seat_index=0, player_name="Oleg")
    service.set_bot(room.id, password="secret", seat_index=1, difficulty="hard", preferred_role="mafia")
    service.start(room.id, password="secret", seed=42)
    return service, room.id


def test_password_is_salted_and_verified() -> None:
    first = hash_password("secret")
    second = hash_password("secret")
    assert first != second
    assert verify_password("secret", first)
    assert not verify_password("wrong", first)


def test_lobby_can_join_add_bot_and_start() -> None:
    service, room_id = create_started_room()
    room = service.get_room(room_id)
    assert room.status == "playing"
    assert room.game is not None
    assert [(player.name, player.is_bot) for player in room.game.players] == [("Oleg", False), ("Bot 2", True)]
    assert room.game.players[1].preferred_role == "mafia"


def test_wrong_password_cannot_join() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Private", password="secret")
    with pytest.raises(RoomAccessError):
        service.join(room.id, password="wrong", seat_index=0, player_name="Intruder")


def test_room_deletion_requires_password_and_removes_room() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Temporary", password="secret")
    with pytest.raises(RoomAccessError):
        service.delete_room(room.id, password="wrong")
    assert service.get_room(room.id).name == "Temporary"

    service.delete_room(room.id, password="secret")
    with pytest.raises(RoomNotFoundError):
        service.get_room(room.id)


def test_upstash_room_inactivity_defaults_to_thirty_minutes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ROOM_INACTIVITY_SECONDS", raising=False)
    monkeypatch.delenv("ROOM_TTL_WAITING", raising=False)
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Expiring", password="secret")
    now = datetime.now(UTC)
    room.updated_at = (now - timedelta(minutes=31)).isoformat()
    assert UpstashRoomRepository._ttl("waiting") == 1800
    assert UpstashRoomRepository._inactive(room, now.timestamp())
    room.updated_at = (now - timedelta(minutes=29)).isoformat()
    assert not UpstashRoomRepository._inactive(room, now.timestamp())


def test_password_holder_can_reconnect_to_existing_human_seat() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Reconnect", password="secret")
    joined = service.join(room.id, password="secret", seat_index=0, player_name="Oleg")
    reconnected = service.join(room.id, password="secret", seat_index=0, player_name="Ignored name")
    assert reconnected.seats[0].player_id == joined.seats[0].player_id
    assert reconnected.seats[0].name == "Oleg"
    assert reconnected.revision == joined.revision + 1


def test_password_holder_can_reconnect_after_game_started() -> None:
    service, room_id = create_started_room()
    before = service.get_room(room_id)
    reconnected = service.join(room_id, password="secret", seat_index=0, player_name="Ignored")
    assert reconnected.status == "playing"
    assert reconnected.seats[0].player_id == "seat-1"
    assert reconnected.revision == before.revision + 1


def test_human_command_uses_authoritative_engine() -> None:
    service, room_id = create_started_room()
    before = service.get_room(room_id)
    assert before.game is not None
    actor = before.game.current_player
    after = service.apply_command(
        room_id,
        password="secret",
        command=Command(
            type="basic_action",
            actor_id=actor.id,
            payload={"kind": "work"},
            expected_revision=before.game.revision,
            command_id="work-1",
        ),
    )
    assert after.game is not None
    assert after.game.player_by_id(actor.id).money == actor.money + 2
    assert after.game.revision == before.game.revision + 1
    assert after.revision == before.revision + 1


def test_room_projection_hides_password_rng_decks_and_other_hands() -> None:
    service, room_id = create_started_room()
    room = service.get_room(room_id)
    assert room.game is not None
    view = room_view(room, viewer_id="seat-1")
    assert "password_hash" not in view
    assert "rng" not in view["game"]
    assert "market_deck" not in view["game"]
    assert "action_deck" not in view["game"]
    assert "processed_command_ids" not in view["game"]
    assert "command_log" not in view["game"]
    created = next(event for event in view["game"]["event_log"] if event["type"] == "game_created")
    assert "seed" not in created["data"]
    opponent = next(player for player in view["game"]["players"] if player["id"] == "seat-2")
    assert "hand" not in opponent
    assert opponent["hand_count"] == 0


def test_room_projection_hides_opponents_free_card_identity() -> None:
    service, room_id = create_started_room()
    room = service.get_room(room_id)
    assert room.game is not None
    room.game.append_event("free_action_card_drawn", "seat-2", card_id="audit")
    opponent_view = room_view(room, viewer_id="seat-1")
    own_view = room_view(room, viewer_id="seat-2")
    opponent_event = opponent_view["game"]["event_log"][-1]
    own_event = own_view["game"]["event_log"][-1]
    assert "card_id" not in opponent_event["data"]
    assert own_event["data"]["card_id"] == "audit"


def test_repository_rejects_two_writes_from_same_revision() -> None:
    repository = InMemoryRoomRepository()
    service = CityRoomService(repository)
    original = service.create_room(name="Concurrent", password="secret")
    left = repository.get(original.id)
    right = repository.get(original.id)
    left.name = "Left"
    left.touch()
    right.name = "Right"
    right.touch()

    def save(copy: RoomState) -> str:
        try:
            repository.save(copy, original.revision)
        except RoomConflictError:
            return "conflict"
        return "saved"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, (left, right)))
    assert sorted(results) == ["conflict", "saved"]
