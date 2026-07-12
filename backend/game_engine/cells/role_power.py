"""One-shot powers fired when a player receives a new role."""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.cells.base import BaseCell
from game_engine.cells.cards import give_card
from game_engine.cells.common import do_buy
from game_engine.enums import DecisionType, Role
from game_engine.models import Decision, DecisionOption
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


def _other_players(engine: GameEngine, player: Player) -> list[Player]:
    return [p for p in engine.state.players if p.id != player.id]


def start_role_power(engine: GameEngine, player: Player, role_id: str) -> None:
    if role_id == Role.CAPITALIST.value:
        options = [
            DecisionOption(c.id, f"Купить «{c.title}» за {c.price}$", {"cell_id": c.id})
            for c in engine.state.board.free_buyable_cells()
            if player.money >= c.price
        ]
        if options:
            options.append(DecisionOption("skip", "Не покупать"))
            engine.request_decision(Decision(
                DecisionType.CHOOSE_OPTION,
                player.id,
                "Капиталист: можно купить любой свободный объект без скидки.",
                options,
                "role_power",
                context={"kind": "capitalist_buy"},
            ))
    elif role_id == Role.MAFIA.value:
        options: list[DecisionOption] = []
        for target in _other_players(engine, player):
            if target.roofs > 0:
                options.append(DecisionOption(f"roof:{target.id}", f"Снять Крышу с {target.name}", {"player_id": target.id}))
            if engine.state.board.cells_owned_by(target.id):
                options.append(DecisionOption(f"take:{target.id}", f"Отжать объект у {target.name}", {"player_id": target.id}))
        options.append(DecisionOption("skip", "Не давить"))
        engine.request_decision(Decision(DecisionType.CHOOSE_OPTION, player.id, "Мафиози: снять Крышу или отжать объект.", options, "role_power", context={"kind": "mafia"}))
    elif role_id == Role.POLITICIAN.value:
        engine.remove_scandal(player, reason="Политик")
        engine.add_roof(player)
    elif role_id == Role.JOURNALIST.value:
        targets = _other_players(engine, player)
        if targets:
            engine.request_decision(Decision(DecisionType.CHOOSE_PLAYER, player.id, "Журналист: кому дать скандал?", [
                DecisionOption(t.id, t.name, {"player_id": t.id}) for t in targets
            ], "role_power", context={"kind": "journalist"}))
    elif role_id == Role.FRAUDSTER.value:
        give_card(engine, player, "hand")
    elif role_id == Role.MILITARY.value:
        targets = _other_players(engine, player)
        if targets:
            engine.request_decision(Decision(DecisionType.CHOOSE_PLAYER, player.id, "Военный: снять Крышу, иначе роль.", [
                DecisionOption(t.id, t.name, {"player_id": t.id}) for t in targets
            ], "role_power", context={"kind": "military"}))


@register_cell("role_power")
class RolePowerBehaviour(BaseCell):
    def on_resolve(self, engine: GameEngine, player: Player, cell: BoardCell | None, decision: Decision, option: DecisionOption) -> None:
        kind = decision.context.get("kind")
        if kind == "capitalist_buy":
            if option.id != "skip":
                target = engine.state.board.by_id(option.data["cell_id"])
                do_buy(engine, player, target)
        elif kind == "mafia":
            if option.id == "skip":
                return
            target = engine.state.player_by_id(option.data["player_id"])
            if option.id.startswith("roof:"):
                engine.consume_roof(target)
            elif option.id.startswith("take:"):
                owned = engine.state.board.cells_owned_by(target.id)
                if not owned:
                    return
                engine.request_decision(Decision(
                    DecisionType.CHOOSE_OPTION,
                    target.id,
                    f"Мафиози давит: выберите объект, который отдаете {player.name}.",
                    [DecisionOption(c.id, c.title, {"cell_id": c.id}) for c in owned],
                    "role_power",
                    context={"kind": "mafia_take_pick", "mafia_id": player.id},
                ))
        elif kind == "mafia_take_pick":
            mafia = engine.state.player_by_id(decision.context["mafia_id"])
            target = engine.state.board.by_id(option.data["cell_id"])
            owner = engine.state.player_by_id(target.owner_id) if target.owner_id else None
            if owner and owner.role == Role.MILITARY.value:
                engine.log_event("military_immunity", f"{owner.name}: у Военного нельзя отжимать объекты.", owner.id)
                return
            target.owner_id = mafia.id
            engine.log_event("role_power", f"{mafia.name} отжимает «{target.title}».", mafia.id, cell_id=target.id)
        elif kind == "journalist":
            target = engine.state.player_by_id(option.data["player_id"])
            engine.add_scandal(target, 1, reason="Журналист")
        elif kind == "military":
            target = engine.state.player_by_id(option.data["player_id"])
            if not engine.consume_roof(target):
                engine.remove_role(target, reason="Военный")
