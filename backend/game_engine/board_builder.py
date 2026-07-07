"""Board construction from data.

Turns a board *spec* (ring sizes + per-ring cell-type distribution + fixed
placements) into a concrete :class:`~game_engine.models.Board`. The board is
pseudo-random: fixed cells (e.g. Start at slot 0) are placed deterministically,
the rest are shuffled with the seeded RNG.

The distribution counts do not have to sum exactly to the ring size — the
builder reconciles the difference using a configurable filler type. This is what
makes "change the field size" as easy as editing one JSON number.
"""
from __future__ import annotations

from typing import Any

from game_engine.config import Balance
from game_engine.models import Board, BoardCell
from game_engine.rng import GameRNG


def _instantiate_cell(
    ring: int,
    slot: int,
    type_key: str,
    catalog: dict[str, dict[str, Any]],
    balance: Balance,
) -> BoardCell:
    meta = catalog.get(type_key, {"title": type_key, "buyable": False, "tags": []})
    buyable = bool(meta.get("buyable", False))
    price = 0
    if buyable and meta.get("price_key"):
        price = int(balance.ring_value(meta["price_key"], ring, default=0))
    # Some objects (food, dormitory) have a different name per ring, e.g. the food
    # object is "Кофейня" on ring 1, "Забегаловка" on ring 2, "Ресторан" on ring 3.
    title = meta.get("title", type_key)
    ring_titles = meta.get("ring_titles")
    if isinstance(ring_titles, list) and 0 <= ring < len(ring_titles):
        title = ring_titles[ring]
    return BoardCell(
        id=f"r{ring}s{slot}",
        ring=ring,
        slot=slot,
        type=type_key,
        title=title,
        buyable=buyable,
        price=price,
        tags=list(meta.get("tags", [])),
        params=dict(meta.get("params", {})),
    )


def _cyclic_distance(a: int, b: int, size: int) -> int:
    """Shortest distance between two slots on a ring (the board wraps around)."""
    d = abs(a - b)
    return min(d, size - d)


def _resolve_slot(slot: int, size: int) -> int:
    """Support Python-style negative indices for anchors.

    ``-1`` means "the last cell before Start", which is how the design pins Ambush
    (засада) right in front of Start / a new lap. ``1`` is the first cell after
    Start, where Hospital (больница) is anchored.
    """
    return slot + size if slot < 0 else slot


def _place_pool(
    slots: list[BoardCell | None],
    empty: list[int],
    pool: list[str],
    min_spacing: dict[str, int],
    size: int,
    rng: GameRNG,
    catalog: dict[str, dict[str, Any]],
    balance: Balance,
    ring: int,
) -> None:
    """Fill the empty slots from ``pool`` while keeping identical cell types at
    least ``min_spacing[type]`` cells apart (measured cyclically).

    Placement is a randomised greedy assignment repeated a handful of times: the
    first fully valid layout wins; otherwise the attempt with the fewest spacing
    violations is kept, so generation never fails even on a tight ring. Anchored /
    fixed cells already sitting in ``slots`` are counted towards the spacing rule.
    """

    def occupied_positions() -> dict[str, list[int]]:
        pos: dict[str, list[int]] = {}
        for i, cell in enumerate(slots):
            if cell is not None:
                pos.setdefault(cell.type, []).append(i)
        return pos

    def violates(type_key: str, slot: int, pos: dict[str, list[int]]) -> bool:
        spacing = min_spacing.get(type_key, 0)
        if spacing <= 0:
            return False
        return any(_cyclic_distance(slot, p, size) < spacing for p in pos.get(type_key, []))

    best_assignment: dict[int, str] | None = None
    best_violations: int | None = None
    for _ in range(60):
        pos = occupied_positions()
        remaining = list(pool)
        rng.shuffle(remaining)
        order = list(empty)
        rng.shuffle(order)
        assignment: dict[int, str] = {}
        violations = 0
        for slot in order:
            available = sorted(set(remaining))
            valid = [t for t in available if not violates(t, slot, pos)]
            pick_from = valid if valid else available
            choice = rng.choice(pick_from)
            if not valid:
                violations += 1
            assignment[slot] = choice
            remaining.remove(choice)
            pos.setdefault(choice, []).append(slot)
        if violations == 0:
            best_assignment = assignment
            break
        if best_violations is None or violations < best_violations:
            best_violations = violations
            best_assignment = assignment

    assert best_assignment is not None  # empty ⇒ loop still assigns {} on first pass
    for slot, type_key in best_assignment.items():
        slots[slot] = _instantiate_cell(ring, slot, type_key, catalog, balance)


def _build_ring(
    ring: int,
    size: int,
    distribution: dict[str, int],
    fixed: dict[str, str],
    filler_type: str,
    min_spacing: dict[str, int],
    rng: GameRNG,
    catalog: dict[str, dict[str, Any]],
    balance: Balance,
) -> list[BoardCell]:
    slots: list[BoardCell | None] = [None] * size
    remaining = dict(distribution)

    # 1) Place fixed/anchor cells. Negative slots index from the end (-1 = last).
    for slot_str, type_key in fixed.items():
        slot = _resolve_slot(int(slot_str), size)
        if not (0 <= slot < size):
            raise ValueError(f"Fixed slot {slot_str} out of range for ring {ring} (size {size}).")
        if slots[slot] is not None:
            raise ValueError(f"Conflicting fixed cells at ring {ring} slot {slot}.")
        slots[slot] = _instantiate_cell(ring, slot, type_key, catalog, balance)
        if remaining.get(type_key):
            remaining[type_key] -= 1

    # 2) Expand the remaining distribution into a flat pool.
    pool: list[str] = []
    for type_key, count in remaining.items():
        pool.extend([type_key] * max(0, count))

    empty = [i for i, cell in enumerate(slots) if cell is None]

    # 3) Reconcile pool length with the number of empty slots.
    if len(pool) < len(empty):
        pool.extend([filler_type] * (len(empty) - len(pool)))
    elif len(pool) > len(empty):
        # Trim fillers first; only then complain if still over capacity.
        overflow = len(pool) - len(empty)
        for _ in range(overflow):
            if filler_type in pool:
                pool.remove(filler_type)
            else:
                pool.pop()

    # 4) Constraint-aware fill (respects min_spacing between identical types).
    _place_pool(slots, empty, pool, min_spacing, size, rng, catalog, balance, ring)

    return [c for c in slots if c is not None]


def build_board(
    spec: dict[str, Any],
    catalog: dict[str, dict[str, Any]],
    balance: Balance,
    rng: GameRNG,
) -> Board:
    """Construct a :class:`Board` from a spec dict, catalog and balance."""
    ring_sizes: list[int] = spec["ring_sizes"]
    distribution: list[dict[str, int]] = spec["distribution"]
    fixed_all: dict[str, dict[str, str]] = spec.get("fixed", {})
    filler_type: str = spec.get("filler_type", "question")
    min_spacing: dict[str, int] = spec.get("min_spacing", {})

    if len(ring_sizes) != len(distribution):
        raise ValueError("ring_sizes and distribution must have the same length.")

    rings: list[list[BoardCell]] = []
    for ring, size in enumerate(ring_sizes):
        fixed = fixed_all.get(str(ring), {})
        rings.append(
            _build_ring(
                ring=ring,
                size=size,
                distribution=distribution[ring],
                fixed=fixed,
                filler_type=filler_type,
                min_spacing=min_spacing,
                rng=rng,
                catalog=catalog,
                balance=balance,
            )
        )
    return Board(rings)
