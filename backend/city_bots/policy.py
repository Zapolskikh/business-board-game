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


PROFILES = {
    "easy": PolicyProfile(horizon=3, aggression=0.12, risk_penalty=1.5, role_focus=1.4, defence=0.7),
    "medium": PolicyProfile(horizon=8, aggression=0.25, risk_penalty=2.5, role_focus=2.0, defence=1.2),
    "hard": PolicyProfile(horizon=6, aggression=0.45, risk_penalty=2.0, role_focus=1.7, defence=1.5),
}


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
    if action_type == "resolve_decision":
        return _decision_utility(state, player, payload, profile)
    if action_type == "end_turn":
        return -100.0 if state.actions_left > 0 or state.investment_actions > 0 else 0.0
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
    return engine.score(player) + recurring * horizon * 0.55 + defence + role_value + hand_value - scandal_risk


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
        bonus += _role_utility(engine, state, player, role_id) * 0.5
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
        bonus += _card_value(engine, str(payload["card_id"]), player)
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
        bonus += 2 if state.max_rounds - state.round_number <= 3 else -1
    return bonus


def _decision_utility(
    state: GameState,
    player: PlayerState,
    payload: dict[str, Any],
    profile: PolicyProfile,
) -> float:
    option = payload.get("option")
    if option != "use_roof":
        return 0.0
    decision = state.pending_decision
    card_id = str(decision.context.get("card_id", "")) if decision else ""
    severe = card_id in {"kompromat", "controlled_leak", "smear_campaign", "asset_freeze", "antitrust"}
    role_defence = player.preferred_role is not None and player.role == player.preferred_role
    return 10.0 if severe or role_defence else 2.0 * profile.defence


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
