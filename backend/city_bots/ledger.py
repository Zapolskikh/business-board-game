"""Claude Ledger: a bot that plans the whole turn and books every resource at what it can still buy.

Written from the rules rather than from Reborn, and on purpose with a different shape:

* **One valuation, no per-action rules.** A position is worth its score plus what the wallet can
  still be turned into before the game ends (``_liquidation``). Nothing scores by itself: a dollar is
  worth the best sink that is still open for it — a free slot, the once-a-turn patronage, a campaign
  that feeds the once-a-turn lobbying — and nothing at all once the last turn is gone. Income is
  booked the same way, multiplied by the settlements that are still to come. An action is chosen
  because the position after it is worth more, never because of a bonus attached to its type.
* **The turn is the unit of planning.** A small beam search chains ``legal_transitions`` through
  the actions left this turn, so «sell, buy the better object, lobby» is found as one plan instead
  of three greedy steps that each look worse on their own.
* **The table, not the scoresheet.** The objective is the bot's own equity against the rivals',
  weighted towards the leader: taking 6$ from the player in front is worth more than earning 6$.
* **No peeking.** Transitions carry the real RNG and the real deck order, which a player does not
  see. A grey operation is valued as the expectation of a forced hit and a forced miss at the
  printed odds; a blind card draw ends the plan and is valued without looking at the cards; market
  and project refills revealed inside the search are never bought; re-deals are not played at all.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from city_engine.commands import Command
from city_engine.constants import (
    BASE_SCANDAL_LIMIT,
    CAMPAIGN_TIERS,
    FRAUDSTER_GREY_BONUS,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MAX_CAPACITY,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
)
from city_engine.engine import CityEngine
from city_engine.models import GameState, PlayerState, Transition

LEDGER_ID = "ledger"

# --- the conversion table -------------------------------------------------------------------------
# Points per unit through each sink, straight from the rules. Ordered best first: the liquidation
# fills them greedily, which is what makes the value of a pile concave — the hundredth dollar is
# worth less than the first because the good sinks are already full.
LOBBY_RATE = LOBBYING_POINTS / LOBBYING_INFLUENCE  # 0.6 a ◆
PATRONAGE_RATE = PATRONAGE_POINTS / PATRONAGE_MONEY  # 0.25 a $
_CAMPAIGN_SPEND, _CAMPAIGN_GAIN = next(iter(CAMPAIGN_TIERS.items()))
CAMPAIGN_RATE = _CAMPAIGN_GAIN / _CAMPAIGN_SPEND * LOBBY_RATE  # 0.36 a $, through lobbying
# An object scores half its price, and a slot is where most money goes. A bit under 0.5: the market
# does not always hold what fits, and the price also buys income that is booked separately.
SLOT_RATE = 0.42
# What is left once every sink is full still buys something — a project, a card, a token — just not
# at a printed rate.
SPARE_MONEY_RATE = 0.06
SPARE_INFLUENCE_RATE = 0.15

# A typical object price by the round its rarity opens; the slot sink absorbs this much per slot.
AVERAGE_OBJECT_PRICE = ((1, 5.0), (2, 7.5), (4, 9.5), (6, 12.5), (8, 16.0))

# An action not yet spent at the edge of the plan. Roughly a work action at mid-game prices; it only
# has to keep a deeper plan from looking worse than a shallow one that simply has not spent yet.
UNSPENT_ACTION = 0.7

# What holding a seat is worth per turn still to play, on top of the +3 the scoresheet already
# counts and the income the role adds to the rates. Counted over a few turns only: a seat changes
# hands, and booking fifteen turns of it made two ledgers trade one role back and forth all game.
ROLE_TURN_VALUE = {
    "fraudster": 0.5,
    "mafia": 0.35,
    "military": 0.3,
    "journalist": 0.3,
    "politician": 0.25,
    "capitalist": 0.25,
}
ROLE_HORIZON = 5
# Rivals counted against the bot: the leader weighs more than the field.
LEADER_WEIGHT = 0.45
FIELD_WEIGHT = 0.30

HAND_CARD_VALUE = 1.3
LIQUIDITY = 0.85
# Search budget. A ceiling, not a target: with the engine enumerating a node in ~2 ms the median
# decision takes ~55 ms and the ceiling is reached only in crowded endgame turns. Measured against
# Reborn over ten four-player games, widening the beam from 4/2 to 6/3 lifted the ledger's average
# from 90 to 106 points, so the extra time is real search, not waste.
TIME_BUDGET = 0.3
FIRST_WIDTH = 6
WIDTH = 3
MAX_DEPTH = 6

# Actions whose outcome comes from hidden information and that the ledger therefore never plays.
NEVER = frozenset({"reroll_projects", "market_refresh"})

_LCG_MUL = 1_664_525
_LCG_ADD = 1_013_904_223
_LCG_INV = pow(_LCG_MUL, -1, 2**32)


@dataclass(frozen=True, slots=True)
class _Root:
    """What the bot saw when the decision started: the only board and market it may plan with."""

    player_id: str
    market_uids: frozenset[str]
    projects: tuple[str, ...]


@dataclass(slots=True)
class _Node:
    state: GameState
    first: dict[str, Any]
    labels: tuple[str, ...]
    value: float


def choose_ledger_command(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: list[tuple[dict[str, Any], Transition]] | None = None,
    *,
    budget: float | None = None,
    widths: tuple[int, int] | None = None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]]]:
    """The first action of the best plan found for the rest of this turn, its value and the runners-up.

    ``budget`` and ``widths`` override the search size; Oracle plays its rollouts with a small one.
    """
    started = time.perf_counter()
    budget = TIME_BUDGET if budget is None else budget
    first_width, next_width = (FIRST_WIDTH, WIDTH) if widths is None else widths
    root = _Root(
        player_id=player_id,
        market_uids=frozenset(item.uid for item in state.market),
        projects=tuple(state.project_board),
    )
    legal = engine.legal_transitions(state, player_id) if legal is None else legal
    base = _utility(engine, state, root)

    best: dict[str, tuple[float, dict[str, Any]]] = {}
    frontier: list[_Node] = []
    for action, transition in legal:
        if not _allowed(action, root):
            continue
        value, expandable = _child_value(engine, state, action, transition.state, root)
        label = _label(action)
        best[label] = (value, action)
        if expandable:
            frontier.append(_Node(transition.state, action, (label,), value))
    if not best:  # nothing but re-deals on offer: the turn still has to end somewhere
        action = next(action for action, _ in legal)
        return action, 0.0, []

    seen: set[tuple[str, ...]] = set()
    width = first_width
    for _depth in range(1, MAX_DEPTH):
        frontier.sort(key=lambda node: -node.value)
        expanding = frontier[:width]
        frontier = []
        width = next_width
        for node in expanding:
            if time.perf_counter() - started > budget:
                break
            for action, transition in engine.legal_transitions(node.state, player_id):
                if not _allowed(action, root):
                    continue
                labels = (*node.labels, _label(action))
                # A plan and its permutation usually land in the same place; search one of them.
                key = tuple(sorted(labels))
                if key in seen:
                    continue
                seen.add(key)
                value, expandable = _child_value(engine, node.state, action, transition.state, root)
                first_label = node.labels[0]
                if value > best[first_label][0]:
                    best[first_label] = (value, node.first)
                if expandable:
                    frontier.append(_Node(transition.state, node.first, labels, value))
        if not frontier:
            break

    ranked = sorted(best.items(), key=lambda item: (-item[1][0], item[0]))
    label, (value, action) = ranked[0]
    return action, value - base, [(name, round(score - base, 3)) for name, (score, _a) in ranked[:5]]


def _allowed(action: dict[str, Any], root: _Root) -> bool:
    kind = action["type"]
    if kind in NEVER:
        return False
    payload = action.get("payload") or {}
    # A slot or a project dealt during the search is a card the bot has not seen yet.
    if kind == "buy_asset" and payload.get("market_uid") not in root.market_uids:
        return False
    if kind == "city_project" and payload.get("project_id") not in root.projects:
        return False
    return True


def _child_value(
    engine: CityEngine,
    before: GameState,
    action: dict[str, Any],
    after: GameState,
    root: _Root,
) -> tuple[float, bool]:
    """Value of the position an action leads to, and whether the plan may continue from it."""
    kind = action["type"]
    if kind == "grey_operation":
        return _grey_expectation(engine, before, action, root), False
    if kind == "end_turn" or after.status != "playing" or after.current_player.id != root.player_id:
        return _utility(engine, after, root), False
    unspent = after.actions_left * UNSPENT_ACTION * _late_factor(after)
    # A blind draw ends the plan: what follows would be planned with cards the bot cannot see.
    expandable = kind != "buy_action_card"
    return _utility(engine, after, root) + unspent, expandable


def grey_chance(engine: CityEngine, player: PlayerState, asset_id: str) -> float:
    """The printed odds of a grey operation for this player."""
    chance = engine.GREY_BASE_CHANCE[asset_id]
    if engine.has_role(player, "fraudster"):
        chance += FRAUDSTER_GREY_BONUS
    return min(0.9, chance)


def forced_grey_outcomes(engine: CityEngine, before: GameState, action: dict[str, Any]) -> tuple[GameState, GameState]:
    """The same grey operation run twice, once forced to land and once forced to miss.

    The roll is the next value of the game's LCG, so presetting the generator to the state whose
    successor is 0 (or the top value) decides it without reading the generator the game really holds.
    """
    outcomes = []
    for draw in (0, 2**32 - 1):
        forced = before.clone()
        forced.rng.state = ((draw - _LCG_ADD) * _LCG_INV) % 2**32
        command = Command(type=action["type"], actor_id=before.current_player.id, payload=dict(action["payload"]))
        outcomes.append(engine.apply(forced, command).state)
    return outcomes[0], outcomes[1]


def _grey_expectation(engine: CityEngine, before: GameState, action: dict[str, Any], root: _Root) -> float:
    """The printed odds over a forced hit and a forced miss — never the roll the state already holds."""
    chance = grey_chance(engine, before.current_player, action["payload"]["asset_id"])
    outcomes = []
    for after in forced_grey_outcomes(engine, before, action):
        still_mine = after.status == "playing" and after.current_player.id == root.player_id
        unspent = after.actions_left * UNSPENT_ACTION * _late_factor(after) if still_mine else 0.0
        outcomes.append(_utility(engine, after, root) + unspent)
    return chance * outcomes[0] + (1 - chance) * outcomes[1]


# --- valuation -----------------------------------------------------------------------------------


def _utility(engine: CityEngine, state: GameState, root: _Root) -> float:
    equities = {player.id: _equity(engine, state, player, root) for player in state.players}
    mine = equities.pop(root.player_id)
    if not equities:
        return mine
    rivals = sorted(equities.values(), reverse=True)
    return mine - LEADER_WEIGHT * rivals[0] - FIELD_WEIGHT * sum(rivals) / len(rivals)


def _equity(engine: CityEngine, state: GameState, player: PlayerState, root: _Root) -> float:
    if state.status == "finished":
        return float(engine.score(player))
    # Only the turns still to start: the actions of a turn in progress are what the search spends,
    # and booking them here as well would make every conversion look as good done later as now.
    turns = _turns_ahead(state, player)
    payouts = max(0, state.max_rounds - state.round_number)
    money_rate, influence_rate = engine._round_rates(state, player)
    money = player.money - player.debt + money_rate * payouts
    influence = player.influence + influence_rate * payouts
    per_turn = 4 if player.role == "fraudster" else 3
    free_slots = max(0, player.capacity - len(player.assets)) + max(0, MAX_CAPACITY - player.capacity) * 0.5

    value = float(engine.score(player))
    # A pile still to be converted is a forecast, and a forecast can be stolen, taxed or simply be
    # wrong; points on the sheet are not. The discount is what makes the bot cash in rather than
    # sit on a wallet the liquidation says it could spend later.
    value += LIQUIDITY * _liquidation(
        money,
        influence,
        turns=turns,
        actions=turns * per_turn,
        slots=free_slots,
        slot_price=_object_price(state.round_number),
    )
    value += _seat_value(engine, state, player, turns)
    value += _project_prospects(engine, state, player, root)
    value += len(player.hand) * (HAND_CARD_VALUE if turns > 0 else 0.0)
    value -= player.jail_turns * 2.0
    return value


def _liquidation(money: float, influence: float, *, turns: int, actions: int, slots: float, slot_price: float) -> float:
    """The points the piles end the game as, with the sinks filled best first.

    Every sink costs an action and the two printed ones are capped at one a turn, so the order is by
    points per action: lobbying (6), an object (half its price), patronage (5), and a campaign last —
    the best rate per dollar while lobbying has room, but only 1.8 points for the action.
    """
    if turns <= 0:
        return min(0.0, money) * PATRONAGE_RATE  # nothing left to spend on; a debt is still owed
    points = 0.0
    money = float(money)
    influence = max(0.0, float(influence))
    actions_left = float(actions)

    lobbies = min(influence / LOBBYING_INFLUENCE, turns, actions_left)
    points += lobbies * LOBBYING_POINTS
    influence -= lobbies * LOBBYING_INFLUENCE
    actions_left -= lobbies
    lobby_room = (turns - lobbies) * LOBBYING_INFLUENCE

    if money > 0:
        bought = min(money / slot_price, slots, actions_left)
        points += bought * slot_price * SLOT_RATE
        money -= bought * slot_price
        actions_left -= bought

        patronages = min(money / PATRONAGE_MONEY, turns, actions_left)
        points += patronages * PATRONAGE_POINTS
        money -= patronages * PATRONAGE_MONEY
        actions_left -= patronages

        campaigns = min(money / _CAMPAIGN_SPEND, actions_left, lobby_room / _CAMPAIGN_GAIN)
        points += campaigns * _CAMPAIGN_SPEND * CAMPAIGN_RATE
        money -= campaigns * _CAMPAIGN_SPEND
    points += max(0.0, money) * SPARE_MONEY_RATE + influence * SPARE_INFLUENCE_RATE
    if money < 0:
        points += money * PATRONAGE_RATE
    return points


def _seat_value(engine: CityEngine, state: GameState, player: PlayerState, turns: int) -> float:
    """The role's future powers, the risk of losing it, and the defence a token buys."""
    value = 0.0
    limit = engine.scandal_limit(player)
    if player.role:
        held = ROLE_TURN_VALUE.get(player.role, 0.25) * min(turns, ROLE_HORIZON)
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


def _threat(engine: CityEngine, state: GameState, player: PlayerState) -> float:
    """How likely somebody hits this player before the game ends, from what the rivals can reach."""
    attackers = 0.0
    for other in state.players:
        if other.id == player.id:
            continue
        if other.role in {"mafia", "military", "journalist"}:
            attackers += 0.6
        if any(engine.grey_operation_unlocked(other, op) for op in ("roof_break", "datacenter", "influence_broker")):
            attackers += 0.4
        attackers += 0.1 * len(other.hand)
    rounds_left = state.max_rounds - state.round_number + 1
    return min(1.0, attackers * 0.5) * min(1.0, rounds_left / 3)


def _project_prospects(engine: CityEngine, state: GameState, player: PlayerState, root: _Root) -> float:
    """Progress towards the projects the bot saw on the board, while they are still there.

    Only the root board counts: a project dealt in the middle of the search came off a deck the bot
    cannot see. A met condition is most of the way to the points, a half-met one a small part of it.
    """
    taken = {project_id for other in state.players for project_id in other.projects}
    best = 0.0
    for project_id in root.projects:
        if project_id in taken or project_id not in state.project_board:
            continue
        project = engine.project(project_id)
        progress = engine.project_requirement_progress(player, project)
        cost_influence, cost_money = engine.project_cost(player, project)
        net = project.points - cost_money * PATRONAGE_RATE - cost_influence * LOBBY_RATE
        best = max(best, max(0.0, net) * progress * progress * 0.35)
    return best


def _turns_ahead(state: GameState, player: PlayerState) -> int:
    """Turns this player still starts, not counting one in progress."""
    rounds_after = max(0, state.max_rounds - state.round_number)
    order = state.turn_order or [other.id for other in state.players]
    position = order.index(player.id) if player.id in order else 0
    later_this_round = int(position > state.turns_taken_in_round)
    return rounds_after + later_this_round


def _late_factor(state: GameState) -> float:
    return 0.3 if state.round_number >= state.max_rounds else 1.0


def _object_price(round_number: int) -> float:
    price = AVERAGE_OBJECT_PRICE[0][1]
    for opens, average in AVERAGE_OBJECT_PRICE:
        if round_number >= opens:
            price = average
    return price


def _label(action: dict[str, Any]) -> str:
    payload = action.get("payload") or {}
    details = ",".join(f"{key}={payload[key]}" for key in sorted(payload))
    return f"{action['type']}({details})"


__all__ = ["LEDGER_ID", "choose_ledger_command"]
