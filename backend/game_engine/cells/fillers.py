"""Simple filler cells (design section 11).

These keep the map varied without piling on complex objects. Most are single
purpose and data-driven via :func:`apply_simple_effect`, which also powers the
"?" card deck. Cells that need a die (move-N, "?") raise a *separate* roll
decision instead of auto-rolling, so the player rolls deliberately.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.cells.base import BaseCell
from game_engine.cells.common import roll_decision
from game_engine.cells.cards import give_card
from game_engine.cells.effects import apply_simple_effect
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


# ---------------------------------------------------------------------------
# Deterministic, decision-free fillers (no dice, no choices).
# ---------------------------------------------------------------------------
@register_cell("money_minus")
class MoneyMinusCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        apply_simple_effect(engine, player, cell, "money_minus", key="fillers.money_minus", reason="Убыток")


@register_cell("windfall")
class WindfallCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        apply_simple_effect(engine, player, cell, "windfall", key="fillers.windfall", reason="Джекпот")


@register_cell("scandal_plus")
class ScandalPlusCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        apply_simple_effect(engine, player, cell, "scandal_plus", reason="Скандал")


@register_cell("scandal_minus")
class ScandalMinusCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        apply_simple_effect(engine, player, cell, "scandal_minus", reason="PR-служба")


@register_cell("role_loss")
class RoleLossCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        apply_simple_effect(engine, player, cell, "role_loss", reason="Клетка потери роли")


@register_cell("roof_gift")
class RoofGiftCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        apply_simple_effect(engine, player, cell, "roof_gift", reason="Крыша в подарок")


@register_cell("experience")
class ExperienceCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        engine.grant_experience(player, engine.balance.ring_value("fillers.experience", cell.ring), reason="Опыт")


@register_cell("experience_loss")
class ExperienceLossCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        apply_simple_effect(engine, player, cell, "exp_minus", key="fillers.experience_loss", reason="Потеря опыта")


@register_cell("roll_again")
class RollAgainCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        player.extra_rolls += 1
        engine.log_event("roll_again", f"{player.name} получает дополнительный бросок.", player.id)


# ---------------------------------------------------------------------------
# Dice-driven movement fillers — the player makes a SEPARATE, deliberate roll.
# ---------------------------------------------------------------------------
@register_cell("move_forward")
class MoveForwardCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        max_steps = int(engine.balance.get("fillers.move_forward_max", 4))
        engine.request_decision(
            roll_decision(
                player, cell.type, cell.id,
                f"Ход вперёд: бросьте кубик (1–{max_steps}), чтобы переместиться.",
                context={"dir": 1, "max": max_steps},
            )
        )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        _resolve_move(engine, player, cell, decision, sign=decision.context.get("dir", 1))


@register_cell("move_back")
class MoveBackCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        max_steps = int(engine.balance.get("fillers.move_back_max", 4))
        engine.request_decision(
            roll_decision(
                player, cell.type, cell.id,
                f"Ход назад: бросьте кубик (1–{max_steps}), чтобы переместиться.",
                context={"dir": -1, "max": max_steps},
            )
        )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        _resolve_move(engine, player, cell, decision, sign=decision.context.get("dir", -1))


def _resolve_move(engine: GameEngine, player, cell, decision, sign: int) -> None:
    max_steps = int(decision.context.get("max", 4))
    steps = engine.interaction_roll(player, reason="перемещение", sides=max_steps)
    engine.move_and_activate(player, sign * steps)


# ---------------------------------------------------------------------------
# "?" card — a data-driven deck (source of truth for the game AND the FAQ).
# ---------------------------------------------------------------------------
@register_cell("question")
class QuestionCell(BaseCell):
    """Draw a held "?" card into the player's hand."""

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        engine.request_decision(
            roll_decision(
                player, cell.type, cell.id,
                "Карта «?» в руку: бросьте кубик, чтобы вытянуть карту.",
                context={"deck": "hand"},
            )
        )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        engine.interaction_roll(player, reason="карта «?»")
        give_card(engine, player, decision.context.get("deck", "hand"))


@register_cell("question_instant")
class InstantQuestionCell(QuestionCell):
    """Draw and immediately resolve an instant "?" card."""

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        engine.request_decision(
            roll_decision(
                player, cell.type, cell.id,
                "Мгновенная карта «?»: бросьте кубик, чтобы вытянуть событие.",
                context={"deck": "instant"},
            )
        )
