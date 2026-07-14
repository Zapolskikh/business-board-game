from __future__ import annotations

import pytest

from city_engine.content import load_catalog
from city_engine.errors import StateValidationError
from city_engine.factory import GameSettings, PlayerSetup, create_game, create_game_from_catalog
from city_engine.models import GameState
from city_engine.rng import GameRNG, RNGState
from city_engine.serialization import dumps_state, loads_state, state_hash

ASSETS = [f"asset-{index}" for index in range(12)]
CARDS = [f"card-{index}" for index in range(8)]
EVENTS = ["boom", "stable_year", "cheap_credit"]
PLAYERS = [
    PlayerSetup(id="p1", name="Alice"),
    PlayerSetup(id="p2", name="Bot", is_bot=True, difficulty="medium", preferred_role="capitalist"),
]


def new_game(seed: int = 42) -> GameState:
    return create_game(
        "game-1",
        PLAYERS,
        seed=seed,
        asset_ids=ASSETS,
        action_card_ids=CARDS,
        event_ids=EVENTS,
        settings=GameSettings(max_rounds=15, role_price=3),
    )


def test_snapshot_round_trip_is_lossless_and_canonical() -> None:
    state = new_game()
    payload = dumps_state(state)
    restored = loads_state(payload)

    assert restored.to_dict() == state.to_dict()
    assert dumps_state(restored) == payload
    assert state_hash(restored) == state_hash(state)


def test_game_creation_is_deterministic() -> None:
    assert new_game(seed=17).to_dict() == new_game(seed=17).to_dict()
    assert state_hash(new_game(seed=17)) != state_hash(new_game(seed=18))


def test_rng_continues_after_json_round_trip() -> None:
    state = new_game(seed=99)
    before = GameRNG(state.rng)
    first = [before.next_u32() for _ in range(4)]
    restored = loads_state(dumps_state(state))
    original_rng = GameRNG(state.rng)
    restored_rng = GameRNG(restored.rng)

    assert first
    assert [original_rng.next_u32() for _ in range(8)] == [restored_rng.next_u32() for _ in range(8)]


def test_state_rejects_duplicate_player_ids() -> None:
    with pytest.raises(StateValidationError, match="player ids"):
        create_game(
            "bad-game",
            [PlayerSetup(id="same", name="One"), PlayerSetup(id="same", name="Two")],
            seed=1,
            asset_ids=ASSETS,
            action_card_ids=CARDS,
            event_ids=EVENTS,
        )


def test_rng_state_is_minimal_and_portable() -> None:
    state = RNGState.from_seed(123)
    rng = GameRNG(state)
    rng.shuffle([1, 2, 3, 4])

    assert set(state.to_dict()) == {"seed", "state", "draws"}
    assert state.draws == 3


def test_backend_catalog_is_complete_and_can_create_a_game() -> None:
    catalog = load_catalog()
    state = create_game_from_catalog("catalog-game", PLAYERS, seed=7, catalog=catalog)

    assert len(catalog.districts) == 6
    assert len(catalog.roles) == 6
    assert len(catalog.assets) == 71
    assert len(catalog.action_cards) == 34
    assert len(state.market) == 6
    assert state.event_id in catalog.events
