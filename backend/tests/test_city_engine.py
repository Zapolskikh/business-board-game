from __future__ import annotations

import pytest

from city_engine import CityEngine, Command, PlayerSetup, create_game_from_catalog
from city_engine.errors import IllegalActionError, StaleRevisionError
from city_engine.replay import replay_game


def game(seed: int = 3):
    return create_game_from_catalog(
        "engine-game",
        [PlayerSetup(id="p1", name="One"), PlayerSetup(id="p2", name="Two")],
        seed=seed,
    )


def command(state, command_type: str, payload: dict | None = None, command_id: str | None = None):
    return Command(
        type=command_type,
        actor_id=state.current_player.id,
        payload=payload or {},
        command_id=command_id,
        expected_revision=state.revision,
    )


def test_initial_market_only_contains_round_one_rarities() -> None:
    engine = CityEngine()
    state = game()

    assert {engine.asset(item.card_id).rarity for item in state.market} == {"common"}


def test_basic_action_is_immutable_and_revisioned() -> None:
    engine = CityEngine()
    state = game()
    actor = state.current_player
    before_money = actor.money

    result = engine.apply(state, command(state, "basic_action", {"kind": "work"}, "cmd-1"))

    assert state.current_player.money == before_money
    assert result.state.current_player.money == before_money + 2
    assert result.state.actions_left == 2
    assert result.state.revision == 1
    assert result.events[0].type == "basic_action"


def test_stale_revision_is_rejected() -> None:
    engine = CityEngine()
    state = game()
    with pytest.raises(StaleRevisionError):
        engine.apply(
            state,
            Command(
                type="basic_action",
                actor_id=state.current_player.id,
                payload={"kind": "work"},
                expected_revision=9,
            ),
        )


def test_role_takeover_costs_triple_and_roof_blocks_it() -> None:
    engine = CityEngine()
    state = game()
    attacker = state.current_player
    defender = state.players[1 - state.current_player_index]
    defender.role = "capitalist"
    defender.roofs = 1
    attacker.influence = 20

    result = engine.apply(state, command(state, "claim_role", {"role_id": "capitalist"}))

    assert result.state.current_player.influence == 20 - state.role_price * 3
    assert result.state.current_player.role is None
    assert result.state.player_by_id(defender.id).role == "capitalist"
    assert result.state.player_by_id(defender.id).roofs == 0
    assert result.events[0].type == "role_takeover_blocked"


def test_player_cannot_act_out_of_turn() -> None:
    engine = CityEngine()
    state = game()
    other = state.players[1 - state.current_player_index]

    with pytest.raises(IllegalActionError, match="current player"):
        engine.apply(state, Command(type="basic_action", actor_id=other.id, payload={"kind": "work"}))


def test_buying_asset_moves_the_exact_market_card_to_player() -> None:
    engine = CityEngine()
    state = game()
    market_asset = min(state.market, key=lambda item: engine.asset_price(state, state.current_player, item.card_id))
    state.current_player.money = 100

    result = engine.apply(state, command(state, "buy_asset", {"market_uid": market_asset.uid}))

    player = result.state.current_player
    assert any(asset.uid == market_asset.uid for asset in player.assets)
    assert all(asset.uid != market_asset.uid for asset in result.state.market)
    assert len(result.state.market) == 6


def test_round_starter_is_prepared_once() -> None:
    engine = CityEngine()
    state = game()
    starter_id = state.players[state.starting_player_index].id

    first = engine.apply(state, command(state, "end_turn")).state
    second = engine.apply(first, command(first, "end_turn")).state

    assert second.round_number == 2
    assert second.current_player.id == starter_id
    assert second.current_player.turns == 2


def test_accepted_commands_can_replay_the_exact_snapshot() -> None:
    engine = CityEngine()
    state = game(seed=91)
    actor_id = state.current_player.id
    state = engine.apply(
        state,
        Command(
            type="basic_action",
            actor_id=actor_id,
            payload={"kind": "work"},
            command_id="replay-work",
            expected_revision=state.revision,
        ),
    ).state
    state = engine.apply(
        state,
        Command(
            type="end_turn",
            actor_id=actor_id,
            command_id="replay-end",
            expected_revision=state.revision,
        ),
    ).state

    assert replay_game(state).to_dict() == state.to_dict()
