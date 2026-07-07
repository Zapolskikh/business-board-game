"""Pure, self-contained game engine for the satirical business board game.

This package MUST NOT depend on the web layer (FastAPI) or the simulation layer.
Keeping it dependency-free is what makes the rules testable and simulatable.

Public entry points:
    - ``GameEngine``: applies actions to a ``GameState`` and returns events.
    - ``build_game``: convenience factory that wires config + board + players.
"""
from game_engine.engine import GameEngine
from game_engine.factory import build_game
from game_engine.models import GameState, Player

__all__ = ["GameEngine", "build_game", "GameState", "Player"]
