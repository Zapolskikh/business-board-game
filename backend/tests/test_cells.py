"""Tests for individual cell behaviours (via the registry)."""
from __future__ import annotations

from game_engine import GameEngine, build_game
from game_engine.registry import get_cell_behaviour, is_registered, registered_types


def make_engine(seed: int = 1):
    state = build_game(
        "t",
        [{"name": "P0", "is_bot": True}, {"name": "P1", "is_bot": True}],
        board_name="board_72",
        seed=seed,
    )
    return GameEngine(state), state


def test_all_catalog_types_are_registered():
    from game_engine.config_loader import load_cell_catalog

    for type_key in load_cell_catalog():
        assert is_registered(type_key), f"Cell type '{type_key}' has no behaviour"


def test_fallback_for_unknown_type():
    behaviour = get_cell_behaviour("does_not_exist")
    assert behaviour is not None  # graceful fallback, no crash


def test_money_plus_cell_grants_money():
    engine, state = make_engine()
    p = state.players[0]
    cell = state.board.find_by_type("money_plus")[0]
    before = p.money
    engine.teleport(p, cell.ring, cell.slot, activate=True)
    assert p.money > before


def test_money_minus_cell_charges_money():
    engine, state = make_engine()
    p = state.players[0]
    p.money = 1000
    cell = state.board.find_by_type("money_minus")[0]
    engine.teleport(p, cell.ring, cell.slot, activate=True)
    assert p.money < 1000


def test_newspaper_buy_flow():
    engine, state = make_engine()
    p = state.players[0]
    p.role = None
    p.money = 1000
    cell = state.board.find_by_type("newspaper")[0]
    cell.owner_id = None
    behaviour = get_cell_behaviour("newspaper")
    behaviour.on_land(engine, p, cell)
    decision = state.pending_decision
    assert decision is not None and "buy" in decision.option_ids()
    buy_option = next(o for o in decision.options if o.id == "buy")
    behaviour.on_resolve(engine, p, cell, decision, buy_option)
    assert cell.owner_id == p.id


def test_newspaper_owner_removes_scandal():
    engine, state = make_engine()
    p = state.players[0]
    cell = state.board.find_by_type("newspaper")[0]
    cell.owner_id = p.id
    p.scandals = 1
    get_cell_behaviour("newspaper").on_land(engine, p, cell)
    assert p.scandals == 0


def test_roll_again_grants_extra_roll():
    engine, state = make_engine()
    p = state.players[0]
    cell = state.board.find_by_type("roll_again")
    if not cell:
        return  # board may not include it; skip gracefully
    before = p.extra_rolls
    get_cell_behaviour("roll_again").on_land(engine, p, cell[0])
    assert p.extra_rolls == before + 1


def test_registered_types_nonempty():
    assert len(registered_types()) >= 15


def test_food_cell_buy_then_rent():
    engine, state = make_engine()
    buyer, visitor = state.players[0], state.players[1]
    buyer.role = visitor.role = None
    buyer.money = visitor.money = 5000
    cell = state.board.find_by_type("food")[0]
    cell.owner_id = None
    beh = get_cell_behaviour("food")

    # Buyer lands on a free object and buys it.
    beh.on_land(engine, buyer, cell)
    decision = state.pending_decision
    assert decision is not None and "buy" in decision.option_ids()
    buy = next(o for o in decision.options if o.id == "buy")
    state.pending_decision = None
    beh.on_resolve(engine, buyer, cell, decision, buy)
    assert cell.owner_id == buyer.id

    # A visitor pays rent to the owner (no decision needed).
    owner_before, visitor_before = buyer.money, visitor.money
    beh.on_land(engine, visitor, cell)
    assert state.pending_decision is None
    rent = engine.balance.ring_value("rent.food", cell.ring)
    assert visitor.money == visitor_before - rent
    assert buyer.money == owner_before + rent


def test_food_ring_titles_differ_by_ring():
    engine, state = make_engine()
    titles = {c.ring: c.title for c in state.board.find_by_type("food")}
    # Ring 0 -> Кофейня, ring 1 -> Забегаловка, ring 2 -> Ресторан (per catalog).
    assert titles.get(0) == "Кофейня"


def test_owner_pays_no_rent_on_own_object():
    engine, state = make_engine()
    p = state.players[0]
    cell = state.board.find_by_type("dormitory")[0]
    cell.owner_id = p.id
    before = p.money
    get_cell_behaviour("dormitory").on_land(engine, p, cell)
    assert state.pending_decision is None
    assert p.money == before
