"""Tests for the FastAPI layer using TestClient."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_meta_lists_roles_and_cells():
    resp = client.get("/api/meta")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["roles"]) == 6
    assert "casino" in data["cells"]
    assert "casino" in data["cell_types"]


def test_create_and_play_a_turn():
    resp = client.post(
        "/api/games",
        json={
            "players": [
                {"name": "Аня", "is_bot": False},
                {"name": "Бот", "is_bot": True},
            ],
            "board": "board_60",
            "seed": 7,
        },
    )
    assert resp.status_code == 200
    state = resp.json()["state"]
    game_id = state["game_id"]
    assert len(state["players"]) == 2
    assert state["board"]["ring_sizes"] == [28, 20, 12]

    current = state["current_player_id"]
    resp = client.post(
        f"/api/games/{game_id}/action",
        json={"player_id": current, "action": "roll_dice"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["events"]) >= 1
    assert body["state"]["phase"] in ("await_roll", "await_decision", "game_over")


def test_out_of_turn_action_is_rejected():
    state = client.post(
        "/api/games",
        json={"players": [{"name": "A"}, {"name": "B"}], "board": "board_60", "seed": 1},
    ).json()["state"]
    game_id = state["game_id"]
    wrong = state["players"][1]["id"]
    resp = client.post(
        f"/api/games/{game_id}/action",
        json={"player_id": wrong, "action": "roll_dice"},
    )
    assert resp.status_code == 400


def test_simulate_endpoint_returns_report():
    resp = client.post(
        "/api/simulate",
        json={"games": 10, "players": 4, "board": "board_60", "seed": 3, "bot": "random"},
    )
    assert resp.status_code == 200
    report = resp.json()
    assert report["games"] == 10
    assert "roles" in report


def test_unknown_game_returns_404():
    assert client.get("/api/games/deadbeef").status_code == 404
