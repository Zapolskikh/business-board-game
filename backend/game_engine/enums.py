"""Enumerations and shared constants for the game engine.

Design notes:
    * Cell *types* are intentionally NOT an enum. They are string keys resolved
      through the cell registry so that new cell types can be added purely by
      registering a class + adding JSON data, without editing this file.
    * Roles ARE listed here because cell behaviours branch on role identity, but
      their metadata/numbers live in ``data/roles.json``.
"""
from __future__ import annotations

import sys
from enum import Enum, IntEnum

if sys.version_info >= (3, 11):
    from enum import StrEnum
else:  # pragma: no cover - compatibility shim for Python 3.10

    class StrEnum(str, Enum):
        """Minimal backport: string enum whose ``str()`` returns its value."""

        def __str__(self) -> str:
            return str(self.value)


class Ring(IntEnum):
    """The three concentric rings. Higher ring = higher risk/reward."""

    FIRST = 0
    SECOND = 1
    THIRD = 2


class Resource(StrEnum):
    """Core player resources."""

    MONEY = "money"
    EXPERIENCE = "experience"


class Role(StrEnum):
    """Temporary, unique, exclusive roles. Only one player may hold each at a time."""

    CAPITALIST = "capitalist"
    MAFIA = "mafia"
    POLITICIAN = "politician"
    JOURNALIST = "journalist"
    FRAUDSTER = "fraudster"
    MILITARY = "military"


class Phase(StrEnum):
    """Turn phases. The engine is a small state machine driven by actions."""

    AWAIT_ROLL = "await_roll"          # current player must ROLL_DICE
    AWAIT_DECISION = "await_decision"  # current player must RESOLVE_DECISION
    GAME_OVER = "game_over"


class ActionType(StrEnum):
    """Actions a client (human or bot) may submit."""

    ROLL_DICE = "roll_dice"
    RESOLVE_DECISION = "resolve_decision"


# Decision type keys (used to describe pending decisions to clients/bots).
# These are plain strings; add new ones freely as cells grow.
class DecisionType(StrEnum):
    BUY_PROPERTY = "buy_property"
    CASINO_BET = "casino_bet"
    CHOOSE_PLAYER = "choose_player"
    CHOOSE_CELL = "choose_cell"
    CHOOSE_CELL_ON_MAP = "choose_cell_on_map"  # visual pick on the board + confirm/cancel
    YES_NO = "yes_no"
    CHOOSE_OPTION = "choose_option"
    CHOOSE_ROLE = "choose_role"


ALL_ROLES: tuple[Role, ...] = tuple(Role)
