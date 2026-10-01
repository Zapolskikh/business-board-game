from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

from city_engine.commands import Command
from city_rooms.errors import (
    RoomAccessError,
    RoomConflictError,
    RoomNameTakenError,
    RoomNotFoundError,
    RoomValidationError,
)
from city_rooms.models import RoomState
from city_rooms.repository import InMemoryRoomRepository
from city_rooms.security import hash_password, verify_password
from city_rooms.service import CityRoomService
from city_rooms.upstash import UpstashRoomRepository
from city_rooms.views import room_view


def create_started_room() -> tuple[CityRoomService, str]:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Test city", password="secret", capacity=3, owner_token="host-secret")
    service.join(room.id, password="secret", seat_index=0, player_name="Oleg", seat_token="oleg-secret")
    service.set_bot(
        room.id, password="secret", seat_index=1, difficulty="expert", preferred_role="mafia", owner_token="host-secret"
    )
    service.start(room.id, password="secret", seed=42, owner_token="host-secret")
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


def test_room_names_are_unique_regardless_of_case_and_spacing() -> None:
    """Two identical cards in the list are indistinguishable — the wrong one gets opened."""
    service = CityRoomService(InMemoryRoomRepository())
    service.create_room(name="Вечерняя партия", password="secret")
    for duplicate in ("Вечерняя партия", "  вечерняя   ПАРТИЯ "):
        with pytest.raises(RoomNameTakenError):
            service.create_room(name=duplicate, password="secret")
    assert service.create_room(name="Вечерняя партия 2", password="secret").name == "Вечерняя партия 2"


def test_open_lobby_needs_no_password_and_cannot_be_closed_from_under_players() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Open table", password="", is_open=True)
    assert room.public_summary()["open"] is True
    service.join(room.id, password="", seat_index=0, player_name="Guest")
    service.set_bot(room.id, password="", seat_index=1, difficulty="expert", preferred_role=None)
    assert service.start(room.id, password="").status == "playing"
    # Nobody owns an open room, but a passer-by may not close a table people are sitting at.
    with pytest.raises(RoomAccessError):
        service.delete_room(room.id, password="")
    # A private room still requires a real password.
    with pytest.raises(RoomValidationError):
        service.create_room(name="Private", password="")


def test_an_empty_open_lobby_can_be_cleared_by_anyone() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Abandoned", password="", is_open=True)
    service.delete_room(room.id, password="")
    with pytest.raises(RoomNotFoundError):
        service.get_room(room.id)


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


def test_a_player_reconnects_to_their_seat_with_its_secret() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Reconnect", password="secret")
    joined = service.join(room.id, password="secret", seat_index=0, player_name="Oleg", seat_token="oleg-secret")
    reconnected = service.join(
        room.id, password="secret", seat_index=0, player_name="Ignored name", seat_token="oleg-secret"
    )
    assert reconnected.seats[0].player_id == joined.seats[0].player_id
    assert reconnected.seats[0].name == "Oleg"
    assert reconnected.revision == joined.revision + 1


def test_the_password_alone_does_not_take_somebody_elses_seat() -> None:
    """Everybody at the table knows the password — it cannot be what proves a seat is yours."""
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Guarded", password="secret")
    service.join(room.id, password="secret", seat_index=0, player_name="Oleg", seat_token="oleg-secret")
    for token in ("", "guess"):
        with pytest.raises(RoomConflictError):
            service.join(room.id, password="secret", seat_index=0, player_name="Intruder", seat_token=token)
    service.set_bot(room.id, password="secret", seat_index=1, difficulty="expert")
    with pytest.raises(RoomConflictError):
        service.join(room.id, password="secret", seat_index=1, player_name="Intruder", seat_token="x")
    # Moving seats frees only your own: a guest cannot release the host's chair as their "old" seat.
    guest = service.join(
        room.id, password="secret", seat_index=2, player_name="Guest", seat_token="guest-secret", release_seat_index=0
    )
    assert guest.seats[0].name == "Oleg"


def test_only_the_creator_starts_the_game() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Host starts", password="secret", owner_token="host-secret")
    service.join(room.id, password="secret", seat_index=0, player_name="Host", seat_token="host-seat")
    service.join(room.id, password="secret", seat_index=1, player_name="Guest", seat_token="guest-seat")
    with pytest.raises(RoomAccessError):
        service.start(room.id, password="secret")
    assert service.start(room.id, password="secret", owner_token="host-secret").status == "playing"


def test_player_names_are_unique_at_a_table() -> None:
    """Two «Игрок» cannot be told apart on the board or in the log — bots' names included."""
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Names", password="secret", owner_token="host-secret")
    service.join(room.id, password="secret", seat_index=0, player_name="Игрок", seat_token="first")
    service.set_bot(room.id, password="secret", seat_index=1, difficulty="expert", owner_token="host-secret")
    for duplicate in ("Игрок", "  игрок ", "bot 2"):
        with pytest.raises(RoomConflictError):
            service.join(room.id, password="secret", seat_index=2, player_name=duplicate, seat_token="second")
    # Moving to another chair under your own name is not a duplicate: the old chair is released.
    moved = service.join(
        room.id, password="secret", seat_index=2, player_name="Игрок", seat_token="first", release_seat_index=0
    )
    assert [seat.name for seat in moved.seats[:3]] == [None, "Bot 2", "Игрок"]


def test_a_player_reconnects_after_game_started_only_with_the_secret() -> None:
    service, room_id = create_started_room()
    before = service.get_room(room_id)
    with pytest.raises(RoomConflictError):
        service.join(room_id, password="secret", seat_index=0, player_name="Intruder")
    reconnected = service.join(
        room_id, password="secret", seat_index=0, player_name="Ignored", seat_token="oleg-secret"
    )
    assert reconnected.status == "playing"
    assert reconnected.seats[0].player_id == "seat-1"
    assert reconnected.revision == before.revision + 1


def test_only_the_creator_clears_or_reconfigures_occupied_seats() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Hosted", password="secret", owner_token="host-secret")
    service.join(room.id, password="secret", seat_index=0, player_name="Guest", seat_token="guest-secret")
    # Seating a bot, changing it, removing it or clearing a player — all the host's call.
    with pytest.raises(RoomAccessError):
        service.set_bot(room.id, password="secret", seat_index=1, difficulty="expert")
    service.set_bot(room.id, password="secret", seat_index=1, difficulty="expert", owner_token="host-secret")
    with pytest.raises(RoomAccessError):
        service.set_bot(room.id, password="secret", seat_index=1, difficulty="expert", preferred_role="mafia")
    for seat in (0, 1):
        with pytest.raises(RoomAccessError):
            service.clear_seat(room.id, password="secret", seat_index=seat)
    service.set_bot(
        room.id, password="secret", seat_index=1, difficulty="expert", preferred_role="mafia", owner_token="host-secret"
    )
    cleared = service.clear_seat(room.id, password="secret", seat_index=0, owner_token="host-secret")
    assert cleared.seats[0].kind == "empty"
    # The cleared player's secret is gone with the seat: it does not reclaim the next occupant's chair.
    service.join(room.id, password="secret", seat_index=0, player_name="Next", seat_token="next-secret")
    with pytest.raises(RoomConflictError):
        service.join(room.id, password="secret", seat_index=0, player_name="Guest", seat_token="guest-secret")


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
    # Only the size leaks, never the cards — and it has to match what the opponent really holds.
    assert opponent["hand_count"] == len(room.game.player_by_id("seat-2").hand)


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


def test_rooms_saved_with_a_retired_bot_policy_load_as_reborn() -> None:
    """Oleg, Codex and Claude were removed; a stored room or game naming them must still open."""
    from city_engine.models import PlayerState
    from city_rooms.models import RoomSeat

    for retired in ("easy", "medium", "hard"):
        stored = {"index": 1, "kind": "bot", "player_id": "seat-2", "name": "Bot 2", "difficulty": retired}
        seat = RoomSeat.from_dict(stored)
        seat.validate()
        assert seat.difficulty == "expert"
        player = PlayerState.from_dict({"id": "seat-2", "name": "Bot 2", "is_bot": True, "difficulty": retired})
        assert player.difficulty == "expert"


def test_only_reborn_keeps_a_favourite_role() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room = service.create_room(name="Roles", password="secret", capacity=3, owner_token="host")
    service.set_bot(
        room.id, password="secret", seat_index=1, difficulty="expert", preferred_role="mafia", owner_token="host"
    )
    service.set_bot(
        room.id, password="secret", seat_index=2, difficulty="oracle", preferred_role="mafia", owner_token="host"
    )
    seats = service.get_room(room.id).seats
    assert seats[1].preferred_role == "mafia"
    assert seats[2].preferred_role is None
