"""Shared "simple effect" dispatcher for filler cells and "?" cards.

An effect is a tiny data spec — ``{"kind": ..., "key"/"amount": ...}`` — so new
filler cells and new "?" cards are (almost) pure data. ``key`` reads a per-ring
array from ``balance.json``; ``amount`` is a flat value. Behaviours never mutate
state directly: every branch calls an engine helper, so cross-cutting rules
(bankruptcy, "2 scandals remove the role", …) stay in one place.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


def _amount(
    engine: GameEngine,
    cell: BoardCell,
    *,
    key: str | None = None,
    amount: int | None = None,
    default: int = 0,
) -> int:
    if amount is not None:
        return int(amount)
    if key:
        return int(engine.balance.ring_value(key, cell.ring, default=default))
    return default


def apply_simple_effect(
    engine: GameEngine,
    player: Player,
    cell: BoardCell,
    kind: str,
    *,
    key: str | None = None,
    amount: int | None = None,
    reason: str = "",
) -> None:
    """Apply one simple effect identified by ``kind`` to ``player``."""
    if kind == "money_plus":
        engine.grant_money(player, _amount(engine, cell, key=key, amount=amount), reason=reason or "Прибыль")
    elif kind == "money_minus":
        engine.charge_money(player, _amount(engine, cell, key=key, amount=amount), reason=reason or "Убыток")
    elif kind == "windfall":
        engine.grant_money(
            player, _amount(engine, cell, key=key or "fillers.windfall", amount=amount), reason=reason or "Джекпот"
        )
    elif kind == "exp_plus":
        engine.grant_experience(
            player, _amount(engine, cell, key=key, amount=amount, default=1), reason=reason or "Опыт"
        )
    elif kind == "exp_minus":
        engine.lose_experience(
            player, _amount(engine, cell, key=key, amount=amount, default=1), reason=reason or "Потеря опыта"
        )
    elif kind == "scandal_plus":
        engine.add_scandal(player, int(amount or 1), reason=reason or "Скандал")
    elif kind == "scandal_minus":
        engine.remove_scandal(player, int(amount or 1), reason=reason or "PR-служба")
    elif kind == "role_loss":
        if player.role:
            engine.remove_role(player, reason=reason or "Потеря роли")
        else:
            engine.log_event("role_lost", f"{player.name}: роли нет — терять нечего.", player.id)
    elif kind == "roof_gift":
        engine.add_roof(player, int(amount or 1))
    elif kind == "extra_roll":
        player.extra_rolls += int(amount or 1)
        engine.log_event("roll_again", f"{player.name} получает дополнительный бросок.", player.id)
    else:  # pragma: no cover - guard against bad data
        engine.log_event("noop", f"Неизвестный эффект: {kind}", player.id)
