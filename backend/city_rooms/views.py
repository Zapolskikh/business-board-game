"""Safe client projections which never expose passwords or hidden game data."""

from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
from typing import Any

from city_engine.engine import CityEngine
from city_engine.models import PlayerState
from city_rooms.models import RoomState


@lru_cache(maxsize=1)
def _scoring_engine() -> CityEngine:
    """Stateless scorer for projections; the catalog behind it is cached too."""
    return CityEngine()


def _viewer(room: RoomState, viewer_id: str | None) -> PlayerState | None:
    if room.game is None or viewer_id is None:
        return None
    try:
        return room.game.player_by_id(viewer_id)
    except KeyError:
        return None


def _round_forecast(room: RoomState, viewer_id: str | None) -> dict[str, dict[str, int]] | None:
    """The viewer's itemised round payout, from the same code that pays it out."""
    player = _viewer(room, viewer_id)
    if player is None or room.game is None:
        return None
    return _scoring_engine().round_forecast(room.game, player)


def room_journal(room: RoomState) -> dict[str, Any]:
    """The full replayable record of a finished game.

    ``room_view`` strips the seed and the command journal because they are hidden information
    while the game runs. Once it is over there is nothing left to hide, and this is the only
    projection ``city_engine.replay.replay_game`` can rebuild a match from — which is what makes
    a saved game analysable ("what if I had taken the project instead") rather than just readable.
    """
    if room.game is None:
        raise ValueError("the room has no game to export")
    if room.game.status != "finished":
        raise ValueError("the journal is only exported after the game is finished")
    game = room.game.to_dict()
    engine = _scoring_engine()
    return {
        "room_id": room.id,
        "room_name": room.name,
        "exported_revision": room.revision,
        "rules_version": game["rules_version"],
        "content_version": game["content_version"],
        "seats": [seat.to_dict() for seat in room.seats],
        "score_breakdown": {player.id: engine.score_breakdown(player) for player in room.game.players},
        "game": game,
    }


def room_view(
    room: RoomState,
    viewer_id: str | None = None,
    legal_actions: list[dict[str, Any]] | None = None,
    market_prices: dict[str, int] | None = None,
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
    game["project_deck_count"] = len(game.pop("project_deck"))
    # Live score itemised by the engine. The client used to re-implement the formula; with money
    # and influence now converting at a rate, one authoritative breakdown is the only sane option.
    engine = _scoring_engine()
    game["score_breakdown"] = {player.id: engine.score_breakdown(player) for player in room.game.players}
    # Moving the token is free, so the payoff of each option must be on screen, not in the head.
    # A permanent project perk paying +1◆ a round was indistinguishable from one paying nothing.
    game["round_forecast"] = _round_forecast(room, viewer_id)
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
    # The viewer's own price for every market slot: discounts are per-player, so the client
    # must not recompute them (two implementations of asset_price already drifted apart once).
    # "The three oldest slots leave when the round opens" is a rule, and the three oldest are not
    # the first three of anything the client can see, so the engine answers instead of the client.
    leaving = set(engine.market_rotation_uids(room.game))
    for item in game["market"]:
        if market_prices and item["uid"] in market_prices:
            item["price"] = market_prices[item["uid"]]
        item["leaving"] = item["uid"] in leaving
    result["game"] = game
    return result
