"""Base class for cell behaviours.

A cell behaviour is a stateless object (one shared instance per type). It reacts
to a player landing on a square via :meth:`on_land`, and — if it asked the player
to make a choice — resumes via :meth:`on_resolve`.

Behaviours never mutate state directly with ad-hoc logic; they call the engine's
helper methods (``engine.grant_money``, ``engine.add_scandal``, ``engine.send_to
_hospital`` …). This keeps rules like "2 scandals remove the role" or bankruptcy
handling in one place, so every cell stays consistent.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.enums import Role
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Decision, DecisionOption, Player


class BaseCell:
    """Default behaviour: landing does nothing. Override :meth:`on_land`."""

    #: Set by the ``@register_cell`` decorator.
    type_key: str = "__base__"

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        """Called when ``player`` lands on ``cell``. Default: no effect."""

    def on_resolve(
        self,
        engine: GameEngine,
        player: Player,
        cell: BoardCell,
        decision: Decision,
        option: DecisionOption,
    ) -> None:
        """Called when a decision this cell raised is answered. Default: no-op."""

    # ---- small helpers shared by many cells ------------------------------
    @staticmethod
    def has_role(player: Player, role: Role) -> bool:
        return player.role == role.value


@register_cell("__fallback__")
class FallbackCell(BaseCell):
    """Used for unknown/unregistered cell types so bad data degrades gracefully."""

