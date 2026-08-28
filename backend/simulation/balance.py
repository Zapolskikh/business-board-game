"""Per-item balance measurement: what the content actually pays, and what the bot thinks of it.

This is deliberately **not** a win-rate report. "Win rate of players who owned X" mixes three
different things and only one of them is balance:

* **selection** — the bot buys the expensive object when it is already rich, so the number mostly
  says "rich players win";
* **policy blind spots** — an item the utility function never values gets zero uses and reads as
  dead, when nothing was measured at all;
* **circularity** — the bot's utility function *is* a model of the balance, so measuring balance
  with it confirms the model.

So this module reports two independent axes and never mixes them:

* **pick rate given availability** — of the decisions where an item was legal, how often the bot
  took it. A pure statement about the policy.
* **what it paid** — an accounting ledger: price, slot-rounds held, income produced, immediate
  score delta. A fact about the rules, given the boards that happened. No outcome correlation.

An item that scores high on one axis and low on the other is the interesting case: the policy and
the rules disagree, and one of them is wrong. `SELECTION BIAS` in the report quantifies how much
the naive win-rate number would have lied.

The immediate deltas are measured in **points per action**, because the action is the real budget:
roughly 45-50 of them per player per game, and every channel in the game competes for the same
ones. The two basic sinks are exact known values (patronage 20$ -> 5, lobbying 10 -> 6), so they
double as calibration anchors: if the harness does not reproduce them to the third decimal, the
measurement is wrong and every other number in the report is suspect. `METHOD CHECKS` runs that
comparison automatically.

Usage::

    python -m simulation.balance --games=100 --bots=expert,expert,expert,expert --workers=8
"""

from __future__ import annotations

import argparse
import json
import math
import random
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from city_bots import choose_bot_command, normalize_bot_policy
from city_engine.commands import Command
from city_engine.constants import (
    CAMPAIGN_TIERS,
    INFLUENCE_PER_POINT,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MONEY_PER_POINT,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
)
from city_engine.engine import CityEngine
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_engine.models import GameState, PlayerState
from simulation.runner import recommended_workers

# Actions whose immediate score delta is arithmetic the engine prints in its own constants. If the
# harness disagrees with these, it is not measuring what it thinks it is measuring.
ANCHORS: dict[str, float] = {
    "basic_action:work": 2 / MONEY_PER_POINT,
    "basic_action:patronage": PATRONAGE_POINTS - PATRONAGE_MONEY / MONEY_PER_POINT,
    "basic_action:lobbying": LOBBYING_POINTS - LOBBYING_INFLUENCE / INFLUENCE_PER_POINT,
    **{
        f"basic_action:campaign:{spend}": gain / INFLUENCE_PER_POINT - spend / MONEY_PER_POINT
        for spend, gain in CAMPAIGN_TIERS.items()
    },
}


def fractional_score(engine: CityEngine, player: PlayerState) -> float:
    """The engine's own score with the two floored rows counted at their exact rate.

    ``score`` floors money and influence, and it has to — 28$ is two points, not 2.8. But a floored
    number cannot see a single action at all: work (+2$) moves the score by zero four times out of
    five. Nothing here re-implements a rule; the itemised score comes from the engine and only the
    two rows it floors by design are recomputed at the rate it used to floor them.
    """
    rows = engine.score_breakdown(player)
    exact = player.money / MONEY_PER_POINT + player.influence / INFLUENCE_PER_POINT
    return rows["total"] - rows["money"] - rows["influence"] + exact


def action_key(state: GameState, player: PlayerState, action: dict[str, Any]) -> str:
    """One label per *decision class*, not per command.

    Playing a card at three different targets is three commands but one choice of card, and the
    availability denominator has to match the numerator or the pick rate is nonsense.
    """
    kind = str(action["type"])
    payload = action.get("payload") or {}
    if kind == "basic_action":
        flavour = str(payload.get("kind"))
        # Campaign tiers are separate decisions with separate rates, so they are separate rows.
        return f"basic_action:{flavour}:{payload['spend']}" if flavour == "campaign" else f"basic_action:{flavour}"
    if kind == "buy_asset":
        card = next((item.card_id for item in state.market if item.uid == payload.get("market_uid")), "?")
        return f"buy_asset:{card}"
    if kind == "sell_asset":
        card = next((item.card_id for item in player.assets if item.uid == payload.get("asset_uid")), "?")
        return f"sell_asset:{card}"
    if kind == "play_action_card":
        card = next((item.card_id for item in player.hand if item.uid == payload.get("card_uid")), "?")
        return f"play_action_card:{card}"
    if kind == "convert_action_card":
        return f"convert_action_card:{payload.get('into')}"
    if kind == "use_role_power":
        return f"use_role_power:{payload.get('power')}"
    if kind == "grey_operation":
        return f"grey_operation:{payload.get('asset_id')}"
    if kind == "city_project":
        return f"city_project:{payload.get('project_id')}"
    if kind == "claim_role":
        return f"claim_role:{payload.get('role_id')}"
    return kind


def bucket_of(round_number: int, max_rounds: int) -> str:
    """Thirds of the match. A card worth six points in round two and nothing in round fourteen has
    no meaningful average, so every rate is also reported per third."""
    third = max(1, max_rounds // 3)
    return "early" if round_number <= third else "mid" if round_number <= 2 * third else "late"


BUCKETS = ("early", "mid", "late")
_LCG_MASK = 0xFFFFFFFF
_LCG_MULTIPLIER = 1_664_525
_LCG_INCREMENT = 1_013_904_223
_LCG_MULTIPLIER_INVERSE = pow(_LCG_MULTIPLIER, -1, 2**32)


@dataclass
class Ledger:
    """Everything one batch of games measured. Counters only, so merging is addition.

    ``Counter.update`` and not ``Counter.__add__``: the ``+`` operator silently drops zero and
    negative counts, and half the sums here are signed score deltas.
    """

    games: int = 0
    decisions: int = 0
    commands: int = 0
    # --- axis 1: what the policy thinks -------------------------------------------------------
    available: Counter = field(default_factory=Counter)
    chosen: Counter = field(default_factory=Counter)
    available_bucket: Counter = field(default_factory=Counter)
    chosen_bucket: Counter = field(default_factory=Counter)
    # --- axis 2: what it paid -----------------------------------------------------------------
    # `valued` is the denominator for the two deltas: it excludes round-closing commands, so it is
    # not the same as `chosen` and the report must never divide a delta by `chosen`.
    valued: Counter = field(default_factory=Counter)
    self_delta: Counter = field(default_factory=Counter)
    rival_delta: Counter = field(default_factory=Counter)
    self_delta_sq: Counter = field(default_factory=Counter)
    rival_delta_sq: Counter = field(default_factory=Counter)
    actions_spent: Counter = field(default_factory=Counter)
    valued_bucket: Counter = field(default_factory=Counter)
    self_delta_bucket: Counter = field(default_factory=Counter)
    rival_delta_bucket: Counter = field(default_factory=Counter)
    actions_spent_bucket: Counter = field(default_factory=Counter)
    # --- object lifetime ledger ---------------------------------------------------------------
    obj_bought: Counter = field(default_factory=Counter)
    obj_price: Counter = field(default_factory=Counter)
    obj_round: Counter = field(default_factory=Counter)
    obj_slot_rounds: Counter = field(default_factory=Counter)
    obj_printed_income: Counter = field(default_factory=Counter)
    obj_synergy_income: Counter = field(default_factory=Counter)
    obj_sold: Counter = field(default_factory=Counter)
    obj_refund: Counter = field(default_factory=Counter)
    obj_project_contrib: Counter = field(default_factory=Counter)
    obj_grey_unlock: Counter = field(default_factory=Counter)
    # --- the bias probe -----------------------------------------------------------------------
    obj_owner_games: Counter = field(default_factory=Counter)
    obj_owner_wins: Counter = field(default_factory=Counter)
    obj_buyer_money: Counter = field(default_factory=Counter)
    obj_offer_money: Counter = field(default_factory=Counter)
    obj_offers: Counter = field(default_factory=Counter)
    # --- grey operations ----------------------------------------------------------------------
    grey_runs: Counter = field(default_factory=Counter)
    grey_success: Counter = field(default_factory=Counter)
    grey_blocked: Counter = field(default_factory=Counter)
    grey_points: Counter = field(default_factory=Counter)
    # --- roles --------------------------------------------------------------------------------
    role_claims: Counter = field(default_factory=Counter)
    role_turns: Counter = field(default_factory=Counter)
    role_lost: Counter = field(default_factory=Counter)
    # --- method self-checks -------------------------------------------------------------------
    settlements: int = 0
    settlement_rows: int = 0
    settle_mismatch: int = 0
    passes_with_actions: int = 0
    # Commands whose transition also settled a round. Their immediate delta is the round's income,
    # not the action's, so they are excluded from the value axis and counted here instead.
    settling_commands: int = 0

    def merge(self, other: Ledger) -> None:
        self.games += other.games
        self.decisions += other.decisions
        self.commands += other.commands
        self.settlements += other.settlements
        self.settlement_rows += other.settlement_rows
        self.settle_mismatch += other.settle_mismatch
        self.passes_with_actions += other.passes_with_actions
        self.settling_commands += other.settling_commands
        for name, value in vars(other).items():
            if isinstance(value, Counter):
                getattr(self, name).update(value)


@dataclass(frozen=True, slots=True)
class BalanceConfig:
    games: int = 100
    rounds: int = 15
    players: int = 4
    role_price: int = 3
    bots: tuple[str, ...] = ("expert", "expert", "expert", "expert")
    seed: int = 0
    epsilon: float = 0.0
    policy: str = "reborn"
    workers: int = 1


def _command_from_action(state: GameState, actor_id: str, action: dict[str, Any]) -> Command:
    return Command(
        type=str(action["type"]),
        actor_id=actor_id,
        payload=dict(action.get("payload") or {}),
        command_id=f"balance:{state.game_id}:{state.revision}:{actor_id}",
        expected_revision=state.revision,
    )


def _meaningful_transitions(
    state: GameState, transitions: list[tuple[dict[str, Any], Any]]
) -> list[tuple[dict[str, Any], Any]]:
    """Do not let exploration throw away a live action just because passing is technically legal."""

    if state.actions_left <= 0:
        return transitions
    without_pass = [item for item in transitions if item[0]["type"] != "end_turn"]
    return without_pass or transitions


def _exploration_command(
    state: GameState,
    actor: PlayerState,
    transitions: list[tuple[dict[str, Any], Any]],
    noise: random.Random,
) -> Command:
    """Sample decision classes uniformly, then one concrete target within the class.

    The report denominator is one availability per decision class. Sampling raw commands instead
    gives a targeted card three lottery tickets when it has three possible victims, biasing the
    exploration numerator away from its own denominator.
    """

    classes: dict[str, list[dict[str, Any]]] = {}
    for action, _ in _meaningful_transitions(state, transitions):
        classes.setdefault(action_key(state, actor, action), []).append(action)
    key = noise.choice(sorted(classes))
    return _command_from_action(state, actor.id, noise.choice(classes[key]))


def _myopic_command(
    engine: CityEngine,
    state: GameState,
    actor: PlayerState,
    transitions: list[tuple[dict[str, Any], Any]],
) -> Command:
    """Choose only the largest immediate self-score delta, with no hand-written utility model."""

    before = fractional_score(engine, actor)
    scored = []
    for action, transition in _meaningful_transitions(state, transitions):
        stable = json.dumps(action, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        if action["type"] == "grey_operation":
            # ``legal_transitions`` has already rolled the operation. Scoring that realised state
            # lets a policy see the next RNG result and choose only hits. Evaluate the exact success
            # and failure branches instead, weighted by the public chance printed in the event.
            chance = next(
                float(event.data["chance"]) for event in transition.events if event.type == "grey_operation_resolved"
            )
            command = _command_from_action(state, actor.id, action)
            success_delta = _forced_grey_delta(engine, state, actor.id, command, next_u32=0)
            failure_delta = _forced_grey_delta(engine, state, actor.id, command, next_u32=_LCG_MASK)
            immediate = chance * success_delta + (1 - chance) * failure_delta
        else:
            after_actor = transition.state.player_by_id(actor.id)
            immediate = fractional_score(engine, after_actor) - before
        scored.append((immediate, stable, action))
    _, _, picked = max(scored, key=lambda item: (item[0], item[1]))
    return _command_from_action(state, actor.id, picked)


def _forced_grey_delta(
    engine: CityEngine,
    state: GameState,
    actor_id: str,
    command: Command,
    *,
    next_u32: int,
) -> float:
    forced = state.clone()
    forced.rng.state = ((next_u32 - _LCG_INCREMENT) * _LCG_MULTIPLIER_INVERSE) & _LCG_MASK
    before = fractional_score(engine, forced.player_by_id(actor_id))
    after = engine.apply(forced, command).state.player_by_id(actor_id)
    return fractional_score(engine, after) - before


def _actions_consumed(before: GameState, after: GameState, actor_id: str, command: Command) -> int:
    """Action budget lost to this command, including the remainder burnt by a self-arrest.

    ``actions_left`` is global turn state. Once an arrest advances the turn, the value in ``after``
    belongs to the next player and cannot be subtracted from the actor's old counter. This was the
    reason action-spending powers appeared as ``free`` and some grey operations had ``act < 1``.
    """

    if command.type == "end_turn" or before.actions_left <= 0:
        return 0
    actor_still_has_turn = (
        after.status == "playing" and after.current_player.id == actor_id and after.turn_serial == before.turn_serial
    )
    if actor_still_has_turn:
        return max(0, before.actions_left - after.actions_left)
    return before.actions_left


def _play_one(engine: CityEngine, config: BalanceConfig, index: int, seed: int) -> Ledger:
    setups = [
        PlayerSetup(id=f"seat-{seat}", name=f"Bot {seat}", is_bot=True, difficulty=policy)
        for seat, policy in enumerate(config.bots, start=1)
    ]
    state = create_game_from_catalog(
        f"balance-{index}",
        setups,
        seed=seed,
        settings=GameSettings(max_rounds=config.rounds, role_price=config.role_price),
    )
    ledger = Ledger(games=1)
    noise = random.Random(seed ^ 0x5EED)
    # uid -> the object's running tab. Objects are followed by uid because a card id can be bought,
    # sold and bought again by somebody else within one game.
    live: dict[str, dict[str, Any]] = {}

    while state.status == "playing":
        actor = state.current_player
        # Enumerated once and handed to the policy: `legal_transitions` applies every candidate
        # against a full state clone, so computing it here and again inside the policy doubled the
        # runtime of the whole harness for no extra information.
        transitions = engine.legal_transitions(state, actor.id)
        if not transitions:
            break
        legal = [action for action, _ in transitions]
        keys = {action_key(state, actor, action) for action in legal}
        bucket = bucket_of(state.round_number, config.rounds)
        ledger.decisions += 1
        for key in keys:
            ledger.available[key] += 1
            ledger.available_bucket[(key, bucket)] += 1
        # Which objects were on offer, and how rich the player was while declining them. This is
        # the selection confound measured directly rather than assumed away.
        for action in legal:
            if action["type"] == "buy_asset":
                card = action_key(state, actor, action).split(":", 1)[1]
                ledger.obj_offers[card] += 1
                ledger.obj_offer_money[card] += actor.money

        if config.epsilon and noise.random() < config.epsilon:
            # Forced exploration: the only way to get any observation at all for an item the
            # utility function never ranks first. Keeps the value axis from being defined by the
            # same function whose opinion the pick-rate axis is measuring.
            command = _exploration_command(state, actor, transitions, noise)
        elif config.policy == "random":
            command = _exploration_command(state, actor, transitions, noise)
        elif config.policy == "greedy-myopic":
            command = _myopic_command(engine, state, actor, transitions)
        else:
            command = choose_bot_command(engine, state, actor.id, transitions).command
        key = action_key(state, actor, {"type": command.type, "payload": dict(command.payload)})
        before_self = fractional_score(engine, actor)
        before_rivals = sum(fractional_score(engine, other) for other in state.players if other.id != actor.id)
        if command.type == "end_turn" and state.actions_left > 0:
            ledger.passes_with_actions += 1

        transition = engine.apply(state, command)
        ledger.commands += 1
        after = transition.state
        after_actor = after.player_by_id(actor.id)
        ledger.chosen[key] += 1
        ledger.chosen_bucket[(key, bucket)] += 1
        # A command that also closes the round carries the whole settlement in its delta — every
        # player's income, not this action's value. Measured naively it made `end_turn` the most
        # profitable move in the game at +4.75 points per action. Those commands are counted, not
        # valued; the income they carry is already attributed object by object in the ledger below.
        settled = any(event.type == "round_settled" for event in transition.events)
        if settled:
            ledger.settling_commands += 1
        else:
            self_change = fractional_score(engine, after_actor) - before_self
            rival_change = (
                sum(fractional_score(engine, other) for other in after.players if other.id != actor.id) - before_rivals
            )
            actions = _actions_consumed(state, after, actor.id, command)
            ledger.self_delta[key] += self_change
            ledger.rival_delta[key] += rival_change
            ledger.self_delta_sq[key] += self_change * self_change
            ledger.rival_delta_sq[key] += rival_change * rival_change
            ledger.valued[key] += 1
            ledger.actions_spent[key] += actions
            ledger.valued_bucket[(key, bucket)] += 1
            ledger.self_delta_bucket[(key, bucket)] += self_change
            ledger.rival_delta_bucket[(key, bucket)] += rival_change
            ledger.actions_spent_bucket[(key, bucket)] += actions

        _absorb_events(engine, ledger, state, after, transition.events, live)
        state = after

    _close_books(engine, ledger, state, live)
    return ledger


def _absorb_events(
    engine: CityEngine,
    ledger: Ledger,
    before: GameState,
    after: GameState,
    events: list[Any],
    live: dict[str, dict[str, Any]],
) -> None:
    for event in events:
        data = event.data
        if event.type == "asset_bought":
            uid = str(data["market_uid"])
            card = str(data["asset_id"])
            live[uid] = {"card": card, "owner": event.actor_id, "round": before.round_number}
            ledger.obj_bought[card] += 1
            ledger.obj_price[card] += int(data["cost"])
            ledger.obj_round[card] += before.round_number
            ledger.obj_buyer_money[card] += before.player_by_id(str(event.actor_id)).money
        elif event.type == "asset_sold":
            uid = str(data["asset_uid"])
            if uid in live:
                card = live.pop(uid)["card"]
                ledger.obj_sold[card] += 1
                ledger.obj_refund[card] += int(data["value"])
        elif event.type == "city_project_taken":
            _credit_project(engine, ledger, before, str(event.actor_id), str(data["project_id"]))
        elif event.type == "grey_operation_resolved":
            operation = str(data["asset_id"])
            ledger.grey_runs[operation] += 1
            ledger.grey_success[operation] += int(bool(data["success"]))
            ledger.grey_blocked[operation] += int(bool(data.get("blocked")))
            ledger.grey_points[operation] += int(data.get("points", 0))
            _credit_grey(engine, ledger, before, str(event.actor_id), operation)
        elif event.type == "role_claimed":
            ledger.role_claims[str(data["role_id"])] += 1
        elif event.type in {"role_stripped", "scandal_limit_reached"} and data.get("role_id"):
            ledger.role_lost[str(data["role_id"])] += 1
        elif event.type == "turn_started":
            player = after.player_by_id(str(event.actor_id))
            if player.role:
                ledger.role_turns[player.role] += 1
        elif event.type == "round_settled":
            _credit_income(ledger, data, live)


def _credit_income(
    ledger: Ledger,
    data: dict[str, Any],
    live: dict[str, dict[str, Any]],
) -> None:
    ledger.settlements += 1
    object_sources = data.get("object_income_sources", {})
    ledger.settlement_rows += len(data["income_sources"])
    for player_id in data["income_sources"]:
        sources = object_sources.get(player_id, {})
        claimed = int(data["income_sources"][player_id]["objects"])
        attributed = 0
        for uid, row in sources.items():
            printed, synergy = int(row["printed"]), int(row["synergy"])
            attributed += printed + synergy
            if uid in live:
                card = live[uid]["card"]
                ledger.obj_slot_rounds[card] += 1
                ledger.obj_printed_income[card] += printed
                ledger.obj_synergy_income[card] += synergy
        # The engine paid one number; this harness split it into per-object rows. If the rows do
        # not add back up to it, the split is wrong and every per-object income figure is fiction.
        if attributed != claimed:
            ledger.settle_mismatch += 1


def _credit_project(engine: CityEngine, ledger: Ledger, state: GameState, actor_id: str, project_id: str) -> None:
    """Which objects were standing in the condition when a project was taken.

    A count of contributions, deliberately not a share of the project's points: splitting seven
    points between three objects is a made-up number, while "this object was part of a satisfied
    condition eleven times" is a fact.
    """
    player = state.player_by_id(actor_id)
    requirement = engine.project(project_id).requirement
    kind = str(requirement.get("type", "none"))
    for owned in player.assets:
        asset = engine.owned_definition(owned)
        hit = (
            kind == "assets"
            or (kind == "district_objects" and asset.district == str(requirement.get("district")))
            or (kind == "tag_objects" and str(requirement.get("tag")) in asset.tags)
            or (kind in {"district_depth", "distinct_districts"})
        )
        if hit:
            ledger.obj_project_contrib[asset.id] += 1


def _credit_grey(engine: CityEngine, ledger: Ledger, state: GameState, actor_id: str, operation: str) -> None:
    """Which objects were holding the district gate open when a grey operation ran."""
    player = state.player_by_id(actor_id)
    districts = engine.GREY_OPERATION_DISTRICTS.get(operation, ())
    for owned in player.assets:
        if engine.owned_definition(owned).district in districts:
            ledger.obj_grey_unlock[owned.card_id] += 1


def _close_books(engine: CityEngine, ledger: Ledger, state: GameState, live: dict[str, dict[str, Any]]) -> None:
    if state.status != "finished":
        return
    winner = engine.ranking(state)[0].id
    for player in state.players:
        # The naive metric, kept only so the report can show how far it is from the ledger.
        for card in {owned.card_id for owned in player.assets}:
            ledger.obj_owner_games[card] += 1
            ledger.obj_owner_wins[card] += int(player.id == winner)


def game_seed(config: BalanceConfig, index: int) -> int:
    """A game's seed, derived from (run seed, game index) and nothing else.

    Not a counter off a base — a fixed arithmetic stride into a 32-bit LCG correlates the opening
    deals across games, which is the exact variance the measurement exists to average over. And not
    a stream drawn per worker either: the chunks are strided, so an identically seeded stream in
    each worker hands the same seeds to different indexes and the run silently plays every game
    ``workers`` times. Deriving from the index makes the seed independent of how the work is split,
    so a 1-worker debug run and an 8-worker production run play the same 3000 games.
    """
    return random.Random(f"{config.seed}:{index}").randrange(1, 2**32)


def _run_chunk(config: BalanceConfig, indexes: list[int]) -> Ledger:
    engine = CityEngine()
    total = Ledger()
    for index in indexes:
        total.merge(_play_one(engine, config, index, game_seed(config, index)))
    return total


def run_balance(config: BalanceConfig) -> Ledger:
    indexes = list(range(config.games))
    workers = min(config.workers, config.games)
    if workers <= 1:
        return _run_chunk(config, indexes)
    chunks = [indexes[offset::workers] for offset in range(workers)]
    total = Ledger()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for part in pool.map(_run_chunk, [config] * workers, chunks):
            total.merge(part)
    return total


def _wilson_half_width(hits: int, trials: int) -> float:
    if trials <= 0:
        return 1.0
    rate = hits / trials
    return 1.96 * math.sqrt(max(rate * (1 - rate), 1e-9) / trials)


def render(ledger: Ledger, engine: CityEngine, config: BalanceConfig) -> str:
    lines: list[str] = []
    add = lines.append
    catalog = engine.catalog

    add(f"games={ledger.games}  decisions={ledger.decisions}")
    add(
        f"bots={','.join(config.bots)}  rounds={config.rounds}  policy={config.policy}"
        f"  epsilon={config.epsilon}  seed={config.seed}"
    )

    # ---------------------------------------------------------------- method checks
    add("\n=== METHOD CHECKS ===")
    add("  anchors (immediate self delta must equal the arithmetic in constants.py)")
    worst = 0.0
    for key, expected in sorted(ANCHORS.items()):
        taken = ledger.chosen[key]
        if not taken:
            add(f"    {key:<28} expected {expected:+6.3f}   NOT USED — cannot calibrate")
            continue
        measured = ledger.self_delta[key] / taken
        error = abs(measured - expected)
        worst = max(worst, error)
        verdict = "OK" if error < 1e-6 else "MISMATCH"
        add(f"    {key:<28} expected {expected:+6.3f}  measured {measured:+6.3f}  n={taken:<6d} {verdict}")
    add(f"  worst anchor error: {worst:.2e}")

    share = 100 * ledger.settle_mismatch / ledger.settlement_rows if ledger.settlement_rows else 0.0
    income_verdict = "OK" if not ledger.settle_mismatch else "MISMATCH"
    add(
        f"  object income attribution: {ledger.settle_mismatch}/{ledger.settlement_rows}"
        f" player settlement rows disagree ({share:.2f}%)  {income_verdict}"
    )

    seen_objects = sum(1 for card in catalog.assets if ledger.obj_offers[card])
    bought_objects = sum(1 for card in catalog.assets if ledger.obj_bought[card])
    seen_cards = sum(1 for card in catalog.action_cards if ledger.available[f"play_action_card:{card}"])
    seen_projects = sum(1 for pid in catalog.projects if ledger.available[f"city_project:{pid}"])
    add("  coverage (an item nobody was ever offered is not a measurement, it is a gap)")
    total_objects = len(catalog.assets)
    add(f"    objects offered {seen_objects}/{total_objects}   bought at least once {bought_objects}/{total_objects}")
    add(
        f"    action cards offered {seen_cards}/{len(catalog.action_cards)}"
        f"   projects offered {seen_projects}/{len(catalog.projects)}"
    )
    grey_seen = sum(1 for op in engine.GREY_ASSET_IDS if ledger.grey_runs[op])
    add(f"    grey operations run {grey_seen}/{len(engine.GREY_ASSET_IDS)}")

    offers = [ledger.obj_offers[card] for card in catalog.assets if ledger.obj_offers[card]]
    if offers:
        thin = sorted(offers)[: max(1, len(offers) // 10)]
        median = sorted(offers)[len(offers) // 2]
        add(f"    offers per object: median {median}, thinnest decile mean {sum(thin) / len(thin):.0f}")
        half = _wilson_half_width(median // 4, median)
        add(f"    rough decision-level pick-rate half-width at the median object: +/-{100 * half:.1f}pp")
        need = 1.96**2 * 0.25 / 0.02**2
        add(
            f"    rough games for +/-2.0pp: ~{config.games * need / max(median, 1):.0f}"
            " (planning heuristic; repeated offers within a game are correlated)"
        )

    # ---------------------------------------------------------------- selection bias
    add("\n=== SELECTION BIAS (why the naive win rate cannot be used) ===")
    rich_bought = rich_offered = 0.0
    for card in catalog.assets:
        rich_bought += ledger.obj_buyer_money[card]
        rich_offered += ledger.obj_offer_money[card]
    bought_n = sum(ledger.obj_bought[card] for card in catalog.assets)
    offer_n = sum(ledger.obj_offers[card] for card in catalog.assets)
    if bought_n and offer_n:
        add(
            f"  wallet when buying: {rich_bought / bought_n:.1f}$"
            f"   wallet when merely offered: {rich_offered / offer_n:.1f}$"
        )
    pairs = [
        (catalog.assets[card].cost, ledger.obj_owner_wins[card] / ledger.obj_owner_games[card])
        for card in catalog.assets
        if ledger.obj_owner_games[card] >= 5
    ]
    timing = [
        (ledger.obj_round[card] / ledger.obj_bought[card], ledger.obj_owner_wins[card] / ledger.obj_owner_games[card])
        for card in catalog.assets
        if ledger.obj_owner_games[card] >= 5 and ledger.obj_bought[card]
    ]
    if len(pairs) > 2:
        add(f"  corr(price, naive owner win rate)        = {_pearson(pairs):+.2f} over {len(pairs)} objects")
    if len(timing) > 2:
        add(f"  corr(round bought, naive owner win rate) = {_pearson(timing):+.2f} over {len(timing)} objects")
    bars = [
        _wilson_half_width(ledger.obj_owner_wins[card], ledger.obj_owner_games[card])
        for card in catalog.assets
        if ledger.obj_owner_games[card]
    ]
    if bars:
        median_bar = sorted(bars)[len(bars) // 2]
        add(f"  naive win rate error bar: median +/-{100 * median_bar:.0f}pp at this sample size")
    add(
        "    Those correlations are the confound, not a finding, and the error bar is why the whole\n"
        "    naive column stays out of any conclusion: an object bought in round two rides twelve\n"
        "    rounds of compounding it did not cause, one bought in round thirteen is a symptom of a\n"
        "    board that was already losing, and under a hundred owners neither is distinguishable\n"
        "    from noise. Use pts/buy and pick% instead; the naive column is printed to be ignored."
    )

    # ---------------------------------------------------------------- actions
    add("\n=== ACTIONS ===")
    add(
        "  TERMINAL actions resolve inside the turn, so the immediate delta IS their value.\n"
        "  INVESTMENT actions buy a thing that pays later, so a negative delta is the price, not a\n"
        "  verdict: their return shows up in the OBJECTS ledger and in the cards the draw plays."
    )
    head = (
        f"  {'decision':<34}{'avail':>7}{'taken':>7}{'pick%':>7}{'act':>6}"
        f"{'self':>8}{'rival':>8}{'pts/act':>9}{'selfSD':>8}"
    )
    add(head + "   e/m/l pick%   e/m/l pts/act")
    investment = ("buy_action_card", "buy_roof", "buy_capacity", "buy_asset", "reroll_projects", "claim_role")
    families = (
        "basic_action",
        "convert_action_card",
        "crisis_pr",
        "use_role_power",
        "grey_operation",
        "sell_asset",
        *investment,
    )
    rows = [key for key in ledger.available if key.split(":", 1)[0] in families and not key.startswith("buy_asset")]

    def emit(key: str) -> None:
        avail, taken = ledger.available[key], ledger.chosen[key]
        valued, acts = ledger.valued[key], ledger.actions_spent[key]
        # A move that costs no action has no points-per-action. Printing nan there invited the
        # reader to rank the free moves — selling, the journalist's inflate — as the worst in the
        # table, which is the opposite of what costing nothing means.
        per_action = f"{ledger.self_delta[key] / acts:>9.2f}" if acts else f"{'free':>9}"
        self_sd = _sample_sd(ledger.self_delta[key], ledger.self_delta_sq[key], valued)
        spread = "/".join(
            f"{100 * ledger.chosen_bucket[(key, b)] / ledger.available_bucket[(key, b)]:.0f}"
            if ledger.available_bucket[(key, b)]
            else "-"
            for b in BUCKETS
        )
        value_spread = "/".join(
            f"{ledger.self_delta_bucket[(key, b)] / ledger.actions_spent_bucket[(key, b)]:.1f}"
            if ledger.actions_spent_bucket[(key, b)]
            else "free"
            if ledger.valued_bucket[(key, b)]
            else "-"
            for b in BUCKETS
        )
        add(
            f"  {key:<34}{avail:>7}{taken:>7}{100 * taken / avail if avail else 0:>7.1f}"
            f"{acts / valued if valued else 0:>6.2f}{ledger.self_delta[key] / valued if valued else 0:>8.2f}"
            f"{ledger.rival_delta[key] / valued if valued else 0:>8.2f}{per_action}{self_sd:>8.2f}"
            f"   {spread:<12}{value_spread}"
        )

    sale_rows = [key for key in rows if key.startswith("sell_asset:")]
    for label, keys in (
        (
            "terminal — the delta is the value",
            [key for key in rows if key.split(":", 1)[0] not in investment and not key.startswith("sell_asset:")],
        ),
        ("investment — the delta is the price", [key for key in rows if key.split(":", 1)[0] in investment]),
        ("sales — free liquidation; only classes used at least once", [key for key in sale_rows if ledger.chosen[key]]),
    ):
        add(f"  -- {label} --")
        if keys:
            for key in sorted(keys, key=lambda item: -ledger.chosen[item]):
                emit(key)
        elif label.startswith("sales"):
            add(f"  (none taken; {len(sale_rows)} sale classes were legal)")

    # A deliberately labelled proxy, not a full attribution. Free draws from object bonuses enter
    # the numerator without a purchase, while delayed effects (zoning, extra actions, capacity,
    # discounts) land on later commands. It is useful for before/after diffs, not a channel verdict.
    bought = ledger.valued["buy_action_card"]
    played = sum(count for key, count in ledger.valued.items() if key.startswith("play_action_card:"))
    discarded = sum(count for key, count in ledger.valued.items() if key.startswith("convert_action_card:"))
    spent_value = sum(
        value
        for key, value in ledger.self_delta.items()
        if key.startswith(("play_action_card:", "convert_action_card:"))
    )
    if bought:
        net = (ledger.self_delta["buy_action_card"] + spent_value) / bought
        add(
            f"  card immediate proxy: {bought} buys -> {played} plays + {discarded} discards,"
            f" net {net:+.2f} pts per buy"
        )
        add("    includes free asset draws and excludes downstream enabling value; do not rank the channel from it")
    add(f"  passed with actions left: {ledger.passes_with_actions} times")
    add(f"  round-closing commands excluded from the value columns: {ledger.settling_commands}")
    add("  benchmark from constants.py: an action is designed to be worth ~2 points; the two sinks pay ~3.")

    # A competitive action is not described by self gain alone: hurting one opponent improves the
    # actor's margin against the field as well. Averaging the summed rival delta over opponents
    # keeps a table-wide hit and a single-target hit on the same score-margin scale.
    ranked = []
    for key in rows:
        if key.split(":", 1)[0] in investment or key.startswith("sell_asset:"):
            continue
        valued, acts = ledger.valued[key], ledger.actions_spent[key]
        if valued < 10 or not acts:
            continue
        self_per_action = ledger.self_delta[key] / acts
        margin_per_action = (ledger.self_delta[key] - ledger.rival_delta[key] / max(1, config.players - 1)) / acts
        ranked.append((margin_per_action, self_per_action, valued, key))
    add("\n=== ACTION EXTREMES: FIELD-RELATIVE POINTS PER ACTION (n>=10) ===")
    add("  margin = self delta - mean rival delta; investments and free moves excluded")
    for label, candidates in (
        ("strongest", sorted(ranked, reverse=True)[:8]),
        ("weakest", sorted(ranked)[:8]),
    ):
        add(f"  -- {label} --")
        for margin, self_value, valued, key in candidates:
            add(f"  {key:<34} margin/act={margin:>6.2f}  self/act={self_value:>6.2f}  n={valued}")

    # ---------------------------------------------------------------- objects
    add("\n=== OBJECTS: what one purchase realised ===")
    add(
        "  net/buy  = immediate purchase delta + later income + sale delta, per purchase.\n"
        "  net/$    = the same divided by the paid price. It includes purchase bonuses and handles\n"
        "             sold objects, but not causal project/grey value.\n"
        "  net/slotR= the same divided by the rounds it occupied a slot — return on the capped\n"
        "             resource. Read it next to `rnd`: an object bought in round 13 looks efficient\n"
        "             per slot-round precisely because it never had the chance to earn more."
    )
    add(
        f"  {'object':<22}{'$':>4}{'offer':>7}{'buy':>6}{'sold':>6}{'pick%':>7}{'rnd':>5}{'slotR':>7}"
        f"{'inc':>7}{'syn':>6}{'proj':>6}{'grey':>6}{'net/buy':>9}{'net/$':>7}{'net/slotR':>11}"
        f"{'naive%':>8}{'+/-':>6}"
    )
    for card, asset in sorted(catalog.assets.items(), key=lambda item: -ledger.obj_bought[item[0]]):
        offers_n = ledger.obj_offers[card]
        bought = ledger.obj_bought[card]
        if not bought:
            continue
        income_total = ledger.obj_printed_income[card] + ledger.obj_synergy_income[card]
        slot_rounds = ledger.obj_slot_rounds[card] / bought
        # Immediate buy/sell deltas include the price, printed object points, purchase bonuses and
        # the refund/lost object points on liquidation. Settlement income is the only missing cash
        # flow because round-closing commands are deliberately excluded from immediate deltas.
        points = (
            ledger.self_delta[f"buy_asset:{card}"]
            + ledger.self_delta[f"sell_asset:{card}"]
            + income_total / MONEY_PER_POINT
        ) / bought
        owner_games = ledger.obj_owner_games[card]
        naive = 100 * ledger.obj_owner_wins[card] / owner_games if owner_games else 0
        add(
            f"  {card:<22}{asset.cost:>4}{offers_n:>7}{bought:>6}{ledger.obj_sold[card]:>6}"
            f"{100 * bought / offers_n if offers_n else 0:>7.1f}"
            f"{ledger.obj_round[card] / bought:>5.1f}{slot_rounds:>7.1f}"
            f"{ledger.obj_printed_income[card] / bought:>7.1f}"
            f"{ledger.obj_synergy_income[card] / bought:>6.1f}"
            f"{ledger.obj_project_contrib[card] / bought:>6.1f}"
            f"{ledger.obj_grey_unlock[card] / bought:>6.1f}"
            f"{points:>9.2f}{points / asset.cost:>7.2f}{points / slot_rounds if slot_rounds else 0:>11.2f}"
            # The naive number carries its own error bar, because without one it reads as a finding.
            # At a hundred games most of these owner counts are under fifty and the bar is wider
            # than the whole spread of the column.
            f"{naive:>8.1f}{100 * _wilson_half_width(ledger.obj_owner_wins[card], owner_games):>6.0f}"
        )

    add("\n=== CITY PROJECTS ===")
    add(f"  {'project':<26}{'pts':>5}{'cost':>10}{'avail':>7}{'taken':>7}{'pick%':>7}{'self':>8}   e/m/l pick%")
    for pid, project in sorted(catalog.projects.items(), key=lambda item: -ledger.chosen[f"city_project:{item[0]}"]):
        key = f"city_project:{pid}"
        avail, taken, valued = ledger.available[key], ledger.chosen[key], ledger.valued[key]
        if not avail:
            continue
        spread = "/".join(
            f"{100 * ledger.chosen_bucket[(key, b)] / ledger.available_bucket[(key, b)]:.0f}"
            if ledger.available_bucket[(key, b)]
            else "-"
            for b in BUCKETS
        )
        cost = f"{project.cost_influence}/{project.cost_money}$"
        add(
            f"  {pid:<26}{project.points:>5}{cost:>10}{avail:>7}{taken:>7}"
            f"{100 * taken / avail if avail else 0:>7.1f}"
            f"{ledger.self_delta[key] / valued if valued else 0:>8.2f}   {spread}"
        )
    add("\n=== ACTION CARDS ===")
    add(f"  {'card':<24}{'kind':<16}{'avail':>7}{'play':>6}{'pick%':>7}{'self':>8}{'rival':>8}{'selfSD':>8}")
    by_plays = sorted(catalog.action_cards.items(), key=lambda item: -ledger.chosen[f"play_action_card:{item[0]}"])
    for card_id, card in by_plays:
        key = f"play_action_card:{card_id}"
        avail, taken, valued = ledger.available[key], ledger.chosen[key], ledger.valued[key]
        add(
            f"  {card_id:<24}{card.kind:<16}{avail:>7}{taken:>6}"
            f"{100 * taken / avail if avail else 0:>7.1f}"
            f"{ledger.self_delta[key] / valued if valued else 0:>8.2f}"
            f"{ledger.rival_delta[key] / valued if valued else 0:>8.2f}"
            f"{_sample_sd(ledger.self_delta[key], ledger.self_delta_sq[key], valued):>8.2f}"
        )

    # ---------------------------------------------------------------- roles and grey
    add("\n=== ROLES ===")
    add(f"  {'role':<14}{'claims':>8}{'turnsHeld':>11}{'lost':>7}{'powerUses':>11}")
    for role in catalog.roles:
        uses = sum(
            count
            for key, count in ledger.chosen.items()
            if key.startswith("use_role_power:") and key.split(":")[1].startswith(role)
        )
        claims, turns, lost = ledger.role_claims[role], ledger.role_turns[role], ledger.role_lost[role]
        add(f"  {role:<14}{claims:>8}{turns:>11}{lost:>7}{uses:>11}")

    add("\n=== GREY OPERATIONS ===")
    add(f"  {'operation':<20}{'avail':>7}{'run':>6}{'pick%':>7}{'succ%':>7}{'blocked%':>10}{'bonus/run':>11}")
    for operation in engine.GREY_ASSET_IDS:
        key = f"grey_operation:{operation}"
        avail, runs = ledger.available[key], ledger.grey_runs[operation]
        add(
            f"  {operation:<20}{avail:>7}{runs:>6}"
            f"{100 * runs / avail if avail else 0:>7.1f}"
            f"{100 * ledger.grey_success[operation] / runs if runs else 0:>7.1f}"
            f"{100 * ledger.grey_blocked[operation] / runs if runs else 0:>10.1f}"
            f"{ledger.grey_points[operation] / runs if runs else 0:>9.2f}"
        )

    # ---------------------------------------------------------------- dead content
    add("\n=== DEAD CONTENT: legal at least 20 times, never once taken ===")
    dead = sorted(key for key, count in ledger.available.items() if count >= 20 and not ledger.chosen[key])
    add(f"  {len(dead)} decisions classes: " + (", ".join(dead) if dead else "(none)"))
    never = sorted(card for card in catalog.assets if not ledger.obj_offers[card])
    add(f"  objects never offered ({len(never)}): " + (", ".join(never) if never else "(none)"))
    return "\n".join(lines)


def _pearson(pairs: list[tuple[float, float]]) -> float:
    n = len(pairs)
    mean_x = sum(x for x, _ in pairs) / n
    mean_y = sum(y for _, y in pairs) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in pairs)
    var_x = sum((x - mean_x) ** 2 for x, _ in pairs)
    var_y = sum((y - mean_y) ** 2 for _, y in pairs)
    return cov / math.sqrt(var_x * var_y) if var_x and var_y else 0.0


def _sample_sd(total: float, total_sq: float, count: int) -> float:
    if count < 2:
        return 0.0
    variance = max(0.0, (total_sq - total * total / count) / (count - 1))
    return math.sqrt(variance)


def _json_key(key: Any) -> str:
    if isinstance(key, tuple):
        return "|".join(str(part) for part in key)
    return str(key)


def machine_report(ledger: Ledger, config: BalanceConfig) -> dict[str, Any]:
    """Lossless counter dump for stable machine diffs between generated reports."""

    counters = {
        name: {_json_key(key): value for key, value in sorted(counter.items(), key=lambda item: _json_key(item[0]))}
        for name, counter in vars(ledger).items()
        if isinstance(counter, Counter)
    }
    scalars = {name: value for name, value in vars(ledger).items() if not isinstance(value, Counter)}
    return {
        "schema": "city-balance-2",
        "config": {
            "games": config.games,
            "rounds": config.rounds,
            "players": config.players,
            "role_price": config.role_price,
            "bots": list(config.bots),
            "seed": config.seed,
            "epsilon": config.epsilon,
            "policy": config.policy,
            "workers": config.workers,
        },
        "ledger": {**scalars, "counters": counters},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--rounds", type=int, default=15)
    parser.add_argument("--players", type=int, default=4)
    parser.add_argument("--role-price", type=int, default=3)
    parser.add_argument("--bots", default="expert,expert,expert,expert")
    parser.add_argument("--seed", type=int, default=0, help="0 = fresh random seeds every run")
    parser.add_argument(
        "--epsilon",
        type=float,
        default=0.0,
        help="probability of a random legal action instead of the policy's pick; forces coverage of "
        "items the utility function never ranks first",
    )
    parser.add_argument(
        "--policy",
        choices=("reborn", "random", "greedy-myopic"),
        default="reborn",
        help="decision policy; epsilon exploration is applied on top of the selected policy",
    )
    parser.add_argument("--workers", type=int, default=recommended_workers())
    parser.add_argument("--output", help="write the report here as well as to stdout")
    parser.add_argument("--json-output", help="JSON path; defaults beside --output with a .json suffix")
    args = parser.parse_args(argv)

    bots = tuple(normalize_bot_policy(item) for item in args.bots.split(",") if item.strip())[: args.players]
    if len(bots) != args.players:
        parser.error("one bot policy per player is required")
    run_seed = args.seed or random.SystemRandom().randrange(1, 2**32)
    config = BalanceConfig(
        games=args.games,
        rounds=args.rounds,
        players=args.players,
        role_price=args.role_price,
        bots=bots,
        seed=run_seed,
        epsilon=args.epsilon,
        policy=args.policy,
        workers=max(1, args.workers),
    )
    ledger = run_balance(config)
    report = render(ledger, CityEngine(), config)
    print(report)
    if args.output:
        Path(args.output).write_text(report + "\n", encoding="utf-8")
    json_output = args.json_output or (str(Path(args.output).with_suffix(".json")) if args.output else None)
    if json_output:
        Path(json_output).write_text(
            json.dumps(machine_report(ledger, config), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
