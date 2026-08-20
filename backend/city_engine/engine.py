"""Authoritative state transitions for City of Influence.

This first vertical slice owns the turn clock, economy, asset market, basic
actions and role acquisition. Remaining action-card and role powers are added
as dispatch handlers here, never in FastAPI or React.
"""

from __future__ import annotations

from math import ceil, floor
from typing import Any

from city_engine.commands import Command
from city_engine.constants import (
    ACTION_CARD_COST,
    AUTOMATION_COST,
    CAMPAIGN_TIERS,
    CAPACITY_COSTS,
    CARD_DISCARD_VALUE,
    CASH_TO_INFLUENCE_MONEY,
    COMPROMAT_CHANCE,
    COMPROMAT_INFLUENCE,
    CRISIS_PR_INFLUENCE,
    DISTRICT_IDS,
    HACK_INFLUENCE_STEAL,
    INFLUENCE_PER_POINT,
    JOURNALIST_SCANDAL_LIMIT,
    LAUNDERING_BASE_COST,
    LAUNDERING_BASE_GAIN,
    MAINTENANCE_PER_ASSET,
    MARKET_ASSET_ROUNDS,
    MARKET_REROLL_COST,
    MAX_CAPACITY,
    MAX_REPEATABLE_PROJECTS,
    MONEY_PER_POINT,
    PROJECT_BOARD_SIZE,
    PROJECT_REROLL_MONEY,
    ROLE_IDS,
)
from city_engine.content import (
    ActionCardDefinition,
    AssetDefinition,
    ContentCatalog,
    ProjectDefinition,
    asset_points,
    load_catalog,
)
from city_engine.errors import CityEngineError, IllegalActionError, InvalidCommandError, StaleRevisionError
from city_engine.models import (
    GameState,
    HeldCard,
    MarketAsset,
    OwnedAsset,
    PlayerState,
    Transition,
)
from city_engine.rng import GameRNG


class CityEngine:
    def __init__(self, catalog: ContentCatalog | None = None) -> None:
        self.catalog = catalog or load_catalog()
        self._handlers = {
            "basic_action": self._basic_action,
            "city_project": self._city_project,
            "buy_capacity": self._buy_capacity,
            "buy_roof": self._buy_roof,
            "buy_asset": self._buy_asset,
            "reroll_market": self._reroll_market,
            "reroll_projects": self._reroll_projects,
            "buy_automation": self._buy_automation,
            "move_automation": self._move_automation,
            "sell_asset": self._sell_asset,
            "develop_district": self._develop_district,
            "crisis_pr": self._crisis_pr,
            "buy_action_card": self._buy_action_card,
            "convert_action_card": self._convert_action_card,
            "play_action_card": self._play_action_card,
            "use_role_power": self._use_role_power,
            "grey_operation": self._grey_operation,
            "claim_role": self._claim_role,
            "end_turn": self._end_turn,
        }

    def apply(self, state: GameState, command: Command) -> Transition:
        state.validate()
        if command.expected_revision is not None and command.expected_revision != state.revision:
            raise StaleRevisionError(
                f"expected revision {command.expected_revision}, current revision is {state.revision}"
            )
        if command.command_id and command.command_id in state.processed_command_ids:
            return Transition(state=state.clone(), events=[])
        if state.status != "playing":
            raise IllegalActionError("the game is already finished")
        if command.actor_id != state.current_player.id:
            raise IllegalActionError("only the current player may act")
        handler = self._handlers.get(command.type)
        if handler is None:
            raise InvalidCommandError(f"unsupported command: {command.type}")

        next_state = state.clone()
        event_start = len(next_state.event_log)
        handler(next_state, command)
        self._enforce_jail_interrupt(next_state, command)
        next_state.command_log.append(command.to_dict())
        next_state.revision += 1
        if command.command_id:
            next_state.processed_command_ids.append(command.command_id)
            next_state.processed_command_ids = next_state.processed_command_ids[-100:]
        next_state.validate()
        return Transition(state=next_state, events=next_state.event_log[event_start:])

    def legal_actions(self, state: GameState, actor_id: str) -> list[dict[str, Any]]:
        return [action for action, _transition in self.legal_transitions(state, actor_id)]

    def legal_transitions(
        self,
        state: GameState,
        actor_id: str,
    ) -> list[tuple[dict[str, Any], Transition]]:
        if state.status != "playing":
            return []
        if actor_id != state.current_player.id:
            return []
        candidates = self._candidate_commands(state, actor_id)

        actions: list[tuple[dict[str, Any], Transition]] = []
        for candidate in candidates:
            try:
                transition = self.apply(state, candidate)
            except CityEngineError:
                continue
            actions.append(
                (
                    {"type": candidate.type, "payload": dict(candidate.payload)},
                    transition,
                )
            )
        return actions

    def _candidate_commands(self, state: GameState, actor_id: str) -> list[Command]:
        player = state.current_player
        can_act = state.actions_left > 0
        can_invest = can_act or state.investment_actions > 0
        candidates = [Command(type="end_turn", actor_id=actor_id)]
        if can_act:
            candidates.append(Command(type="basic_action", actor_id=actor_id, payload={"kind": "work"}))
            # One action, three exchange rates: the tier is the decision, not whether to campaign.
            candidates.extend(
                Command(type="basic_action", actor_id=actor_id, payload={"kind": "campaign", "spend": spend})
                for spend in CAMPAIGN_TIERS
                if player.money >= spend
            )
            candidates.extend(
                Command(type="city_project", actor_id=actor_id, payload={"project_id": project_id})
                for project_id in [*state.project_board, *self.catalog.repeatable_project_ids()]
            )
            if player.roofs < self.roof_limit(player) and player.money >= self.roof_price(state, player):
                candidates.append(Command(type="buy_roof", actor_id=actor_id))
            if player.influence >= CRISIS_PR_INFLUENCE and player.scandals > 0:
                candidates.append(Command(type="crisis_pr", actor_id=actor_id))
            if player.scandals < self.scandal_limit(player):
                candidates.extend(
                    Command(type="claim_role", actor_id=actor_id, payload={"role_id": role_id})
                    for role_id in ROLE_IDS
                    if self.role_holder(state, role_id) is not player
                    and player.influence
                    >= (state.role_price * 3 if self.role_holder(state, role_id) else state.role_price)
                )
        if can_invest:
            if player.capacity < MAX_CAPACITY and player.money >= CAPACITY_COSTS.get(player.capacity, 10**9):
                candidates.append(Command(type="buy_capacity", actor_id=actor_id))
            if not player.automation_owned and player.money >= AUTOMATION_COST:
                candidates.extend(
                    Command(type="buy_automation", actor_id=actor_id, payload={"asset_uid": owned.uid})
                    for owned in player.assets
                )
                if not player.assets:
                    candidates.append(Command(type="buy_automation", actor_id=actor_id))
            if len(player.assets) < player.capacity:
                candidates.extend(
                    Command(
                        type="buy_asset",
                        actor_id=actor_id,
                        payload={"market_uid": market_asset.uid},
                    )
                    for market_asset in state.market
                    if player.money >= self.asset_price(state, player, market_asset.card_id)
                )
        for owned in player.assets:
            # Moving the token costs nothing, so it stays available with an empty action counter.
            if player.automation_owned and player.automation_uid != owned.uid:
                candidates.append(Command(type="move_automation", actor_id=actor_id, payload={"asset_uid": owned.uid}))
            # Selling costs no action, so it stays available with an empty counter — see _sell_asset.
            candidates.append(Command(type="sell_asset", actor_id=actor_id, payload={"asset_uid": owned.uid}))
        if can_act:
            candidates.extend(
                Command(type="develop_district", actor_id=actor_id, payload={"district": district})
                for district in DISTRICT_IDS
                if self.district_count(player, district) >= 2 and player.district_levels[district] < 2
            )
        # The market reroll costs money only, so it stays available with no actions left.
        if player.money >= MARKET_REROLL_COST:
            candidates.append(Command(type="reroll_market", actor_id=actor_id))
        # The project re-deal spends an action now, so unlike the market reroll it disappears once
        # the turn is out of actions.
        if can_act and player.money >= PROJECT_REROLL_MONEY and state.project_deck:
            candidates.append(Command(type="reroll_projects", actor_id=actor_id))
        if can_act and player.money >= ACTION_CARD_COST and player.influence >= 1 and len(player.hand) < 3:
            candidates.append(Command(type="buy_action_card", actor_id=actor_id))
        for held in player.hand:
            if not self._flag(state, "card_converted"):
                candidates.extend(
                    Command(
                        type="convert_action_card",
                        actor_id=actor_id,
                        payload={"card_uid": held.uid, "into": into},
                    )
                    for into in ("money", "influence")
                )
            card = self.action_card(held.card_id)
            if card.targeted:
                candidates.extend(
                    Command(
                        type="play_action_card",
                        actor_id=actor_id,
                        payload={"card_uid": held.uid, "target_id": target.id},
                    )
                    for target in state.players
                    if target.id != actor_id
                )
            elif card.kind in {"district_cash", "zoning", "develop"}:
                candidates.extend(
                    Command(
                        type="play_action_card",
                        actor_id=actor_id,
                        payload={"card_uid": held.uid, "district": district},
                    )
                    for district in DISTRICT_IDS
                )
            elif card.kind == "copy_role":
                candidates.extend(
                    Command(
                        type="play_action_card",
                        actor_id=actor_id,
                        payload={"card_uid": held.uid, "role_id": role_id},
                    )
                    for role_id in ROLE_IDS
                )
            elif card.kind == "project":
                candidates.extend(
                    Command(
                        type="play_action_card",
                        actor_id=actor_id,
                        payload={"card_uid": held.uid, "project_id": project_id},
                    )
                    for project_id in state.project_board
                )
            elif card.kind == "automation":
                candidates.extend(
                    Command(
                        type="play_action_card",
                        actor_id=actor_id,
                        payload={"card_uid": held.uid, "asset_uid": owned.uid},
                    )
                    for owned in player.assets
                )
                if not player.assets:
                    candidates.append(
                        Command(type="play_action_card", actor_id=actor_id, payload={"card_uid": held.uid})
                    )
            else:
                candidates.append(Command(type="play_action_card", actor_id=actor_id, payload={"card_uid": held.uid}))
        candidates.extend(self._role_power_candidates(state, actor_id))
        active_asset_ids = {asset.card_id for asset in player.assets if not asset.blocked}
        # Insuring a failure spends a roof, so without one the flag silently did nothing.
        protect_options = (False, True) if player.roofs > 0 else (False,)
        for asset_id in ("cash", "crypto"):
            if not can_act or asset_id not in active_asset_ids:
                continue
            candidates.extend(
                Command(
                    type="grey_operation",
                    actor_id=actor_id,
                    payload={"asset_id": asset_id, "protect_failure": protect},
                )
                for protect in protect_options
            )
        for asset_id in ("market", "datacenter", "influence_broker"):
            if not can_act or asset_id not in active_asset_ids:
                continue
            for target in state.players:
                if target.id == actor_id:
                    continue
                candidates.extend(
                    Command(
                        type="grey_operation",
                        actor_id=actor_id,
                        payload={
                            "asset_id": asset_id,
                            "target_id": target.id,
                            "protect_failure": protect,
                        },
                    )
                    for protect in protect_options
                )
        return candidates

    def _role_power_candidates(self, state: GameState, actor_id: str) -> list[Command]:
        player = state.current_player
        candidates: list[Command] = []
        if self.has_role(player, "capitalist"):
            candidates.append(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "capitalist_financing"},
                )
            )
        if self.has_role(player, "politician"):
            candidates.append(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "politician_cleanup"},
                )
            )
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "politician_tax", "district": district},
                )
                for district in DISTRICT_IDS
            )
        if self.has_role(player, "journalist"):
            for target in state.players:
                if target.id == actor_id:
                    continue
                candidates.extend(
                    Command(
                        type="use_role_power",
                        actor_id=actor_id,
                        payload={"power": power, "target_id": target.id},
                    )
                    for power in ("journalist_inflate", "journalist_publish")
                )
        if self.has_role(player, "mafia"):
            candidates.append(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "mafia_sweep"},
                )
            )
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "mafia_cleanup", "method": method},
                )
                for method in ("roof", "money")
            )
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "mafia_racket", "target_id": target.id},
                )
                for target in state.players
                if target.id != actor_id
            )
        if self.has_role(player, "military"):
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "military_sanction", "target_id": target.id},
                )
                for target in state.players
                if target.id != actor_id and target.scandals >= 2
            )
        if self.has_role(player, "fraudster"):
            candidates.append(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "fraudster_cleanup"},
                )
            )
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "fraudster_crypto_scam", "amount": amount},
                )
                for amount in range(1, 7)
            )
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "fraudster_forge", "role_id": role_id},
                )
                for role_id in ROLE_IDS
            )
        return candidates

    @staticmethod
    def has_role(player: PlayerState, role_id: str) -> bool:
        return player.role == role_id or player.copied_role == role_id

    @staticmethod
    def role_holder(state: GameState, role_id: str) -> PlayerState | None:
        return next((player for player in state.players if player.role == role_id), None)

    def asset(self, card_id: str) -> AssetDefinition:
        try:
            return self.catalog.assets[card_id]
        except KeyError as exc:
            raise InvalidCommandError(f"unknown asset: {card_id}") from exc

    def owned_definition(self, owned: OwnedAsset) -> AssetDefinition:
        return self.asset(owned.card_id)

    def action_card(self, card_id: str) -> ActionCardDefinition:
        try:
            return self.catalog.action_cards[card_id]
        except KeyError as exc:
            raise InvalidCommandError(f"unknown action card: {card_id}") from exc

    def project(self, project_id: str) -> ProjectDefinition:
        try:
            return self.catalog.projects[project_id]
        except KeyError as exc:
            raise InvalidCommandError(f"unknown city project: {project_id}") from exc

    def project_requirement_met(self, player: PlayerState, project: ProjectDefinition) -> bool:
        """Every condition is a count of things already on the table, so a player can read it."""
        requirement = project.requirement
        kind = str(requirement.get("type", "none"))
        needed = int(requirement.get("count", 1))
        if kind == "none":
            return True
        if kind == "assets":
            return len(player.assets) >= needed
        if kind == "automation":
            return player.automation_owned
        if kind == "role":
            role_id = requirement.get("role")
            return self.has_role(player, str(role_id)) if role_id else player.role is not None
        if kind == "max_scandals":
            return player.scandals <= needed
        if kind == "district_objects":
            return self.district_count(player, str(requirement["district"])) >= needed
        if kind == "district_depth":
            return max(self.district_count(player, district) for district in DISTRICT_IDS) >= needed
        if kind == "distinct_districts":
            return sum(self.district_count(player, district) > 0 for district in DISTRICT_IDS) >= needed
        if kind == "tag_objects":
            tag = str(requirement["tag"])
            return sum(tag in self.owned_definition(asset).tags for asset in player.assets) >= needed
        raise InvalidCommandError(f"unknown project requirement: {kind}")

    def project_requirement_progress(self, player: PlayerState, project: ProjectDefinition) -> float:
        """How far along a condition is, from 0.0 to 1.0 — the partial credit ``met`` cannot give.

        A bot scoring only the moment a condition flips to met can never climb a three-step one:
        the first two objects are worth exactly zero, so multi-step projects only ever complete by
        accident. Conditions that cannot be approached gradually (a role, the automation token,
        a scandal ceiling) stay binary, which is honest — there is no half of owning a token.
        """
        requirement = project.requirement
        kind = str(requirement.get("type", "none"))
        needed = max(1, int(requirement.get("count", 1)))
        if kind in {"none", "automation", "role", "max_scandals"}:
            return 1.0 if self.project_requirement_met(player, project) else 0.0
        if kind == "assets":
            have = len(player.assets)
        elif kind == "district_objects":
            have = self.district_count(player, str(requirement["district"]))
        elif kind == "district_depth":
            have = max(self.district_count(player, district) for district in DISTRICT_IDS)
        elif kind == "distinct_districts":
            have = sum(self.district_count(player, district) > 0 for district in DISTRICT_IDS)
        elif kind == "tag_objects":
            tag = str(requirement["tag"])
            have = sum(tag in self.owned_definition(asset).tags for asset in player.assets)
        else:
            raise InvalidCommandError(f"unknown project requirement: {kind}")
        return min(1.0, have / needed)

    def asset_value(self, owned: OwnedAsset) -> int:
        return self.asset_value_of(owned.card_id)

    def asset_value_of(self, card_id: str) -> int:
        """Points an object is worth: half its price, via ``content.asset_points``.

        A flat rarity ladder was tried here and measured worse — it cut what a dollar buys in
        points, so objects stopped soaking up income and the bots ended games sitting on 500$.
        Objects are the main money sink and have to stay one; the late replacement arbitrage is
        a separate problem and needs a fix that does not also break the sink.
        """
        return asset_points(self.asset(card_id).cost)

    def asset_refund(self, owned: OwnedAsset) -> int:
        """What selling or replacing an object pays back, in money — the same half price."""
        return asset_points(self.owned_definition(owned).cost)

    def is_automated(self, player: PlayerState, owned: OwnedAsset) -> bool:
        """Whether the player's single automation token is currently working on this object."""
        return player.automation_uid == owned.uid and not player.automation_disabled

    def automated_asset(self, player: PlayerState) -> OwnedAsset | None:
        return next((asset for asset in player.assets if asset.uid == player.automation_uid), None)

    def automation_preview(self, state: GameState, player: PlayerState) -> dict[str, int]:
        """Round income for every possible home of the token, so the client shows the delta.

        Moving the token is free and repeatable, which only reads as a decision if the payoff of
        each option is on screen. Computed server-side for the same reason market prices are.

        Also computed before the token is bought: 6$ with no visible payoff is not a decision
        either, so the client can price the purchase against the same numbers as a move.
        """
        original = player.automation_uid
        preview: dict[str, int] = {}
        for asset in player.assets:
            player.automation_uid = asset.uid
            preview[asset.uid] = self._round_income(state, player)
        player.automation_uid = original
        return preview

    def automation_baseline(self, state: GameState, player: PlayerState) -> int:
        """Round income with the token parked, so the client can state what it is actually worth.

        Without it every figure on screen is an absolute and the player has to subtract two
        numbers to answer "what does this token give me", which is the only question they have.
        """
        original = player.automation_uid
        player.automation_uid = None
        baseline = self._round_income(state, player)
        player.automation_uid = original
        return baseline

    @staticmethod
    def _flag(state: GameState, key: str) -> bool:
        return bool(state.turn_flags.get(key, False))

    @staticmethod
    def _mark_flag(state: GameState, key: str) -> None:
        state.turn_flags[key] = True

    @staticmethod
    def _payload_string(command: Command, key: str) -> str:
        value = command.payload.get(key)
        if not isinstance(value, str) or not value:
            raise InvalidCommandError(f"{key} is required")
        return value

    def _target_player(self, state: GameState, actor: PlayerState, target_id: str) -> PlayerState:
        try:
            target = state.player_by_id(target_id)
        except KeyError as exc:
            raise InvalidCommandError(f"unknown target player: {target_id}") from exc
        if target.id == actor.id:
            raise IllegalActionError("the player cannot target themselves")
        return target

    def district_count(self, player: PlayerState, district: str) -> int:
        count = sum(self.owned_definition(asset).district == district for asset in player.assets)
        return count + int(player.zoning_district == district)

    def effect_total(self, player: PlayerState, key: str) -> int:
        """Passive bonuses from objects and from completed projects share one vocabulary.

        A project perk cannot be blocked or confiscated, which is exactly why perks are the
        reward for a finished project rather than another income line.
        """
        assets = sum(
            int(self.owned_definition(asset).effects.get(key, 0)) for asset in player.assets if not asset.blocked
        )
        perks = sum(self.project(project_id).perk.get(key, 0) for project_id in player.projects)
        return assets + perks

    def roof_limit(self, player: PlayerState) -> int:
        return (2 if self.has_role(player, "mafia") else 1) + self.effect_total(player, "roofCapacity")

    @staticmethod
    def _round_scaled(state: GameState, base: int) -> int:
        """A money amount printed on a card, grown by the round it is played in.

        Every other money figure in the game already scales — the roof price, laundering, the racket,
        the pump and dump — because a dollar buys ten times less by the endgame. The card texts that
        did not scale were worth a tenth of a point in round twelve, i.e. less than discarding the
        card for influence, which is exactly how they were used across two measured matches.
        """
        return base + state.round_number

    def roof_price(self, state: GameState, player: PlayerState) -> int:
        """Roof cost grows with the round: a flat 3$ blanked late attacks worth ten times that."""
        base = 3 + floor((state.round_number - 1) / 2)
        return base - 1 if self.has_role(player, "mafia") else base

    def market_prices(self, state: GameState, player: PlayerState) -> dict[str, int]:
        """Viewer-specific market prices, so clients never re-implement ``asset_price``."""
        return {item.uid: self.asset_price(state, player, item.card_id) for item in state.market}

    def asset_price(self, state: GameState, player: PlayerState, card_id: str) -> int:
        asset = self.asset(card_id)
        event = self.catalog.events[state.event_id]
        event_discount = event.global_market_discount
        if event.district == asset.district:
            event_discount += event.market_discount
        role_discount = int(
            self.has_role(player, "capitalist")
            and not any(self.owned_definition(item).district == asset.district for item in player.assets)
        )
        logistics_discount = int(
            asset.district == "industrial" and any(item.card_id == "logistics" for item in player.assets)
        )
        card_discount = int(state.turn_flags.get("market_discount", 0))
        return max(1, asset.cost - event_discount - role_discount - logistics_discount - card_discount)

    def _spend_action(self, state: GameState, *, investment_allowed: bool = False) -> None:
        if investment_allowed and state.investment_actions > 0:
            state.investment_actions -= 1
            return
        if state.actions_left < 1:
            raise IllegalActionError("no actions left")
        state.actions_left -= 1

    def _resource_snapshot(self, state: GameState) -> dict[str, tuple[int, int, int, int]]:
        """Capture money / influence / scandals / roofs for every player."""
        return {player.id: (player.money, player.influence, player.scandals, player.roofs) for player in state.players}

    def _resource_deltas(
        self, state: GameState, before: dict[str, tuple[int, int, int, int]]
    ) -> dict[str, dict[str, int]]:
        """Compute per-player resource changes since ``before`` snapshot (only non-zero)."""
        deltas: dict[str, dict[str, int]] = {}
        for player in state.players:
            base = before.get(player.id, (player.money, player.influence, player.scandals, player.roofs))
            change = {
                "money": player.money - base[0],
                "influence": player.influence - base[1],
                "scandals": player.scandals - base[2],
                "roofs": player.roofs - base[3],
            }
            if any(change.values()):
                deltas[player.id] = change
        return deltas

    def _basic_action(self, state: GameState, command: Command) -> None:
        """The two buttons that turn an action into a resource.

        Campaign takes a tier: the action, not the money, was the real price of influence, so a
        single 2$→2◆ rate capped every player at 2◆ per action no matter how rich they were. The
        rates get worse as the tier grows, so a full wallet buys throughput, never a bargain.
        """
        kind = command.payload.get("kind")
        player = state.current_player
        # Only a campaign has a tier, so `work` must not carry a meaningless `spend=0` into the log.
        tier: dict[str, int] = {}
        if kind == "work":
            self._spend_action(state)
            player.money += 2
        elif kind == "campaign":
            spend = self._campaign_spend(command)
            if player.money < spend:
                raise IllegalActionError(f"this campaign tier requires {spend} money")
            self._spend_action(state)
            player.money -= spend
            player.influence += CAMPAIGN_TIERS[spend]
            tier = {"spend": spend, "gain": CAMPAIGN_TIERS[spend]}
        else:
            raise InvalidCommandError("basic_action kind must be work or campaign")
        state.append_event(
            "basic_action",
            player.id,
            kind=kind,
            money=player.money,
            influence=player.influence,
            **tier,
        )

    @staticmethod
    def _campaign_spend(command: Command) -> int:
        """Which campaign tier was requested; the cheapest one is the default for old clients."""
        raw = command.payload.get("spend", min(CAMPAIGN_TIERS))
        try:
            spend = int(raw)
        except (TypeError, ValueError) as exc:
            raise InvalidCommandError("campaign spend must be an integer") from exc
        if spend not in CAMPAIGN_TIERS:
            allowed = ", ".join(str(tier) for tier in sorted(CAMPAIGN_TIERS))
            raise InvalidCommandError(f"campaign spend must be one of: {allowed}")
        return spend

    def _city_project(self, state: GameState, command: Command) -> None:
        """Projects are a shared board: taking one denies it to everybody else for the whole game."""
        player = state.current_player
        project_id = self._payload_string(command, "project_id")
        project = self.project(project_id)
        if project.repeatable:
            taken = sum(1 for item in player.projects if self.project(item).repeatable)
            if taken >= MAX_REPEATABLE_PROJECTS:
                raise IllegalActionError(f"initiatives are limited to {MAX_REPEATABLE_PROJECTS} per game")
        elif project_id not in state.project_board:
            raise IllegalActionError("this project is not on the city board")
        if player.influence < project.cost_influence or player.money < project.cost_money:
            raise IllegalActionError("not enough resources for the project")
        if not self.project_requirement_met(player, project):
            raise IllegalActionError("the project condition is not met")
        self._spend_action(state)
        player.influence -= project.cost_influence
        player.money -= project.cost_money
        player.projects.append(project_id)
        if not project.repeatable:
            state.project_board = [item for item in state.project_board if item != project_id]
            self._refill_project_board(state)
        state.append_event(
            "city_project_taken",
            player.id,
            project_id=project_id,
            points=project.points,
            cost_influence=project.cost_influence,
            cost_money=project.cost_money,
        )

    def _refill_project_board(self, state: GameState) -> None:
        while len(state.project_board) < PROJECT_BOARD_SIZE and state.project_deck:
            state.project_board.append(state.project_deck.pop(0))

    def _reroll_projects(self, state: GameState, command: Command) -> None:
        """Shuffle the whole board back into the deck and deal four fresh projects.

        It used to move exactly one card — the oldest — for the same money and no action, which is
        the round rotation you get for free anyway: as a way out of a board that fits nobody it was
        a lottery ticket on a single blind draw. A full re-deal is a real decision, so it costs a
        real action on top of the money; that price is also what stops a player sitting on 300$ from
        re-dealing every turn and turning the board into a slot machine.
        """
        player = state.current_player
        if self._flag(state, "projects_rerolled"):
            raise IllegalActionError("the project board has already been rerolled this turn")
        if player.money < PROJECT_REROLL_MONEY:
            raise IllegalActionError("not enough money to reroll the project board")
        if not state.project_deck:
            raise IllegalActionError("the project deck is empty")
        self._spend_action(state)
        self._mark_flag(state, "projects_rerolled")
        player.money -= PROJECT_REROLL_MONEY
        returned = list(state.project_board)
        # Back into the deck, never out of the game: every project stays reachable for everybody.
        state.project_deck.extend(returned)
        state.project_board = []
        GameRNG(state.rng).shuffle(state.project_deck)
        self._refill_project_board(state)
        state.append_event(
            "project_board_redealt",
            player.id,
            cost_money=PROJECT_REROLL_MONEY,
            returned_project_ids=returned,
            project_board=list(state.project_board),
        )

    def _rotate_project_board(self, state: GameState, *, cost_money: int = 0, actor_id: str | None = None) -> None:
        """One project leaves the board every round: the longest-standing one goes to the bottom.

        Without this the board silently jams: four projects nobody can satisfy sit there for the
        rest of the game and the score engine stops existing. It also puts a clock on a project
        you want but cannot afford yet.
        """
        if not state.project_deck or not state.project_board:
            return
        expired = state.project_board.pop(0)
        state.project_deck.append(expired)
        self._refill_project_board(state)
        state.append_event(
            "project_board_rotated",
            actor_id,
            expired_project_id=expired,
            project_board=list(state.project_board),
            cost_money=cost_money,
        )

    def _buy_capacity(self, state: GameState, command: Command) -> None:
        player = state.current_player
        cost = CAPACITY_COSTS.get(player.capacity)
        if cost is None or player.capacity >= MAX_CAPACITY:
            raise IllegalActionError("maximum capacity reached")
        if player.money < cost:
            raise IllegalActionError("not enough money for capacity")
        self._spend_action(state, investment_allowed=True)
        player.money -= cost
        player.capacity += 1
        state.append_event("capacity_bought", player.id, cost=cost, capacity=player.capacity)

    def _buy_roof(self, state: GameState, command: Command) -> None:
        player = state.current_player
        cost = self.roof_price(state, player)
        if player.roofs >= self.roof_limit(player):
            raise IllegalActionError("roof limit reached")
        if player.money < cost:
            raise IllegalActionError("not enough money for a roof")
        self._spend_action(state)
        player.money -= cost
        player.roofs += 1
        state.append_event("roof_bought", player.id, cost=cost, roofs=player.roofs)

    def _claim_role(self, state: GameState, command: Command) -> None:
        player = state.current_player
        role_id = str(command.payload.get("role_id", ""))
        if role_id not in ROLE_IDS:
            raise InvalidCommandError(f"unknown role: {role_id}")
        holder = self.role_holder(state, role_id)
        if holder is player:
            raise IllegalActionError("player already owns this role")
        if player.scandals >= self.scandal_limit(player):
            raise IllegalActionError("a player at the scandal limit cannot claim a role")
        cost = state.role_price * 3 if holder else state.role_price
        if player.influence < cost:
            raise IllegalActionError("not enough influence for the role")
        self._spend_action(state)
        player.influence -= cost

        # A blocked takeover costs the attempt (the action) and the defender's shield, but the
        # influence comes back: paying full price for nothing was a silent 3-point tax, and in the
        # arena game it decided a match that finished four points apart.
        if holder and holder.role_shields > 0:
            holder.role_shields -= 1
            player.influence += cost
            state.append_event("role_takeover_blocked", player.id, role_id=role_id, by="role_shield", refund=cost)
            return
        if holder and holder.roofs > 0:
            holder.roofs -= 1
            player.influence += cost
            state.append_event("role_takeover_blocked", player.id, role_id=role_id, by="roof", refund=cost)
            return
        if holder:
            compensation = sum(
                int(self.owned_definition(asset).effects.get("takeoverCompensation", 0)) for asset in holder.assets
            )
            holder.role = None
            holder.influence += compensation
        previous_role = player.role
        player.role = role_id
        state.append_event(
            "role_claimed",
            player.id,
            role_id=role_id,
            previous_role=previous_role,
            cost=cost,
            previous_holder_id=holder.id if holder else None,
        )

    def _buy_asset(self, state: GameState, command: Command) -> None:
        player = state.current_player
        market_uid = str(command.payload.get("market_uid", ""))
        market_asset = next((item for item in state.market if item.uid == market_uid), None)
        if market_asset is None:
            raise IllegalActionError("asset is no longer on the market")
        if len(player.assets) >= player.capacity:
            raise IllegalActionError("no free asset capacity")
        asset = self.asset(market_asset.card_id)
        cost = self.asset_price(state, player, asset.id)
        if player.money < cost:
            raise IllegalActionError("not enough money for the asset")
        self._spend_action(state, investment_allowed=True)
        before = self._resource_snapshot(state)
        player.money -= cost
        self._gain_asset(state, player, market_asset, asset)
        # Deltas carry the grey-tag scandal and the purchase bonuses, which have no events of their own.
        state.append_event(
            "asset_bought",
            player.id,
            asset_id=asset.id,
            market_uid=market_uid,
            cost=cost,
            deltas=self._resource_deltas(state, before),
        )

    def _gain_asset(
        self,
        state: GameState,
        player: PlayerState,
        market_asset: MarketAsset,
        asset: AssetDefinition,
    ) -> None:
        """Move a market object into a portfolio and pay out its purchase bonuses."""
        player.influence += asset.influence
        player.assets.append(OwnedAsset(uid=market_asset.uid, card_id=asset.id))
        state.market = [item for item in state.market if item.uid != market_asset.uid]
        state.turn_flags["market_discount"] = 0

        purchase = asset.effects.get("purchase", {})
        player.money += int(purchase.get("money", 0))
        player.influence += int(purchase.get("influence", 0))
        if purchase.get("roofs"):
            player.roofs = min(self.roof_limit(player), player.roofs + int(purchase["roofs"]))
        if purchase.get("card") and len(player.hand) < 3:
            drawn = self._draw_action_card(state, player)
            if drawn:
                state.append_event(
                    "free_action_card_drawn",
                    player.id,
                    source_asset_id=asset.id,
                    card_id=drawn.card_id,
                )
        raw_scandals = int(purchase.get("scandals", 1 if "grey" in asset.tags else 0))
        reduction = self.effect_total(player, "greyScandalReduction") if "grey" in asset.tags else 0
        self.add_scandal(state, player, max(0, raw_scandals - reduction))
        self._refill_market(state, 1)

    def _reroll_market(self, state: GameState, command: Command) -> None:
        """Money into market quality, once per turn, without spending an action.

        The market used to rotate only on a timer nobody controlled, so a plan longer than the
        current turn was impossible and spare cash had nowhere to go. This is the unbounded sink.
        """
        player = state.current_player
        if self._flag(state, "market_rerolled"):
            raise IllegalActionError("the market has already been rerolled this turn")
        if player.money < MARKET_REROLL_COST:
            raise IllegalActionError("not enough money to reroll the market")
        if not state.market and not state.market_deck:
            raise IllegalActionError("there is nothing left to reroll")
        self._mark_flag(state, "market_rerolled")
        player.money -= MARKET_REROLL_COST
        replaced = len(state.market)
        state.market_deck.extend(item.card_id for item in state.market)
        state.market = []
        GameRNG(state.rng).shuffle(state.market_deck)
        self._refill_market(state, replaced)
        state.append_event(
            "market_rerolled",
            player.id,
            cost=MARKET_REROLL_COST,
            card_ids=[item.card_id for item in state.market],
        )

    def _buy_automation(self, state: GameState, command: Command) -> None:
        """The token is bought once; after that every move is free."""
        player = state.current_player
        if player.automation_owned:
            raise IllegalActionError("the automation token is already owned")
        if player.money < AUTOMATION_COST:
            raise IllegalActionError("not enough money for the automation token")
        self._spend_action(state, investment_allowed=True)
        player.money -= AUTOMATION_COST
        player.automation_owned = True
        target = self._optional_payload_string(command, "asset_uid")
        if target is not None:
            self._place_automation(player, target)
        state.append_event(
            "automation_bought",
            player.id,
            cost=AUTOMATION_COST,
            asset_uid=player.automation_uid,
        )

    def _move_automation(self, state: GameState, command: Command) -> None:
        """Free, once per turn: the point is that the best home shifts as the portfolio does."""
        player = state.current_player
        if not player.automation_owned:
            raise IllegalActionError("the automation token has not been bought")
        if self._flag(state, "automation_moved"):
            raise IllegalActionError("the automation token has already been moved this turn")
        asset_uid = self._payload_string(command, "asset_uid")
        if asset_uid == player.automation_uid:
            raise IllegalActionError("the automation token is already on this object")
        self._mark_flag(state, "automation_moved")
        previous = player.automation_uid
        self._place_automation(player, asset_uid)
        state.append_event("automation_moved", player.id, asset_uid=asset_uid, previous_asset_uid=previous)

    def _place_automation(self, player: PlayerState, asset_uid: str) -> None:
        if not any(asset.uid == asset_uid for asset in player.assets):
            raise IllegalActionError("asset is not owned by the player")
        player.automation_uid = asset_uid

    @staticmethod
    def _optional_payload_string(command: Command, key: str) -> str | None:
        value = command.payload.get(key)
        return value if isinstance(value, str) and value else None

    def _sell_asset(self, state: GameState, command: Command) -> None:
        """Selling frees the slot and pays half the price, and it costs no action.

        The only reason anybody sells is to put something better in the slot, so charging an action
        for the sale made the whole move irrational: in 24 measured games objects were sold twice
        and swapped through the dedicated ``replace_asset`` command 572 times. With the sale free,
        "sell then buy" costs exactly the one action the purchase costs, which is what the swap
        cost, so the separate swap command — and its owned × market choice matrix — is gone.
        """
        player = state.current_player
        asset_uid = self._payload_string(command, "asset_uid")
        owned = next((asset for asset in player.assets if asset.uid == asset_uid), None)
        if owned is None:
            raise IllegalActionError("asset is not owned by the player")
        value = self.asset_refund(owned)
        automated = self.is_automated(player, owned)
        self._drop_asset(player, owned)
        player.money += value
        state.append_event(
            "asset_sold",
            player.id,
            asset_uid=asset_uid,
            asset_id=owned.card_id,
            value=value,
            # The token is freed by _drop_asset; the client has to say so or it looks like a bug.
            automation_freed=automated,
        )

    @staticmethod
    def _drop_asset(player: PlayerState, owned: OwnedAsset) -> None:
        """Remove an object and free the token if it was working there."""
        player.assets = [asset for asset in player.assets if asset.uid != owned.uid]
        if player.automation_uid == owned.uid:
            player.automation_uid = None

    def _develop_district(self, state: GameState, command: Command) -> None:
        player = state.current_player
        district = self._payload_string(command, "district")
        if district not in DISTRICT_IDS:
            raise InvalidCommandError(f"unknown district: {district}")
        if self.district_count(player, district) < 2:
            raise IllegalActionError("district development requires two owned objects")
        if player.district_levels[district] >= 2:
            raise IllegalActionError("district is already fully developed")
        discount = self.effect_total(player, "developmentDiscount")
        cost = max(0, 2 - discount)
        if player.money < cost:
            raise IllegalActionError("not enough money for district development")
        self._spend_action(state)
        player.money -= cost
        player.influence += 1
        player.district_levels[district] += 1
        state.append_event(
            "district_developed",
            player.id,
            district=district,
            level=player.district_levels[district],
            cost=cost,
        )

    def _crisis_pr(self, state: GameState, command: Command) -> None:
        """Cleaning a scandal is priced in influence, not money.

        At 10$ = 1 point the old 4$ price made cleanup cost 0.4 points to erase a 1-point scandal,
        so scandals erased themselves and the whole attack layer stopped biting. Influence is the
        scarce currency, so cleanup now competes with projects and roles for it.
        """
        player = state.current_player
        if player.influence < CRISIS_PR_INFLUENCE or player.scandals < 1:
            raise IllegalActionError(f"crisis PR requires {CRISIS_PR_INFLUENCE} influence and at least one scandal")
        self._spend_action(state)
        player.influence -= CRISIS_PR_INFLUENCE
        player.scandals -= 1
        state.append_event("crisis_pr", player.id, cost=CRISIS_PR_INFLUENCE, scandals=player.scandals)

    def _draw_action_card(self, state: GameState, player: PlayerState) -> HeldCard | None:
        if len(player.hand) >= 3 or not state.action_deck:
            return None
        card_id = state.action_deck.pop(0)
        held = HeldCard(uid=f"card:{card_id}", card_id=card_id)
        player.hand.append(held)
        return held

    def _buy_action_card(self, state: GameState, command: Command) -> None:
        """A blind draw for an action.

        Cards used to be a face-up market bought without spending an action, which made buying
        the influence card strictly better than the campaign action — 5$ into 3◆ for free while
        the basic action gave 2◆ and ate a turn slot. Now the card is random and costs the action,
        so it competes honestly, and a bad draw is cushioned by a stronger discard.
        """
        player = state.current_player
        if len(player.hand) >= 3:
            raise IllegalActionError("action-card hand limit reached")
        if player.money < ACTION_CARD_COST or player.influence < 1:
            raise IllegalActionError(f"an action card requires {ACTION_CARD_COST} money and 1 influence")
        if not state.action_deck:
            raise IllegalActionError("the action deck is empty")
        self._spend_action(state)
        player.money -= ACTION_CARD_COST
        player.influence -= 1
        # Two cards, because one blind card never beat a project for the same action: the whole
        # card layer was played exactly once across a full fifteen-round match.
        drawn = [card for card in (self._draw_action_card(state, player) for _ in range(2)) if card]
        state.append_event(
            "action_card_bought",
            player.id,
            card_id=drawn[0].card_id,
            card_ids=[card.card_id for card in drawn],
            cost=ACTION_CARD_COST,
        )

    def _convert_action_card(self, state: GameState, command: Command) -> None:
        """Discard one card for a consolation unit — once a turn, like playing one.

        A purchase draws two cards and a discard costs no action, so shredding both in the same
        turn turned the blind draw into the best influence pump in the game: 3$ and one action
        for +4◆, against +2◆ for the campaign that is supposed to be the influence action. Bots
        found it and bought cards they never intended to read. Capping it at one a turn — the
        same rule the card play already follows — leaves the discard as the cushion for a bad
        draw it was meant to be, without touching what a card is worth.
        """
        player = state.current_player
        if self._flag(state, "card_converted"):
            raise IllegalActionError("only one action card may be discarded per turn")
        card_uid = self._payload_string(command, "card_uid")
        into = self._payload_string(command, "into")
        if into not in {"money", "influence"}:
            raise InvalidCommandError("card conversion must be money or influence")
        held = next((card for card in player.hand if card.uid == card_uid), None)
        if held is None:
            raise IllegalActionError("action card is not in the player's hand")
        self._mark_flag(state, "card_converted")
        player.hand.remove(held)
        # Softens a blind draw: returning a single unit made the discard a pure loss on a card
        # that cost 3$ and 1◆, so nobody ever used it on purpose.
        if into == "money":
            player.money += CARD_DISCARD_VALUE
        else:
            player.influence += CARD_DISCARD_VALUE
        state.append_event(
            "action_card_converted", player.id, card_id=held.card_id, into=into, value=CARD_DISCARD_VALUE
        )

    def _play_action_card(self, state: GameState, command: Command) -> None:
        player = state.current_player
        card_uid = self._payload_string(command, "card_uid")
        held = next((card for card in player.hand if card.uid == card_uid), None)
        if held is None:
            raise IllegalActionError("action card is not in the player's hand")
        if self._flag(state, "card_played"):
            raise IllegalActionError("only one action card may be played per turn")
        card = self.action_card(held.card_id)
        target: PlayerState | None = None
        if card.targeted:
            target = self._target_player(state, player, self._payload_string(command, "target_id"))
            self._validate_card_target(card, target)
        self._validate_card_costs(state, player, card, command)

        player.hand.remove(held)
        self._mark_flag(state, "card_played")
        before = self._resource_snapshot(state)
        if card.targeted and target is not None:
            self._apply_attacker_card_bonus(state, player, target, card)
            if target.roofs > 0:
                # Roof automatically absorbs the incoming effect — no player decision.
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, card_id=card.id, by="roof")
            else:
                self._apply_targeted_card_effect(state, player, target, card)
        else:
            self._apply_self_card_effect(state, player, card, command)
        state.append_event(
            "action_card_played",
            player.id,
            card_id=card.id,
            target_id=target.id if target else None,
            deltas=self._resource_deltas(state, before),
        )

    def _validate_card_target(self, card: ActionCardDefinition, target: PlayerState) -> None:
        if card.kind == "role_pressure" and target.role is None:
            raise IllegalActionError("role pressure requires a role holder")
        if card.kind == "freeze" and not target.assets:
            raise IllegalActionError("freeze requires a target asset")
        if card.kind == "remove_upgrade" and (target.automation_uid is None or target.automation_disabled):
            raise IllegalActionError("target has no working automation")

    def _validate_card_costs(
        self,
        state: GameState,
        player: PlayerState,
        card: ActionCardDefinition,
        command: Command,
    ) -> None:
        if card.kind in {"clean", "deep_clean"} and player.scandals < 1:
            raise IllegalActionError("this card requires at least one scandal")
        if card.kind == "deep_clean" and player.influence < 2:
            raise IllegalActionError("deep clean requires 2 influence")
        if card.kind == "roof" and player.roofs >= self.roof_limit(player):
            raise IllegalActionError("roof limit reached")
        if card.kind == "influence" and player.money < 2:
            raise IllegalActionError("media campaign requires 2 money")
        if card.kind == "cash_to_influence" and player.money < CASH_TO_INFLUENCE_MONEY:
            raise IllegalActionError(f"this card requires {CASH_TO_INFLUENCE_MONEY} money")
        if card.kind == "capacity" and player.capacity >= MAX_CAPACITY:
            raise IllegalActionError("the business is already at the slot limit")
        if card.kind in {"district_cash", "zoning", "develop"}:
            district = self._payload_string(command, "district")
            if district not in DISTRICT_IDS:
                raise InvalidCommandError(f"unknown district: {district}")
            count = self.district_count(player, district)
            if card.kind in {"district_cash", "zoning"} and count < 1:
                raise IllegalActionError("the selected district needs an owned object")
            if card.kind == "develop" and (count < 2 or player.district_levels[district] >= 2):
                raise IllegalActionError("the selected district cannot be developed")
        if card.kind == "copy_role":
            role_id = self._payload_string(command, "role_id")
            if role_id not in ROLE_IDS or role_id == player.role:
                raise IllegalActionError("temporary mandate requires another valid role")
        if card.kind == "market_discount" and (len(player.assets) >= player.capacity or not state.market):
            raise IllegalActionError("there is no available object purchase")
        if card.kind == "automation" and player.automation_owned:
            raise IllegalActionError("the automation token is already owned")
        if card.kind == "unblock" and not any(asset.blocked for asset in player.assets):
            raise IllegalActionError("there is no blocked asset")
        if card.kind == "project":
            project_id = self._payload_string(command, "project_id")
            if self.project(project_id).repeatable or project_id not in state.project_board:
                raise IllegalActionError("this card takes a project from the city board")
            if not self.project_requirement_met(player, self.project(project_id)):
                raise IllegalActionError("the project condition is not met")

    def _apply_self_card_effect(
        self,
        state: GameState,
        player: PlayerState,
        card: ActionCardDefinition,
        command: Command,
    ) -> None:
        kind = card.kind
        if kind == "clean":
            player.scandals = max(0, player.scandals - card.value)
        elif kind == "deep_clean":
            player.scandals = max(0, player.scandals - card.value)
            player.influence -= 2
        elif kind == "roof":
            player.roofs = min(self.roof_limit(player), player.roofs + 1)
        elif kind == "grant":
            player.money += self._round_scaled(state, card.value)
            player.influence += int(any("ai" in self.owned_definition(asset).tags for asset in player.assets))
        elif kind == "bridge_loan":
            player.money += card.value
            player.debt += 4
        elif kind == "district_cash":
            district = str(command.payload["district"])
            cap = self._round_scaled(state, 10)
            player.money += min(cap, self.district_count(player, district) * card.value)
        elif kind == "influence":
            player.money -= 2
            player.influence += card.value
        elif kind == "market_discount":
            state.turn_flags["market_discount"] = card.value
        elif kind == "automation":
            player.automation_owned = True
            target = self._optional_payload_string(command, "asset_uid")
            if target is not None:
                self._place_automation(player, target)
        elif kind == "zoning":
            player.zoning_district = str(command.payload["district"])
        elif kind == "develop":
            district = str(command.payload["district"])
            player.district_levels[district] += 1
            player.influence += card.value
        elif kind == "copy_role":
            player.copied_role = str(command.payload["role_id"])
        elif kind == "extra_action":
            state.actions_left += card.value
        elif kind == "investment_action":
            state.investment_actions += card.value
        elif kind == "capacity":
            # A slot, not money: the object it will hold turns 2$ into a point, so with the wallet
            # in surplus and six slots the cap, the slot is the scarce half of the purchase.
            player.capacity = min(MAX_CAPACITY, player.capacity + card.value)
        elif kind == "cash_to_influence":
            # The old direction traded the scarce resource for the plentiful one, which made the
            # card strictly worse than discarding it for influence.
            player.money -= CASH_TO_INFLUENCE_MONEY
            player.influence += card.value
        elif kind == "project":
            # The card pays the influence, not the condition: the project still has to be earned.
            project_id = str(command.payload["project_id"])
            project = self.project(project_id)
            if player.money < project.cost_money:
                raise IllegalActionError("not enough money for the project")
            player.money -= project.cost_money
            state.project_board = [item for item in state.project_board if item != project_id]
            player.projects.append(project_id)
            self._refill_project_board(state)
            state.append_event(
                "city_project_taken",
                player.id,
                project_id=project_id,
                points=project.points,
                cost_influence=0,
                cost_money=project.cost_money,
                source_card_id=card.id,
            )
        elif kind == "role_shield":
            player.role_shields += 1
        elif kind == "scandal_shield":
            player.scandal_shields += 1
        elif kind == "unblock":
            blocked = max(
                (asset for asset in player.assets if asset.blocked),
                key=lambda asset: self.owned_definition(asset).income,
            )
            blocked.blocked = False
        elif kind == "antitrust":
            state.antitrust_active = True
            # Halves income for every player holding 4+ objects in one district at settlement, the
            # player who played it included. Nothing else would announce that.
            state.append_event(
                "antitrust_activated",
                player.id,
                round_number=state.round_number,
                affected_player_ids=[
                    other.id
                    for other in state.players
                    if any(self.district_count(other, district) >= 4 for district in DISTRICT_IDS)
                ],
            )
        else:
            raise InvalidCommandError(f"unsupported non-targeted card kind: {kind}")

    def _apply_attacker_card_bonus(
        self,
        state: GameState,
        attacker: PlayerState,
        target: PlayerState,
        card: ActionCardDefinition,
    ) -> None:
        if card.kind == "steal":
            attacker.money += self._round_scaled(state, 2)
        elif card.kind == "double_scandal":
            self.add_scandal(state, attacker, 1)
        elif card.kind == "blackmail":
            attacker.influence += 1
        elif card.kind == "expose" and self.ranking(state)[0].id == target.id:
            attacker.influence += card.value

    def _apply_targeted_card_effect(
        self,
        state: GameState,
        attacker: PlayerState,
        target: PlayerState,
        card: ActionCardDefinition,
    ) -> None:
        kind = card.kind
        before = self._resource_snapshot(state)
        if kind == "scandal":
            self.add_scandal(state, target, card.value)
        elif kind == "fine":
            # Money effects scale with the round, like the roof price and the grey operations: a flat
            # 4$ was a tenth of a point by round twelve, so the card was worth less than discarding
            # it. Scaling keeps the card identity and fixes the whole money-denominated class.
            amount = self._round_scaled(state, card.value)
            if target.money >= amount:
                target.money -= amount
            else:
                target.money = 0
                self.add_scandal(state, target, 1)
        elif kind == "steal":
            target.money = max(0, target.money - self._round_scaled(state, card.value))
        elif kind == "role_pressure":
            if target.influence >= card.value:
                target.influence -= card.value
            else:
                target.influence = 0
                target.role = None
        elif kind == "double_scandal":
            self.add_scandal(state, target, card.value)
        elif kind == "blackmail":
            target.influence = max(0, target.influence - card.value)
        elif kind == "freeze":
            frozen = max(target.assets, key=lambda asset: self.owned_definition(asset).income)
            frozen.blocked = True
            self._log_asset_state_change(state, target, frozen, change="blocked", source=card.id)
        elif kind == "expose":
            self.add_scandal(state, target, 1)
        elif kind == "remove_upgrade":
            # The token is not destroyed — a single card must not switch off the whole engine for
            # good. It stops working until the round is settled, like a blocked object.
            target.automation_disabled = True
            automated = self.automated_asset(target)
            if automated is not None:
                self._log_asset_state_change(state, target, automated, change="automation_disabled", source=card.id)
        elif kind == "mixed_fine":
            target.money = max(0, target.money - self._round_scaled(state, 2))
            target.influence = max(0, target.influence - 1)
        else:
            raise InvalidCommandError(f"unsupported targeted card kind: {kind}")
        state.append_event(
            "targeted_card_resolved",
            attacker.id,
            card_id=card.id,
            target_id=target.id,
            deltas=self._resource_deltas(state, before),
        )

    def _require_role(self, player: PlayerState, role_id: str) -> None:
        if not self.has_role(player, role_id):
            raise IllegalActionError(f"this power requires the {role_id} role")

    def _use_role_power(self, state: GameState, command: Command) -> None:
        player = state.current_player
        power = self._payload_string(command, "power")
        before = self._resource_snapshot(state)
        if power == "capitalist_financing":
            self._require_role(player, "capitalist")
            self._once_per_turn(state, power)
            if player.influence < 3:
                raise IllegalActionError("accelerated financing requires 3 influence")
            player.influence -= 3
            state.investment_actions += 1
        elif power == "politician_tax":
            self._require_role(player, "politician")
            self._once_per_turn(state, power)
            district = self._payload_string(command, "district")
            if district not in DISTRICT_IDS:
                raise InvalidCommandError(f"unknown district: {district}")
            if player.influence < 4:
                raise IllegalActionError("district tax requires 4 influence")
            revenue = sum(self.district_count(other, district) for other in state.players)
            if revenue < 1:
                raise IllegalActionError("the selected district has no objects")
            player.influence -= 4
            player.money += revenue
        elif power == "politician_cleanup":
            self._require_role(player, "politician")
            self._once_per_turn(state, power)
            if player.influence < 2 or player.scandals < 1:
                raise IllegalActionError("political cleanup requires 2 influence and a scandal")
            player.influence -= 2
            player.scandals -= 1
        elif power in {"journalist_inflate", "journalist_publish"}:
            self._require_role(player, "journalist")
            self._once_per_turn(state, power)
            target = self._target_player(state, player, self._payload_string(command, "target_id"))
            if power == "journalist_publish":
                if player.influence < 3:
                    raise IllegalActionError("publication requires 3 influence")
                player.influence -= 3
            else:
                # The self-scandal is your own choice, so a roof never cancels it.
                self.add_scandal(state, player, 1)
            # Every other targeted effect checks the roof; these two used to punch straight through.
            if target.roofs > 0:
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, power=power, by="roof")
            else:
                self.add_scandal(state, target, 1)
        elif power == "mafia_racket":
            self._mafia_racket(state, command)
        elif power == "mafia_sweep":
            self._require_role(player, "mafia")
            self._once_per_turn(state, power)
            if player.roofs < 1:
                raise IllegalActionError("roof sweep requires a roof")
            self._spend_action(state)
            for target in state.players:
                target.roofs = max(0, target.roofs - 1)
        elif power == "mafia_cleanup":
            self._mafia_cleanup(state, command)
        elif power == "military_sanction":
            self._military_sanction(state, command)
        elif power == "fraudster_cleanup":
            self._require_role(player, "fraudster")
            if player.scandals < 1:
                raise IllegalActionError("there is no scandal to clean")
            self._spend_action(state)
            player.scandals -= 1
        elif power == "fraudster_crypto_scam":
            self._fraudster_crypto_scam(state, command)
        elif power == "fraudster_forge":
            self._fraudster_forge(state, command)
        else:
            raise InvalidCommandError(f"unsupported role power: {power}")
        state.append_event(
            "role_power_used",
            player.id,
            power=power,
            target_id=command.payload.get("target_id"),
            district=command.payload.get("district"),
            # Deltas only cover money/influence/scandals/roofs, so an extra action was invisible:
            # two agents in two matches independently concluded the capitalist power did nothing.
            investment_actions=state.investment_actions,
            actions_left=state.actions_left,
            deltas=self._resource_deltas(state, before),
        )

    def _once_per_turn(self, state: GameState, power: str) -> None:
        key = f"used:{power}"
        if self._flag(state, key):
            raise IllegalActionError("this power has already been used this turn")
        self._mark_flag(state, key)

    def _mafia_racket(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "mafia")
        self._once_per_turn(state, "mafia_racket")
        if not any(self.owned_definition(asset).district == "shadows" and not asset.blocked for asset in player.assets):
            raise IllegalActionError("racket requires an active shadows asset")
        target = self._target_player(state, player, self._payload_string(command, "target_id"))
        self._spend_action(state)
        if target.roofs > 0:
            target.roofs -= 1
            return
        leader = self.ranking(state)[0].id == target.id
        money_demand = (
            2
            + self.district_count(player, "shadows")
            + self.district_count(player, "residential")
            + int(state.turn_flags.get("mafia_operation_bonus", 0))
            + floor(state.round_number * 2 / 4)
            + (3 if leader else 0)
        )
        influence_demand = self.district_count(player, "government")
        money = min(money_demand, target.money)
        influence = min(influence_demand, target.influence)
        target.money -= money
        target.influence -= influence
        player.money += money
        player.influence += influence
        if self.district_count(player, "government") < 1:
            self.add_scandal(state, player, 1)

    def _mafia_cleanup(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "mafia")
        self._once_per_turn(state, "mafia_cleanup")
        if player.scandals < 1:
            raise IllegalActionError("there is no scandal to clean")
        method = self._payload_string(command, "method")
        if method == "roof":
            if player.roofs < 1:
                raise IllegalActionError("cleanup requires a roof")
            player.roofs -= 1
        elif method == "money":
            if player.money < 3 or self.district_count(player, "government") < 1:
                raise IllegalActionError("paid cleanup requires 3 money and a government object")
            player.money -= 3
        else:
            raise InvalidCommandError("mafia cleanup method must be roof or money")
        player.scandals = max(0, player.scandals - 2)

    def _log_asset_state_change(
        self,
        state: GameState,
        owner: PlayerState,
        asset: OwnedAsset,
        *,
        change: str,
        source: str,
        **extra: Any,
    ) -> None:
        """Blocking an object or stripping its upgrade moves no resource, so log it explicitly."""
        state.append_event(
            "asset_state_changed",
            owner.id,
            asset_id=asset.card_id,
            asset_uid=asset.uid,
            change=change,
            source=source,
            **extra,
        )

    def _log_asset_taken(
        self,
        state: GameState,
        actor: PlayerState,
        victim: PlayerState,
        asset: OwnedAsset,
        *,
        reason: str,
        resolution: str,
    ) -> None:
        """Record an object changing hands: ``deltas`` cannot show it, so nothing else would."""
        state.append_event(
            "asset_confiscated",
            actor.id,
            asset_id=asset.card_id,
            asset_uid=asset.uid,
            victim_id=victim.id,
            value=self.asset_value(asset),
            refund=self.asset_refund(asset),
            reason=reason,
            resolution=resolution,
        )

    def _military_sanction(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "military")
        self._once_per_turn(state, "military_sanction")
        target = self._target_player(state, player, self._payload_string(command, "target_id"))
        if target.scandals < 2:
            raise IllegalActionError("sanction requires a target with at least two scandals")
        self._spend_action(state)
        confiscated: OwnedAsset | None = None
        landed = False
        if target.roofs > 0:
            target.roofs -= 1
            state.append_event("targeted_effect_blocked", target.id, power="military_sanction", by="roof")
        elif target.scandals <= 3:
            seized = min(target.money, 3 + state.round_number)
            target.money -= seized
            player.money += seized
            landed = True
        elif len(target.assets) > 1:
            confiscated = max(target.assets, key=self.asset_value)
            self._drop_asset(target, confiscated)
            landed = True
        # "Case closed" only when the sanction actually landed. A roof absorbs the whole effect, so
        # it must not also clean the target's record — that used to make attacking a rival helpful,
        # and made sitting on 4 scandals safer than sitting on 2.
        if landed:
            target.scandals = max(0, target.scandals - 1)
        if confiscated is not None:
            resolution = "seized"
            if len(player.assets) < player.capacity:
                player.assets.append(confiscated)
            else:
                weakest = min(player.assets, key=self.asset_value)
                if self.asset_value(confiscated) > self.asset_value(weakest):
                    self._drop_asset(player, weakest)
                    player.money += self.asset_refund(weakest)
                    player.assets.append(confiscated)
                    resolution = "swapped"
                else:
                    player.money += self.asset_refund(confiscated)
                    resolution = "cashed"
            # Asset transfers move no resource the deltas cover, so without this event an object
            # vanished from a portfolio with nothing in the chronicle to explain it.
            self._log_asset_taken(state, player, target, confiscated, reason="military_sanction", resolution=resolution)

    def _fraudster_crypto_scam(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "fraudster")
        self._once_per_turn(state, "fraudster_crypto_scam")
        if not any(asset.card_id == "crypto" and not asset.blocked for asset in player.assets):
            raise IllegalActionError("crypto scam requires an active crypto exchange")
        try:
            amount = int(command.payload.get("amount", 1))
        except (TypeError, ValueError) as exc:
            raise InvalidCommandError("crypto scam amount must be an integer") from exc
        if not 1 <= amount <= 6:
            raise InvalidCommandError("crypto scam amount must be between 1 and 6")
        self._spend_action(state)
        gained = 0
        for target in state.players:
            if target.id == player.id:
                continue
            taken = min(amount, target.money)
            target.money -= taken
            gained += taken
        player.money += gained
        reduction = self.effect_total(player, "greyScandalReduction")
        self.add_scandal(state, player, max(0, amount - reduction))

    def _fraudster_forge(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "fraudster")
        self._once_per_turn(state, "fraudster_forge")
        role_id = self._payload_string(command, "role_id")
        if role_id not in ROLE_IDS:
            raise InvalidCommandError(f"unknown role: {role_id}")
        if player.influence < 5:
            raise IllegalActionError("forgery requires 5 influence")
        self._spend_action(state)
        player.influence -= 5
        self.add_scandal(state, player, 2)
        player.pending_role = role_id

    GREY_ASSET_IDS = ("cash", "market", "crypto", "datacenter", "influence_broker")
    GREY_TARGETED_IDS = ("market", "datacenter", "influence_broker")
    GREY_BASE_CHANCE = {
        "cash": 0.85,
        "market": 0.75,
        "crypto": 0.60,
        "datacenter": 0.55,
        "influence_broker": COMPROMAT_CHANCE,
    }
    # A leak and a hack are two scandals; the rest are one.
    GREY_SUCCESS_SCANDALS = {"datacenter": 2, "influence_broker": 2}

    def laundering_cost(self, state: GameState) -> int:
        """What laundering money into influence costs, growing with the round like the roof does."""
        return LAUNDERING_BASE_COST + floor(state.round_number / 2)

    def laundering_gain(self, state: GameState) -> int:
        """How much influence a laundering run pays. Grows faster than the stake — see the constant."""
        return LAUNDERING_BASE_GAIN + floor(state.round_number / 3)

    def _grey_operation(self, state: GameState, command: Command) -> None:
        player = state.current_player
        asset_id = self._payload_string(command, "asset_id")
        if asset_id not in self.GREY_ASSET_IDS:
            raise InvalidCommandError("unknown grey operation asset")
        if not any(asset.card_id == asset_id and not asset.blocked for asset in player.assets):
            raise IllegalActionError("the required grey asset is not active")
        target: PlayerState | None = None
        if asset_id in self.GREY_TARGETED_IDS:
            target = self._target_player(state, player, self._payload_string(command, "target_id"))
        if asset_id == "cash" and player.money < self.laundering_cost(state):
            raise IllegalActionError(f"laundering requires {self.laundering_cost(state)} money")
        if asset_id == "influence_broker":
            self._validate_compromat(state, player, target)
        self._spend_action(state)
        before = self._resource_snapshot(state)
        if asset_id == "influence_broker":
            # Spent whether or not the leak lands: a failed attempt still burns the round.
            player.compromat_round = state.round_number

        place = next(index for index, ranked in enumerate(self.ranking(state), start=1) if ranked.id == player.id)
        fraud_bonus = [0, 0.05, 0.1, 0.2][min(3, place - 1)] if self.has_role(player, "fraudster") else 0
        tech_bonus = min(0.1, self.district_count(player, "tech") * 0.05) if self.has_role(player, "fraudster") else 0
        chance = min(0.9, self.GREY_BASE_CHANCE[asset_id] + fraud_bonus + tech_bonus)
        success = GameRNG(state.rng).chance(chance)
        comeback = floor((place - 1) * state.round_number / 3) if self.has_role(player, "fraudster") else 0
        if success:
            self._resolve_grey_success(state, player, target, asset_id, comeback)
            operation_scandals = self.GREY_SUCCESS_SCANDALS.get(asset_id, 1)
            self.add_scandal(
                state,
                player,
                max(0, operation_scandals - self.effect_total(player, "greyScandalReduction")),
            )
            if self.has_role(player, "mafia"):
                state.turn_flags["mafia_operation_bonus"] = 1
        else:
            self._resolve_grey_failure(state, player, asset_id, bool(command.payload.get("protect_failure")))
        state.append_event(
            "grey_operation_resolved",
            player.id,
            asset_id=asset_id,
            target_id=target.id if target else None,
            success=success,
            chance=chance,
            deltas=self._resource_deltas(state, before),
        )

    def _validate_compromat(self, state: GameState, player: PlayerState, target: PlayerState | None) -> None:
        if target is None or target.role is None:
            raise IllegalActionError("a compromat leak requires a target who holds a role")
        if player.influence < COMPROMAT_INFLUENCE:
            raise IllegalActionError(f"a compromat leak requires {COMPROMAT_INFLUENCE} influence")
        if player.compromat_round == state.round_number:
            raise IllegalActionError("a compromat leak may only be attempted once per round")

    def _resolve_grey_success(
        self,
        state: GameState,
        player: PlayerState,
        target: PlayerState | None,
        asset_id: str,
        comeback: int,
    ) -> None:
        if asset_id == "cash":
            # Reversed: money buys influence. See LAUNDERING_BASE_GAIN for why both sides scale.
            player.money -= self.laundering_cost(state)
            player.influence += self.laundering_gain(state)
            player.money += comeback
        elif asset_id == "market" and target is not None:
            cap = 3 + floor(state.round_number / 2)
            if target.roofs > 0:
                target.roofs -= 1
                player.money += comeback
                state.append_event("targeted_effect_blocked", target.id, asset_id=asset_id, by="roof")
            else:
                stolen = min(cap, target.money)
                target.money -= stolen
                player.money += stolen + comeback
        elif asset_id == "crypto":
            player.money += 6 + state.round_number + comeback
            leader = self.ranking(state)[0]
            if leader.id != player.id:
                if leader.roofs > 0:
                    leader.roofs -= 1
                    state.append_event("targeted_effect_blocked", leader.id, asset_id=asset_id, by="roof")
                else:
                    leader.money = max(0, leader.money - (2 + floor(state.round_number / 2)))
        elif asset_id == "datacenter" and target is not None:
            # Straight influence theft. It used to block the target's best object for a round —
            # worth about 4$ to somebody sitting on 264$, and used zero times in 24 games.
            player.money += comeback
            if target.roofs > 0:
                # A roof absorbs any incoming negative effect, hacking included.
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, asset_id=asset_id, by="roof")
            else:
                stolen = min(HACK_INFLUENCE_STEAL, target.influence)
                target.influence -= stolen
                player.influence += stolen
        elif asset_id == "influence_broker" and target is not None:
            player.influence -= COMPROMAT_INFLUENCE
            player.money += comeback
            self._resolve_compromat(state, player, target)

    def _resolve_compromat(self, state: GameState, player: PlayerState, target: PlayerState) -> None:
        """Strip the target's role unless a court injunction or a roof takes the hit instead.

        Order matches ``_claim_role``: the injunction is the dedicated answer to role attacks, so it
        is spent first and the roof is the general-purpose fallback.
        """
        if target.role_shields > 0:
            target.role_shields -= 1
            state.append_event("targeted_effect_blocked", target.id, asset_id="influence_broker", by="role_shield")
            return
        if target.roofs > 0:
            target.roofs -= 1
            state.append_event("targeted_effect_blocked", target.id, asset_id="influence_broker", by="roof")
            return
        lost_role = target.role
        target.role = None
        target.copied_role = None
        target.pending_role = None
        # The seat opens at the free price: a stripped role is not held by anybody any more, so the
        # threefold takeover no longer applies and the leak has actually changed the board.
        state.append_event("role_stripped", player.id, target_id=target.id, role_id=lost_role)

    def _resolve_grey_failure(
        self,
        state: GameState,
        player: PlayerState,
        asset_id: str,
        protect_failure: bool,
    ) -> None:
        protected = protect_failure and player.roofs > 0
        if protected:
            player.roofs -= 1
        elif asset_id == "cash":
            # The launderer keeps the stake and delivers nothing.
            player.money = max(0, player.money - self.laundering_cost(state))
        elif asset_id == "market":
            if player.roofs > 0:
                player.roofs -= 1
        elif asset_id == "crypto":
            player.money = max(0, player.money - 5)
            for asset in player.assets:
                if asset.card_id == "crypto" and self.is_automated(player, asset):
                    player.automation_disabled = True
                    self._log_asset_state_change(
                        state, player, asset, change="automation_disabled", source="crypto_failure"
                    )
        elif asset_id in {"datacenter", "influence_broker"}:
            # A botched hack or leak costs influence, not a blocked object: the block was the
            # mechanic this pass removed, and re-using it on failure would keep it alive.
            player.influence = max(0, player.influence - 2)
        failure_scandals = (
            1
            if self.has_role(player, "fraudster")
            else 3
            if asset_id in {"crypto", "datacenter", "influence_broker"}
            else 2
        )
        self.add_scandal(
            state,
            player,
            max(0, failure_scandals - self.effect_total(player, "greyScandalReduction")),
        )

    def scandal_limit(self, player: PlayerState) -> int:
        """At how many scandals the role is lost. Jail follows one step later.

        The journalist earns influence for their own scandals, so the ordinary limit of five put
        their best line permanently one point from collapse — and only a rare pair of perks made
        it survivable at all.
        """
        return JOURNALIST_SCANDAL_LIMIT if self.has_role(player, "journalist") else 5

    def add_scandal(self, state: GameState, player: PlayerState, amount: int) -> None:
        """Charge scandals and announce every consequence that is not a plain counter change.

        Losing a role, being jailed and spending a scandal shield used to happen in silence: the
        only trace was the scandal counter moving, so a player found out their role was gone by
        diffing their own state. A roof already reports itself through ``targeted_effect_blocked``
        and the shield has to do the same, or the two defences read completely differently.
        """
        if amount <= 0:
            player.scandals = max(0, player.scandals + amount)
            return
        if player.scandal_shields > 0:
            player.scandal_shields -= 1
            state.append_event(
                "scandal_shield_spent",
                player.id,
                absorbed=amount,
                scandal_shields=player.scandal_shields,
            )
            return
        limit = self.scandal_limit(player)
        next_value = player.scandals + amount
        player.scandal_gained_this_round += amount
        if next_value < limit:
            player.scandals = next_value
            return

        lost_role = player.role
        jailed = next_value >= limit + 1
        player.role = None
        player.copied_role = None
        player.pending_role = None
        if jailed:
            player.scandals = 3
            player.roofs = max(0, player.roofs - 1)
            player.jail_turns = 1
        else:
            player.scandals = limit
        state.append_event(
            "scandal_limit_reached",
            player.id,
            role_id=lost_role,
            jailed=jailed,
            limit=limit,
            scandals=player.scandals,
        )

    def _enforce_jail_interrupt(self, state: GameState, command: Command) -> None:
        """A sixth scandal jails the actor at once: the rest of their turn is forfeited.

        ``_prepare_current_player`` decrements ``jail_turns`` when a turn starts, so a
        positive counter on the acting player can only mean they were jailed mid-turn.
        Unused actions burn — including the one ``carryAction`` would normally bank —
        and the turn passes on immediately. A player jailed by somebody else's command
        is not the current player, so their own turn is untouched.
        """
        if command.type == "end_turn" or state.status != "playing":
            return
        player = state.current_player
        if player.jail_turns < 1:
            return
        state.actions_left = 0
        state.investment_actions = 0
        state.append_event("player_jailed", player.id, round_number=state.round_number)
        self._end_turn(state, command)

    def _end_turn(self, state: GameState, command: Command) -> None:
        player = state.current_player
        if state.actions_left > 0 and player.jail_turns == 0 and self.effect_total(player, "carryAction") > 0:
            player.banked_actions = 1
        else:
            player.banked_actions = 0
        player.copied_role = None
        state.turn_flags = {}
        state.append_event("turn_ended", player.id, round_number=state.round_number)

        if state.turns_taken_in_round < len(state.players) - 1:
            state.turns_taken_in_round += 1
            state.current_player_index = self._seat_of(state, state.turn_order[state.turns_taken_in_round])
            state.turn_serial += 1
            # No market pruning here on purpose: the board must hold still for a whole round, or
            # "see it, save for it, buy it" cannot be played.
            self._prepare_current_player(state)
            return

        self._settle_round(state)
        if state.round_number >= state.max_rounds:
            state.status = "finished"
            state.actions_left = 0
            state.investment_actions = 0
            state.final_scores = {player.id: self.score(player) for player in state.players}
            state.append_event(
                "game_finished",
                winner_id=self.ranking(state)[0].id,
                scores=dict(state.final_scores),
            )
            return

        state.round_number += 1
        state.turns_taken_in_round = 0
        self._set_turn_order(state)
        state.turn_serial += 1
        state.antitrust_active = False
        self._rotate_expired_market(state)
        self._shuffle_action_deck(state)
        self._rotate_project_board(state)
        self._prepare_current_player(state)
        state.append_event("round_started", round_number=state.round_number, player_id=state.current_player.id)

    @staticmethod
    def _seat_of(state: GameState, player_id: str) -> int:
        return next(index for index, player in enumerate(state.players) if player.id == player_id)

    def _set_turn_order(self, state: GameState) -> None:
        """The trailing player opens the round and gets first pick of the market.

        Catch-up through access instead of cash: it costs the leader tempo without slowing the
        player who is behind, and it replaces a starting seat that used to be drawn once and then
        played first for all fifteen rounds.
        """
        # Ties break in favour of whoever played later last round, so equal scores rotate the
        # advantage instead of freezing it on the lowest seat — early rounds are all ties, and a
        # fixed seat order there looked like the standings rule was not working at all.
        previous = state.turn_order or [player.id for player in state.players]
        order = sorted(
            state.players,
            key=lambda player: (self.score(player), -previous.index(player.id) if player.id in previous else 0),
        )
        state.turn_order = [player.id for player in order]
        state.starting_player_index = self._seat_of(state, state.turn_order[0])
        state.current_player_index = state.starting_player_index
        state.append_event("turn_order_set", round_number=state.round_number, order=list(state.turn_order))

    def _prepare_current_player(self, state: GameState) -> None:
        player = state.current_player
        jailed = player.jail_turns > 0
        player.copied_role = player.pending_role
        player.pending_role = None
        player.jail_turns = max(0, player.jail_turns - 1)
        player.turns += 1
        if player.role is None and player.scandals > 0:
            player.scandals -= 1
        player.scandals = max(0, player.scandals - self.effect_total(player, "scandalReduction"))
        player.roofs = min(self.roof_limit(player), player.roofs + self.effect_total(player, "turnRoof"))
        base_actions = 1 if jailed else (4 if player.role == "fraudster" else 3)
        bonus = min(1, self.effect_total(player, "extraActions"))
        state.actions_left = base_actions + (0 if jailed else bonus + player.banked_actions)
        state.investment_actions = min(1, self.effect_total(player, "extraInvestmentActions"))
        player.banked_actions = 0
        state.turn_flags = {}
        state.append_event(
            "turn_started",
            player.id,
            round_number=state.round_number,
            actions=state.actions_left,
            investment_actions=state.investment_actions,
        )

    def _rotate_expired_market(self, state: GameState) -> None:
        """Prune the market. Called only when a round opens, so a slot cannot vanish mid-round.

        It used to run on every turn pass as well, which is what made the countdown unreadable:
        between two of your own turns three of six slots could change at a four-player table.
        """
        expired = [item for item in state.market if item.expires_at_round <= state.round_number]
        if not expired:
            return
        expired_uids = {item.uid for item in expired}
        state.market = [item for item in state.market if item.uid not in expired_uids]
        self._refill_market(state, len(expired))
        state.append_event("market_rotated", expired_asset_ids=[item.card_id for item in expired])

    def _refill_market(self, state: GameState, needed: int) -> None:
        drawn: list[str] = []
        remaining: list[str] = []
        for card_id in state.market_deck:
            asset = self.asset(card_id)
            if len(drawn) < needed and state.round_number >= self.catalog.rarity_min_round[asset.rarity]:
                drawn.append(card_id)
            else:
                remaining.append(card_id)
        state.market_deck = remaining
        state.market.extend(
            MarketAsset(
                uid=f"asset:{card_id}",
                card_id=card_id,
                expires_at_round=state.round_number + MARKET_ASSET_ROUNDS,
            )
            for card_id in drawn
        )

    def _shuffle_action_deck(self, state: GameState) -> None:
        """Cards are a blind draw, so the only thing to maintain is a shuffled deck."""
        GameRNG(state.rng).shuffle(state.action_deck)

    def _settle_round(self, state: GameState) -> None:
        incomes, income_sources, influence_sources = self.settlement_preview(state)
        for player in state.players:
            player.money = max(
                0,
                player.money + incomes[player.id] + income_sources[player.id]["journalist"] - player.debt,
            )
            player.influence += sum(influence_sources[player.id].values())
            player.debt = 0
            player.zoning_district = None
            player.scandal_gained_this_round = 0
            player.copied_role = None
            player.automation_disabled = False
            for asset in player.assets:
                asset.blocked = False
        state.append_event(
            "round_settled",
            round_number=state.round_number,
            incomes=incomes,
            income_sources=income_sources,
            influence_sources=influence_sources,
        )

    def settlement_preview(
        self, state: GameState
    ) -> tuple[dict[str, int], dict[str, dict[str, int]], dict[str, dict[str, int]]]:
        """What settling the round right now would pay everybody, without touching the state.

        ``_settle_round`` applies exactly this and ``round_forecast`` displays exactly this, so the
        figure on a player's screen cannot drift from the one that lands in their wallet. Returns
        ``(incomes, income_sources, influence_sources)``; every ``*_sources`` row sums to the change
        that row's player will see, which is what the chronicle relies on.
        """
        breakdowns = {player.id: self._income_breakdown(state, player) for player in state.players}
        incomes = {player_id: sum(item.values()) for player_id, item in breakdowns.items()}
        income_sources: dict[str, dict[str, int]] = {
            player.id: {**breakdowns[player.id], "mafia_tribute": 0, "journalist": 0, "debt": -player.debt}
            for player in state.players
        }
        for mafia in [player for player in state.players if player.role == "mafia"]:
            tribute = 0
            for victim in state.players:
                if victim.id == mafia.id:
                    continue
                levy = 0
                for district in DISTRICT_IDS:
                    mafia_count = self.district_count(mafia, district)
                    # Presence is enough: the mafia levies every rival it outnumbers in a district
                    # where it owns something, even when a third player owns more there.
                    if mafia_count > 0 and self.district_count(victim, district) < mafia_count:
                        levy += (
                            sum(
                                self.owned_definition(asset).district == district and not asset.blocked
                                for asset in victim.assets
                            )
                            * 2
                        )
                paid = min(max(0, incomes[victim.id]), levy)
                incomes[victim.id] -= paid
                income_sources[victim.id]["mafia_tribute"] -= paid
                tribute += paid
            incomes[mafia.id] += tribute
            income_sources[mafia.id]["mafia_tribute"] += tribute

        influence_sources: dict[str, dict[str, int]] = {}
        for player in state.players:
            journalist = player.role == "journalist"
            news_limit = 3 if any(asset.card_id == "data" for asset in player.assets) else 2
            news = (
                min(
                    news_limit,
                    sum(other.scandal_gained_this_round for other in state.players if other.id != player.id),
                )
                if journalist
                else 0
            )
            rating = min(4, player.scandals) if journalist else 0
            # 2$ per scandal still standing on a rival when the round is settled.
            journalist_cash = (
                2 * sum(other.scandals for other in state.players if other.id != player.id) if journalist else 0
            )
            income_sources[player.id]["journalist"] = journalist_cash
            # Influence was settled silently: players had to diff their own state to see where
            # a politician's passive or a journalist's rating came from.
            influence_sources[player.id] = {
                **self.passive_influence_breakdown(player),
                "news": news,
                "rating": rating,
            }
        return incomes, income_sources, influence_sources

    def round_forecast(self, state: GameState, player: PlayerState) -> dict[str, dict[str, int]]:
        """The viewer's own itemised round payout, money and influence, with a ``total`` row.

        A permanent project perk that pays +1◆ a round was indistinguishable from one that paid
        nothing: the only way to check was to diff your own influence across a round boundary.
        """
        _, income_sources, influence_sources = self.settlement_preview(state)
        money = dict(income_sources[player.id])
        money["total"] = sum(money.values())
        influence = dict(influence_sources[player.id])
        influence["total"] = sum(influence.values())
        return {"money": money, "influence": influence}

    def _income_breakdown(self, state: GameState, player: PlayerState) -> dict[str, int]:
        """Round money, itemised. ``objects`` is gross of antitrust so the row still sums right.

        No asset in the catalog carries ``passiveMoney`` — it is a project-perk key — so the
        ``projects`` row is exactly what the finished projects pay.
        """
        # The automated object pays no maintenance, so the token is worth a little even on a card
        # with no printed effects to double.
        exempt = 1 if self.automated_asset(player) is not None and not player.automation_disabled else 0
        maintenance = MAINTENANCE_PER_ASSET * max(
            0, len(player.assets) - exempt - self.effect_total(player, "maintenanceReduction")
        )
        event = self.catalog.events[state.event_id]
        objects = 0
        antitrust = 0
        for owned in player.assets:
            if owned.blocked:
                continue
            asset = self.owned_definition(owned)
            event_multiplier = event.income_multiplier if event.district == asset.district else 1
            base = asset.income
            # +25% per development level, each level rounded up on its own. A single floor over the
            # whole product paid nothing for the first level on every 1-3$ object, and the early
            # market is made of exactly those, so the step was dead by definition.
            for _ in range(player.district_levels[asset.district]):
                base = ceil(base * 1.25)
            base = floor(base * (event_multiplier or 1))
            object_income = base + self.object_synergy_income(state, player, owned) + event.global_income
            objects += object_income
            if state.antitrust_active and self.district_count(player, asset.district) >= 4:
                antitrust += object_income - floor(object_income / 2)
        return {
            "objects": objects,
            "projects": self.effect_total(player, "passiveMoney"),
            "maintenance": -maintenance,
            "antitrust": -antitrust,
        }

    def _round_income(self, state: GameState, player: PlayerState) -> int:
        return sum(self._income_breakdown(state, player).values())

    def object_synergy_income(self, state: GameState, player: PlayerState, owned: OwnedAsset) -> int:
        """The automation token doubles everything the object earns.

        Doubling only the printed effects made the token too weak to buy: in the arena game three
        players owned one and not one of them ever moved it, because the payoff never justified
        the 6$ and the action. It multiplies the whole bonus again — but now it is a single object
        out of six rather than every object, so it no longer drives the mono-district meta the way
        per-object automation did.
        """
        asset = self.owned_definition(owned)
        count = self.district_count(player, asset.district)
        district_bonus = 2 if count >= 4 else 1 if count >= 2 else 0
        supported = {
            "capitalist": "business",
            "politician": "residential",
            "fraudster": "tech",
            "mafia": "shadows",
            "military": "industrial",
        }
        role_bonus = int(
            any(self.has_role(player, role) and district == asset.district for role, district in supported.items())
        )
        special = self._special_income(state, player, owned)
        return (district_bonus + role_bonus + special) * (2 if self.is_automated(player, owned) else 1)

    def _special_income(self, state: GameState, player: PlayerState, owned: OwnedAsset) -> int:
        asset = self.owned_definition(owned)
        effects = asset.effects
        result = 0
        event_bonus = effects.get("eventBonus")
        if event_bonus and event_bonus.get("eventId") == state.event_id:
            result += int(event_bonus["value"])
        district_bonus = effects.get("districtBonus")
        if district_bonus:
            district = district_bonus["district"]
            if district_bonus.get("perObject"):
                adjustment = int(bool(district_bonus.get("excludeSelf")) and asset.district == district)
                virtual = int(
                    bool(district_bonus.get("virtualRole")) and self.has_role(player, district_bonus["virtualRole"])
                )
                result += max(0, self.district_count(player, district) - adjustment + virtual) * int(
                    district_bonus["value"]
                )
            elif self.has_district_link(player, district):
                result += int(district_bonus["value"])
        role_bonus = effects.get("roleBonus")
        if role_bonus and self.has_role(player, role_bonus["role"]):
            result += int(role_bonus["value"])
        for bonus in effects.get("roleBonuses", []):
            if self.has_role(player, bonus["role"]):
                result += int(bonus["value"])
        for link in effects.get("districtLinks", []):
            if self.has_district_link(player, link["district"]):
                result += int(link["value"])
        return result

    def has_district_link(self, player: PlayerState, district: str) -> bool:
        return (
            self.district_count(player, district) > 0
            or (district == "business" and self.has_role(player, "capitalist"))
            or (district == "government" and self.has_role(player, "politician"))
        )

    def passive_influence_breakdown(self, player: PlayerState) -> dict[str, int]:
        """Round influence, itemised by where it comes from.

        No asset in the catalog carries ``passiveInfluence`` — it is a project-perk key — so the
        ``projects`` row is exactly what the finished projects pay.
        """
        active = [asset for asset in player.assets if not asset.blocked]
        administrative = 0
        if self.has_role(player, "politician"):
            # Role synergy, so the automation token does not double it — same rule as income.
            administrative = sum(1 for asset in active if self.owned_definition(asset).district == "government")
            administrative += 1 + floor(
                sum(self.owned_definition(asset).district == "residential" for asset in active) / 2
            )
        object_effects = 0
        for owned in active:
            bonus = self.owned_definition(owned).effects.get("influenceBonus")
            if not bonus:
                continue
            active_role = not bonus.get("role") or self.has_role(player, bonus["role"])
            active_district = not bonus.get("district") or self.has_district_link(player, bonus["district"])
            if active_role and active_district:
                # The object's own printed bonus, so automation does double it.
                object_effects += int(bonus["value"]) * (2 if self.is_automated(player, owned) else 1)
        return {
            "objects": object_effects,
            "administrative": administrative,
            "projects": self.effect_total(player, "passiveInfluence"),
        }

    def passive_influence(self, player: PlayerState) -> int:
        return sum(self.passive_influence_breakdown(player).values())

    def score(self, player: PlayerState) -> int:
        """Points come from what you built, not from what you hoarded.

        Money and influence used to convert 1:1, which made ``work`` (+2$ for one action) a
        competitive scoring move — 60% of every bot game was spent pressing it, and 90% of the
        final score was the untouched wallet. Both are fuel now: they convert at a deliberately
        poor rate, so a round's income is only worth what it buys.
        """
        asset_score = sum(self.asset_value(asset) for asset in player.assets)
        return (
            player.money // MONEY_PER_POINT
            + player.influence // INFLUENCE_PER_POINT
            + asset_score
            + self.project_points(player)
            + (3 if player.role else 0)
            - player.scandals
        )

    def score_breakdown(self, player: PlayerState) -> dict[str, int]:
        """Same numbers as ``score``, itemised — the client must never re-derive the formula."""
        asset_score = sum(self.asset_value(asset) for asset in player.assets)
        return {
            "money": player.money // MONEY_PER_POINT,
            "influence": player.influence // INFLUENCE_PER_POINT,
            "assets": asset_score,
            "projects": self.project_points(player),
            "role": 3 if player.role else 0,
            "scandals": -player.scandals,
            "total": self.score(player),
        }

    def project_points(self, player: PlayerState) -> int:
        return sum(self.project(project_id).points for project_id in player.projects)

    def ranking(self, state: GameState) -> list[PlayerState]:
        return sorted(state.players, key=self.score, reverse=True)
