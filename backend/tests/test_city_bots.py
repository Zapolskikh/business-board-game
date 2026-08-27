from __future__ import annotations

from copy import deepcopy

from city_bots import choose_bot_command
from city_bots.policy import (
    PROFILES,
    _action_label,
    _action_utility,
    _card_value,
    _fractional_score,
    _grey_operation_utility,
    _position_value,
    _seat_exposure,
    _strategic_action_bonus,
)
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


def test_a_wallet_is_worth_what_the_sinks_pay_for_it() -> None:
    """Money and influence score nothing, so the score alone cannot guide a policy.

    A bot judging positions by the score would treat a 300$ pile and an empty one as identical and
    never bother to earn, steal or protect a coin. The floor value of any pile is what patronage
    and lobbying pay for it, and it has to be fractional: the mafia racket taking 8$ and 1◆ off a
    rival scored 0.30 against 2.28 for a hack when small moves rounded away.
    """
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.money = 20
    player.influence = 6
    before_score, before_value = engine.score(player), _fractional_score(engine, player)

    player.money += 8
    player.influence += 1
    assert engine.score(player) == before_score  # neither currency is on the scoresheet
    assert _fractional_score(engine, player) > before_value + 1.0

    # An empty wallet is worth exactly the score, and nothing here re-implements the score itself.
    player.money, player.influence = 0, 0
    assert _fractional_score(engine, player) == engine.score(player)


def test_the_policy_prices_the_new_card_families() -> None:
    engine = CityEngine()
    state = bot_game()
    player = state.current_player

    # «Меценатство»: 4 points for 12$. Worth almost its face value with the money, near nothing
    # without it — the bot used to score it at its raw `value` either way.
    patronage = next(card for card in engine.catalog.action_cards.values() if card.kind == "buy_points")
    player.money = 0
    assert _card_value(engine, patronage.id, player) < 1
    player.money = 200
    # The blind card is a premium sink (3$/point) next to patronage (4$/point), so it has to beat a
    # blank draw once the player can pay it.
    assert _card_value(engine, patronage.id, player) >= patronage.value * 2

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


def test_expert_does_not_burn_project_influence_cleaning_a_safe_counter() -> None:
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.difficulty = "expert"
    player.role = "capitalist"
    player.money, player.influence, player.scandals = 40, 10, 2
    pool = [*state.project_board, *state.project_deck]
    state.project_board = ["metro_line", "craft_quarter", "factory_cluster", "government_complex"]
    state.project_deck = [project_id for project_id in pool if project_id not in state.project_board]
    utilities = {
        _action_label(action): _action_utility(engine, state, player, action, PROFILES["expert"], transition.state)
        for action, transition in engine.legal_transitions(state, player.id)
    }

    assert utilities["end_turn()"] > utilities["crisis_pr()"]


def test_expert_values_the_quantum_centres_future_actions() -> None:
    engine = CityEngine()
    state = bot_game()
    state.max_rounds = 15
    state.round_number = 8
    player = state.current_player
    player.difficulty = "expert"
    before = _position_value(engine, state, player, PROFILES["expert"])
    after_state = deepcopy(state)
    after_player = after_state.current_player
    after_player.assets.append(OwnedAsset(uid="owned:quantum", card_id="quantum"))
    after = _position_value(engine, after_state, after_player, PROFILES["expert"])

    assert after - before > engine.asset_value_of("quantum") + 8


def test_expert_prices_role_loss_and_jail_into_a_grey_attempt() -> None:
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.difficulty = "expert"
    player.role = "fraudster"
    player.scandals = 4
    player.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))

    utility = _grey_operation_utility(engine, state, player, {"asset_id": "smear"}, PROFILES["expert"])

    assert utility < -0.5  # ending the turn is better than certain role loss and possible jail


def test_a_blocked_grey_run_is_no_longer_valued_at_nothing() -> None:
    """Since 1.9.0 a blocked run still scores its points and still burns the defender's token, so
    pricing it at zero made the bot refuse to touch a defended seat even to clear the token."""
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.difficulty = "expert"
    player.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))
    target = next(other for other in state.players if other.id != player.id)
    target.role = "capitalist"
    target.roofs = 1

    payload = {"asset_id": "influence_broker", "target_id": target.id}
    utility = _grey_operation_utility(engine, state, player, payload, PROFILES["expert"])

    assert utility > 0


def test_a_threatened_seat_makes_the_token_worth_buying() -> None:
    """The table lost 9.3 roles a game and re-bought 15.2 of them while buying 6.2 tokens between
    four players: nobody was pricing the counter that was on sale the whole time."""
    engine = CityEngine()
    state = bot_game()
    state.round_number = 10
    player = state.current_player
    player.difficulty = "expert"
    player.role = "capitalist"
    rival = next(other for other in state.players if other.id != player.id)
    rival.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))  # unlocks the compromat leak
    action = {"type": "buy_roof", "payload": {}}

    exposed = _strategic_action_bonus(engine, state, player, action, PROFILES["expert"])
    player.roofs = 1  # already covered: the same threat no longer argues for a second token
    covered = _strategic_action_bonus(engine, state, player, action, PROFILES["expert"])

    assert _seat_exposure(engine, state, player) == 0.0
    assert exposed > covered


def test_a_seat_nobody_can_reach_is_not_exposed() -> None:
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.role = "capitalist"
    for other in state.players:
        other.assets.clear()

    assert _seat_exposure(engine, state, player) == 0.0
