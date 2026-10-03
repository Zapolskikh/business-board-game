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

Rebuilt on the two nightly runs of 2026-10-02/03 (``docs/balance-reports/``), with no number tuned by
hand where the rules can give it:

* **The averages come from the catalog.** The project the forecast expects to take, the perk it pays
  and the price of the next object by round are read off ``catalog.json`` when the module loads, so a
  balance patch moves the bot with it instead of leaving it to play the old game.
* **A card is worth what it does in this position.** «Приватизация» is the best object on the market at
  half price without an action, «Общественная инициатива» the best project the player can take now;
  the rest keep Reborn's table at half. A card the bot has not seen — a rival's hand, or the two drawn
  by a purchase inside the search — is worth the deck's average for that player, never its face: the
  old forecast valued the drawn cards themselves, which is looking at the deck.
* **A seat is worth what its power can take now.** The racket and the sanction are priced off the
  engine's own preview against the best target on the table, not a flat value per role. The nights
  measured claiming the mafia, the fraudster and the capitalist at −5 to −7 points against an ordinary
  move: a flat value could not tell an empty racket from a full one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from city_bots.ledger import (
    LOBBY_RATE,
    PATRONAGE_RATE,
    UNSPENT_ACTION,
    Valuation,
    _Root,
    _threat,
    _turns_ahead,
    choose_ledger_command,
)
from city_engine.constants import (
    BASE_SCANDAL_LIMIT,
    CAMPAIGN_TIERS,
    CAPACITY_COSTS,
    CAPACITY_INFLUENCE,
    CARD_DISCARD_INFLUENCE,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MAX_CAPACITY,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
)
from city_engine.content import load_catalog
from city_engine.engine import CityEngine
from city_engine.models import GameState, PlayerState, Transition

ATLAS_ID = "atlas"

_CAMPAIGN_SPEND, _CAMPAIGN_GAIN = next(iter(CAMPAIGN_TIERS.items()))

# --- what the catalog says -------------------------------------------------------------------------
# Read once, when the module loads. Influence is booked at 1.5$ wherever money and influence are added
# up, the rate the market outlook has always used.
_INFLUENCE_IN_MONEY = 1.5


def _catalog_projects() -> tuple[float, float, float, float]:
    """The average project of the deck: points, influence, money and the perk it pays a round."""
    catalog = load_catalog()
    projects = [catalog.projects[project_id] for project_id in catalog.deck_project_ids()] or list(
        catalog.projects.values()
    )
    count = len(projects)
    perk = sum(
        float(project.perk.get("passiveMoney", 0))
        + _INFLUENCE_IN_MONEY * float(project.perk.get("passiveInfluence", 0))
        for project in projects
    )
    return (
        sum(project.points for project in projects) / count,
        sum(project.cost_influence for project in projects) / count,
        sum(project.cost_money for project in projects) / count,
        perk / count,
    )


def _catalog_price_curve() -> tuple[tuple[int, float], ...]:
    """The price of a typical new object by the round its rarity opens: the newest rarity's average."""
    catalog = load_catalog()
    curve = []
    for rarity, opens in sorted(catalog.rarity_min_round.items(), key=lambda item: item[1]):
        prices = [asset.cost for asset in catalog.assets.values() if asset.rarity == rarity]
        if prices:
            curve.append((opens, sum(prices) / len(prices)))
    return tuple(curve)


_PROJECT_POINTS, _PROJECT_INFLUENCE, _PROJECT_MONEY, _PROJECT_PERK = _catalog_projects()
PRICE_CURVE = _catalog_price_curve()
# A card discarded for influence: the floor under every card, seen or not.
_DISCARD_POINTS = CARD_DISCARD_INFLUENCE * LOBBY_RATE
# What a seat's power is worth beyond the turns it can be counted on: as in Ledger, a seat changes
# hands, and booking fifteen turns of a racket made it look like a pension.
_SEAT_HORIZON = 5
# Powers that cannot be priced off a preview: the turn value Ledger books for them.
_FLAT_POWER = {"journalist": 0.3, "politician": 0.25, "capitalist": 0.25, "fraudster": 0.2}


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
    # board, one rotating out a round, and three rivals after the same ones. 0.45 promised more than
    # any bot took: in the 2026-10-03 test (96 games) the table averaged 5.4 projects a game — 0.36 a
    # turn, the board's own included — and Atlas, hoarding influence for the rest, lobbied a third as
    # often as Ledger, took fewer project points than either searching bot and ended on 5◆ unspent.
    project_share: float = 0.3
    # A project on the board now is still there at the player's next turn with this chance: three
    # rivals move in between and the board rotates one project a round. Without it the forecast
    # was indifferent between taking a project now and taking it later — and so never took it.
    ready_survives: float = 0.45
    # The average project of the deck, read off the catalog (``_catalog_projects``).
    project_points: float = _PROJECT_POINTS
    project_influence: float = _PROJECT_INFLUENCE
    project_money: float = _PROJECT_MONEY
    project_perk: float = _PROJECT_PERK
    # A card with no position-specific value is worth this share of what Reborn's table says.
    card_share: float = 0.5
    # A card kept is worth this share of what it does now above its discard: the project it would take
    # rotates off the board, the object off the market. At full value the search was indifferent between
    # playing and keeping, and kept: «Общественная инициатива» played in 22% of its chances against
    # 86–96% for the other bots.
    hold_share: float = 0.6
    # How often a seat's power finds its use on a turn: a target without a Защита, a turn not spent on
    # something better.
    power_use: float = 0.6
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
    sight = Sight(
        player_id=player_id,
        hand=frozenset(held.uid for held in state.player_by_id(player_id).hand),
        deck_value={player.id: deck_value(engine, state, player, params) for player in state.players},
    )
    valuation = Valuation(
        utility=lambda engine_, state_, root_: utility(engine_, state_, root_, params, market, sight),
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
class Sight:
    """What the deciding player has seen: its own hand at the root, and each player's deck average.

    Everything else in a hand — a rival's cards, the two a purchase draws inside the search — is a card
    the player has not seen, and is worth the average of the deck for whoever holds it.
    """

    player_id: str
    hand: frozenset[str]
    deck_value: dict[str, float]


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
    sight: Sight | None = None,
) -> float:
    market = market or {}
    forecasts = {
        player.id: forecast(engine, state, player, params, market.get(player.id), sight) for player in state.players
    }
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
    sight: Sight | None = None,
) -> float:
    """The score this player ends the game on, if the rest of it goes the way the model plays it."""
    score = float(engine.score(player))
    if state.status != "playing":
        return score
    economy = _Economy.start(engine, state, player, params, outlook)
    economy.play_out()
    value = score + economy.points
    turns = _turns_ahead(state, player)
    # The seat, its hazard and the defence a token buys — terms the economy model leaves out.
    value += seat_value(engine, state, player, turns, params)
    if turns > 0 or _is_current(state, player):
        value += hand_value(engine, state, player, params, sight)
    return value


# --- cards -----------------------------------------------------------------------------------------


def card_points(engine: CityEngine, state: GameState, player: PlayerState, card_id: str, params: AtlasParams) -> float:
    """What playing this card is worth to this player now, in points; never less than its discard.

    The two cards a balance patch keeps moving are priced from what they buy here. The rest keep
    Reborn's table at ``card_share``, which is what the forecast always used for them.
    """
    card = engine.action_card(card_id)
    if card.kind == "free_object":
        # An object at a discount and without an action: what it saves against an ordinary purchase.
        saving = 0.0
        for item in state.market:
            if engine.market_locked_for(state, item, player):
                continue
            price = engine.asset_price(state, player, item.card_id)
            charged = engine.privatization_price(item.card_id)
            if charged <= player.money + 5:
                saving = max(saving, (price - charged) * PATRONAGE_RATE + UNSPENT_ACTION)
        if len(player.assets) >= player.capacity:
            # A slot has to be bought first; at six there is none to buy.
            saving *= 0.0 if player.capacity >= MAX_CAPACITY else 0.4
        return max(_DISCARD_POINTS, saving)
    if card.kind == "project":
        # A project without its influence and a few dollars off: the best one the player can take.
        best = 0.0
        for project_id in state.project_board:
            project = engine.project(project_id)
            cost_influence, cost_money = engine.project_cost(player, project)
            saving = (
                cost_influence * LOBBY_RATE + (cost_money - engine.initiative_money(project, card)) * PATRONAGE_RATE
            )
            gain = project.points - engine.initiative_money(project, card) * PATRONAGE_RATE + UNSPENT_ACTION
            met = engine.project_requirement_met(player, project)
            # Booked against the project bought the ordinary way, not against nothing: the forecast
            # already counts the projects the economy would take.
            best = max(best, min(saving + UNSPENT_ACTION, gain) * (1.0 if met else 0.3))
        return max(_DISCARD_POINTS, best)
    from city_bots.policy import _card_value  # the card table; imported late to avoid a cycle

    return max(_DISCARD_POINTS, params.card_share * _card_value(engine, card_id, player))


def deck_value(engine: CityEngine, state: GameState, player: PlayerState, params: AtlasParams) -> float:
    """The average card of the deck for this player, copies counted — the worth of a card not yet seen."""
    total = count = 0.0
    for card in engine.catalog.action_cards.values():
        total += card.copies * card_points(engine, state, player, card.id, params)
        count += card.copies
    return total / count if count else _DISCARD_POINTS


def hand_value(
    engine: CityEngine, state: GameState, player: PlayerState, params: AtlasParams, sight: Sight | None
) -> float:
    """The cards in a hand: the decider's own seen cards at their worth, everything else at the deck's."""
    if sight is None:
        return sum(
            _DISCARD_POINTS
            + params.hold_share * (card_points(engine, state, player, held.card_id, params) - _DISCARD_POINTS)
            for held in player.hand
        )
    unseen = sight.deck_value.get(player.id, _DISCARD_POINTS)
    value = 0.0
    for held in player.hand:
        if player.id == sight.player_id and held.uid in sight.hand:
            worth = card_points(engine, state, player, held.card_id, params)
        else:
            worth = unseen
        value += _DISCARD_POINTS + params.hold_share * (worth - _DISCARD_POINTS)
    return value


# --- the seat --------------------------------------------------------------------------------------


def power_value(engine: CityEngine, state: GameState, player: PlayerState, params: AtlasParams) -> float:
    """What the seat's active power takes a turn, in points, against the best target on the table now."""
    role = player.role
    rivals = [other for other in state.players if other.id != player.id]
    best = 0.0
    if role in {"mafia", "military"}:
        power = "mafia_racket" if role == "mafia" else "military_sanction"
        for target in rivals:
            if role == "military" and target.scandals < 2:
                continue
            preview = engine.power_preview(state, player, power, target)
            if preview.get("blocked_by_roof"):
                continue
            gain = preview.get("money", 0) * PATRONAGE_RATE + preview.get("influence", 0) * LOBBY_RATE
            gain -= preview.get("self_scandals", 0)
            if preview.get("strips_role"):
                gain += 3.0
            best = max(best, gain)
        return best * params.power_use
    return _FLAT_POWER.get(role or "", 0.0)


def seat_value(engine: CityEngine, state: GameState, player: PlayerState, turns: int, params: AtlasParams) -> float:
    """The role's power over the next few turns, the risk of losing it, and the defence a token buys."""
    value = 0.0
    limit = engine.scandal_limit(player)
    if player.role:
        held = power_value(engine, state, player, params) * min(turns, _SEAT_HORIZON)
        # One step short of the limit, any rival's scandal costs the seat and its +3.
        room = limit - player.scandals
        hazard = 0.45 if room <= 1 else 0.15 if room == 2 else 0.0
        value += held - hazard * (held + 3)
    elif player.scandals >= BASE_SCANDAL_LIMIT:
        value -= 1.0  # cannot even buy a seat until the counter drops
    threat = _threat(engine, state, player)
    if player.roofs and turns + 1 > 0:
        covered = min(player.roofs, 2)
        value += threat * (2.2 if covered >= 1 else 0) + threat * (0.8 if covered >= 2 else 0)
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
    price = PRICE_CURVE[0][1]
    for opens, average in PRICE_CURVE:
        if round_number >= opens:
            price = average
    return price


__all__ = [
    "ATLAS_ID",
    "AtlasParams",
    "PARAMS",
    "card_points",
    "choose_atlas_command",
    "deck_value",
    "forecast",
    "seat_value",
    "utility",
]
