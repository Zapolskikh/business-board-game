from __future__ import annotations

from fastapi.testclient import TestClient

from app.city_api import get_room_service
from app.http_middleware import limiter
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
                json={"password": "secret", "seat_index": 1, "kind": "bot", "difficulty": "expert"},
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
        # The seat request above still names a retired policy, as an old client would: it plays as Reborn.
        assert room.seats[1].difficulty == "expert"
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
            json={"password": "secret", "seat_index": 1, "kind": "bot", "difficulty": "expert"},
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
        json={"password": "secret", "seat_index": 1, "kind": "bot", "difficulty": "expert"},
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
        # No password header reads as an empty password: a private room refuses it.
        assert client.get(f"/api/city/rooms/{room_id}/journal", params=params).status_code == 403

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


def test_state_carries_purchase_previews_and_object_yields() -> None:
    """Market cards show what a purchase adds to the viewer's round, city cards what they pay."""
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        room_id = _start_two_seat_room(client, name="Previews")
        game = client.get(
            f"/api/city/rooms/{room_id}/state",
            params={"viewer_id": "seat-1"},
            headers={"X-Room-Password": "secret"},
        ).json()["game"]

        assert game["market"]
        for item in game["market"]:
            assert set(item["preview"]) == {"money", "influence"}
            assert set(item["own_yield"]) == {"money", "influence"}
        for player in game["players"]:
            assert set(player["asset_yields"]) == {owned["uid"] for owned in player["assets"]}
    finally:
        app.dependency_overrides.clear()


ADMIN = "admin-token-for-tests-0123456789"


def test_admin_sees_who_sits_where_and_watches_any_seat(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("ADMIN_TOKEN", ADMIN)
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        room_id = client.post("/api/city/rooms", json={"name": "Watched", "password": "secret", "capacity": 3}).json()[
            "id"
        ]
        for seat, name, ip in ((0, "Anna", "203.0.113.5"), (1, "Boris", "203.0.113.5, 10.0.0.1")):
            joined = client.post(
                f"/api/city/rooms/{room_id}/join",
                json={"password": "secret", "seat_index": seat, "player_name": name},
                headers={"X-Forwarded-For": ip, "User-Agent": f"browser-{name}"},
            )
            assert joined.status_code == 200
            # Players never see each other's addresses.
            assert "203.0.113.5" not in joined.text
        client.post(
            f"/api/city/rooms/{room_id}/seats",
            json={"password": "secret", "seat_index": 2, "kind": "bot", "difficulty": "expert"},
        )
        client.post(f"/api/city/rooms/{room_id}/start", json={"password": "secret", "seed": 7})
        assert "203.0.113.5" not in client.get(f"/api/city/rooms/{room_id}").text

        # Without the key — or with a wrong one — the admin endpoints do not exist.
        assert client.get("/api/city/admin/rooms").status_code == 404
        assert client.get("/api/city/admin/rooms", headers={"X-Admin-Token": "wrong"}).status_code == 404

        rooms = client.get("/api/city/admin/rooms", headers={"X-Admin-Token": ADMIN}).json()
        room = next(item for item in rooms if item["id"] == room_id)
        anna = room["seats"][0]
        assert anna["client"]["ip"] == "203.0.113.5" and anna["client"]["user_agent"] == "browser-Anna"
        assert room["seats"][2]["client"] is None
        assert room["shared_ips"] == {"203.0.113.5": ["Anna", "Boris"]}

        # Any seat, the bot's included, without the room password — and nothing to press.
        watched = client.get(
            f"/api/city/rooms/{room_id}/state",
            params={"viewer_id": "seat-3"},
            headers={"X-Admin-Token": ADMIN},
        )
        assert watched.status_code == 200
        assert watched.json()["game"] is not None and watched.json()["legal_actions"] == []
    finally:
        app.dependency_overrides.clear()


def test_admin_endpoints_stay_closed_with_a_short_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("ADMIN_TOKEN", "short")
    client = TestClient(app)
    assert client.get("/api/city/admin/rooms", headers={"X-Admin-Token": "short"}).status_code == 404


def test_chat_rides_with_the_state_and_stays_out_of_the_journal() -> None:
    """A line said at the table reaches every viewer with the next poll, survives the bots' moves,
    and is not part of the replayable journal: a message is not a move."""
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        room_id = client.post("/api/city/rooms", json={"name": "Chat", "password": "secret", "capacity": 2}).json()["id"]
        client.post(f"/api/city/rooms/{room_id}/join", json={"password": "secret", "seat_index": 0, "player_name": "Oleg"})
        client.post(f"/api/city/rooms/{room_id}/seats", json={"password": "secret", "seat_index": 1, "kind": "bot"})

        # The lobby already has a chat, and the room revision moves so that a poll picks the line up.
        before = client.get(f"/api/city/rooms/{room_id}").json()["revision"]
        said = client.post(
            f"/api/city/rooms/{room_id}/chat", json={"password": "secret", "player_id": "seat-1", "text": "  привет,\n стол  "}
        )
        assert said.status_code == 200
        assert said.json()["revision"] == before + 1
        assert [(m["seq"], m["name"], m["text"], m["round"]) for m in said.json()["chat"]] == [(1, "Oleg", "привет, стол", None)]

        # Only a seated human speaks, and only with the room password.
        assert client.post(
            f"/api/city/rooms/{room_id}/chat", json={"password": "secret", "player_id": "seat-2", "text": "бот"}
        ).status_code == 403
        assert client.post(
            f"/api/city/rooms/{room_id}/chat", json={"password": "nope", "player_id": "seat-1", "text": "x"}
        ).status_code == 403
        assert client.post(
            f"/api/city/rooms/{room_id}/chat", json={"password": "secret", "player_id": "seat-1", "text": "   "}
        ).status_code == 422

        client.post(f"/api/city/rooms/{room_id}/start", json={"password": "secret", "seed": 3})
        long_line = "я" * 500
        client.post(f"/api/city/rooms/{room_id}/chat", json={"password": "secret", "player_id": "seat-1", "text": long_line})
        state = client.get(
            f"/api/city/rooms/{room_id}/state", params={"viewer_id": "seat-1"}, headers={"X-Room-Password": "secret"}
        ).json()
        assert [m["seq"] for m in state["chat"]] == [1, 2]
        assert len(state["chat"][1]["text"]) == 240
        assert state["chat"][1]["round"] == 1 and state["chat"][1]["after_event"] >= 1
        assert "chat" not in state["game"]

        room = service.get_room(room_id)
        room.game.status = "finished"
        room.status = "finished"
        from city_rooms.views import room_journal

        assert "chat" not in room_journal(room) and "chat" not in room_journal(room)["game"]
    finally:
        app.dependency_overrides.clear()


def test_chat_author_is_the_seat_key_retry_is_said_once_and_floods_are_cut() -> None:
    """Everyone at the table knows the password, so the seat key — not the id in the request — says
    who speaks. A retry with the same client id is one line, and a seat cannot flood the history."""
    limiter._counts.clear()  # the per-IP safety net counts every earlier test in this process
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        created = client.post("/api/city/rooms", json={"name": "Keys", "password": "secret", "capacity": 2})
        room_id = created.json()["id"]
        for index, (name, token) in enumerate([("Oleg", "key-1"), ("Anna", "key-2")]):
            client.post(
                f"/api/city/rooms/{room_id}/join",
                json={"password": "secret", "seat_index": index, "player_name": name, "seat_token": token},
            )
        chat = f"/api/city/rooms/{room_id}/chat"
        # Anna knows the password but not Oleg's key: she cannot speak as him.
        as_oleg = {"password": "secret", "player_id": "seat-1", "text": "hi"}
        assert client.post(chat, json={**as_oleg, "seat_token": "key-2"}).status_code == 403
        assert client.post(chat, json=as_oleg).status_code == 403

        line = {**as_oleg, "text": "<b>hi</b>", "seat_token": "key-1", "client_id": "c-1"}
        first = client.post(chat, json=line).json()
        again = client.post(chat, json=line).json()
        assert [m["text"] for m in again["chat"]] == ["<b>hi</b>"]
        assert again["revision"] == first["revision"]

        for n in range(4):
            assert client.post(chat, json={**line, "client_id": f"c-{n + 2}"}).status_code == 200
        assert client.post(chat, json={**line, "client_id": "c-9"}).status_code == 429
        # The limit is per seat: Anna still speaks.
        as_anna = {"password": "secret", "player_id": "seat-2", "text": "ok", "seat_token": "key-2"}
        assert client.post(chat, json=as_anna).status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_undo_of_a_bot_clears_the_seat_only_while_the_bot_is_still_there() -> None:
    limiter._counts.clear()
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        room_id = client.post(
            "/api/city/rooms", json={"name": "Undo", "password": "secret", "capacity": 3, "owner_token": "host"}
        ).json()["id"]
        seats = f"/api/city/rooms/{room_id}/seats"
        base = {"password": "secret", "seat_index": 1, "owner_token": "host"}
        assert client.post(seats, json={**base, "kind": "bot", "difficulty": "ledger"}).status_code == 200
        # A guest cannot undo the host's bot.
        guest_undo = {**base, "kind": "empty", "owner_token": "guest", "expected_kind": "bot"}
        assert client.post(seats, json=guest_undo).status_code == 403
        # The seat is no longer a bot (the host freed it elsewhere): the stale undo must not touch it.
        client.post(seats, json={**base, "kind": "empty"})
        assert client.post(seats, json={**base, "kind": "empty", "expected_kind": "bot"}).status_code == 409
        client.post(seats, json={**base, "kind": "bot", "difficulty": "oracle"})
        undone = client.post(seats, json={**base, "kind": "empty", "expected_kind": "bot"})
        assert undone.status_code == 200 and undone.json()["seats"][1]["kind"] == "empty"
    finally:
        app.dependency_overrides.clear()


def test_a_player_leaves_a_waiting_room_with_their_own_seat_key_only() -> None:
    """Going back to the room list frees your seat; nobody else's, and not after the start."""
    limiter._counts.clear()
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        created = client.post("/api/city/rooms", json={"name": "Leave", "password": "secret", "capacity": 3})
        room_id = created.json()["id"]
        for index, (name, token) in enumerate([("Oleg", "key-1"), ("Anna", "key-2")]):
            client.post(
                f"/api/city/rooms/{room_id}/join",
                json={"password": "secret", "seat_index": index, "player_name": name, "seat_token": token},
            )
        leave = f"/api/city/rooms/{room_id}/leave"
        anna_leaves = {"password": "secret", "seat_index": 1, "seat_token": "key-2"}
        # Anna cannot free Oleg's seat with her own key.
        assert client.post(leave, json={**anna_leaves, "seat_index": 0}).status_code == 403
        left = client.post(leave, json=anna_leaves)
        assert left.status_code == 200 and left.json()["seats"][1]["kind"] == "empty"
        # The freed seat is open to anyone, and the old key no longer opens it.
        assert client.post(leave, json=anna_leaves).status_code == 409

        client.post(f"/api/city/rooms/{room_id}/seats", json={"password": "secret", "seat_index": 1, "kind": "bot"})
        client.post(f"/api/city/rooms/{room_id}/start", json={"password": "secret", "seed": 3})
        after = client.post(leave, json={"password": "secret", "seat_index": 0, "seat_token": "key-1"})
        assert after.status_code == 422
    finally:
        app.dependency_overrides.clear()
