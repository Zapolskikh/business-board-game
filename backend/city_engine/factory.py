"""Deterministic creation of a new City game snapshot."""

from __future__ import annotations

from dataclasses import dataclass

from city_engine.constants import (
    BOT_DIFFICULTIES,
    MAX_PLAYERS,
    MAX_ROLE_PRICE,
    MAX_ROUNDS,
    MIN_PLAYERS,
    MIN_ROLE_PRICE,
    MIN_ROUNDS,
    ROLE_IDS,
)
from city_engine.content import ContentCatalog, load_catalog
from city_engine.errors import StateValidationError
from city_engine.models import GameState, MarketAsset, PlayerState
from city_engine.rng import GameRNG, RNGState


@dataclass(frozen=True, slots=True)
class PlayerSetup:
    id: str
    name: str
    is_bot: bool = False
    difficulty: str = "medium"
    preferred_role: str | None = None


@dataclass(frozen=True, slots=True)
class GameSettings:
    max_rounds: int = 15
    role_price: int = 3


def create_game(
    game_id: str,
    players: list[PlayerSetup],
    *,
    seed: int,
    asset_ids: list[str],
    action_card_ids: list[str],
    event_ids: list[str],
    settings: GameSettings | None = None,
    asset_unlock_rounds: dict[str, int] | None = None,
) -> GameState:
    settings = settings or GameSettings()
    if not game_id.strip():
        raise StateValidationError("game_id is required")
    if not MIN_PLAYERS <= len(players) <= MAX_PLAYERS:
        raise StateValidationError("a game must contain between 2 and 6 players")
    if len({player.id for player in players}) != len(players):
        raise StateValidationError("player ids must be unique")
    if not MIN_ROUNDS <= settings.max_rounds <= MAX_ROUNDS:
        raise StateValidationError("max_rounds must be between 5 and 30")
    if not MIN_ROLE_PRICE <= settings.role_price <= MAX_ROLE_PRICE:
        raise StateValidationError("role_price must be between 2 and 10")
    if len(asset_ids) < 6 or len(set(asset_ids)) != len(asset_ids):
        raise StateValidationError("at least 6 unique asset ids are required")
    if len(action_card_ids) < 3 or len(set(action_card_ids)) != len(action_card_ids):
        raise StateValidationError("at least 3 unique action card ids are required")
    if not event_ids:
        raise StateValidationError("at least one event id is required")

    for player in players:
        if player.difficulty not in BOT_DIFFICULTIES:
            raise StateValidationError(f"unknown bot difficulty: {player.difficulty}")
        if player.preferred_role is not None and player.preferred_role not in ROLE_IDS:
            raise StateValidationError(f"unknown preferred role: {player.preferred_role}")

    rng_state = RNGState.from_seed(seed)
    rng = GameRNG(rng_state)
    asset_deck = list(asset_ids)
    action_deck = list(action_card_ids)
    events = list(event_ids)
    rng.shuffle(asset_deck)
    rng.shuffle(action_deck)
    rng.shuffle(events)
    starting_player = rng.randbelow(len(players))

    unlocks = asset_unlock_rounds or {}
    initial_market_ids: list[str] = []
    remaining_assets: list[str] = []
    for asset_id in asset_deck:
        if len(initial_market_ids) < 6 and unlocks.get(asset_id, 1) <= 1:
            initial_market_ids.append(asset_id)
        else:
            remaining_assets.append(asset_id)
    if len(initial_market_ids) < 6:
        raise StateValidationError("not enough round-one assets to create the initial market")
    asset_deck = remaining_assets
    initial_market = [
        MarketAsset(uid=f"asset:{card_id}", card_id=card_id, expires_at_turn=len(players) * 2)
        for card_id in initial_market_ids
    ]
    state = GameState(
        game_id=game_id,
        players=[
            PlayerState(
                id=setup.id,
                name=setup.name,
                is_bot=setup.is_bot,
                difficulty=setup.difficulty,
                preferred_role=setup.preferred_role,
                turns=1 if index == starting_player else 0,
            )
            for index, setup in enumerate(players)
        ],
        rng=rng_state,
        max_rounds=settings.max_rounds,
        role_price=settings.role_price,
        starting_player_index=starting_player,
        current_player_index=starting_player,
        market_deck=asset_deck,
        market=initial_market,
        action_deck=action_deck[3:],
        action_market=action_deck[:3],
        event_id=events[0],
    )
    state.append_event(
        "game_created",
        player_count=len(players),
        starting_player_id=state.current_player.id,
        event_id=state.event_id,
        seed=rng_state.seed,
    )
    state.validate()
    return state


def create_game_from_catalog(
    game_id: str,
    players: list[PlayerSetup],
    *,
    seed: int,
    settings: GameSettings | None = None,
    catalog: ContentCatalog | None = None,
) -> GameState:
    catalog = catalog or load_catalog()
    return create_game(
        game_id,
        players,
        seed=seed,
        asset_ids=list(catalog.assets),
        action_card_ids=list(catalog.action_cards),
        event_ids=list(catalog.events),
        settings=settings,
        asset_unlock_rounds={
            asset.id: {"common": 1, "uncommon": 2, "rare": 3, "epic": 4, "legendary": 5}[asset.rarity]
            for asset in catalog.assets.values()
        },
    )
