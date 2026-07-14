from __future__ import annotations

from city_bots import choose_bot_command
from city_engine.engine import CityEngine
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_engine.serialization import state_hash


def bot_game():
    return create_game_from_catalog(
        "bot-game",
        [
            PlayerSetup("oleg", "Oleg", is_bot=True, difficulty="easy"),
            PlayerSetup("codex", "Codex", is_bot=True, difficulty="medium"),
            PlayerSetup("claude", "Claude", is_bot=True, difficulty="hard"),
        ],
        seed=2026,
        settings=GameSettings(max_rounds=5, role_price=3),
    )


def test_bot_policy_does_not_mutate_state_while_choosing() -> None:
    engine = CityEngine()
    state = bot_game()
    before = state_hash(state)
    decision = choose_bot_command(engine, state, state.current_player.id)
    assert state_hash(state) == before
    assert decision.command.expected_revision == state.revision
    engine.apply(state, decision.command)


def test_all_bot_game_finishes_through_authoritative_engine() -> None:
    engine = CityEngine()
    state = bot_game()
    for _ in range(1_500):
        if state.status == "finished":
            break
        actor_id = state.pending_decision.actor_id if state.pending_decision else state.current_player.id
        decision = choose_bot_command(engine, state, actor_id)
        state = engine.apply(state, decision.command).state
    assert state.status == "finished"
    assert set(state.final_scores) == {player.id for player in state.players}
    assert state.event_log[-1].data["scores"] == state.final_scores
    assert state.round_number == 5
    assert len(state.event_log) > 30
    assert {player.difficulty for player in state.players} == {"easy", "medium", "hard"}
