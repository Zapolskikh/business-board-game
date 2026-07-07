"""Role cell (Клетка роли) — the core mechanic: acquire or switch a role.

Roles are temporary, unique and exclusive (design section 4.1): a role can only
be taken if no other player currently holds it. Landing here lets the player take
any free role, or keep their current one.

Open design questions (section 12.1) — role duration, forced drop, frequency —
are intentionally left as TODO and can be layered on without touching the engine.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.cells.base import BaseCell
from game_engine.config_loader import load_role_ids, load_roles
from game_engine.enums import DecisionType
from game_engine.models import Decision, DecisionOption
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player

# Loaded once; role ids/titles are static content.
_ROLE_IDS = load_role_ids()
_ROLE_TITLES = {r["id"]: r["title"] for r in load_roles()}


@register_cell("role")
class RoleCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        taken = {p.role for p in engine.state.players if p.role}
        free_roles = [r for r in _ROLE_IDS if r not in taken or r == player.role]
        free_roles = [r for r in free_roles if r != player.role]
        if not free_roles:
            engine.log_event("role_cell", "Свободных ролей нет.", player.id)
            return
        options = [
            DecisionOption(r, f"Взять роль: {_ROLE_TITLES.get(r, r)}", {"role": r}) for r in free_roles
        ]
        keep_label = "Оставить текущую роль" if player.role else "Остаться без роли"
        options.append(DecisionOption("skip", keep_label))
        engine.request_decision(
            Decision(
                DecisionType.CHOOSE_ROLE, player.id, "Клетка роли: выбрать роль",
                options, handler=cell.type, cell_id=cell.id, context={},
            )
        )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        if option.id == "skip":
            return
        engine.set_role(player, option.data["role"])
