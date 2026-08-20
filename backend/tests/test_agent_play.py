from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from agent_play.cli import main
from agent_play.client import CityClient
from agent_play.render import Catalog, render_state, resolve_action
from agent_play.session import Session
from app.city_api import get_room_service
from app.main import app
from city_rooms.repository import InMemoryRoomRepository
from city_rooms.service import CityRoomService


def test_client_transport_plays_a_full_turn_through_the_rest_api(tmp_path: Path) -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    http = TestClient(app)

    def transport(method: str, path: str, body: dict[str, Any] | None, headers: dict[str, str]):
        response = http.request(method, path, json=body, headers=headers)
        return response.status_code, (response.json() if response.content else None)

    try:
        client = CityClient("http://testserver", transport=transport)
        room_id = client.create_room(name="Agent", password="agentplay", capacity=2, max_rounds=5)["id"]
        client.join(room_id, password="agentplay", seat_index=0, player_name="Claude")
        client.set_bot(room_id, password="agentplay", seat_index=1, difficulty="medium")
        client.start(room_id, password="agentplay", seed=11)

        session = Session(
            base_url="http://testserver",
            room_id=room_id,
            password="agentplay",
            player_id="seat-1",
            player_name="Claude",
            directory=tmp_path,
        )
        catalog = Catalog.from_meta(client.meta())
        room = client.state(room_id, password="agentplay", viewer_id="seat-1")
        text = render_state(room, catalog, "seat-1")
        assert "рынок объектов" in text
        assert "— действия (" in text
        # Market lines must show the server-computed price, not the catalog cost.
        assert all(str(item["price"]) in text for item in room["game"]["market"])

        work = resolve_action(room["legal_actions"], "basic_action", {"kind": "work"})
        after = client.command(
            room_id,
            password="agentplay",
            actor_id="seat-1",
            command_type=work["type"],
            payload=work["payload"],
            expected_revision=room["game"]["revision"],
            command_id="test-work",
        )
        assert after["game"]["players"][0]["money"] == room["game"]["players"][0]["money"] + 2
        assert after["game"]["revision"] == room["game"]["revision"] + 1

        session.save()
        session.journal({"action": "command", "type": "basic_action"})
        assert Session.load(tmp_path).room_id == room_id
        assert session.journal_path.read_text(encoding="utf-8").count("\n") == 1
    finally:
        app.dependency_overrides.clear()


def test_cli_new_state_and_do_share_a_session(tmp_path: Path, monkeypatch, capsys) -> None:
    service = CityRoomService(InMemoryRoomRepository())
    app.dependency_overrides[get_room_service] = lambda: service
    http = TestClient(app)

    def fake_transport(base_url: str, timeout: float = 30.0):
        def send(method: str, path: str, body: dict[str, Any] | None, headers: dict[str, str]):
            response = http.request(method, path, json=body, headers=headers)
            return response.status_code, (response.json() if response.content else None)

        return send

    monkeypatch.setattr("agent_play.client.urllib_transport", fake_transport)
    try:
        assert main(["--dir", str(tmp_path), "new", "--capacity", "2", "--bots", "1", "--seed", "5"]) == 0
        created = capsys.readouterr().out
        assert "создана и запущена" in created

        assert main(["--dir", str(tmp_path), "state", "--log", "0"]) == 0
        board = capsys.readouterr().out
        assert "ходит Claude — ЭТО Я" in board
        # The board has to state the scoring rates and the shared project board, or an agent
        # plays the old game: hoards cash and never looks at the only real source of points.
        assert "доска городских проектов" in board
        assert "Крыша" in board  # the price line survives; the automation token does not exist
        assert "деньги 1 (10$=1)" in board
        assert "-й в раунде" in board

        assert main(["--dir", str(tmp_path), "do", "basic_action", "kind=work", "--quiet"]) == 0
        played = capsys.readouterr().out
        assert "basic_action kind=work" in played
        assert "— игроки —" not in played  # --quiet keeps the board out

        # `do` prints the short status, not the board: redrawing it after every action was 82%
        # of everything a four-agent session had to read.
        assert main(["--dir", str(tmp_path), "do", "basic_action", "kind=work"]) == 0
        short = capsys.readouterr().out
        assert "— игроки —" not in short
        assert "— рынок объектов" not in short
        assert "действий" in short and "очки" in short
        assert "— действия (" in short

        # One call can play a whole turn; the bot answers inside the same request.
        assert main(["--dir", str(tmp_path), "turn", "basic_action kind=work", "end_turn"]) == 0
        turn = capsys.readouterr().out
        assert turn.count("→ ") == 2
        assert "turn_ended" in turn

        assert main(["--dir", str(tmp_path), "do", "end_turn", "--board"]) == 0
        board = capsys.readouterr().out
        assert "ходит Claude — ЭТО Я" in board  # --board still redraws everything
    finally:
        app.dependency_overrides.clear()
