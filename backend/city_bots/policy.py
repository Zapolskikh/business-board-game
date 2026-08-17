"""Mechanics-driven policies for Oleg, Codex and Claude bots.

Policies never mutate state and never implement game rules. They score the
commands returned by ``CityEngine.legal_actions`` and the selected command is
still validated and executed by the authoritative engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import floor
from typing import Any

from city_engine.commands import Command
from city_engine.constants import MARKET_REROLL_COST
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


PROFILES = {
    "easy": PolicyProfile(horizon=3, aggression=0.12, risk_penalty=1.5, role_focus=1.4, defence=0.7),
    "medium": PolicyProfile(horizon=8, aggression=0.25, risk_penalty=2.5, role_focus=2.0, defence=1.2),
    "hard": PolicyProfile(horizon=6, aggression=0.45, risk_penalty=2.0, role_focus=1.7, defence=1.5),
    "expert": PolicyProfile(horizon=7, aggression=0.30, risk_penalty=1.8, role_focus=1.0, defence=1.0, planning=1.0),
}

# Money a planning bot is happy to hold; everything above reads as capital it failed to deploy.
CASH_COMFORT = 30

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
        return -0.5 if state.actions_left > 0 or state.investment_actions > 0 else 0.0
    if action_type == "grey_operation":
        return _grey_operation_utility(engine, state, player, payload, profile)
    if action_type == "use_role_power" and payload.get("power") == "fraudster_forge":
        return _forgery_utility(engine, state, player, payload, profile)

    before = _position_value(engine, state, player, profile)
    opponents_before = sum(engine.score(other) for other in state.players if other.id != player.id)
    after_state = preview_state
    after_player = after_state.player_by_id(player.id)
    after = _position_value(engine, after_state, after_player, profile)
    opponents_after = sum(engine.score(other) for other in after_state.players if other.id != player.id)
    utility = after - before + (opponents_before - opponents_after) * profile.aggression
    utility += _strategic_action_bonus(engine, state, player, action, profile)
    if profile.planning:
        utility += _project_planning_bonus(engine, state, player, after_player) * profile.planning
    return utility


def _position_value(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    profile: PolicyProfile,
) -> float:
    rounds_left = max(1, state.max_rounds - state.round_number + 1)
    horizon = min(profile.horizon, rounds_left)
    recurring = engine._round_income(state, player) + engine.passive_influence(player)
    scandal_risk = player.scandals**2 * profile.risk_penalty
    defence = (player.roofs + player.role_shields + player.scandal_shields) * profile.defence
    role_value = _role_position_value(engine, state, player, player.role, profile)
    hand_value = sum(_card_value(engine, card.card_id, player) for card in player.hand) * 0.35
    # Money counts toward the score at 10$ = 1 point, so simply holding it looks profitable and
    # every sink — a slot, an object, a project — reads as a net loss. A bot finished a measured
    # match sitting on 296$ and three slots, converting two dollars at a time through campaign.
    # Above a working balance the drag almost cancels that 0.1/$, leaving spending clearly better.
    cash_drag = max(0, player.money - CASH_COMFORT) * 0.09 * profile.planning
    return (
        engine.score(player) + recurring * horizon * 0.55 + defence + role_value + hand_value - scandal_risk - cash_drag
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
        return engine.district_count(player, "business") * 4 + distinct * 1.2 + min(3, player.money / 6)
    if role_id == "politician":
        return (
            engine.district_count(player, "residential") * 3
            + engine.district_count(player, "government") * 4
            + engine.passive_influence(player) * 1.5
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
    reachable = [project for project in board if engine.project_requirement_progress(after, project) >= 0.5]
    missing = min(
        (max(0, project.cost_influence - after.influence) for project in reachable),
        default=0,
    )
    gained_influence = max(0, after.influence - player.influence)
    influence_value = min(gained_influence, missing) * 1.4
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
        if holder is not None and profile.planning and (holder.roofs > 0 or holder.role_shields > 0):
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
        if target_id:
            target = state.player_by_id(str(target_id))
            bonus += target.scandals * profile.aggression
            if engine.ranking(state)[0].id == target.id:
                bonus += 2 * profile.aggression
            if target.roofs > 0:
                bonus += 1.5 * profile.aggression
    elif action_type == "crisis_pr":
        bonus += player.scandals * profile.defence
    elif action_type == "buy_roof" and player.role == preferred:
        bonus += 3 * profile.defence
    elif action_type == "city_project":
        # Projects are unique now: taking one denies it to everybody else, so a contested board
        # is worth more than the points alone.
        project = engine.project(str(payload["project_id"]))
        bonus += project.points * 0.4 + len(state.players) * 0.5
        if profile.planning and project.repeatable:
            # An initiative is the way out of a dead hand, not a plan: prefer the board while
            # anything on it is reachable.
            bonus -= 3.0 if _affordable_projects(engine, state, player) else 0.0
    elif action_type == "basic_action" and profile.planning:
        if payload.get("kind") == "work":
            # Money past what the board can absorb is 0.1 points a dollar.
            bonus -= 1.5 if player.money > 25 else 0.0
        else:
            bonus += 1.0 if _affordable_projects(engine, state, player) else 0.0
    elif action_type == "buy_capacity" and profile.planning:
        # An empty slot is worth the object that will fill it, and the bot has the money by now.
        best = max((engine.asset_value_of(item.card_id) for item in state.market), default=3)
        bonus += best * 0.8 + min(4.0, player.money / 25)
    elif action_type == "reroll_market":
        # Rerolling is for "I have money and the market has nothing", not for "I am broke" —
        # the old rule rewarded exactly the useless case and bots burned 2$ at the end of a turn.
        worst_owned = min((engine.asset_value(asset) for asset in player.assets), default=0)
        upgrade_on_offer = any(
            engine.asset_value_of(item.card_id) > worst_owned
            and player.money >= engine.asset_price(state, player, item.card_id)
            for item in state.market
        )
        spare = player.money >= MARKET_REROLL_COST + 5
        bonus += 2.0 if spare and not upgrade_on_offer else -2.0
    elif action_type == "replace_asset":
        # Swapping a cheap early object for a stronger one is the whole point of the mechanic,
        # but it must not become a treadmill: only a real jump in value is worth the action.
        market = next(item for item in state.market if item.uid == payload["market_uid"])
        owned = next(item for item in player.assets if item.uid == payload["asset_uid"])
        gain = engine.asset_value_of(market.card_id) - engine.asset_value(owned)
        bonus += gain * 1.5 - 1.0
        if gain < 0 and profile.planning:
            # Downgrading an epic to a common for a little income costs real points.
            bonus -= 4.0
    return bonus


def _grey_operation_utility(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    payload: dict[str, Any],
    profile: PolicyProfile,
) -> float:
    asset_id = str(payload["asset_id"])
    place = next(index for index, item in enumerate(engine.ranking(state), start=1) if item.id == player.id)
    fraud_bonus = [0, 0.05, 0.1, 0.2][min(3, place - 1)] if engine.has_role(player, "fraudster") else 0
    tech_bonus = min(0.1, engine.district_count(player, "tech") * 0.05) if engine.has_role(player, "fraudster") else 0
    chance = min(
        0.9,
        {"cash": 0.85, "market": 0.75, "crypto": 0.6, "datacenter": 0.55}[asset_id] + fraud_bonus + tech_bonus,
    )
    if asset_id == "cash":
        success_value, failure_cost = 5 + state.round_number - 2, 6
    elif asset_id == "market":
        target = state.player_by_id(str(payload["target_id"]))
        success_value, failure_cost = min(3 + floor(state.round_number / 2), target.money), 1
    elif asset_id == "crypto":
        success_value, failure_cost = 6 + state.round_number, 9
    else:
        target = state.player_by_id(str(payload["target_id"]))
        success_value = (
            max((engine.owned_definition(asset).income for asset in target.assets), default=0) * profile.aggression
        )
        failure_cost = 5
    scandal_cost = (1 if engine.has_role(player, "fraudster") else 2) * profile.risk_penalty
    protection_cost = 1.5 if payload.get("protect_failure") and player.roofs > 0 else 0
    return chance * success_value - (1 - chance) * failure_cost - scandal_cost - protection_cost


def _forgery_utility(
    engine: CityEngine,
    state: GameState,
    player: PlayerState,
    payload: dict[str, Any],
    profile: PolicyProfile,
) -> float:
    role_id = str(payload["role_id"])
    chance = min(0.9, 0.5 + engine.district_count(player, "tech") * 0.1)
    success = _role_utility(engine, state, player, role_id)
    failure = 12 + player.scandals * profile.risk_penalty
    specialist = 5 * profile.role_focus if role_id == player.preferred_role else 0
    return chance * (success + specialist) - (1 - chance) * failure - 5


def _card_value(engine: CityEngine, card_id: str, player: PlayerState) -> float:
    card = engine.action_card(card_id)
    if card.kind in {"clean", "deep_clean"}:
        return min(card.value, player.scandals) * 3
    if card.kind == "roof":
        return 5
    if card.kind in {"extra_action", "investment_action"}:
        return card.value * 4
    if card.kind in {"project", "role_shield", "scandal_shield"}:
        return 6
    return max(1, card.value)


def _action_label(action: dict[str, Any]) -> str:
    payload = action.get("payload") or {}
    details = ",".join(f"{key}={payload[key]}" for key in sorted(payload))
    return f"{action['type']}({details})"


def _stable_action_key(action: dict[str, Any]) -> str:
    return _action_label(action)
