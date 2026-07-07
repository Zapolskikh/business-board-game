"""Danger cells: Ambush (Засада) and Checkpoint (Блокпост).

Both interact with Крыша: a roof charge is consumed instead of applying the harsh
effect (design sections 6.1, 7.6, 7.7).
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.cells.base import BaseCell
from game_engine.cells.common import player_options, roll_decision
from game_engine.enums import DecisionType, Role
from game_engine.models import Decision, DecisionOption
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


@register_cell("ambush")
class AmbushCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        # Roof always saves you first (except Military/Capitalist who get a choice).
        if self.has_role(player, Role.MILITARY):
            self._military(engine, player, cell)
            return
        if self.has_role(player, Role.CAPITALIST):
            if engine.consume_roof(player):
                return
            ransom = int(engine.balance.ring_value("ambush.capitalist_ransom", cell.ring))
            engine.request_decision(
                Decision(
                    DecisionType.YES_NO, player.id,
                    f"Капиталист: заплатить выкуп {ransom}$ и не идти в Больницу?",
                    [DecisionOption("pay", f"Заплатить {ransom}$"), DecisionOption("hospital", "В Больницу")],
                    handler=cell.type, cell_id=cell.id, context={"kind": "capitalist", "ransom": ransom},
                )
            )
            return

        if engine.consume_roof(player):
            return
        if self.has_role(player, Role.MAFIA):
            # Separate, deliberate roll to fight off the ambush (1-3 -> Hospital).
            engine.request_decision(
                roll_decision(
                    player, cell.type, cell.id,
                    "Мафиози: бросьте кубик, чтобы отбиться (1-3 — Больница).",
                    context={"kind": "mafia_escape"},
                )
            )
        else:
            engine.send_to_hospital(player)

    def _military(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        if player.roofs > 0:
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_OPTION, player.id,
                    "Военный: потерять Крышу или бросить кубик (1-2 Больница)?",
                    [
                        DecisionOption("roof", "Потерять Крышу", hint="Потратить одну Крышу и избежать риска."),
                        DecisionOption("roll", "Бросить кубик", rolls_dice=True, hint="1-2 → Больница."),
                    ],
                    handler=cell.type, cell_id=cell.id, context={"kind": "military"},
                )
            )
        else:
            self._military_roll(engine, player)

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        kind = decision.context.get("kind")
        if kind == "mafia_escape":
            die = engine.interaction_roll(player, reason="Засада (Мафиози)")
            if die <= 3:
                engine.send_to_hospital(player)
        elif kind == "capitalist":
            if option.id == "pay":
                if not engine.charge_money(player, decision.context["ransom"], reason="выкуп из Засады"):
                    engine.send_to_hospital(player)
            else:
                engine.send_to_hospital(player)
        elif kind == "military":
            if option.id == "roof":
                engine.consume_roof(player)
            else:
                self._military_roll(engine, player)

    @staticmethod
    def _military_roll(engine: GameEngine, player: Player) -> None:
        die = engine.interaction_roll(player, reason="Засада (Военный)")
        if die <= 2:
            engine.send_to_hospital(player)


@register_cell("checkpoint")
class CheckpointCell(BaseCell):
    """Rare, harsh force check. Roof is consumed instead of losing a role."""

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        fine_base = int(engine.balance.ring_value("checkpoint.fine_base", cell.ring))
        fine_big = int(engine.balance.ring_value("checkpoint.fine_big", cell.ring))

        if self.has_role(player, Role.MILITARY):
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_PLAYER, player.id,
                    "Военный: у кого снять роль (или Крышу)?",
                    player_options(engine.state.players),
                    handler=cell.type, cell_id=cell.id, context={"kind": "military"},
                )
            )
        elif self.has_role(player, Role.MAFIA) or self.has_role(player, Role.FRAUDSTER):
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_OPTION, player.id,
                    f"Заплатить крупный штраф {fine_big}$ или потерять роль?",
                    [DecisionOption("pay", f"Заплатить {fine_big}$"), DecisionOption("role", "Потерять роль")],
                    handler=cell.type, cell_id=cell.id, context={"kind": "role_or_pay", "fine_big": fine_big},
                )
            )
        else:
            engine.charge_money(player, fine_base, reason="проверка на Блокпосту")

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        kind = decision.context.get("kind")
        if kind == "military":
            target = engine.state.player_by_id(option.data["player_id"])
            if not engine.consume_roof(target):  # roof protects the role
                engine.remove_role(target, reason="Блокпост (Военный)")
        elif kind == "role_or_pay":
            if option.id == "pay":
                engine.charge_money(player, decision.context["fine_big"], reason="штраф на Блокпосту")
            elif not engine.consume_roof(player):  # roof protects the role
                engine.remove_role(player, reason="Блокпост")
