"""Mechanics-driven policies for Oleg, Codex and Claude bots.

Policies never mutate state and never implement game rules. They score the
commands returned by ``CityEngine.legal_actions`` and the selected command is
still validated and executed by the authoritative engine.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from city_engine.commands import Command
from city_engine.constants import (
    CASH_TO_INFLUENCE_MONEY,
    FRAUDSTER_GREY_BONUS,
    GREY_FAILURE_SCANDALS,
    GREY_OPERATION_POINTS,
    GREY_SUCCESS_SCANDALS,
    INFLUENCE_PER_POINT,
    JOURNALIST_RATING_BASE,
    LOBBYING_INFLUENCE,
    MAX_CAPACITY,
    MONEY_PER_POINT,
    PATRONAGE_MONEY,
    POINTS_CARD_RATE,
    ROOF_BREAK_POINT_PER_ROOF,
)
from city_engine.engine import CityEngine
from city_engine.models import GameState, PlayerState

ROLE_DISTRICT = {
    "capitalist": "business",
    "politician": "residential",
    "fraudster": "tech",
    "mafia": "shadows",
    "military": "industrial",
}


@dataclass(frozen=True, slots=True)
class PolicyProfile:
    horizon: int
    aggression: float
    risk_penalty: float
    role_focus: float
    defence: float
    # How hard the bot plays the project board instead of its own tableau. The older profiles
    # were written when money was points and objects were the whole game; they still play that
    # way, which is exactly why they are the easier opponents now.
    planning: float = 0.0
    # Money the bot is happy to hold; everything above reads as capital it failed to deploy. One
    # slot plus one object is what a turn can actually absorb, so a bigger buffer is just hoarding.
    cash_comfort: int = 30
    # What an idle dollar above that buffer costs, in points. See ``_position_value``.
    cash_drag: float = 0.09
    # What a point of influence is worth when it completes a project this turn versus when it is
    # banked toward one still being built. See ``_project_planning_bonus``.
    cashable_influence: float = 1.4
    building_influence: float = 1.4
    # What a point of recurring influence is worth against a dollar of recurring income. The older
    # profiles keep 1.0 — the ratio they were tuned against. See ``_position_value``.
    influence_weight: float = 1.0
    # Whether the bot values money and influence at their exact rate instead of the floored score.
    # Only the reborn profile does: see ``_fractional_score`` for what it buys, and the note above
    # for why the older profiles are left playing the game they were tuned against.
    exact_resources: bool = False


# What one influence is worth in dollars when both are about to be spent, not hoarded: a project
# turns 1◆ into roughly 1.5 points, while a dollar buys 0.5 in an object and 0.1 once the slots
# are full. Used wherever a decision trades one currency for the other.
INFLUENCE_IN_MONEY = 3.0

PROFILES = {
    "easy": PolicyProfile(horizon=3, aggression=0.12, risk_penalty=1.5, role_focus=1.4, defence=0.7),
    "medium": PolicyProfile(horizon=8, aggression=0.25, risk_penalty=2.5, role_focus=2.0, defence=1.2),
    "hard": PolicyProfile(horizon=6, aggression=0.45, risk_penalty=2.0, role_focus=1.7, defence=1.5),
    # Only ``influence_weight`` moved in the influence pass, and it moved because it was wrong, not
    # because it was worth tuning. Everything more aggressive was measured and rejected: forcing
    # money out of the wallet (cash_comfort 18 / cash_drag 0.20) bought +1.1 projects a game and
    # still lost 2.3 points and 8 points of win share over 40 games, because a dollar left in the
    # wallet is worth 0.1 points and the project board simply has nowhere to put the influence.
    # See the note in ``_position_value``.
    "expert": PolicyProfile(
        horizon=7,
        aggression=0.30,
        risk_penalty=1.8,
        role_focus=1.0,
        defence=1.0,
        planning=1.0,
        influence_weight=INFLUENCE_IN_MONEY,
        exact_resources=True,
    ),
}

BOT_POLICY_NAMES = {
    "easy": "Олег",
    "medium": "Codex",
    "hard": "Claude",
    "expert": "Claude Reborn",
}

BOT_POLICY_ALIASES = {
    **{difficulty: difficulty for difficulty in PROFILES},
    "oleg": "easy",
    "олег": "easy",
    "codex": "medium",
    "кодекс": "medium",
    "claude": "hard",
    "клод": "hard",
    "reborn": "expert",
    "claude-reborn": "expert",
    "claude reborn": "expert",
    "клод-реборн": "expert",
}


def normalize_bot_policy(value: str) -> str:
    """Return the persisted difficulty for a human-friendly bot policy name."""

    key = value.strip().lower()
    try:
        return BOT_POLICY_ALIASES[key]
    except KeyError as exc:
        allowed = "easy/oleg, medium/codex, hard/claude"
        raise ValueError(f"unknown bot policy {value!r}; expected {allowed}") from exc


def bot_policy_label(difficulty: str) -> str:
    return f"{BOT_POLICY_NAMES[difficulty]} ({difficulty})"


@dataclass(frozen=True, slots=True)
class BotDecision:
    command: Command
    utility: float
    alternatives: tuple[tuple[str, float], ...]


def choose_bot_command(engine: CityEngine, state: GameState, player_id: str) -> BotDecision:
    player = state.player_by_id(player_id)
    if not player.is_bot:
        raise ValueError("bot policy can only control a bot seat")
    legal = engine.legal_transitions(state, player_id)
    if not legal:
        raise RuntimeError(f"no legal action for bot {player_id}")
    profile = PROFILES[player.difficulty]
    scored = [
        (action, _action_utility(engine, state, player, action, profile, transition.state))
        for action, transition in legal
    ]
    scored.sort(key=lambda item: (-item[1], _stable_action_key(item[0])))
    chosen, utility = scored[0]
    command = Command(
        type=chosen["type"],
        actor_id=player_id,
        payload=dict(chosen.get("payload") or {}),
        command_id=f"bot:{state.game_id}:{state.revision}:{player_id}",
        expected_revision=state.revision,
    )
    return BotDecision(
        command=command,
        utility=utility,
        alternatives=tuple((_action_label(action), round(score, 3)) for action, score in scored[:5]),
    )


def _action_utility(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    action: dict[str, Any],
    profile: PolicyProfile,
    preview_state: GameState,
) -> float:
    action_type = str(action["type"])
    payload = dict(action.get("payload") or {})
    if action_type == "end_turn":
        # Passing used to score -100 while an action remained, which does not mean "prefer to act"
        # — it means "never pass". A bot whose every legal move was negative took the least bad
        # one, so 4.4% of all decisions actively hurt the player, rising to a third of the moves
        # in rounds 14-15: epics traded down to commons, and the free rerolls used as a place to
        # dump a turn. A small penalty keeps any useful action ahead of passing without paying
        # real points for the privilege of moving.
        return -0.5 if state.actions_left > 0 else 0.0
    if action_type == "grey_operation":
        return _grey_operation_utility(engine, state, player, payload, profile)

    before = _position_value(engine, state, player, profile)
    score = _score_function(engine, profile)
    opponents_before = sum(score(other) for other in state.players if other.id != player.id)
    after_state = preview_state
    after_player = after_state.player_by_id(player.id)
    after = _position_value(engine, after_state, after_player, profile)
    opponents_after = sum(score(other) for other in after_state.players if other.id != player.id)
    utility = after - before + (opponents_before - opponents_after) * profile.aggression
    utility += _strategic_action_bonus(engine, state, player, action, profile)
    if profile.planning:
        utility += _project_planning_bonus(engine, state, player, after_player, profile) * profile.planning
    return utility


def _score_function(engine: CityEngine, profile: PolicyProfile) -> Callable[[PlayerState], float]:
    """Which score a profile judges positions by. Only the reborn bot gets the exact one."""
    if profile.exact_resources:
        return lambda player: _fractional_score(engine, player)
    return engine.score


def _fractional_score(engine: CityEngine, player: PlayerState) -> float:
    """The engine's own score, with money and influence counted at their exact passive rate.

    ``score`` floors both, and it has to: a player holding 28$ owns two points, not 2.8. But a
    policy that values *positions* with a floored number cannot see a small resource move at all —
    the mafia racket taking 8$ and 1◆ off a rival scored 0.30 against 2.28 for a hack, and the whole
    0.30 came from the victim happening to cross a ten-dollar boundary.

    The passive rate, not the sink rate: holding is what an unspent pile is really worth, and the
    sinks then show the gain they actually give (double, for an action). Valuing the pile at the sink
    rate instead is circular — the bots pressed lobbying nought times in twelve games that way.

    Nothing here re-implements a rule: the itemised score comes from the engine, and only the two
    rows that are floored by design are recomputed at the same rate the engine used.
    """
    breakdown = engine.score_breakdown(player)
    exact = player.money / MONEY_PER_POINT + player.influence / INFLUENCE_PER_POINT
    return breakdown["total"] - breakdown["money"] - breakdown["influence"] + exact


def _position_value(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    profile: PolicyProfile,
) -> float:
    rounds_left = max(1, state.max_rounds - state.round_number + 1)
    horizon = min(profile.horizon, rounds_left)
    # A point of influence a round is not a dollar a round. Counting them equally made every object
    # that pays influence look like a weak income card: across 48 measured player-games not one bot
    # ever owned the compromat trader or the illegal datacentre, so two of the five grey operations
    # were unreachable rather than mispriced.
    recurring = engine._round_income(state, player) + engine.passive_influence(player) * profile.influence_weight
    # One or two scandals are ordinary score loss, already present in the engine score.  The extra
    # risk term is only for the danger zone near role loss.  Squaring the whole counter made an
    # expert spend 19 actions and scarce influence cleaning from 2 -> 1 in one measured game,
    # then finish with 180$ and too little influence for projects.
    safe_scandals = max(0, engine.scandal_limit(player) - 3)
    scandal_pressure = max(0, player.scandals - safe_scandals)
    scandal_risk = scandal_pressure**2 * profile.risk_penalty
    defence = player.roofs * profile.defence
    role_value = _role_position_value(engine, state, player, player.role, profile)
    hand_value = sum(_card_value(engine, card.card_id, player) for card in player.hand) * 0.35
    # Money counts toward the score at 10$ = 1 point, so simply holding it looks profitable and
    # every sink — a slot, an object, a project — reads as a net loss. A bot finished a measured
    # match sitting on 296$ and three slots, converting two dollars at a time through campaign.
    #
    # Above a working balance the drag almost cancels that 0.1/$, leaving spending clearly better.
    #
    # Raising it further was tried and rejected. At 0.20 the bot's closing balance fell from 177$ to
    # 138$ and it took a full extra project a game, and it still lost: −2.3 points and 42% of wins
    # against the untuned profile over 40 games. The bot is not the problem — with only four project
    # slots on a shared board, the influence that money buys has nowhere to go, so the surplus
    # scores more sitting in the wallet at 0.1 points a dollar than it does converted. That is a
    # statement about the scoring rate and the width of the board, not about the policy.
    cash_drag = max(0, player.money - profile.cash_comfort) * profile.cash_drag * profile.planning
    # The quantum centre's printed income is zero, so a pure income horizon misses its defining
    # effect.  It grants no action on the purchase turn, only on future turns.
    future_turns = min(profile.horizon, max(0, state.max_rounds - state.round_number))
    extra_action_value = min(1, engine.effect_total(player, "extraActions")) * future_turns * 1.8
    return (
        _score_function(engine, profile)(player)
        + recurring * horizon * 0.55
        + extra_action_value
        + defence
        + role_value
        + hand_value
        - scandal_risk
        - cash_drag
    )


def _role_position_value(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    role_id: str | None,
    profile: PolicyProfile,
) -> float:
    if role_id is None:
        return 0.0
    role = _role_utility(engine, state, player, role_id)
    if player.preferred_role == role_id:
        role += 5 * profile.role_focus
    elif player.preferred_role is not None:
        role *= 0.75
    return role


def _role_utility(engine: CityEngine, state: GameState, player: PlayerState, role_id: str) -> float:
    distinct = len({engine.owned_definition(asset).district for asset in player.assets})
    last = engine.ranking(state)[-1].id == player.id
    enemy_scandals = max(
        (other.scandals for other in state.players if other.id != player.id),
        default=0,
    )
    if role_id == "capitalist":
        # The role pays +1$ per *own* object of any district now, on top of the business synergy,
        # so a wide tableau is worth as much to it as a deep business quarter.
        return (
            engine.district_count(player, "business") * 3
            + len(player.assets)
            + distinct * 1.2
            + min(3, player.money / 6)
        )
    if role_id == "politician":
        # The residents tax is charged on every residential object *on the table*, including the
        # rivals' — see ``CityEngine.residents_tax``. Counting only its own was the old power.
        city_residential = sum(engine.district_count(other, "residential") for other in state.players)
        return (
            city_residential + engine.district_count(player, "government") * 4 + engine.passive_influence(player) * 1.5
        )
    if role_id == "journalist":
        return enemy_scandals * 2 + sum(other.role is not None for other in state.players if other.id != player.id)
    if role_id == "fraudster":
        return (
            engine.district_count(player, "tech") * 4
            + engine.district_count(player, "shadows") * 1.5
            + (7 if last else 0)
        )
    if role_id == "mafia":
        return (
            engine.district_count(player, "shadows") * 4
            + engine.district_count(player, "government") * 2
            + (2 if last else 0)
        )
    return engine.district_count(player, "industrial") * 4 + enemy_scandals * 2.5 + (4 if last else 0)


def _affordable_projects(engine: CityEngine, state: GameState, player: PlayerState) -> list[Any]:
    """Board projects whose condition the player already meets — the real scoring targets."""
    return [
        engine.project(project_id)
        for project_id in state.project_board
        if engine.project_requirement_met(player, engine.project(project_id))
    ]


def _project_planning_bonus(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    after: PlayerState,
    profile: PolicyProfile,
) -> float:
    """How much closer a move puts the player to taking projects off the board.

    Projects are two thirds of the final score, and their conditions are read off the tableau, so
    a bot that only maximises income plays the previous version of the game. This scores three
    things the plain utility misses: progress toward conditions, influence banked for a project
    the player is visibly building toward, and money that has nowhere else to go.
    """
    before_ready = {project.id for project in _affordable_projects(engine, state, player)}
    after_ready = {project.id for project in _affordable_projects(engine, state, after)}
    unlocked = sum(engine.project(pid).points for pid in after_ready - before_ready)

    # Partial credit, without which the second of three required objects is worth nothing and a
    # multi-step condition can only ever be completed by accident. Completing still dominates:
    # the last step scores both here and in `unlocked`, because only a met condition can be cashed.
    board = [engine.project(project_id) for project_id in state.project_board]
    advance = 0.0
    for project in board:
        gained = engine.project_requirement_progress(after, project) - engine.project_requirement_progress(
            player, project
        )
        if gained > 0:
            advance += project.points * gained

    # Influence is worth banking for anything the player is already halfway into, not only for a
    # condition that is met right now — waiting for that is how a bot reaches round twelve
    # holding 300$ and 2◆, and then cannot pay for the project it spent the game unlocking.
    #
    # Two shortfalls, not one. The old code took the minimum over everything half-built, so the
    # moment a single project became affordable the whole term collapsed to zero and banking for
    # the next one scored nothing: the bot could only ever hold enough influence for one project,
    # took at most one a turn, and sat on the rest as cash. Measured: 31.6% of turns ended with a
    # satisfied project it could not pay for, and in 29.5% of those it was holding 20$ or more.
    gained_influence = max(0, after.influence - player.influence)
    cashable_shortfall = min(
        (
            short
            for short in (
                max(0, engine.project(project_id).cost_influence - after.influence)
                for project_id in state.project_board
                if engine.project_requirement_met(after, engine.project(project_id))
            )
            if short > 0
        ),
        default=0,
    )
    reachable = [project for project in board if engine.project_requirement_progress(after, project) >= 0.5]
    building_shortfall = min(
        (max(0, project.cost_influence - after.influence) for project in reachable),
        default=0,
    )
    # A project whose condition is already met converts influence into points this turn, so it is
    # worth more per point of influence than one still being built toward.
    influence_value = max(
        min(gained_influence, cashable_shortfall) * profile.cashable_influence,
        min(gained_influence, building_shortfall) * profile.building_influence,
    )
    return unlocked * 1.2 + advance * 0.9 + influence_value


def _strategic_action_bonus(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    action: dict[str, Any],
    profile: PolicyProfile,
) -> float:
    action_type = action["type"]
    payload = action.get("payload") or {}
    preferred = player.preferred_role
    bonus = 0.0
    if action_type == "claim_role":
        role_id = str(payload["role_id"])
        gain = _role_utility(engine, state, player, role_id)
        if player.role and profile.planning:
            # Swapping means giving up what you hold: a bot traded the strongest role in the game
            # for a middling one in round three, paying influence and an action for a downgrade.
            gain -= _role_utility(engine, state, player, player.role)
        bonus += gain * 0.5
        holder = engine.role_holder(state, role_id)
        if holder is not None and profile.planning and holder.roofs > 0:
            # The defence is face-up, so a blocked takeover is a knowingly wasted action.
            bonus -= 6.0
        if role_id == preferred:
            bonus += 12 * profile.role_focus
        elif preferred is not None:
            bonus -= 4 * profile.role_focus
    elif action_type == "buy_asset":
        market = next(item for item in state.market if item.uid == payload["market_uid"])
        asset = engine.asset(market.card_id)
        count = engine.district_count(player, asset.district)
        bonus += 5 if count in {1, 3} else 1 if count == 2 else 0
        if preferred and asset.district == ROLE_DISTRICT.get(preferred):
            bonus += 4 * profile.role_focus
        effects = asset.effects
        if preferred is not None and effects.get("roleBonus", {}).get("role") == preferred:
            bonus += int(effects["roleBonus"]["value"]) * 3 * profile.role_focus
        bonus += sum(
            int(item["value"]) * 2 * profile.role_focus
            for item in effects.get("roleBonuses", [])
            if item.get("role") == preferred
        )
    elif action_type == "buy_action_card":
        # A blind draw, so value it at the average card rather than a chosen one.
        deck = state.action_deck or list(engine.catalog.action_cards)
        bonus += sum(_card_value(engine, card_id, player) for card_id in deck) / len(deck)
    elif action_type == "play_action_card":
        held = next(card for card in player.hand if card.uid == payload["card_uid"])
        card = engine.action_card(held.card_id)
        bonus += _card_value(engine, card.id, player) * 0.5
        target_id = payload.get("target_id")
        if target_id == player.id:
            # Aimed at itself. Only the journalist has a reason to buy a scandal — the rating pays
            # for one — and even then only while the ceiling is above the counter and the role is
            # not one scandal from falling. For anybody else this is a point thrown away.
            ceiling = JOURNALIST_RATING_BASE + engine.district_count(player, "residential")
            headroom = engine.scandal_limit(player) - player.scandals
            if engine.has_role(player, "journalist") and player.scandals < ceiling and headroom > card.value + 1:
                bonus += card.value * 1.5
            else:
                bonus -= 5.0
        elif target_id:
            target = state.player_by_id(str(target_id))
            bonus += target.scandals * profile.aggression
            if engine.ranking(state)[0].id == target.id:
                bonus += 2 * profile.aggression
            if target.roofs > 0:
                bonus += 1.5 * profile.aggression
    elif action_type == "crisis_pr" or (
        action_type == "use_role_power" and str(payload.get("power", "")).endswith("_cleanup")
    ):
        # One mechanic, several prices: the basic PR and every role's own cleanup all spend an
        # action to drop scandals. Bonusing only the basic button made the cheaper power look worse
        # than the dearer one — measured in a live 15-round game, a fraudster bot ran the 3◆ PR
        # fifteen times and its own free cleanup three, burning 45◆ (fifteen points) on nothing.
        safe_scandals = max(0, engine.scandal_limit(player) - 3)
        bonus += max(0, player.scandals - safe_scandals) * profile.defence
        if player.scandals <= safe_scandals:
            bonus -= 1.0
    elif action_type == "buy_roof":
        if player.role is not None:
            # A held role is three points plus its passive, and this token is the only thing that
            # stops a takeover or a compromat leak. The old bonus keyed on `preferred_role`, which
            # an ordinary game never sets, so it never fired: across a measured 15-round game not
            # one player bought a Крыша while two roles changed hands by force.
            bonus += (3 if player.role == preferred else 1.5) * profile.defence
        # All three of the things a token stops are things that have not happened yet, so a
        # one-step utility sees only the money leaving. It is worth most near the scandal limit.
        headroom = engine.scandal_limit(player) - player.scandals
        if headroom <= 2:
            bonus += (3 - headroom) * profile.defence
    elif action_type == "city_project":
        # Projects are unique now: taking one denies it to everybody else, so a contested board
        # is worth more than the points alone.
        project = engine.project(str(payload["project_id"]))
        bonus += project.points * 0.4 + len(state.players) * 0.5
    elif action_type == "basic_action" and profile.planning:
        if payload.get("kind") == "work":
            # Money past what the board can absorb is 0.1 points a dollar.
            bonus -= 1.5 if player.money > 25 else 0.0
        elif payload.get("kind") in {"patronage", "lobbying"}:
            # The points land in the score, so the plain utility already sees them; what it cannot
            # see is that this is the *floor*. Take it when the board has nothing to give and the
            # wallet is past what a purchase can absorb — never instead of a reachable project.
            spare = (
                player.money - profile.cash_comfort - PATRONAGE_MONEY
                if payload.get("kind") == "patronage"
                else player.influence - LOBBYING_INFLUENCE
            )
            bonus += 1.5 if spare > 0 else -2.0
            bonus -= 2.0 if _affordable_projects(engine, state, player) else 0.0
        else:
            bonus += 1.0 if _affordable_projects(engine, state, player) else 0.0
    elif action_type == "buy_capacity" and profile.planning:
        # An empty slot is worth the object that will fill it, and the bot has the money by now.
        best = max((engine.asset_value_of(item.card_id) for item in state.market), default=3)
        bonus += best * 0.8 + min(4.0, player.money / 25)
    elif action_type == "sell_asset":
        bonus += _sell_asset_bonus(engine, state, player, str(payload["asset_uid"]), profile)
    return bonus


def _sell_asset_bonus(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    asset_uid: str,
    profile: PolicyProfile,
) -> float:
    """Selling is free now, and the whole point of it is the purchase that follows.

    A one-step utility can only ever see the loss: the refund equals the points the object was
    worth, so every sale scores negative and the bot would never rebuild its tableau. The
    dedicated one-action swap used to hide this — it was 9.7% of all measured bot actions. This
    values the sale by the best object the freed slot can immediately hold instead.
    """
    owned = next((item for item in player.assets if item.uid == asset_uid), None)
    if owned is None:
        return 0.0
    refund = engine.asset_refund(owned)
    outgoing = engine.asset_value(owned)
    # Only a full tableau needs the slot: with a slot free, buying keeps both objects.
    if len(player.assets) < player.capacity:
        return -3.0
    budget = player.money + refund
    upgrade = max(
        (
            engine.asset_value_of(item.card_id) - outgoing
            for item in state.market
            if budget >= engine.asset_price(state, player, item.card_id)
        ),
        default=None,
    )
    if upgrade is None or upgrade <= 0:
        # Nothing on the market beats what is being sold, so this is a pure downgrade.
        return -4.0
    # The purchase still costs the action the swap used to, and only a real jump is worth it.
    return upgrade * 1.5 - 1.0 + (1.0 if profile.planning else 0.0)


def _grey_operation_utility(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    payload: dict[str, Any],
    profile: PolicyProfile,
) -> float:
    """Grey operations are priced in expected units, so influence has to be converted to them.

    Two of the five trade in influence rather than cash, and a dollar and a point of influence are
    nowhere near interchangeable: influence buys projects at roughly 1.5 points each, a dollar buys
    0.5 at best and 0.1 once the slots are full. ``INFLUENCE_IN_MONEY`` is that ratio.

    A standing caveat on everything below: a bot scores one turn, and three of these operations pay
    in an opponent's lost tempo over the following ten. It cannot see that, and it also cannot see
    that denying the runaway leader is worth doing even when two thirds of the benefit lands on the
    other seats. So the numbers here are a floor on the value of the aggressive lines, not a
    measurement of them, and simulation results for this layer read the same way.
    """
    asset_id = str(payload["asset_id"])
    fraud_bonus = FRAUDSTER_GREY_BONUS if engine.has_role(player, "fraudster") else 0
    chance = min(0.9, engine.GREY_BASE_CHANCE[asset_id] + fraud_bonus)
    rivals = [other for other in state.players if other.id != player.id]
    # The score is the same for every operation, so it belongs outside the branch. It is the part
    # of the payout a one-turn scorer can actually see.
    success_value = float(GREY_OPERATION_POINTS[asset_id])
    if asset_id == "smear":
        # A scandal costs its owner an action and 3◆ to wash off, so value it near a whole action;
        # a roof answers for its owner and eats the hit instead.
        exposed = sum(1 for rival in rivals if rival.roofs == 0)
        success_value += exposed * 2.0 * (1 + profile.aggression)
    elif asset_id == "crypto":
        drain = engine.pump_drain(state)
        success_value += sum(min(drain, rival.money) for rival in rivals if rival.roofs == 0)
    elif asset_id == "roof_break":
        target = state.player_by_id(str(payload["target_id"]))
        # The points are the honest half of this one: the opening it makes is shared with the whole
        # table, and only a player who plans several turns ahead ever cashes it in.
        success_value += target.roofs * ROOF_BREAK_POINT_PER_ROOF
        success_value += target.roofs * profile.aggression
    elif asset_id == "datacenter":
        target = state.player_by_id(str(payload["target_id"]))
        if target.roofs > 0:
            success_value = 0.0
        else:
            stolen = min(engine.hack_influence_steal(state), target.influence)
            # Taken from a rival, so the aggression profile values the denial on top of the gain.
            success_value += stolen * INFLUENCE_IN_MONEY * (1 + profile.aggression)
    else:
        target = state.player_by_id(str(payload["target_id"]))
        if target.role is None:
            return -100.0
        # Stripping a role costs the target 3 points and the passive behind it; a face-up Крыша
        # makes the attempt a knowingly wasted action, exactly like a blocked takeover.
        if target.roofs > 0:
            success_value = 0.0
        else:
            denial = (3 + _role_utility(engine, state, target, target.role) * 0.3) * (1 + profile.aggression)
            # The seat also reopens at the free price instead of the threefold takeover, and that is
            # the attacker's own reason to pull the trigger. Counting only the denial made a leak
            # pure altruism in a four-player game — the cost is yours and the benefit is split three
            # ways — so the bot correctly never ran one across 24 measured games.
            held = _role_utility(engine, state, player, player.role) if player.role else 0.0
            wanted = _role_utility(engine, state, player, target.role)
            if target.role == player.preferred_role:
                wanted += 5 * profile.role_focus
            seat = (state.role_price * 2) * INFLUENCE_IN_MONEY * 0.5 if wanted > held else 0.0
            success_value += denial + seat
    # One scandal for a hit, two for a miss — the same trade for every operation in the set, which
    # is what makes the layer paced by the scandal limit rather than by the price of each line.
    reduction = engine.grey_scandal_reduction(player)
    expected_scandals = chance * max(0, GREY_SUCCESS_SCANDALS - reduction) + (1 - chance) * max(
        0, GREY_FAILURE_SCANDALS - reduction
    )
    scandal_cost = expected_scandals * profile.risk_penalty

    def threshold_penalty(added: int) -> float:
        resulting = player.scandals + added
        limit = engine.scandal_limit(player)
        penalty = 0.0
        if resulting >= limit and player.role is not None:
            # Three printed points plus the passive the bot already knows how to value.
            # Losing the role is not just the three printed points: the seat and its passive are
            # gone until another action and a much higher takeover price can win them back.  A
            # majority of the role utility is therefore a real immediate consequence, while the
            # remaining discount keeps a decisive late-game attack available when it can win now.
            penalty += 4.5 + _role_utility(engine, state, player, player.role) * 0.6
        if resulting >= limit + 1:
            # Jail ends the current turn immediately, so every action after this attempt burns.
            penalty += 2.0 + max(0, state.actions_left - 1) * 1.5
        return penalty

    success_added = max(0, GREY_SUCCESS_SCANDALS - reduction)
    failure_added = max(0, GREY_FAILURE_SCANDALS - reduction)
    consequence_cost = chance * threshold_penalty(success_added) + (1 - chance) * threshold_penalty(failure_added)
    return chance * success_value - scandal_cost - consequence_cost


def _card_value(engine: CityEngine, card_id: str, player: PlayerState) -> float:
    card = engine.action_card(card_id)
    if card.kind in {"clean", "deep_clean"}:
        return min(card.value, player.scandals) * 3
    if card.kind == "buy_points":
        # The largest family in the deck (five cards) and the only points sink that needs no slot.
        # Priced in money the bot usually has too much of, so what it is worth is almost the whole
        # face value; unaffordable, it is a discard waiting to happen.
        price = card.value * POINTS_CARD_RATE
        if player.money < price:
            return 0.5
        return card.value * 3 - price / MONEY_PER_POINT
    if card.kind == "cash_to_influence":
        if player.money < CASH_TO_INFLUENCE_MONEY:
            return 0.5
        return card.value / INFLUENCE_PER_POINT * 3 - CASH_TO_INFLUENCE_MONEY / MONEY_PER_POINT
    if card.kind == "roof":
        # Three cards hand out the same token, and the limit is two: at the ceiling the card is
        # unplayable, and pretending otherwise is how a hand fills up with dead defence.
        return 0.5 if player.roofs >= engine.roof_limit(player) else 5
    if card.kind == "extra_action":
        return card.value * 4
    if card.kind == "district_points":
        # Scores straight away, so it is worth its face value in points rather than a guess.
        return card.value * 4
    if card.kind == "capacity":
        # A free slot is worth the object that will fill it, and by the time cards are flowing the
        # bot has the money — the slot is the half of the purchase it cannot buy any other way.
        return 0.5 if player.capacity >= MAX_CAPACITY else 8
    if card.kind == "project":
        return 6
    return max(1, card.value)


def _action_label(action: dict[str, Any]) -> str:
    payload = action.get("payload") or {}
    details = ",".join(f"{key}={payload[key]}" for key in sorted(payload))
    return f"{action['type']}({details})"


def _stable_action_key(action: dict[str, Any]) -> str:
    return _action_label(action)
