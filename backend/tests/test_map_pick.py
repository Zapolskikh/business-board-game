"""Tests for the map-pick interaction (Taxi, Station, Auction), the Military roof
options, and the board generation rules (anchors + min_spacing)."""
from __future__ import annotations

from collections import defaultdict

from game_engine import GameEngine, build_game
from game_engine.board_builder import _cyclic_distance, build_board
from game_engine.cells.common import CANCEL_OPTION_ID
from game_engine.config_loader import load_balance, load_board_spec, load_cell_catalog
from game_engine.enums import DecisionType
from game_engine.registry import get_cell_behaviour
from game_engine.rng import GameRNG

# Types whose spacing is guaranteed feasible (low counts per ring); softer
# fillers like bonus/debuff are best-effort and not asserted strictly.
HARD_SPACED = ("station", "role", "ambush", "casino", "auction", "taxi", "bank", "checkpoint", "roll_again")


def make_engine(seed: int = 1):
    state = build_game(
        "t",
        [{"name": "P0", "is_bot": True}, {"name": "P1", "is_bot": True}],
        board_name="board_72",
        seed=seed,
    )
    return GameEngine(state), state


def make_engine3(seed: int = 1):
    state = build_game(
        "t3",
        [
            {"name": "P0", "is_bot": True},
            {"name": "P1", "is_bot": True},
            {"name": "P2", "is_bot": True},
        ],
        board_name="board_72",
        seed=seed,
    )
    return GameEngine(state), state


def _build(board_name: str, seed: int = 1):
    spec = load_board_spec(board_name)
    return spec, build_board(spec, load_cell_catalog(), load_balance(), GameRNG(seed))


# ---------------------------------------------------------------------------
# Board generation rules
# ---------------------------------------------------------------------------
def test_anchors_hospital_ring0_ambush_last():
    """Start is slot 0 and Ambush is always the last cell before Start on every
    ring. Hospital exists only on ring 0 (its effect is a rollback to ring 0), so
    it is anchored at slot 1 there and absent from the inner rings."""
    for board_name in ("board_60", "board_72"):
        _, board = _build(board_name)
        for ring in range(board.ring_count):
            size = board.ring_size(ring)
            assert board.cell_at(ring, 0).type == "start"
            assert board.cell_at(ring, size - 1).type == "ambush"
        # Hospital only on ring 0, at slot 1, and nowhere on the inner rings.
        assert board.cell_at(0, 1).type == "hospital"
        assert not board.find_by_type("hospital", ring=1)
        assert not board.find_by_type("hospital", ring=2)


def test_min_spacing_between_identical_cells():
    for board_name in ("board_60", "board_72"):
        spec, _ = _build(board_name)
        min_spacing = spec.get("min_spacing", {})
        for seed in range(6):
            _, board = _build(board_name, seed=seed)
            for ring in range(board.ring_count):
                size = board.ring_size(ring)
                pos: dict[str, list[int]] = defaultdict(list)
                for cell in board.rings[ring]:
                    pos[cell.type].append(cell.slot)
                for type_key in HARD_SPACED:
                    spacing = min_spacing.get(type_key, 0)
                    slots = pos.get(type_key, [])
                    for i in range(len(slots)):
                        for j in range(i + 1, len(slots)):
                            dist = _cyclic_distance(slots[i], slots[j], size)
                            assert dist >= spacing, (board_name, seed, ring, type_key, slots, dist)


def test_negative_anchor_resolves_to_last_slot():
    spec = {
        "name": "tiny",
        "ring_sizes": [8],
        "filler_type": "money_plus",
        "fixed": {"0": {"0": "start", "1": "hospital", "-1": "ambush"}},
        "distribution": [{"start": 1}],
    }
    board = build_board(spec, load_cell_catalog(), load_balance(), GameRNG(1))
    assert board.cell_at(0, 0).type == "start"
    assert board.cell_at(0, 1).type == "hospital"
    assert board.cell_at(0, 7).type == "ambush"


# ---------------------------------------------------------------------------
# Taxi — map-pick over the whole board
# ---------------------------------------------------------------------------
def test_taxi_map_pick_same_ring_only_and_excludes_self_and_taxis():
    engine, state = make_engine()
    p = state.players[0]
    p.money = 10_000
    taxi = state.board.find_by_type("taxi")[0]
    get_cell_behaviour("taxi").on_land(engine, p, taxi)
    d = state.pending_decision
    assert d is not None
    assert d.type == DecisionType.CHOOSE_CELL_ON_MAP
    assert CANCEL_OPTION_ID in d.option_ids()
    candidate_ids = set(d.context["candidates"].keys())
    assert taxi.id not in candidate_ids
    # Taxi travels only within its own ring, and never to another taxi.
    for cid in candidate_ids:
        target = state.board.by_id(cid)
        assert target.ring == taxi.ring
        assert target.type != "taxi"


def test_taxi_confirm_travels_to_target():
    engine, state = make_engine()
    p = state.players[0]
    p.money = 10_000
    taxi = state.board.find_by_type("taxi")[0]
    beh = get_cell_behaviour("taxi")
    beh.on_land(engine, p, taxi)
    d = state.pending_decision
    opt = next(o for o in d.options if o.id != CANCEL_OPTION_ID)
    target = state.board.by_id(opt.data["cell_id"])
    beh.on_resolve(engine, p, taxi, d, opt)
    assert (p.ring, p.position) == (target.ring, target.slot)


def test_taxi_cancel_keeps_player_in_place():
    engine, state = make_engine()
    p = state.players[0]
    p.money = 10_000
    taxi = state.board.find_by_type("taxi")[0]
    beh = get_cell_behaviour("taxi")
    beh.on_land(engine, p, taxi)
    d = state.pending_decision
    money_before = p.money
    cancel = next(o for o in d.options if o.id == CANCEL_OPTION_ID)
    beh.on_resolve(engine, p, taxi, d, cancel)
    assert p.money == money_before  # no fare charged when staying


def test_taxi_unaffordable_leaves_only_cancel():
    engine, state = make_engine()
    p = state.players[0]
    taxi = state.board.find_by_type("taxi")[0]
    price = int(engine.balance.ring_value("taxi.price", taxi.ring))
    p.money = price - 1
    get_cell_behaviour("taxi").on_land(engine, p, taxi)
    d = state.pending_decision
    assert d.option_ids() == [CANCEL_OPTION_ID]
    # Candidates are still listed (greyed out) for the UI.
    assert len(d.context["candidates"]) > 0


# ---------------------------------------------------------------------------
# Station — travel among stations, pay origin owner, destination no profit
# ---------------------------------------------------------------------------
def test_station_travel_pays_origin_owner_and_activates_destination():
    engine, state = make_engine()
    p, owner = state.players[0], state.players[1]
    p.role = None
    p.money = 10_000
    stations = state.board.find_by_type("station", ring=0)
    assert len(stations) >= 2
    origin, dest = stations[0], stations[1]
    origin.owner_id = owner.id
    dest.owner_id = None
    beh = get_cell_behaviour("station")

    beh.on_land(engine, p, origin)
    menu = state.pending_decision
    assert menu.context["kind"] == "menu"
    travel = next(o for o in menu.options if o.id == "travel")
    owner_before, p_before = owner.money, p.money
    beh.on_resolve(engine, p, origin, menu, travel)

    pick = state.pending_decision
    assert pick.type == DecisionType.CHOOSE_CELL_ON_MAP
    dest_opt = next(o for o in pick.options if o.id == dest.id)
    beh.on_resolve(engine, p, origin, pick, dest_opt)

    assert (p.ring, p.position) == (dest.ring, dest.slot)
    assert owner.money > owner_before  # fare paid to the origin's owner
    assert p.money < p_before
    # The destination now ACTIVATES so the traveller can interact with it: an
    # unowned station offers a buy decision (but is not auto-bought), and no
    # further trip is offered this turn (anti-chain flag).
    assert dest.owner_id is None
    arrival = state.pending_decision
    assert arrival is not None and arrival.cell_id == dest.id
    assert "travel" not in arrival.option_ids()


def test_station_travel_from_unowned_pays_bank():
    engine, state = make_engine()
    p = state.players[0]
    p.role = None
    p.money = 10_000
    stations = state.board.find_by_type("station", ring=0)
    origin, dest = stations[0], stations[1]
    origin.owner_id = None
    beh = get_cell_behaviour("station")
    beh.on_land(engine, p, origin)
    menu = state.pending_decision
    travel = next(o for o in menu.options if o.id == "travel")
    p_before = p.money
    beh.on_resolve(engine, p, origin, menu, travel)
    pick = state.pending_decision
    dest_opt = next(o for o in pick.options if o.id == dest.id)
    beh.on_resolve(engine, p, origin, pick, dest_opt)
    assert p.money < p_before  # fare paid to the bank
    assert (p.ring, p.position) == (dest.ring, dest.slot)


def test_station_free_offers_buy():
    engine, state = make_engine()
    p = state.players[0]
    p.role = None
    p.money = 10_000
    station = state.board.find_by_type("station", ring=0)[0]
    station.owner_id = None
    beh = get_cell_behaviour("station")
    beh.on_land(engine, p, station)
    menu = state.pending_decision
    assert "buy" in menu.option_ids()
    buy = next(o for o in menu.options if o.id == "buy")
    beh.on_resolve(engine, p, station, menu, buy)
    assert station.owner_id == p.id


# ---------------------------------------------------------------------------
# Military — buy own roof OR remove someone's roof
# ---------------------------------------------------------------------------
def _make_military(seed: int = 1):
    engine, state = make_engine(seed)
    mil, other = state.players[0], state.players[1]
    for pl in state.players:
        pl.role = None
    engine.set_role(mil, "military")
    return engine, state, mil, other


def test_military_menu_offers_buy_and_remove():
    engine, state, mil, other = _make_military()
    mil.money = 10_000
    other.roofs = 1
    sec = state.board.find_by_type("security_agency")[0]
    get_cell_behaviour("security_agency").on_land(engine, mil, sec)
    d = state.pending_decision
    ids = d.option_ids()
    assert any(i.startswith("remove:") for i in ids)
    assert "buy" in ids
    assert "skip" in ids


def test_military_buys_own_roof():
    engine, state, mil, other = _make_military()
    mil.money = 10_000
    sec = state.board.find_by_type("security_agency")[0]
    beh = get_cell_behaviour("security_agency")
    beh.on_land(engine, mil, sec)
    d = state.pending_decision
    buy = next(o for o in d.options if o.id == "buy")
    before = mil.roofs
    beh.on_resolve(engine, mil, sec, d, buy)
    assert mil.roofs == before + 1


def test_military_removes_roof_from_target():
    engine, state, mil, other = _make_military()
    mil.money = 10_000
    other.roofs = 1
    sec = state.board.find_by_type("security_agency")[0]
    beh = get_cell_behaviour("security_agency")
    beh.on_land(engine, mil, sec)
    d = state.pending_decision
    remove = next(o for o in d.options if o.id.startswith("remove:"))
    beh.on_resolve(engine, mil, sec, d, remove)
    assert other.roofs == 0


def test_military_cannot_buy_when_broke_but_can_still_remove():
    engine, state, mil, other = _make_military()
    mil.money = 0
    other.roofs = 1
    sec = state.board.find_by_type("security_agency")[0]
    get_cell_behaviour("security_agency").on_land(engine, mil, sec)
    ids = state.pending_decision.option_ids()
    assert "buy" not in ids  # unaffordable buy is not offered
    assert any(i.startswith("remove:") for i in ids)


# ---------------------------------------------------------------------------
# Auction — the lander nominates an object, then all players bid in turn
# ---------------------------------------------------------------------------
def _drive_auction(engine, state, chooser):
    """Resolve pending auction decisions using ``chooser(decision, state) -> id``
    until the auction ends. Answers as the addressed player (bids come from
    different players)."""
    beh = get_cell_behaviour("auction")
    guard = 0
    while state.pending_decision is not None and guard < 300:
        guard += 1
        d = state.pending_decision
        if d.handler != "auction":
            break
        actor = state.player_by_id(d.player_id)
        cell = state.board.by_id(d.cell_id) if d.cell_id else None
        option_id = chooser(d, state)
        option = next(o for o in d.options if o.id == option_id)
        state.pending_decision = None
        beh.on_resolve(engine, actor, cell, d, option)


def test_auction_pick_lists_all_free_objects_and_cancel():
    engine, state = make_engine()
    p = state.players[0]
    p.role = None
    auction = state.board.find_by_type("auction")[0]
    free = state.board.free_buyable_cells()
    assert free
    get_cell_behaviour("auction").on_land(engine, p, auction)
    d = state.pending_decision
    assert d.type == DecisionType.CHOOSE_CELL_ON_MAP
    assert CANCEL_OPTION_ID in d.option_ids()
    # Every free buyable object is nominatable (affordability is irrelevant here).
    assert len(d.context["candidates"]) == len(free)
    assert all(c["affordable"] for c in d.context["candidates"].values())


def test_auction_cancel_no_sale():
    engine, state = make_engine()
    p = state.players[0]
    p.role = None
    auction = state.board.find_by_type("auction")[0]
    beh = get_cell_behaviour("auction")
    beh.on_land(engine, p, auction)
    d = state.pending_decision
    cancel = next(o for o in d.options if o.id == CANCEL_OPTION_ID)
    state.pending_decision = None
    beh.on_resolve(engine, p, auction, d, cancel)
    assert state.pending_decision is None
    assert len(state.board.cells_owned_by(p.id)) == 0


def test_auction_single_bidder_wins_and_pays_bank():
    engine, state = make_engine()
    for pl in state.players:
        pl.role = None
        pl.money = 10_000
    lander = state.players[0]
    auction = state.board.find_by_type("auction")[0]
    free = state.board.free_buyable_cells()
    target = free[0]
    total_before = sum(pl.money for pl in state.players)

    get_cell_behaviour("auction").on_land(engine, lander, auction)

    # Only player p1 ever bids; everyone else passes.
    winner_id = state.players[1].id

    def chooser(d, st):
        if d.type == DecisionType.CHOOSE_CELL_ON_MAP:
            return target.id
        # bidding decision
        if d.player_id == winner_id and "bid" in d.option_ids():
            return "bid"
        return "pass"

    _drive_auction(engine, state, chooser)
    assert target.owner_id == winner_id
    winner = state.player_by_id(winner_id)
    # Winner paid their bid to the bank -> total money in play drops.
    assert sum(pl.money for pl in state.players) < total_before
    assert winner.money < 10_000


def test_auction_capitalist_bids_last():
    engine, state = make_engine()
    for pl in state.players:
        pl.role = None
        pl.money = 10_000
    lander = state.players[0]
    engine.set_role(lander, "capitalist")
    # Make the capitalist the poorest so, without the special rule, they'd bid first.
    lander.money = 1
    auction = state.board.find_by_type("auction")[0]
    target = state.board.free_buyable_cells()[0]

    get_cell_behaviour("auction").on_land(engine, lander, auction)
    # Resolve the object pick, then inspect the first bid decision's addressee.
    d = state.pending_decision
    beh = get_cell_behaviour("auction")
    pick = next(o for o in d.options if o.id == target.id)
    state.pending_decision = None
    beh.on_resolve(engine, lander, auction, d, pick)

    first_bid = state.pending_decision
    assert first_bid is not None
    order = first_bid.context["order"]
    assert order[-1] == lander.id  # Capitalist is always last, even when poorest.
    assert order[0] != lander.id
    assert first_bid.player_id != lander.id  # Capitalist never bids first.


def test_auction_fraudster_gets_second_place_bid():
    engine, state = make_engine3()
    for pl in state.players:
        pl.role = None
        pl.money = 100_000
    lander = state.players[0]
    fraudster = state.players[1]
    runner_up = state.players[2]
    engine.set_role(fraudster, "fraudster")
    auction = state.board.find_by_type("auction")[0]
    target = state.board.free_buyable_cells()[0]
    increment = int(engine.balance.get("auction.bid_step", 25))

    get_cell_behaviour("auction").on_land(engine, lander, auction)

    # The runner-up bids once; the fraudster always outbids and wins. Because bids
    # rise by a fixed step, the fraudster's winning bid is exactly one step above
    # the runner-up's. The fraudster's scam takes that second-place bid FROM the
    # runner-up (a transfer, not minted money): so the fraudster's net cost is a
    # single step, and the runner-up is left out of pocket by their own bid.
    runner_up_bids = {"n": 0}

    def chooser(d, st):
        if d.type == DecisionType.CHOOSE_CELL_ON_MAP:
            return target.id
        ids = d.option_ids()
        if d.player_id == fraudster.id:
            return "bid" if "bid" in ids else "pass"
        if d.player_id == runner_up.id and runner_up_bids["n"] < 1 and "bid" in ids:
            runner_up_bids["n"] += 1
            return "bid"
        return "pass"

    fraudster_before = fraudster.money
    runner_before = runner_up.money
    _drive_auction(engine, state, chooser)
    assert target.owner_id == fraudster.id
    assert runner_up_bids["n"] == 1  # the runner-up really did place a (second) bid
    # Net cost to the fraudster is exactly one step (bid minus the reclaimed second).
    assert fraudster.money == fraudster_before - increment
    # No money duplication: the runner-up actually lost their second-place bid.
    assert runner_up.money < runner_before

