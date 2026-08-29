"""Authoritative state transitions for City of Influence.

This first vertical slice owns the turn clock, economy, asset market, basic
actions and role acquisition. Remaining action-card and role powers are added
as dispatch handlers here, never in FastAPI or React.
"""

from __future__ import annotations

from math import floor
from typing import Any

from city_engine.commands import Command
from city_engine.constants import (
    ACTION_CARD_COST,
    BASE_SCANDAL_LIMIT,
    CAMPAIGN_TIERS,
    CAPACITY_COSTS,
    CARD_DISCARD_VALUE,
    CARD_PURCHASE_FLAG,
    CASH_TO_INFLUENCE_MONEY,
    CONSEQUENCE_EVENTS,
    CRISIS_PR_INFLUENCE,
    CRYPTO_SCAM_SCANDALS,
    CRYPTO_SCAM_SHARE,
    DISTRICT_IDS,
    FRAUDSTER_GREY_BONUS,
    GREY_FAILURE_SCANDALS,
    GREY_OPERATION_CHANCE,
    GREY_OPERATION_FLAG,
    GREY_OPERATION_POINTS,
    GREY_SUCCESS_SCANDALS,
    HACK_INFLUENCE_BASE,
    HAND_LIMIT,
    INFLUENCE_PER_POINT,
    JOURNALIST_SCANDAL_LIMIT,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MARKET_ROTATION_SIZE,
    MAX_CAPACITY,
    MILITARY_SEIZE_INFLUENCE,
    MONEY_PER_POINT,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
    POINTS_CARD_RATE,
    POLITICIAN_DEAL_INFLUENCE,
    POLITICIAN_VETO_INFLUENCE,
    PROJECT_BOARD_SIZE,
    PROJECT_REROLL_MONEY,
    PUBLICATION_SCANDALS,
    PUMP_DRAIN_BASE,
    RACKET_LEADER_BONUS,
    ROLE_IDS,
    ROOF_BREAK_POINT_PER_ROOF,
    SANCTION_INFLUENCE_TIER,
    SANCTION_MONEY_TIER,
    SANCTION_ROLE_TIER,
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
            "reroll_projects": self._reroll_projects,
            "sell_asset": self._sell_asset,
            "market_refresh": self._market_refresh,
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
        self._order_command_events(next_state, event_start)
        next_state.command_log.append(command.to_dict())
        next_state.revision += 1
        if command.command_id:
            next_state.processed_command_ids.append(command.command_id)
            next_state.processed_command_ids = next_state.processed_command_ids[-100:]
        next_state.validate()
        return Transition(state=next_state, events=next_state.event_log[event_start:])

    def _order_command_events(self, state: GameState, event_start: int) -> None:
        """Print the deed before its fallout.

        Handlers naturally emit in the wrong order: an attack has to resolve its damage first
        (that is where the blocks, the stripped role and the arrest are decided) and only then
        can it report itself, because the headline carries the resource deltas of the whole
        play. The log therefore read backwards — «роль потеряна» on line 118 and the operation
        that took it on line 119 — and players kept asking why an effect had no cause.

        Rather than make every handler announce itself twice, the slice of events produced by
        one command is stably partitioned here: consequences move behind the deed, everything
        else keeps its order. Stable on both sides, so several blocks or several stripped roles
        still read in the order they happened.
        """
        tail = state.event_log[event_start:]
        if len(tail) < 2:
            return
        deeds = [event for event in tail if event.type not in CONSEQUENCE_EVENTS]
        fallout = [event for event in tail if event.type in CONSEQUENCE_EVENTS]
        if not deeds or not fallout:
            return
        reordered = deeds + fallout
        for offset, event in enumerate(reordered):
            event.seq = event_start + offset + 1
        state.event_log[event_start:] = reordered

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
        candidates = [Command(type="end_turn", actor_id=actor_id)]
        if can_act:
            candidates.append(Command(type="basic_action", actor_id=actor_id, payload={"kind": "work"}))
            # One action, three exchange rates: the tier is the decision, not whether to campaign.
            candidates.extend(
                Command(type="basic_action", actor_id=actor_id, payload={"kind": "campaign", "spend": spend})
                for spend in CAMPAIGN_TIERS
                if player.money >= spend
            )
            if player.money >= PATRONAGE_MONEY:
                candidates.append(Command(type="basic_action", actor_id=actor_id, payload={"kind": "patronage"}))
            if player.influence >= LOBBYING_INFLUENCE:
                candidates.append(Command(type="basic_action", actor_id=actor_id, payload={"kind": "lobbying"}))
            candidates.extend(
                Command(type="city_project", actor_id=actor_id, payload={"project_id": project_id})
                for project_id in state.project_board
            )
            # The charter is a separate offer rather than a fallback inside the ordinary one: it is
            # worth exactly one project per game, so taking it has to be a choice the player sees.
            if not player.project_waiver_used and self.effect_total(player, "projectWaiver") > 0:
                candidates.extend(
                    Command(
                        type="city_project",
                        actor_id=actor_id,
                        payload={"project_id": project_id, "use_waiver": True},
                    )
                    for project_id in state.project_board
                    if not self.project_requirement_met(player, self.project(project_id))
                )
            if player.roofs < self.roof_limit(player) and player.money >= self.roof_price(state, player):
                candidates.append(Command(type="buy_roof", actor_id=actor_id))
            if player.influence >= CRISIS_PR_INFLUENCE and player.scandals > 0:
                candidates.append(Command(type="crisis_pr", actor_id=actor_id))
            # Same gate as _claim_role: everybody buys a seat under BASE_SCANDAL_LIMIT, including
            # the journalist, whose higher ceiling applies only to the seat they already hold.
            if player.scandals < BASE_SCANDAL_LIMIT:
                candidates.extend(
                    Command(type="claim_role", actor_id=actor_id, payload={"role_id": role_id})
                    for role_id in ROLE_IDS
                    if self.role_holder(state, role_id) is not player
                    and player.influence
                    >= (state.role_price * 3 if self.role_holder(state, role_id) else state.role_price)
                )
        if can_act:
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
            # Selling costs no action, so it stays available with an empty counter — see _sell_asset.
            candidates.append(Command(type="sell_asset", actor_id=actor_id, payload={"asset_uid": owned.uid}))
        # The re-deal costs no action either, so it too survives an empty counter.
        if self.market_refresh_available(state, player) and state.market_deck:
            candidates.extend(
                Command(type="market_refresh", actor_id=actor_id, payload={"market_uid": item.uid})
                for item in state.market
            )
        # The project re-deal spends an action now, so unlike the market reroll it disappears once
        # the turn is out of actions.
        if can_act and player.money >= PROJECT_REROLL_MONEY and state.project_deck:
            candidates.append(Command(type="reroll_projects", actor_id=actor_id))
        if (
            can_act
            and not self._flag(state, CARD_PURCHASE_FLAG)
            and player.money >= ACTION_CARD_COST
            and player.influence >= 1
            and len(player.hand) < HAND_LIMIT
        ):
            candidates.append(Command(type="buy_action_card", actor_id=actor_id))
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
                    if target.id != actor_id or card.self_target
                )
            elif card.kind in {"district_cash", "zoning"}:
                candidates.extend(
                    Command(
                        type="play_action_card",
                        actor_id=actor_id,
                        payload={"card_uid": held.uid, "district": district},
                    )
                    for district in DISTRICT_IDS
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
            else:
                candidates.append(Command(type="play_action_card", actor_id=actor_id, payload={"card_uid": held.uid}))
        candidates.extend(self._role_power_candidates(state, actor_id))
        # One grey operation a turn, so once it is spent none of them are on offer any more.
        can_run_grey = can_act and not self._flag(state, GREY_OPERATION_FLAG)
        for asset_id in ("smear", "crypto"):
            if not can_run_grey or not self.grey_operation_unlocked(player, asset_id):
                continue
            candidates.append(Command(type="grey_operation", actor_id=actor_id, payload={"asset_id": asset_id}))
        for asset_id in ("roof_break", "datacenter", "influence_broker"):
            if not can_run_grey or not self.grey_operation_unlocked(player, asset_id):
                continue
            for target in state.players:
                if target.id == actor_id:
                    continue
                # Both of these need something to take away: a roof to break, a role to leak. An
                # offer that cannot change anything is noise in a panel of five.
                if asset_id == "roof_break" and target.roofs < 1:
                    continue
                if asset_id == "influence_broker" and target.role is None:
                    continue
                candidates.append(
                    Command(
                        type="grey_operation",
                        actor_id=actor_id,
                        payload={"asset_id": asset_id, "target_id": target.id},
                    )
                )
        return candidates

    def _role_power_candidates(self, state: GameState, actor_id: str) -> list[Command]:
        player = state.current_player
        candidates: list[Command] = []
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
                    payload={"power": "politician_deal", "district": district},
                )
                for district in DISTRICT_IDS
            )
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "politician_veto", "project_id": project_id},
                )
                for project_id in state.project_board
            )
        if self.has_role(player, "capitalist"):
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "capitalist_claim", "market_uid": item.uid},
                )
                for item in state.market
                if item.claimed_by != actor_id
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
                    payload={"power": "mafia_cleanup"},
                )
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
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "mafia_lock", "market_uid": item.uid},
                )
                for item in state.market
                if item.locked_by != actor_id
            )
        if self.has_role(player, "military"):
            if self.inspection_targets(state, player):
                candidates.append(
                    Command(
                        type="use_role_power",
                        actor_id=actor_id,
                        payload={"power": "military_inspection"},
                    )
                )
            candidates.extend(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "military_roof_seize", "target_id": target.id},
                )
                for target in state.players
                if target.id != actor_id and target.roofs > 0
            )
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
            candidates.append(
                Command(
                    type="use_role_power",
                    actor_id=actor_id,
                    payload={"power": "fraudster_crypto_scam"},
                )
            )
        return candidates

    @staticmethod
    def has_role(player: PlayerState, role_id: str) -> bool:
        """Roles are held, never borrowed: forging and copying are gone, so this is one comparison.

        It used to also accept `copied_role`, which meant every rule in the engine had two ways to
        be true and the client had two role fields to render — for a mechanic used three times in
        eight measured player-games, every one of them a no-op.
        """
        return player.role == role_id

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

    def effective_assets(self, player: PlayerState) -> list[OwnedAsset]:
        """What pays the player: the portfolio, plus the card the capitalist has marked.

        The mark is the role's whole active ability — a card on the open market earns for the
        capitalist as if it stood in their city, while everyone else can still buy it out from
        under them at the ordinary price. So every rule that asks "what does this player have"
        goes through here, and only the three that ask "what does this player *own*" do not:
        the score, the slot count and the sale. A marked card that also scored would make the
        mark strictly better than the purchase it is supposed to compete with.
        """
        if not player.marked_card_id:
            return player.assets
        return [*player.assets, OwnedAsset(uid=f"mark:{player.id}", card_id=player.marked_card_id)]

    def project_requirement_met(self, player: PlayerState, project: ProjectDefinition) -> bool:
        """Every condition is a count of things already on the table, so a player can read it."""
        requirement = project.requirement
        kind = str(requirement.get("type", "none"))
        needed = int(requirement.get("count", 1))
        if kind == "none":
            return True
        if kind == "assets":
            return len(self.effective_assets(player)) >= needed
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
            return sum(tag in self.owned_definition(asset).tags for asset in self.effective_assets(player)) >= needed
        raise InvalidCommandError(f"unknown project requirement: {kind}")

    def project_requirement_progress(self, player: PlayerState, project: ProjectDefinition) -> float:
        """How far along a condition is, from 0.0 to 1.0 — the partial credit ``met`` cannot give.

        A bot scoring only the moment a condition flips to met can never climb a three-step one:
        the first two objects are worth exactly zero, so multi-step projects only ever complete by
        accident. Conditions that cannot be approached gradually (a role, a scandal ceiling) stay
        binary, which is honest — there is no half of holding a role.
        """
        standing = self.project_requirement_standing(player, project)
        if standing["binary"]:
            return 1.0 if standing["met"] else 0.0
        return min(1.0, standing["have"] / standing["needed"])

    def project_requirement_standing(self, player: PlayerState, project: ProjectDefinition) -> dict[str, Any]:
        """Have/needed for a condition, or a plain yes/no for the ones with no halves.

        The client used to print the condition and leave the counting to the player — 13 of the 42
        projects gate on a tag, another 13 on a district, and across two measured games 16 tag
        projects left the board unused. Nobody was doing the arithmetic. This is that arithmetic,
        computed by the only component allowed to evaluate a condition.
        """
        requirement = project.requirement
        kind = str(requirement.get("type", "none"))
        needed = max(1, int(requirement.get("count", 1)))
        met = self.project_requirement_met(player, project)
        if kind in {"none", "role", "max_scandals"}:
            return {"binary": True, "met": met, "have": int(met), "needed": 1}
        if kind == "assets":
            have = len(self.effective_assets(player))
        elif kind == "district_objects":
            have = self.district_count(player, str(requirement["district"]))
        elif kind == "district_depth":
            have = max(self.district_count(player, district) for district in DISTRICT_IDS)
        elif kind == "distinct_districts":
            have = sum(self.district_count(player, district) > 0 for district in DISTRICT_IDS)
        elif kind == "tag_objects":
            tag = str(requirement["tag"])
            have = sum(tag in self.owned_definition(asset).tags for asset in self.effective_assets(player))
        else:
            raise InvalidCommandError(f"unknown project requirement: {kind}")
        return {"binary": False, "met": met, "have": have, "needed": needed}

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

    def _target_player(
        self,
        state: GameState,
        actor: PlayerState,
        target_id: str,
        *,
        allow_self: bool = False,
    ) -> PlayerState:
        try:
            target = state.player_by_id(target_id)
        except KeyError as exc:
            raise InvalidCommandError(f"unknown target player: {target_id}") from exc
        if target.id == actor.id and not allow_self:
            raise IllegalActionError("the player cannot target themselves")
        return target

    def district_count(self, player: PlayerState, district: str) -> int:
        """Everything that makes the player present in a district.

        Three sources, all public: objects standing in their city, the district «Зонирование»
        rents them for the round, and the market card the capitalist has marked. This is the
        number every gate reads — project conditions, grey unlocks, object synergy — so a mark
        opens exactly what a purchase would have opened.
        """
        return (
            self.owned_district_count(player, district)
            + int(player.zoning_district == district)
            + int(self.marked_district(player) == district)
        )

    def marked_district(self, player: PlayerState) -> str | None:
        """The district of the capitalist's marked card, if there is one."""
        return self.asset(player.marked_card_id).district if player.marked_card_id else None

    def owned_district_count(self, player: PlayerState, district: str) -> int:
        """Objects actually standing in the district — no zoning, no virtual anything.

        The role passives are paid on what the player built, not on a district they rented for one
        round with a card, so every one of them counts through here. Grey unlocks, project
        conditions and object synergy go through ``district_count`` instead, which is the one that
        honours the card.

        ``districtDouble`` is the exception that counts a real object twice. It is deliberately
        applied here rather than in ``district_count``: the whole point of the «Агломерация» is
        that the doubled quarter is *built*, so it has to reach the role passives too — and it must
        not multiply a district the player merely rented with «Зонирование».
        """
        objects = sum(self.owned_definition(asset).district == district for asset in player.assets)
        return objects * (1 + self.district_multiplier(player, district))

    def district_multiplier(self, player: PlayerState, district: str) -> int:
        """Extra copies each built object of this district is counted as. Zero for everybody else.

        Read off the portfolio directly rather than through ``effect_total``, because the value is
        a district name and not a number, and because the object granting it must be standing: a
        marked market card does not multiply what the player owns.
        """
        return sum(
            1
            for asset in player.assets
            if str(self.owned_definition(asset).effects.get("districtDouble", "")) == district
        )

    def effect_total(self, player: PlayerState, key: str) -> int:
        """Passive bonuses from objects and from completed projects share one vocabulary.

        A project perk cannot be taken away, which is exactly why perks are the reward for a
        finished project rather than another income line: an object can be sold or priced out of
        reach, a finished project is finished.
        """
        assets = sum(int(self.owned_definition(asset).effects.get(key, 0)) for asset in self.effective_assets(player))
        perks = sum(self.project(project_id).perk.get(key, 0) for project_id in player.projects)
        return assets + perks

    def grey_scandal_reduction(self, player: PlayerState) -> int:
        """Return the effective reduction for self-inflicted grey scandals.

        Objects and projects deliberately stack: assembling several pieces is a visible engine and
        earns the player the ability to make ordinary grey operations safe.
        """
        return self.effect_total(player, "greyScandalReduction")

    def roof_limit(self, player: PlayerState) -> int:
        """How many Крыша tokens a player may hold at once.

        One, because a token absorbs a takeover, a leak or a scandal and is deliberately scarce.
        The Мафия keeps its extra one — protection is the role's whole theme.
        """
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
        """The viewer's own price. The capitalist's -1$ for opening a district is gone: it fired
        three or four times a game for a dollar, against an income that reaches 39$ a round."""
        asset = self.asset(card_id)
        logistics_discount = int(
            asset.district == "industrial" and any(item.card_id == "logistics" for item in player.assets)
        )
        card_discount = int(state.turn_flags.get("market_discount", 0))
        return max(1, asset.cost - logistics_discount - card_discount)

    def _spend_action(self, state: GameState) -> None:
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
        """The four buttons that turn an action into something else.

        Campaign buys influence and work buys the coins that round a purchase up. Patronage and
        lobbying are the floor of the economy: neither currency scores by itself any more, so these
        two are the only way a pile becomes points without a slot, a card or a project condition.
        Both are priced badly on purpose and both are capped at one press a turn.
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
        elif kind == "lobbying":
            if player.influence < LOBBYING_INFLUENCE:
                raise IllegalActionError(f"lobbying requires {LOBBYING_INFLUENCE} influence")
            self._once_per_turn(state, "lobbying")
            self._spend_action(state)
            player.influence -= LOBBYING_INFLUENCE
            player.bonus_points += LOBBYING_POINTS
            tier = {"spend": LOBBYING_INFLUENCE, "gain": LOBBYING_POINTS}
        elif kind == "patronage":
            if player.money < PATRONAGE_MONEY:
                raise IllegalActionError(f"patronage requires {PATRONAGE_MONEY} money")
            # Once a turn, or the biggest pile simply buys the game: unbounded, four expert bots
            # pressed it 196 times in twelve games and the winner's margin went from 7.5 points to
            # 13. A drip is a decision; a dump is a conversion rate with extra steps.
            self._once_per_turn(state, "patronage")
            self._spend_action(state)
            player.money -= PATRONAGE_MONEY
            player.bonus_points += PATRONAGE_POINTS
            tier = {"spend": PATRONAGE_MONEY, "gain": PATRONAGE_POINTS}
        else:
            raise InvalidCommandError("basic_action kind must be work, campaign, patronage or lobbying")
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

    def project_cost(self, player: PlayerState, project: ProjectDefinition) -> tuple[int, int]:
        """What this project costs *this* player right now, as (influence, money).

        Every price in the game goes through a method like this one — the client must not recompute
        it, for the same reason it no longer recomputes asset discounts. The player argument stays
        even though nothing reads it yet: per-player project discounts are the obvious next perk,
        and every call site already passes it.
        """
        return project.cost_influence, project.cost_money

    def _city_project(self, state: GameState, command: Command) -> None:
        """Projects are a shared board: taking one denies it to everybody else for the whole game."""
        player = state.current_player
        project_id = self._payload_string(command, "project_id")
        project = self.project(project_id)
        if project_id not in state.project_board:
            raise IllegalActionError("this project is not on the city board")
        if state.project_veto.get(project_id) not in (None, player.id):
            raise IllegalActionError("this project is under a veto")
        cost_influence, cost_money = self.project_cost(player, project)
        if player.influence < cost_influence or player.money < cost_money:
            raise IllegalActionError("not enough resources for the project")
        waived = False
        if not self.project_requirement_met(player, project):
            # «Городской устав»: once a game, the condition is waived — the price is not. Taking a
            # project is three separate gates (the money, the built city, the action) and letting
            # one card open all three would hand out seven points for owning it. The waiver is
            # explicit in the payload rather than automatic: it is worth one project in the whole
            # game, and the engine must not spend it on the first condition a player happens to miss.
            if not command.payload.get("use_waiver"):
                raise IllegalActionError("the project condition is not met")
            if player.project_waiver_used or self.effect_total(player, "projectWaiver") < 1:
                raise IllegalActionError("there is no city charter to waive the condition")
            waived = True
        self._spend_action(state)
        if waived:
            player.project_waiver_used = True
        player.influence -= cost_influence
        player.money -= cost_money
        player.projects.append(project_id)
        state.project_veto.pop(project_id, None)
        state.project_board = [item for item in state.project_board if item != project_id]
        self._refill_project_board(state)
        state.append_event(
            "city_project_taken",
            player.id,
            project_id=project_id,
            points=project.points,
            cost_influence=cost_influence,
            cost_money=cost_money,
            waived=waived,
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
        for project_id in returned:
            state.project_veto.pop(project_id, None)
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
        state.project_veto.pop(expired, None)
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
        self._spend_action(state)
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
        # BASE_SCANDAL_LIMIT, not the claimant's own ceiling: the journalist's extra headroom is a
        # licence to run their own line dirty, not a licence to buy a different seat from a state
        # nobody else could buy one in. Gated on the holder's limit, a journalist on five scandals
        # could take any other role and land on `scandals == limit` — holding a seat at the exact
        # value at which every rule in the engine says the seat is already lost.
        if player.scandals >= BASE_SCANDAL_LIMIT:
            raise IllegalActionError("a player at the scandal limit cannot claim a role")
        cost = state.role_price * 3 if holder else state.role_price
        if player.influence < cost:
            raise IllegalActionError("not enough influence for the role")
        self._spend_action(state)
        player.influence -= cost

        # A blocked takeover costs the attempt (the action) and the defender's token, but the
        # influence comes back: paying full price for nothing was a silent 3-point tax, and in the
        # arena game it decided a match that finished four points apart.
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
            self._apply_role_limits(holder, state)
        previous_role = player.role
        player.role = role_id
        # Both sides re-checked: the claimant may be walking out of the journalist's ceiling or the
        # mafia's extra Крыша, and the dispossessed holder may be walking out of either.
        self._apply_role_limits(player, state)
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
        if self.market_locked_for(state, market_asset, player):
            raise IllegalActionError("a grey mark closes this slot")
        if len(player.assets) >= player.capacity:
            raise IllegalActionError("no free asset capacity")
        asset = self.asset(market_asset.card_id)
        cost = self.asset_price(state, player, asset.id)
        if player.money < cost:
            raise IllegalActionError("not enough money for the asset")
        self._spend_action(state)
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
        self._drop_market_marks(state, market_asset)
        state.market = [item for item in state.market if item.uid != market_asset.uid]
        state.turn_flags["market_discount"] = 0

        purchase = asset.effects.get("purchase", {})
        player.money += int(purchase.get("money", 0))
        player.influence += int(purchase.get("influence", 0))
        if purchase.get("roofs"):
            player.roofs = min(self.roof_limit(player), player.roofs + int(purchase["roofs"]))
        if purchase.get("card") and len(player.hand) < HAND_LIMIT:
            drawn = self._draw_action_card(state, player)
            if drawn:
                state.append_event(
                    "free_action_card_drawn",
                    player.id,
                    source_asset_id=asset.id,
                    card_id=drawn.card_id,
                )
        # Buying an object never costs scandals. The old rule charged +1⚠ for every «grey» tag and
        # +2⚠ for a couple of named cards, but it was invisible on the market card — the price line
        # showed money and influence only. A fraudster walking the intended route (grey objects →
        # greyScandalReduction projects) hit the 5⚠ limit during the purchases themselves, lost the
        # role and got arrested before the protection came online. Scandals now come only from
        # actions the player consciously takes: grey operations, publications, the crypto scam.
        self._refill_market(state, 1)

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
        self._drop_asset(player, owned)
        player.money += value
        state.append_event(
            "asset_sold",
            player.id,
            asset_uid=asset_uid,
            asset_id=owned.card_id,
            value=value,
        )

    @staticmethod
    def _drop_asset(player: PlayerState, owned: OwnedAsset) -> None:
        player.assets = [asset for asset in player.assets if asset.uid != owned.uid]

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
        if len(player.hand) >= HAND_LIMIT or not state.action_deck:
            return None
        card_id = state.action_deck.pop(0)
        # The deck holds duplicates, so the card id alone no longer identifies a card in hand — two
        # copies would share a uid, and every lookup takes the first match while the client keys its
        # hand by it. The deck only ever shrinks, so its remaining length is a free serial number.
        held = HeldCard(uid=f"card:{card_id}:{len(state.action_deck)}", card_id=card_id)
        player.hand.append(held)
        return held

    def _buy_action_card(self, state: GameState, command: Command) -> None:
        """A blind draw for an action, once a turn.

        Cards used to be a face-up market bought without spending an action, which made buying
        the influence card strictly better than the campaign action — 5$ into 3◆ for free while
        the basic action gave 2◆ and ate a turn slot. Now the card is random and costs the action,
        so it competes honestly, and a bad draw is cushioned by a stronger discard.

        The turn cap moved here from the play and the discard. Those two were capped because
        buying twice and shredding everything was a better influence pump than the campaign; the
        cap on the *supply* closes that without freezing the hand a player already paid for.
        """
        player = state.current_player
        if self._flag(state, CARD_PURCHASE_FLAG):
            raise IllegalActionError("only one action-card purchase per turn")
        if len(player.hand) >= HAND_LIMIT:
            raise IllegalActionError("action-card hand limit reached")
        if player.money < ACTION_CARD_COST or player.influence < 1:
            raise IllegalActionError(f"an action card requires {ACTION_CARD_COST} money and 1 influence")
        if not state.action_deck:
            raise IllegalActionError("the action deck is empty")
        self._spend_action(state)
        self._mark_flag(state, CARD_PURCHASE_FLAG)
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
        """Discard one card for a consolation unit. No action, no turn cap.

        The cap used to live here: a purchase draws two cards and a discard costs no action, so
        shredding both in one turn turned the blind draw into the best influence pump in the game.
        That is now closed at the source — one purchase a turn — and the hand a player already
        paid for is theirs to spend at whatever speed they like.
        """
        player = state.current_player
        card_uid = self._payload_string(command, "card_uid")
        into = self._payload_string(command, "into")
        if into not in {"money", "influence"}:
            raise InvalidCommandError("card conversion must be money or influence")
        held = next((card for card in player.hand if card.uid == card_uid), None)
        if held is None:
            raise IllegalActionError("action card is not in the player's hand")
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
        card = self.action_card(held.card_id)
        target: PlayerState | None = None
        if card.targeted:
            target = self._target_player(
                state,
                player,
                self._payload_string(command, "target_id"),
                allow_self=card.self_target,
            )
            self._validate_card_target(card, target)
        self._validate_card_costs(state, player, card, command)

        player.hand.remove(held)
        before = self._resource_snapshot(state)
        if card.targeted and target is not None:
            if target.id == player.id:
                # Played on yourself. A Крыша does not answer — it never cancels a scandal its own
                # owner chose, which is the rule add_scandal is built around — and the attacker's
                # side of the card is skipped, because there is no attacker: paying the leader
                # bonus or the theft to the player who is also the victim would mint resources.
                self._apply_targeted_card_effect(state, player, target, card)
            elif target.roofs > 0:
                # Roof automatically absorbs the incoming effect — no player decision. The attacker's
                # own side of the card is skipped with it: the loot, the influence and above all the
                # self-scandal are the price of damage done, and a blocked card does none.
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, card_id=card.id, by="roof")
            else:
                self._apply_attacker_card_bonus(state, player, target, card)
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
        if card.kind == "buy_points" and player.money < card.value * POINTS_CARD_RATE:
            raise IllegalActionError(f"this card requires {card.value * POINTS_CARD_RATE} money")
        if card.kind == "capacity" and player.capacity >= MAX_CAPACITY:
            raise IllegalActionError("the business is already at the slot limit")
        if card.kind in {"district_cash", "zoning"}:
            district = self._payload_string(command, "district")
            if district not in DISTRICT_IDS:
                raise InvalidCommandError(f"unknown district: {district}")
            # «Зонирование» opens a district the player does not have; requiring them to own one
            # already made it a multiplier on a quarter they had rather than a way into a new one,
            # which is the only reason to play it: a government project, a grey operation, or the
            # synergy step that needs one more object. The cash card keeps the gate — it pays per
            # object, so with none it would pay nothing anyway.
            if card.kind == "district_cash" and self.district_count(player, district) < 1:
                raise IllegalActionError("the selected district needs an owned object")
        if card.kind == "market_discount" and (len(player.assets) >= player.capacity or not state.market):
            raise IllegalActionError("there is no available object purchase")
        if card.kind == "project":
            project_id = self._payload_string(command, "project_id")
            if project_id not in state.project_board:
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
        elif kind == "zoning":
            player.zoning_district = str(command.payload["district"])
        elif kind == "buy_points":
            # The one sink that does not need a slot, which is why it exists at all.
            player.money -= card.value * POINTS_CARD_RATE
            player.bonus_points += card.value
        elif kind == "district_points":
            # Rewards a wide portfolio, which is the one thing the mono-district meta never gives.
            spread = sum(1 for district in DISTRICT_IDS if self.district_count(player, district) >= 2)
            player.bonus_points += spread * card.value
        elif kind == "extra_action":
            state.actions_left += card.value
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
            # What the victim loses, not a hardcoded 2: the two halves are scaled by the round from
            # the same figure, so «Враждебное поглощение» moves money instead of destroying a dollar
            # of it on every play. See the mirror in _apply_targeted_card_effect.
            attacker.money += self._round_scaled(state, card.value)
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
        """Apply the victim's half of a targeted card.

        Deliberately silent: ``action_card_played`` wraps this call and reports the deltas of the
        whole play, the victim's side included. Announcing the sub-effect too printed every hit
        twice — «−6$» on one line and «−6$» again on the next — and a player read it as −12$.
        Effects that are not a resource change (a frozen object, a lost role, an arrest) still
        announce themselves, because no delta can express them.
        """
        kind = card.kind
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
                # Losing a role is the loudest thing that can happen to a player, and this was the
                # one path that did it in silence: the chronicle printed «−2◆» and nothing else,
                # so neither side learned the seat had opened. The compromat leak has always
                # announced itself; this now matches it.
                lost_role = target.role
                target.influence = 0
                target.role = None
                self._apply_role_limits(target, state)
                state.append_event("role_stripped", attacker.id, target_id=target.id, role_id=lost_role)
        elif kind == "double_scandal":
            self.add_scandal(state, target, card.value)
        elif kind == "blackmail":
            target.influence = max(0, target.influence - card.value)
        elif kind == "expose":
            self.add_scandal(state, target, 1)
        elif kind == "mixed_fine":
            target.money = max(0, target.money - self._round_scaled(state, 2))
            target.influence = max(0, target.influence - 1)
        else:
            raise InvalidCommandError(f"unsupported targeted card kind: {kind}")

    def _require_role(self, player: PlayerState, role_id: str) -> None:
        if not self.has_role(player, role_id):
            raise IllegalActionError(f"this power requires the {role_id} role")

    def _use_role_power(self, state: GameState, command: Command) -> None:
        player = state.current_player
        power = self._payload_string(command, "power")
        before = self._resource_snapshot(state)
        if power == "politician_cleanup":
            self._require_role(player, "politician")
            if player.influence < 2 or player.scandals < 1:
                raise IllegalActionError("political cleanup requires 2 influence and a scandal")
            # An action instead of a per-turn counter: the limit is now the same one every other
            # cleanup lives under, and the player can see it on the action tokens.
            self._spend_action(state)
            player.influence -= 2
            player.scandals -= 1
        elif power in {"journalist_inflate", "journalist_publish"}:
            self._require_role(player, "journalist")
            self._once_per_turn(state, power)
            target = self._target_player(state, player, self._payload_string(command, "target_id"))
            landed = PUBLICATION_SCANDALS if power == "journalist_publish" else 1
            if power == "journalist_publish":
                if player.influence < 3:
                    raise IllegalActionError("publication requires 3 influence")
                # Two free attacks a turn was the journalist's real edge: it played three ordinary
                # actions plus both powers. The publication now costs a turn and hits twice as hard.
                self._spend_action(state)
                player.influence -= 3
            # Every other targeted effect checks the roof; these two used to punch straight through.
            if target.roofs > 0:
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, power=power, by="roof")
            else:
                if power == "journalist_inflate":
                    # Inflating a story splashes back on the journalist — but only if the story ran.
                    # Paid before the roof check, the role bought its own way out of the seat at the
                    # six-scandal limit for attacks that never landed.
                    self.add_scandal(state, player, 1)
                self.add_scandal(state, target, landed)
        elif power == "mafia_racket":
            self._mafia_racket(state, command)
        elif power == "mafia_cleanup":
            self._mafia_cleanup(state, command)
        elif power == "military_sanction":
            self._military_sanction(state, command)
        elif power == "military_inspection":
            self._military_inspection(state, command)
        elif power == "military_roof_seize":
            self._military_roof_seize(state, command)
        elif power == "capitalist_claim":
            self._capitalist_claim(state, command)
        elif power == "mafia_lock":
            self._mafia_lock(state, command)
        elif power == "politician_deal":
            self._politician_deal(state, command)
        elif power == "politician_veto":
            self._politician_veto(state, command)
        elif power == "fraudster_cleanup":
            self._require_role(player, "fraudster")
            if player.scandals < 1:
                raise IllegalActionError("there is no scandal to clean")
            self._spend_action(state)
            player.scandals -= 1
        elif power == "fraudster_crypto_scam":
            self._fraudster_crypto_scam(state, command)
        else:
            raise InvalidCommandError(f"unsupported role power: {power}")
        state.append_event(
            "role_power_used",
            player.id,
            power=power,
            target_id=command.payload.get("target_id"),
            district=command.payload.get("district"),
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
        if self.owned_district_count(player, "shadows") < 1:
            raise IllegalActionError("racket requires a shadows asset")
        target = self._target_player(state, player, self._payload_string(command, "target_id"))
        self._spend_action(state)
        if target.roofs > 0:
            target.roofs -= 1
            return
        leader = self.ranking(state)[0].id == target.id
        # Both halves of the demand hang off districts now, which is the point of the role: money
        # from the Серый сектор it lives in, influence from the Административный квартал its cleanup
        # already pushes it toward. The old formula also counted housing — a leftover from the
        # deleted tribute — and drifted upward with the round on its own, rewarding the calendar
        # instead of the tableau.
        money_demand = (
            2
            + 2 * self.district_count(player, "shadows")
            + floor(state.round_number / 3)
            + (RACKET_LEADER_BONUS if leader else 0)
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
        """Bury a case for money. One method, not two.

        Paying with a Крыша was the same button twice over, and now that one token answers every
        attack, spending it on paperwork is strictly worse than keeping it. The administrative
        object stays required: the power erases two scandals at once, and the role should have to
        own a piece of the city hall to do it.
        """
        player = state.current_player
        self._require_role(player, "mafia")
        if player.scandals < 1:
            raise IllegalActionError("there is no scandal to clean")
        if player.money < 3 or self.district_count(player, "government") < 1:
            raise IllegalActionError("paid cleanup requires 3 money and a government object")
        self._spend_action(state)
        player.money -= 3
        player.scandals = max(0, player.scandals - 2)

    def _military_sanction(self, state: GameState, command: Command) -> None:
        """A ladder that reads off the target's own scandal counter.

        Two scandals cost money, three cost money and influence, four cost the role as well. The
        object confiscation is gone: a mechanic attached to one role that either did nothing (full
        slots) or removed nine points of score, with nothing in between to plan around.

        The sanction no longer clears a scandal off the target either. It used to, which meant the
        role healed what it hit and knocked its own next tier out of reach; the once-a-turn limit is
        what stops a target being farmed.
        """
        player = state.current_player
        self._require_role(player, "military")
        self._once_per_turn(state, "military_sanction")
        target = self._target_player(state, player, self._payload_string(command, "target_id"))
        if target.scandals < SANCTION_MONEY_TIER:
            raise IllegalActionError(f"sanction requires a target with at least {SANCTION_MONEY_TIER} scandals")
        self._spend_action(state)
        if target.roofs > 0:
            target.roofs -= 1
            state.append_event("targeted_effect_blocked", target.id, power="military_sanction", by="roof")
            return
        before = self._resource_snapshot(state)
        tier = target.scandals
        seized = min(target.money, 3 + state.round_number)
        target.money -= seized
        player.money += seized
        influence = 0
        if tier >= SANCTION_INFLUENCE_TIER:
            influence = min(target.influence, 2 + floor(state.round_number / 4))
            target.influence -= influence
            player.influence += influence
        stripped: str | None = None
        if tier >= SANCTION_ROLE_TIER and target.role:
            stripped = target.role
            target.role = None
            self._apply_role_limits(target, state)
        state.append_event(
            "military_sanction",
            player.id,
            target_id=target.id,
            scandals=tier,
            money=seized,
            influence=influence,
            role_id=stripped,
            deltas=self._resource_deltas(state, before),
        )

    # --- role marks on the shared board ---------------------------------------------------------
    # Three roles now write on things they do not own: the capitalist claims a market card, the
    # mafia locks one, the politician vetoes a project. All three are public — a hidden claim on a
    # shared board is a rule nobody can play around — and all three die with the role, because a
    # mark placed by an authority nobody holds any more is just noise on the board.

    def _clear_role_marks(self, state: GameState, player: PlayerState) -> None:
        """Drop everything this player has written on the shared board. Called on every role loss."""
        for item in state.market:
            if item.claimed_by == player.id:
                item.claimed_by = None
        player.marked_card_id = None
        player.marked_market_uid = None
        state.project_veto = {
            project_id: owner for project_id, owner in state.project_veto.items() if owner != player.id
        }

    def _drop_market_marks(self, state: GameState, item: MarketAsset) -> None:
        """A slot leaving the market takes its marks with it, and un-mirrors the capitalist's."""
        if item.claimed_by:
            for player in state.players:
                if player.marked_market_uid == item.uid:
                    player.marked_card_id = None
                    player.marked_market_uid = None

    def market_locked_for(self, state: GameState, item: MarketAsset, player: PlayerState) -> bool:
        """Is this slot closed to this buyer by the mafia's grey mark?

        One round, counted from the round it was placed in: the mark is a tempo weapon, and a
        lock that outlived the market rotation would just delete the slot.
        """
        if not item.locked_by or item.locked_by == player.id:
            return False
        return state.round_number <= item.locked_round

    def _capitalist_claim(self, state: GameState, command: Command) -> None:
        """Mark a market card. It pays the capitalist as if it stood in their city.

        The role had no active ability at all — its compensation was a charter that satisfied
        business project conditions out of thin air, which was invisible on the card and impossible
        to play against. This is the same idea made public and paid for: an action and a scandal,
        the card still on sale to everybody else at the ordinary price, and the mark visible to the
        whole table so the rest of them can simply buy it away.

        One mark at a time. A second claim moves the first rather than adding to it, or the role
        would quietly assemble a second portfolio on the market with no slots to pay for it.
        """
        player = state.current_player
        self._require_role(player, "capitalist")
        market_uid = self._payload_string(command, "market_uid")
        item = next((entry for entry in state.market if entry.uid == market_uid), None)
        if item is None:
            raise IllegalActionError("this card is not on the market")
        if item.claimed_by == player.id:
            raise IllegalActionError("this card is already marked")
        self._spend_action(state)
        for entry in state.market:
            if entry.claimed_by == player.id:
                entry.claimed_by = None
        item.claimed_by = player.id
        player.marked_card_id = item.card_id
        player.marked_market_uid = item.uid
        self.add_scandal(state, player, 1)
        state.append_event(
            "market_claimed",
            player.id,
            market_uid=item.uid,
            asset_id=item.card_id,
        )

    def _mafia_lock(self, state: GameState, command: Command) -> None:
        """Put a grey mark on a market card: nobody but the mafia may buy it for a round.

        Costs a Крыша rather than an action — the role's currency is protection, and spending it
        on denial is the trade. Free of the action clock, so it is capped at one a turn instead,
        and it cannot be lifted: the round is the only thing that clears it.
        """
        player = state.current_player
        self._require_role(player, "mafia")
        self._once_per_turn(state, "mafia_lock")
        if player.roofs < 1:
            raise IllegalActionError("the grey mark costs one roof")
        market_uid = self._payload_string(command, "market_uid")
        item = next((entry for entry in state.market if entry.uid == market_uid), None)
        if item is None:
            raise IllegalActionError("this card is not on the market")
        if item.locked_by == player.id and state.round_number <= item.locked_round:
            raise IllegalActionError("this card is already marked")
        player.roofs -= 1
        for entry in state.market:
            if entry.locked_by == player.id:
                entry.locked_by = None
                entry.locked_round = 0
        item.locked_by = player.id
        item.locked_round = state.round_number
        state.append_event(
            "market_locked",
            player.id,
            market_uid=item.uid,
            asset_id=item.card_id,
            until_round=item.locked_round,
        )

    def _politician_deal(self, state: GameState, command: Command) -> None:
        """«Договоримся»: rent a district for the round, the way «Зонирование» does.

        Costs no action — the politician's ordinary turn is already spent on projects — but it
        does cost the two things the role has to weigh: three influence and a scandal. The Серый
        сектор is the gate: the deal is struck there, and a clean politician cannot strike it.
        """
        player = state.current_player
        self._require_role(player, "politician")
        self._once_per_turn(state, "politician_deal")
        if self.owned_district_count(player, "shadows") < 1:
            raise IllegalActionError("the deal requires a shadows object")
        if player.influence < POLITICIAN_DEAL_INFLUENCE:
            raise IllegalActionError(f"the deal requires {POLITICIAN_DEAL_INFLUENCE} influence")
        district = self._payload_string(command, "district")
        if district not in DISTRICT_IDS:
            raise InvalidCommandError(f"unknown district: {district}")
        player.influence -= POLITICIAN_DEAL_INFLUENCE
        player.zoning_district = district
        self.add_scandal(state, player, 1)
        state.append_event("zoning_set", player.id, district=district, source="politician_deal")

    def _politician_veto(self, state: GameState, command: Command) -> None:
        """Veto a project: nobody but the politician may take it while the mark stands.

        The mark rides on the project, not on the clock — a vetoed project rotates off the board on
        the ordinary schedule and takes the veto with it, so the politician is buying tempo on one
        card rather than freezing the board. One veto at a time, and it is public.
        """
        player = state.current_player
        self._require_role(player, "politician")
        project_id = self._payload_string(command, "project_id")
        if project_id not in state.project_board:
            raise IllegalActionError("this project is not on the city board")
        if state.project_veto.get(project_id) == player.id:
            raise IllegalActionError("this project is already vetoed")
        if player.influence < POLITICIAN_VETO_INFLUENCE:
            raise IllegalActionError(f"a veto requires {POLITICIAN_VETO_INFLUENCE} influence")
        self._spend_action(state)
        player.influence -= POLITICIAN_VETO_INFLUENCE
        state.project_veto = {existing: owner for existing, owner in state.project_veto.items() if owner != player.id}
        state.project_veto[project_id] = player.id
        state.append_event("project_vetoed", player.id, project_id=project_id)

    def inspection_targets(self, state: GameState, player: PlayerState) -> list[str]:
        """Who an inspection would reach: every rival standing in the Серый сектор.

        Exposed so the clients can print the outcome before the button is pressed. A power that
        hits a computed set has to say which set, or the only way to read it is to click it.
        """
        return [
            other.id for other in state.players if other.id != player.id and self.district_count(other, "shadows") > 0
        ]

    def _military_inspection(self, state: GameState, command: Command) -> None:
        """Come with an inspection: a scandal for everyone trading in the Серый сектор.

        The role's other line reads the target's own scandal counter and needs someone already
        dirty; this one creates that state, and it aims at the district rather than at a player, so
        it cannot be dodged by being quiet. A Крыша answers for its owner, like any hostile hit.
        """
        player = state.current_player
        self._require_role(player, "military")
        targets = self.inspection_targets(state, player)
        if not targets:
            raise IllegalActionError("an inspection requires a rival with a shadows object")
        self._spend_action(state)
        hit: list[str] = []
        for target_id in targets:
            target = state.player_by_id(target_id)
            if target.roofs > 0:
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, power="military_inspection", by="roof")
                continue
            self.add_scandal(state, target, 1)
            hit.append(target.id)
        state.append_event("military_inspection", player.id, target_ids=targets, scandalised_ids=hit)

    def _military_roof_seize(self, state: GameState, command: Command) -> None:
        """Take a Крыша off one player and put it on your own stack.

        Not blocked by the Крыша it is aimed at — the same rule as «Пробить крышу»: a token that
        defends itself makes the whole line unreachable. The transfer replaces the sweep that took
        one from everybody: the sweep was a board-wide answer to a defence that is already the most
        contested resource in the game, and it paid points on top.
        """
        player = state.current_player
        self._require_role(player, "military")
        target = self._target_player(state, player, self._payload_string(command, "target_id"))
        if target.roofs < 1:
            raise IllegalActionError("the target holds no roof")
        if player.influence < MILITARY_SEIZE_INFLUENCE:
            raise IllegalActionError(f"seizing a roof requires {MILITARY_SEIZE_INFLUENCE} influence")
        if player.roofs >= self.roof_limit(player):
            raise IllegalActionError("roof limit reached")
        self._spend_action(state)
        player.influence -= MILITARY_SEIZE_INFLUENCE
        target.roofs -= 1
        player.roofs += 1
        state.append_event("roof_seized", player.id, target_id=target.id, roofs=player.roofs)

    def _fraudster_crypto_scam(self, state: GameState, command: Command) -> None:
        player = state.current_player
        self._require_role(player, "fraudster")
        self._once_per_turn(state, "fraudster_crypto_scam")
        if not any(asset.card_id == "crypto" for asset in player.assets):
            raise IllegalActionError("crypto scam requires a crypto exchange")
        if "amount" in command.payload:
            raise InvalidCommandError("crypto scam has no selectable amount")
        self._spend_action(state)
        gained = 0
        for target in state.players:
            if target.id == player.id:
                continue
            if target.roofs > 0:
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, power="fraudster_crypto_scam", by="roof")
                continue
            taken = target.money * CRYPTO_SCAM_SHARE // 100
            target.money -= taken
            gained += taken
        player.money += gained
        self.add_scandal(state, player, max(0, CRYPTO_SCAM_SCANDALS - self.grey_scandal_reduction(player)))

    # Every operation used to demand one exact card out of 71 — which also had to hold one of the
    # six slots. Compare the racket, which asks for *any* Серый сектор object: 11 uses in a single
    # game against 10 for all five grey operations across two, and 8 of those were one crypto
    # exchange. Three of the five were never run at all. The gate is now a district, so an
    # operation is unlocked by a shelf of the catalog instead of a single card.
    # Серый сектор opens all five, which is the point of the district: it is the grey shelf, and the
    # racket already works that way. Технокластер opens the two technical operations and the
    # Административный квартал opens the leak, so a clean city can still reach part of the layer.
    # The quarter each role earns a dollar an object in. The journalist is absent on purpose: it
    # owns no district and both of its lines are tied to other people's quarters instead.
    ROLE_DISTRICTS = {
        "capitalist": "business",
        "politician": "government",
        "fraudster": "tech",
        "mafia": "shadows",
        "military": "industrial",
    }

    GREY_OPERATION_DISTRICTS = {
        "smear": ("shadows",),
        "roof_break": ("shadows",),
        "crypto": ("tech", "shadows"),
        "datacenter": ("tech", "shadows"),
        "influence_broker": ("shadows", "government"),
    }
    GREY_ASSET_IDS = tuple(GREY_OPERATION_DISTRICTS)
    # The smear and the pump reach every rival at once, so they ask for no target; the other three
    # are pointed at one player.
    GREY_TARGETED_IDS = ("roof_break", "datacenter", "influence_broker")
    GREY_BASE_CHANCE = GREY_OPERATION_CHANCE

    def grey_operation_points(self, asset_id: str) -> int:
        """Victory points a successful run of this operation scores, before any per-effect bonus."""
        return GREY_OPERATION_POINTS[asset_id]

    def grey_operation_unlocked(self, player: PlayerState, operation_id: str) -> bool:
        """Does the player hold an object in a district this operation runs out of?

        «Зонирование» counts, like it does for project conditions and object synergy: the card
        rents the district for the round and this is a district gate.
        """
        return any(
            self.district_count(player, district) > 0
            for district in self.GREY_OPERATION_DISTRICTS.get(operation_id, ())
        )

    def hack_influence_steal(self, state: GameState) -> int:
        """How much influence a hack takes. Grows with the round — see HACK_INFLUENCE_BASE."""
        return HACK_INFLUENCE_BASE + floor(state.round_number / 3)

    def pump_drain(self, state: GameState) -> int:
        """What the pump takes from each rival, growing with the round like every money figure."""
        return PUMP_DRAIN_BASE + floor(state.round_number / 2)

    def _grey_operation(self, state: GameState, command: Command) -> None:
        player = state.current_player
        asset_id = self._payload_string(command, "asset_id")
        if asset_id not in self.GREY_ASSET_IDS:
            raise InvalidCommandError("unknown grey operation asset")
        if self._flag(state, GREY_OPERATION_FLAG):
            raise IllegalActionError("only one grey operation may be run per turn")
        if not self.grey_operation_unlocked(player, asset_id):
            raise IllegalActionError("the operation requires an object of the right district")
        target: PlayerState | None = None
        if asset_id in self.GREY_TARGETED_IDS:
            target = self._target_player(state, player, self._payload_string(command, "target_id"))
        if asset_id == "roof_break" and (target is None or target.roofs < 1):
            raise IllegalActionError("breaking a roof requires a target who holds one")
        if asset_id == "influence_broker" and (target is None or target.role is None):
            raise IllegalActionError("a compromat leak requires a target who holds a role")
        self._spend_action(state)
        # Marked before the roll: the turn's one attempt is the attempt, not the hit. Refunding a
        # miss would let a player re-roll the same operation until it landed, which is the opposite
        # of a cap — and it would make the long-odds operations the safest ones to open with.
        self._mark_flag(state, GREY_OPERATION_FLAG)
        before = self._resource_snapshot(state)

        # One flat number. The old bonus was "+20% for the role, +10% more for any Технокластер
        # object", and the crypto exchange is a Технокластер object, so the fraudster's own signature
        # operation always granted both and landed on the 0.9 ceiling regardless of anything else.
        fraud_bonus = FRAUDSTER_GREY_BONUS if self.has_role(player, "fraudster") else 0
        chance = min(0.9, self.GREY_BASE_CHANCE[asset_id] + fraud_bonus)
        success = GameRNG(state.rng).chance(chance)
        points = 0
        blocked = False
        if success:
            # The roll is what the operation is paid for and charged for, not the damage. A run
            # that meets nothing but Крыши still burns one token off every defender it reached,
            # and that is a real result — spending three of the table's tokens for free was the
            # cheapest board-wide play in the game. So a successful roll always costs its scandal
            # and always pays its points, blocked or not.
            landed, bonus_points = self._resolve_grey_success(state, player, target, asset_id)
            blocked = not landed
            points = self.grey_operation_points(asset_id) + bonus_points
            player.bonus_points += points
            self._charge_grey_scandals(state, player, GREY_SUCCESS_SCANDALS)
        else:
            # A miss does nothing at all — no stake lost, no object frozen, no roof burnt. The
            # penalty is the extra scandal and the action, one rule for all five operations.
            self._charge_grey_scandals(state, player, GREY_FAILURE_SCANDALS)
        state.append_event(
            "grey_operation_resolved",
            player.id,
            asset_id=asset_id,
            target_id=target.id if target else None,
            success=success,
            # A successful roll that a roof swallowed. Distinct from ``success=False``: the analytics
            # need to tell "the odds failed" apart from "the defence held".
            blocked=blocked,
            chance=chance,
            points=points,
            deltas=self._resource_deltas(state, before),
        )

    def _charge_grey_scandals(self, state: GameState, player: PlayerState, amount: int) -> None:
        """One scandal for a hit, two for a miss, less with the perk that exists to soften both.

        A Крыша never touches these: the scandal is the player's own doing, and add_scandal is the
        line where that rule lives.
        """
        self.add_scandal(state, player, max(0, amount - self.grey_scandal_reduction(player)))

    def _resolve_grey_success(
        self,
        state: GameState,
        player: PlayerState,
        target: PlayerState | None,
        asset_id: str,
    ) -> tuple[bool, int]:
        """Apply the effect. Returns whether anything landed, and any points the effect itself earned.

        ``False`` means every rival the operation reached was behind a Крыша, so no damage was
        done. It does **not** mean the run was free: the caller still charges the scandal and pays
        the points, because the tokens those Крыши spent are the result.
        """
        rivals = [other for other in state.players if other.id != player.id]
        if asset_id == "smear":
            # A scandal on every rival at once. Each roof answers for its own owner, so a single
            # action can strip three of them — the only thing in the game that outpaces the
            # defence, and the reason the odds sit below its neighbours'.
            landed = False
            for rival in rivals:
                if rival.roofs > 0:
                    rival.roofs -= 1
                    state.append_event("targeted_effect_blocked", rival.id, asset_id=asset_id, by="roof")
                    continue
                self.add_scandal(state, rival, 1)
                landed = True
            return landed, 0
        if asset_id == "crypto":
            # The pump drains the whole table into one wallet instead of paying its owner out of
            # thin air and jabbing the leader on the side. It is the money operation, and it is the
            # only one whose payout grows with the number of players.
            drain = self.pump_drain(state)
            landed = False
            for rival in rivals:
                if rival.roofs > 0:
                    rival.roofs -= 1
                    state.append_event("targeted_effect_blocked", rival.id, asset_id=asset_id, by="roof")
                    continue
                taken = min(drain, rival.money)
                rival.money -= taken
                player.money += taken
                landed = True
            return landed, 0
        if asset_id == "roof_break" and target is not None:
            # The one attack a Крыша cannot answer, because the Крыша is what it is aimed at.
            # Blocking it with the very token it removes would make the stack self-defending and
            # the whole operation unreachable.
            taken = target.roofs
            target.roofs = 0
            state.append_event("roofs_broken", player.id, target_id=target.id, roofs=taken)
            # A point per token: without it the operation is a pure set-up whose value is shared
            # with everybody at the table, and nobody spends an action and a scandal on that.
            return True, taken * ROOF_BREAK_POINT_PER_ROOF
        if asset_id == "datacenter" and target is not None:
            if target.roofs > 0:
                # A roof absorbs any incoming negative effect, hacking included.
                target.roofs -= 1
                state.append_event("targeted_effect_blocked", target.id, asset_id=asset_id, by="roof")
                return False, 0
            stolen = min(self.hack_influence_steal(state), target.influence)
            target.influence -= stolen
            player.influence += stolen
            return True, 0
        if asset_id == "influence_broker" and target is not None:
            if not self._resolve_compromat(state, player, target):
                return False, 0
            return True, 0
        return False, 0

    def _resolve_compromat(self, state: GameState, player: PlayerState, target: PlayerState) -> bool:
        """Strip the target's role unless a Крыша takes the hit instead. ``False`` if it was blocked."""
        if target.roofs > 0:
            target.roofs -= 1
            state.append_event("targeted_effect_blocked", target.id, asset_id="influence_broker", by="roof")
            return False
        lost_role = target.role
        target.role = None
        self._apply_role_limits(target, state)
        # The seat opens at the free price: a stripped role is not held by anybody any more, so the
        # threefold takeover no longer applies and the leak has actually changed the board.
        state.append_event("role_stripped", player.id, target_id=target.id, role_id=lost_role)
        return True

    def scandal_limit(self, player: PlayerState) -> int:
        """At how many scandals the role is lost. Jail follows one step later.

        The journalist earns influence for their own scandals, so the ordinary limit of five put
        their best line permanently one point from collapse — and only a rare pair of perks made
        it survivable at all.

        The ceiling belongs to the seat: a player who leaves it is measured against
        ``BASE_SCANDAL_LIMIT`` from that moment, and ``_apply_role_limits`` clamps the counter that
        the higher ceiling let them accumulate.
        """
        return JOURNALIST_SCANDAL_LIMIT if self.has_role(player, "journalist") else BASE_SCANDAL_LIMIT

    def _apply_role_limits(self, player: PlayerState, state: GameState | None = None) -> None:
        """Clamp the counters whose ceiling is set by the role the player is holding *now*.

        Two limits move when a role does — ``scandal_limit`` (the journalist's six) and
        ``roof_limit`` (the mafia's extra token) — and nothing used to re-check them on the way out. A
        journalist who hit their own limit of six was left sitting at six scandals under a limit of
        five: a point of score worse than the identical event for any other role, and a state
        ``scandals <= scandal_limit`` says cannot exist. A mafia kept its extra Крыша after claiming
        a different seat, where its new lower ceiling could not support it.

        Called at every point a role is gained, swapped, stripped or lost, so the invariant holds
        after the transition rather than only inside the handler that happened to think of it.
        Clamping down never destroys something the player could have kept: the ceiling they are
        measured against is the one they hold.
        """
        player.scandals = min(player.scandals, self.scandal_limit(player))
        player.roofs = min(player.roofs, self.roof_limit(player))
        # A claim, a grey mark or a veto placed by an authority the player no longer holds is
        # just noise on a shared board, so the marks leave with the seat.
        if state is not None:
            self._clear_role_marks(state, player)

    def add_scandal(self, state: GameState, player: PlayerState, amount: int) -> None:
        """Charge scandals and announce every consequence that is not a plain counter change.

        Losing a role and being jailed used to happen in silence: the only trace was the scandal
        counter moving, so a player found out their role was gone by diffing their own state.

        **No Крыша check here, on purpose.** Every hostile path — a card, the racket, a sanction, a
        publication, a hack — spends the defender's token *before* it calls this, and cancels the
        whole effect when it does. What reaches this function is a scandal the player brought on
        themselves: buying a grey object, running or botching their own grey operation, the
        journalist's self-scandal. A defence that cancelled those would be a licence to spam the
        grey layer for free, and the rule that it must not is older than the merged token.
        A live game caught exactly that: a Крыша ate the scandal from my own laundering run.
        """
        if amount <= 0:
            player.scandals = max(0, player.scandals + amount)
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
        if jailed:
            player.scandals = 3
            player.roofs = max(0, player.roofs - 1)
            player.jail_turns = 1
        else:
            player.scandals = limit
        # The seat is gone, so the ceilings it raised go with it: a journalist parked on their own
        # limit of six is measured against five from here, and is clamped to it.
        self._apply_role_limits(player, state)
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
        state.append_event("player_jailed", player.id, round_number=state.round_number)
        self._end_turn(state, command)

    def _end_turn(self, state: GameState, command: Command) -> None:
        player = state.current_player
        if state.actions_left > 0 and player.jail_turns == 0 and self.effect_total(player, "carryAction") > 0:
            player.banked_actions = 1
        else:
            player.banked_actions = 0
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
        self._rotate_market(state)
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
        player.jail_turns = max(0, player.jail_turns - 1)
        player.turns += 1
        if player.role is None and player.scandals > 0:
            player.scandals -= 1
        player.scandals = max(0, player.scandals - self.effect_total(player, "scandalReduction"))
        # At most one token a turn, however many sources say otherwise: stacked refills made a
        # player permanently unattackable, which is the one thing no defence should buy.
        if self.effect_total(player, "turnRoof"):
            player.roofs = min(self.roof_limit(player), player.roofs + 1)
        base_actions = 1 if jailed else (4 if player.role == "fraudster" else 3)
        bonus = min(1, self.effect_total(player, "extraActions"))
        state.actions_left = base_actions + (0 if jailed else bonus + player.banked_actions)
        player.banked_actions = 0
        # «Лоббистский кабинет». Переполненная рука теряет добор молча — это и есть цена
        # карты: она платит тому, кто разыгрывает, а не тому, кто копит.
        if not jailed and self.effect_total(player, "turnCard"):
            drawn = self._draw_action_card(state, player)
            if drawn:
                state.append_event("free_action_card_drawn", player.id, card_id=drawn.card_id)
        state.turn_flags = {}
        state.append_event(
            "turn_started",
            player.id,
            round_number=state.round_number,
            actions=state.actions_left,
        )

    def market_rotation_uids(self, state: GameState) -> list[str]:
        """Which slots the next round opening will replace: the oldest MARKET_ROTATION_SIZE.

        Age is position — `_refill_market` appends and removal keeps order — so the client cannot
        read this off the list it receives without knowing the rule. It gets the answer instead.
        """
        return [item.uid for item in state.market[:MARKET_ROTATION_SIZE]]

    def _rotate_market(self, state: GameState) -> None:
        """Replace the oldest slots. Called only when a round opens, never mid-round.

        The leaving cards go to the bottom of the deck rather than out of the game: at three a
        round for fifteen rounds, dropping them would empty the catalog before the endgame.
        """
        leaving = state.market[:MARKET_ROTATION_SIZE]
        if not leaving:
            return
        for item in leaving:
            self._drop_market_marks(state, item)
        state.market = state.market[len(leaving) :]
        state.market_deck.extend(item.card_id for item in leaving)
        self._refill_market(state, len(leaving))
        state.append_event("market_rotated", expired_asset_ids=[item.card_id for item in leaving])

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
        state.market.extend(MarketAsset(uid=f"asset:{card_id}", card_id=card_id) for card_id in drawn)

    def market_refresh_available(self, state: GameState, player: PlayerState) -> bool:
        """Can this player still re-deal a market slot this round?

        Round-scoped rather than turn-scoped: at one a turn the «Маркет-мейкер» would cycle the
        whole board over a circle and nobody could plan a purchase two turns ahead, which is the
        rotation rule's entire job.
        """
        return self.effect_total(player, "marketRefresh") > 0 and player.market_refresh_round < state.round_number

    def _market_refresh(self, state: GameState, command: Command) -> None:
        """«Маркет-мейкер»: send one market slot to the bottom of the deck and deal its replacement.

        Costs no action on purpose. What it really spends is the card's own opportunity: a slot
        re-dealt is a slot nobody at the table can plan around any more, and the player using it
        loses the same visibility. Marks come off with the slot, exactly as they do on rotation —
        so this is also the one answer the table has to a grey mark it cannot outwait.
        """
        player = state.current_player
        if self.effect_total(player, "marketRefresh") < 1:
            raise IllegalActionError("no object grants a market re-deal")
        if player.market_refresh_round >= state.round_number:
            raise IllegalActionError("the market has already been re-dealt this round")
        market_uid = self._payload_string(command, "market_uid")
        item = next((entry for entry in state.market if entry.uid == market_uid), None)
        if item is None:
            raise IllegalActionError("this card is not on the market")
        if not state.market_deck:
            raise IllegalActionError("the market deck is empty")
        player.market_refresh_round = state.round_number
        self._drop_market_marks(state, item)
        state.market = [entry for entry in state.market if entry.uid != item.uid]
        state.market_deck.append(item.card_id)
        self._refill_market(state, 1)
        state.append_event(
            "market_refreshed",
            player.id,
            market_uid=item.uid,
            asset_id=item.card_id,
        )

    def _shuffle_action_deck(self, state: GameState) -> None:
        """Cards are a blind draw, so the only thing to maintain is a shuffled deck."""
        GameRNG(state.rng).shuffle(state.action_deck)

    def round_pays_out(self, state: GameState) -> bool:
        """Does the settlement that closes the current round hand anybody anything?

        Everything but the last one does. A settlement is what a player carries *into the next
        round*, and after the final round there is no next round: see ``settlement_preview`` for
        why the payout is dropped rather than scored. One definition, read by the preview and by
        the object attribution that has to agree with it.
        """
        return state.round_number < state.max_rounds

    def _settle_round(self, state: GameState) -> None:
        incomes, income_sources, influence_sources = self.settlement_preview(state)
        # Keep the exact per-object split used by the settlement. Analytics used to reconstruct
        # this from the state *before the command*. That is wrong when the command itself strips a
        # role or triggers an arrest and the arrest closes the round: object synergy is then paid
        # from the post-command board. Emitting the source rows here makes the settlement event the
        # single source of truth, just like ``income_sources`` already is for the player totals.
        # Empty on the final round, where nothing is paid: these rows must add back up to the
        # ``objects`` line of the settlement, and the balance harness fails the run when they do not.
        object_income_sources = {
            player.id: {
                owned.uid: {
                    "card_id": owned.card_id,
                    "printed": self.owned_definition(owned).income,
                    "synergy": self.object_synergy_income(state, player, owned),
                }
                for owned in self.effective_assets(player)
            }
            if self.round_pays_out(state)
            else {}
            for player in state.players
        }
        for player in state.players:
            player.money = max(
                0,
                player.money + incomes[player.id] + income_sources[player.id]["journalist"] - player.debt,
            )
            player.influence += sum(influence_sources[player.id].values())
            player.debt = 0
            player.zoning_district = None
            player.scandal_gained_this_round = 0
        state.append_event(
            "round_settled",
            round_number=state.round_number,
            incomes=incomes,
            income_sources=income_sources,
            influence_sources=influence_sources,
            object_income_sources=object_income_sources,
        )

    def settlement_preview(
        self, state: GameState
    ) -> tuple[dict[str, int], dict[str, dict[str, int]], dict[str, dict[str, int]]]:
        """What settling the round right now would pay everybody, without touching the state.

        ``_settle_round`` applies exactly this and ``round_forecast`` displays exactly this, so the
        figure on a player's screen cannot drift from the one that lands in their wallet. Returns
        ``(incomes, income_sources, influence_sources)``; every ``*_sources`` row sums to the change
        that row's player will see, which is what the chronicle relies on.

        On the final round every row but the debt is zero — see the block at the end.
        """
        breakdowns = {player.id: self._income_breakdown(state, player) for player in state.players}
        incomes = {player_id: sum(item.values()) for player_id, item in breakdowns.items()}
        income_sources: dict[str, dict[str, int]] = {
            player.id: {**breakdowns[player.id], "journalist": 0, "debt": -player.debt} for player in state.players
        }
        influence_sources: dict[str, dict[str, int]] = {}
        for player in state.players:
            journalist = player.role == "journalist"
            # The journalist owns no district, so both lines hang off somebody else's quarter:
            # money doubles with a business object (connections sell the story), and the rating
            # needs a single housing object to have readers at all.
            #
            # The ceiling is gone. It used to be 2 plus one per housing object, which capped the
            # role's own currency at exactly the moment it was working — and it made every extra
            # housing object worth +1◆ a round, so the role quietly turned into a housing engine.
            # One object switches the line on, and from there the rating simply is the scandal
            # counter: the role is paid for the thing it is built to accumulate.
            rating = 0
            journalist_cash = 0
            if journalist:
                rating = player.scandals if self.owned_district_count(player, "residential") > 0 else 0
                rate = 2 if self.owned_district_count(player, "business") > 0 else 1
                journalist_cash = rate * sum(other.scandals for other in state.players if other.id != player.id)
            income_sources[player.id]["journalist"] = journalist_cash
            # Influence was settled silently: players had to diff their own state to see where
            # a politician's passive or a journalist's rating came from.
            influence_sources[player.id] = {
                **self.passive_influence_breakdown(state, player),
                "rating": rating,
            }
        if not self.round_pays_out(state):
            # The last round pays nothing. A settlement is the money and influence a player takes
            # *into the next round*, and after the fifteenth there is no next round: the payout
            # could only ever be spent through the passive rate (10$ and 3◆ a point), which handed
            # everybody 3-10 points that no decision at that table could still influence. Measured
            # across six exported matches it moved every player by 4-7 points and turned a
            # one-point finish into a tie — a coin toss decided by the size of an engine the score
            # already pays for through objects and projects.
            #
            # The debt row survives on purpose: «Мостовой кредит» takes 10$ now against 4$ at the
            # end of the round, and dropping the whole settlement would make the last round the one
            # where the loan is free. What the round owes is still collected; what it would have
            # earned is not.
            #
            # Zeroed here rather than in ``_settle_round`` so that ``round_forecast`` — which is
            # this same function — shows the player a payout of zero for the whole of the final
            # round, instead of promising one that will not arrive.
            incomes = dict.fromkeys(incomes, 0)
            income_sources = {
                player_id: {key: (value if key == "debt" else 0) for key, value in row.items()}
                for player_id, row in income_sources.items()
            }
            influence_sources = {player_id: dict.fromkeys(row, 0) for player_id, row in influence_sources.items()}
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
        """Round money, itemised.

        No asset in the catalog carries ``passiveMoney`` — it is a project-perk key — so the
        ``projects`` row is exactly what the finished projects pay.
        """
        objects = 0
        for owned in self.effective_assets(player):
            asset = self.owned_definition(owned)
            # The printed income, flat. District development used to multiply this by 1.25 per
            # level, up to twice, for 2$ and one action — by far the cheapest exponent in the game
            # and the thing that made building strictly better than anything else a turn could buy.
            # Depth is still rewarded, but through synergy and influence, which no multiplier
            # compounds. See object_synergy_income.
            objects += asset.income + self.object_synergy_income(state, player, owned)
        return {
            "objects": objects,
            "projects": self.effect_total(player, "passiveMoney"),
        }

    def residents_influence(self, state: GameState, player: PlayerState) -> int:
        """The politician's passive: 1◆ per residential object anywhere in the city, rivals' too.

        It used to pay money, and money is the currency the role needed least: the administrative
        quarter it represents now pays that (see ROLE_DISTRICTS), while this line pays the scarce
        one. It is still the only passive in the game that reads the opponents' boards, which is
        why the forecast shows it on its own row.
        """
        if not self.has_role(player, "politician"):
            return 0
        return sum(self.district_count(other, "residential") for other in state.players)

    def _round_income(self, state: GameState, player: PlayerState) -> int:
        return sum(self._income_breakdown(state, player).values())

    def object_synergy_income(self, state: GameState, player: PlayerState, owned: OwnedAsset) -> int:
        """Everything an object earns on top of its printed income.

        The capitalist's flat +1$ per object lives here rather than in a row of its own, because it
        is object income and reads as such: it replaces a power nobody used, and the upkeep it used
        to cancel is gone for everybody.
        """
        asset = self.owned_definition(owned)
        count = self.district_count(player, asset.district)
        district_bonus = 2 if count >= 4 else 1 if count >= 2 else 0
        supported = {
            "capitalist": "business",
            # Администрация, а не спальный: жильё политик теперь получает влиянием со всего
            # города, а свой доллар за объект — с квартала, который он и представляет.
            "politician": "government",
            "fraudster": "tech",
            "mafia": "shadows",
            "military": "industrial",
        }
        role_bonus = int(
            any(self.has_role(player, role) and district == asset.district for role, district in supported.items())
        )
        special = self._special_income(state, player, owned)
        capitalist = int(self.has_role(player, "capitalist"))
        return district_bonus + role_bonus + special + capitalist

    def _special_income(self, state: GameState, player: PlayerState, owned: OwnedAsset) -> int:
        asset = self.owned_definition(owned)
        effects = asset.effects
        result = 0
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
        """Does the player actually have a foothold in this district?

        Two roles used to answer yes without owning anything — the capitalist in the Деловой
        центр, the politician in the Администрации. A virtual object is invisible: the card said
        "at a business object" and paid at a table where the player had none, so the condition on
        the card was not the condition in the engine. Both charters are gone; the districts are
        now earned like everybody else's, or rented for a round with «Зонирование».
        """
        return self.district_count(player, district) > 0

    def passive_influence_breakdown(self, state: GameState, player: PlayerState) -> dict[str, int]:
        """Round influence, itemised by where it comes from.

        No asset in the catalog carries ``passiveInfluence`` — it is a project-perk key — so the
        ``projects`` row is exactly what the finished projects pay.

        Takes the state because the politician's row counts the whole city, rivals included.
        """
        # The politician: 1◆ per residential object anywhere on the table. Two administrative
        # objects of their own used to pay this instead; the administrative quarter is now the
        # role's own district and pays a dollar an object like every other role's does, so this
        # line moved to the currency the role is short of and to the board it actually governs.
        residents = self.residents_influence(state, player)
        # The capitalist: 1◆ per own industrial object. The role earns more money than anyone and
        # spends actions converting it — this is the cross-district tie that pays it in the currency
        # projects are actually bought with. Промзона because the Деловой центр is already its own.
        industrial = 0
        if self.has_role(player, "capitalist"):
            industrial = self.owned_district_count(player, "industrial")
        object_effects = 0
        for owned in player.assets:
            bonus = self.owned_definition(owned).effects.get("influenceBonus")
            if not bonus:
                continue
            active_role = not bonus.get("role") or self.has_role(player, bonus["role"])
            active_district = not bonus.get("district") or self.has_district_link(player, bonus["district"])
            if active_role and active_district:
                object_effects += int(bonus["value"])
        # The reward for building deep. Development used to be it, and it paid in money multiplied
        # by itself; this pays a flat token in the currency projects are bought with, and only from
        # round four or so, because the objects that carry it are the late ones. Deliberately an
        # explicit effect rather than "epics behave differently": a rule the card prints beats a
        # rule the player has to learn.
        synergy = sum(
            int(self.owned_definition(owned).effects.get("synergyInfluence", 0))
            for owned in player.assets
            if self.district_count(player, self.owned_definition(owned).district) >= 4
        )
        return {
            "objects": object_effects,
            "synergy": synergy,
            "residents": residents,
            "industrial": industrial,
            "projects": self.effect_total(player, "passiveInfluence"),
        }

    # Every active power of every role, in the order the panel should list them. The clients used
    # to keep their own copy of this list to grey out a power that is not available right now; a
    # copy of a rule in another language is a copy that drifts, and this one already had the
    # deleted `military_roof_sweep` in it.
    ROLE_POWERS = {
        "capitalist": ("capitalist_claim",),
        "politician": ("politician_cleanup", "politician_deal", "politician_veto"),
        "journalist": ("journalist_inflate", "journalist_publish"),
        "fraudster": ("fraudster_cleanup", "fraudster_crypto_scam"),
        "mafia": ("mafia_racket", "mafia_cleanup", "mafia_lock"),
        "military": ("military_sanction", "military_inspection", "military_roof_seize"),
    }

    # Powers the engine caps at one press a turn, via `_once_per_turn`. Listed so the panel can
    # say "уже в этом ходу" instead of a blank "недоступна".
    ONCE_PER_TURN = frozenset(
        {
            "journalist_inflate",
            "journalist_publish",
            "politician_deal",
            "mafia_racket",
            "mafia_lock",
            "military_sanction",
            "fraudster_crypto_scam",
        }
    )

    # Whether a power consumes one of the turn's actions. Three of them do not, and that is the
    # whole point of those three, so it cannot be left to a client-side guess.
    POWER_SPENDS_ACTION = {
        "journalist_inflate": False,
        "politician_deal": False,
        "mafia_lock": False,
    }

    # Whether the target's Крыша answers for them. Every targeted power is stopped by the token
    # except the one whose whole job is to take it — a defence that answers the attack on itself
    # would make that line unreachable. The client used to print "Крыша погасит" next to every
    # target of every power, including that one, directly under the sentence saying it will not.
    POWER_BLOCKED_BY_ROOF = {
        "military_roof_seize": False,
    }

    def role_power_status(self, state: GameState, player: PlayerState) -> list[dict[str, Any]]:
        """Every power of the player's role: can it be used now, and if not, what is missing.

        Two halves, and they are computed differently on purpose.

        ``available`` is the truth, taken from the engine itself: the power's own candidate
        commands are run through ``apply`` exactly as ``legal_transitions`` does, so a power is
        reported usable if and only if it really is. No rule is restated to produce it.

        ``gates`` is the *explanation*, and that part does restate the requirements — there is no
        way to turn a raised exception into "you need one more object of the Серый сектор" without
        naming the requirement somewhere. The two are cross-checked by a test: an unavailable power
        must have at least one unmet gate and an available one must have none, so a gate that
        drifts away from its handler fails the suite rather than lying to a player.

        Keys, not sentences, like every other engine-to-client vocabulary here.
        """
        role = player.role
        if role is None:
            return []
        legal = {
            self._power_of(command)
            for action, _ in self.legal_transitions(state, player.id)
            if action["type"] == "use_role_power"
            for command in [action["payload"]]
        }
        return [
            {
                "power": power,
                "available": power in legal,
                "spends_action": self.POWER_SPENDS_ACTION.get(power, True),
                "blocked_by_roof": self.POWER_BLOCKED_BY_ROOF.get(power, True),
                "gates": self._power_gates(state, player, power),
            }
            for power in self.ROLE_POWERS.get(role, ())
        ]

    @staticmethod
    def _power_of(payload: dict[str, Any]) -> str:
        return str(payload.get("power", ""))

    def _power_gates(self, state: GameState, player: PlayerState, power: str) -> list[dict[str, Any]]:
        """The requirements of one power, each with what the player has and what it needs."""
        rivals = [other for other in state.players if other.id != player.id]
        gates: list[dict[str, Any]] = []

        def gate(key: str, have: int, needed: int, **extra: Any) -> None:
            gates.append({"key": key, "have": have, "needed": needed, "met": have >= needed, **extra})

        if self.POWER_SPENDS_ACTION.get(power, True):
            gate("action", state.actions_left, 1)
        if power in self.ONCE_PER_TURN:
            gate("once_per_turn", 0 if self._flag(state, f"used:{power}") else 1, 1)

        if power == "capitalist_claim":
            gate("market_slot", sum(1 for item in state.market if item.claimed_by != player.id), 1)
            gate("scandal_room", self.scandal_limit(player) - player.scandals, 1)
        elif power == "politician_cleanup":
            gate("influence", player.influence, 2)
            gate("own_scandal", player.scandals, 1)
        elif power == "politician_deal":
            gate("influence", player.influence, POLITICIAN_DEAL_INFLUENCE)
            gate("district", self.owned_district_count(player, "shadows"), 1, district="shadows")
            gate("scandal_room", self.scandal_limit(player) - player.scandals, 1)
        elif power == "politician_veto":
            gate("influence", player.influence, POLITICIAN_VETO_INFLUENCE)
            gate(
                "project_slot",
                sum(1 for pid in state.project_board if state.project_veto.get(pid) != player.id),
                1,
            )
        elif power == "journalist_inflate":
            gate("rival", len(rivals), 1)
            gate("scandal_room", self.scandal_limit(player) - player.scandals, 1)
        elif power == "journalist_publish":
            gate("influence", player.influence, 3)
            gate("rival", len(rivals), 1)
        elif power == "fraudster_cleanup":
            gate("own_scandal", player.scandals, 1)
        elif power == "fraudster_crypto_scam":
            gate("own_asset", sum(1 for a in player.assets if a.card_id == "crypto"), 1, asset_id="crypto")
        elif power == "mafia_racket":
            gate("district", self.owned_district_count(player, "shadows"), 1, district="shadows")
            gate("rival", len(rivals), 1)
        elif power == "mafia_cleanup":
            gate("own_scandal", player.scandals, 1)
            gate("money", player.money, 3)
            gate("district", self.district_count(player, "government"), 1, district="government")
        elif power == "mafia_lock":
            gate("roof", player.roofs, 1)
            gate("market_slot", sum(1 for item in state.market if item.locked_by != player.id), 1)
        elif power == "military_sanction":
            gate("dirty_rival", sum(1 for other in rivals if other.scandals >= SANCTION_MONEY_TIER), 1)
        elif power == "military_inspection":
            gate("grey_rival", len(self.inspection_targets(state, player)), 1)
        elif power == "military_roof_seize":
            gate("influence", player.influence, MILITARY_SEIZE_INFLUENCE)
            gate("roofed_rival", sum(1 for other in rivals if other.roofs > 0), 1)
            gate("roof_room", self.roof_limit(player) - player.roofs, 1)
        return gates

    def role_perks(self, state: GameState, player: PlayerState) -> list[dict[str, Any]]:
        """What the viewer's role pays right now, and what it would pay with the missing district.

        A perk that quietly pays less is the same bug we fixed on the project board: the number was
        there, nobody could see it. Every row carries what it gives now (``value``), the ceiling it
        could reach (``potential``) and the district that unlocks the difference (``needs``), so the
        client only has to print labels — it never computes a rate.

        Keys, not sentences: the labels live in the clients, exactly like the settlement rows.
        """
        if not player.role:
            return []

        def count(district: str) -> int:
            return self.owned_district_count(player, district)

        rows: list[dict[str, Any]] = []
        if player.role == "capitalist":
            rows.append({"key": "capitalist_objects", "value": len(player.assets), "needs": None})
            rows.append({"key": "capitalist_business_charter", "value": 1, "needs": None})
            rows.append({"key": "capitalist_industrial_influence", "value": count("industrial"), "needs": "industrial"})
        elif player.role == "politician":
            rows.append(
                {"key": "politician_residents", "value": self.residents_influence(state, player), "needs": None}
            )
        elif player.role == "journalist":
            rivals = sum(other.scandals for other in state.players if other.id != player.id)
            has_business = count("business") > 0
            rows.append(
                {
                    "key": "journalist_money",
                    "value": (2 if has_business else 1) * rivals,
                    "potential": 2 * rivals,
                    "needs": None if has_business else "business",
                }
            )
            # No ceiling any more: one housing object switches the line on and the rating is the
            # scandal counter itself. `potential` is what it would pay once that object exists.
            has_readers = count("residential") > 0
            rows.append(
                {
                    "key": "journalist_rating",
                    "value": player.scandals if has_readers else 0,
                    "potential": player.scandals,
                    "needs": None if has_readers else "residential",
                }
            )
        elif player.role == "fraudster":
            rows.append({"key": "fraudster_actions", "value": 1, "needs": None})
            rows.append(
                {
                    "key": "fraudster_chance",
                    "value": int(FRAUDSTER_GREY_BONUS * 100),
                    "potential": int(FRAUDSTER_GREY_BONUS * 100),
                    "needs": None,
                }
            )
        elif player.role == "mafia":
            rows.append(
                {"key": "mafia_racket_money", "value": 2 + 2 * count("shadows"), "needs": "shadows"},
            )
            rows.append(
                {"key": "mafia_racket_influence", "value": count("government"), "needs": "government"},
            )
            rows.append({"key": "mafia_roofs", "value": self.roof_limit(player), "needs": None})
        elif player.role == "military":
            dirty = sum(1 for other in state.players if other.id != player.id and other.scandals >= SANCTION_MONEY_TIER)
            rows.append({"key": "military_sanction_targets", "value": dirty, "needs": None})
            # The inspection is the only power whose target set is computed rather than picked, so
            # the row is the preview: how many rivals it would reach, and how many of them are
            # standing behind a Крыша that would answer for them. Without it the only way to read
            # the outcome is to press the button.
            reached = self.inspection_targets(state, player)
            covered = sum(1 for target_id in reached if state.player_by_id(target_id).roofs > 0)
            rows.append(
                {
                    "key": "military_inspection_targets",
                    "value": len(reached) - covered,
                    "potential": len(reached),
                    "needs": None,
                }
            )
            roofs = sum(1 for other in state.players if other.id != player.id and other.roofs > 0)
            rows.append({"key": "military_seize_targets", "value": roofs, "needs": None})
        district = self.ROLE_DISTRICTS.get(player.role)
        if district:
            rows.append({"key": "role_district_income", "value": count(district), "needs": district})
        return rows

    def passive_influence(self, state: GameState, player: PlayerState) -> int:
        return sum(self.passive_influence_breakdown(state, player).values())

    def score(self, player: PlayerState) -> int:
        """Points come from what you built, not from what you hoarded.

        Money and influence pay at a deliberately poor rate — 10$ and 3◆ a point — and the two
        sinks pay double that for an action. Dropping the passive payout entirely was measured and
        reverted: the score got honest and the table got 70% less close, because the wallets of the
        trailing players were what kept the standings tight.
        """
        asset_score = sum(self.asset_value(asset) for asset in player.assets)
        return (
            player.money // MONEY_PER_POINT
            + player.influence // INFLUENCE_PER_POINT
            + asset_score
            + self.project_points(player)
            + player.bonus_points
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
            "bonus": player.bonus_points,
            "role": 3 if player.role else 0,
            "scandals": -player.scandals,
            "total": self.score(player),
        }

    def project_points(self, player: PlayerState) -> int:
        return sum(self.project(project_id).points for project_id in player.projects)

    def ranking(self, state: GameState) -> list[PlayerState]:
        return sorted(state.players, key=self.score, reverse=True)
