"""Authoritative state transitions for City of Influence.

This first vertical slice owns the turn clock, economy, asset market, basic
actions and role acquisition. Remaining action-card and role powers are added
as dispatch handlers here, never in FastAPI or React.
"""

from __future__ import annotations

from math import floor
from typing import Any

from city_engine.commands import Command
from city_engine.constants import CAPACITY_COSTS, DISTRICT_IDS, MAX_CAPACITY, ROLE_IDS
from city_engine.content import ActionCardDefinition, AssetDefinition, ContentCatalog, load_catalog
from city_engine.errors import CityEngineError, IllegalActionError, InvalidCommandError, StaleRevisionError
from city_engine.models import (
    GameState,
    HeldCard,
    MarketAsset,
    OwnedAsset,
    PendingDecision,
    PlayerState,
    Transition,
)
from city_engine.rng import GameRNG

RARITY_MIN_ROUND = {"common": 1, "uncommon": 2, "rare": 3, "epic": 4, "legendary": 5}


class CityEngine:
    def __init__(self, catalog: ContentCatalog | None = None) -> None:
        self.catalog = catalog or load_catalog()
        self._handlers = {
            "basic_action": self._basic_action,
            "city_project": self._city_project,
            "buy_capacity": self._buy_capacity,
            "buy_roof": self._buy_roof,
            "buy_asset": self._buy_asset,
            "improve_asset": self._improve_asset,
            "sell_asset": self._sell_asset,
            "develop_district": self._develop_district,
            "crisis_pr": self._crisis_pr,
            "buy_action_card": self._buy_action_card,
            "convert_action_card": self._convert_action_card,
            "play_action_card": self._play_action_card,
            "use_role_power": self._use_role_power,
            "grey_operation": self._grey_operation,
            "resolve_decision": self._resolve_decision,
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
        if state.pending_decision is not None:
            if command.type != "resolve_decision" or command.actor_id != state.pending_decision.actor_id:
                raise IllegalActionError("the game is waiting for another player's decision")
        elif command.actor_id != state.current_player.id:
            raise IllegalActionError("only the current player may act")
        elif command.type == "resolve_decision":
            raise IllegalActionError("there is no pending decision")
        handler = self._handlers.get(command.type)
        if handler is None:
            raise InvalidCommandError(f"unsupported command: {command.type}")

        next_state = state.clone()
        event_start = len(next_state.event_log)
        handler(next_state, command)
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
        if state.pending_decision is not None:
            if actor_id != state.pending_decision.actor_id:
                return []
            candidates = [
                Command(
                    type="resolve_decision",
                    actor_id=actor_id,
                    payload={"decision_id": state.pending_decision.id, "option": option},
                )
                for option in state.pending_decision.options
            ]
        elif actor_id != state.current_player.id:
            return []
        else:
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
            if player.money >= 2:
                candidates.append(Command(type="basic_action", actor_id=actor_id, payload={"kind": "campaign"}))
            if player.influence >= 3:
                candidates.append(Command(type="city_project", actor_id=actor_id))
            if player.roofs < self.roof_limit(player) and player.money >= (2 if self.has_role(player, "mafia") else 3):
                candidates.append(Command(type="buy_roof", actor_id=actor_id))
            if player.money >= 4 and player.scandals > 0:
                candidates.append(Command(type="crisis_pr", actor_id=actor_id))
            if player.scandals < 5:
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
            if can_invest and not owned.automated and not owned.scaled:
                candidates.extend(
                    [
                        Command(
                            type="improve_asset",
                            actor_id=actor_id,
                            payload={"asset_uid": owned.uid, "kind": "automate"},
                        ),
                        Command(
                            type="improve_asset",
                            actor_id=actor_id,
                            payload={"asset_uid": owned.uid, "kind": "scale"},
                        ),
                    ]
                )
            if can_act:
                candidates.append(
                    Command(
                        type="sell_asset",
                        actor_id=actor_id,
                        payload={"asset_uid": owned.uid},
                    )
                )
        if can_act:
            candidates.extend(
                Command(type="develop_district", actor_id=actor_id, payload={"district": district})
                for district in DISTRICT_IDS
                if self.district_count(player, district) >= 2 and player.district_levels[district] < 2
            )
            if player.money >= 3 and player.influence >= 1 and len(player.hand) < 3:
                candidates.extend(
                    Command(type="buy_action_card", actor_id=actor_id, payload={"card_id": card_id})
                    for card_id in state.action_market
                )
        for held in player.hand:
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
            else:
                candidates.append(Command(type="play_action_card", actor_id=actor_id, payload={"card_uid": held.uid}))
        candidates.extend(self._role_power_candidates(state, actor_id))
        active_asset_ids = {asset.card_id for asset in player.assets if not asset.blocked}
        for asset_id in ("cash", "crypto"):
            if not can_act or asset_id not in active_asset_ids:
                continue
            candidates.extend(
                Command(
                    type="grey_operation",
                    actor_id=actor_id,
                    payload={"asset_id": asset_id, "protect_failure": protect},
                )
                for protect in (False, True)
            )
        for asset_id in ("market", "datacenter"):
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
                    for protect in (False, True)
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

    def asset_value(self, owned: OwnedAsset) -> int:
        return floor(self.owned_definition(owned).cost / 2) + (2 if owned.automated else 0) + (2 if owned.scaled else 0)

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
        return sum(
            int(self.owned_definition(asset).effects.get(key, 0)) for asset in player.assets if not asset.blocked
        )

    def roof_limit(self, player: PlayerState) -> int:
        return (2 if self.has_role(player, "mafia") else 1) + self.effect_total(player, "roofCapacity")

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

    def _basic_action(self, state: GameState, command: Command) -> None:
        kind = command.payload.get("kind")
        player = state.current_player
        if kind == "work":
            self._spend_action(state)
            player.money += 2
        elif kind == "campaign":
            if player.money < 2:
                raise IllegalActionError("campaign requires 2 money")
            self._spend_action(state)
            player.money -= 2
            player.influence += 2
        else:
            raise InvalidCommandError("basic_action kind must be work or campaign")
        state.append_event("basic_action", player.id, kind=kind, money=player.money, influence=player.influence)

    def _city_project(self, state: GameState, command: Command) -> None:
        player = state.current_player
        if player.influence < 3:
            raise IllegalActionError("city project requires 3 influence")
        self._spend_action(state)
        player.influence -= 3
        player.projects += 1
        state.append_event("city_project_created", player.id, projects=player.projects)

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
        cost = 2 if self.has_role(player, "mafia") else 3
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
        if player.scandals >= 5:
            raise IllegalActionError("a player with 5 scandals cannot claim a role")
        cost = state.role_price * 3 if holder else state.role_price
        if player.influence < cost:
            raise IllegalActionError("not enough influence for the role")
        self._spend_action(state)
        player.influence -= cost

        if holder and holder.role_shields > 0:
            holder.role_shields -= 1
            state.append_event("role_takeover_blocked", player.id, role_id=role_id, by="role_shield")
            return
        if holder and holder.roofs > 0:
            holder.roofs -= 1
            state.append_event("role_takeover_blocked", player.id, role_id=role_id, by="roof")
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
        player.money -= cost
        player.influence += asset.influence
        if state.event_id == "election" and asset.district == "government":
            player.influence += asset.influence
        player.assets.append(OwnedAsset(uid=market_asset.uid, card_id=asset.id))
        state.market = [item for item in state.market if item.uid != market_uid]
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
        self.add_scandal(player, max(0, raw_scandals - reduction))
        self._refill_market(state, 1)
        state.append_event("asset_bought", player.id, asset_id=asset.id, market_uid=market_uid, cost=cost)

    def _improve_asset(self, state: GameState, command: Command) -> None:
        player = state.current_player
        asset_uid = self._payload_string(command, "asset_uid")
        kind = self._payload_string(command, "kind")
        if kind not in {"automate", "scale"}:
            raise InvalidCommandError("improvement kind must be automate or scale")
        owned = next((asset for asset in player.assets if asset.uid == asset_uid), None)
        if owned is None:
            raise IllegalActionError("asset is not owned by the player")
        if owned.automated or owned.scaled:
            raise IllegalActionError("asset is already improved")
        discount = int(state.turn_flags.get("upgrade_discount", 0))
        cost = max(1, (5 if kind == "automate" else 4) - discount)
        if player.money < cost:
            raise IllegalActionError("not enough money for the improvement")
        self._spend_action(state, investment_allowed=True)
        player.money -= cost
        owned.automated = kind == "automate"
        owned.scaled = kind == "scale"
        state.turn_flags["upgrade_discount"] = 0
        state.append_event("asset_improved", player.id, asset_uid=asset_uid, kind=kind, cost=cost)

    def _sell_asset(self, state: GameState, command: Command) -> None:
        player = state.current_player
        asset_uid = self._payload_string(command, "asset_uid")
        owned = next((asset for asset in player.assets if asset.uid == asset_uid), None)
        if owned is None:
            raise IllegalActionError("asset is not owned by the player")
        self._spend_action(state)
        value = self.asset_value(owned)
        player.assets = [asset for asset in player.assets if asset.uid != asset_uid]
        player.money += value
        state.append_event("asset_sold", player.id, asset_uid=asset_uid, value=value)

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
        player = state.current_player
        if player.money < 4 or player.scandals < 1:
            raise IllegalActionError("crisis PR requires 4 money and at least one scandal")
        self._spend_action(state)
        player.money -= 4
        player.scandals -= 1
        state.append_event("crisis_pr", player.id, scandals=player.scandals)

    def _draw_action_card(self, state: GameState, player: PlayerState) -> HeldCard | None:
        if len(player.hand) >= 3:
            return None
        card_id: str | None = None
        if state.action_deck:
            card_id = state.action_deck.pop(0)
        elif state.action_market:
            card_id = state.action_market.pop(0)
        if card_id is None:
            return None
        held = HeldCard(uid=f"card:{card_id}", card_id=card_id)
        player.hand.append(held)
        return held

    def _buy_action_card(self, state: GameState, command: Command) -> None:
        player = state.current_player
        card_id = self._payload_string(command, "card_id")
        if card_id not in state.action_market:
            raise IllegalActionError("action card is no longer on the market")
        if len(player.hand) >= 3:
            raise IllegalActionError("action-card hand limit reached")
        if player.money < 3 or player.influence < 1:
            raise IllegalActionError("action card requires 3 money and 1 influence")
        self._spend_action(state)
        state.action_market.remove(card_id)
        player.money -= 3
        player.influence -= 1
        player.hand.append(HeldCard(uid=f"card:{card_id}", card_id=card_id))
        state.append_event("action_card_bought", player.id, card_id=card_id)

    def _convert_action_card(self, state: GameState, command: Command) -> None:
        player = state.current_player
        card_uid = self._payload_string(command, "card_uid")
        into = self._payload_string(command, "into")
        if into not in {"money", "influence"}:
            raise InvalidCommandError("card conversion must be money or influence")
        held = next((card for card in player.hand if card.uid == card_uid), None)
        if held is None:
            raise IllegalActionError("action card is not in the player's hand")
        player.hand.remove(held)
        if into == "money":
            player.money += 1
        else:
            player.influence += 1
        state.append_event("action_card_converted", player.id, card_id=held.card_id, into=into)

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
        if card.targeted and target is not None:
            self._apply_attacker_card_bonus(state, player, target, card)
            if target.roofs > 0:
                state.pending_decision = PendingDecision(
                    id=f"decision:{state.revision + 1}:{len(state.event_log) + 1}",
                    actor_id=target.id,
                    type="roof_defence",
                    options=["use_roof", "accept"],
                    context={
                        "source": "action_card",
                        "attacker_id": player.id,
                        "target_id": target.id,
                        "card_id": card.id,
                    },
                )
                state.append_event(
                    "decision_requested",
                    target.id,
                    decision_id=state.pending_decision.id,
                    decision_type="roof_defence",
                    source_card_id=card.id,
                )
            else:
                self._apply_targeted_card_effect(state, player, target, card)
        else:
            self._apply_self_card_effect(state, player, card, command)
        state.append_event("action_card_played", player.id, card_id=card.id, target_id=target.id if target else None)

    def _validate_card_target(self, card: ActionCardDefinition, target: PlayerState) -> None:
        if card.kind == "role_pressure" and target.role is None:
            raise IllegalActionError("role pressure requires a role holder")
        if card.kind == "freeze" and not target.assets:
            raise IllegalActionError("freeze requires a target asset")
        if card.kind == "remove_upgrade" and not any(asset.automated or asset.scaled for asset in target.assets):
            raise IllegalActionError("target has no asset improvements")

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
        if card.kind == "influence_to_cash" and player.influence < 2:
            raise IllegalActionError("tax manoeuvre requires 2 influence")
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
        if card.kind == "upgrade_discount" and not any(
            not asset.automated and not asset.scaled for asset in player.assets
        ):
            raise IllegalActionError("there is no asset to improve")
        if card.kind == "unblock" and not any(asset.blocked for asset in player.assets):
            raise IllegalActionError("there is no blocked asset")

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
            player.money += card.value
            player.influence += int(any("ai" in self.owned_definition(asset).tags for asset in player.assets))
        elif kind == "bridge_loan":
            player.money += card.value
            player.debt += 4
        elif kind == "district_cash":
            district = str(command.payload["district"])
            player.money += min(10, self.district_count(player, district) * card.value)
        elif kind == "influence":
            player.money -= 2
            player.influence += card.value
        elif kind == "market_discount":
            state.turn_flags["market_discount"] = card.value
        elif kind == "upgrade_discount":
            state.turn_flags["upgrade_discount"] = card.value
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
        elif kind == "comeback":
            is_last = self.ranking(state)[-1].id == player.id
            player.money += state.round_number * 2 if is_last else 3
        elif kind == "influence_to_cash":
            player.influence -= 2
            player.money += card.value
        elif kind == "project":
            player.projects += 1
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
            attacker.money += 2
        elif card.kind == "double_scandal":
            self.add_scandal(attacker, 1)
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
        if kind == "scandal":
            self.add_scandal(target, card.value)
        elif kind == "fine":
            if target.money >= card.value:
                target.money -= card.value
            else:
                target.money = 0
                self.add_scandal(target, 1)
        elif kind == "steal":
            target.money = max(0, target.money - card.value)
        elif kind == "role_pressure":
            if target.influence >= card.value:
                target.influence -= card.value
            else:
                target.influence = 0
                target.role = None
        elif kind == "double_scandal":
            self.add_scandal(target, card.value)
        elif kind == "blackmail":
            target.influence = max(0, target.influence - card.value)
        elif kind == "freeze":
            max(target.assets, key=lambda asset: self.owned_definition(asset).income).blocked = True
        elif kind == "expose":
            self.add_scandal(target, 1)
        elif kind == "remove_upgrade":
            upgraded = max(
                (asset for asset in target.assets if asset.automated or asset.scaled),
                key=self.asset_value,
            )
            upgraded.automated = False
            upgraded.scaled = False
        elif kind == "mixed_fine":
            target.money = max(0, target.money - 2)
            target.influence = max(0, target.influence - 1)
        else:
            raise InvalidCommandError(f"unsupported targeted card kind: {kind}")
        state.append_event(
            "targeted_card_resolved",
            attacker.id,
            card_id=card.id,
            target_id=target.id,
        )

    def _resolve_decision(self, state: GameState, command: Command) -> None:
        decision = state.pending_decision
        if decision is None:
            raise IllegalActionError("there is no pending decision")
        if command.payload.get("decision_id") != decision.id:
            raise IllegalActionError("decision id does not match the pending decision")
        option = self._payload_string(command, "option")
        if option not in decision.options:
            raise InvalidCommandError("unknown decision option")
        if decision.type != "roof_defence" or decision.context.get("source") != "action_card":
            raise InvalidCommandError(f"unsupported pending decision: {decision.type}")
        target = state.player_by_id(str(decision.context["target_id"]))
        attacker = state.player_by_id(str(decision.context["attacker_id"]))
        card = self.action_card(str(decision.context["card_id"]))
        state.pending_decision = None
        if option == "use_roof":
            if target.roofs < 1:
                raise IllegalActionError("the target no longer has a roof")
            target.roofs -= 1
            state.append_event("targeted_effect_blocked", target.id, card_id=card.id, by="roof")
        else:
            self._apply_targeted_card_effect(state, attacker, target, card)
        state.append_event("decision_resolved", target.id, decision_id=decision.id, option=option)

    def _require_role(self, player: PlayerState, role_id: str) -> None:
        if not self.has_role(player, role_id):
            raise IllegalActionError(f"this power requires the {role_id} role")

    def _use_role_power(self, state: GameState, command: Command) -> None:
        player = state.current_player
        power = self._payload_string(command, "power")
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
                self.add_scandal(target, 1)
            else:
                self.add_scandal(player, 1)
                self.add_scandal(target, 1)
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
        state.append_event("role_power_used", player.id, power=power)

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
            3
            + self.district_count(player, "shadows")
            + self.district_count(player, "residential")
            + int(state.turn_flags.get("mafia_operation_bonus", 0))
            + floor(state.round_number * 2 / 3)
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
            self.add_scandal(player, 1)

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

    def _military_sanction(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "military")
        self._once_per_turn(state, "military_sanction")
        target = self._target_player(state, player, self._payload_string(command, "target_id"))
        if target.scandals < 2:
            raise IllegalActionError("sanction requires a target with at least two scandals")
        self._spend_action(state)
        confiscated: OwnedAsset | None = None
        if target.roofs > 0:
            target.roofs -= 1
        elif target.scandals <= 3:
            seized = min(target.money, 3 + state.round_number)
            target.money -= seized
            player.money += seized
        elif len(target.assets) > 1:
            confiscated = max(target.assets, key=self.asset_value)
            target.assets.remove(confiscated)
        target.scandals = max(0, target.scandals - 1)
        if confiscated is not None:
            if len(player.assets) < player.capacity:
                player.assets.append(confiscated)
            else:
                weakest = min(player.assets, key=self.asset_value)
                if self.asset_value(confiscated) > self.asset_value(weakest):
                    player.assets.remove(weakest)
                    player.money += self.asset_value(weakest)
                    player.assets.append(confiscated)
                else:
                    player.money += self.asset_value(confiscated)

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
        self.add_scandal(player, max(0, amount - reduction))

    def _fraudster_forge(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "fraudster")
        self._once_per_turn(state, "fraudster_forge")
        role_id = self._payload_string(command, "role_id")
        if role_id not in ROLE_IDS:
            raise InvalidCommandError(f"unknown role: {role_id}")
        if state.actions_left < 4 or player.influence < 5:
            raise IllegalActionError("forgery requires 4 actions and 5 influence")
        state.actions_left -= 4
        player.influence -= 5
        chance = min(0.9, 0.5 + self.district_count(player, "tech") * 0.1)
        if GameRNG(state.rng).chance(chance):
            player.pending_role = role_id
        else:
            player.role = None
            player.copied_role = None
            player.pending_role = None
            player.roofs = max(0, player.roofs - 1)
            player.scandals = 3
            player.jail_turns = 1

    def _grey_operation(self, state: GameState, command: Command) -> None:
        player = state.current_player
        asset_id = self._payload_string(command, "asset_id")
        if asset_id not in {"cash", "market", "crypto", "datacenter"}:
            raise InvalidCommandError("unknown grey operation asset")
        if not any(asset.card_id == asset_id and not asset.blocked for asset in player.assets):
            raise IllegalActionError("the required grey asset is not active")
        target: PlayerState | None = None
        if asset_id in {"market", "datacenter"}:
            target = self._target_player(state, player, self._payload_string(command, "target_id"))
            if asset_id == "datacenter" and not target.assets:
                raise IllegalActionError("datacenter operation requires a target asset")
        if asset_id == "cash" and player.influence < 2:
            raise IllegalActionError("laundering requires 2 influence")
        self._spend_action(state)

        place = next(index for index, ranked in enumerate(self.ranking(state), start=1) if ranked.id == player.id)
        fraud_bonus = [0, 0.05, 0.1, 0.2][min(3, place - 1)] if self.has_role(player, "fraudster") else 0
        tech_bonus = min(0.1, self.district_count(player, "tech") * 0.05) if self.has_role(player, "fraudster") else 0
        base = {"cash": 0.85, "market": 0.75, "crypto": 0.60, "datacenter": 0.55}[asset_id]
        chance = min(0.9, base + fraud_bonus + tech_bonus)
        success = GameRNG(state.rng).chance(chance)
        comeback = floor((place - 1) * state.round_number / 3) if self.has_role(player, "fraudster") else 0
        if success:
            self._resolve_grey_success(state, player, target, asset_id, comeback)
            operation_scandals = 2 if asset_id == "datacenter" else 1
            self.add_scandal(
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
        )

    def _resolve_grey_success(
        self,
        state: GameState,
        player: PlayerState,
        target: PlayerState | None,
        asset_id: str,
        comeback: int,
    ) -> None:
        if asset_id == "cash":
            player.influence -= 2
            player.money += 5 + state.round_number + comeback
        elif asset_id == "market" and target is not None:
            cap = 3 + floor(state.round_number / 2)
            if target.roofs > 0:
                target.roofs -= 1
                player.money += comeback
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
                else:
                    leader.money = max(0, leader.money - (2 + floor(state.round_number / 2)))
        elif asset_id == "datacenter" and target is not None:
            player.money += comeback
            max(target.assets, key=lambda asset: self.owned_definition(asset).income).blocked = True

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
            player.influence = max(0, player.influence - 3)
            player.money = max(0, player.money - 3)
        elif asset_id == "market":
            if player.roofs > 0:
                player.roofs -= 1
        elif asset_id == "crypto":
            player.money = max(0, player.money - 5)
            for asset in player.assets:
                if asset.card_id == "crypto":
                    asset.automated = False
                    asset.scaled = False
        elif asset_id == "datacenter":
            for asset in player.assets:
                if asset.card_id == "datacenter":
                    asset.blocked = True
                    asset.automated = False
                    asset.scaled = False
        failure_scandals = 1 if self.has_role(player, "fraudster") else 3 if asset_id in {"crypto", "datacenter"} else 2
        self.add_scandal(
            player,
            max(0, failure_scandals - self.effect_total(player, "greyScandalReduction")),
        )

    def add_scandal(self, player: PlayerState, amount: int) -> None:
        if amount <= 0:
            player.scandals = max(0, player.scandals + amount)
            return
        if player.scandal_shields > 0:
            player.scandal_shields -= 1
            return
        next_value = player.scandals + amount
        player.scandal_gained_this_round += amount
        if next_value >= 6:
            player.scandals = 3
            player.role = None
            player.copied_role = None
            player.pending_role = None
            player.roofs = max(0, player.roofs - 1)
            player.jail_turns = 1
        elif next_value >= 5:
            player.scandals = 5
            player.role = None
            player.copied_role = None
            player.pending_role = None
        else:
            player.scandals = next_value

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
            state.current_player_index = (state.current_player_index + 1) % len(state.players)
            state.turn_serial += 1
            self._rotate_expired_market(state)
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
        state.current_player_index = state.starting_player_index
        state.turn_serial += 1
        state.antitrust_active = False
        self._rotate_expired_market(state)
        self._rotate_action_market(state)
        self._prepare_current_player(state)
        state.append_event("round_started", round_number=state.round_number, player_id=state.current_player.id)

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
        expired = [item for item in state.market if item.expires_at_turn <= state.turn_serial]
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
            if len(drawn) < needed and state.round_number >= RARITY_MIN_ROUND[asset.rarity]:
                drawn.append(card_id)
            else:
                remaining.append(card_id)
        state.market_deck = remaining
        state.market.extend(
            MarketAsset(
                uid=f"asset:{card_id}",
                card_id=card_id,
                expires_at_turn=state.turn_serial + len(state.players) * 2,
            )
            for card_id in drawn
        )

    def _rotate_action_market(self, state: GameState) -> None:
        available = [*state.action_deck, *state.action_market]
        GameRNG(state.rng).shuffle(available)
        state.action_market = available[:3]
        state.action_deck = available[3:]
        state.append_event("action_market_rotated", card_ids=list(state.action_market))

    def _settle_round(self, state: GameState) -> None:
        incomes = {player.id: self._round_income(state, player) for player in state.players}
        income_sources = {
            player.id: {
                "operations": incomes[player.id],
                "mafia_tribute": 0,
                "journalist": 0,
                "debt": -player.debt,
            }
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
                    controls = mafia_count > 0 and all(
                        other.id == mafia.id or self.district_count(other, district) < mafia_count
                        for other in state.players
                    )
                    if controls and self.district_count(victim, district) < mafia_count:
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
            journalist_cash = (
                sum(other.scandals for other in state.players if other.id != player.id) if journalist else 0
            )
            income_sources[player.id]["journalist"] = journalist_cash
            player.money = max(0, player.money + incomes[player.id] + journalist_cash - player.debt)
            player.influence += self.passive_influence(player) + news + rating
            player.debt = 0
            player.zoning_district = None
            player.scandal_gained_this_round = 0
            player.copied_role = None
            for asset in player.assets:
                asset.blocked = False
        state.append_event(
            "round_settled",
            round_number=state.round_number,
            incomes=incomes,
            income_sources=income_sources,
        )

    def _round_income(self, state: GameState, player: PlayerState) -> int:
        maintenance = max(0, len(player.assets) - self.effect_total(player, "maintenanceReduction"))
        income = -maintenance
        event = self.catalog.events[state.event_id]
        for owned in player.assets:
            if owned.blocked:
                continue
            asset = self.owned_definition(owned)
            event_multiplier = event.income_multiplier if event.district == asset.district else 1
            base = floor(
                (asset.income + (2 if owned.scaled else 0))
                * (1 + player.district_levels[asset.district] * 0.25)
                * (event_multiplier or 1)
            )
            object_income = base + self.object_synergy_income(state, player, owned) + event.global_income
            if state.antitrust_active and self.district_count(player, asset.district) >= 4:
                object_income = floor(object_income / 2)
            income += object_income
        return income

    def object_synergy_income(self, state: GameState, player: PlayerState, owned: OwnedAsset) -> int:
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
        return (district_bonus + role_bonus + special) * (2 if owned.automated else 1)

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

    def passive_influence(self, player: PlayerState) -> int:
        def multiplier(asset: OwnedAsset) -> int:
            return 2 if asset.automated else 1

        active = [asset for asset in player.assets if not asset.blocked]
        administrative = 0
        if self.has_role(player, "politician"):
            administrative = sum(
                multiplier(asset) for asset in active if self.owned_definition(asset).district == "government"
            )
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
                object_effects += int(bonus["value"]) * multiplier(owned)
        return administrative + object_effects

    def score(self, player: PlayerState) -> int:
        asset_score = sum(
            floor(self.owned_definition(asset).cost / 2) + (2 if asset.automated else 0) + (2 if asset.scaled else 0)
            for asset in player.assets
        )
        return (
            player.money
            + player.influence
            + asset_score
            + player.projects * 6
            + (3 if player.role else 0)
            - player.scandals
        )

    def ranking(self, state: GameState) -> list[PlayerState]:
        return sorted(state.players, key=self.score, reverse=True)
