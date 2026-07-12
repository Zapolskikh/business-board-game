"""Tests for data-driven board construction and easy resizing."""
from __future__ import annotations

from game_engine.board_builder import build_board
from game_engine.config_loader import load_balance, load_board_spec, load_cell_catalog
from game_engine.rng import GameRNG


def _build(board_name: str, seed: int = 1):
    spec = load_board_spec(board_name)
    return spec, build_board(spec, load_cell_catalog(), load_balance(), GameRNG(seed))


def test_ring_sizes_match_spec():
    for board_name in ("board_60", "board_72"):
        spec, board = _build(board_name)
        assert [board.ring_size(i) for i in range(3)] == spec["ring_sizes"]
        assert len(board.all_cells()) == sum(spec["ring_sizes"])


def test_start_is_fixed_on_slot_zero():
    _, board = _build("board_72")
    for ring in range(board.ring_count):
        assert board.cell_at(ring, 0).type == "start"


def test_buyable_cells_have_positive_price():
    _, board = _build("board_72")
    for cell in board.all_cells():
        if cell.buyable:
            assert cell.price > 0, f"{cell.id} ({cell.type}) has no price"


def test_unique_cell_ids():
    _, board = _build("board_72")
    ids = [c.id for c in board.all_cells()]
    assert len(ids) == len(set(ids))


def test_shipped_boards_do_not_contain_money_plus():
    for board_name in ("board_60", "board_72"):
        _, board = _build(board_name)
        assert not board.find_by_type("money_plus")


def test_resize_reconciles_short_distribution():
    """A tiny custom spec proves you can change the field size freely: the
    builder pads missing slots with the filler type."""
    spec = {
        "name": "tiny",
        "ring_sizes": [10],
        "filler_type": "money_plus",
        "fixed": {"0": {"0": "start"}},
        "distribution": [{"start": 1, "casino": 1}],  # only 2 defined, 8 short
    }
    board = build_board(spec, load_cell_catalog(), load_balance(), GameRNG(1))
    assert board.ring_size(0) == 10
    types = [c.type for c in board.rings[0]]
    assert types.count("money_plus") == 8  # padded
    assert "start" in types and "casino" in types


def test_resize_reconciles_overfull_distribution():
    spec = {
        "name": "tiny",
        "ring_sizes": [5],
        "filler_type": "money_plus",
        "fixed": {"0": {"0": "start"}},
        "distribution": [{"start": 1, "money_plus": 20}],  # way over capacity
    }
    board = build_board(spec, load_cell_catalog(), load_balance(), GameRNG(1))
    assert board.ring_size(0) == 5


def test_seeded_board_is_reproducible():
    _, a = _build("board_72", seed=123)
    _, b = _build("board_72", seed=123)
    assert [c.type for c in a.all_cells()] == [c.type for c in b.all_cells()]
