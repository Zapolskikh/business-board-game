"""Claude Raider: the aggressive seat, written from the rules alone.

The other strong policies share a family: Atlas plans with Ledger's search, Oracle hands Ledger the
rest of its turn, and the paired forks of the tournament play all three out with Ledger. Boris is the
only independent voice, and Boris never attacks. This policy is the opposite of Boris and reads none
of the others — no search, no shared valuation, no table tuned on their games. What it knows about
the game is what the engine prints: the two sinks (patronage, lobbying), the price of every action,
and the preview of every legal move.

**The plan is rules.** Early, the seat is taken for what it can do to the table, in a fixed order:

* the journalist first — a scandal is a point off a rival and a dollar a round for the role;
* the military when the journalist's seat is gone or the raider is too dirty to take it;
* when every rival stands behind a Защита and the two roles above have nobody to hit, the mafia or
  the fraudster: the racket spends a token, the roof break takes them all.

From ``points_round`` — or from the first legendary object in the raider's own city, or from the
moment a raider who lost its seat finds the whole table roofed and clean — the plan turns to points: rivals' losses count for less, a role is held for its three points, projects and dearer
objects come first, and only the attacks that pay the raider itself keep their place.

**The pick inside the plan is arithmetic, not taste.** Every legal move is priced by what it changes
on the board: the raider's own position, minus the same change for the rivals. Two things keep that
from being spite:

* a rival's loss counts in full only for the *threat* — the player forecast to finish first — and at
  a fraction for the others. At a table of four a hit on a bystander is a gift to the two who were
  not hit;
* a move that takes resources into the raider's own wallet (the racket, the sanction, a hostile
  card) is worth both halves, so it outranks a move that only hurts.

Money and influence are priced at the sinks' own rates, discounted while they are still in the
wallet; nothing is read off a deck, and a grey operation is priced over the six faces of its printed
table, never off the roll the engine would actually make.

Every number that is a judgement rather than a rule lives in ``Tuning``. A tournament can replace the
whole set through the ``RAIDER_TUNING`` environment variable (JSON), which is how the thresholds are
fitted: by measured games, not by hand.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, fields, replace
from typing import Any

from city_engine.constants import (
    HAND_LIMIT,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
)
from city_engine.engine import CityEngine
from city_engine.models import GameState, PlayerState, Transition

RAIDER_ID = "raider"

Legal = list[tuple[dict[str, Any], Transition]]

# What a dollar and a point of influence are worth at their only exits.
MONEY_RATE = PATRONAGE_POINTS / PATRONAGE_MONEY
INFLUENCE_RATE = LOBBYING_POINTS / LOBBYING_INFLUENCE

# The seats the early plan takes, in the order it wants them.
EARLY_SEATS = ("journalist", "military", "mafia", "fraudster")
# Moves that do not spend an action: they are decided before the action is.
FREE_TYPES = frozenset({"sell_asset", "market_refresh", "convert_action_card", "play_action_card"})
FREE_POWERS = frozenset({"journalist_inflate", "politician_veto", "mafia_lock"})
# Never worth a click for this policy: a re-deal reads the deck, the lock trades a Защита for tempo
# on one card.
IGNORED_TYPES = frozenset({"market_refresh", "reroll_projects"})
IGNORED_POWERS = frozenset({"mafia_lock"})


@dataclass(frozen=True, slots=True)
class Tuning:
    # The round the plan turns from pressure to points; a legendary of its own turns it earlier.
    points_round: int = 9
    # A table with nothing left to hit turns the plan early too: from this round on, a raider without
    # a seat who finds every rival behind a Защита and no more than this many scandals between them
    # stops looking for a seat to attack from.
    quiet_round: int = 5
    quiet_scandals: int = 2
    # How much of a rival's loss is the raider's gain, before and after the turn to points.
    aggression_early: float = 1.0
    aggression_late: float = 0.5
    # The share of that counted for a rival who is not the threat.
    bystander: float = 0.25
    # What a resource still in the wallet is worth against the same resource through its sink.
    hold: float = 0.6
    # A wallet deeper than this has nowhere to go — one patronage a turn, six slots — so every dollar
    # above it is worth only this share of a dollar below it.
    wallet: int = 40
    surplus: float = 0.2
    # What one action is worth, in points: the rules' own norm.
    action_value: float = 2.0
    # A Защита in hand, and what it adds when it is also closing a seat to a takeover.
    roof_value: float = 1.5
    seat_roof_value: float = 2.5
    # A card in hand, unseen.
    card_value: float = 1.0
    # An empty slot: the points of the object it will hold, and what that object pays a round.
    slot_points: float = 3.5
    slot_yield: float = 0.8
    # What the powers of a seat are worth a round, beyond the income the role already pays.
    seat_journalist: float = 0.4
    seat_military: float = 0.5
    seat_mafia: float = 0.6
    seat_fraudster: float = 1.5
    seat_politician: float = 0.2
    seat_capitalist: float = 0.2
    # The share of a seat's worth already lost when its holder stands one or two scandals from the limit.
    brink: float = 0.5
    brink_far: float = 0.15
    # The journalist's seat is not taken by a raider dirtier than this.
    journalist_entry_scandals: int = 3
    # A free move has to be worth this much to be made at all.
    free_min: float = 0.3
    # Selling an object for a dearer one has to gain this much.
    upgrade_min: float = 1.5
    # The veto goes on a project worth at least this many points.
    veto_min: int = 6
    # What the campaign is worth on top of its rate while the raider is saving for a seat.
    role_urgency: float = 2.0


def _load_tuning() -> Tuning:
    raw = os.environ.get("RAIDER_TUNING")
    if not raw:
        return Tuning()
    known = {item.name: item.type for item in fields(Tuning)}
    values = {key: value for key, value in json.loads(raw).items() if key in known}
    return replace(Tuning(), **values)


TUNING = _load_tuning()


def choose_raider_command(
    engine: CityEngine,
    state: GameState,
    player_id: str,
    legal: Legal | None = None,
) -> tuple[dict[str, Any], float, list[tuple[str, float]]]:
    legal = engine.legal_transitions(state, player_id) if legal is None else legal
    view = _View(engine, state, state.player_by_id(player_id), TUNING)
    end_turn = next(action for action, _ in legal if action["type"] == "end_turn")

    scored: list[tuple[float, str, dict[str, Any], bool]] = []
    for action, transition in legal:
        value = view.price(action, transition.state)
        if value is not None:
            scored.append((value, _label(action), action, _is_free(action)))
    scored.sort(key=lambda item: (-item[0], item[1]))
    alternatives = [(label, round(value, 2)) for value, label, _action, _free in scored[:5]]

    # Free moves first: they cost nothing, so a good one is never traded against an action.
    special = view.veto(legal) or view.upgrade(legal)
    if special is not None:
        return special, 0.0, alternatives
    for value, _label_, action, free in scored:
        if free and value > view.tuning.free_min:
            return action, value, alternatives
    discard = view.discard(legal)
    if discard is not None:
        return discard, 0.0, alternatives
    for value, _label_, action, free in scored:
        if not free and value > 0:
            return action, value, alternatives
    return end_turn, 0.0, alternatives


def _is_free(action: dict[str, Any]) -> bool:
    if action["type"] in FREE_TYPES:
        return True
    return action["type"] == "use_role_power" and action["payload"].get("power") in FREE_POWERS


def _label(action: dict[str, Any]) -> str:
    payload = action.get("payload") or {}
    detail = ":".join(str(payload[key]) for key in sorted(payload))
    return f"{action['type']}:{detail}" if detail else str(action["type"])


def _signature(player: PlayerState) -> tuple[Any, ...]:
    return (
        player.money,
        player.influence,
        player.scandals,
        player.roofs,
        player.role,
        player.jail_turns,
        len(player.assets),
        len(player.projects),
        player.bonus_points,
        player.capacity,
        player.debt,
        len(player.hand),
        player.marked_card_id,
    )


class _View:
    """One decision: the board as it stands, priced once, and every legal move priced against it."""

    def __init__(self, engine: CityEngine, state: GameState, me: PlayerState, tuning: Tuning) -> None:
        self.engine = engine
        self.state = state
        self.me = me
        self.tuning = tuning
        # Settlements still to be paid: the one that closes the last round pays nothing.
        self.rounds_left = max(0, state.max_rounds - state.round_number)
        self.held = tuning.hold if self.rounds_left >= 2 else tuning.hold / 2 if self.rounds_left == 1 else 0.0
        self.rivals = [player for player in state.players if player.id != me.id]
        quiet = (
            me.role is None
            and state.round_number >= tuning.quiet_round
            and all(rival.roofs > 0 for rival in self.rivals)
            and sum(rival.scandals for rival in self.rivals) <= tuning.quiet_scandals
        )
        self.late = (
            state.round_number >= tuning.points_round
            or quiet
            or any(engine.owned_definition(asset).rarity == "legendary" for asset in me.assets)
        )
        self.threat = max(self.rivals, key=lambda rival: (self._forecast(rival), rival.id))
        aggression = tuning.aggression_late if self.late else tuning.aggression_early
        self.weight = {
            rival.id: aggression * (1.0 if rival.id == self.threat.id else tuning.bystander) for rival in self.rivals
        }
        self.before = {player.id: self._worth(state, player) for player in state.players}
        self.signatures = {player.id: _signature(player) for player in state.players}
        self.wanted_seat = None if self.late else self._wanted_seat()
        self.saving_for_seat = (
            self.wanted_seat is not None and me.role != self.wanted_seat and me.influence < state.role_price
        )

    # --- what a position is worth -----------------------------------------------------------------

    def _forecast(self, player: PlayerState) -> float:
        """Where the player is heading: the score, the wallet at the sinks' rates, the income to come."""
        money, influence = self.engine._round_rates(self.state, player)
        return (
            self.engine.score(player)
            + MONEY_RATE * player.money
            + INFLUENCE_RATE * player.influence
            + self.rounds_left * (MONEY_RATE * money + INFLUENCE_RATE * influence)
        )

    def _seat(self, role: str | None) -> float:
        return float(getattr(self.tuning, f"seat_{role}", 0.0)) * self.rounds_left if role else 0.0

    def _worth(self, state: GameState, player: PlayerState) -> float:
        tuning, engine = self.tuning, self.engine
        income, rating = engine._round_rates(state, player)
        worth = float(engine.score(player))
        money = player.money - player.debt
        useful = min(money, tuning.wallet) + tuning.surplus * max(0, money - tuning.wallet)
        worth += self.held * (MONEY_RATE * useful + INFLUENCE_RATE * player.influence)
        worth += self.rounds_left * self.held * (MONEY_RATE * income + INFLUENCE_RATE * rating)
        worth += self._seat(player.role)
        worth += min(1, engine.effect_total(player, "extraActions")) * tuning.action_value * self.rounds_left
        if self.rounds_left:
            worth += player.roofs * (tuning.roof_value + (tuning.seat_roof_value if player.role else 0.0))
            worth += len(player.hand) * tuning.card_value
        # One empty slot is worth an object; a second one is worth nothing until the first is filled.
        usable = min(player.capacity, len(player.assets) + 1)
        worth += usable * (tuning.slot_points + tuning.slot_yield * self.rounds_left)
        if player.role:
            gap = engine.scandal_limit(player) - player.scandals
            stake = 3 + self._seat(player.role)
            worth -= stake * (tuning.brink if gap <= 1 else tuning.brink_far if gap == 2 else 0.0)
        worth -= player.jail_turns * 3 * tuning.action_value
        return worth

    def _swing(self, after: GameState) -> float:
        """The raider's gain plus the rivals' loss, each rival at their own weight."""
        me = after.player_by_id(self.me.id)
        swing = self._worth(after, me) - self.before[self.me.id]
        dirtier = me.scandals != self.me.scandals
        for rival in self.rivals:
            now = after.player_by_id(rival.id)
            # A journalist earns off everybody else's scandals, so the raider's own counter moves them.
            if _signature(now) == self.signatures[rival.id] and not (dirtier and rival.role == "journalist"):
                continue
            swing -= self.weight[rival.id] * (self._worth(after, now) - self.before[rival.id])
        return swing

    # --- the plan ---------------------------------------------------------------------------------

    def _open(self, rival: PlayerState) -> bool:
        return rival.roofs == 0

    def _stalled(self, role: str) -> bool:
        """Does this seat have nobody to hit right now?"""
        if role == "journalist":
            return not any(self._open(rival) for rival in self.rivals)
        if role == "military":
            # A journalist at the table keeps the sanction supplied with dirty rivals.
            if any(rival.role == "journalist" for rival in self.rivals):
                return False
            inspected = set(self.engine.inspection_targets(self.state, self.me))
            return not any(self._open(rival) and (rival.scandals >= 2 or rival.id in inspected) for rival in self.rivals)
        return False

    def _wanted_seat(self) -> str | None:
        """The seat the early plan is playing for: the one it holds while it works, or the next one down."""
        me = self.me
        if me.role in EARLY_SEATS and not self._stalled(str(me.role)):
            return me.role
        for role in EARLY_SEATS:
            if role == me.role or self.engine.role_holder(self.state, role) is not None:
                continue
            if self._stalled(role):
                continue
            if role == "journalist" and me.scandals > self.tuning.journalist_entry_scandals:
                continue
            return role
        return me.role if me.role in EARLY_SEATS else None

    # --- pricing one move -------------------------------------------------------------------------

    def price(self, action: dict[str, Any], after: GameState) -> float | None:
        """Points this move is worth, or ``None`` for a move the plan does not consider."""
        kind = str(action["type"])
        payload = action.get("payload") or {}
        power = payload.get("power")
        if kind in IGNORED_TYPES or power in IGNORED_POWERS or kind in {"end_turn", "sell_asset"}:
            return None
        if kind == "convert_action_card" or power == "politician_veto":
            return None
        if kind == "claim_role" and not self._claim_allowed(str(payload.get("role_id"))):
            return None
        if kind == "play_action_card" and payload.get("target_id") == self.me.id:
            return None
        if kind == "grey_operation":
            return self._grey(payload)

        if kind == "play_action_card" and self.engine.action_card(self._held_card(payload)).kind == "grey_roll":
            return self._bribe()
        me_after = after.player_by_id(self.me.id)
        if self.saving_for_seat and kind != "claim_role" and me_after.influence < self.me.influence:
            return None
        value = self._swing(after)
        same_turn = after.turn_serial == self.state.turn_serial and after.status == "playing"
        if not same_turn and after.status == "playing":
            # The move ended the turn by itself — an arrest. Whatever was left of it burned.
            value -= max(0, self.state.actions_left - 1) * self.tuning.action_value
        if kind == "play_action_card":
            if same_turn:
                value += (after.actions_left - self.state.actions_left) * self.tuning.action_value
        if kind == "basic_action" and payload.get("kind") == "campaign" and self.saving_for_seat:
            value += self.tuning.role_urgency
        return value

    def _claim_allowed(self, role: str) -> bool:
        if self.late:
            # A seat is three points and its income; the plan no longer trades one for another.
            return self.me.role is None
        return role == self.wanted_seat

    def _held_card(self, payload: dict[str, Any]) -> str:
        return next(card.card_id for card in self.me.hand if card.uid == payload.get("card_uid"))

    def _grey_options(self) -> list[dict[str, Any]]:
        engine, state, me = self.engine, self.state, self.me
        if state.actions_left < 1 or engine._flag(state, "grey_operation_used"):
            return []
        options: list[dict[str, Any]] = []
        for asset_id in engine.GREY_ASSET_IDS:
            if not engine.grey_operation_unlocked(me, asset_id):
                continue
            if asset_id in engine.GREY_TARGETED_IDS:
                options += [
                    {"asset_id": asset_id, "target_id": rival.id}
                    for rival in self.rivals
                    if asset_id != "influence_broker" or rival.role is not None
                ]
            elif asset_id != "roof_break" or any(rival.roofs for rival in self.rivals):
                options.append({"asset_id": asset_id})
        return options

    def _grey(self, payload: dict[str, Any], bonus: int = 0) -> float:
        """A grey operation over the six faces of its own table — never off the engine's next roll."""
        engine, state = self.engine, self.state
        asset_id = str(payload["asset_id"])
        table = engine.grey_table(state, self.me, asset_id)
        total = 0.0
        for row in table["rows"]:
            face = min(6, int(row["face"]) + bonus)
            trial = state.clone()
            me = trial.player_by_id(self.me.id)
            target = trial.player_by_id(str(payload["target_id"])) if payload.get("target_id") else None
            if engine.grey_tier(face) != "fail":
                engine._resolve_grey_effect(trial, me, target, asset_id, face)
            engine.add_scandal(trial, me, engine.grey_scandals(me, asset_id, face))
            value = self._swing(trial)
            if me.jail_turns:
                value -= max(0, state.actions_left - 1) * self.tuning.action_value
            total += value
        return total / len(table["rows"])

    def _bribe(self) -> float | None:
        """«Подкуп охраны» is worth what it adds to the best operation it would be spent on."""
        options = self._grey_options()
        if not options:
            return None
        bonus = int(self.engine.action_card("guard_bribe").value)
        boosted, option = max(((self._grey(option, bonus), _label({"type": "grey", "payload": option}), option) for option in options))[::2]
        if boosted <= 0:
            return None
        return boosted - self._grey(option) - self.tuning.card_value

    # --- the moves that are a rule, not a price ---------------------------------------------------

    def veto(self, legal: Legal) -> dict[str, Any] | None:
        """Close the best project the threat could take this round."""
        offered = {
            str(action["payload"]["project_id"]): action
            for action, _ in legal
            if action["type"] == "use_role_power" and action["payload"].get("power") == "politician_veto"
        }
        if not offered or self.me.id in self.state.project_veto.values():
            return None
        engine, threat = self.engine, self.threat
        best: tuple[int, str] | None = None
        for project_id in offered:
            project = engine.project(project_id)
            influence, money = engine.project_cost(threat, project)
            if project.points < self.tuning.veto_min or self.state.project_veto.get(project_id):
                continue
            if threat.influence < influence or threat.money < money:
                continue
            if engine.project_requirement_met(threat, project) and (best is None or (project.points, project_id) > best):
                best = (project.points, project_id)
        return offered[best[1]] if best else None

    def upgrade(self, legal: Legal) -> dict[str, Any] | None:
        """Sell the object a dearer one should replace. The purchase is the next move's business."""
        engine, state, me = self.engine, self.state, self.me
        if state.actions_left < 1 or not me.assets or len(me.assets) < me.capacity:
            return None
        if any(action["type"] == "buy_capacity" for action, _ in legal) and self.rounds_left >= 3:
            return None
        sales = {str(action["payload"]["asset_uid"]): action for action, _ in legal if action["type"] == "sell_asset"}
        best: tuple[float, str] | None = None
        for owned in me.assets:
            definition = engine.owned_definition(owned)
            # The grey shelf is what the operations run out of: the last object of it stays.
            if definition.district == "shadows" and not self.late and engine.district_count(me, "shadows") <= 1:
                continue
            refund = engine.asset_refund(owned)
            paid = engine.owned_yield(state, me, owned)
            for item in state.market:
                if engine.market_locked_for(state, item, me):
                    continue
                price = engine.asset_price(state, me, item.card_id)
                if price > me.money + refund:
                    continue
                pays = engine.purchase_yield(state, me, item.uid)
                gain = engine.asset_value_of(item.card_id) - engine.asset_value(owned)
                gain += self.rounds_left * self.held * (
                    MONEY_RATE * (pays["money"] - paid["money"]) + INFLUENCE_RATE * (pays["influence"] - paid["influence"])
                )
                gain -= self.held * MONEY_RATE * (price - refund)
                if gain > self.tuning.upgrade_min and (best is None or (gain, owned.uid) > best):
                    best = (gain, owned.uid)
        return sales.get(best[1]) if best else None

    def discard(self, legal: Legal) -> dict[str, Any] | None:
        """A full hand of cards nobody plays blocks the next draw: the oldest goes for influence."""
        if len(self.me.hand) < HAND_LIMIT or not self.rounds_left:
            return None
        oldest = self.me.hand[0].uid
        return next(
            (
                action
                for action, _ in legal
                if action["type"] == "convert_action_card"
                and action["payload"].get("card_uid") == oldest
                and action["payload"].get("into") == "influence"
            ),
            None,
        )
