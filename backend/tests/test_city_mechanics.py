from __future__ import annotations

import pytest

from city_engine.commands import Command
from city_engine.constants import (
    ACTION_DECK_COPIES,
    BASE_SCANDAL_LIMIT,
    CAMPAIGN_TIERS,
    CASH_TO_INFLUENCE_MONEY,
    CRYPTO_SCAM_SCANDALS,
    CRYPTO_SCAM_SHARE,
    GREY_FAILURE_SCANDALS,
    GREY_OPERATION_CHANCE,
    GREY_OPERATION_POINTS,
    GREY_SUCCESS_SCANDALS,
    INFLUENCE_PER_POINT,
    LOBBYING_INFLUENCE,
    LOBBYING_POINTS,
    MARKET_ROTATION_SIZE,
    MILITARY_SEIZE_INFLUENCE,
    MONEY_PER_POINT,
    PATRONAGE_MONEY,
    PATRONAGE_POINTS,
    POINTS_CARD_RATE,
    PROJECT_BOARD_SIZE,
    PROJECT_REROLL_MONEY,
    ROOF_BREAK_POINT_PER_ROOF,
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


def rival_of(state, player):
    """The other seat. Which seat opens the game is drawn from the shared RNG stream, so any test
    that hardcodes ``players[1]`` as the victim breaks the moment an unrelated deck changes size.
    """
    return next(other for other in state.players if other.id != player.id)


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


def test_the_action_deck_holds_several_copies_of_every_card() -> None:
    """One copy each ran the deck dry around round 9, which deleted the card layer exactly when
    the late game has the fewest things left to spend an action on."""
    catalog = load_catalog()
    state = make_state()

    assert len(state.action_deck) == len(catalog.action_cards) * ACTION_DECK_COPIES
    assert all(state.action_deck.count(card_id) == ACTION_DECK_COPIES for card_id in catalog.action_cards)


def test_two_copies_of_one_card_are_told_apart_in_hand() -> None:
    """The uid used to be the card id, which was unique only while the deck was."""
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    state.action_deck = ["subsidy", "subsidy", "subsidy"]

    first = engine._draw_action_card(state, player)
    second = engine._draw_action_card(state, player)

    assert first is not None and second is not None
    assert first.card_id == second.card_id == "subsidy"
    assert first.uid != second.uid
    assert len({card.uid for card in player.hand}) == len(player.hand)


def test_selling_an_object_refunds_half_its_price() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    first = give_asset(state, player, "delivery")
    give_asset(state, player, "media")
    player.money = 30

    state = run(engine, state, "sell_asset", {"asset_uid": first.uid})
    player = state.current_player
    assert first.uid not in {asset.uid for asset in player.assets}
    assert player.money == 30 + 2  # half of a 4$ object


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


def test_point_cards_are_a_better_rate_than_the_always_available_patronage() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    held = give_card(state, player, "scholarship")
    card = engine.action_card("scholarship")
    price = card.value * POINTS_CARD_RATE
    player.money = price

    state = run(engine, state, "play_action_card", {"card_uid": held.uid})

    assert state.current_player.money == 0
    assert state.current_player.bonus_points == card.value
    assert price / card.value < PATRONAGE_MONEY / PATRONAGE_POINTS


def test_the_hand_may_be_spent_at_any_speed_but_bought_once_a_turn() -> None:
    """The turn cap sits on the supply, not on what a player already paid for.

    Shredding two cards in one turn used to be a better influence pump than the campaign action.
    That is closed by capping the purchase instead, which leaves the hand free to move — the thing
    that made the card layer feel rationed rather than alive.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    first = give_card(state, player, "grant")
    second = give_card(state, player, "bailout")

    state = run(engine, state, "convert_action_card", {"card_uid": first.uid, "into": "influence"})
    state = run(engine, state, "convert_action_card", {"card_uid": second.uid, "into": "influence"})
    assert state.current_player.hand == []

    state.current_player.money = 50
    state.current_player.influence = 50
    state = run(engine, state, "buy_action_card", {})
    legal = engine.legal_actions(state, state.current_player.id)
    assert not any(action["type"] == "buy_action_card" for action in legal)
    with pytest.raises(IllegalActionError):
        run(engine, state, "buy_action_card", {})


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


def test_object_income_is_flat_and_nothing_multiplies_it() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    # District development used to raise this by 25% per level, twice, for 2$ and one action — the
    # cheapest exponent in the game. It is gone: an object earns what it prints, plus synergy.
    first = give_asset(state, player, "delivery")  # 2$
    second = give_asset(state, player, "media")  # 1$
    printed = engine.owned_definition(first).income + engine.owned_definition(second).income
    synergy = engine.object_synergy_income(state, player, first) + engine.object_synergy_income(state, player, second)

    assert engine._round_income(state, player) == printed + synergy


def test_buying_a_grey_asset_costs_no_scandal() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 20
    # Objects never charge scandals any more, not even the grey ones: the market card shows money
    # and influence only, so a hidden ⚠ there pushed the fraudster over the limit during setup.
    state.market.append(MarketAsset(uid="asset:grey-test", card_id="market"))

    price = engine.asset_price(state, player, "market")
    state = run(engine, state, "buy_asset", {"market_uid": "asset:grey-test"})
    bought = next(event for event in reversed(state.event_log) if event.type == "asset_bought")
    assert bought.data["deltas"][player.id] == {"money": -price, "influence": 1, "scandals": 0, "roofs": 0}
    assert state.player_by_id(player.id).scandals == 0


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


def test_deal_cards_apply_discounts_and_may_be_chained_in_one_turn() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    subsidy = give_card(state, player, "market_subsidy")
    grant = give_card(state, player, "grant")
    original_price = engine.asset_price(state, player, state.market[0].card_id)

    state = run(engine, state, "play_action_card", {"card_uid": subsidy.uid})
    assert engine.asset_price(state, state.current_player, state.market[0].card_id) == max(1, original_price - 4)

    # The second card goes down in the same turn: playing costs no action, and the cap that used
    # to sit here moved to the purchase.
    state = run(engine, state, "play_action_card", {"card_uid": grant.uid})
    assert state.current_player.hand == []


def test_a_vote_of_no_confidence_that_takes_a_role_says_so() -> None:
    """Losing a role is the loudest thing on the board, and this path used to do it in silence."""
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    target = rival_of(state, actor)
    target.role = "capitalist"
    target.influence = 2  # below the card's value, so the seat goes instead of the influence
    held = give_card(state, actor, "vote")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    hit = state.player_by_id(target.id)
    assert (hit.role, hit.influence) == (None, 0)
    stripped = next(event for event in state.event_log if event.type == "role_stripped")
    assert (stripped.actor_id, stripped.data["target_id"], stripped.data["role_id"]) == (
        actor.id,
        target.id,
        "capitalist",
    )


def test_a_vote_of_no_confidence_that_can_be_paid_leaves_the_role_alone() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    target = rival_of(state, actor)
    target.role = "capitalist"
    target.influence = 9
    held = give_card(state, actor, "vote")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    hit = state.player_by_id(target.id)
    assert (hit.role, hit.influence) == ("capitalist", 6)
    assert not any(event.type == "role_stripped" for event in state.event_log)


def test_sixth_scandal_jails_the_actor_and_burns_the_rest_of_the_turn() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    target = next(player for player in state.players if player.id != actor.id)
    # A double-scandal card charges the attacker one scandal before the target is touched.
    held = give_card(state, actor, "controlled_leak")
    actor.scandals = 5
    # A banked action must not survive the arrest. Nothing in the catalog grants `carryAction`
    # since «Секретариат мэра» left, so the guard is set up by hand rather than by an object.
    actor.banked_actions = 1

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


def test_journalist_money_doubles_with_a_business_object() -> None:
    """The journalist owns no district, so its money line hangs off somebody else's quarter."""
    engine = CityEngine()
    state = make_state()
    journalist = state.current_player
    rival = next(player for player in state.players if player.id != journalist.id)
    journalist.role = "journalist"
    rival.role = "military"  # a role holder keeps scandals: no automatic shedding at turn start
    rival.scandals = 3

    state = run(engine, state, "end_turn")
    state = run(engine, state, "end_turn")
    assert settled_sources(state)[journalist.id]["journalist"] == 3  # 1$ a scandal, bare

    give_asset(state, state.player_by_id(journalist.id), "insurance_agency")  # Деловой центр
    for _ in state.players:
        state = run(engine, state, "end_turn")
    # settled_sources reads the first settlement, so take the last one explicitly.
    last = [event for event in state.event_log if event.type == "round_settled"][-1]
    assert last.data["income_sources"][journalist.id]["journalist"] == 6


def test_the_final_round_pays_no_income_and_no_influence() -> None:
    """A settlement is what a player carries into the *next* round, and after the last one there is
    none: the payout could only ever be scored at the passive rate (10$ and 3◆ a point), which
    handed everybody points that no decision at that table could still change. Across six exported
    matches it moved every player by 4-7 points and turned a one-point finish into a tie.
    """
    engine = CityEngine()
    state = make_state()
    for player in state.players:
        give_asset(state, player, "delivery")
        player.money = 0
        player.influence = 0

    incomes, _, _ = engine.settlement_preview(state)
    assert all(value > 0 for value in incomes.values())  # an ordinary round pays

    state.round_number = state.max_rounds
    incomes, income_sources, influence_sources = engine.settlement_preview(state)
    assert incomes == dict.fromkeys(incomes, 0)
    assert all(sum(row.values()) == 0 for row in income_sources.values())
    assert all(sum(row.values()) == 0 for row in influence_sources.values())
    # The forecast is this same function, so the panel promises nothing either.
    forecast = engine.round_forecast(state, state.current_player)
    assert forecast["money"]["total"] == 0
    assert forecast["influence"]["total"] == 0

    for _ in state.players:
        state = run(engine, state, "end_turn")

    assert state.status == "finished"
    assert all(player.money == 0 and player.influence == 0 for player in state.players)
    settled = [event for event in state.event_log if event.type == "round_settled"][-1]
    # The per-object rows have to add back up to the ``objects`` line, or every income figure the
    # balance harness prints is fiction.
    assert settled.data["object_income_sources"] == {player.id: {} for player in state.players}


def test_the_final_round_still_collects_the_debt() -> None:
    """Dropping the whole settlement would make «Мостовой кредит» free money on the last round:
    10$ now against 4$ that never come due. What the round owes is still collected."""
    engine = CityEngine()
    state = make_state()
    state.round_number = state.max_rounds
    borrower = state.current_player
    borrower.money = 10
    borrower.debt = 4

    for _ in state.players:
        state = run(engine, state, "end_turn")

    assert state.status == "finished"
    settled = state.player_by_id(borrower.id)
    assert settled.money == 6
    assert settled.debt == 0


def test_the_engine_counts_a_project_condition_for_the_player() -> None:
    """Have/needed comes from the engine: 16 tag projects went unused because nobody counted."""
    engine = CityEngine()
    state = make_state()
    player = state.current_player

    tagged = next(
        project
        for project in engine.catalog.projects.values()
        if project.requirement.get("type") == "tag_objects" and int(project.requirement.get("count", 1)) >= 2
    )
    standing = engine.project_requirement_standing(player, tagged)
    assert (standing["binary"], standing["have"], standing["met"]) == (False, 0, False)
    assert standing["needed"] == int(tagged.requirement["count"])

    # A condition with no halves reports a yes/no instead of a fraction nobody could read.
    role_gated = next(
        project for project in engine.catalog.projects.values() if project.requirement.get("type") == "role"
    )
    assert engine.project_requirement_standing(player, role_gated) == {
        "binary": True,
        "met": False,
        "have": 0,
        "needed": 1,
    }
    player.role = "capitalist"
    assert engine.project_requirement_standing(player, role_gated)["met"] is True


def test_depth_pays_influence_from_the_fourth_object() -> None:
    """Development was the reward for building deep, and it paid money multiplied by itself.

    What replaced it is a flat token in the currency projects are bought with, printed on the late
    objects that carry it — an explicit ``synergyInfluence`` effect rather than "epics behave
    differently", so the card states the rule instead of the player having to learn it.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.capacity = 6
    deep = next(
        asset
        for asset in load_catalog().assets.values()
        if asset.effects.get("synergyInfluence") and asset.district == "residential"
    )
    owned = give_asset(state, player, deep.id)

    # One object of the district: the effect is printed but pays nothing yet.
    assert engine.passive_influence_breakdown(state, player)["synergy"] == 0

    for _ in range(3):
        give_asset(state, player, "housing")
    assert engine.district_count(player, "residential") == 4
    assert engine.passive_influence_breakdown(state, player)["synergy"] == deep.effects["synergyInfluence"]

    # The payout lives on the object: lose it and the district drops back below four.
    player.assets.remove(owned)
    assert engine.passive_influence_breakdown(state, player)["synergy"] == 0


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


def test_the_politician_is_paid_influence_for_every_residential_object_on_the_table() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    give_asset(state, player, "delivery")  # residential
    give_asset(state, state.players[1], "media")  # residential, opponent's

    assert engine.residents_influence(state, player) == 0  # no role, no line
    player.role = "politician"
    # Both objects pay, including the opponent's: the passive scales with how built-up the city is.
    # It pays influence, not money — the administrative quarter is the role's own district now and
    # pays the dollar an object, so this line moved to the currency the role is actually short of.
    assert engine.residents_influence(state, player) == 2
    assert engine.passive_influence_breakdown(state, player)["residents"] == 2
    assert "residents_tax" not in engine._income_breakdown(state, player)


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
    # The publication costs an action now, and lands twice as hard for it.
    actions_before = state.actions_left
    state = run(
        engine,
        state,
        "use_role_power",
        {"power": "journalist_publish", "target_id": target.id},
    )
    assert state.current_player.influence == 7
    assert state.actions_left == actions_before - 1
    assert state.player_by_id(target.id).scandals == 3  # one from the inflate, two from the story


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


def test_the_sanction_ladder_reads_the_target_scandal_counter() -> None:
    """Two scandals cost money, three cost influence too, four cost the role.

    The object confiscation is gone: attached to one role, it either did nothing with full slots or
    removed nine points of score, and nothing in between could be planned around.
    """
    engine = CityEngine()

    # Two scandals: money only, and the target keeps both its influence and its role.
    state = make_state()
    military, target = state.current_player, rival_of(state, state.current_player)
    military.role = "military"
    target.role = "capitalist"
    target.scandals, target.money, target.influence = 2, 40, 9
    state = run(engine, state, "use_role_power", {"power": "military_sanction", "target_id": target.id})
    target = state.player_by_id(target.id)
    assert (target.money, target.influence, target.role) == (40 - (3 + state.round_number), 9, "capitalist")
    # And the scandal stays: the sanction used to heal what it hit, knocking its own next tier away.
    assert target.scandals == 2

    # Three: influence goes too.
    state = make_state()
    military, target = state.current_player, rival_of(state, state.current_player)
    military.role = "military"
    target.role = "capitalist"
    target.scandals, target.money, target.influence = 3, 40, 9
    state = run(engine, state, "use_role_power", {"power": "military_sanction", "target_id": target.id})
    target = state.player_by_id(target.id)
    assert target.influence < 9 and target.role == "capitalist"

    # Four: the role itself.
    state = make_state()
    military, target = state.current_player, rival_of(state, state.current_player)
    military.role = "military"
    target.role = "capitalist"
    target.scandals, target.money, target.influence = 4, 40, 9
    state = run(engine, state, "use_role_power", {"power": "military_sanction", "target_id": target.id})
    assert state.player_by_id(target.id).role is None
    event = state.event_log[-2]
    assert event.type == "military_sanction"
    assert event.data["role_id"] == "capitalist"


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


def test_military_inspection_scandalises_everyone_in_the_grey_sector() -> None:
    """Aimed at a district, not at a player, so it cannot be dodged by being quiet.

    The role's other line reads the target's own scandal counter and needs somebody already dirty.
    This is what creates that state — and it is the only power in the game whose target set is
    computed, which is why the engine exposes `inspection_targets` for the clients to print.
    """
    engine = CityEngine()
    state = create_game_from_catalog(
        "military-inspection",
        [PlayerSetup(f"p{seat}", f"Player {seat}") for seat in range(1, 5)],
        seed=42,
    )
    military = state.current_player
    military.role = "military"
    rivals = [player for player in state.players if player.id != military.id]
    give_asset(state, rivals[0], "cash")  # shadows
    give_asset(state, rivals[1], "cash")  # shadows, and behind a roof
    rivals[1].roofs = 1
    give_asset(state, rivals[2], "housing")  # residential — untouched

    assert engine.inspection_targets(state, military) == [rivals[0].id, rivals[1].id]

    state = run(engine, state, "use_role_power", {"power": "military_inspection"})

    hit = [state.player_by_id(rival.id) for rival in rivals]
    assert hit[0].scandals == 1
    assert (hit[1].scandals, hit[1].roofs) == (0, 0)  # the roof answered instead
    assert hit[2].scandals == 0
    assert state.actions_left == 2
    event = next(item for item in state.event_log if item.type == "military_inspection")
    assert event.data["scandalised_ids"] == [rivals[0].id]


def test_military_inspection_is_not_offered_against_a_clean_city() -> None:
    engine = CityEngine()
    state = make_state()
    state.current_player.role = "military"

    powers = {
        action["payload"].get("power")
        for action in engine.legal_actions(state, state.current_player.id)
        if action["type"] == "use_role_power"
    }
    assert "military_inspection" not in powers
    with pytest.raises(IllegalActionError, match="shadows object"):
        run(engine, state, "use_role_power", {"power": "military_inspection"})


def test_military_seizes_a_roof_through_the_roof_it_takes() -> None:
    """The token cannot defend itself, exactly like «Пробить крышу».

    If it could, the power would be unreachable: the only players worth aiming it at are the ones
    holding the thing that would block it.
    """
    engine = CityEngine()
    state = make_state()
    military = state.current_player
    military.role = "military"
    military.influence = MILITARY_SEIZE_INFLUENCE
    target = rival_of(state, military)
    target.roofs = 1

    state = run(engine, state, "use_role_power", {"power": "military_roof_seize", "target_id": target.id})

    assert state.current_player.roofs == 1
    assert state.player_by_id(target.id).roofs == 0
    assert state.current_player.influence == 0
    assert state.actions_left == 2
    assert any(event.type == "roof_seized" for event in state.event_log)


def test_seizing_a_roof_needs_a_target_holding_one() -> None:
    engine = CityEngine()
    state = make_state()
    military = state.current_player
    military.role = "military"
    military.influence = MILITARY_SEIZE_INFLUENCE
    target = rival_of(state, military)
    target.roofs = 0

    with pytest.raises(IllegalActionError, match="holds no roof"):
        run(engine, state, "use_role_power", {"power": "military_roof_seize", "target_id": target.id})


def test_settlement_reports_where_influence_came_from() -> None:
    engine = CityEngine()
    state = make_state()
    politician = state.current_player
    politician.role = "politician"
    give_asset(state, politician, "delivery")  # Спальный район: two of them, so the residents line pays 2
    give_asset(state, politician, "housing")
    influence_before = politician.influence

    for _ in state.players:
        state = run(engine, state, "end_turn")

    settled = next(event for event in state.event_log if event.type == "round_settled")
    breakdown = settled.data["influence_sources"][politician.id]
    # Itemised by source: a project perk paying +1◆ a round used to be indistinguishable from one
    # paying nothing, because the whole passive arrived as a single unlabelled number.
    # The residents line pays 1◆ per residential object anywhere in the city; the politician's two
    # are the only ones on this table. It used to be money, and the row was called the residents tax.
    assert breakdown == {
        "objects": 0,
        "synergy": 0,
        "residents": 2,
        "industrial": 0,
        "projects": 0,
        "rating": 0,
    }
    assert sum(breakdown.values()) == state.player_by_id(politician.id).influence - influence_before


@pytest.mark.parametrize(
    "card_id",
    [asset.id for asset in load_catalog().assets.values() if "grey" in asset.tags],
)
def test_grey_assets_do_not_promise_a_purchase_scandal(card_id: str) -> None:
    # Purchases are clean now, so no card may advertise a scandal it will not charge.
    asset = load_catalog().assets[card_id]
    assert "scandals" not in asset.effects.get("purchase", {})
    assert "при покупке" not in asset.text.lower() or "скандал" not in asset.text.lower()


def test_grey_operation_uses_serialized_rng_for_success_and_failure() -> None:
    engine = CityEngine()
    success = make_state()
    actor = success.current_player
    give_asset(success, actor, "cash")
    for rival in success.players:
        if rival.id != actor.id:
            rival.roofs = 0
    success.rng.state = 0  # next random ~= .236, below the .60 smear chance.
    success = run(engine, success, "grey_operation", {"asset_id": "smear"})
    assert all(rival.scandals == 1 for rival in success.players if rival.id != actor.id)
    assert success.current_player.scandals == GREY_SUCCESS_SCANDALS

    failure = make_state()
    actor = failure.current_player
    give_asset(failure, actor, "cash")
    for rival in failure.players:
        if rival.id != actor.id:
            rival.roofs = 0
    failure.rng.state = 100_000  # next random ~= .991, above every chance in the table.
    failure = run(engine, failure, "grey_operation", {"asset_id": "smear"})
    # A miss does nothing at all — the whole penalty is the extra scandal and the spent action.
    assert all(rival.scandals == 0 for rival in failure.players if rival.id != actor.id)
    assert failure.current_player.scandals == GREY_FAILURE_SCANDALS


def test_successful_grey_operations_score_points_and_failures_score_none() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    for rival in state.players:
        if rival.id != actor.id:
            rival.roofs = 0
    state.rng.state = 0  # next random ~= .236, below the .60 smear chance.
    state = run(engine, state, "grey_operation", {"asset_id": "smear"})
    # The damage is the point of the operation; the score is what makes it worth an action.
    assert state.current_player.bonus_points == GREY_OPERATION_POINTS["smear"]
    resolved = next(event for event in reversed(state.event_log) if event.type == "grey_operation_resolved")
    assert resolved.data["points"] == GREY_OPERATION_POINTS["smear"]

    failed = make_state()
    actor = failed.current_player
    give_asset(failed, actor, "cash")
    failed.rng.state = 100_000  # next random ~= .991, above every chance in the table.
    failed = run(engine, failed, "grey_operation", {"asset_id": "smear"})
    assert failed.current_player.bonus_points == 0
    resolved = next(event for event in reversed(failed.event_log) if event.type == "grey_operation_resolved")
    assert resolved.data["points"] == 0


def test_the_smear_reaches_every_rival_and_each_roof_answers_for_its_own_owner() -> None:
    engine = CityEngine()
    # Three players: the whole point of the smear is what it does to a table, not to one rival.
    state = create_game_from_catalog(
        "smear",
        [PlayerSetup("p1", "One"), PlayerSetup("p2", "Two"), PlayerSetup("p3", "Three")],
        seed=42,
    )
    actor = state.current_player
    give_asset(state, actor, "cash")
    rivals = [player for player in state.players if player.id != actor.id]
    rivals[0].roofs = 1
    for rival in rivals[1:]:
        rival.roofs = 0
    state.rng.state = 0

    state = run(engine, state, "grey_operation", {"asset_id": "smear"})

    # One action can strip several roofs at once: the smear is the only thing in the game that
    # outpaces the defence, which is why its odds sit below its neighbours'.
    assert state.player_by_id(rivals[0].id).roofs == 0
    assert state.player_by_id(rivals[0].id).scandals == 0
    assert all(state.player_by_id(rival.id).scandals == 1 for rival in rivals[1:])
    # Blocked by one of three is not the same empty result as blocked by all three.
    assert state.current_player.bonus_points == GREY_OPERATION_POINTS["smear"]


def test_the_pump_drains_every_rival_into_the_runner_s_wallet() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    actor.money = 10
    rivals = [player for player in state.players if player.id != actor.id]
    for rival in rivals:
        rival.roofs = 0
        rival.money = 30
    state.rng.state = 0  # below the .45 pump chance

    drain = engine.pump_drain(state)
    state = run(engine, state, "grey_operation", {"asset_id": "crypto"})

    # The money operation: nothing is minted, it changes hands. Its payout is the one that grows
    # with the number of players at the table.
    assert all(state.player_by_id(rival.id).money == 30 - drain for rival in rivals)
    assert state.current_player.money == 10 + drain * len(rivals)


def test_breaking_a_roof_takes_the_whole_stack_and_pays_a_point_per_token() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    target = next(player for player in state.players if player.id != actor.id)
    target.roofs = 3
    state.rng.state = 0  # below the .60 chance

    state = run(engine, state, "grey_operation", {"asset_id": "roof_break", "target_id": target.id})

    # A Крыша cannot answer this one: blocking it with the very token it removes would make the
    # stack self-defending and the operation unreachable.
    assert state.player_by_id(target.id).roofs == 0
    # Without a point per token the operation is a pure set-up whose value is shared with the whole
    # table, and nobody spends an action and a scandal on that.
    expected = GREY_OPERATION_POINTS["roof_break"] + 3 * ROOF_BREAK_POINT_PER_ROOF
    assert state.current_player.bonus_points == expected
    broken = next(event for event in reversed(state.event_log) if event.type == "roofs_broken")
    assert broken.data["roofs"] == 3


def test_the_pointed_operations_refuse_a_target_with_nothing_to_take() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    target = next(player for player in state.players if player.id != actor.id)
    target.roofs = 0
    target.role = None

    # Spending the turn's single attempt on an operation that cannot do anything is a trap, not a
    # decision, so the engine refuses it outright.
    with pytest.raises(IllegalActionError):
        run(engine, state, "grey_operation", {"asset_id": "roof_break", "target_id": target.id})
    with pytest.raises(IllegalActionError):
        run(engine, state, "grey_operation", {"asset_id": "influence_broker", "target_id": target.id})


def test_only_one_grey_operation_may_be_run_per_turn() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")  # unlocks the shadows operations
    actor.money = 40
    state.actions_left = 3
    state.rng.state = 0  # a landing roll, so the cap is what stops the second run

    state = run(engine, state, "grey_operation", {"asset_id": "smear"})
    assert state.actions_left == 2  # actions are left, the layer is not

    legal = engine.legal_actions(state, state.current_player.id)
    assert not any(action["type"] == "grey_operation" for action in legal)
    with pytest.raises(IllegalActionError):
        run(engine, state, "grey_operation", {"asset_id": "smear"})


def test_the_grey_cap_covers_every_operation_not_just_the_one_used() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    give_asset(state, actor, "crypto")
    actor.money = 40
    state.actions_left = 3
    state.rng.state = 0

    state = run(engine, state, "grey_operation", {"asset_id": "smear"})

    # One of each type would raise the ceiling rather than lower it: a wide board unlocks all five
    # and a diversified run outscores a repeated one. The cap is on the layer.
    with pytest.raises(IllegalActionError):
        run(engine, state, "grey_operation", {"asset_id": "crypto"})


def test_a_failed_grey_operation_still_spends_the_turn_s_attempt() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    actor.money = 40
    state.actions_left = 3
    state.rng.state = 100_000  # next random ~= .991, above every chance in the table

    state = run(engine, state, "grey_operation", {"asset_id": "smear"})

    # Refunding a miss would turn the cap into a re-roll until success, and would make the
    # longest-odds operation the safest one to open a turn with.
    legal = engine.legal_actions(state, state.current_player.id)
    assert not any(action["type"] == "grey_operation" for action in legal)
    with pytest.raises(IllegalActionError):
        run(engine, state, "grey_operation", {"asset_id": "smear"})


def test_the_grey_cap_resets_on_the_next_turn() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    actor.money = 40
    state.rng.state = 0

    state = run(engine, state, "grey_operation", {"asset_id": "smear"})
    while state.current_player.id == actor.id:
        state = run(engine, state, "end_turn")
    while state.current_player.id != actor.id:
        state = run(engine, state, "end_turn")

    legal = engine.legal_actions(state, actor.id)
    assert any(action["type"] == "grey_operation" for action in legal)


def test_a_grey_operation_swallowed_by_a_roof_still_pays_for_the_roll() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    actor.role = "fraudster"
    give_asset(state, actor, "datacenter")
    target = next(player for player in state.players if player.id != actor.id)
    target.roofs = 1
    target.influence = 9
    target.bonus_points = 50  # puts the fraudster second, so the comeback would be worth 1◆
    state.rng.state = 0  # next random ~= .236, below the hack's chance

    state = run(engine, state, "grey_operation", {"asset_id": "datacenter", "target_id": target.id})

    # The roll is what the operation is paid for, and it burned a token off the defender — that is
    # a real result, so it earns its points and costs its scandal. Only the fraudster's comeback
    # is priced against damage, and there was none.
    expected_points = engine.grey_operation_points("datacenter")
    actor = state.player_by_id(actor.id)
    target = state.player_by_id(target.id)
    assert actor.bonus_points == expected_points
    assert actor.scandals == GREY_SUCCESS_SCANDALS
    assert actor.influence == 2
    assert (target.influence, target.roofs) == (9, 0)
    resolved = next(event for event in reversed(state.event_log) if event.type == "grey_operation_resolved")
    # "The defence held" has to read differently from "the odds failed".
    assert (resolved.data["success"], resolved.data["blocked"], resolved.data["points"]) == (
        True,
        True,
        expected_points,
    )


def test_a_grey_operation_that_lands_pays_its_points_and_its_loot() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    actor.role = "fraudster"
    give_asset(state, actor, "datacenter")
    target = next(player for player in state.players if player.id != actor.id)
    target.roofs = 0
    target.influence = 9
    target.bonus_points = 50
    state.rng.state = 0

    state = run(engine, state, "grey_operation", {"asset_id": "datacenter", "target_id": target.id})

    stolen = engine.hack_influence_steal(state)
    actor = state.player_by_id(actor.id)
    assert actor.bonus_points == GREY_OPERATION_POINTS["datacenter"]
    assert actor.scandals == GREY_SUCCESS_SCANDALS  # a hit costs one, a miss two
    # The loot and nothing else: the comeback that paid the fraudster for being behind is gone.
    assert actor.influence == 2 + stolen
    assert state.player_by_id(target.id).influence == 9 - stolen
    resolved = next(event for event in reversed(state.event_log) if event.type == "grey_operation_resolved")
    assert (resolved.data["success"], resolved.data["blocked"]) == (True, False)


def test_a_blocked_card_costs_the_attacker_no_self_scandal() -> None:
    engine = CityEngine()
    state = make_state()
    attacker = state.current_player
    target = next(player for player in state.players if player.id != attacker.id)
    target.roofs = 1
    held = give_card(state, attacker, "controlled_leak")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    # The self-scandal buys two scandals on the target. A roof cancels the purchase, not just the
    # delivery — otherwise the attacker walks itself out of its own role for nothing.
    assert state.player_by_id(attacker.id).scandals == 0
    assert (state.player_by_id(target.id).scandals, state.player_by_id(target.id).roofs) == (0, 0)


def test_a_blocked_card_pays_the_attacker_no_loot() -> None:
    engine = CityEngine()
    state = make_state()
    attacker = state.current_player
    target = next(player for player in state.players if player.id != attacker.id)
    target.roofs = 1
    target.money = 20
    held = give_card(state, attacker, "hostile")
    money_before = attacker.money

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    # Nothing was taken, so there is nothing to hand over.
    assert state.player_by_id(attacker.id).money == money_before
    assert state.player_by_id(target.id).money == 20


def test_a_blocked_story_costs_the_journalist_no_scandal() -> None:
    engine = CityEngine()
    state = make_state()
    journalist = state.current_player
    journalist.role = "journalist"
    target = next(player for player in state.players if player.id != journalist.id)
    target.roofs = 1

    state = run(engine, state, "use_role_power", {"power": "journalist_inflate", "target_id": target.id})

    # Nine self-scandals over a game, three of them costing the seat: two were paid for stories the
    # roof never let run.
    assert state.player_by_id(journalist.id).scandals == 0
    assert (state.player_by_id(target.id).scandals, state.player_by_id(target.id).roofs) == (0, 0)


def test_a_story_that_runs_still_costs_the_journalist_a_scandal() -> None:
    engine = CityEngine()
    state = make_state()
    journalist = state.current_player
    journalist.role = "journalist"
    target = next(player for player in state.players if player.id != journalist.id)
    target.roofs = 0

    state = run(engine, state, "use_role_power", {"power": "journalist_inflate", "target_id": target.id})

    assert state.player_by_id(journalist.id).scandals == 1
    assert state.player_by_id(target.id).scandals == 1


def test_the_longer_odds_operations_pay_the_higher_score() -> None:
    engine = CityEngine()
    # The scandal cost is the same for all five now, so the score has to carry the difference: the
    # pointed, low-odds operations pay three, the broad ones two.
    for asset_id in ("datacenter", "influence_broker"):
        assert engine.grey_operation_points(asset_id) == 3
    for asset_id in ("smear", "crypto", "roof_break"):
        assert engine.grey_operation_points(asset_id) == 2
    assert set(GREY_OPERATION_POINTS) == set(GREY_OPERATION_CHANCE) == set(engine.GREY_ASSET_IDS)


def test_the_fraudster_bonus_is_flat_and_needs_no_tech_object() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    actor.role = "fraudster"
    give_asset(state, actor, "cash")  # Серый сектор, not Технокластер.
    actor.money = 20

    state = run(engine, state, "grey_operation", {"asset_id": "smear"})
    resolved = next(event for event in reversed(state.event_log) if event.type == "grey_operation_resolved")
    # 0.60 base + 0.30 flat, capped at the 0.9 ceiling — no tech object involved.
    assert resolved.data["chance"] == pytest.approx(0.9)


def test_crypto_scam_is_one_fixed_quarter_wallet_command() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    actor.role = "fraudster"
    actor.scandals = 0
    give_asset(state, actor, "crypto")
    target = rival_of(state, actor)
    target.money = 101
    target.roofs = 0

    offers = [
        action
        for action in engine.legal_actions(state, actor.id)
        if action["type"] == "use_role_power" and action["payload"].get("power") == "fraudster_crypto_scam"
    ]
    assert offers == [{"type": "use_role_power", "payload": {"power": "fraudster_crypto_scam"}}]

    state = run(engine, state, "use_role_power", {"power": "fraudster_crypto_scam"})

    taken = 101 * CRYPTO_SCAM_SHARE // 100
    assert state.player_by_id(target.id).money == 101 - taken
    assert state.current_player.money == 10 + taken
    assert state.current_player.scandals == CRYPTO_SCAM_SCANDALS
    assert state.current_player.role is None  # five scandals consume the unprepared role


def test_crypto_scam_respects_roofs_and_stacked_reduction() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    actor.role = "fraudster"
    actor.scandals = 0
    give_asset(state, actor, "crypto")
    give_asset(state, actor, "offshore")
    for project_id in ("night_quarter", "shadow_market"):
        state.project_board = [item for item in state.project_board if item != project_id]
        state.project_deck = [item for item in state.project_deck if item != project_id]
        actor.projects.append(project_id)
    target = rival_of(state, actor)
    target.money = 100
    target.roofs = 1

    state = run(engine, state, "use_role_power", {"power": "fraudster_crypto_scam"})

    assert state.player_by_id(target.id).money == 100
    assert state.player_by_id(target.id).roofs == 0
    assert state.current_player.scandals == CRYPTO_SCAM_SCANDALS - 3
    assert state.current_player.role == "fraudster"


def test_stacked_grey_reduction_can_make_a_failed_operation_free() -> None:
    engine = CityEngine()
    state = make_state()
    actor = state.current_player
    give_asset(state, actor, "cash")
    give_asset(state, actor, "offshore")
    for project_id in ("night_quarter", "shadow_market"):
        state.project_board = [item for item in state.project_board if item != project_id]
        state.project_deck = [item for item in state.project_deck if item != project_id]
        actor.projects.append(project_id)
    state.rng.state = 100_000

    state = run(engine, state, "grey_operation", {"asset_id": "smear"})

    assert state.current_player.scandals == 0


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

    stolen = engine.hack_influence_steal(state)
    hit = state.player_by_id(target.id)
    assert hit.influence == 10 - stolen
    assert state.current_player.influence == 2 + stolen
    # The hack takes influence and nothing else: the target keeps every object it owns.
    assert [asset.card_id for asset in hit.assets] == ["robotics"]


def test_compromat_leak_strips_a_role() -> None:
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
    state.rng.state = 0  # below the .60 leak chance

    state = run(engine, state, "grey_operation", {"asset_id": "influence_broker", "target_id": target.id})

    assert state.player_by_id(target.id).role is None
    # No prepay any more: the action, the scandal and the turn's single attempt are the whole price.
    assert state.current_player.influence == 10
    assert state.current_player.scandals == GREY_SUCCESS_SCANDALS
    # The per-turn cap already limits the cadence — a second gate on top of it was one rule too many.
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
    # The roof kept the role, but stripping the table of its defences is exactly what the leak is
    # for: the roll still scores and still costs its scandal.
    assert state.current_player.bonus_points == engine.grey_operation_points("influence_broker")
    assert state.current_player.scandals == GREY_SUCCESS_SCANDALS


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

    next_state = run(engine, state, "play_action_card", payload)
    assert held.uid not in {item.uid for item in next_state.current_player.hand}


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


def test_money_and_influence_pay_a_poor_passive_rate() -> None:
    """They score, badly. Dropping the payout outright doubled the winner's margin — see 1.5.1."""
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 47
    player.influence = 11
    player.scandals = 2

    breakdown = engine.score_breakdown(player)
    # 47$ → 4 points, 11◆ → 3: a round's income hoarded is worth less than one cheap object.
    assert breakdown["money"] == 47 // MONEY_PER_POINT
    assert breakdown["influence"] == 11 // INFLUENCE_PER_POINT
    assert breakdown["scandals"] == -2
    assert breakdown["total"] == engine.score(player)

    # A pile already scores by itself, so what a sink really pays is the *difference*. Both hand
    # back three points over what the same resource was worth sitting still, against an action
    # worth about two — which is what makes each worth pressing and neither worth building around.
    assert PATRONAGE_POINTS - PATRONAGE_MONEY // MONEY_PER_POINT == 3
    assert LOBBYING_POINTS - LOBBYING_INFLUENCE // INFLUENCE_PER_POINT == 3

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


def test_multiple_city_projects_can_be_taken_per_turn() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    put_on_board(state, "art_museum")
    put_on_board(state, "charity_fund")
    project_id = "charity_fund"
    player.money = 100
    player.influence = 100

    state = run(engine, state, "city_project", {"project_id": "art_museum"})

    assert any(
        action["type"] == "city_project" and action["payload"].get("project_id") == project_id
        for action in engine.legal_actions(state, player.id)
    )
    state = run(engine, state, "city_project", {"project_id": project_id})
    assert {"art_museum", project_id}.issubset(state.current_player.projects)


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
    before_influence = engine.passive_influence(state, player)

    player.projects.append("metro_line")  # perk: +2$ per round
    player.projects.append("courthouse")  # perk: +2◆ per round

    assert engine._round_income(state, player) == before_income + 2
    assert engine.passive_influence(state, player) == before_influence + 2


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


def test_a_flagged_card_may_be_aimed_at_its_own_player() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "journalist"
    player.roofs = 1
    card = load_catalog().action_cards["kompromat"]
    assert card.self_target
    held = give_card(state, player, "kompromat")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": player.id})

    player = state.current_player
    # The journalist buys scandals on purpose — the rating pays for them — and nothing else in the
    # game let them. A Крыша does not answer: it never cancels a scandal its owner chose.
    assert player.scandals == card.value
    assert player.roofs == 1


def test_an_unflagged_card_still_refuses_its_own_player() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    # The flag is a property of the card, not of its kind: "scandal cards may hit you" would be a
    # rule to learn, while a flag is a line the card prints. Stealing from yourself would mint money.
    assert not load_catalog().action_cards["hostile"].self_target
    held = give_card(state, player, "hostile")

    with pytest.raises(IllegalActionError):
        run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": player.id})

    legal = engine.legal_actions(state, player.id)
    assert not any(
        action["type"] == "play_action_card" and action["payload"].get("target_id") == player.id for action in legal
    )


def test_playing_a_card_on_yourself_pays_no_attacker_bonus() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "journalist"
    player.bonus_points = 99  # the leader, so an expose would normally pay out
    money_before = player.money
    influence_before = player.influence
    held = give_card(state, player, "leak")

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": player.id})

    # There is no attacker, so no attacker side of the card is paid: handing the leader bonus or
    # the theft to the player who is also the victim would mint resources out of nothing.
    player = state.current_player
    assert (player.money, player.influence) == (money_before, influence_before)
    assert player.scandals == 1


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
    state.market.append(MarketAsset(uid="asset:replacement", card_id="robotics"))
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
    state.market.append(MarketAsset(uid="asset:replacement", card_id="robotics"))

    assert not any(action["type"] == "replace_asset" for action in engine.legal_actions(state, player.id))
    with pytest.raises(InvalidCommandError):
        run(engine, state, "replace_asset", {"asset_uid": player.assets[0].uid, "market_uid": "asset:replacement"})


def test_patronage_turns_dead_money_into_points_without_a_slot() -> None:
    """A measured 15-round game finished with 1217$ on the table — 121 points nobody could spend."""
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = PATRONAGE_MONEY * 2
    before = engine.score(player)
    actions = state.actions_left

    state = run(engine, state, "basic_action", {"kind": "patronage"})
    player = state.current_player
    assert player.money == PATRONAGE_MONEY
    assert player.bonus_points == PATRONAGE_POINTS
    assert engine.score_breakdown(player)["bonus"] == PATRONAGE_POINTS
    assert state.actions_left == actions - 1
    # The 10$ that left were worth a point on their own, so the action nets exactly one point.
    assert engine.score(player) == before + PATRONAGE_POINTS - PATRONAGE_MONEY // MONEY_PER_POINT

    # Once a turn, with money left over: unbounded, the biggest pile would simply buy the game.
    assert player.money >= PATRONAGE_MONEY
    with pytest.raises(IllegalActionError):
        run(engine, state, "basic_action", {"kind": "patronage"})
    assert not any(
        action["type"] == "basic_action" and action["payload"].get("kind") == "patronage"
        for action in engine.legal_actions(state, player.id)
    )

    # Next turn it is offered again, and nothing but the money stops it then.
    state = run(engine, state, "end_turn")
    while state.current_player.id != player.id:
        state = run(engine, state, "end_turn")
    assert any(
        action["type"] == "basic_action" and action["payload"].get("kind") == "patronage"
        for action in engine.legal_actions(state, state.current_player.id)
    )


def test_lobbying_is_the_same_floor_for_influence() -> None:
    """The influence twin of patronage: double the passive rate for an action, once a turn.

    A measured game ended with 72◆ in one hand and nothing left on the board to spend it on.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.influence = LOBBYING_INFLUENCE * 2
    before = engine.score(player)

    state = run(engine, state, "basic_action", {"kind": "lobbying"})
    player = state.current_player
    assert player.influence == LOBBYING_INFLUENCE
    assert engine.score(player) == before + LOBBYING_POINTS - LOBBYING_INFLUENCE // INFLUENCE_PER_POINT
    assert engine.score_breakdown(player)["bonus"] == LOBBYING_POINTS

    # One press a turn, exactly like patronage, and the two do not share the limit.
    with pytest.raises(IllegalActionError):
        run(engine, state, "basic_action", {"kind": "lobbying"})
    player.money = PATRONAGE_MONEY
    state = run(engine, state, "basic_action", {"kind": "patronage"})
    assert state.current_player.bonus_points == LOBBYING_POINTS + PATRONAGE_POINTS


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

    # Laundering used to be the unbounded rival channel this rate was tuned against. It is gone:
    # the grey layer no longer sells influence, so the button is the only conversion left.
    assert spend / gain == pytest.approx(5 / 3)

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

    # The sixth costs the seat — and the ceiling goes with it. Left at six, the journalist would
    # sit one point of score below every other role for the identical event, in a state the
    # `scandals <= scandal_limit` invariant says cannot exist.
    engine.add_scandal(state, reporter, 1)
    assert (reporter.scandals, reporter.role, reporter.jail_turns) == (5, None, 0)
    assert reporter.scandals <= engine.scandal_limit(reporter)

    engine.add_scandal(state, other, 5)
    assert (other.scandals, other.role) == (5, None)


def test_a_role_swap_clamps_the_ceilings_the_old_seat_raised() -> None:
    """`scandal_limit` and `roof_limit` both hang off the role, and nothing re-checked them.

    A mafia holds two Крыши because the role allows an extra one. Claiming a different seat used to
    leave both in place under a limit of one — a token the player could not have bought
    where they now sit. The journalist's six scandals are the same bug in the other currency.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "mafia"
    player.roofs = 2
    player.influence = 99
    assert engine.roof_limit(player) == 2

    state = run(engine, state, "claim_role", {"role_id": "capitalist"})

    moved = state.player_by_id(player.id)
    assert moved.role == "capitalist"
    assert engine.roof_limit(moved) == 1
    assert moved.roofs == 1


def test_losing_a_seat_to_the_scandal_limit_clamps_the_ceilings_too() -> None:
    """Not only the voluntary swap: the mafia can also be scandalled out of its own seat.

    The hostile paths all stop at the Крыша — a leak, a sanction or a vote spends the token and
    leaves the seat alone — so the only way to reach the extra token *and* an empty seat is to
    walk into the scandal limit while holding it. That is exactly where the clamp has to live.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "mafia"
    player.roofs = 2
    player.scandals = BASE_SCANDAL_LIMIT - 1

    engine.add_scandal(state, player, 1)

    assert player.role is None
    assert engine.roof_limit(player) == 1
    assert player.roofs == 1


def test_the_journalist_ceiling_cannot_be_laundered_into_another_seat() -> None:
    """Buying a role is gated on BASE_SCANDAL_LIMIT for everybody.

    Gated on the claimant's own ceiling instead, a journalist on five scandals could take any
    other seat and land on `scandals == limit` — holding a role at the exact value at which
    every other rule in the engine says the role is already lost, and one scandal from jail
    rather than from a plain loss.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "journalist"
    player.scandals = BASE_SCANDAL_LIMIT
    player.influence = 99
    # Still inside their own ceiling: the seat they hold is not in danger.
    assert player.scandals < engine.scandal_limit(player)

    with pytest.raises(IllegalActionError):
        run(engine, state, "claim_role", {"role_id": "mafia"})

    assert not any(action["type"] == "claim_role" for action in engine.legal_actions(state, player.id))


def test_a_hostile_takeover_moves_money_instead_of_burning_it() -> None:
    """Both halves scale from the card's own value, so the table total does not move.

    The attacker's side used to be a hardcoded 2 against a card printed at 3, so every play
    destroyed a dollar — invisible in either player's own delta, visible only in the sum.
    """
    engine = CityEngine()
    state = make_state()
    attacker = state.current_player
    target = rival_of(state, attacker)
    target.roofs = 0
    target.money = 99
    held = give_card(state, attacker, "hostile")
    before = sum(player.money for player in state.players)

    state = run(engine, state, "play_action_card", {"card_uid": held.uid, "target_id": target.id})

    assert sum(player.money for player in state.players) == before
    taken = 99 - state.player_by_id(target.id).money
    assert taken == load_catalog().action_cards["hostile"].value + state.round_number


def test_objects_have_no_state_that_can_switch_their_effects_off() -> None:
    """Blocking is gone, and with it the flag half the engine honoured and half ignored.

    `district_count` never checked it, so a frozen object still opened grey operations, still
    paid its neighbours' district synergy and still satisfied project conditions, while the two
    income functions did check it. One flag with two readings is a bug surface, not a mechanic.
    """
    catalog = load_catalog()
    assert not [card for card in catalog.action_cards.values() if card.kind in {"freeze", "unblock"}]
    assert not hasattr(OwnedAsset("u", "cash"), "blocked")


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

    # A scandal thrown at you by somebody else is absorbed whole, card and all.
    state = make_state()
    reporter = state.current_player
    target = rival_of(state, reporter)
    reporter.role = "journalist"
    reporter.influence = 5
    target.roofs = 1
    state = run(engine, state, "use_role_power", {"power": "journalist_publish", "target_id": target.id})
    target = state.player_by_id(target.id)
    assert (target.scandals, target.roofs) == (0, 0)
    # The deed leads, the fallout follows: «использует силу» and then «отражает атаку Крышей».
    assert [event.type for event in state.event_log[-2:]] == ["role_power_used", "targeted_effect_blocked"]

    # A role takeover: the token goes, the attacker's influence comes back.
    state = make_state()
    attacker = state.current_player
    holder = rival_of(state, attacker)
    holder.role = "capitalist"
    holder.roofs = 1
    attacker.influence = 30
    state = run(engine, state, "claim_role", {"role_id": "capitalist"})
    attacker, holder = state.player_by_id(attacker.id), state.player_by_id(holder.id)
    assert (holder.role, holder.roofs, attacker.influence) == ("capitalist", 0, 30)

    # And the compromat leak, which used to want a card of its own.
    state = make_state()
    target = rival_of(state, state.current_player)
    target.role = "military"
    target.roofs = 1
    engine._resolve_compromat(state, state.current_player, target)
    assert (target.role, target.roofs) == ("military", 0)


def test_a_defence_never_cancels_the_consequences_of_your_own_move() -> None:
    """Caught in a live game: a Крыша ate the scandal from the owner's own laundering run.

    Every hostile path spends the token before charging the scandal, so anything that reaches
    ``add_scandal`` is self-inflicted — and a defence that cancelled those would make the grey
    layer free.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.roofs = 1

    engine.add_scandal(state, player, 1)
    assert (player.scandals, player.roofs) == (1, 1)

    # The journalist's own scandal is the same rule, and it is the one the comment in the engine
    # has always pointed at.
    player.role = "journalist"
    player.influence = 5
    rival = rival_of(state, player)
    state = run(engine, state, "use_role_power", {"power": "journalist_inflate", "target_id": rival.id})
    player = state.current_player
    assert (player.scandals, player.roofs) == (2, 1)


def test_one_token_is_the_ceiling_and_mafia_keeps_one_extra() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    assert engine.roof_limit(player) == 1
    player.role = "mafia"
    assert engine.roof_limit(player) == 2


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


def test_every_project_is_unique_and_only_the_board_offers_one() -> None:
    """Two repeatable initiatives used to sit outside the deck as an always-open scoring outlet.

    They answered the question patronage and lobbying already answer — turning a pile into points —
    and answered it worse, so the sinks were raised and the initiatives removed. What is left is a
    single shared race: taking a project denies it to everybody else for the rest of the game.
    """
    engine = CityEngine()
    catalog = load_catalog()
    assert sorted(catalog.deck_project_ids()) == sorted(catalog.projects)
    assert "city_initiative" not in catalog.projects
    assert "municipal_programme" not in catalog.projects

    state = make_state()
    player = state.current_player
    player.money = 400
    player.influence = 400
    # A project with no condition, put on the board by hand: what is under test is the price and
    # the denial, not which four cards the deal happened to turn up.
    taken = "art_museum"
    state.project_deck = [item for item in state.project_deck if item != taken]
    state.project_board[0] = taken
    project = engine.project(taken)

    # One price, printed on the card. The escalating initiative surcharge is gone with the sink
    # it was invented to slow down.
    assert engine.project_cost(player, project) == (project.cost_influence, project.cost_money)

    state = run(engine, state, "city_project", {"project_id": taken})
    state.actions_left = 3
    assert taken not in state.project_board
    with pytest.raises(IllegalActionError):
        run(engine, state, "city_project", {"project_id": taken})


def test_the_market_holds_still_for_a_whole_round_then_rotates_three_slots() -> None:
    """One rotation a round, of a fixed size, instead of six independent per-slot countdowns."""
    engine = CityEngine()
    state = make_state()
    before = [item.uid for item in state.market]
    # The engine names the slots that will go, so the client never has to know the rule.
    assert engine.market_rotation_uids(state) == before[:MARKET_ROTATION_SIZE]

    opening_round = state.round_number
    # Every other player takes their turn; the round has not turned over yet.
    while state.round_number == opening_round:
        previous = [item.uid for item in state.market]
        state = run(engine, state, "end_turn")
        if state.round_number == opening_round:
            assert [item.uid for item in state.market] == previous
    assert len(state.market) == len(before)

    # The oldest three are gone; the other three are exactly the ones that were not marked.
    survivors = [item.uid for item in state.market]
    assert survivors[: len(before) - MARKET_ROTATION_SIZE] == before[MARKET_ROTATION_SIZE:]
    assert not set(survivors[len(before) - MARKET_ROTATION_SIZE :]) & set(before)
    assert any(event.type == "market_rotated" for event in state.event_log)


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


def test_every_power_gate_agrees_with_whether_the_power_is_legal() -> None:
    """`available` is the truth, `gates` is the explanation — this keeps them the same truth.

    `available` runs the power's own candidate commands through the engine, so it cannot be wrong.
    `gates` restates the requirements in a form a panel can print, and a restatement drifts: the
    handler gains a condition, the gate does not, and the player is told they can press a button
    that fails. Every combination below is checked in both directions — an unavailable power must
    name at least one unmet gate, and an available one must have none.
    """
    engine = CityEngine()
    for role in load_catalog().roles:
        for scandals, money, influence, roofs, assets in (
            (0, 0, 0, 0, []),
            (1, 3, 3, 1, ["cash"]),
            (2, 30, 20, 1, ["cash", "passport_office", "crypto"]),
        ):
            state = make_state(seed=7)
            player = state.current_player
            player.role = role
            player.scandals, player.money, player.influence = scandals, money, influence
            player.roofs = min(roofs, engine.roof_limit(player))
            player.capacity = 6
            for card_id in assets:
                give_asset(state, player, card_id)
            rival = rival_of(state, player)
            rival.scandals = scandals
            rival.roofs = roofs

            for row in engine.role_power_status(state, player):
                unmet = [gate for gate in row["gates"] if not gate["met"]]
                where = f"{role}/{row['power']} scandals={scandals} money={money} inf={influence}"
                if row["available"]:
                    assert not unmet, f"{where}: usable but gates say {unmet}"
                else:
                    assert unmet, f"{where}: unusable but every gate is met"


def test_the_engine_says_which_powers_are_free_and_which_the_roof_stops() -> None:
    """Both flags were client-side guesses, and both guessed wrong on the same panel: it printed
    «тратит действие» over «Раздуть историю», whose only advantage is that it does not, and
    «Крыша погасит» over «Отобрать Крышу», one line under the sentence saying the roof will not.
    """
    engine = CityEngine()
    state = make_state()
    player = state.current_player

    player.role = "journalist"
    rows = {row["power"]: row for row in engine.role_power_status(state, player)}
    assert rows["journalist_inflate"]["spends_action"] is False
    assert rows["journalist_publish"]["spends_action"] is True
    assert rows["journalist_inflate"]["blocked_by_roof"] is True

    player.role = "military"
    rows = {row["power"]: row for row in engine.role_power_status(state, player)}
    assert rows["military_roof_seize"]["blocked_by_roof"] is False
    assert rows["military_sanction"]["blocked_by_roof"] is True

    # Nothing may claim a flag for a power that no longer exists.
    powers = {power for group in engine.ROLE_POWERS.values() for power in group}
    assert set(engine.POWER_SPENDS_ACTION) <= powers
    assert set(engine.POWER_BLOCKED_BY_ROOF) <= powers


# One word that has to appear in a role's printed ability text for each power it holds. A text is
# not testable, but "the card does not mention this power at all" is: every drift found in the
# 1.12.0 role pass was of exactly that shape — a power gained or deleted and the card never touched.
# Adding a power to ROLE_POWERS fails this test until both the mapping and the text are updated.
ROLE_POWER_KEYWORDS = {
    "capitalist_claim": "етк",  # «Поставить метку» / «метка»
    "politician_cleanup": "Урегулировать",
    "politician_deal": "Договоримся",
    "politician_veto": "вето",
    "journalist_inflate": "Раздуть",
    "journalist_publish": "Публикация",
    "fraudster_cleanup": "Очистка следов",
    "fraudster_crypto_scam": "Криптоскам",
    "mafia_racket": "Рэкет",
    "mafia_cleanup": "Замять дело",
    "mafia_lock": "Серая метка",
    "military_sanction": "Санкц",
    "military_inspection": "Проверка",
    "military_roof_seize": "Отобрать Крышу",
}


def test_every_role_power_is_named_on_the_role_card() -> None:
    """The card a player reads must list the powers the engine actually gives them.

    Before the 1.12.0 role pass was finished, the Капиталист's card said «активных способностей
    нет» while `capitalist_claim` existed, the Силовик's still described the mass roof sweep that
    had been deleted, and the Мафиози's never mentioned `mafia_lock`.
    """
    engine = CityEngine()
    catalog = load_catalog()
    every_power = {power for group in engine.ROLE_POWERS.values() for power in group}

    assert set(ROLE_POWER_KEYWORDS) == every_power

    for role_id, powers in engine.ROLE_POWERS.items():
        text = catalog.roles[role_id].power
        for power in powers:
            assert ROLE_POWER_KEYWORDS[power] in text, f"{role_id}: карточка не упоминает {power}"


def test_the_engine_owns_the_list_of_role_powers() -> None:
    """The clients used to keep their own copy, and it still listed a power deleted in 1.12.0."""
    engine = CityEngine()
    assert set(engine.ROLE_POWERS) == set(load_catalog().roles)
    handled = set(engine.ROLE_POWERS["military"])
    assert "military_roof_sweep" not in handled
