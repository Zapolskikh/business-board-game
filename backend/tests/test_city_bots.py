from __future__ import annotations

from city_bots import choose_bot_command
from city_bots.policy import PROFILES, _action_label, _action_utility, _card_value, _fractional_score
from city_engine.engine import CityEngine
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_engine.models import OwnedAsset
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
        actor_id = state.current_player.id
        decision = choose_bot_command(engine, state, actor_id)
        state = engine.apply(state, decision.command).state
    assert state.status == "finished"
    assert set(state.final_scores) == {player.id for player in state.players}
    assert state.event_log[-1].data["scores"] == state.final_scores
    assert state.round_number == 5
    assert len(state.event_log) > 30
    assert {player.difficulty for player in state.players} == {"easy", "medium", "hard"}


def test_a_small_resource_move_is_visible_to_the_policy() -> None:
    """The engine floors money and influence into points; a policy valuing positions cannot.

    Measured before this: the mafia racket taking 8$ and 1◆ off a rival scored 0.30 against 2.28
    for a hack, because the bot's own gain rounded to nothing and only the victim crossing a
    ten-dollar boundary showed up at all.
    """
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.money = 20
    player.influence = 6
    before_score, before_value = engine.score(player), _fractional_score(engine, player)

    player.money += 8
    player.influence += 1
    assert engine.score(player) == before_score  # both gains floor away
    assert _fractional_score(engine, player) > before_value + 1.0

    # Everything except the two floored rows still comes from the engine untouched.
    player.money, player.influence = 30, 9
    assert _fractional_score(engine, player) == engine.score(player)


def test_the_policy_prices_the_new_card_families() -> None:
    engine = CityEngine()
    state = bot_game()
    player = state.current_player

    # «Меценатство»: 4 points for 20$. Worth almost its face value with the money, near nothing
    # without it — the bot used to score it at its raw `value` either way.
    patronage = next(card for card in engine.catalog.action_cards.values() if card.kind == "buy_points")
    player.money = 0
    assert _card_value(engine, patronage.id, player) < 1
    player.money = 200
    assert _card_value(engine, patronage.id, player) > patronage.value * 2

    # A defence card at the Крыша limit is a dead draw, and there are three of them in the deck.
    insurance = next(card for card in engine.catalog.action_cards.values() if card.kind == "roof")
    player.roofs = 0
    assert _card_value(engine, insurance.id, player) > 4
    player.roofs = engine.roof_limit(player)
    assert _card_value(engine, insurance.id, player) < 1


def test_the_role_valuation_follows_the_current_passives() -> None:
    """Both rewritten passives read the table, not the old power they replaced."""
    from city_bots.policy import _role_utility

    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    profile = PROFILES["expert"]
    assert profile.planning == 1.0

    # The politician taxes every residential object on the table, including the rivals'.
    rival = next(other for other in state.players if other.id != player.id)
    before = _role_utility(engine, state, player, "politician")
    rival.assets.append(OwnedAsset(uid="own:rival-flats", card_id="delivery"))
    assert _role_utility(engine, state, player, "politician") > before

    # The capitalist earns from every object it owns, not only the business quarter.
    before = _role_utility(engine, state, player, "capitalist")
    player.assets.append(OwnedAsset(uid="own:mine-studio", card_id="web_studio"))
    assert _role_utility(engine, state, player, "capitalist") > before


def test_a_role_cleans_its_own_scandals_instead_of_paying_for_the_basic_one() -> None:
    """Found in a live 15-round game: a fraudster bot ran the 3◆ PR fifteen times and its own
    free cleanup three, burning 45◆ — fifteen points — on a mechanic it owned outright."""
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.role = "fraudster"
    player.money, player.influence, player.scandals = 40, 12, 3

    utilities = {
        _action_label(action): _action_utility(engine, state, player, action, PROFILES["expert"], transition.state)
        for action, transition in engine.legal_transitions(state, player.id)
    }
    own = utilities["use_role_power(power=fraudster_cleanup)"]
    basic = utilities["crisis_pr()"]
    assert own > basic, f"the free cleanup must beat the 3◆ one: {own} vs {basic}"
