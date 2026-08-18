from __future__ import annotations

from fastapi.testclient import TestClient

from app.city_api import get_room_service
from app.main import app
from city_rooms.repository import InMemoryRoomRepository
from city_rooms.service import CityRoomService


class CountingRepository(InMemoryRoomRepository):
    def __init__(self) -> None:
        super().__init__()
        self.full_reads = 0

    def get(self, room_id: str):  # type: ignore[no-untyped-def]
        self.full_reads += 1
        return super().get(room_id)


def test_room_rest_flow_and_polling() -> None:
    repository = CountingRepository()
    service = CityRoomService(repository)
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        response = client.post(
            "/api/city/rooms",
            json={"name": "Release test", "password": "secret", "capacity": 2},
        )
        assert response.status_code == 201
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"] == "no-store"
        room_id = response.json()["id"]

        assert (
            client.post(
                f"/api/city/rooms/{room_id}/join",
                json={"password": "secret", "seat_index": 0, "player_name": "Oleg"},
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/api/city/rooms/{room_id}/seats",
                json={"password": "secret", "seat_index": 1, "kind": "bot", "difficulty": "medium"},
            ).status_code
            == 200
        )
        started = client.post(
            f"/api/city/rooms/{room_id}/start",
            json={"password": "secret", "seed": 7},
        )
        assert started.status_code == 200
        revision = started.json()["revision"]
        reads_before_unchanged_poll = repository.full_reads

        unchanged = client.get(
            f"/api/city/rooms/{room_id}/state",
            params={"viewer_id": "seat-1", "after_revision": revision},
            headers={"X-Room-Password": "secret"},
        )
        assert unchanged.json() == {"changed": False, "revision": revision}
        assert repository.full_reads == reads_before_unchanged_poll
        assert (
            client.get(
                f"/api/city/rooms/{room_id}/state",
                headers={"X-Room-Password": "wrong"},
            ).status_code
            == 403
        )
        assert (
            client.get(
                f"/api/city/rooms/{room_id}/state",
                params={"viewer_id": "seat-2"},
                headers={"X-Room-Password": "secret"},
            ).status_code
            == 403
        )
        assert client.get("/ready").json()["status"] == "ready"
    finally:
        app.dependency_overrides.clear()


def test_state_carries_the_viewers_own_market_prices() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        room_id = client.post(
            "/api/city/rooms",
            json={"name": "Prices", "password": "secret", "capacity": 2},
        ).json()["id"]
        client.post(
            f"/api/city/rooms/{room_id}/join",
            json={"password": "secret", "seat_index": 0, "player_name": "Oleg"},
        ).raise_for_status()
        client.post(
            f"/api/city/rooms/{room_id}/seats",
            json={"password": "secret", "seat_index": 1, "kind": "bot", "difficulty": "easy"},
        ).raise_for_status()
        client.post(f"/api/city/rooms/{room_id}/start", json={"password": "secret", "seed": 7}).raise_for_status()

        room = service.get_room(room_id)
        assert room.game is not None
        expected = service.engine.market_prices(room.game, room.game.player_by_id("seat-1"))
        state = client.get(
            f"/api/city/rooms/{room_id}/state",
            params={"viewer_id": "seat-1"},
            headers={"X-Room-Password": "secret"},
        ).json()
        # The client must never recompute discounts: every market slot ships its own price.
        assert {item["uid"]: item["price"] for item in state["game"]["market"]} == expected
    finally:
        app.dependency_overrides.clear()


def test_oversized_request_is_rejected_before_json_parsing() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/city/rooms",
        content=b"x" * 65_537,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_room_can_be_deleted_only_with_its_password() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        created = client.post(
            "/api/city/rooms",
            json={"name": "Delete me", "password": "secret", "capacity": 2},
        ).json()
        room_id = created["id"]
        denied = client.request(
            "DELETE",
            f"/api/city/rooms/{room_id}",
            json={"password": "wrong"},
        )
        assert denied.status_code == 403
        assert client.get(f"/api/city/rooms/{room_id}").status_code == 200

        deleted = client.request(
            "DELETE",
            f"/api/city/rooms/{room_id}",
            json={"password": "secret"},
        )
        assert deleted.status_code == 204
        assert deleted.content == b""
        assert client.get(f"/api/city/rooms/{room_id}").status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_rest_room_can_reach_a_persisted_final_state() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        created = client.post(
            "/api/city/rooms",
            json={
                "name": "Complete game",
                "password": "secret",
                "capacity": 2,
                "max_rounds": 5,
            },
        ).json()
        room_id = created["id"]
        client.post(
            f"/api/city/rooms/{room_id}/join",
            json={"password": "secret", "seat_index": 0, "player_name": "Human"},
        ).raise_for_status()
        client.post(
            f"/api/city/rooms/{room_id}/seats",
            json={"password": "secret", "seat_index": 1, "kind": "bot", "difficulty": "easy"},
        ).raise_for_status()
        client.post(
            f"/api/city/rooms/{room_id}/start",
            json={"password": "secret", "seed": 13},
        ).raise_for_status()

        for index in range(5):
            private = client.get(
                f"/api/city/rooms/{room_id}/state",
                params={"viewer_id": "seat-1"},
                headers={"X-Room-Password": "secret"},
            ).json()
            if private["status"] == "finished":
                break
            response = client.post(
                f"/api/city/rooms/{room_id}/commands",
                json={
                    "password": "secret",
                    "actor_id": "seat-1",
                    "type": "end_turn",
                    "payload": {},
                    "command_id": f"human-pass-{index}",
                    "expected_revision": private["game"]["revision"],
                },
            )
            response.raise_for_status()

        finished = service.get_room(room_id)
        assert finished.status == "finished"
        assert finished.game is not None
        assert set(finished.game.final_scores) == {"seat-1", "seat-2"}
    finally:
        app.dependency_overrides.clear()


def _start_two_seat_room(client: TestClient, *, name: str, max_rounds: int = 15) -> str:
    room_id = client.post(
        "/api/city/rooms",
        json={"name": name, "password": "secret", "capacity": 2, "max_rounds": max_rounds},
    ).json()["id"]
    client.post(
        f"/api/city/rooms/{room_id}/join",
        json={"password": "secret", "seat_index": 0, "player_name": "Oleg"},
    ).raise_for_status()
    client.post(
        f"/api/city/rooms/{room_id}/seats",
        json={"password": "secret", "seat_index": 1, "kind": "bot", "difficulty": "easy"},
    ).raise_for_status()
    client.post(f"/api/city/rooms/{room_id}/start", json={"password": "secret", "seed": 7}).raise_for_status()
    return room_id


def test_state_carries_the_viewers_itemised_round_forecast() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        room_id = _start_two_seat_room(client, name="Forecast")
        room = service.get_room(room_id)
        assert room.game is not None
        # A project perk paying +1◆ a round was indistinguishable from one paying nothing.
        room.game.player_by_id("seat-1").projects.append("courthouse")
        # Every unique project may exist only once, so it has to leave the board and the deck.
        room.game.project_board = [item for item in room.game.project_board if item != "courthouse"]
        room.game.project_deck = [item for item in room.game.project_deck if item != "courthouse"]
        # `get` hands out a deep copy, so the mutation has to go back through the repository.
        expected_revision = room.revision
        room.revision += 1
        service.repository.save(room, expected_revision)

        forecast = client.get(
            f"/api/city/rooms/{room_id}/state",
            params={"viewer_id": "seat-1"},
            headers={"X-Room-Password": "secret"},
        ).json()["game"]["round_forecast"]

        assert forecast["influence"]["projects"] == 2
        assert forecast["influence"]["total"] == sum(
            value for key, value in forecast["influence"].items() if key != "total"
        )
        assert forecast["money"]["total"] == sum(value for key, value in forecast["money"].items() if key != "total")
    finally:
        app.dependency_overrides.clear()


def test_journal_is_exported_only_after_the_game_is_finished() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        room_id = _start_two_seat_room(client, name="Journal", max_rounds=5)
        params = {"viewer_id": "seat-1"}
        headers = {"X-Room-Password": "secret"}

        running = client.get(f"/api/city/rooms/{room_id}/journal", params=params, headers=headers)
        assert running.status_code == 422  # the seed is hidden information while the game runs
        assert client.get(f"/api/city/rooms/{room_id}/journal", params=params).status_code == 422

        for index in range(20):
            state = client.get(f"/api/city/rooms/{room_id}/state", params=params, headers=headers).json()
            if state["status"] == "finished":
                break
            client.post(
                f"/api/city/rooms/{room_id}/commands",
                json={
                    "password": "secret",
                    "actor_id": "seat-1",
                    "type": "end_turn",
                    "payload": {},
                    "command_id": f"pass-{index}",
                    "expected_revision": state["game"]["revision"],
                },
            ).raise_for_status()

        journal = client.get(f"/api/city/rooms/{room_id}/journal", params=params, headers=headers)
        assert journal.status_code == 200
        body = journal.json()
        # Seed plus command log is what makes replay_game able to rebuild the match.
        created = next(event for event in body["game"]["event_log"] if event["type"] == "game_created")
        assert created["data"]["seed"] == 7
        assert body["game"]["command_log"]
        assert set(body["score_breakdown"]) == {"seat-1", "seat-2"}
    finally:
        app.dependency_overrides.clear()
