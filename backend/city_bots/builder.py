"""Claude Builder: the city-project seat, a rule book and nothing else.

Three ways to win were already at the table: Boris compounds money, Raider lives off the other
seats, and the Ledger family counts everything. Nobody played the fourth — the project board. A
project is unique, so taking it is denying it; it is paid in influence, the scarce currency; and its
condition is a shape of city, not a size of wallet.

The Builder plays that and only that, in a fixed order, the first rule that fits:

1. **Stay clean.** A scandal closes «Городская больница» and «Суд присяжных» and puts the seat at
   risk, so it is removed as soon as it costs a project or stands two short of the limit.
2. **Take a project** — always, the moment one is legal: the best one by points and by what its perk
   will still pay.
3. **Guard the seat** with a Защита — a rule that is switched off by default: measured, the
   purchase lost to the project its action and money would have paid for (see ``roof_round``).
4. **Take a seat.** The politician first: the veto holds a project for the Builder alone, the
   residents pay influence, and the role cleans its own scandals. Then the capitalist, whose mark
   counts towards a project condition without a slot. Then whatever is free — a seat is three points
   and the condition of «Городской устав».
5. **Mark** the market card that completes a condition (capitalist).
6. **Build towards the board.** An object is chosen by how much closer it brings the projects still
   in the game — the four on the board in full, the deck at a discount, because its order is not
   known — and by the influence it pays; income is the tie-break, not the goal.
7. **Make room**: a slot when the city is full.
8. **Raise influence** for the project that is ready but not paid for.
9. **Cash the piles** through the two sinks, keeping the price of the next project in hand.
10. **Draw cards**: the deals are played, everything aimed at a rival is discarded for influence.
11. **Re-deal a dead board**; work.

It never attacks: no grey operation, no hostile card, no power aimed at a rival. The veto is the one
thing it does to the table, and the veto is how a project race is played: as the politician it keeps
one standing at all times — on its own next project, or on the one the table is closest to.

Nothing here is read off another policy, and nothing is read off a deck: the project deck is used as
a *set* (which projects are still in the game is public), never as an order. The numbers that are a
judgement live in ``Tuning``; ``BUILDER_TUNING`` (JSON) replaces them for a measured run.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass, fields, replace
from typing import Any

from city_engine.constants import (
    CRISIS_PR_INFLUENCE,
    HAND_LIMIT,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
    PROJECT_REROLL_MONEY,
)
from city_engine.engine import CityEngine
from city_engine.models import GameState, OwnedAsset, PlayerState, Transition

BUILDER_ID = "builder"

Legal = list[tuple[dict[str, Any], Transition]]
Offered = dict[str, dict[str, Any]]

MONEY_RATE = PATRONAGE_POINTS / PATRONAGE_MONEY
INFLUENCE_RATE = LOBBYING_POINTS / LOBBYING_INFLUENCE

# The seats in the order the Builder wants them; the rest are a seat and nothing more.
SEATS = ("politician", "capitalist", "fraudster", "military", "mafia", "journalist")
# Cards that are simply played when they can be: each one is resources, room or defence.
PLAYED_KINDS = frozenset(
    {
        "grant",
        "district_cash",
        "influence",
        "government_influence",
        "popular_support",
        "shadow_cash",
        "extra_action",
        "capacity",
        "district_points",
        "bridge_loan",
    }
)


@dataclass(frozen=True, slots=True)
class Tuning:
    # What a project still in the deck counts for against one on the board.
    deck_weight: float = 0.25
    # What finishing a condition adds on top of the progress towards it.
    completion: float = 0.5
    # What a point of influence a round is worth when objects are compared, against the sink's rate.
    influence_weight: float = 1.5
    # What a dollar of income a round is worth when objects are compared. At 0.5 the Builder spent
    # twelve actions a game on «работа»; 1.0 measured four points better over 96 paired games.
    income_weight: float = 1.0
    # An object has to be worth this much to be bought at all.
    object_min: float = 2.0
    # Money kept back, on top of a project's own price, before the piles are cashed.
    cushion: int = 8
    # Influence left in hand after lobbying: the price of the next project.
    next_project: int = 4
    # The last rounds: nothing is kept back any more.
    endgame_rounds: int = 2
    # A board is dead when no project on it is nearer than this many objects.
    dead_board_gap: int = 2
    # The seat is guarded from this round on. Past the last round by default: buying a Защита cost
    # the Builder 4.6 points over 96 paired games — an action and the money for a project.
    roof_round: int = 99
    # Selling for a dearer object, late, has to gain this many points.
    upgrade_points: int = 3


def _load_tuning() -> Tuning:
    raw = os.environ.get("BUILDER_TUNING")
    if not raw:
        return Tuning()
    known = {item.name for item in fields(Tuning)}
    return replace(Tuning(), **{key: value for key, value in json.loads(raw).items() if key in known})


TUNING = _load_tuning()


def _key(action: dict[str, Any]) -> str:
    payload = action.get("payload") or {}
    detail = ":".join(f"{name}={payload[name]}" for name in sorted(payload))
    return f"{action['type']}:{detail}" if detail else str(action["type"])


class _Seat:
    """One decision: the board, the Builder's city, and the legal moves keyed for lookup."""

    def __init__(self, engine: CityEngine, state: GameState, me: PlayerState, legal: Legal) -> None:
        self.engine = engine
        self.state = state
        self.me = me
        self.tuning = TUNING
        self.offered: Offered = {_key(action): action for action, _ in legal}
        self.by_type: dict[str, list[dict[str, Any]]] = {}
        for action, _ in legal:
            self.by_type.setdefault(str(action["type"]), []).append(action)
        self.rounds_left = max(0, state.max_rounds - state.round_number)
        self.endgame = self.rounds_left < self.tuning.endgame_rounds
        self.rivals = [player for player in state.players if player.id != me.id]
        # The projects still in the game for this seat: the board in full, the deck as a set.
        self.open_board = [
            project_id for project_id in state.project_board if state.project_veto.get(project_id) in (None, me.id)
        ]

    def pick(self, action_type: str, /, **payload: Any) -> dict[str, Any] | None:
        return self.offered.get(_key({"type": action_type, "payload": payload}))

    # --- projects ---------------------------------------------------------------------------------

    def project_value(self, project_id: str) -> float:
        """Points now, plus what the perk still pays; a defence perk counts as a small flat bonus."""
        project = self.engine.project(project_id)
        perk = project.perk
        paid = MONEY_RATE * perk.get("passiveMoney", 0) + INFLUENCE_RATE * perk.get("passiveInfluence", 0)
        other = sum(1.5 for name in perk if name not in {"passiveMoney", "passiveInfluence"})
        return project.points + self.rounds_left * paid + other

    def gap(self, project_id: str) -> int:
        """How many steps the condition is away: objects, or a seat, or scandals to remove."""
        project = self.engine.project(project_id)
        standing = self.engine.project_requirement_standing(self.me, project)
        if standing["met"]:
            return 0
        if not standing["binary"]:
            return int(standing["needed"] - standing["have"])
        if project.requirement.get("type") == "max_scandals":
            return max(1, self.me.scandals - int(project.requirement.get("count", 1)))
        return 1

    def shortfall(self, project_id: str) -> tuple[int, int]:
        """Influence and money still missing for a project, whatever its condition says."""
        influence, money = self.engine.project_cost(self.me, self.engine.project(project_id))
        return max(0, influence - self.me.influence), max(0, money - self.me.money)

    def ready(self) -> list[str]:
        """Board projects whose condition is met, best first — paid for or not."""
        met = [project_id for project_id in self.open_board if self.gap(project_id) == 0]
        return sorted(met, key=lambda project_id: (-self.project_value(project_id), project_id))

    def reserve(self) -> tuple[int, int]:
        """What the best ready project costs: the influence and money the other rules leave alone."""
        ready = self.ready()
        if not ready or self.endgame:
            return 0, 0
        return self.engine.project_cost(self.me, self.engine.project(ready[0]))

    def potential(self, extra: str | None = None) -> float:
        """How far the city stands towards every project still in the game, in points."""
        engine, me, tuning = self.engine, self.me, self.tuning
        saved = me.assets
        if extra is not None:
            me.assets = [*saved, OwnedAsset(uid="probe", card_id=extra)]
        try:
            total = 0.0
            for weight, projects in ((1.0, self.open_board), (tuning.deck_weight, self.state.project_deck)):
                for project_id in projects:
                    project = engine.project(project_id)
                    standing = engine.project_requirement_standing(me, project)
                    if standing["binary"]:
                        continue
                    progress = min(1.0, standing["have"] / standing["needed"])
                    total += weight * project.points * (progress + (tuning.completion if standing["met"] else 0.0))
            return total
        finally:
            me.assets = saved

    def object_value(self, item: Any, standing: float) -> float:
        engine, state, me, tuning = self.engine, self.state, self.me, self.tuning
        pays = engine.purchase_yield(state, me, item.uid)
        value = self.potential(item.card_id) - standing
        value += self.rounds_left * (
            tuning.influence_weight * INFLUENCE_RATE * pays["influence"] + tuning.income_weight * MONEY_RATE * pays["money"]
        )
        return value + engine.asset_value_of(item.card_id)

    # --- the rules --------------------------------------------------------------------------------

    def clean(self) -> dict[str, Any] | None:
        me, engine = self.me, self.engine
        if me.scandals < 1:
            return None
        blocked = any(
            engine.project(project_id).requirement.get("type") == "max_scandals"
            and self.gap(project_id) == 1
            and self.shortfall(project_id) == (0, 0)
            for project_id in self.open_board
        )
        exposed = me.role is not None and me.scandals >= engine.scandal_limit(me) - 2
        if not (blocked or exposed or self.endgame):
            return None
        for held in me.hand:
            if engine.action_card(held.card_id).kind in {"clean", "deep_clean"}:
                found = self.pick("play_action_card", card_uid=held.uid)
                if found:
                    return found
        for power in ("mafia_cleanup", "fraudster_cleanup", "politician_cleanup"):
            found = self.pick("use_role_power", power=power)
            if found:
                return found
        # In the endgame a scandal is one point: the PR is worth it only when lobbying is out of reach.
        if self.endgame and not exposed and me.influence >= LOBBYING_INFLUENCE:
            return None
        return self.pick("crisis_pr") if me.influence >= CRISIS_PR_INFLUENCE else None

    def take_project(self) -> dict[str, Any] | None:
        engine, me = self.engine, self.me
        choices: list[tuple[float, str, dict[str, Any]]] = []
        for action in self.by_type.get("city_project", []):
            project_id = str(action["payload"]["project_id"])
            # The charter is worth one project a game: it goes on a big one, never on the first miss.
            if action["payload"].get("use_waiver") and engine.project(project_id).points < 8:
                continue
            choices.append((self.project_value(project_id), project_id, action))
        for held in me.hand:
            if engine.action_card(held.card_id).kind != "project":
                continue
            for project_id in self.open_board:
                found = self.pick("play_action_card", card_uid=held.uid, project_id=project_id)
                # The card pays the influence: it is spent where the influence is short, or on the best.
                if found and self.gap(project_id) == 0:
                    choices.append((self.project_value(project_id) + self.shortfall(project_id)[0], project_id, found))
        return max(choices, key=lambda item: (item[0], item[1]))[2] if choices else None

    def veto(self) -> dict[str, Any] | None:
        """A veto always stands. It holds the project the Builder is about to take; with none to hold,
        it closes the project the table wants most.

        The veto costs neither an action nor influence, so an empty one is a wasted power. It is
        re-aimed every turn: a project the Builder can take itself outranks any denial.
        """
        engine, state, me = self.engine, self.state, self.me
        if not any(action["payload"].get("power") == "politician_veto" for action in self.by_type.get("use_role_power", [])):
            return None

        def appetite(project_id: str) -> float:
            """How close the nearest rival is to this project: 1 — can take it now, 0 — nowhere near."""
            project = engine.project(project_id)
            influence, money = engine.project_cost(me, project)
            best = 0.0
            for rival in self.rivals:
                if engine.project_requirement_met(rival, project):
                    paid = rival.influence >= influence and rival.money >= money
                    best = max(best, 1.0 if paid else 0.7)
                else:
                    best = max(best, 0.4 * engine.project_requirement_progress(rival, project))
            return best

        # A project the Builder takes this turn needs no veto; one it is a step from does.
        waiting = [
            project_id
            for project_id in self.open_board
            if self.gap(project_id) <= 1 and self.pick("city_project", project_id=project_id) is None
        ]
        if waiting:
            target = max(waiting, key=lambda item: (appetite(item) > 0.5, self.project_value(item), item))
        else:
            others = [item for item in self.open_board if self.pick("city_project", project_id=item) is None]
            if not others:
                return None
            target = max(others, key=lambda item: (appetite(item) * self.project_value(item), item))
        if state.project_veto.get(target) == me.id:
            return None
        return self.pick("use_role_power", power="politician_veto", project_id=target)

    def cards(self) -> dict[str, Any] | None:
        """Play the deals; a card aimed at a rival is influence for the next project."""
        engine, me = self.engine, self.me
        for held in me.hand:
            card = engine.action_card(held.card_id)
            play = self.pick("play_action_card", card_uid=held.uid)
            if card.kind in PLAYED_KINDS and play:
                if card.kind == "bridge_loan" and not self.endgame and self.shortfall_money() == 0:
                    continue
                return play
            if card.kind == "roof" and play and me.roofs < engine.roof_limit(me):
                return play
            if card.kind == "buy_points" and play and me.money - card.value * 3 >= self.reserve()[1]:
                return play
            if card.kind == "free_object":
                best = self.best_object(privatized=held.uid)
                if best:
                    return best
            if card.targeted or card.kind == "grey_roll":
                return self.pick("convert_action_card", card_uid=held.uid, into="influence")
        if len(me.hand) >= HAND_LIMIT:
            # A full hand blocks the next draw: the oldest card that is not waiting for a project goes.
            spare = [held for held in me.hand if engine.action_card(held.card_id).kind not in {"project", "free_object"}]
            return self.pick("convert_action_card", card_uid=(spare or me.hand)[0].uid, into="influence")
        return None

    def shortfall_money(self) -> int:
        ready = self.ready()
        return self.shortfall(ready[0])[1] if ready else 0

    def roof(self) -> dict[str, Any] | None:
        me = self.me
        if me.role is None or me.roofs > 0 or self.state.round_number < self.tuning.roof_round:
            return None
        if me.money - self.engine.roof_price(self.state, me) < self.reserve()[1]:
            return None
        return self.pick("buy_roof")

    def seat(self) -> dict[str, Any] | None:
        me = self.me
        spare = me.influence - self.state.role_price - self.reserve()[0]
        if spare < 0:
            return None
        if me.role is not None:
            # Plan B was a seat, not the seat: when the politician's chair comes free and the next
            # project is still paid for, the Builder moves into it.
            free = self.engine.role_holder(self.state, "politician") is None
            if me.role == "politician" or not free or spare < self.tuning.next_project or self.endgame:
                return None
            return self.pick("claim_role", role_id="politician")
        for role in SEATS:
            found = self.pick("claim_role", role_id=role)
            # A free seat only: three times the price is three projects' worth of influence.
            if found and self.engine.role_holder(self.state, role) is None:
                return found
        return None

    def mark(self) -> dict[str, Any] | None:
        """The capitalist's mark on the card that completes a condition the Builder can pay for."""
        engine, me = self.engine, self.me
        if me.role != "capitalist":
            return None
        saved = me.marked_card_id
        best: tuple[float, str] | None = None
        try:
            for item in self.state.market:
                if self.pick("use_role_power", power="capitalist_claim", market_uid=item.uid) is None:
                    continue
                me.marked_card_id = None
                before = {project_id for project_id in self.open_board if self.gap(project_id) == 0}
                me.marked_card_id = item.card_id
                opened = [project_id for project_id in self.open_board if self.gap(project_id) == 0 and project_id not in before]
                for project_id in opened:
                    if self.shortfall(project_id) == (0, 0) and (best is None or (self.project_value(project_id), item.uid) > best):
                        best = (self.project_value(project_id), item.uid)
        finally:
            me.marked_card_id = saved
        if best is None or (saved and any(self.gap(project_id) == 0 for project_id in self.open_board)):
            return None
        return self.pick("use_role_power", power="capitalist_claim", market_uid=best[1])

    def best_object(self, privatized: str | None = None) -> dict[str, Any] | None:
        engine, state, me = self.engine, self.state, self.me
        if len(me.assets) >= me.capacity:
            return None
        _, kept = self.reserve()
        standing = self.potential()
        best: tuple[float, str, dict[str, Any]] | None = None
        for item in state.market:
            if privatized:
                action = self.pick("play_action_card", card_uid=privatized, market_uid=item.uid)
                price = engine.privatization_price(item.card_id)
            else:
                action = self.pick("buy_asset", market_uid=item.uid)
                price = engine.asset_price(state, me, item.card_id)
            if action is None:
                continue
            value = self.object_value(item, standing)
            # A ready project is not traded for an object — unless the object is what makes it ready.
            if me.money - price < kept and self.potential(item.card_id) - standing < 1 and not self.endgame:
                continue
            if value >= self.tuning.object_min and (best is None or (value, item.uid) > best[:2]):
                best = (value, item.uid, action)
        return best[2] if best else None

    def room(self) -> dict[str, Any] | None:
        me = self.me
        if len(me.assets) < me.capacity or self.rounds_left < 2:
            return None
        return self.pick("buy_capacity")

    def upgrade(self) -> dict[str, Any] | None:
        """Late, with the city full: the cheapest object makes way for a dearer one."""
        engine, state, me = self.engine, self.state, self.me
        if not self.endgame or state.actions_left < 1 or len(me.assets) < me.capacity or not me.assets:
            return None
        cheapest = min(me.assets, key=lambda owned: (engine.asset_value(owned), owned.uid))
        refund = engine.asset_refund(cheapest)
        for item in state.market:
            affordable = engine.asset_price(state, me, item.card_id) <= me.money + refund
            gain = engine.asset_value_of(item.card_id) - engine.asset_value(cheapest)
            if affordable and gain >= self.tuning.upgrade_points and not engine.market_locked_for(state, item, me):
                return self.pick("sell_asset", asset_uid=cheapest.uid)
        return None

    def influence(self) -> dict[str, Any] | None:
        """A campaign when a ready project — or the seat — is short of influence."""
        me = self.me
        ready = self.ready()
        short = self.shortfall(ready[0])[0] if ready else 0
        if not short and me.role is None and me.influence < self.state.role_price:
            short = self.state.role_price - me.influence
        if not short:
            return None
        return self.pick("basic_action", kind="campaign", spend=5)

    def draw(self) -> dict[str, Any] | None:
        influence, money = self.reserve()
        if self.me.influence - 1 < influence or self.me.money - 4 < money:
            return None
        return self.pick("buy_action_card")

    def redeal(self) -> dict[str, Any] | None:
        if not self.open_board or self.rounds_left < 2:
            return None
        if min(self.gap(project_id) for project_id in self.open_board) < self.tuning.dead_board_gap:
            return None
        if self.me.money < PROJECT_REROLL_MONEY + self.tuning.cushion:
            return None
        return self.pick("reroll_projects")

    def sinks(self) -> dict[str, Any] | None:
        me = self.me
        influence, money = self.reserve()
        cushion = 0 if self.endgame else self.tuning.cushion
        if me.influence - LOBBYING_INFLUENCE >= (influence if self.endgame else max(influence, self.tuning.next_project)):
            found = self.pick("basic_action", kind="lobbying")
            if found:
                return found
        if me.money - PATRONAGE_MONEY >= money + cushion:
            found = self.pick("basic_action", kind="patronage")
            if found:
                return found
        return None

    def work(self) -> dict[str, Any] | None:
        if not self.rounds_left:
            return None
        if self.me.money - 5 >= self.tuning.cushion and self.me.influence < LOBBYING_INFLUENCE:
            return self.pick("basic_action", kind="campaign", spend=5) or self.pick("basic_action", kind="work")
        return self.pick("basic_action", kind="work")


RULES: tuple[tuple[str, Callable[[_Seat], dict[str, Any] | None]], ...] = (
    ("veto", _Seat.veto),
    ("cards", _Seat.cards),
    ("clean", _Seat.clean),
    ("project", _Seat.take_project),
    ("roof", _Seat.roof),
    ("seat", _Seat.seat),
    ("mark", _Seat.mark),
    ("upgrade", _Seat.upgrade),
    ("object", _Seat.best_object),
    ("room", _Seat.room),
    ("influence", _Seat.influence),
    ("sinks", _Seat.sinks),
    ("draw", _Seat.draw),
    ("redeal", _Seat.redeal),
    ("work", _Seat.work),
)


def choose_builder_command(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: Legal | None = None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]]]:
    legal = engine.legal_transitions(state, player_id) if legal is None else legal
    seat = _Seat(engine, state, state.player_by_id(player_id), legal)
    for order, (name, rule) in enumerate(RULES):
        choice = rule(seat)
        if choice is not None:
            return choice, float(len(RULES) - order), [(name, float(len(RULES) - order))]
    return seat.offered["end_turn"], 0.0, [("end_turn", 0.0)]
