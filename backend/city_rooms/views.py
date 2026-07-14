"""Safe client projections which never expose passwords or hidden game data."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from city_rooms.models import RoomState


def room_view(
    room: RoomState,
    viewer_id: str | None = None,
    legal_actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        **room.public_summary(),
        "max_rounds": room.max_rounds,
        "role_price": room.role_price,
        "created_at": room.created_at,
        "seats": [seat.to_dict() for seat in room.seats],
        "game": None,
        "legal_actions": legal_actions or [],
    }
    if room.game is None:
        return result

    game = deepcopy(room.game.to_dict())
    game["market_deck_count"] = len(game.pop("market_deck"))
    game["action_deck_count"] = len(game.pop("action_deck"))
    game.pop("rng", None)
    game.pop("processed_command_ids", None)
    game.pop("command_log", None)
    for event in game["event_log"]:
        if event["type"] == "game_created":
            event["data"].pop("seed", None)
        if event["type"] == "free_action_card_drawn" and event["actor_id"] != viewer_id:
            event["data"].pop("card_id", None)
    for player in game["players"]:
        if player["id"] != viewer_id:
            player["hand_count"] = len(player.pop("hand"))
    result["game"] = game
    return result
