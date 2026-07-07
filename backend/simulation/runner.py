"""Batch game runner: play whole games with bots, collect per-game results.

Determinism: each game is fully reproducible from its seed. Bot decisions use a
*separate* RNG derived from the seed so that adding/removing bot choices does not
shift the game's own dice stream.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from game_engine import GameEngine, build_game
from game_engine.enums import Phase
from game_engine.rng import GameRNG
from simulation.bots import Bot, RandomBot

# Hard safety cap so a pathological state can never hang a batch.
MAX_ACTIONS_PER_GAME = 200_000


@dataclass
class PlayerResult:
    id: str
    name: str
    starting_role: str | None
    final_role: str | None
    net_worth: int
    money: int
    experience: int
    won: bool
    stats: dict[str, int] = field(default_factory=dict)


@dataclass
class GameResult:
    game_id: str
    seed: int
    board: str
    winner_id: str | None
    winner_starting_role: str | None
    rounds: int
    turns: int
    end_reason: str
    players: list[PlayerResult]


def play_game(
    seed: int,
    num_players: int = 4,
    board_name: str | None = None,
    bot: Bot | None = None,
    config_overrides: dict[str, Any] | None = None,
) -> GameResult:
    """Play a single game to completion and return its result."""
    if not 2 <= num_players <= 6:
        raise ValueError("num_players must be between 2 and 6.")
    bot = bot or RandomBot()

    # Real games now start WITHOUT roles (players acquire them via role cells).
    # Simulations, however, keep distinct *starting* roles so the balance report —
    # which is keyed by starting role — stays meaningful. Callers can override.
    overrides = {"starting_roles_mode": "distinct"}
    if config_overrides:
        overrides.update(config_overrides)

    specs = [{"name": f"Бот {i + 1}", "is_bot": True} for i in range(num_players)]
    state = build_game(f"sim-{seed}", specs, board_name=board_name, seed=seed, config_overrides=overrides)
    engine = GameEngine(state)
    decision_rng = GameRNG((seed ^ 0x9E3779B1) & 0x7FFFFFFF)

    starting_roles = {p.id: p.role for p in state.players}

    actions = 0
    while not state.finished and actions < MAX_ACTIONS_PER_GAME:
        actions += 1
        if state.phase == Phase.AWAIT_ROLL:
            engine.apply_action(state.current_player.id, "roll_dice")
        elif state.phase == Phase.AWAIT_DECISION:
            decision = state.pending_decision
            assert decision is not None
            option_id = bot.choose_option(decision, state, decision_rng)
            # The addressee may not be the current player (e.g. auction bidding).
            engine.apply_action(decision.player_id, "resolve_decision", {"option_id": option_id})
        else:  # pragma: no cover - only GAME_OVER reaches here
            break

    end_reason = "unfinished"
    for event in reversed(state.log.events):
        if event.type == "game_over":
            end_reason = event.data.get("reason", "game_over")
            break

    players = [
        PlayerResult(
            id=p.id,
            name=p.name,
            starting_role=starting_roles.get(p.id),
            final_role=p.role,
            net_worth=state.net_worth(p),
            money=p.money,
            experience=p.experience,
            won=(p.id == state.winner_id),
            stats=dict(p.stats),
        )
        for p in state.players
    ]

    return GameResult(
        game_id=state.game_id,
        seed=seed,
        board=state.config.board_name,
        winner_id=state.winner_id,
        winner_starting_role=starting_roles.get(state.winner_id) if state.winner_id else None,
        rounds=state.round_number,
        turns=state.turn_number,
        end_reason=end_reason,
        players=players,
    )


def run_batch(
    games: int,
    num_players: int = 4,
    board_name: str | None = None,
    bot: Bot | None = None,
    base_seed: int = 0,
    config_overrides: dict[str, Any] | None = None,
) -> list[GameResult]:
    """Play ``games`` games with seeds ``base_seed .. base_seed + games - 1``."""
    return [
        play_game(base_seed + i, num_players, board_name, bot, config_overrides)
        for i in range(games)
    ]
