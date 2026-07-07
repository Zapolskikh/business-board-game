"""In-memory game store.

Holds active games for the API. Deliberately simple (a dict) for the MVP; the
design's persistence/rooms/WebSocket work (Milestone 3) can replace this without
touching the engine. Not thread-safe — fine for a single-process dev server.
"""
from __future__ import annotations

import uuid
from typing import Any

from game_engine import GameEngine, GameState, build_game


class GameManager:
    def __init__(self) -> None:
        self._games: dict[str, GameState] = {}

    def create(
        self,
        players: list[dict[str, Any]],
        board: str | None = None,
        seed: int | None = None,
        config_overrides: dict[str, Any] | None = None,
    ) -> GameState:
        game_id = uuid.uuid4().hex[:8]
        state = build_game(
            game_id, players, board_name=board, seed=seed, config_overrides=config_overrides
        )
        self._games[game_id] = state
        return state

    def get(self, game_id: str) -> GameState:
        if game_id not in self._games:
            raise KeyError(game_id)
        return self._games[game_id]

    def engine(self, game_id: str) -> GameEngine:
        return GameEngine(self.get(game_id))

    def delete(self, game_id: str) -> None:
        self._games.pop(game_id, None)

    def list_ids(self) -> list[str]:
        return list(self._games)


# Single shared manager for the app process.
manager = GameManager()
