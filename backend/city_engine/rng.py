"""Small portable RNG whose complete state is JSON serialisable.

Python's ``random.Random`` state is implementation-specific and bulky. This
32-bit LCG is deliberately simple: saved games only need ``state`` and
``draws``, and simulations can resume on any Python process deterministically.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeVar

T = TypeVar("T")
_MASK_32 = 0xFFFFFFFF


@dataclass(slots=True)
class RNGState:
    seed: int
    state: int
    draws: int = 0

    @classmethod
    def from_seed(cls, seed: int) -> RNGState:
        value = int(seed) & _MASK_32
        return cls(seed=value, state=value)

    def to_dict(self) -> dict[str, int]:
        return {"seed": self.seed, "state": self.state, "draws": self.draws}

    @classmethod
    def from_dict(cls, data: dict) -> RNGState:
        return cls(seed=int(data["seed"]), state=int(data["state"]), draws=int(data.get("draws", 0)))


class GameRNG:
    """Mutates the supplied :class:`RNGState` so snapshots stay current."""

    def __init__(self, state: RNGState):
        self.state = state

    def next_u32(self) -> int:
        self.state.state = (1_664_525 * self.state.state + 1_013_904_223) & _MASK_32
        self.state.draws += 1
        return self.state.state

    def random(self) -> float:
        return self.next_u32() / 2**32

    def randbelow(self, upper: int) -> int:
        if upper <= 0:
            raise ValueError("upper must be positive")
        return int(self.random() * upper)

    def randint(self, low: int, high: int) -> int:
        if high < low:
            raise ValueError("high must not be lower than low")
        return low + self.randbelow(high - low + 1)

    def chance(self, probability: float) -> bool:
        if not 0 <= probability <= 1:
            raise ValueError("probability must be between 0 and 1")
        return self.random() < probability

    def choice(self, items: list[T] | tuple[T, ...]) -> T:
        if not items:
            raise IndexError("cannot choose from an empty sequence")
        return items[self.randbelow(len(items))]

    def shuffle(self, items: list[T]) -> None:
        for index in range(len(items) - 1, 0, -1):
            other = self.randbelow(index + 1)
            items[index], items[other] = items[other], items[index]
