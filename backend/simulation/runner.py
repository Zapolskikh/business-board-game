"""Batch runner for authoritative City games."""

from __future__ import annotations

import os
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from typing import Any

from city_bots import choose_bot_command
from city_engine.constants import BOT_DIFFICULTIES, DISTRICT_IDS, ROLE_IDS
from city_engine.engine import CityEngine
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_engine.models import GameState


@dataclass(frozen=True, slots=True)
class SimulationConfig:
    games: int = 100
    rounds: int = 15
    players: int = 4
    role_price: int = 3
    bots: tuple[str, ...] = ("medium", "medium", "medium", "medium")
    specialist_position: int | None = None
    specialist_role: str | None = None
    seed: int = 104_729
    workers: int = 1

    def validate(self) -> None:
        if self.games < 1:
            raise ValueError("games must be positive")
        if not 2 <= self.players <= 6:
            raise ValueError("players must be between 2 and 6")
        if len(self.bots) != self.players:
            raise ValueError("bots must contain exactly one difficulty per player")
        if any(bot not in BOT_DIFFICULTIES for bot in self.bots):
            raise ValueError("unknown bot difficulty")
        if self.specialist_position is not None:
            if not 1 <= self.specialist_position <= self.players:
                raise ValueError("specialist position is 1-based and must reference a player")
            if self.specialist_role not in ROLE_IDS:
                raise ValueError("unknown specialist role")
        if self.workers < 1:
            raise ValueError("workers must be positive")


def simulate_game(config: SimulationConfig, game_index: int) -> GameState:
    setups = []
    for index, difficulty in enumerate(config.bots, start=1):
        preferred = config.specialist_role if config.specialist_position == index else None
        setups.append(
            PlayerSetup(
                id=f"seat-{index}",
                name=f"Bot {index}",
                is_bot=True,
                difficulty=difficulty,
                preferred_role=preferred,
            )
        )
    state = create_game_from_catalog(
        f"simulation-{game_index}",
        setups,
        seed=(config.seed + game_index * 7_919) & 0xFFFFFFFF,
        settings=GameSettings(max_rounds=config.rounds, role_price=config.role_price),
    )
    engine = CityEngine()
    guard = config.rounds * config.players * 80
    for _ in range(guard):
        if state.status == "finished":
            return state
        actor_id = state.pending_decision.actor_id if state.pending_decision else state.current_player.id
        decision = choose_bot_command(engine, state, actor_id)
        state = engine.apply(state, decision.command).state
    raise RuntimeError(f"simulation game {game_index} exceeded {guard} commands")


def _summarize_game(state: GameState) -> dict[str, Any]:
    engine = CityEngine()
    ranked = engine.ranking(state)
    winner = ranked[0]
    role_history: dict[str, set[str]] = defaultdict(set)
    played_cards: dict[str, set[str]] = defaultdict(set)
    income_sources: dict[str, Counter[str]] = defaultdict(Counter)
    for event in state.event_log:
        if event.type == "role_claimed" and event.actor_id:
            role_history[event.actor_id].add(str(event.data["role_id"]))
        if event.type == "action_card_played" and event.actor_id:
            played_cards[event.actor_id].add(str(event.data["card_id"]))
        if event.type == "round_settled":
            for player_id, sources in event.data.get("income_sources", {}).items():
                income_sources[player_id].update(sources)
    return {
        "winner_id": winner.id,
        "winner_score": engine.score(winner),
        "runner_up_score": engine.score(ranked[1]),
        "starting_player_id": state.players[state.starting_player_index].id,
        "players": [
            {
                "id": player.id,
                "difficulty": player.difficulty,
                "preferred_role": player.preferred_role,
                "role": player.role,
                "score": engine.score(player),
                "money": player.money,
                "influence": player.influence,
                "scandals": player.scandals,
                "projects": player.projects,
                "capacity": player.capacity,
                "assets": [asset.card_id for asset in player.assets],
                "districts": Counter(engine.owned_definition(asset).district for asset in player.assets),
                "roles_seen": sorted(role_history[player.id]),
                "cards_played": sorted(played_cards[player.id]),
                "income_sources": dict(income_sources[player.id]),
            }
            for player in state.players
        ],
    }


def _run_chunk(config: SimulationConfig, indexes: list[int]) -> list[dict[str, Any]]:
    return [_summarize_game(simulate_game(config, index)) for index in indexes]


def run_batch(config: SimulationConfig) -> dict[str, Any]:
    config.validate()
    indexes = list(range(config.games))
    workers = min(config.workers, config.games)
    if workers == 1:
        games = _run_chunk(config, indexes)
    else:
        chunks = [indexes[offset::workers] for offset in range(workers)]
        with ProcessPoolExecutor(max_workers=workers) as pool:
            games = [game for chunk in pool.map(_run_chunk, [config] * workers, chunks) for game in chunk]
    return aggregate_results(config, games)


def aggregate_results(config: SimulationConfig, games: list[dict[str, Any]]) -> dict[str, Any]:
    seat_wins = Counter()
    start_wins = 0
    difficulty_seats = Counter()
    difficulty_wins = Counter()
    final_role_seats = Counter()
    final_role_wins = Counter()
    role_seen_games = Counter()
    district_seats = Counter()
    district_wins = Counter()
    district_winner_assets = Counter()
    winner_assets = Counter()
    winner_cards = Counter()
    winner_income_sources = Counter()
    specialist_games = specialist_wins = specialist_final_role = 0
    specialist_scores = specialist_role_seen = 0

    for game in games:
        winner_id = game["winner_id"]
        seat_wins[winner_id] += 1
        start_wins += int(winner_id == game["starting_player_id"])
        for player in game["players"]:
            won = player["id"] == winner_id
            difficulty_seats[player["difficulty"]] += 1
            difficulty_wins[player["difficulty"]] += int(won)
            if player["role"]:
                final_role_seats[player["role"]] += 1
                final_role_wins[player["role"]] += int(won)
            for role_id in player["roles_seen"]:
                role_seen_games[role_id] += 1
            for district in DISTRICT_IDS:
                if player["districts"].get(district, 0) > 0:
                    district_seats[district] += 1
                    district_wins[district] += int(won)
                if won:
                    district_winner_assets[district] += player["districts"].get(district, 0)
            if won:
                winner_assets.update(player["assets"])
                winner_cards.update(player["cards_played"])
                winner_income_sources.update(player["income_sources"])
            if player["preferred_role"]:
                specialist_games += 1
                specialist_wins += int(won)
                specialist_scores += player["score"]
                specialist_final_role += int(player["role"] == player["preferred_role"])
                specialist_role_seen += int(player["preferred_role"] in player["roles_seen"])

    count = len(games)

    def percent(value: int, total: int = count) -> float:
        return round(value / total * 100, 2) if total else 0.0

    result: dict[str, Any] = {
        "config": config,
        "games": count,
        "avg_winner_score": round(sum(game["winner_score"] for game in games) / count, 2),
        "avg_victory_gap": round(
            sum(game["winner_score"] - game["runner_up_score"] for game in games) / count,
            2,
        ),
        "starting_player_win_pct": percent(start_wins),
        "seat_win_pct": {
            f"seat-{index}": percent(seat_wins[f"seat-{index}"]) for index in range(1, config.players + 1)
        },
        "difficulty_win_pct": {
            difficulty: percent(difficulty_wins[difficulty], difficulty_seats[difficulty])
            for difficulty in BOT_DIFFICULTIES
            if difficulty_seats[difficulty]
        },
        "final_role_win_rate_pct": {
            role: percent(final_role_wins[role], final_role_seats[role]) if final_role_seats[role] else None
            for role in ROLE_IDS
        },
        "role_seen_pct": {role: percent(role_seen_games[role]) for role in ROLE_IDS},
        "district_win_rate_pct": {
            district: percent(district_wins[district], district_seats[district]) if district_seats[district] else None
            for district in DISTRICT_IDS
        },
        "avg_winner_district_assets": {
            district: round(district_winner_assets[district] / count, 2) for district in DISTRICT_IDS
        },
        "top_winner_assets": winner_assets.most_common(15),
        "top_winner_cards": winner_cards.most_common(15),
        "avg_winner_income_sources": {
            source: round(value / count, 2) for source, value in sorted(winner_income_sources.items())
        },
    }
    if specialist_games:
        result["specialist"] = {
            "games": specialist_games,
            "win_pct": percent(specialist_wins, specialist_games),
            "avg_score": round(specialist_scores / specialist_games, 2),
            "acquisition_pct": percent(specialist_role_seen, specialist_games),
            "final_hold_pct": percent(specialist_final_role, specialist_games),
        }
    return result


def recommended_workers() -> int:
    return max(1, min(8, (os.cpu_count() or 2) - 1))
