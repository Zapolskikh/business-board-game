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
            PlayerSetup("reborn-1", "Reborn 1", is_bot=True, difficulty="expert"),
            PlayerSetup("reborn-2", "Reborn 2", is_bot=True, difficulty="expert"),
            PlayerSetup("reborn-3", "Reborn 3", is_bot=True, difficulty="expert"),
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
    assert {player.difficulty for player in state.players} == {"expert"}


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
    # without it — the bot must not score it at its raw `value` either way.
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
    """One scandal short of the limit, five faces of six cost the seat and a one jails: with nothing
    to take from the target, ending the turn beats the roll."""
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.role = "capitalist"
    player.scandals = 4
    player.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))
    target = next(other for other in state.players if other.id != player.id)
    target.roofs, target.influence = 0, 0

    utility = _grey_operation_utility(
        engine, state, player, {"asset_id": "datacenter", "target_id": target.id}, PROFILES["expert"]
    )

    assert utility < -0.5


def test_a_defended_target_makes_a_grey_run_worthless() -> None:
    """A Защита answers a grey operation in full and stays: the run pays only its scandals."""
    engine = CityEngine()
    state = bot_game()
    player = state.current_player
    player.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))
    target = next(other for other in state.players if other.id != player.id)
    target.influence = 8
    payload = {"asset_id": "datacenter", "target_id": target.id}

    target.roofs = 0
    open_value = _grey_operation_utility(engine, state, player, payload, PROFILES["expert"])
    target.roofs = 1
    defended = _grey_operation_utility(engine, state, player, payload, PROFILES["expert"])

    assert defended < 0 < open_value


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
    # The compromat leak needs both the Серый сектор and the city hall.
    rival.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))
    rival.assets.append(OwnedAsset(uid="owned:passport_office", card_id="passport_office"))
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


def ledger_game(*policies: str):
    return create_game_from_catalog(
        "ledger-game",
        [
            PlayerSetup(f"seat-{index}", f"Seat {index}", is_bot=True, difficulty=policy)
            for index, policy in enumerate(policies)
        ],
        seed=2027,
        settings=GameSettings(max_rounds=5, role_price=3),
    )


def test_ledger_finishes_a_game_against_reborn_without_touching_the_state() -> None:
    engine = CityEngine()
    state = ledger_game("ledger", "expert", "ledger")
    for _ in range(1_500):
        if state.status == "finished":
            break
        before = state_hash(state)
        decision = choose_bot_command(engine, state, state.current_player.id)
        assert state_hash(state) == before
        state = engine.apply(state, decision.command).state
    assert state.status == "finished"
    assert {player.difficulty for player in state.players} == {"ledger", "expert"}


def test_ledger_never_plays_a_re_deal_it_cannot_see_the_result_of() -> None:
    from city_bots.ledger import NEVER, choose_ledger_command

    engine = CityEngine()
    state = ledger_game("ledger", "expert")
    state.current_player.money = 200
    action, _value, _alternatives = choose_ledger_command(engine, state, state.current_player.id)
    assert action["type"] not in NEVER


def test_ledger_values_a_grey_run_by_the_odds_not_by_the_seeded_roll() -> None:
    """The state carries the real RNG, so peeking would make every run a sure thing. Two states that
    differ only in the roll they hold must get the same value."""
    from city_bots.ledger import _grey_expectation, _Root

    engine = CityEngine()
    state = ledger_game("ledger", "expert")
    player = state.current_player
    player.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))
    action = {"type": "grey_operation", "payload": {"asset_id": "smear"}}
    root = _Root(player.id, frozenset(item.uid for item in state.market), tuple(state.project_board))
    values = set()
    for roll in (1, 12345, 987654321):
        state.rng.state = roll
        values.add(round(_grey_expectation(engine, state, action, root), 9))
    assert len(values) == 1


def test_ledger_cashes_in_on_the_last_turn() -> None:
    """Money scores nothing at the end: with the game's last actions in hand, the ledger converts."""
    from city_bots.ledger import choose_ledger_command

    engine = CityEngine()
    state = ledger_game("ledger", "expert")
    state.round_number = state.max_rounds
    state.turns_taken_in_round = len(state.players) - 1
    state.turn_order = [other.id for other in state.players if other.id != state.current_player.id] + [
        state.current_player.id
    ]
    player = state.current_player
    player.money, player.influence = 40, 12
    action, _value, _alternatives = choose_ledger_command(engine, state, player.id)
    assert action["type"] != "end_turn"


def test_oracle_cannot_read_the_dice_of_a_grey_run(monkeypatch) -> None:
    """Oracle may see the decks but not the generator: two states that differ only in the roll the
    generator holds must lead to the same decision and the same value."""
    import city_bots.oracle as oracle

    monkeypatch.setattr(oracle, "TURN_BUDGET", 60.0)
    monkeypatch.setattr(oracle, "CANDIDATES", 3)
    engine = CityEngine()
    decisions = set()
    for roll in (1, 123_456, 3_000_000_000):
        oracle.forget_plans()
        state = ledger_game("oracle", "expert")
        player = state.current_player
        player.money, player.influence = 30, 6
        player.assets.append(OwnedAsset(uid="owned:cash", card_id="cash"))
        state.rng.state = roll
        action, value, _alternatives = oracle.choose_oracle_command(engine, state, player.id)
        decisions.add((repr(action), round(value, 6)))
    assert len(decisions) == 1


def test_oracle_plays_its_plan_without_thinking_again(monkeypatch) -> None:
    import city_bots.oracle as oracle

    monkeypatch.setattr(oracle, "TURN_BUDGET", 1.0)
    oracle.forget_plans()
    engine = CityEngine()
    state = ledger_game("oracle", "ledger")
    actor = state.current_player.id
    replans = []
    original = oracle._replan
    monkeypatch.setattr(oracle, "_replan", lambda *args: replans.append(1) or original(*args))
    while state.status == "playing" and state.current_player.id == actor:
        decision = choose_bot_command(engine, state, actor)
        state = engine.apply(state, decision.command).state
    # One plan for the turn, plus one replan after each grey run, whose outcome the plan cannot know.
    grey_runs = sum(1 for command in state.command_log if command["type"] == "grey_operation")
    assert len(replans) <= 1 + grey_runs


def test_oracle_does_not_end_a_turn_with_actions_ledger_can_use(monkeypatch) -> None:
    """A plan that would end the turn with ⚡ left goes to Ledger for the rest of the turn."""
    import city_bots.oracle as oracle

    oracle.forget_plans()
    engine = CityEngine()
    state = ledger_game("oracle", "expert")
    player = state.current_player
    player.money, player.influence = 40, 12
    end = {"type": "end_turn", "payload": {}}
    monkeypatch.setattr(oracle, "_replan", lambda *args: (end, 0.0, [], []))
    action, _value, _alternatives = oracle.choose_oracle_command(engine, state, player.id)
    assert state.actions_left > 0
    assert action["type"] != "end_turn"


def test_oracle_finishes_a_game_at_a_mixed_table(monkeypatch) -> None:
    import city_bots.oracle as oracle

    monkeypatch.setattr(oracle, "TURN_BUDGET", 0.4)
    oracle.forget_plans()
    engine = CityEngine()
    state = ledger_game("oracle", "ledger", "expert")
    for _ in range(1_500):
        if state.status == "finished":
            break
        state = engine.apply(state, choose_bot_command(engine, state, state.current_player.id).command).state
    assert state.status == "finished"


def test_boris_plays_his_own_development_and_never_attacks() -> None:
    """The tester's line: no grey operations on any seat, nothing aimed at a rival, and the game ends."""
    engine = CityEngine()
    state = ledger_game("boris", "expert", "boris")
    boris = {player.id for player in state.players if player.difficulty == "boris"}
    for _ in range(2_000):
        if state.status == "finished":
            break
        actor = state.current_player.id
        before = state_hash(state)
        command = choose_bot_command(engine, state, actor).command
        assert state_hash(state) == before
        if actor in boris:
            assert command.type != "grey_operation"
            target = command.payload.get("target_id")
            assert target is None or target == actor, command
        state = engine.apply(state, command).state
    assert state.status == "finished"


def test_boris_cashes_surplus_money_into_patronage() -> None:
    from city_bots.boris import choose_boris_command

    engine = CityEngine()
    state = ledger_game("boris", "expert")
    player = state.current_player
    player.capacity = 6
    player.assets = [OwnedAsset(uid=f"owned:{index}", card_id="cowork") for index in range(6)]
    player.money = 200
    state.market = []  # nothing to swap into: the surplus has only the printed sinks left
    action, _value, _reasons = choose_boris_command(engine, state, player.id)
    assert action == {"type": "basic_action", "payload": {"kind": "patronage"}}


def test_boris_campaigns_for_the_next_slot_instead_of_working() -> None:
    """Five full slots and no influence: the sixth slot needs ◆, so a spare action buys it, not 2$."""
    from city_bots.boris import choose_boris_command

    engine = CityEngine()
    state = ledger_game("boris", "expert")
    player = state.current_player
    player.role = "capitalist"
    player.capacity = 5
    player.assets = [OwnedAsset(uid=f"owned:{index}", card_id="cowork") for index in range(5)]
    player.money = 30
    player.influence = 0
    player.roofs = 1  # the seat is already guarded: the choice left is campaign or work
    state.market = []
    action, _value, _reasons = choose_boris_command(engine, state, player.id)
    assert action["type"] == "basic_action"
    assert action["payload"]["kind"] == "campaign"


def test_boris_guards_a_seat_near_its_limit_with_a_roof_first() -> None:
    from city_bots.boris import choose_boris_command

    engine = CityEngine()
    state = ledger_game("boris", "expert")
    player = state.current_player
    player.role = "capitalist"
    player.scandals = engine.scandal_limit(player) - 2
    player.roofs = 0
    player.money = 30
    action, _value, _reasons = choose_boris_command(engine, state, player.id)
    assert action == {"type": "buy_roof", "payload": {}}
