"""Seedable random number generator wrapper.

All randomness in the engine goes through :class:`GameRNG` so that simulations
are reproducible: pass a seed and you get the exact same game every time. This is
essential for debugging balance issues and writing deterministic tests.
"""
from __future__ import annotations

import random
from collections.abc import Sequence
from typing import TypeVar

T = TypeVar("T")


class GameRNG:
    """Thin, explicit wrapper around :class:`random.Random`.

    Only the operations the engine actually needs are exposed, which keeps call
    sites readable and makes it obvious that nothing bypasses the seed.
    """

    def __init__(self, seed: int | None = None) -> None:
        self._seed = seed
        self._rng = random.Random(seed)

    @property
    def seed(self) -> int | None:
        return self._seed

    def roll_die(self, sides: int = 6) -> int:
        """Roll a single die, returning an integer in ``[1, sides]``."""
        return self._rng.randint(1, sides)

    def randint(self, low: int, high: int) -> int:
        """Return a random integer in the inclusive range ``[low, high]``."""
        return self._rng.randint(low, high)

    def roll_dice(self, count: int = 1, sides: int = 6) -> list[int]:
        """Roll ``count`` dice, returning the individual face values."""
        return [self._rng.randint(1, sides) for _ in range(count)]

    def choice(self, items: Sequence[T]) -> T:
        return self._rng.choice(items)

    def shuffle(self, items: list[T]) -> None:
        """Shuffle a list in place."""
        self._rng.shuffle(items)

    def random(self) -> float:
        return self._rng.random()

    def chance(self, probability: float) -> bool:
        """Return ``True`` with the given probability (0..1)."""
        return self._rng.random() < probability
