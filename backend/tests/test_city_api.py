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


def test_oversized_request_is_rejected_before_json_parsing() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/city/rooms",
        content=b"x" * 65_537,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


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
