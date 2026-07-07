"""Places and movement cells: Start, Hospital, Jail, Taxi.

Start / Hospital / Jail are *destinations*: simply landing on them has no effect
(the Start bonus is granted while passing, and Hospital/Jail penalties are applied
by whatever sent the player there). Taxi lets a player teleport anywhere.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.cells.base import BaseCell
from game_engine.cells.common import CANCEL_OPTION_ID, MapCandidate, map_pick_decision
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


@register_cell("start")
class StartCell(BaseCell):
    """Landing on Start does nothing extra; the bonus is paid on crossing.

    Start also *handles the ring-promotion offer* raised by the engine when a
    player passes it with enough experience (``handler="start"``). Buying moves
    the player to the next ring's Start; declining resumes the deferred landing.
    """

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        if decision.context.get("kind") != "promotion":
            return
        if option.id == "promote":
            engine.promote_player(player, decision.context["next_ring"], decision.context["cost"])
        else:
            engine.resume_landing(player)


@register_cell("hospital")
class HospitalCell(BaseCell):
    """Just visiting. Being *sent* here is handled by ``engine.send_to_hospital``."""


@register_cell("jail")
class JailCell(BaseCell):
    """Just visiting. Being *sent* here is handled by ``engine.send_to_jail``."""


@register_cell("taxi")
class TaxiCell(BaseCell):
    """Pick any cell **on the same ring** and travel there for a fixed fare.

    The player selects the destination visually on the board, sees its details in
    the side panel and confirms/cancels. Travelling is optional (cancel = stay).
    The destination activates on arrival. Anti-abuse: you cannot chain Taxi->Taxi
    (the destination Taxi is inert for the rest of this turn).
    """

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        if player.flags.get("no_taxi"):
            return
        price = int(engine.balance.ring_value("taxi.price", cell.ring))
        affordable = player.money >= price
        candidates = [
            MapCandidate(
                cell_id=target.id,
                affordable=affordable,
                cost=price,
                note=f"«{target.title}»",
            )
            for target in engine.state.board.rings[cell.ring]
            if target.type != "taxi" and target.id != cell.id
        ]
        engine.request_decision(
            map_pick_decision(
                player,
                handler=cell.type,
                cell_id=cell.id,
                prompt=f"Такси: выберите клетку на этом круге. Цена {price}$.",
                candidates=candidates,
                action_kind="taxi",
                confirm_label=f"Поехать ({price}$)",
                cancel_label="Остаться на месте",
                extra_context={"price": price},
            )
        )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        if option.id == CANCEL_OPTION_ID:
            return
        price = decision.context.get("price", 0)
        if not engine.charge_money(player, price, reason="Такси"):
            return
        target = engine.state.board.by_id(option.data["cell_id"])
        player.flags["no_taxi"] = True  # block Taxi->Taxi chaining this turn
        engine.log_event(
            "taxi", f"{player.name} едет на «{target.title}».", player.id, cell_id=target.id
        )
        # Taxi drives FORWARD along the ring (play direction): passing Start still
        # pays the crossing bonus. It is a move, not a teleport.
        engine.walk_to_slot(player, target.slot, activate=True)
