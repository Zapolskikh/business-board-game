"""Tests for engine rule helpers and the turn/decision state machine."""
from __future__ import annotations

from game_engine import GameEngine, build_game
from game_engine.enums import Phase


def make_engine(players: int = 2, board: str = "board_60", seed: int = 1):
    state = build_game(
        "t",
        [{"name": f"P{i}", "is_bot": True} for i in range(players)],
        board_name=board,
        seed=seed,
    )
    return GameEngine(state), state


def test_start_bonus_on_crossing():
    engine, state = make_engine()
    p = state.players[0]
    p.experience = 0  # avoid promotion
    size = state.board.ring_size(0)
    p.ring, p.position = 0, size - 2
    before = p.money
    engine.advance_player(p, 3)  # crosses slot 0 once
    assert p.position == (size - 2 + 3) % size
    assert p.money == before + engine.balance.ring_value("start_bonus", 0)


def test_backward_move_gives_no_bonus():
    engine, state = make_engine()
    p = state.players[0]
    p.ring, p.position = 0, 1
    before = p.money
    engine.advance_player(p, -3)
    assert p.money == before
    assert p.position == (1 - 3) % state.board.ring_size(0)


def test_charge_causes_bankruptcy_setback_not_elimination():
    engine, state = make_engine()
    p = state.players[0]
    p.money = 50
    cell = next(c for c in state.board.all_cells() if c.buyable)
    cell.owner_id, cell.price = p.id, 100
    ok = engine.charge_money(p, 999, "test")
    assert ok is False
    assert p.bankrupt_count == 1
    assert cell.owner_id is None  # lost the property
    assert p.money == 100 // 2  # got half back as recovery
    assert p in state.players  # still in the game


def test_three_scandals_remove_role():
    engine, state = make_engine()
    p = state.players[0]
    p.role = "capitalist"
    engine.add_scandal(p, 2, reason="test")
    assert p.role == "capitalist"
    engine.add_scandal(p, 1, reason="test")
    assert p.role is None
    assert p.scandals == 0


def test_scandal_without_role_is_ignored():
    engine, state = make_engine()
    p = state.players[0]
    p.role = None
    p.money = 1000
    engine.add_scandal(p, 2, reason="test")
    assert p.scandals == 0
    assert p.money == 1000


def test_roof_consumption():
    engine, state = make_engine()
    p = state.players[0]
    engine.add_roof(p, 1)
    assert p.roofs == 1
    assert engine.consume_roof(p) is True
    assert p.roofs == 0
    assert engine.consume_roof(p) is False


def test_roof_can_cancel_or_accept_configured_negative_effect():
    engine, state = make_engine()
    p = state.players[0]
    p.roofs = 1
    before = p.money
    assert engine.apply_negative_effect(p, "money", amount=100, reason="тест") is False
    state.phase = Phase.AWAIT_DECISION
    engine.apply_action(p.id, "resolve_decision", {"option_id": "use_roof"})
    assert p.roofs == 0
    assert p.money == before

    state.current_index = 0
    p.roofs = 1
    assert engine.apply_negative_effect(p, "money", amount=100, reason="тест") is False
    state.phase = Phase.AWAIT_DECISION
    engine.apply_action(p.id, "resolve_decision", {"option_id": "take_effect"})
    assert p.roofs == 1
    assert p.money == before - 100


def test_negative_effect_can_disable_roof_protection():
    engine, state = make_engine()
    p = state.players[0]
    p.roofs = 1
    before = p.money
    assert engine.apply_negative_effect(p, "money", amount=25, roof_protectable=False) is True
    assert state.pending_decision is None
    assert p.roofs == 1
    assert p.money == before - 25


def test_hospital_moves_to_first_ring():
    engine, state = make_engine()
    p = state.players[0]
    p.ring, p.position = 2, 5
    engine.send_to_hospital(p)
    hospital = state.board.find_by_type("hospital")[0]
    assert p.ring == 0
    assert p.position == hospital.slot


def test_jail_removes_role_and_experience():
    engine, state = make_engine()
    p = state.players[0]
    p.ring, p.position = 1, 4
    p.experience = 5
    p.role = "politician"
    engine.send_to_jail(p)
    assert p.role is None
    assert p.experience < 5
    assert p.ring == 0


def test_role_uniqueness():
    engine, state = make_engine()
    p0, p1 = state.players[0], state.players[1]
    engine.remove_role(p0)
    engine.remove_role(p1)
    assert engine.set_role(p0, "mafia") is True
    assert engine.set_role(p1, "mafia") is False
    assert p1.role != "mafia"


def test_promotion_offered_on_start_when_experience_met():
    """Passing Start with enough XP now raises a buy/stay decision (it is no
    longer automatic — the player chooses to spend experience)."""
    engine, state = make_engine()
    p = state.players[0]
    need = engine.config.promotion.experience_required[1]
    p.experience = need
    p.ring, p.position = 0, state.board.ring_size(0) - 1
    assert engine._maybe_offer_promotion is not None
    engine.advance_player(p, 2)  # crosses start
    offered = engine._maybe_offer_promotion(p)
    assert offered is True
    decision = state.pending_decision
    assert decision is not None and "promote" in decision.option_ids()
    # Buying spends the experience and moves to the next ring's Start.
    exp_before = p.experience
    cost = decision.context["cost"]
    state.pending_decision = None
    engine.promote_player(p, decision.context["next_ring"], cost)
    assert p.ring == 1
    assert p.position == 0
    assert p.experience == exp_before - cost


def test_no_promotion_without_enough_experience():
    engine, state = make_engine()
    p = state.players[0]
    grant = engine.balance.ring_value("start_experience", 0)
    # Below threshold even after the Start-crossing grant is added.
    p.experience = engine.config.promotion.experience_required[1] - grant - 1
    p.ring, p.position = 0, state.board.ring_size(0) - 1
    engine.advance_player(p, 2)  # crosses start
    assert engine._maybe_offer_promotion(p) is False
    assert p.ring == 0


def test_start_pass_grants_experience():
    engine, state = make_engine()
    p = state.players[0]
    p.experience = 0
    p.ring, p.position = 0, state.board.ring_size(0) - 1
    engine.advance_player(p, 2)  # crosses start once
    assert p.experience == engine.balance.ring_value("start_experience", 0)



def test_roll_dice_keeps_valid_phase():
    engine, state = make_engine()
    pid = state.current_player.id
    engine.apply_action(pid, "roll_dice")
    assert state.phase in (Phase.AWAIT_ROLL, Phase.AWAIT_DECISION, Phase.GAME_OVER)


def test_action_rejected_for_wrong_player():
    engine, state = make_engine()
    other = state.players[1].id
    try:
        engine.apply_action(other, "roll_dice")
    except ValueError:
        return
    raise AssertionError("Expected ValueError for out-of-turn action")
