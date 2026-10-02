"""Claude Atlas: Ledger's turn search, valued by a forecast of every player's final score.

Ledger plans the whole turn well and values the result badly. Its position value is a liquidation —
"what the wallet can still be turned into" — whose sinks are the printed ones: lobbying, patronage, a
slot at half an object's price. Three things the tester's games kept beating are missing from it:

* **Projects are the best sink in the game and Ledger barely sees them.** Only the four on the board
  count, at a third of their worth, and only while the condition is half met. A human taking a project
  a turn scored 54 points from projects against Oracle's 35; Ledger converted influence to lobbying at
  0.6 a ◆ instead of to projects at ~1.5.
* **A slot is an income stream, not half a price.** Oracle ended five of the tester's eight games on
  four slots, once on three; the nightly forks price a slot at +5.8 points against the table.
* **The target is the richest wallet, not the player about to win.** Equity counts unspent money, so a
  rival who turns everything into points at once looks harmless while a hoarder looks like the leader.

Atlas keeps the search and replaces the valuation with a forecast. For every player the rest of the
game is played out in a cheap model of the economy: a round's income at every settlement, each turn's
actions spent greedily on what the rules allow — a project when the influence and money are there, an
object into a free slot while it still has rounds to pay, a slot to put it in, patronage and lobbying
once a turn, a campaign when influence is short, work when nothing else is left. The forecast is the
score the player ends on. The bot maximises its own forecast against the forecast leader's, so
attacking is worth exactly what it takes off the player who is going to win.

Two consequences come for free: the actions left in the current turn are part of the forecast, so
ending a turn early loses what those actions would have earned; and every rival — a human too — is
forecast by the same model, not by the weakest bot.

The model sees only what a player sees: the board, the market prices, its own hand. The decks are not
read; projects dealt later are an expectation per turn, and the search itself never buys a card or a
project that was dealt while it was planning (Ledger's ``_allowed``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from city_bots.ledger import (
    AVERAGE_OBJECT_PRICE,
    Valuation,
    _Root,
    _seat_value,
    _turns_ahead,
    choose_ledger_command,
)
from city_engine.constants import (
    CAMPAIGN_TIERS,
    CAPACITY_COSTS,
    CAPACITY_INFLUENCE,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MAX_CAPACITY,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
)
from city_engine.engine import CityEngine
from city_engine.models import GameState, PlayerState, Transition

ATLAS_ID = "atlas"

_CAMPAIGN_SPEND, _CAMPAIGN_GAIN = next(iter(CAMPAIGN_TIERS.items()))


@dataclass(frozen=True, slots=True)
class AtlasParams:
    """The forecast's assumptions — the numbers a nightly tune adjusts. Defaults from the catalog."""

    # A new object's round income once it stands, synergy included (printed ≈2.3$, with a quarter's
    # synergy ≈3.5$), and the influence it adds a round.
    object_yield: float = 3.0
    # Late objects are bought for their points and effects: a legendary prints 1.1$ against an
    # uncommon's 2.1$, and a quarter is full by then. From this round on a new object pays less.
    late_round: int = 8
    late_object_yield: float = 1.8
    object_influence: float = 0.3
    # The projects a player can expect to take a turn beyond the ones on the board now: four on the
    # board, one rotating out a round, and three rivals after the same ones.
    project_share: float = 0.45
    # A project on the board now is still there at the player's next turn with this chance: three
    # rivals move in between and the board rotates one project a round. Without it the forecast
    # was indifferent between taking a project now and taking it later — and so never took it.
    ready_survives: float = 0.45
    # An average project from the catalog: 6.5 points for 3.6◆ and 5.9$, plus a perk worth ≈0.7$ a round.
    project_points: float = 6.5
    project_influence: float = 3.6
    project_money: float = 5.9
    project_perk: float = 0.7
    # A held card is worth this share of what Reborn's table says it is worth.
    card_share: float = 0.5
    # Rivals in the utility: the forecast leader weighs most, the field a little. Day sweep 2026-10-02
    # (24 games, 2 Atlas vs 2 Ledger): 0.55 / 0.2 → −1.1 against the table, 0.3 / 0.1 → +1.5,
    # 0 / 0 → +1.6. Attacks cost Atlas more than they took off the leader; a light weight keeps it
    # answering a runaway leader without turning every turn into a fight.
    leader_weight: float = 0.3
    field_weight: float = 0.1
    # The chance a turn's planned purchase finds a card worth buying: the market holds six, rotates
    # three a round and three rivals buy from it.
    market_hit: float = 0.6
    # Search size, as Ledger's.
    budget: float = 0.3
    widths: tuple[int, int] = (6, 3)


PARAMS = AtlasParams()


def choose_atlas_command(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: list[tuple[dict[str, Any], Transition]] | None = None,
    *,
    params: AtlasParams | None = None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]]]:
    params = PARAMS if params is None else params
    # What the next object would really pay each player, read off the market the bot sees now and
    # kept for the whole search: the search itself never buys a card dealt while it plans.
    market = {player.id: market_outlook(engine, state, player, params) for player in state.players}
    valuation = Valuation(
        utility=lambda engine_, state_, root_: utility(engine_, state_, root_, params, market),
        # The forecast spends the turn's remaining actions itself: booking them again would make an
        # early end of turn look as good as playing them.
        unspent_action=0.0,
        allows=_allows,
    )
    return choose_ledger_command(
        engine,
        state,
        player_id,
        legal,
        budget=params.budget,
        widths=params.widths,
        valuation=valuation,
    )


def _allows(state: GameState, action: dict[str, Any]) -> bool:
    """A sale only when an action is left to buy the replacement this turn.

    A sale costs no action, so the search offered it at the end of every turn, and the forecast — which
    fills an empty slot from the market a turn later — liked it: Atlas sold its standing objects with
    no action left sixteen times in two games. A slot emptied at the end of a turn earns nothing until
    the next one, and by then the card the forecast had in mind may be gone.
    """
    return action["type"] != "sell_asset" or state.actions_left >= 1


# --- valuation -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MarketOutlook:
    """The object a player's next purchase is modelled as: its price and its round income."""

    price: float
    money: float
    influence: float


def market_outlook(engine: CityEngine, state: GameState, player: PlayerState, params: AtlasParams) -> MarketOutlook:
    """The average of the best few purchases on the market for this player, by their own share.

    A flat «an object pays 3.5$» made every real object that paid less look like a slot to empty:
    Atlas sold and rebought eleven times a game, and once sold its whole city in round 13.
    """
    options = []
    for item in state.market:
        if engine.market_locked_for(state, item, player):
            continue
        share = engine.purchase_yield(state, player, item.uid)
        options.append(
            (share["money"] + share["influence"] * 1.5, float(engine.asset_price(state, player, item.card_id)), share)
        )
    if not options:
        price = _object_price(state.round_number)
        late = state.round_number >= params.late_round
        return MarketOutlook(price, params.late_object_yield if late else params.object_yield, params.object_influence)
    # Every card the player could take, not the best few: the best are the ones rivals take first.
    best = options
    return MarketOutlook(
        price=sum(option[1] for option in best) / len(best),
        money=sum(option[2]["money"] for option in best) / len(best),
        influence=sum(option[2]["influence"] for option in best) / len(best),
    )


def utility(
    engine: CityEngine,
    state: GameState,
    root: _Root,
    params: AtlasParams = PARAMS,
    market: dict[str, MarketOutlook] | None = None,
) -> float:
    market = market or {}
    forecasts = {player.id: forecast(engine, state, player, params, market.get(player.id)) for player in state.players}
    mine = forecasts.pop(root.player_id)
    if not forecasts:
        return mine
    rivals = sorted(forecasts.values(), reverse=True)
    return mine - params.leader_weight * rivals[0] - params.field_weight * sum(rivals) / len(rivals)


def forecast(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    params: AtlasParams = PARAMS,
    outlook: MarketOutlook | None = None,
) -> float:
    """The score this player ends the game on, if the rest of it goes the way the model plays it."""
    score = float(engine.score(player))
    if state.status != "playing":
        return score
    economy = _Economy.start(engine, state, player, params, outlook)
    economy.play_out()
    value = score + economy.points
    turns = _turns_ahead(state, player)
    # The seat, its hazard and the defence a token buys: Ledger's terms, which the model leaves out.
    value += _seat_value(engine, state, player, turns)
    if turns > 0 or _is_current(state, player):
        from city_bots.policy import _card_value  # the card table; imported late to avoid a cycle

        value += params.card_share * sum(_card_value(engine, held.card_id, player) for held in player.hand)
    return value


def _is_current(state: GameState, player: PlayerState) -> bool:
    return state.status == "playing" and state.current_player.id == player.id


@dataclass(slots=True)
class _Economy:
    """One player's resources and the turns they still play, in a model cheap enough to run per node."""

    params: AtlasParams
    money: float
    influence: float
    money_rate: float
    influence_rate: float
    debt: float
    capacity: int
    free_slots: int
    per_turn: int
    # (round, actions) for every turn still to play, the one in progress first.
    turns: list[tuple[int, int]]
    round_number: int
    max_rounds: int
    # Projects on the board this player could take right now: (points, influence, money).
    ready_projects: list[tuple[float, float, float]]
    # The next object as the market offers it now; ``None`` falls back to the catalog averages.
    outlook: MarketOutlook | None = None
    # Income that pays the next settlement only (a mark, a zoning).
    temporary_money: float = 0.0
    temporary_influence: float = 0.0
    # Once-a-turn sinks already pressed in the turn in progress.
    used_now: frozenset[str] = frozenset()
    points: float = 0.0

    @classmethod
    def start(
        cls,
        engine: CityEngine,
        state: GameState,
        player: PlayerState,
        params: AtlasParams,
        outlook: MarketOutlook | None = None,
    ) -> _Economy:
        money_rate, influence_rate = engine._round_rates(state, player)
        # A capitalist's mark and a zoning both lapse within the round: the engine's rates count them,
        # the forecast pays them once. Booked as permanent, a mark was worth 39 points to the search.
        temporary_money = temporary_influence = 0.0
        if player.marked_card_id or player.zoning_district:
            saved_mark, saved_zoning = player.marked_card_id, player.zoning_district
            try:
                player.marked_card_id, player.zoning_district = None, None
                lasting_money, lasting_influence = engine._round_rates(state, player)
            finally:
                player.marked_card_id, player.zoning_district = saved_mark, saved_zoning
            temporary_money = money_rate - lasting_money
            temporary_influence = influence_rate - lasting_influence
            money_rate, influence_rate = lasting_money, lasting_influence
        per_turn = (4 if player.role == "fraudster" else 3) + min(1, engine.effect_total(player, "extraActions"))
        current = _is_current(state, player)
        turns: list[tuple[int, int]] = []
        if current:
            turns.append((state.round_number, state.actions_left))
        order = state.turn_order or [other.id for other in state.players]
        position = order.index(player.id) if player.id in order else 0
        if position > state.turns_taken_in_round and not current:
            turns.append((state.round_number, per_turn))
        turns.extend((round_number, per_turn) for round_number in range(state.round_number + 1, state.max_rounds + 1))
        # An arrest shortens the next turn the player starts, not the one in progress.
        upcoming = 1 if current else 0
        if player.jail_turns > 0 and len(turns) > upcoming:
            turns[upcoming] = (turns[upcoming][0], 1)
        ready = []
        for project_id in state.project_board:
            project = engine.project(project_id)
            if engine.project_requirement_met(player, project):
                cost_influence, cost_money = engine.project_cost(player, project)
                ready.append((float(project.points), float(cost_influence), float(cost_money)))
        ready.sort(key=lambda item: -item[0])
        return cls(
            params=params,
            money=float(player.money),
            influence=float(player.influence),
            money_rate=float(money_rate),
            influence_rate=float(influence_rate),
            debt=float(player.debt),
            capacity=player.capacity,
            free_slots=max(0, player.capacity - len(player.assets)),
            per_turn=per_turn,
            turns=turns,
            round_number=state.round_number,
            max_rounds=state.max_rounds,
            ready_projects=ready,
            outlook=outlook,
            temporary_money=float(temporary_money),
            temporary_influence=float(temporary_influence),
            used_now=(
                frozenset(key for key in ("lobbying", "patronage") if state.turn_flags.get(f"used:{key}"))
                if current
                else frozenset()
            ),
        )

    def play_out(self) -> None:
        current_round = self.round_number
        first = True
        for round_number, actions in self.turns:
            # Every settlement between this turn and the last one pays a round's income.
            while current_round < round_number:
                self.money += self.money_rate + self.temporary_money - self.debt
                self.influence += self.influence_rate + self.temporary_influence
                self.debt = 0.0
                self.temporary_money = self.temporary_influence = 0.0
                current_round += 1
            self._turn(round_number, actions, first)
            first = False

    def _turn(self, round_number: int, actions: int, first: bool) -> None:
        params = self.params
        payouts_after = max(0, self.max_rounds - round_number)
        bought = False
        lobbied = first and "lobbying" in self.used_now
        patroned = first and "patronage" in self.used_now
        project_room = 0.0 if first else params.project_share
        while actions > 0:
            # 1. A project on the board now — only in the turn in progress and the next one, after that
            #    the board has rotated. Then the expected share of projects dealt later.
            if self.ready_projects and (first or round_number <= self.round_number + 1):
                points, influence, money = self.ready_projects[0]
                if self.influence >= influence and self.money >= money:
                    self.ready_projects.pop(0)
                    # Now it is certain; at the next turn only if nobody took it meanwhile.
                    chance = 1.0 if first else params.ready_survives
                    self._take_project(points * chance, influence * chance, money * chance, payouts_after, chance)
                    actions -= 1
                    continue
            if project_room > 0 and self._can_afford(params.project_influence, params.project_money):
                share = min(project_room, self._affordable_share())
                if share > 0.05:
                    self._take_project(
                        params.project_points * share,
                        params.project_influence * share,
                        params.project_money * share,
                        payouts_after,
                        share,
                    )
                    project_room -= share
                    actions -= 1
                    continue
            price, object_money, object_influence = self._next_object(round_number)
            # 2. An object into a free slot while it still has settlements to pay, or for its points in
            #    the endgame — half its price beats patronage's quarter. One a turn: the market holds
            #    six cards and three rivals buy from it too.
            if self.free_slots > 0 and self.money >= price and not first and not bought:
                hit = params.market_hit
                self.money -= price * hit
                self.points += price / 2 * hit
                self.money_rate += object_money * hit
                self.influence_rate += object_influence * hit
                self.free_slots -= 1
                bought = True
                actions -= 1
                continue
            # 3. A slot for the next object, while enough settlements remain to pay for both.
            if (
                not first
                and self.free_slots == 0
                and self.capacity < MAX_CAPACITY
                and payouts_after >= 3
                and actions >= 2
                and self.money >= CAPACITY_COSTS[self.capacity] + price
                and self.influence >= CAPACITY_INFLUENCE[self.capacity]
            ):
                self.money -= CAPACITY_COSTS[self.capacity]
                self.influence -= CAPACITY_INFLUENCE[self.capacity]
                self.capacity += 1
                self.free_slots += 1
                actions -= 1
                continue
            # 4. Lobbying, keeping the influence the next project will want.
            reserve = params.project_influence if payouts_after > 0 else 0.0
            if not lobbied and self.influence >= LOBBYING_INFLUENCE + reserve:
                self.influence -= LOBBYING_INFLUENCE
                self.points += LOBBYING_POINTS
                lobbied = True
                actions -= 1
                continue
            # 5. Patronage, keeping the money the next purchase will want.
            keep = price if (self.free_slots > 0 and payouts_after > 0) else 0.0
            if not patroned and self.money >= PATRONAGE_MONEY + keep:
                self.money -= PATRONAGE_MONEY
                self.points += PATRONAGE_POINTS
                patroned = True
                actions -= 1
                continue
            # 6. A campaign while influence is the thing missing and something still takes it.
            wants = params.project_influence + (0 if lobbied else LOBBYING_INFLUENCE)
            if self.influence < wants and self.money >= _CAMPAIGN_SPEND + keep and round_number < self.max_rounds:
                self.money -= _CAMPAIGN_SPEND
                self.influence += _CAMPAIGN_GAIN
                actions -= 1
                continue
            # 7. Work: two dollars that may still buy something.
            self.money += 2
            actions -= 1

    def _next_object(self, round_number: int) -> tuple[float, float, float]:
        params = self.params
        if self.outlook is not None:
            # The market a few rounds on is dearer and pays less per dollar; the outlook ages with it.
            age = max(0, round_number - self.round_number - 1)
            return (
                self.outlook.price + age * 1.0,
                max(1.0, self.outlook.money - age * 0.2),
                self.outlook.influence,
            )
        late = round_number >= params.late_round
        return (
            _object_price(round_number),
            params.late_object_yield if late else params.object_yield,
            params.object_influence,
        )

    def _can_afford(self, influence: float, money: float) -> bool:
        return self.influence >= influence * 0.5 and self.money >= money * 0.5

    def _affordable_share(self) -> float:
        params = self.params
        return min(1.0, self.influence / params.project_influence, self.money / params.project_money)

    def _take_project(
        self, points: float, influence: float, money: float, payouts_after: int, share: float = 1.0
    ) -> None:
        self.influence -= influence
        self.money -= money
        self.points += points
        self.money_rate += self.params.project_perk * share
        del payouts_after


def _object_price(round_number: int) -> float:
    price = AVERAGE_OBJECT_PRICE[0][1]
    for opens, average in AVERAGE_OBJECT_PRICE:
        if round_number >= opens:
            price = average
    return price


__all__ = ["ATLAS_ID", "AtlasParams", "PARAMS", "choose_atlas_command", "forecast", "utility"]
