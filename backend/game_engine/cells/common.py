"""Shared helpers used by several cell behaviours (buying, target selection)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from game_engine.enums import DecisionType
from game_engine.models import Decision, DecisionOption

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, GameState, Player


def buy_options(cell: BoardCell, skip_label: str = "Пропустить") -> list[DecisionOption]:
    """Standard two-option buy prompt for a free buyable cell."""
    return [
        DecisionOption("buy", f"Купить «{cell.title}» за {cell.price}$", {"cell_id": cell.id}),
        DecisionOption("skip", skip_label),
    ]


def upgrade_cost(engine: GameEngine, cell: BoardCell) -> int:
    multiplier = float(engine.balance.get("upgrades.cost_multiplier", 1.0))
    return max(1, int(round(cell.price * multiplier)))


def upgraded_value(engine: GameEngine, cell: BoardCell) -> int:
    return cell.price + (upgrade_cost(engine, cell) if cell.state.get("upgraded") else 0)


def do_buy(engine: GameEngine, player: Player, cell: BoardCell) -> bool:
    """Purchase ``cell`` from the bank. Returns ``True`` on success."""
    if cell.owner_id is not None:
        return False
    price = cell.price
    discount = float(player.flags.pop("next_purchase_discount", 0) or 0)
    if discount > 0:
        price = max(1, int(round(price * (1 - discount))))
    if player.money < price:
        engine.log_event(
            "buy_failed",
            f"{player.name} не может купить «{cell.title}» (нужно {price}$).",
            player.id,
        )
        return False
    engine.charge_money(player, price, reason=f"покупка «{cell.title}»")
    cell.owner_id = player.id
    player.bump("properties_bought")
    engine.log_event(
        "property_bought",
        f"{player.name} покупает «{cell.title}» за {price}$.",
        player.id,
        cell_id=cell.id,
    )
    if player.flags.get("family_business") and cell.type in {"food", "dormitory"}:
        engine.grant_experience(player, 1, reason="Семейный бизнес")
    return True


def do_upgrade(engine: GameEngine, player: Player, cell: BoardCell, *, free: bool = False) -> bool:
    if not cell.buyable or cell.owner_id != player.id or cell.state.get("upgraded"):
        return False
    cost = upgrade_cost(engine, cell)
    if not free and not engine.charge_money(player, cost, reason=f"улучшение «{cell.title}»"):
        return False
    cell.state["upgraded"] = True
    cell.state["upgrade_cost"] = cost
    player.bump("properties_upgraded")
    label = "бесплатно" if free else f"за {cost}$"
    engine.log_event("property_upgraded", f"{player.name} улучшает «{cell.title}» {label}.", player.id, cell_id=cell.id)
    return True


def other_players(state: GameState, player: Player) -> list[Player]:
    return [p for p in state.players if p.id != player.id]


def player_options(players: list[Player]) -> list[DecisionOption]:
    return [DecisionOption(p.id, p.name, {"player_id": p.id}) for p in players]


def roll_decision(
    player: Player,
    handler: str,
    cell_id: str | None,
    prompt: str,
    context: dict[str, Any],
    *,
    roll_label: str = "🎲 Бросить кубик",
    skip_label: str | None = None,
    roll_hint: str = "",
    skip_hint: str = "",
) -> Decision:
    """Build a decision whose main option triggers a *separate* interaction roll.

    Interactions that need a die (Bank risk, Casino gamble, '?' card, move-N …) do
    NOT auto-roll: they raise this decision so the player rolls deliberately. Add a
    ``skip_label`` to make the whole interaction optional (opt-in).
    """
    options = [DecisionOption("roll", roll_label, rolls_dice=True, hint=roll_hint)]
    if skip_label:
        options.append(DecisionOption("skip", skip_label, hint=skip_hint))
    return Decision(
        type=DecisionType.CHOOSE_OPTION,
        player_id=player.id,
        prompt=prompt,
        options=options,
        handler=handler,
        cell_id=cell_id,
        context=context,
    )


# ---------------------------------------------------------------------------
# Map-pick: the shared "choose a cell on the board, then confirm/cancel" flow.
# Used by Taxi (travel anywhere), Station (travel to another station) and Auction
# (buy a free object). The UI highlights the candidate cells, shows details of the
# one the player clicks and enables a confirm button only for affordable targets.
# ---------------------------------------------------------------------------
CANCEL_OPTION_ID = "cancel"


@dataclass
class MapCandidate:
    """One selectable cell on the map, with the cost/affordability shown in the UI."""

    cell_id: str
    affordable: bool = True
    cost: int = 0
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "cell_id": self.cell_id,
            "affordable": self.affordable,
            "cost": self.cost,
            "note": self.note,
        }


def map_pick_decision(
    player: Player,
    handler: str,
    cell_id: str | None,
    prompt: str,
    candidates: list[MapCandidate],
    *,
    action_kind: str,
    confirm_label: str,
    cancel_label: str,
    extra_context: dict[str, Any] | None = None,
) -> Decision:
    """Build a ``CHOOSE_CELL_ON_MAP`` decision.

    ``options`` contains only *affordable* candidates plus a cancel option, so
    bots (which pick a random ``option_id``) can never select an unaffordable
    target and never get stuck in a loop. The full candidate list (including
    unaffordable, greyed-out ones) is carried in ``context.candidates`` purely for
    the human UI to render highlights and details.
    """
    options: list[DecisionOption] = [
        DecisionOption(c.cell_id, c.note or c.cell_id, {"cell_id": c.cell_id})
        for c in candidates
        if c.affordable
    ]
    options.append(DecisionOption(CANCEL_OPTION_ID, cancel_label))
    context: dict[str, Any] = {
        "action_kind": action_kind,
        "confirm_label": confirm_label,
        "cancel_label": cancel_label,
        "candidates": {c.cell_id: c.to_dict() for c in candidates},
    }
    if extra_context:
        context.update(extra_context)
    return Decision(
        type=DecisionType.CHOOSE_CELL_ON_MAP,
        player_id=player.id,
        prompt=prompt,
        options=options,
        handler=handler,
        cell_id=cell_id,
        context=context,
    )

