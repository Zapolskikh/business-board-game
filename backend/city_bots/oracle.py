"""Claude Oracle: the hard bot. It plans a whole turn, plays the table forward, and sees the decks.

Ledger books a position at what it can still be turned into, but plans blind: a turn at a time, and
without the cards it cannot see. Oracle keeps Ledger's valuation and removes both limits.

* **It knows the future.** The order of the market, project and action decks and the cards in the
  rivals' hands are read straight off the state, so a refill, a draw or a re-deal is planned with
  the card it will really bring.
* **It plays the table forward.** The best plans for the turn are not compared where they end, but
  after the rivals have answered: each one is rolled out through every rival turn up to Oracle's own
  next turn, with the rivals played by Reborn holding their real hands, and Oracle's own next turn
  played by a fast Ledger. A project the next player will take, or a token the mafia is about to
  burn, shows up in the number.
* **The one thing it may not see is the dice.** A grey operation would land every time if the roll
  sitting in the generator were read, so its own runs are valued as the printed odds over a forced
  hit and a forced miss, and every rollout swaps the game's generator for an unrelated one — the
  rivals' runs in it land or miss on numbers the real game will never use.
* **It thinks once a turn.** The plan is computed when the turn starts (≈ a few seconds) and played
  out action by action without thinking again. It is replanned only when the state stops matching
  the plan, and right after its own grey operation, whose outcome is the one thing the plan could
  not know.
"""

from __future__ import annotations

import time
import zlib
from dataclasses import dataclass, field
from typing import Any

from city_bots.ledger import (
    LEDGER_ID,
    UNSPENT_ACTION,
    _late_factor,
    _Root,
    _utility,
    choose_ledger_command,
    grey_outcomes,
)
from city_engine.commands import Command
from city_engine.engine import CityEngine
from city_engine.models import GameState, Transition

ORACLE_ID = "oracle"

# Thinking time per turn. Planning takes a share of it, the rollouts the rest; a cheap turn ends early.
TURN_BUDGET = 5.0
PLAN_SHARE = 0.25
PLAN_FIRST_WIDTH = 10
PLAN_WIDTH = 5
PLAN_DEPTH = 9
# How many of the best plans are rolled out against the table.
CANDIDATES = 12
ROLLOUT_MODEL = "expert"
ROLLOUT_GUARD = 400
FAST_LEDGER_BUDGET = 0.03
FAST_LEDGER_WIDTHS = (3, 2)
# Plans kept between calls, one per seat. Bounded so a long-lived server cannot accumulate them.
_PLAN_CACHE_LIMIT = 512


@dataclass(slots=True)
class _Plan:
    game_id: str
    turn_serial: int
    revision: int
    actions: list[dict[str, Any]]
    value: float
    alternatives: list[tuple[str, float]]


@dataclass(slots=True)
class _Candidate:
    """A plan for the whole turn and where it leads.

    ``end`` is the state once the turn is over; a plan that stops at a grey operation has no single
    end, so it keeps the position before the run (``before``) and the run itself (``chance``).
    """

    actions: list[dict[str, Any]]
    value: float
    end: GameState | None = None
    before: GameState | None = None
    chance: dict[str, Any] | None = None
    rollout: float | None = field(default=None)


_PLANS: dict[tuple[str, str], _Plan] = {}
# Set to a list by the balance tournament to receive every plan Oracle compared: the value of each
# option it weighed is the closest thing the project has to an expert's opinion of that option.
# ``None`` everywhere else, so the lobby bot records nothing.
TELEMETRY: list[dict[str, Any]] | None = None


def choose_oracle_command(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: list[tuple[dict[str, Any], Transition]] | None = None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]]]:
    key = (state.game_id, player_id)
    plan = _PLANS.get(key)
    if (
        plan is not None
        and plan.actions
        and plan.game_id == state.game_id
        and plan.turn_serial == state.turn_serial
        and plan.revision == state.revision
    ):
        action = plan.actions[0]
        offered = engine.legal_actions(state, player_id) if legal is None else [item for item, _ in legal]
        if action in offered:
            plan.actions.pop(0)
            plan.revision += 1
            if not plan.actions:
                _PLANS.pop(key, None)
            spare = _spend_the_spare(engine, state, player_id, action, legal)
            if spare is not None:
                _PLANS.pop(key, None)
                return spare
            return action, plan.value, plan.alternatives
    _PLANS.pop(key, None)

    action, value, alternatives, rest = _replan(engine, state, player_id, legal)
    spare = _spend_the_spare(engine, state, player_id, action, legal)
    if spare is not None:
        return spare
    if rest:
        if len(_PLANS) >= _PLAN_CACHE_LIMIT:
            _PLANS.clear()
        _PLANS[key] = _Plan(state.game_id, state.turn_serial, state.revision + 1, rest, value, alternatives)
    return action, value, alternatives


def _spend_the_spare(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    action: dict[str, Any],
    legal: list[tuple[dict[str, Any], Transition]] | None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]]] | None:
    """A plan that ends the turn with ⚡ still on the table hands the rest of the turn to Ledger.

    The rollouts compare whole plans by where the table stands a round later, and a spare «Городской
    заказ» or a campaign moves that number by less than the noise between two rollouts — so an early
    end looked as good as spending the action, and Oracle ended one turn in twelve with ⚡ unspent
    (the tester's games, 2026-10-02). Ledger's search never does; it gets the say only when Oracle's
    plan would throw actions away, and only if it finds something better than ending the turn.
    """
    if action.get("type") != "end_turn" or state.actions_left < 1:
        return None
    choice, value, alternatives = choose_ledger_command(engine, state, player_id, legal)
    if choice.get("type") == "end_turn":
        return None
    return choice, value, alternatives


def _replan(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: list[tuple[dict[str, Any], Transition]] | None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]], list[dict[str, Any]]]:
    started = time.perf_counter()
    deadline = started + TURN_BUDGET
    candidates = _plans(engine, state, player_id, legal, started + TURN_BUDGET * PLAN_SHARE)
    if not candidates:
        action = (legal or [(a, None) for a in engine.legal_actions(state, player_id)])[0][0]
        return action, 0.0, [], []

    # Every rollout runs on the same substitute generator, so two plans are compared under the same
    # luck — and none of it is the luck the real game holds.
    luck = _substitute_rng(state)
    last_round = _horizon(state)
    slowest = 0.0
    for candidate in candidates[:CANDIDATES]:
        # The budget is a promise to the player waiting for the table: a rollout that would end past
        # it is not started, judged by the slowest one so far.
        began = time.perf_counter()
        if began + slowest > deadline:
            break
        candidate.rollout = _rollout_value(engine, candidate, player_id, luck, last_round)
        slowest = max(slowest, time.perf_counter() - began)
    scored = [candidate for candidate in candidates if candidate.rollout is not None] or candidates[:1]
    scored.sort(key=lambda item: -(item.rollout if item.rollout is not None else item.value))
    best = scored[0]
    alternatives = [
        (" → ".join(_short(action) for action in item.actions), round(item.rollout or item.value, 3))
        for item in scored[:5]
    ]
    value = best.rollout if best.rollout is not None else best.value
    if TELEMETRY is not None:
        TELEMETRY.append(
            {
                "player_id": player_id,
                "round": state.round_number,
                "revision": state.revision,
                "plan": [dict(action) for action in best.actions],
                "rolled": [(dict(item.actions[0]), item.rollout) for item in scored if item.rollout is not None],
                "static": [(dict(item.actions[0]), item.value) for item in candidates],
            }
        )
    return best.actions[0], value, alternatives, best.actions[1:]


# --- stage one: the turn ------------------------------------------------------------------------


@dataclass(slots=True)
class _Node:
    state: GameState
    actions: list[dict[str, Any]]
    value: float


def _plans(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: list[tuple[dict[str, Any], Transition]] | None,
    deadline: float,
) -> list[_Candidate]:
    """Complete plans for the rest of the turn, best first by the static valuation."""
    finished: list[_Candidate] = []
    seen: set[tuple[str, ...]] = set()
    frontier = [_Node(state, [], 0.0)]
    for depth in range(PLAN_DEPTH):
        children: list[_Node] = []
        for node in frontier:
            if time.perf_counter() > deadline and finished:
                break
            options = legal if depth == 0 and legal is not None else engine.legal_transitions(node.state, player_id)
            for action, transition in options:
                actions = [*node.actions, action]
                signature = tuple(sorted(_short(item) for item in actions))
                if signature in seen:
                    continue
                seen.add(signature)
                after = transition.state
                kind = action["type"]
                if kind == "grey_operation":
                    finished.append(_chance_candidate(engine, node.state, action, actions, player_id))
                elif kind == "end_turn" or after.status != "playing" or after.current_player.id != player_id:
                    finished.append(_Candidate(actions, _value(engine, after, player_id), end=after))
                else:
                    unspent = after.actions_left * UNSPENT_ACTION * _late_factor(after)
                    children.append(_Node(after, actions, _value(engine, after, player_id) + unspent))
        children.sort(key=lambda node: -node.value)
        frontier = children[: PLAN_FIRST_WIDTH if depth == 0 else PLAN_WIDTH]
        if not frontier:
            break
    # Plans still open at the depth limit are closed with an end of turn rather than dropped.
    for node in frontier:
        end = engine.apply(node.state, Command(type="end_turn", actor_id=player_id)).state
        finished.append(
            _Candidate([*node.actions, {"type": "end_turn", "payload": {}}], _value(engine, end, player_id), end=end)
        )
    finished.sort(key=lambda item: -item.value)
    return finished


def _chance_candidate(
    engine: CityEngine,
    before: GameState,
    action: dict[str, Any],
    actions: list[dict[str, Any]],
    player_id: str,
) -> _Candidate:
    value = 0.0
    for weight, after in grey_outcomes(engine, before, action):
        mine = after.status == "playing" and after.current_player.id == player_id
        unspent = after.actions_left * UNSPENT_ACTION * _late_factor(after) if mine else 0.0
        value += weight * (_value(engine, after, player_id) + unspent)
    return _Candidate(actions, value, before=before, chance=action)


# --- stage two: the table answers ---------------------------------------------------------------


def _rollout_value(engine: CityEngine, candidate: _Candidate, player_id: str, luck: int, last_round: int) -> float:
    if candidate.chance is None:
        assert candidate.end is not None
        return _play_forward(engine, candidate.end, player_id, luck, last_round)
    assert candidate.before is not None
    return sum(
        weight * _play_forward(engine, after, player_id, luck, last_round)
        for weight, after in grey_outcomes(engine, candidate.before, candidate.chance)
    )


def _play_forward(engine: CityEngine, start: GameState, player_id: str, luck: int, last_round: int) -> float:
    """Play the table on to the end of ``last_round`` and value the position there.

    Every rival is played by its own policy where it has one — a search bot by a fast Ledger, Reborn
    by Reborn — and a human by Reborn, the cheapest model of a sensible player.
    """
    from city_bots.policy import choose_bot_command  # the rival model; imported late to avoid a cycle

    state = start.clone()
    searching = {LEDGER_ID, ORACLE_ID}
    fast = {
        player.id
        for player in state.players
        if player.id == player_id or (player.is_bot and player.difficulty in searching)
    }
    for player in state.players:
        if player.id not in fast:
            player.is_bot = True
            player.difficulty = ROLLOUT_MODEL
    # The horizon is fixed per decision, never per plan. Turn order is re-dealt every round by the
    # standings, so "up to my next turn" was a horizon each plan chose for itself: a plan that took
    # the lead moved that turn to the end of the next round, let more rivals act inside the rollout
    # and looked worse for it — the bot was punishing its own best moves. Instead the rollout runs
    # to the end of this round when a rival still moves after us in it, and to the end of the next
    # one otherwise, so that every rival answers at least once — see ``_horizon``.
    for _ in range(ROLLOUT_GUARD):
        if state.status != "playing" or state.round_number > last_round:
            break
        actor = state.current_player
        # The dice are keyed to the position, not drawn from a running stream: two plans that reach
        # the same rival decision see the same roll there, however many numbers each used before.
        # Otherwise the comparison picks whichever plan happened to shift the rivals into luck.
        position = f"{luck}:{state.round_number}:{state.turn_serial}:{actor.id}:{state.actions_left}"
        state.rng.state = zlib.crc32(position.encode()) or 1
        if actor.id in fast:
            action, _value_, _alternatives = choose_ledger_command(
                engine, state, actor.id, budget=FAST_LEDGER_BUDGET, widths=FAST_LEDGER_WIDTHS
            )
            command = Command(type=action["type"], actor_id=actor.id, payload=dict(action.get("payload") or {}))
        else:
            command = choose_bot_command(engine, state, actor.id).command
        state = engine.apply(state, command).state
    return _value(engine, state, player_id)


def _horizon(state: GameState) -> int:
    """The last round a rollout plays, read off the position the decision is taken in."""
    rivals_after = len(state.players) - 1 - state.turns_taken_in_round
    return state.round_number if rivals_after > 0 else state.round_number + 1


def _substitute_rng(state: GameState) -> int:
    """Dice for the rollouts that owe nothing to the real generator: built from the game id and
    the turn, so no rollout can carry a trace of a roll the real game is about to make."""
    return zlib.crc32(f"{state.game_id}:{state.turn_serial}".encode())


def _value(engine: CityEngine, state: GameState, player_id: str) -> float:
    root = _Root(player_id=player_id, market_uids=frozenset(), projects=tuple(state.project_board))
    return _utility(engine, state, root)


def _short(action: dict[str, Any]) -> str:
    payload = action.get("payload") or {}
    details = ",".join(f"{key}={payload[key]}" for key in sorted(payload))
    return f"{action['type']}({details})"


def forget_plans() -> None:
    """Drop every cached plan — for tests and for a process that reloads its games."""
    _PLANS.clear()


__all__ = ["ORACLE_ID", "choose_oracle_command", "forget_plans"]
