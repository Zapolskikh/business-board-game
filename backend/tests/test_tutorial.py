"""The tutorial script, walked end to end through the real engine.

Every step the client asks of the player is played here as the command the board would send. If a
rule change makes a step impossible — a price that no longer fits the purse, a condition that no
longer holds — this fails before a new player hits it.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.city_api import get_room_service
from app.main import app
from city_engine.commands import Command
from city_rooms.repository import InMemoryRoomRepository
from city_rooms.service import CityRoomService
from city_rooms.tutorial import PLAYER_ID, VICTOR_ID


def _play(service: CityRoomService, room_id: str, password: str, kind: str, payload: dict | None = None):
    room = service.get_room(room_id)
    command = Command(type=kind, actor_id=PLAYER_ID, payload=payload or {}, expected_revision=room.game.revision)
    return service.apply_command(room_id, password=password, command=command)


def _events(room, since: int) -> list[str]:
    return [event.type for event in room.game.event_log if event.seq > since]


def test_the_tutorial_script_plays_through_the_engine() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    room, password = service.create_tutorial(player_name="Новичок", lang="ru")
    game = room.game
    assert room.tutorial and room.status == "playing"
    assert game.current_player.id == PLAYER_ID and game.actions_left == 10
    assert game.player_by_id(VICTOR_ID).name == "Виктор"

    steps = [
        ("basic_action", {"kind": "work"}),
        ("basic_action", {"kind": "campaign", "spend": 5}),
        ("buy_asset", {"market_uid": "asset:pharmacy_chain"}),
        ("claim_role", {"role_id": "journalist"}),
    ]
    for kind, payload in steps:
        room = _play(service, room.id, password, kind, payload)

    # Step 5: Victor is one scandal short of losing his seat.
    room = _play(service, room.id, password, "use_role_power", {"power": "journalist_inflate", "target_id": VICTOR_ID})
    victor = room.game.player_by_id(VICTOR_ID)
    assert victor.role is None and victor.scandals == 5

    # Step 6: the purchase draws the prepared cards; «Мобилизация» adds the eleventh action.
    room = _play(service, room.id, password, "buy_action_card")
    me = room.game.player_by_id(PLAYER_ID)
    assert [held.card_id for held in me.hand] == ["mobilization", "popular_support"]
    actions = room.game.actions_left
    room = _play(service, room.id, password, "play_action_card", {"card_uid": me.hand[0].uid})
    assert room.game.actions_left == actions + 1

    # Step 7: the project with no condition.
    room = _play(service, room.id, password, "city_project", {"project_id": "charity_fund"})

    # Step 8: the river port is closed until the smuggling terminal brings logistics.
    me = room.game.player_by_id(PLAYER_ID)
    assert not service.engine.project_requirement_met(me, service.engine.project("river_port"))
    room = _play(service, room.id, password, "buy_asset", {"market_uid": "asset:smuggling"})
    room = _play(service, room.id, password, "city_project", {"project_id": "river_port"})

    # Step 9: the grey operation lands on the prepared face.
    room = _play(service, room.id, password, "grey_operation", {"asset_id": "smear"})
    resolved = next(event for event in reversed(room.game.event_log) if event.type == "grey_operation_resolved")
    assert resolved.data["tier"] == "full"

    # Step 9a and 10: a Защита, then the influence that is left into points.
    room = _play(service, room.id, password, "buy_roof")
    room = _play(service, room.id, password, "basic_action", {"kind": "lobbying"})
    me = room.game.player_by_id(PLAYER_ID)
    assert room.game.actions_left == 0
    assert me.roofs == 1 and me.money >= 0 and me.influence >= 0
    assert sorted(me.projects) == ["charity_fund", "river_port"]

    # Step 11: the round closes for real; Victor answers with his card and the Защита burns on it.
    seq = room.game.event_log[-1].seq
    room = _play(service, room.id, password, "end_turn")
    happened = _events(room, seq)
    assert "targeted_effect_blocked" in happened
    assert {"round_settled", "market_rotated", "project_board_rotated"} <= set(happened)
    assert room.game.player_by_id(PLAYER_ID).roofs == 0
    assert room.game.round_number == 2 and room.game.current_player.id == PLAYER_ID


def test_tutorial_rooms_stay_out_of_the_room_list() -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    client = TestClient(app)
    try:
        created = client.post("/api/city/tutorial", json={"player_name": "Tester", "lang": "en"})
        assert created.status_code == 201
        body = created.json()
        assert body["player_id"] == PLAYER_ID and body["password"]
        assert body["room"]["legal_actions"]
        assert client.get("/api/city/rooms").json() == []
        state = client.get(
            f"/api/city/rooms/{body['room']['id']}/state",
            params={"viewer_id": PLAYER_ID},
            headers={"X-Room-Password": body["password"]},
        )
        assert state.status_code == 200
        assert [player["name"] for player in state.json()["game"]["players"]][1] == "Victor"
    finally:
        app.dependency_overrides.clear()
