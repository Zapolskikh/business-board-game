"""Deterministic reconstruction from the private authoritative command journal."""

from __future__ import annotations

from city_engine.commands import Command
from city_engine.engine import CityEngine
from city_engine.errors import StateValidationError
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_engine.models import GameState


def replay_game(snapshot: GameState, engine: CityEngine | None = None) -> GameState:
    """Rebuild a snapshot from its game-created seed and accepted commands."""
    snapshot.validate()
    created = next((event for event in snapshot.event_log if event.type == "game_created"), None)
    if created is None or "seed" not in created.data:
        raise StateValidationError("game_created event with seed is required for replay")
    engine = engine or CityEngine()
    state = create_game_from_catalog(
        snapshot.game_id,
        [
            PlayerSetup(
                id=player.id,
                name=player.name,
                is_bot=player.is_bot,
                difficulty=player.difficulty,
                preferred_role=player.preferred_role,
            )
            for player in snapshot.players
        ],
        seed=int(created.data["seed"]),
        settings=GameSettings(max_rounds=snapshot.max_rounds, role_price=snapshot.role_price),
        catalog=engine.catalog,
    )
    for raw_command in snapshot.command_log:
        state = engine.apply(state, Command.from_dict(raw_command)).state
    return state
