"""BorisTheTraxer: the tester's strategy, played as a rule book rather than a search.

The plan, as the tester wrote it, corrected where the rules make a literal reading a bad move:

1. **Income first, whatever it costs.** Every early purchase is the object that adds the most to the
   round's payout, and a full portfolio buys the next slot as soon as it can be afforded.
2. **A role that fits the cards.** A seat is taken when it pays off on the objects already owned. At
   four objects the bot settles on the free seat with the best synergy on the table and builds its
   quarter to four objects, filling the last two slots with the strongest bonus or income for that
   build. With no clear synergy it takes the fraudster for the fourth action.
3. **Cash in the surplus.** Once a round pays more than the next round needs, an action card is
   bought every turn and played for everything it gives, a Крыша guards a role that is paying, and
   spare money goes to patronage — spare influence to lobbying, since patronage takes only money.
4. **No table-building.** A project is taken only when its condition happens to be met already.
   Grey operations are never run and nobody is attacked: the bot plays its own development.

Ordered rules, each one skipped when it is plainly bad in the position (a slot nobody can fill, a
card nothing can be done with), and every number read from the engine rather than restated: what a
purchase adds to the round (``purchase_preview``), what a role would add on this board, what a card
actually does.
"""

from __future__ import annotations

from typing import Any

from city_engine.constants import (
    ACTION_CARD_COST,
    CAPACITY_COSTS,
    CAPACITY_INFLUENCE,
    LOBBYING_INFLUENCE,
    MAX_CAPACITY,
    PATRONAGE_MONEY,
)
from city_engine.engine import CityEngine
from city_engine.models import GameState, OwnedAsset, PlayerState, Transition

BORIS_ID = "boris"

# Influence buys roles, projects and lobbying, and is earned slower than money: the bot counts one
# ◆ as this many $ when it compares what a purchase adds to a round.
INFLUENCE_IN_MONEY = 2.5
# The quarter the build is aimed at, and the size that switches its depth bonus on.
DISTRICT_TARGET = 4
SLOTS_BEFORE_ROLE_CHOICE = 4
# A seat whose synergy on the current board adds less than this to a round is no synergy at all;
# below it the fraudster's fourth action is worth more.
CLEAR_SYNERGY = 3.0
# Leave a role only for a seat that pays this much more a round.
ROLE_SWITCH_MARGIN = 3.0
# Replace an owned object only when the trade is worth this much, in $.
SWAP_MARGIN = 4.0
# What a pick into the target quarter is worth beyond its own payout, while the quarter is short.
DISTRICT_FIT = 2.0
# One point in money: what patronage charges for it.
POINT_IN_MONEY = PATRONAGE_MONEY / 5
# The slot a sale was made for, so the purchase that follows it is the one the sale was priced on.
_PENDING: dict[tuple[str, str], tuple[int, str]] = {}
# Scandals that put a role in danger: one more and any hostile card can take it.
SCANDAL_MARGIN = 2

Legal = list[tuple[dict[str, Any], Transition]]


def choose_boris_command(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: Legal | None = None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]]]:
    legal = engine.legal_transitions(state, player_id) if legal is None else legal
    player = state.player_by_id(player_id)
    offered = {_key(action): (action, transition) for action, transition in legal}
    reasons: list[tuple[str, float]] = []

    for rule in RULES:
        choice = rule(engine, state, player, offered)
        if choice is not None:
            action, why = choice
            reasons.append((f"{rule.__name__}: {why}", 1.0))
            return action, 1.0, reasons
    end = offered.get(("end_turn",))
    if end is not None:
        return end[0], 0.0, [("end_turn", 0.0)]
    return legal[0][0], 0.0, []


# --- the rules, in priority order -------------------------------------------------------------


def _endgame(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """The last round pays nothing, so income stops mattering: every $ goes where it scores most.

    An object scores half its price, twice what patronage pays for the same money, so free slots are
    filled with the dearest object first; then patronage and lobbying take the rest.
    """
    if state.round_number < state.max_rounds:
        return None
    buys = [
        (engine.asset_value_of(_market_card(state, action)), action) for action, _ in _of_type(offered, "buy_asset")
    ]
    if buys:
        points, action = max(buys, key=lambda item: item[0])
        if points > 0:
            return action, f"last round, an object for {points} points"
    # Full slots: trade the cheapest object for the dearest. This rule used to answer with lobbying and
    # patronage before the swap rule was ever asked, and Boris ended the game on 53$ (test of
    # 2026-10-03) that a swap turns into half their worth in points.
    swap = _swap(engine, state, player, offered)
    if swap:
        return swap
    for kind in ("lobbying", "patronage"):
        found = offered.get(("basic_action", kind))
        if found:
            return found[0], f"last round, {kind}"
    project = _ready_project(engine, state, player, offered, last_round=True)
    if project:
        return project
    return None


def _keep_the_role(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """A seat near its limit is a seat any card can take: guard it, then clean it.

    A Крыша comes first: it costs money, which a working engine has to spare, and it stops the next
    hit outright. Cleaning costs influence and an action, so it is done once a turn — twice a turn
    against a journalist publishing every round cost two actions and 6◆ to answer one action and 3◆,
    and the lobbying the influence was for never happened. A second clean is spent only when the
    seat is one scandal from the limit.
    """
    if player.role is None:
        return None
    room = engine.scandal_limit(player) - player.scandals
    if room > SCANDAL_MARGIN:
        return None
    roof = offered.get(("buy_roof",))
    if roof and player.roofs == 0:
        return roof[0], "guarding a seat near its scandal limit"
    if room > 1 and _cleaned_this_turn(state, player):
        return None
    for key in (
        ("use_role_power", "fraudster_cleanup"),
        ("use_role_power", "politician_cleanup"),
        ("use_role_power", "mafia_cleanup"),
        ("crisis_pr",),
    ):
        found = offered.get(key)
        if found:
            return found[0], "cleaning the scandals that endanger the role"
    return None


def _free_gains(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """A capitalist's claim on the best card on sale, when the scandal it costs is affordable.

    The claim charges a scandal, and a seat near its limit then spends an action and 3◆ cleaning it:
    claimed every turn, the pair ate whole turns and all the influence lobbying needed.
    """
    claims = _of_type(offered, "use_role_power", power="capitalist_claim")
    if claims and state.actions_left > 0 and player.scandals == 0:
        best = max(claims, key=lambda item: _purchase_gain(engine, state, player, item[0]["payload"]["market_uid"]))
        gain = _purchase_gain(engine, state, player, best[0]["payload"]["market_uid"])
        already = any(item.claimed_by == player.id for item in state.market)
        if gain >= 5 and not already:
            return best[0], f"claiming a card that pays {gain:.1f} a round"
    return None


def _role(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """Take the seat that fits the objects; at four objects settle on the best one, or the fraudster."""
    claims = {action["payload"]["role_id"]: action for action, _ in _of_type(offered, "claim_role")}
    if not claims:
        return None
    synergy = {role: _role_synergy(engine, state, player, role) for role in claims}
    current = _role_synergy(engine, state, player, player.role) if player.role else 0.0
    best_role = max(synergy, key=lambda role: synergy[role])
    settled = len(player.assets) >= SLOTS_BEFORE_ROLE_CHOICE
    if player.role is None:
        if synergy[best_role] >= CLEAR_SYNERGY:
            return claims[best_role], f"{best_role} pays {synergy[best_role]:.1f} more a round"
        if settled and "fraudster" in claims:
            return claims["fraudster"], "no clear synergy: the fraudster for the fourth action"
        return None
    # Leaving a seat costs its price and its tempo, so only for a clearly better one.
    if settled and best_role != player.role and synergy[best_role] - current >= ROLE_SWITCH_MARGIN:
        return claims[best_role], f"{best_role} pays {synergy[best_role] - current:.1f} more than {player.role}"
    return None


def _guard_the_role(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """A Крыша over a role that is paying, once the engine can afford it."""
    found = offered.get(("buy_roof",))
    if not found or player.role is None or player.roofs > 0:
        return None
    if len(player.assets) < SLOTS_BEFORE_ROLE_CHOICE or not _surplus(engine, state, player):
        return None
    return found[0], f"guarding the {player.role} seat"


def _build(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """Fill a free slot with the object that adds the most to the round, aimed at the target quarter."""
    buys = _of_type(offered, "buy_asset")
    if not buys:
        return None
    pending = _PENDING.pop((state.game_id, player.id), None)
    if pending and pending[0] == state.revision:
        planned = offered.get(("buy_asset", f"market_uid={pending[1]}"))
        if planned:
            return planned[0], "the object the last sale made room for"
    district = _target_district(engine, state, player)
    scored = []
    for action, _ in buys:
        uid = action["payload"]["market_uid"]
        card = engine.asset(_market_card(state, action))
        value = _purchase_gain(engine, state, player, uid)
        if district and card.district == district and engine.district_count(player, district) < DISTRICT_TARGET:
            value += DISTRICT_FIT
        scored.append((value, -engine.asset_price(state, player, card.id), action))
    value, _price, action = max(scored, key=lambda item: (item[0], item[1]))
    if value <= 0:
        return None
    return action, f"an object adding {value:.1f} to the round"


def _privatize(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """«Приватизация» before an ordinary purchase: the same object at half price and without an action.

    The general card rule comes after the build, and the build fills every free slot first, so the
    card never found a slot to land in: Boris played it in 0.9% of the chances against 93–99% for
    the other bots. Valued like a purchase, aimed at the same quarter.
    """
    district = _target_district(engine, state, player)
    scored = []
    for action, _ in _of_type(offered, "play_action_card"):
        uid = action["payload"].get("market_uid")
        held = next((card for card in player.hand if card.uid == action["payload"]["card_uid"]), None)
        if uid is None or held is None or engine.action_card(held.card_id).kind != "free_object":
            continue
        card = engine.asset(next(item.card_id for item in state.market if item.uid == uid))
        value = _purchase_gain(engine, state, player, uid)
        if district and card.district == district and engine.district_count(player, district) < DISTRICT_TARGET:
            value += DISTRICT_FIT
        scored.append((value, card.cost, action))
    if not scored:
        return None
    value, _cost, action = max(scored, key=lambda item: (item[0], item[1]))
    if value <= 0:
        return None
    return action, f"privatising an object adding {value:.1f} to the round"


def _expand(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """A full portfolio buys the next slot as soon as there is something worth putting in it."""
    found = offered.get(("buy_capacity",))
    if not found or len(player.assets) < player.capacity or player.capacity >= MAX_CAPACITY:
        return None
    left = player.money - CAPACITY_COSTS.get(player.capacity, 0)
    # A slot nobody can fill this round is money parked for nothing; it waits for the next one.
    affordable = [item for item in state.market if engine.asset_price(state, player, item.card_id) <= left]
    if state.actions_left < 2 or not affordable:
        return None
    return found[0], f"slot {player.capacity + 1}"


def _swap(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """At six slots, the weakest object makes room for a clearly better one (selling costs no action).

    Better means the whole trade: the income it adds over the settlements still to come, the points
    (an object scores half its price) and the money it costs net of the refund. Money is cheap when
    it is piling up and almost free in the last round, where nothing else can spend it — that is when
    trading a cheap object for an expensive one is the best sink left.
    """
    if len(player.assets) < player.capacity or state.actions_left < 1:
        return None
    # Before the last round a swap waits for the sixth slot — a free slot is the cheaper way to grow.
    # In the last round there is no growing left, only the money to turn into points.
    if player.capacity < MAX_CAPACITY and state.round_number < state.max_rounds:
        return None
    if _sold_this_turn(state, player):
        return None
    payouts = max(0, state.max_rounds - state.round_number)
    if state.round_number >= state.max_rounds:
        money_cost = 0.2
    elif player.money > _money_reserve(engine, state, player) + 2 * PATRONAGE_MONEY:
        money_cost = 0.5
    else:
        money_cost = 1.0
    best: tuple[float, OwnedAsset, str] | None = None
    for owned in player.assets:
        refund = engine.asset_refund(owned)
        for item in state.market:
            if engine.market_locked_for(state, item, player):
                continue
            price = engine.asset_price(state, player, item.card_id)
            if price > player.money + refund:
                continue
            income = _swap_gain(engine, state, player, owned, item.card_id)
            points = engine.asset_value_of(item.card_id) - engine.asset_value(owned)
            worth = income * payouts * 0.5 + points * POINT_IN_MONEY - (price - refund) * money_cost
            if worth >= SWAP_MARGIN and (best is None or worth > best[0]):
                best = (worth, owned, item.uid)
    if best is None:
        return None
    found = offered.get(("sell_asset", best[1].uid))
    if not found:
        return None
    # The purchase is the next decision; remember which slot the sale was for.
    if len(_PENDING) > 1024:
        _PENDING.clear()
    _PENDING[(state.game_id, player.id)] = (state.revision + 1, best[2])
    return found[0], f"selling {best[1].card_id} to make room (worth {best[0]:.1f})"


def _ready_project(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    offered,
    *,
    last_round: bool = False,
) -> tuple[dict, str] | None:
    """A project only when the build happens to meet its condition already, and it is worth its price."""
    best = None
    for action, _ in _of_type(offered, "city_project"):
        if action["payload"].get("use_waiver"):
            continue
        project = engine.project(action["payload"]["project_id"])
        if not engine.project_requirement_met(player, project):
            continue
        influence, money = engine.project_cost(player, project)
        # Patronage and lobbying are the floor: a project paying less than they would is not taken.
        floor = money * 5 / PATRONAGE_MONEY + influence * 6 / LOBBYING_INFLUENCE
        margin = project.points - (0 if last_round else floor)
        if margin > 0 and (best is None or margin > best[0]):
            best = (margin, action, project.id)
    if best is None:
        return None
    return best[1], f"{best[2]} is already met"


def _project_influence_gap(engine: CityEngine, state: GameState, player: PlayerState) -> int:
    """◆ still missing for the cheapest board project whose condition is met and that pays its price."""
    best: int | None = None
    for project_id in state.project_board:
        if state.project_veto.get(project_id) not in (None, player.id):
            continue
        project = engine.project(project_id)
        if not engine.project_requirement_met(player, project):
            continue
        influence, money = engine.project_cost(player, project)
        if project.points <= money * 5 / PATRONAGE_MONEY + influence * 6 / LOBBYING_INFLUENCE:
            continue
        gap = max(0, influence - player.influence)
        best = gap if best is None else min(best, gap)
    return best or 0


def _project(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    return _ready_project(engine, state, player, offered)


def _cards(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """Play what the hand holds for everything it gives; buy a card a turn once income covers the plan.

    A card is played on the bot itself or on nobody — one aimed at a rival is cashed in instead, and
    so is any card whose best play is worth less than its discard. A held card that can do nothing
    only blocks the next purchase.
    """
    best_play: dict[str, tuple[float, dict[str, Any]]] = {}
    for action, transition in _of_type(offered, "play_action_card"):
        target = action["payload"].get("target_id")
        if target is not None and target != player.id:
            continue
        uid = action["payload"]["card_uid"]
        gain = _self_gain(engine, state, player, transition.state)
        if uid not in best_play or gain > best_play[uid][0]:
            best_play[uid] = (gain, action)
    playable = [item for item in best_play.values() if item[0] > _discard_value()]
    if playable:
        gain, action = max(playable, key=lambda item: item[0])
        return action, f"playing a card worth {gain:.1f}"
    # A card with no good play yet is kept — the lawyers wait for a scandal — until the hand is full
    # and blocks the next purchase, or the game is about to end with it unplayed.
    if len(player.hand) < 3 and state.round_number < state.max_rounds:
        held_back = True
    else:
        held_back = False
    into = "influence" if player.role is None and player.influence < state.role_price else "money"
    for held in [] if held_back else player.hand:
        found = offered.get(("convert_action_card", f"card_uid={held.uid}", f"into={into}"))
        if found:
            return found[0], f"cashing in {held.card_id}"
    found = offered.get(("buy_action_card",))
    if found and _surplus(engine, state, player) and len(player.assets) >= SLOTS_BEFORE_ROLE_CHOICE:
        return found[0], "income covers the next round: a card a turn"
    return None


def _convert(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """Spare money to patronage, spare influence to lobbying — what the build will not need."""
    lobbying = offered.get(("basic_action", "lobbying"))
    if lobbying and player.influence - LOBBYING_INFLUENCE >= _influence_reserve(engine, state, player):
        return lobbying[0], "spare influence to lobbying"
    patronage = offered.get(("basic_action", "patronage"))
    if patronage and player.money - PATRONAGE_MONEY >= _money_reserve(engine, state, player):
        return patronage[0], "spare money to patronage"
    return None


def _fill(engine: CityEngine, state: GameState, player: PlayerState, offered) -> tuple[dict, str] | None:
    """An action left over is never wasted: influence when a seat is still to be bought, else money."""
    if state.actions_left < 1 or state.round_number >= state.max_rounds:
        return None
    found = offered.get(("basic_action", "campaign"))
    campaign = found[0] if found else None
    reserve = _money_reserve(engine, state, player)
    # The seat and the next slot both need influence the engine does not earn by itself: without it
    # the fifth slot was the last one, and the swaps that build the quarter never opened.
    needs_influence = player.influence < _influence_reserve(engine, state, player)
    if campaign and needs_influence and player.money - 5 >= reserve / 2:
        return campaign, "influence for the seat or the next slot"
    # Patronage takes 20$ once a turn and a working engine out-earns that, so the money above the
    # build's reserve becomes influence for the next lobbying — 3◆ an action against the 2$ of work.
    # Only as much as lobbying can take: influence past that sits as idly as the money did.
    wants_lobbying = player.influence < _influence_reserve(engine, state, player) + LOBBYING_INFLUENCE
    if campaign and wants_lobbying and player.money - 5 >= reserve:
        return campaign, "surplus money into influence for lobbying"
    # A project whose condition the build already meets, short only of influence: the surplus money
    # buys the missing ◆. Without this the cap above stopped the campaigns at the lobbying reserve,
    # and Boris ended games on 80-100$ with two projects while the board held met ones.
    if campaign and _project_influence_gap(engine, state, player) > 0 and player.money - 5 >= reserve:
        return campaign, "surplus money into influence for a met project"
    work = offered.get(("basic_action", "work"))
    if work:
        return work[0], "work"
    return None


RULES = (
    _endgame,
    _keep_the_role,
    _role,
    _swap,
    _privatize,
    _build,
    _expand,
    _convert,
    _project,
    _guard_the_role,
    _cards,
    _free_gains,
    _fill,
)


# --- what the rules read ---------------------------------------------------------------------


def _rates(engine: CityEngine, state: GameState, player: PlayerState) -> float:
    money, influence = engine._round_rates(state, player)
    return money + influence * INFLUENCE_IN_MONEY


def _purchase_gain(engine: CityEngine, state: GameState, player: PlayerState, market_uid: str) -> float:
    """What buying this slot adds to the round, valued with the seat the bot is aiming for."""
    role = _aimed_role(engine, state, player)
    saved = player.role
    try:
        player.role = role
        preview = engine.purchase_preview(state, player, market_uid)
    finally:
        player.role = saved
    return preview["money"] + preview["influence"] * INFLUENCE_IN_MONEY


def _swap_gain(engine: CityEngine, state: GameState, player: PlayerState, owned: OwnedAsset, card_id: str) -> float:
    before = _rates(engine, state, player)
    saved = player.assets
    try:
        player.assets = [asset for asset in saved if asset.uid != owned.uid] + [OwnedAsset("swap:new", card_id)]
        after = _rates(engine, state, player)
    finally:
        player.assets = saved
    return after - before


def _role_synergy(engine: CityEngine, state: GameState, player: PlayerState, role: str | None) -> float:
    """What holding this seat adds to the round on the bot's own board, against holding none."""
    saved = player.role
    try:
        player.role = None
        bare = _rates(engine, state, player)
        player.role = role
        seated = _rates(engine, state, player)
    finally:
        player.role = saved
    return seated - bare


def _aimed_role(engine: CityEngine, state: GameState, player: PlayerState) -> str | None:
    """The seat the build is for: the one held, or the best one the bot could take."""
    if player.role:
        return player.role
    free = [role for role in engine.ROLE_POWERS if engine.role_holder(state, role) is None]
    if not free:
        return None
    best = max(free, key=lambda role: _role_synergy(engine, state, player, role))
    return best if _role_synergy(engine, state, player, best) >= CLEAR_SYNERGY else None


def _target_district(engine: CityEngine, state: GameState, player: PlayerState) -> str | None:
    """The quarter to build to four: the role's own, else the one the portfolio already leans to."""
    role = _aimed_role(engine, state, player)
    district = engine.ROLE_DISTRICTS.get(role) if role else None
    if district:
        return district
    counts: dict[str, int] = {}
    for owned in player.assets:
        name = engine.owned_definition(owned).district
        counts[name] = counts.get(name, 0) + 1
    return max(counts, key=lambda name: counts[name]) if counts else None


def _surplus(engine: CityEngine, state: GameState, player: PlayerState) -> bool:
    """Does next round's income already cover what the build still has to buy?"""
    money_rate, _influence_rate = engine._round_rates(state, player)
    return player.money + money_rate >= _money_reserve(engine, state, player) + ACTION_CARD_COST


def _money_reserve(engine: CityEngine, state: GameState, player: PlayerState) -> float:
    """Money the build still needs: the next slot, and an object to put in it."""
    if state.round_number >= state.max_rounds:
        return 0.0
    reserve = 0.0
    if player.capacity < MAX_CAPACITY:
        reserve += CAPACITY_COSTS.get(player.capacity, 0)
    if len(player.assets) < MAX_CAPACITY or player.capacity < MAX_CAPACITY:
        prices = sorted(engine.asset_price(state, player, item.card_id) for item in state.market)
        reserve += prices[len(prices) // 2] if prices else 0
    return reserve


def _influence_reserve(engine: CityEngine, state: GameState, player: PlayerState) -> float:
    """Influence the plan still needs: the seat it has not bought yet, and the next slot's influence."""
    if state.round_number >= state.max_rounds:
        return 0.0
    slot = CAPACITY_INFLUENCE.get(player.capacity, 0) if player.capacity < MAX_CAPACITY else 0
    return float(slot + (0 if player.role is not None else state.role_price))


def _self_gain(engine: CityEngine, state: GameState, player: PlayerState, after: GameState) -> float:
    """What an action did for the bot alone, in $: resources, score, income and actions."""
    mine = after.player_by_id(player.id)
    payouts = max(0, state.max_rounds - state.round_number)
    gain = (mine.money - player.money) + (mine.influence - player.influence) * INFLUENCE_IN_MONEY
    gain += (engine.score(mine) - engine.score(player)) * 4
    gain += (_rates(engine, after, mine) - _rates(engine, state, player)) * payouts * 0.5
    if after.current_player.id == player.id:
        gain += (after.actions_left - state.actions_left + 1) * 3
    gain += (mine.roofs - player.roofs) * 4
    return gain


def _sold_this_turn(state: GameState, player: PlayerState) -> bool:
    """One swap a turn: churning the portfolio burns the actions the surplus should be cashed with."""
    for event in reversed(state.event_log):
        if event.type == "turn_started":
            return False
        if event.type == "asset_sold" and event.actor_id == player.id:
            return True
    return False


def _cleaned_this_turn(state: GameState, player: PlayerState) -> bool:
    for event in reversed(state.event_log):
        if event.type == "turn_started":
            return False
        if event.actor_id != player.id:
            continue
        if event.type == "crisis_pr" or (
            event.type == "role_power_used" and str(event.data.get("power", "")).endswith("_cleanup")
        ):
            return True
    return False


def _discard_value() -> float:
    """A discard pays 2$ (or 2◆): a play has to beat the money, the cheaper of the two."""
    return 2.0


def _of_type(offered, kind: str, **payload: Any) -> list[tuple[dict[str, Any], Transition]]:
    return [
        item
        for item in offered.values()
        if item[0]["type"] == kind and all(item[0]["payload"].get(key) == value for key, value in payload.items())
    ]


def _market_card(state: GameState, action: dict[str, Any]) -> str:
    uid = action["payload"]["market_uid"]
    return next(item.card_id for item in state.market if item.uid == uid)


def _key(action: dict[str, Any]) -> tuple[Any, ...]:
    payload = action.get("payload") or {}
    kind = action["type"]
    if kind == "basic_action":
        return (kind, payload.get("kind"))
    if kind == "use_role_power":
        return (kind, payload.get("power"), *sorted(f"{k}={v}" for k, v in payload.items() if k != "power"))
    if kind == "sell_asset":
        return (kind, payload.get("asset_uid"))
    if payload:
        return (kind, *sorted(f"{k}={v}" for k, v in payload.items()))
    return (kind,)


__all__ = ["BORIS_ID", "choose_boris_command"]
