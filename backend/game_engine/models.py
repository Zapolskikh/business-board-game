"""Core game data models.

These are plain dataclasses that hold *state only*; all behaviour lives in the
engine and the cell classes. Keeping state and behaviour separate makes the state
trivially serialisable (for the API and for simulation snapshots) and keeps the
rules in one place.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from game_engine.config import GameConfig
from game_engine.enums import Phase
from game_engine.events import EventLog
from game_engine.rng import GameRNG


@dataclass
class Player:
    """Mutable per-player state."""

    id: str
    name: str
    is_bot: bool = False

    money: int = 0
    experience: int = 0

    # Position: which ring and which slot within that ring.
    ring: int = 0
    position: int = 0

    role: str | None = None  # role id string, or None
    scandals: int = 0
    roofs: int = 0  # "Крыша" — consumable protection charges
    insured_cells: set[str] = field(default_factory=set)  # capitalist insurance
    cards: list[str] = field(default_factory=list)  # held "?" cards
    loan_payments_left: int = 0  # future Start payouts redirected to the bank

    bankrupt_count: int = 0
    extra_rolls: int = 0  # granted by "roll again" cells

    # Transient per-turn/anti-abuse flags and simulation counters.
    flags: dict[str, Any] = field(default_factory=dict)
    stats: dict[str, int] = field(default_factory=dict)

    def bump(self, key: str, amount: int = 1) -> None:
        """Increment a named simulation counter."""
        self.stats[key] = self.stats.get(key, 0) + amount

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "is_bot": self.is_bot,
            "money": self.money,
            "experience": self.experience,
            "ring": self.ring,
            "position": self.position,
            "role": self.role,
            "scandals": self.scandals,
            "roofs": self.roofs,
            "insured_cells": sorted(self.insured_cells),
            "cards": list(self.cards),
            "loan_payments_left": self.loan_payments_left,
            "bankrupt_count": self.bankrupt_count,
            "stats": dict(self.stats),
        }


@dataclass
class BoardCell:
    """A single square on the board.

    ``type`` is a registry key (string), never an enum, so new cell behaviours
    can be added without touching core code. ``params`` holds static per-type
    configuration from the catalog; ``state`` holds mutable runtime data.
    """

    id: str
    ring: int
    slot: int
    type: str
    title: str
    buyable: bool = False
    price: int = 0
    owner_id: str | None = None
    tags: list[str] = field(default_factory=list)  # role ids with special effects
    params: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "ring": self.ring,
            "slot": self.slot,
            "type": self.type,
            "title": self.title,
            "buyable": self.buyable,
            "price": self.price,
            "owner_id": self.owner_id,
            "tags": self.tags,
            "upgraded": bool(self.state.get("upgraded", False)),
        }


class Board:
    """The three-ring board. ``rings[ring][slot]`` -> :class:`BoardCell`."""

    def __init__(self, rings: list[list[BoardCell]]) -> None:
        self.rings = rings
        self._by_id = {cell.id: cell for ring in rings for cell in ring}

    def ring_size(self, ring: int) -> int:
        return len(self.rings[ring])

    @property
    def ring_count(self) -> int:
        return len(self.rings)

    def cell_at(self, ring: int, slot: int) -> BoardCell:
        return self.rings[ring][slot]

    def by_id(self, cell_id: str) -> BoardCell:
        return self._by_id[cell_id]

    def all_cells(self) -> list[BoardCell]:
        return list(self._by_id.values())

    def find_by_type(self, type_key: str, ring: int | None = None) -> list[BoardCell]:
        return [
            c
            for c in self._by_id.values()
            if c.type == type_key and (ring is None or c.ring == ring)
        ]

    def cells_owned_by(self, player_id: str) -> list[BoardCell]:
        return [c for c in self._by_id.values() if c.owner_id == player_id]

    def free_buyable_cells(self) -> list[BoardCell]:
        return [c for c in self._by_id.values() if c.buyable and c.owner_id is None]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ring_sizes": [len(r) for r in self.rings],
            "rings": [[cell.to_dict() for cell in ring] for ring in self.rings],
        }


@dataclass
class DecisionOption:
    """One selectable option in a pending decision."""

    id: str
    label: str
    data: dict[str, Any] = field(default_factory=dict)
    # UI hints: ``rolls_dice`` shows a 🎲 badge (this option leads to a dice roll);
    # ``hint`` is a short tooltip describing the consequences of the option.
    rolls_dice: bool = False
    hint: str = ""
    # If non-empty, the option is only available to a specific role; the UI
    # shows the role name in the button so players understand why it appears.
    role: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "data": self.data,
            "rolls_dice": self.rolls_dice,
            "hint": self.hint,
            "role": self.role,
        }


@dataclass
class Decision:
    """A choice the current player must make before the turn can continue.

    Both the browser UI and simulation bots respond to this identically, by
    submitting a ``RESOLVE_DECISION`` action with the chosen ``option_id``.
    ``handler`` and ``context`` let the engine route the answer back to the cell
    that raised the decision and resume multi-step interactions.
    """

    type: str
    player_id: str
    prompt: str
    options: list[DecisionOption]
    handler: str  # cell type key (or subsystem) that will resolve this
    cell_id: str | None = None
    context: dict[str, Any] = field(default_factory=dict)

    def option_ids(self) -> list[str]:
        return [o.id for o in self.options]

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "player_id": self.player_id,
            "prompt": self.prompt,
            "options": [o.to_dict() for o in self.options],
            "handler": self.handler,
            "cell_id": self.cell_id,
            "context": self.context,
        }


@dataclass
class GameState:
    """The complete, authoritative state of one game."""

    game_id: str
    players: list[Player]
    board: Board
    config: GameConfig
    rng: GameRNG
    log: EventLog = field(default_factory=EventLog)

    current_index: int = 0
    turn_number: int = 0  # counts individual player turns
    round_number: int = 0  # counts full rounds (all players moved once)
    phase: str = Phase.AWAIT_ROLL
    pending_decision: Decision | None = None
    winner_id: str | None = None
    # Last dice result, surfaced to the UI ("what did the current player roll?").
    last_die: int | None = None
    last_die_player_id: str | None = None
    chat: list = field(default_factory=list)  # [{player_id, name, text, idx}]
    negative_effect_queue: list[dict[str, Any]] = field(default_factory=list)

    # ---- convenience accessors -------------------------------------------
    @property
    def current_player(self) -> Player:
        return self.players[self.current_index]

    @property
    def finished(self) -> bool:
        return self.phase == Phase.GAME_OVER

    def player_by_id(self, player_id: str) -> Player:
        for p in self.players:
            if p.id == player_id:
                return p
        raise KeyError(f"Unknown player id: {player_id}")

    def role_holder(self, role: str) -> Player | None:
        """Return the player currently holding ``role`` (roles are unique)."""
        for p in self.players:
            if p.role == role:
                return p
        return None

    def net_worth(self, player: Player) -> int:
        """Placeholder scoring: cash + owned property prices + weighted experience."""
        owned = sum(c.price + (int(c.state.get("upgrade_cost", c.price)) if c.state.get("upgraded") else 0) for c in self.board.cells_owned_by(player.id))
        exp = player.experience * self.config.victory.experience_weight
        return player.money + owned + exp

    def to_dict(self, include_board: bool = True, log_tail: int = 80) -> dict[str, Any]:
        # Include a bounded tail of the event log so clients that only *poll* the
        # state (other players / spectators in multiplayer) still get the
        # narrative and can drive the token-move animation. ``seq`` is the
        # event's absolute index in the full log so it stays stable across polls
        # even once the tail starts dropping old events; ``log_size`` is the
        # total count. The acting client no longer needs the per-action delta.
        events = self.log.events
        base = max(0, len(events) - log_tail)
        log = [{**e.to_dict(), "seq": base + i} for i, e in enumerate(events[base:])]
        data: dict[str, Any] = {
            "game_id": self.game_id,
            "players": [p.to_dict() for p in self.players],
            "current_index": self.current_index,
            "current_player_id": self.current_player.id if self.players else None,
            "turn_number": self.turn_number,
            "round_number": self.round_number,
            "phase": self.phase,
            "pending_decision": (
                self.pending_decision.to_dict() if self.pending_decision else None
            ),
            "winner_id": self.winner_id,
            "net_worth": {p.id: self.net_worth(p) for p in self.players},
            "last_die": self.last_die,
            "last_die_player_id": self.last_die_player_id,
            "log": log,
            "log_size": len(events),
            "chat": getattr(self, "chat", [])[-50:],
            "victory": {
                "max_turns": self.config.victory.max_turns,
                "target_net_worth": self.config.victory.target_net_worth,
            },
        }
        if include_board:
            data["board"] = self.board.to_dict()
        return data
