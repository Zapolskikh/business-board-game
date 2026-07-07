"""Configuration and balance access.

Two ideas:

* :class:`Balance` wraps the raw ``balance.json`` dict and offers helpers to read
  values that are either scalars or per-ring arrays. Cells read numbers only
  through this object, never hard-coded literals.
* :class:`GameConfig` bundles everything a game needs to start: starting
  resources, dice, victory rules, ring-promotion rules and the ``Balance``.

Both are constructed from plain dicts (loaded from JSON) so designers can tune
the game without touching Python.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class Balance:
    """Read-only accessor over the nested ``balance.json`` structure.

    Supports dotted paths and per-ring arrays::

        balance.ring_value("start_bonus", ring=2)     # start_bonus[2]
        balance.ring_value("prices.casino", ring=0)   # prices.casino[0]
        balance.get("casino.fraudster_win_min")       # scalar
    """

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def get(self, path: str, default: Any = None) -> Any:
        node: Any = self._data
        for part in path.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def ring_value(self, path: str, ring: int, default: Any = 0) -> Any:
        """Return ``value[ring]`` if the value is a list, else the scalar itself."""
        value = self.get(path, default)
        if isinstance(value, (list, tuple)):
            if 0 <= ring < len(value):
                return value[ring]
            # Fall back to the last defined ring value if the array is short.
            return value[-1] if value else default
        return value

    def as_dict(self) -> dict[str, Any]:
        return self._data


@dataclass
class VictoryConfig:
    """Placeholder victory rules (design says exact conditions are TBD).

    A game ends when either a player reaches ``target_net_worth`` or ``max_turns``
    full rounds elapse. The winner is the player with the highest net worth.
    Net worth = money + owned cell prices + experience * ``experience_weight``.
    """

    max_turns: int = 60
    target_net_worth: int = 4000
    experience_weight: int = 25


@dataclass
class PromotionConfig:
    """Optional ring-promotion at Start.

    Rings 2 and 3 are otherwise unreachable in the MVP (Gate cell is a future
    design task). When ``enabled`` is true, a player who passes Start with enough
    experience advances to the next ring, which lets simulations exercise all
    three rings and reveal ring balance.
    """

    enabled: bool = True
    # Experience *cost* to buy a promotion at Start: index = ring you move INTO.
    # e.g. [_, 10, 30] -> 10 exp to reach ring 2, 30 exp to reach ring 3.
    experience_required: list[int] = field(default_factory=lambda: [0, 10, 30])


@dataclass
class GameConfig:
    """Everything needed to start a game, assembled from JSON data."""

    balance: Balance
    starting_money: int = 300
    starting_experience: int = 0
    dice_sides: int = 6
    board_name: str = "board_72"
    victory: VictoryConfig = field(default_factory=VictoryConfig)
    promotion: PromotionConfig = field(default_factory=PromotionConfig)
    # Extra knobs that individual cells may read.
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any], balance: Balance) -> GameConfig:
        victory = VictoryConfig(**data.get("victory", {}))
        promotion = PromotionConfig(**data.get("promotion", {}))
        return cls(
            balance=balance,
            starting_money=data.get("starting_money", 300),
            starting_experience=data.get("starting_experience", 0),
            dice_sides=data.get("dice_sides", 6),
            board_name=data.get("board_name", "board_72"),
            victory=victory,
            promotion=promotion,
            extra=data.get("extra", {}),
        )
