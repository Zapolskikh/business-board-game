"""Buyable objects: Newspaper (Газета), Casino (Казино), Station (Вокзал).

These implement the role-specific activation rules from the design document
(sections 7.2–7.4). Ownership effects do NOT depend on the owner's role.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.cells.base import BaseCell
from game_engine.cells.common import (
    CANCEL_OPTION_ID,
    MapCandidate,
    buy_options,
    do_buy,
    map_pick_decision,
    other_players,
    player_options,
    roll_decision,
)
from game_engine.enums import DecisionType, Role
from game_engine.models import Decision, DecisionOption
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


# ---------------------------------------------------------------------------
# Newspaper (Газета)
# ---------------------------------------------------------------------------
@register_cell("newspaper")
class NewspaperCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        if cell.owner_id is None:
            self._offer_buy(engine, player, cell)
            return
        if cell.owner_id == player.id:
            self._reduce_scandal(engine, player)
            return

        owner = engine.state.player_by_id(cell.owner_id)
        if self.has_role(player, Role.JOURNALIST):
            targets = other_players(engine.state, player)
            if not targets:
                return
            engine.request_decision(
                Decision(
                    type=DecisionType.CHOOSE_PLAYER,
                    player_id=player.id,
                    prompt="Журналист: кому отправить скандал?",
                    options=player_options(targets),
                    handler=cell.type,
                    cell_id=cell.id,
                    context={"kind": "journalist"},
                )
            )
        elif self.has_role(player, Role.CAPITALIST):
            pay = engine.balance.ring_value("newspaper.capitalist_pay_owner", cell.ring)
            engine.request_decision(
                Decision(
                    type=DecisionType.YES_NO,
                    player_id=player.id,
                    prompt=f"Заплатить владельцу {pay}$ и избежать скандала?",
                    options=[
                        DecisionOption("pay", f"Заплатить {pay}$"),
                        DecisionOption("take", "Получить скандал"),
                    ],
                    handler=cell.type,
                    cell_id=cell.id,
                    context={"kind": "capitalist", "pay": pay, "owner_id": owner.id},
                )
            )
        else:
            engine.add_scandal(player, 1, reason="чужая Газета")

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        kind = decision.context.get("kind")
        if kind == "buy":
            if option.id == "buy":
                do_buy(engine, player, cell)
        elif kind == "journalist":
            target = engine.state.player_by_id(option.data["player_id"])
            engine.add_scandal(target, 1, reason="Журналист")
        elif kind == "capitalist":
            if option.id == "pay":
                owner = engine.state.player_by_id(decision.context["owner_id"])
                engine.transfer_money(player, owner, decision.context["pay"], reason="откуп от Газеты")
            else:
                engine.add_scandal(player, 1, reason="чужая Газета")

    def _offer_buy(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        engine.request_decision(
            Decision(
                type=DecisionType.BUY_PROPERTY,
                player_id=player.id,
                prompt=f"Газета свободна. Купить за {cell.price}$?",
                options=buy_options(cell),
                handler=cell.type,
                cell_id=cell.id,
                context={"kind": "buy"},
            )
        )

    @staticmethod
    def _reduce_scandal(engine: GameEngine, player: Player) -> None:
        engine.remove_scandal(player, reason="своя Газета")


# ---------------------------------------------------------------------------
# Casino (Казино)
# ---------------------------------------------------------------------------
@register_cell("casino")
class CasinoCell(BaseCell):
    """Playing is OPTIONAL and the gamble uses a SEPARATE, deliberate roll.

    Free -> buy / play against the bank / skip. Owned by another -> play or skip
    (the Capitalist may first double the bet). Winning needs die >= 5 (Аферист:
    >= 3). Mafia pays only half its losses.
    """

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        if cell.owner_id is None:
            options: list[DecisionOption] = []
            if player.money >= cell.price:
                options.append(DecisionOption("buy", f"Купить за {cell.price}$"))
            options.append(DecisionOption(
                "play_bank", "Играть против банка",
                rolls_dice=True, hint="Нужен бросок 5-6 (Аферист 3-6), чтобы выиграть.",
            ))
            options.append(DecisionOption("skip", "Пропустить"))
            engine.request_decision(
                Decision(
                    type=DecisionType.BUY_PROPERTY,
                    player_id=player.id,
                    prompt=f"Казино свободно (цена {cell.price}$).",
                    options=options,
                    handler=cell.type,
                    cell_id=cell.id,
                    context={"kind": "free"},
                )
            )
            return
        if cell.owner_id == player.id:
            return

        if self.has_role(player, Role.CAPITALIST):
            engine.request_decision(
                Decision(
                    type=DecisionType.CASINO_BET,
                    player_id=player.id,
                    prompt="Капиталист: сыграть в чужом Казино?",
                    options=[
                        DecisionOption("double", "Играть, удвоив ставку", rolls_dice=True,
                                       hint="Удвоить ставку и бросить кубик."),
                        DecisionOption("single", "Играть обычной ставкой", rolls_dice=True,
                                       hint="Обычная ставка, бросок кубика."),
                        DecisionOption("skip", "Не играть"),
                    ],
                    handler=cell.type,
                    cell_id=cell.id,
                    context={"kind": "capitalist_double", "owner_id": cell.owner_id},
                )
            )
        else:
            engine.request_decision(
                Decision(
                    type=DecisionType.CHOOSE_OPTION,
                    player_id=player.id,
                    prompt="Сыграть в чужом Казино?",
                    options=[
                        DecisionOption("play", "Играть", rolls_dice=True,
                                       hint="Нужен бросок 5-6 (Аферист 3-6), чтобы выиграть."),
                        DecisionOption("skip", "Не играть"),
                    ],
                    handler=cell.type,
                    cell_id=cell.id,
                    context={"kind": "play", "owner_id": cell.owner_id},
                )
            )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        kind = decision.context.get("kind")
        if kind == "free":
            if option.id == "buy":
                do_buy(engine, player, cell)
            elif option.id == "play_bank":
                self._offer_roll(engine, player, cell, owner_id=None, multiplier=1)
            # "skip" -> nothing
        elif kind == "play":
            if option.id == "play":
                self._offer_roll(engine, player, cell, decision.context["owner_id"], multiplier=1)
        elif kind == "capitalist_double":
            if option.id == "skip":
                return
            multiplier = 2 if option.id == "double" else 1
            self._offer_roll(engine, player, cell, decision.context["owner_id"], multiplier)
        elif kind == "gamble_roll":
            self._gamble(engine, player, cell, decision.context.get("owner_id"), decision.context["multiplier"])

    def _offer_roll(
        self, engine: GameEngine, player: Player, cell: BoardCell, owner_id: str | None, multiplier: int
    ) -> None:
        threshold = 3 if self.has_role(player, Role.FRAUDSTER) else 5
        engine.request_decision(
            roll_decision(
                player, cell.type, cell.id,
                f"Казино: бросьте кубик (выигрыш при {threshold}-6).",
                context={"kind": "gamble_roll", "owner_id": owner_id, "multiplier": multiplier},
            )
        )

    def _gamble(
        self,
        engine: GameEngine,
        player: Player,
        cell: BoardCell,
        owner_id: str | None,
        multiplier: int,
    ) -> None:
        bet = int(engine.balance.ring_value("casino.base_bet", cell.ring)) * multiplier
        die = engine.interaction_roll(player, reason="Казино")
        win_threshold = 3 if self.has_role(player, Role.FRAUDSTER) else 5  # win on die >= threshold
        won = die >= win_threshold
        owner = engine.state.player_by_id(owner_id) if owner_id else None

        if won:
            if owner is not None:
                engine.transfer_money(owner, player, bet, reason="выигрыш в Казино")
            else:
                engine.grant_money(player, bet, reason="выигрыш в Казино (банк)")
        else:
            loss = bet
            if self.has_role(player, Role.MAFIA):
                loss = int(bet * engine.balance.get("casino.mafia_loss_multiplier", 0.5))
            engine.charge_money(player, loss, reason="проигрыш в Казино", to_player=owner)


# ---------------------------------------------------------------------------
# Station (Вокзал)
# ---------------------------------------------------------------------------
@register_cell("station")
class StationCell(BaseCell):
    """A transit hub. Landing lets you (optionally) buy it, or travel to another
    station on the same ring.

    You pay the fare **only when you actually travel**, and it goes to the owner of
    the station you *depart from* (the bank if it is unowned). The destination
    station yields no profit and does not activate — it is purely a way to move
    around the ring. Аферист (fraudster) travels for free.
    """

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        self._offer_menu(engine, player, cell)

    def _travel_cost(self, engine: GameEngine, player: Player, cell: BoardCell) -> int:
        # Fraudster rides for free; so does the owner departing their OWN station.
        if self.has_role(player, Role.FRAUDSTER) or cell.owner_id == player.id:
            return 0
        return int(engine.balance.ring_value("station.fare", cell.ring))

    def _other_stations(self, engine: GameEngine, cell: BoardCell) -> list[BoardCell]:
        return [c for c in engine.state.board.find_by_type("station", cell.ring) if c.id != cell.id]

    def _offer_menu(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        cost = self._travel_cost(engine, player, cell)
        options: list[DecisionOption] = []
        if cell.owner_id is None and player.money >= cell.price:
            options.append(
                DecisionOption("buy", f"Купить «{cell.title}» за {cell.price}$", {"cell_id": cell.id})
            )
        # After arriving via station-travel this turn, you may act on the cell but
        # not immediately hop again (prevents infinite station->station chaining).
        chained = bool(player.flags.get("no_station"))
        can_travel = not chained and bool(self._other_stations(engine, cell)) and player.money >= cost
        if can_travel:
            label = "Поехать бесплатно" if cost == 0 else f"Поехать на другой вокзал (проезд {cost}$)"
            options.append(DecisionOption("travel", label))
        options.append(DecisionOption("stay", "Остаться"))
        engine.request_decision(
            Decision(
                type=DecisionType.CHOOSE_OPTION,
                player_id=player.id,
                prompt=f"Вокзал «{cell.title}». Что делаем?",
                options=options,
                handler=cell.type,
                cell_id=cell.id,
                context={"kind": "menu", "cost": cost},
            )
        )

    def _offer_travel(self, engine: GameEngine, player: Player, cell: BoardCell, cost: int) -> None:
        affordable = player.money >= cost
        candidates = [
            MapCandidate(
                cell_id=st.id,
                affordable=affordable,
                cost=cost,
                note="«" + st.title + "»" + (" — ваш" if st.owner_id == player.id else ""),
            )
            for st in self._other_stations(engine, cell)
        ]
        confirm = "Поехать бесплатно" if cost == 0 else f"Поехать ({cost}$)"
        engine.request_decision(
            map_pick_decision(
                player,
                handler=cell.type,
                cell_id=cell.id,
                prompt="Вокзал: выберите станцию назначения.",
                candidates=candidates,
                action_kind="station_travel",
                confirm_label=confirm,
                cancel_label="Не ехать",
                extra_context={"cost": cost},
            )
        )

    def _do_travel(self, engine: GameEngine, player: Player, origin: BoardCell, dest_id: str, cost: int) -> None:
        dest = engine.state.board.by_id(dest_id)
        if cost > 0:
            owner = engine.state.player_by_id(origin.owner_id) if origin.owner_id else None
            if owner is not None and owner.id != player.id:
                engine.transfer_money(player, owner, cost, reason=f"проезд с вокзала «{origin.title}»")
            elif owner is None:
                engine.charge_money(player, cost, reason=f"проезд с вокзала «{origin.title}» (банк)")
            # origin owned by the traveller -> travel is free of charge
        engine.log_event("station", f"{player.name} едет на «{dest.title}».", player.id, cell_id=dest.id)
        # Travel drives FORWARD along the ring (play direction): passing Start pays
        # the crossing bonus. It is a move, not a teleport. The destination now
        # ACTIVATES so the player can interact with it (e.g. buy an unowned
        # station); the no_station flag blocks hopping again this turn.
        player.flags["no_station"] = True
        engine.walk_to_slot(player, dest.slot, activate=True)

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        kind = decision.context.get("kind")
        if kind == "menu":
            if option.id == "buy":
                do_buy(engine, player, cell)
            elif option.id == "travel":
                self._offer_travel(engine, player, cell, decision.context["cost"])
            # "stay" -> nothing happens
        elif kind == "travel" or decision.context.get("action_kind") == "station_travel":
            if option.id == CANCEL_OPTION_ID:
                return
            self._do_travel(engine, player, cell, option.data["cell_id"], decision.context["cost"])


# ---------------------------------------------------------------------------
# Investment objects (Monopoly-style rent): Food and Dormitory.
# ---------------------------------------------------------------------------
class RentCell(BaseCell):
    """Buyable object that charges rent to visitors (no upgrades, no role rules).

    Free -> the visitor may buy it. Owned by someone else -> pay rent to the owner
    (or nothing if it is your own). Rent is a per-ring value from ``rent.<type>``.
    """

    rent_key: str = ""

    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        if cell.owner_id is None:
            self._offer_buy(engine, player, cell)
            return
        if cell.owner_id == player.id:
            return
        owner = engine.state.player_by_id(cell.owner_id)
        rent = int(engine.balance.ring_value(self.rent_key, cell.ring))
        engine.transfer_money(player, owner, rent, reason=f"аренда «{cell.title}»")

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        if option.id == "buy":
            do_buy(engine, player, cell)

    def _offer_buy(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        rent = int(engine.balance.ring_value(self.rent_key, cell.ring))
        engine.request_decision(
            Decision(
                type=DecisionType.BUY_PROPERTY,
                player_id=player.id,
                prompt=f"«{cell.title}» свободна. Купить за {cell.price}$? (аренда {rent}$)",
                options=buy_options(cell),
                handler=cell.type,
                cell_id=cell.id,
                context={"kind": "buy"},
            )
        )


@register_cell("food")
class FoodCell(RentCell):
    """Еда: Кофейня (круг 1) → Забегаловка (2) → Ресторан (3)."""

    rent_key = "rent.food"


@register_cell("dormitory")
class DormitoryCell(RentCell):
    """Жильё: Хостел (круг 1) → Общежитие (2) → Отель (3)."""

    rent_key = "rent.dormitory"
