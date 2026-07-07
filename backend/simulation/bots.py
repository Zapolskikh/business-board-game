"""Bot interface and implementations.

A bot only has to answer *decisions* — rolling the dice is automatic, driven by
the runner. This mirrors exactly what a human client does, so bots and humans are
interchangeable and the same engine code path is exercised in simulation and in
real play.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from game_engine.models import Decision, GameState
    from game_engine.rng import GameRNG


class Bot:
    """Base bot. Subclasses implement :meth:`choose_option`."""

    name: str = "bot"

    def choose_option(self, decision: Decision, state: GameState, rng: GameRNG) -> str:
        raise NotImplementedError


class RandomBot(Bot):
    """Chooses a uniformly random option.

    This is the workhorse for balance testing: with purely random decisions,
    persistent differences in win-rate between roles indicate a design imbalance
    rather than skill.
    """

    name = "random"

    def choose_option(self, decision: Decision, state: GameState, rng: GameRNG) -> str:
        return rng.choice(decision.option_ids())


class GreedyBot(Bot):
    """A slightly less random baseline: buys/earns when possible, avoids obvious
    self-harm. Useful to compare against :class:`RandomBot` (does structure change
    the balance picture?). Falls back to random for anything it doesn't recognise.
    """

    name = "greedy"

    _PREFERRED = ("buy", "pay2", "subsidy", "roof", "double")
    _AVOIDED = ("jail", "hospital", "role", "take", "fake", "pretend")

    def choose_option(self, decision: Decision, state: GameState, rng: GameRNG) -> str:
        ids = decision.option_ids()
        for pref in self._PREFERRED:
            if pref in ids:
                return pref
        safe = [o for o in ids if o not in self._AVOIDED]
        return rng.choice(safe) if safe else rng.choice(ids)


BOTS: dict[str, type[Bot]] = {RandomBot.name: RandomBot, GreedyBot.name: GreedyBot}


def make_bot(name: str) -> Bot:
    if name not in BOTS:
        raise ValueError(f"Unknown bot '{name}'. Available: {', '.join(BOTS)}")
    return BOTS[name]()
