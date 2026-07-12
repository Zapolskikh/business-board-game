"""Generic Крыша protection decision handler."""
from game_engine.cells.base import BaseCell
from game_engine.registry import register_cell


@register_cell("roof_protection")
class RoofProtection(BaseCell):
    def on_resolve(self, engine, player, cell, decision, option) -> None:
        if option.id == "use_roof":
            engine.consume_roof(player)
            engine.log_event("negative_cancelled", f"{player.name}: Крыша отменяет негативный эффект.", player.id)
        else:
            ctx = decision.context
            engine.execute_negative_effect(player, ctx["kind"], reason=ctx.get("reason", ""), **ctx.get("data", {}))
        engine.continue_negative_queue()
