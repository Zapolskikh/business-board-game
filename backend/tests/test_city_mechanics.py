from __future__ import annotations

import pytest

from city_engine.commands import Command
from city_engine.constants import (
    CAMPAIGN_TIERS,
    CASH_TO_INFLUENCE_MONEY,
    COMPROMAT_INFLUENCE,
    HACK_INFLUENCE_STEAL,
    MARKET_ASSET_ROUNDS,
    MARKET_REROLL_COST,
    MAX_REPEATABLE_PROJECTS,
    PROJECT_BOARD_SIZE,
    PROJECT_REROLL_MONEY,
)
from city_engine.content import load_catalog
from city_engine.engine import CityEngine
from city_engine.errors import IllegalActionError, InvalidCommandError
from city_engine.factory import PlayerSetup, create_game_from_catalog
from city_engine.models import HeldCard, MarketAsset, OwnedAsset


def make_state(seed: int = 42):
    return create_game_from_catalog(
        "mechanics",
        [PlayerSetup("p1", "One"), PlayerSetup("p2", "Two")],
        seed=seed,
    )


def run(engine: CityEngine, state, command_type: str, payload: dict | None = None, actor_id: str | None = None):
    return engine.apply(
        state,
        Command(
            type=command_type,
            actor_id=actor_id or state.current_player.id,
            payload=payload or {},
            expected_revision=state.revision,
        ),
    ).state


def give_asset(state, player, card_id: str) -> OwnedAsset:
    owned = OwnedAsset(uid=f"owned:{player.id}:{card_id}", card_id=card_id)
    player.assets.append(owned)
    return owned


def give_card(state, player, card_id: str) -> HeldCard:
    state.action_deck = [item for item in state.action_deck if item != card_id]
    held = HeldCard(uid=f"held:{player.id}:{card_id}", card_id=card_id)
    player.hand.append(held)
    return held


def test_develop_a_district_then_sell_the_object() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    first = give_asset(state, player, "delivery")
    give_asset(state, player, "media")
    player.money = 30

    state = run(engine, state, "develop_district", {"district": "residential"})
    player = state.current_player
    assert player.district_levels["residential"] == 1
    assert player.influence == 3

    state = run(engine, state, "sell_asset", {"asset_uid": first.uid})
    player = state.current_player
    assert first.uid not in {asset.uid for asset in player.assets}
    assert player.money == 30 - 2 + 2  # development cost 2$, sale refunds half of a 4$ object


def test_buying_cards_draws_two_blind_for_one_action() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 20
    player.influence = 10
    expected = state.action_deck[:2]

    next_state = run(engine, state, "buy_action_card")
    next_player = next_state.current_player

    # Two cards, because a single blind card never beat a project for the same action.
    assert [card.card_id for card in next_player.hand] == expected
    assert (next_player.money, next_player.influence) == (17, 9)
    assert next_state.actions_left == state.actions_left - 1


def test_a_card_cannot_be_bought_without_actions_left() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 20
    player.influence = 10
    state.actions_left = 0

    legal = engine.legal_actions(state, player.id)
    assert not any(action["type"] == "buy_action_card" for action in legal)
    with pytest.raises(IllegalActionError):
        run(engine, state, "buy_action_card")


def test_discarding_a_card_returns_two_units() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    held = give_card(state, player, "grant")

    state = run(engine, state, "convert_action_card", {"card_uid": held.uid, "into": "influence"})

    # A single unit made the discard a pure loss on a card that cost 3$ and 1◆.
    assert state.current_player.influence == 4
    assert not state.current_player.hand


def test_only_one_card_may_be_discarded_per_turn() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    first = give_card(state, player, "grant")
    second = give_card(state, player, "bailout")

    state = run(engine, state, "convert_action_card", {"card_uid": first.uid, "into": "influence"})

    # A purchase draws two cards and the discard costs no action, so shredding both in one turn
    # made the blind draw a better influence pump than the campaign action it competes with.
    legal = engine.legal_actions(state, state.current_player.id)
    assert not any(action["type"] == "convert_action_card" for action in legal)
    with pytest.raises(IllegalActionError):
        run(engine, state, "convert_action_card", {"card_uid": second.uid, "into": "influence"})


def test_project_requirement_progress_gives_partial_credit() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    project = engine.project("government_complex")  # government objects >= 3

    assert engine.project_requirement_progress(player, project) == 0
    give_asset(state, player, "contract")
    assert engine.project_requirement_progress(player, project) == pytest.approx(1 / 3)
    give_asset(state, player, "archive")
    assert engine.project_requirement_progress(player, project) == pytest.approx(2 / 3)
    give_asset(state, player, "passport_office")
    # Without partial credit the first two objects scored zero, so a bot could only ever complete
    # a three-step condition by accident.
    assert engine.project_requirement_progress(player, project) == 1.0
    assert engine.project_requirement_met(player, project)


def test_binary_conditions_stay_binary() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player

    charter = engine.project("city_charter")  # needs any role
    assert engine.project_requirement_progress(player, charter) == 0.0
    player.role = "capitalist"
    assert engine.project_requirement_progress(player, charter) == 1.0


def test_roof_price_grows_with_the_round_and_mafia_pays_less() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 30

    assert engine.roof_price(state, player) == 3
    state.round_number = 3
    assert engine.roof_price(state, player) == 4
    state.round_number = 7
    assert engine.roof_price(state, player) == 6
    player.role = "mafia"
    assert engine.roof_price(state, player) == 5

    next_state = run(engine, state, "buy_roof")
    assert next_state.current_player.money == 25
    assert next_state.current_player.roofs == 1


def test_district_development_pays_at_least_one_per_level() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    # Base incomes 2 and 1: flooring the whole product used to pay +0 for the first level.
    give_asset(state, player, "delivery")
    give_asset(state, player, "media")
    baseline = engine._round_income(state, player)

    player.district_levels["residential"] = 1
    assert engine._round_income(state, player) == baseline + 2  # 2 → 3 and 1 → 2
    player.district_levels["residential"] = 2
    assert engine._round_income(state, player) == baseline + 4  # 3 → 4 and 2 → 3


def test_asset_purchase_event_reports_the_grey_scandal_in_deltas() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 20
    # A grey object charges a scandal on purchase; below the limit that writes no event of its own.
    state.market.append(MarketAsset(uid="asset:grey-test", card_id="market", expires_at_round=99))

    price = engine.asset_price(state, player, "market")
    state = run(engine, state, "buy_asset", {"market_uid": "asset:grey-test"})
    bought = next(event for event in reversed(state.event_log) if event.type == "asset_bought")
    assert bought.data["deltas"][player.id] == {"money": -price, "influence": 1, "scandals": 1, "roofs": 0}


def test_targeted_card_auto_blocked_by_roof() -> None:
    engine = CityEngine()
    state = make_state()
    attacker = state.current_player
    target = next(player for player in state.players if player.id != attacker.id)
    target.roofs = 1
    held = give_card(state, attacker, "audit")

    state = run(
        engine,
        state,
        "play_action_card",
        {"card_uid": held.uid, "target_id": target.id},
    )
    # The roof absorbs the effect automatically, with no decision asked: money intact, roof spent.
    assert state.player_by_id(target.id).money == 10
    assert state.player_by_id(target.id).roofs == 0


def test_targeted_card_hits_target_without_roof() -> None:
    engine = CityEngine()
    state = make_state()
    attacker = state.current_player
    target = next(player for player in state.players if player.id != attacker.id)
    target.roofs = 0
    held = give_card(state, attacker, "kompromat")
    state = run(
        engine,
        state,
        "play_action_card",
        {"card_uid": held.uid, "target_id": target.id},
    )
    assert state.player_by_id(target.id).scandals > 0


def test_deal_cards_apply_discounts_and_only_one_card_per_turn() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    subsidy = give_card(state, player, "market_subsidy")
    give_card(state, player, "grant")
    original_price = engine.asset_price(state, player, state.market[0].card_id)

    state = run(engine, state, "play_action_card", {"card_uid": subsidy.uid})
    assert engine.asset_price(state, state.current_player, state.market[0].card_id) == max(1, original_price - 4)
    legal = engine.legal_actions(state, state.current_player.id)
    assert not any(action["type"] == "play_action_card" for action in legal)


def test_sixth_scandal_jails_the_actor_and_burns_the_rest_of_the_turn() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    target = next(player for player in state.players if player.id != actor.id)
    # A double-scandal card charges the attacker one scandal before the target is touched.
    held = give_card(state, actor, "controlled_leak")
    actor.scandals = 5
    give_asset(state, actor, "mayor_secretariat")  # carryAction must not rescue the lost actions

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    jailed = state.player_by_id(actor.id)
    assert jailed.scandals == 3
    assert jailed.jail_turns == 1
    assert jailed.banked_actions == 0
    assert state.current_player.id == target.id
    assert any(event.type == "player_jailed" for event in state.event_log)

    # The jail turn itself grants a single action. Turn order is by standings now, so the jailed
    # player is not necessarily next: skip turns until their turn comes round again.
    while state.current_player.id != actor.id:
        state = run(engine, state, "end_turn")
    assert state.actions_left == 1


def settled_sources(state) -> dict:
    settled = next(event for event in state.event_log if event.type == "round_settled")
    return settled.data["income_sources"]


def test_journalist_earns_two_money_per_standing_rival_scandal() -> None:
    engine = CityEngine()
    state = make_state()
    journalist = state.current_player
    rival = next(player for player in state.players if player.id != journalist.id)
    journalist.role = "journalist"
    rival.role = "military"  # a role holder keeps scandals: no automatic shedding at turn start
    rival.scandals = 3

    state = run(engine, state, "end_turn")
    state = run(engine, state, "end_turn")

    assert settled_sources(state)[journalist.id]["journalist"] == 6


def test_every_cleanup_costs_an_action_and_nothing_else_limits_it() -> None:
    """One rule, one limit: the action. The per-turn counters were an invisible second limit."""
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "politician"
    player.influence = 10
    player.scandals = 3
    before = state.actions_left

    state = run(engine, state, "use_role_power", {"power": "politician_cleanup"})
    player = state.current_player
    assert (player.scandals, player.influence, state.actions_left) == (2, 8, before - 1)

    # Twice in a turn, which the old once-per-turn counter forbade: the actions are the limit.
    state = run(engine, state, "use_role_power", {"power": "politician_cleanup"})
    player = state.current_player
    assert (player.scandals, player.influence, state.actions_left) == (1, 6, before - 2)


def test_the_mafia_buries_a_case_for_money_and_needs_the_city_hall() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "mafia"
    player.money = 10
    player.scandals = 3
    player.roofs = 2

    # A Крыша used to be an accepted payment. It is the whole defence now, so it is not for sale.
    with pytest.raises(IllegalActionError):
        run(engine, state, "use_role_power", {"power": "mafia_cleanup"})

    give_asset(state, player, "archive")  # government district
    state = run(engine, state, "use_role_power", {"power": "mafia_cleanup"})
    player = state.current_player
    assert (player.scandals, player.money, player.roofs) == (1, 7, 2)


def test_the_politician_taxes_every_residential_object_on_the_table() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    give_asset(state, player, "delivery")  # residential
    give_asset(state, state.players[1], "media")  # residential, opponent's

    assert engine.residents_tax(state, player) == 0  # no role, no tax
    player.role = "politician"
    # Both objects pay, including the opponent's: the passive scales with how built-up the city is.
    assert engine.residents_tax(state, player) == 2
    assert engine._income_breakdown(state, player)["residents_tax"] == 2


def test_the_capitalist_earns_a_dollar_from_every_object() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    give_asset(state, player, "delivery")
    give_asset(state, player, "warehouse")
    baseline = engine._round_income(state, player)

    player.role = "capitalist"
    # Two objects, so two dollars — the passive that replaced a power nobody used.
    assert engine._round_income(state, player) == baseline + 2


def test_journalist_powers_use_scandal_rules() -> None:
    engine = CityEngine()
    state = make_state()
    journalist = state.current_player
    target = next(player for player in state.players if player.id != journalist.id)
    journalist.role = "journalist"
    journalist.influence = 10

    state = run(
        engine,
        state,
        "use_role_power",
        {"power": "journalist_inflate", "target_id": target.id},
    )
    assert state.current_player.scandals == 1
    assert state.player_by_id(target.id).scandals == 1
    state = run(
        engine,
        state,
        "use_role_power",
        {"power": "journalist_publish", "target_id": target.id},
    )
    assert state.current_player.influence == 7
    assert state.player_by_id(target.id).scandals == 2


def test_mafia_racket_has_two_money_base_before_scaling() -> None:
    engine = CityEngine()
    state = make_state()
    mafia = state.current_player
    target = next(player for player in state.players if player.id != mafia.id)
    mafia.role = "mafia"
    mafia.money = 30
    target.money = 20
    state.round_number = 6
    give_asset(state, mafia, "cash")

    state = run(
        engine,
        state,
        "use_role_power",
        {"power": "mafia_racket", "target_id": target.id},
    )

    # 2 base + 1 active Shadows asset + floor(6 * 2 / 4) = 6 money (target is not the leader).
    assert state.current_player.money == 36
    assert state.player_by_id(target.id).money == 14
    assert state.current_player.scandals == 1


def test_military_sanction_confiscates_asset_at_four_scandals() -> None:
    engine = CityEngine()
    state = make_state()
    military = state.current_player
    target = next(player for player in state.players if player.id != military.id)
    military.role = "military"
    target.scandals = 4
    give_asset(state, target, "delivery")
    valuable = give_asset(state, target, "urban_ecosystem")

    state = run(
        engine,
        state,
        "use_role_power",
        {"power": "military_sanction", "target_id": target.id},
    )
    assert valuable.uid in {asset.uid for asset in state.current_player.assets}
    assert valuable.uid not in {asset.uid for asset in state.player_by_id(target.id).assets}
    assert state.player_by_id(target.id).scandals == 3


def test_sanction_blocked_by_roof_does_not_clean_the_target() -> None:
    engine = CityEngine()
    state = make_state()
    military = state.current_player
    target = next(player for player in state.players if player.id != military.id)
    military.role = "military"
    target.scandals = 3
    target.roofs = 1
    target.money = 20

    state = run(engine, state, "use_role_power", {"power": "military_sanction", "target_id": target.id})

    hit = state.player_by_id(target.id)
    # The roof absorbs the whole sanction: money intact, and the record is NOT cleared as a bonus.
    assert (hit.roofs, hit.money, hit.scandals) == (0, 20, 3)
    assert any(event.type == "targeted_effect_blocked" for event in state.event_log)


def test_sanction_that_lands_still_clears_one_scandal() -> None:
    engine = CityEngine()
    state = make_state()
    military = state.current_player
    target = next(player for player in state.players if player.id != military.id)
    military.role = "military"
    target.scandals = 3
    target.roofs = 0
    target.money = 20

    state = run(engine, state, "use_role_power", {"power": "military_sanction", "target_id": target.id})

    hit = state.player_by_id(target.id)
    assert hit.scandals == 2
    assert hit.money == 20 - (3 + state.round_number)


def test_confiscation_and_upgrade_loss_are_logged() -> None:
    engine = CityEngine()
    state = make_state()
    military = state.current_player
    target = next(player for player in state.players if player.id != military.id)
    military.role = "military"
    target.scandals = 4
    give_asset(state, target, "delivery")
    valuable = give_asset(state, target, "urban_ecosystem")

    state = run(engine, state, "use_role_power", {"power": "military_sanction", "target_id": target.id})

    taken = next(event for event in state.event_log if event.type == "asset_confiscated")
    assert taken.data["asset_id"] == valuable.card_id
    assert taken.data["victim_id"] == target.id
    assert taken.data["resolution"] == "seized"


def test_freeze_card_reports_which_object_it_blocked() -> None:
    engine = CityEngine()
    state = make_state()
    attacker = state.current_player
    target = next(player for player in state.players if player.id != attacker.id)
    target.roofs = 0
    owned = give_asset(state, target, "delivery")
    held = give_card(state, attacker, "asset_freeze")  # kind=freeze, blocks the best object

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    blocked = next(event for event in state.event_log if event.type == "asset_state_changed")
    assert (blocked.data["asset_uid"], blocked.data["change"]) == (owned.uid, "blocked")


def test_antitrust_is_announced_and_itemised_in_the_settlement() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    for card_id in ("delivery", "media", "housing", "pharmacy_chain"):
        give_asset(state, player, card_id)
    player.capacity = 6
    held = give_card(state, player, "antitrust_probe")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid})
    announced = next(event for event in state.event_log if event.type == "antitrust_activated")
    assert player.id in announced.data["affected_player_ids"]

    money_before = state.current_player.money
    for _ in state.players:
        state = run(engine, state, "end_turn")

    sources = settled_sources(state)[player.id]
    assert sources["antitrust"] < 0
    # operations stays gross, so the breakdown still sums to the actual wallet change.
    assert sum(sources.values()) == state.player_by_id(player.id).money - money_before


def test_settlement_reports_where_influence_came_from() -> None:
    engine = CityEngine()
    state = make_state()
    politician = state.current_player
    politician.role = "politician"
    give_asset(state, politician, "delivery")
    give_asset(state, politician, "housing")
    influence_before = politician.influence

    for _ in state.players:
        state = run(engine, state, "end_turn")

    settled = next(event for event in state.event_log if event.type == "round_settled")
    breakdown = settled.data["influence_sources"][politician.id]
    # Itemised by source: a project perk paying +1◆ a round used to be indistinguishable from one
    # paying nothing, because the whole passive arrived as a single unlabelled number.
    assert breakdown == {"objects": 0, "administrative": 2, "projects": 0, "news": 0, "rating": 0}
    assert sum(breakdown.values()) == state.player_by_id(politician.id).influence - influence_before


def test_roof_insurance_is_not_offered_without_a_roof() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    give_asset(state, player, "cash")
    player.influence = 10
    player.roofs = 0

    greys = [action for action in engine.legal_actions(state, player.id) if action["type"] == "grey_operation"]
    assert greys and not any(action["payload"]["protect_failure"] for action in greys)

    player.roofs = 1
    greys = [action for action in engine.legal_actions(state, player.id) if action["type"] == "grey_operation"]
    assert any(action["payload"]["protect_failure"] for action in greys)


@pytest.mark.parametrize(
    "card_id",
    [asset.id for asset in load_catalog().assets.values() if "grey" in asset.tags],
)
def test_grey_assets_warn_about_the_purchase_scandal(card_id: str) -> None:
    # The scandal comes from the `grey` tag, so the card text is the only place a player can read it.
    assert "скандал" in load_catalog().assets[card_id].text.lower()


def test_grey_operation_uses_serialized_rng_for_success_and_failure() -> None:
    engine = CityEngine()
    success = make_state()
    actor = success.current_player
    give_asset(success, actor, "cash")
    actor.money = 20
    stake = engine.laundering_cost(success)
    success.rng.state = 0  # next random ~= .236, below the .85 laundering chance.
    success = run(engine, success, "grey_operation", {"asset_id": "cash"})
    # Laundering runs the other way now: money in, influence out. See LAUNDERING_BASE_GAIN.
    assert success.current_player.money == 20 - stake
    assert success.current_player.influence == 2 + engine.laundering_gain(success)
    assert success.current_player.scandals == 1

    failure = make_state()
    actor = failure.current_player
    give_asset(failure, actor, "cash")
    actor.money = 20
    failure.rng.state = 100_000  # next random ~= .991, above the .85 chance.
    failure = run(engine, failure, "grey_operation", {"asset_id": "cash"})
    # The launderer keeps the stake and delivers nothing.
    assert failure.current_player.money == 20 - stake
    assert failure.current_player.influence == 2
    assert failure.current_player.scandals == 2


def test_hacking_takes_influence_instead_of_blocking_an_object() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "datacenter")
    actor.scandals = 0
    target = next(other for other in state.players if other.id != actor.id)
    target.influence = 10
    target.roofs = 0
    give_asset(state, target, "robotics")
    state.rng.state = 0  # below the .55 hack chance

    state = run(engine, state, "grey_operation", {"asset_id": "datacenter", "target_id": target.id})

    hit = state.player_by_id(target.id)
    assert hit.influence == 10 - HACK_INFLUENCE_STEAL
    assert state.current_player.influence == 2 + HACK_INFLUENCE_STEAL
    # The block mechanic left this operation entirely: it was worth ~4$ against a 264$ wallet.
    assert not any(asset.blocked for asset in hit.assets)


def test_compromat_leak_strips_a_role_once_per_round() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "influence_broker")
    actor.influence = 10
    actor.scandals = 0
    target = next(other for other in state.players if other.id != actor.id)
    target.role = "capitalist"
    target.roofs = 0
    state.actions_left = 3
    state.rng.state = 0  # below the .70 leak chance

    state = run(engine, state, "grey_operation", {"asset_id": "influence_broker", "target_id": target.id})

    assert state.player_by_id(target.id).role is None
    assert state.current_player.influence == 10 - COMPROMAT_INFLUENCE
    assert state.current_player.scandals == 2
    # Once per round, not per turn: a per-turn cadence would hold the whole role board hostage.
    state.player_by_id(target.id).role = "politician"
    with pytest.raises(IllegalActionError):
        run(engine, state, "grey_operation", {"asset_id": "influence_broker", "target_id": target.id})


def test_compromat_leak_is_absorbed_by_a_roof() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "influence_broker")
    actor.influence = 10
    target = next(other for other in state.players if other.id != actor.id)
    target.role = "capitalist"
    target.roofs = 1
    state.rng.state = 0

    state = run(engine, state, "grey_operation", {"asset_id": "influence_broker", "target_id": target.id})

    hit = state.player_by_id(target.id)
    assert hit.role == "capitalist"
    assert hit.roofs == 0
    # The attacker still paid: the influence and the scandals are the price of the attempt.
    assert state.current_player.influence == 10 - COMPROMAT_INFLUENCE


@pytest.mark.parametrize("card_id", list(load_catalog().action_cards))
def test_every_action_card_has_a_working_engine_path(card_id: str) -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    target = next(other for other in state.players if other.id != player.id)
    player.money = 50
    player.influence = 50
    player.scandals = 2
    card = engine.action_card(card_id)
    held = give_card(state, player, card_id)
    payload: dict = {"card_uid": held.uid}

    if card.targeted:
        payload["target_id"] = target.id
        if card.kind == "role_pressure":
            target.role = "mafia"
        if card.kind == "freeze":
            give_asset(state, target, "delivery")
        if card.kind == "remove_development":
            target.district_levels["residential"] = 1
    elif card.kind in {"district_cash", "zoning", "develop"}:
        payload["district"] = "residential"
        give_asset(state, player, "delivery")
        if card.kind == "develop":
            give_asset(state, player, "media")
    elif card.kind == "copy_role":
        payload["role_id"] = "capitalist"
    elif card.kind == "project":
        # The unconditional project is always takeable, so the card path never depends on a build.
        state.project_board = ["art_museum", *state.project_board[:-1]]
        state.project_deck = [item for item in state.project_deck if item not in state.project_board]
        payload["project_id"] = "art_museum"
    elif card.kind == "unblock":
        give_asset(state, player, "delivery").blocked = True

    next_state = run(engine, state, "play_action_card", payload)
    assert held.uid not in {item.uid for item in next_state.current_player.hand}
    assert next_state.turn_flags["card_played"] is True


def test_the_relief_card_pays_in_slots_because_money_cannot_buy_the_scarce_half() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    held = give_card(state, player, "bailout")
    capacity = player.capacity

    state = run(engine, state, "play_action_card", {"card_uid": held.uid})

    # It used to pay 3$ to anybody not in last place: a third of a point, less than discarding the
    # card for 2◆. A slot is the half of an object purchase that money cannot replace.
    assert state.current_player.capacity == capacity + 1


def test_the_tax_manoeuvre_runs_money_into_influence_not_the_reverse() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 20
    player.influence = 1
    held = give_card(state, player, "tax_manoeuvre")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid})
    player = state.current_player

    # 2◆ → 8$ traded the scarce resource for the plentiful one, which made the card strictly worse
    # than throwing it away for 2◆. Reversed, it is the top campaign tier without the action.
    assert (player.money, player.influence) == (20 - CASH_TO_INFLUENCE_MONEY, 5)


def test_money_printed_on_cards_grows_with_the_round() -> None:
    engine = CityEngine()
    state = make_state()
    state.current_player.money = 0
    held = give_card(state, state.current_player, "grant")
    state.round_number = 12

    state = run(engine, state, "play_action_card", {"card_uid": held.uid})

    # 7$ is 0.7 points by the rate the game scores at, and every other money figure — the roof, the
    # racket, laundering — already scales with the round. These did not, so they aged into dump fodder.
    assert state.current_player.money == 7 + 12


def put_on_board(state, project_id: str) -> None:
    state.project_board = [project_id, *[item for item in state.project_board if item != project_id]][
        :PROJECT_BOARD_SIZE
    ]
    state.project_deck = [item for item in state.project_deck if item not in state.project_board]


def test_money_and_influence_are_fuel_not_score() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 47
    player.influence = 11
    player.scandals = 2

    breakdown = engine.score_breakdown(player)
    # 47$ → 4 points, 11◆ → 3: hoarding a round's income is worth less than a single object.
    assert breakdown["money"] == 4
    assert breakdown["influence"] == 3
    assert breakdown["scandals"] == -2
    assert breakdown["total"] == engine.score(player)

    player.projects.append("art_museum")
    assert engine.score_breakdown(player)["projects"] == engine.project("art_museum").points


def test_taking_a_project_pays_points_and_denies_it_to_everybody_else() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    put_on_board(state, "art_museum")
    project = engine.project("art_museum")
    player.money = 30
    player.influence = 20

    state = run(engine, state, "city_project", {"project_id": "art_museum"})
    player = state.current_player

    assert player.projects == ["art_museum"]
    assert player.money == 30 - project.cost_money
    assert player.influence == 20 - project.cost_influence
    assert "art_museum" not in state.project_board
    assert len(state.project_board) == PROJECT_BOARD_SIZE  # refilled from the deck at once
    assert not any(
        action["payload"].get("project_id") == "art_museum"
        for action in engine.legal_actions(state, player.id)
        if action["type"] == "city_project"
    )


def test_project_condition_is_enforced() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    put_on_board(state, "metro_line")  # requires objects in three different districts
    player.money = 30
    player.influence = 20

    with pytest.raises(IllegalActionError):
        run(engine, state, "city_project", {"project_id": "metro_line"})

    for card_id in ("delivery", "cowork", "warehouse"):
        give_asset(state, player, card_id)
    state = run(engine, state, "city_project", {"project_id": "metro_line"})
    assert state.current_player.projects == ["metro_line"]


def test_project_perk_pays_every_round() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    before_income = engine._round_income(state, player)
    before_influence = engine.passive_influence(player)

    player.projects.append("metro_line")  # perk: +2$ per round
    player.projects.append("courthouse")  # perk: +2◆ per round

    assert engine._round_income(state, player) == before_income + 2
    assert engine.passive_influence(player) == before_influence + 2


def test_project_board_rotates_so_it_cannot_jam() -> None:
    engine = CityEngine()
    state = make_state()
    stale = state.project_board[0]

    while state.round_number == 1:
        state = run(engine, state, "end_turn")

    assert stale not in state.project_board
    assert state.project_deck[-1] == stale  # to the bottom of the deck, not out of the game
    assert len(state.project_board) == PROJECT_BOARD_SIZE


def test_the_trailing_player_opens_the_next_round() -> None:
    engine = CityEngine()
    state = make_state()
    leader = state.current_player
    trailing = next(player for player in state.players if player.id != leader.id)
    leader.money = 200

    while state.round_number == 1:
        state = run(engine, state, "end_turn")

    assert state.turn_order[0] == trailing.id
    assert state.current_player.id == trailing.id
    assert state.players[state.starting_player_index].id == trailing.id


def test_demolition_order_takes_a_development_level() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    target = state.players[1]
    give_asset(state, target, "delivery")
    give_asset(state, target, "media")
    target.district_levels["residential"] = 2
    held = give_card(state, player, "antitrust")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    # A level, not the object: districts are the long game, and erasing one outright would make
    # this the strongest attack in the deck.
    assert state.players[1].district_levels["residential"] == 1
    assert any(event.type == "development_removed" for event in state.event_log)


def test_demolition_order_needs_a_developed_district() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    target = state.players[1]
    held = give_card(state, player, "antitrust")

    with pytest.raises(IllegalActionError):
        run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})


def test_selling_costs_no_action_so_a_swap_costs_only_the_purchase() -> None:
    """Sell-then-buy replaces the dedicated one-action swap and must cost the same one action."""
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    cheap = give_asset(state, player, "delivery")  # cost 4 → refund 2
    give_asset(state, player, "media")
    give_asset(state, player, "warehouse")
    player.capacity = 3  # full slots: the case the swap command used to exist for
    player.money = 30
    state.market.append(MarketAsset(uid="asset:replacement", card_id="robotics", expires_at_round=99))
    price = engine.asset_price(state, player, "robotics")
    actions_before = state.actions_left

    state = run(engine, state, "sell_asset", {"asset_uid": cheap.uid})
    player = state.current_player
    assert player.money == 32
    assert state.actions_left == actions_before  # the sale itself is free

    state = run(engine, state, "buy_asset", {"market_uid": "asset:replacement"})
    player = state.current_player
    assert [asset.card_id for asset in player.assets] == ["media", "warehouse", "robotics"]
    assert player.money == 32 - price
    assert state.actions_left == actions_before - 1  # one action for the whole swap, as before


def test_selling_is_offered_with_an_empty_action_counter() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    owned = give_asset(state, player, "delivery")
    state.actions_left = 0

    sales = [action for action in engine.legal_actions(state, player.id) if action["type"] == "sell_asset"]
    assert [action["payload"]["asset_uid"] for action in sales] == [owned.uid]


def test_replace_asset_no_longer_exists() -> None:
    """The swap was a whole command plus an owned × market choice matrix; a free sale replaces it."""
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    give_asset(state, player, "delivery")
    give_asset(state, player, "media")
    give_asset(state, player, "warehouse")
    player.capacity = 3  # full slots: the only situation the swap was ever offered in
    player.money = 30
    state.market.append(MarketAsset(uid="asset:replacement", card_id="robotics", expires_at_round=99))

    assert not any(action["type"] == "replace_asset" for action in engine.legal_actions(state, player.id))
    with pytest.raises(InvalidCommandError):
        run(engine, state, "replace_asset", {"asset_uid": player.assets[0].uid, "market_uid": "asset:replacement"})


def test_the_campaign_is_one_button_at_one_rate() -> None:
    """Three tiers were three buttons for the same idea, and the middle one was the only one used."""
    engine = CityEngine()
    assert CAMPAIGN_TIERS == {5: 3}
    ((spend, gain),) = CAMPAIGN_TIERS.items()

    state = make_state()
    player = state.current_player
    player.money = 20
    player.influence = 0
    state = run(engine, state, "basic_action", {"kind": "campaign", "spend": spend})
    player = state.current_player
    assert (player.money, player.influence) == (20 - spend, gain)

    # Laundering is the unbounded channel, so from the mid-game on it has to beat the button —
    # otherwise it is dominated by the basic action and nobody ever runs it (measured: zero uses).
    rate = spend / gain
    state = make_state()
    for round_number in (6, 10, 15):
        state.round_number = round_number
        grey_rate = engine.laundering_cost(state) / engine.laundering_gain(state)
        assert grey_rate < rate, f"laundering is dominated in round {round_number}"

    # Every other amount is gone, including the two tiers that used to exist.
    state = make_state()
    state.current_player.money = 20
    for rejected in (2, 4, 9):
        with pytest.raises(InvalidCommandError):
            run(engine, state, "basic_action", {"kind": "campaign", "spend": rejected})


def test_journalist_keeps_the_role_one_scandal_longer() -> None:
    engine = CityEngine()
    state = make_state()
    reporter = state.current_player
    reporter.role = "journalist"
    other = next(player for player in state.players if player.id != reporter.id)
    other.role = "mafia"

    # The journalist earns influence for their own scandals, so the ordinary limit of five put
    # their best line permanently one point from collapse.
    engine.add_scandal(state, reporter, 5)
    assert (reporter.scandals, reporter.role) == (5, "journalist")
    engine.add_scandal(state, reporter, 1)
    assert (reporter.scandals, reporter.role, reporter.jail_turns) == (6, None, 0)

    engine.add_scandal(state, other, 5)
    assert (other.scandals, other.role) == (5, None)


def test_reaching_the_scandal_limit_announces_the_lost_role() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "politician"
    player.scandals = 4

    engine.add_scandal(state, player, 1)

    # Losing a role used to be readable only by diffing your own state between two turns.
    event = state.event_log[-1]
    assert event.type == "scandal_limit_reached"
    assert (event.actor_id, event.data["role_id"], event.data["jailed"]) == (player.id, "politician", False)
    assert player.role is None


def test_being_jailed_by_somebody_else_is_announced() -> None:
    engine = CityEngine()
    state = make_state()
    victim = next(player for player in state.players if player.id != state.current_player.id)
    victim.role = "mafia"
    victim.scandals = 5

    engine.add_scandal(state, victim, 1)

    event = state.event_log[-1]
    assert event.type == "scandal_limit_reached"
    assert (event.data["jailed"], event.data["role_id"]) == (True, "mafia")
    assert (victim.scandals, victim.jail_turns) == (3, 1)


def test_one_token_answers_a_takeover_a_leak_and_a_scandal() -> None:
    """The merge: Крыша is the whole defence, so all three attacks spend the same token."""
    engine = CityEngine()

    # A scandal, however big, is absorbed whole — and says so in the log.
    state = make_state()
    player = state.current_player
    player.roofs = 1
    engine.add_scandal(state, player, 2)
    event = state.event_log[-1]
    assert event.type == "scandal_blocked"
    assert (event.data["absorbed"], event.data["roofs"]) == (2, 0)
    assert player.scandals == 0

    # A role takeover: the token goes, the attacker's influence comes back.
    state = make_state()
    attacker, holder = state.players[0], state.players[1]
    holder.role = "capitalist"
    holder.roofs = 1
    attacker.influence = 30
    state = run(engine, state, "claim_role", {"role_id": "capitalist"})
    attacker, holder = state.players[0], state.players[1]
    assert (holder.role, holder.roofs, attacker.influence) == ("capitalist", 0, 30)

    # And the compromat leak, which used to want a card of its own.
    state = make_state()
    target = state.players[1]
    target.role = "military"
    target.roofs = 1
    engine._resolve_compromat(state, state.players[0], target)
    assert (target.role, target.roofs) == ("military", 0)


def test_two_tokens_is_the_ceiling_and_a_perk_refills_one_a_turn() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    assert engine.roof_limit(player) == 2
    player.role = "mafia"
    assert engine.roof_limit(player) == 3


def test_roof_blocks_a_journalist_scandal_like_any_other_attack() -> None:
    engine = CityEngine()
    state = make_state()
    reporter = state.current_player
    reporter.role = "journalist"
    reporter.influence = 10
    target = next(player for player in state.players if player.id != reporter.id)
    target.roofs = 1

    state = run(engine, state, "use_role_power", {"power": "journalist_publish", "target_id": target.id})
    hit = state.player_by_id(target.id)

    # Every other targeted effect checks the roof; these two used to punch straight through.
    assert hit.scandals == 0
    assert hit.roofs == 0
    assert any(event.type == "targeted_effect_blocked" for event in state.event_log)


def test_initiatives_are_capped_per_game() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 200
    player.influence = 200

    for _ in range(MAX_REPEATABLE_PROJECTS):
        state = run(engine, state, "city_project", {"project_id": "city_initiative"})
        state.actions_left = 3
        player = state.current_player

    assert player.projects == ["city_initiative"] * MAX_REPEATABLE_PROJECTS
    # Unlimited initiatives took 38% of all project points in the arena match.
    with pytest.raises(IllegalActionError):
        run(engine, state, "city_project", {"project_id": "municipal_programme"})


def test_the_market_holds_still_for_a_whole_round() -> None:
    """Slots expire in rounds, so the board cannot change between two of a player's own turns."""
    engine = CityEngine()
    state = make_state()
    assert [item.expires_at_round for item in state.market] == [1 + MARKET_ASSET_ROUNDS] * len(state.market)

    before = [item.uid for item in state.market]
    opening_round = state.round_number
    # Every other player takes their turn; the round has not turned over yet.
    while state.round_number == opening_round:
        previous = [item.uid for item in state.market]
        state = run(engine, state, "end_turn")
        if state.round_number == opening_round:
            assert [item.uid for item in state.market] == previous
    assert [item.uid for item in state.market] == before  # untouched for the whole round

    while state.round_number < 1 + MARKET_ASSET_ROUNDS:
        state = run(engine, state, "end_turn")
    # The round the slots were dated to has arrived, so they are gone and replaced.
    assert not {item.uid for item in state.market} & set(before)
    assert len(state.market) == len(before)
    assert any(event.type == "market_rotated" for event in state.event_log)


def test_market_reroll_costs_money_but_no_action() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 10
    state.actions_left = 0
    before = [item.card_id for item in state.market]

    state = run(engine, state, "reroll_market")
    player = state.current_player

    assert player.money == 10 - MARKET_REROLL_COST
    assert state.actions_left == 0
    assert len(state.market) == len(before)
    assert [item.card_id for item in state.market] != before
    # One reroll per turn, so it cannot be used to fish the whole deck in a single turn.
    with pytest.raises(IllegalActionError):
        run(engine, state, "reroll_market")


def test_project_reroll_redeals_the_whole_board_for_money_and_an_action() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 100
    player.influence = 2
    state.actions_left = 2
    before = list(state.project_board)
    deck_size = len(state.project_deck)

    state = run(engine, state, "reroll_projects")
    player = state.current_player

    # Influence is the currency the projects themselves are bought with, so charging it for the
    # re-deal taxed the exact resource the board wants spent. Money is the surplus — but the price
    # has to be an order of magnitude above the market reroll, or the shared board churns for free,
    # and it costs an action because moving four cards is a decision, not an end-of-turn click.
    assert (player.influence, player.money) == (2, 100 - PROJECT_REROLL_MONEY)
    assert PROJECT_REROLL_MONEY > MARKET_REROLL_COST * 2
    assert state.actions_left == 1
    # The whole board is re-dealt, not rotated by one: four cards go back, four come out.
    assert len(state.project_board) == PROJECT_BOARD_SIZE
    assert len(state.project_deck) == deck_size
    assert set(before) <= set(state.project_board) | set(state.project_deck)
    assert set(state.project_board) != set(before)


def test_project_reroll_needs_an_action() -> None:
    engine = CityEngine()
    state = make_state()
    state.current_player.money = 100
    state.actions_left = 0

    legal = engine.legal_actions(state, state.current_player.id)
    assert not any(action["type"] == "reroll_projects" for action in legal)
    with pytest.raises(IllegalActionError):
        run(engine, state, "reroll_projects")


def test_project_reroll_is_illegal_without_the_money() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = PROJECT_REROLL_MONEY - 1
    player.influence = 20

    assert not any(action["type"] == "reroll_projects" for action in engine.legal_actions(state, player.id))
    with pytest.raises(IllegalActionError):
        run(engine, state, "reroll_projects")
