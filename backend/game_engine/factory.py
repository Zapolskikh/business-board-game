"""Game factory: assemble a ready-to-play :class:`GameState`.

This is the single wiring point that pulls together config, the generated board
and the players (with role assignment). Both the API and the simulation runner
build games through here so behaviour stays identical.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from game_engine.board_builder import build_board
from game_engine.config_loader import (
    load_board_spec,
    load_cell_catalog,
    load_game_config,
)
from game_engine.enums import ALL_ROLES, Phase
from game_engine.events import GameEvent
from game_engine.models import GameState, Player
from game_engine.rng import GameRNG


@dataclass
class PlayerSpec:
    """Minimal description of a player used to seed a game."""

    name: str
    is_bot: bool = False
    role: str | None = None
    id: str | None = None


def _normalise_specs(players: list[Any]) -> list[PlayerSpec]:
    specs: list[PlayerSpec] = []
    for i, p in enumerate(players):
        if isinstance(p, PlayerSpec):
            spec = p
        elif isinstance(p, dict):
            spec = PlayerSpec(
                name=p.get("name", f"Игрок {i + 1}"),
                is_bot=p.get("is_bot", False),
                role=p.get("role"),
                id=p.get("id"),
            )
        else:  # a bare name string
            spec = PlayerSpec(name=str(p))
        if not spec.id:
            spec.id = f"p{i + 1}"
        specs.append(spec)
    return specs


def _assign_roles(players: list[Player], mode: str, rng: GameRNG) -> None:
    """Give each roleless player a distinct role (roles are unique/exclusive)."""
    if mode == "none":
        return
    all_role_ids = [r.value for r in ALL_ROLES]
    used = {p.role for p in players if p.role}
    available = [r for r in all_role_ids if r not in used]
    rng.shuffle(available)
    for player in players:
        if player.role is None and available:
            player.role = available.pop()


def build_game(
    game_id: str,
    players: list[Any],
    board_name: str | None = None,
    seed: int | None = None,
    config_overrides: dict[str, Any] | None = None,
) -> GameState:
    """Create a new :class:`GameState`.

    Args:
        game_id: unique id for the game.
        players: list of :class:`PlayerSpec`, dicts, or names.
        board_name: which board layout to use (defaults to config's board_name).
        seed: RNG seed for reproducible games/simulations.
        config_overrides: optional overrides merged into balance.json config.
    """
    config = load_game_config(board_name=board_name, overrides=config_overrides)
    rng = GameRNG(seed)
    catalog = load_cell_catalog()
    spec = load_board_spec(config.board_name)
    board = build_board(spec, catalog, config.balance, rng)

    specs = _normalise_specs(players)
    player_objs = [
        Player(
            id=s.id,  # type: ignore[arg-type]
            name=s.name,
            is_bot=s.is_bot,
            role=s.role,
            money=config.starting_money,
            experience=config.starting_experience,
            ring=0,
            position=0,
        )
        for s in specs
    ]

    mode = str(config.balance.get("starting_roles_mode", "distinct"))
    _assign_roles(player_objs, mode, rng)

    state = GameState(
        game_id=game_id,
        players=player_objs,
        board=board,
        config=config,
        rng=rng,
        current_index=0,
        phase=Phase.AWAIT_ROLL,
    )
    names = ", ".join(f"{p.name} [{p.role or 'без роли'}]" for p in player_objs)
    state.log.events.append(
        GameEvent(
            type="game_start",
            message=f"Новая игра на поле «{config.board_name}». Игроки: {names}.",
            data={"board": config.board_name, "seed": seed},
        )
    )
    return state
