from __future__ import annotations

import pytest

from city_engine.commands import Command
from city_engine.content import load_catalog
from city_engine.engine import CityEngine
from city_engine.factory import PlayerSetup, create_game_from_catalog
from city_engine.models import HeldCard, OwnedAsset


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
    state.action_market = [item for item in state.action_market if item != card_id]
    held = HeldCard(uid=f"held:{player.id}:{card_id}", card_id=card_id)
    player.hand.append(held)
    return held


def test_improve_sell_and_develop_district() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    first = give_asset(state, player, "delivery")
    give_asset(state, player, "media")
    player.money = 30

    state = run(
        engine,
        state,
        "improve_asset",
        {"asset_uid": first.uid, "kind": "scale"},
    )
    player = state.current_player
    assert player.money == 26
    assert player.assets[0].scaled

    state = run(engine, state, "develop_district", {"district": "residential"})
    player = state.current_player
    assert player.district_levels["residential"] == 1
    assert player.influence == 3

    state = run(engine, state, "sell_asset", {"asset_uid": first.uid})
    player = state.current_player
    assert first.uid not in {asset.uid for asset in player.assets}
    assert player.money == 28  # 24 after development + half price 2 + scaled 2.


def test_buy_action_card_removes_it_without_refill() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.money = 20
    player.influence = 10
    card_id = state.action_market[0]

    next_state = run(engine, state, "buy_action_card", {"card_id": card_id})
    next_player = next_state.current_player
    assert card_id not in next_state.action_market
    assert len(next_state.action_market) == 2
    assert next_player.hand[0].card_id == card_id
    assert (next_player.money, next_player.influence) == (17, 9)


def test_targeted_card_waits_for_human_roof_decision() -> None:
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
    assert state.pending_decision is not None
    assert state.player_by_id(target.id).money == 10
    decision_id = state.pending_decision.id

    state = run(
        engine,
        state,
        "resolve_decision",
        {"decision_id": decision_id, "option": "accept"},
        actor_id=target.id,
    )
    assert state.pending_decision is None
    assert state.player_by_id(target.id).money == 6
    assert state.player_by_id(target.id).roofs == 1


def test_targeted_card_can_be_cancelled_with_roof() -> None:
    engine = CityEngine()
    state = make_state()
    attacker = state.current_player
    target = next(player for player in state.players if player.id != attacker.id)
    target.roofs = 1
    held = give_card(state, attacker, "kompromat")
    state = run(
        engine,
        state,
        "play_action_card",
        {"card_uid": held.uid, "target_id": target.id},
    )
    decision_id = state.pending_decision.id  # type: ignore[union-attr]
    state = run(
        engine,
        state,
        "resolve_decision",
        {"decision_id": decision_id, "option": "use_roof"},
        actor_id=target.id,
    )
    assert state.player_by_id(target.id).scandals == 0
    assert state.player_by_id(target.id).roofs == 0


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


def test_capitalist_and_politician_powers() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "capitalist"
    player.influence = 10
    state = run(engine, state, "use_role_power", {"power": "capitalist_financing"})
    assert state.current_player.influence == 7
    assert state.investment_actions == 1

    state.current_player.role = "politician"
    state.current_player.scandals = 2
    state = run(engine, state, "use_role_power", {"power": "politician_cleanup"})
    assert state.current_player.scandals == 1
    assert state.current_player.influence == 5


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


def test_grey_operation_uses_serialized_rng_for_success_and_failure() -> None:
    engine = CityEngine()
    success = make_state()
    actor = success.current_player
    give_asset(success, actor, "cash")
    actor.influence = 10
    success.rng.state = 0  # next random ~= .236, below the .85 laundering chance.
    success = run(engine, success, "grey_operation", {"asset_id": "cash"})
    assert success.current_player.money == 16
    assert success.current_player.influence == 8
    assert success.current_player.scandals == 1

    failure = make_state()
    actor = failure.current_player
    give_asset(failure, actor, "cash")
    actor.influence = 10
    failure.rng.state = 100_000  # next random ~= .991, above the .85 chance.
    failure = run(engine, failure, "grey_operation", {"asset_id": "cash"})
    assert failure.current_player.money == 7
    assert failure.current_player.influence == 7
    assert failure.current_player.scandals == 2


def test_fraudster_forgery_is_deterministic() -> None:
    engine = CityEngine()
    state = make_state()
    player = state.current_player
    player.role = "fraudster"
    player.influence = 10
    state.actions_left = 4
    state.rng.state = 0
    state = run(
        engine,
        state,
        "use_role_power",
        {"power": "fraudster_forge", "role_id": "capitalist"},
    )
    assert state.current_player.pending_role == "capitalist"
    assert state.current_player.influence == 5
    assert state.actions_left == 0


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
        if card.kind in {"freeze", "remove_upgrade"}:
            owned = give_asset(state, target, "delivery")
            if card.kind == "remove_upgrade":
                owned.scaled = True
    elif card.kind in {"district_cash", "zoning", "develop"}:
        payload["district"] = "residential"
        give_asset(state, player, "delivery")
        if card.kind == "develop":
            give_asset(state, player, "media")
    elif card.kind == "copy_role":
        payload["role_id"] = "capitalist"
    elif card.kind == "upgrade_discount":
        give_asset(state, player, "delivery")
    elif card.kind == "unblock":
        give_asset(state, player, "delivery").blocked = True

    next_state = run(engine, state, "play_action_card", payload)
    assert held.uid not in {item.uid for item in next_state.current_player.hand}
    assert next_state.turn_flags["card_played"] is True
