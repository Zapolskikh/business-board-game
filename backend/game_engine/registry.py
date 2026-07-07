"""Cell behaviour registry.

Cell *behaviours* are classes decorated with :func:`register_cell`. The engine
looks them up by string key at runtime. This is the primary extension point:

    @register_cell("casino")
    class CasinoCell(BaseCell):
        ...

Adding a new cell type never requires editing core engine code — just register a
class and add JSON data. Unknown/unregistered types fall back to a no-op cell so
a data typo degrades gracefully instead of crashing a whole simulation.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, TypeVar

if TYPE_CHECKING:
    from game_engine.cells.base import BaseCell

_REGISTRY: dict[str, BaseCell] = {}

TCell = TypeVar("TCell", bound="BaseCell")


def register_cell(type_key: str) -> Callable[[type[TCell]], type[TCell]]:
    """Class decorator that registers a single shared cell-behaviour instance.

    Cell behaviour objects are stateless (all mutable state lives on
    :class:`~game_engine.models.BoardCell`), so one instance per type is reused
    for every square of that type.
    """

    def decorator(cls: type[TCell]) -> type[TCell]:
        if type_key in _REGISTRY:
            raise ValueError(f"Cell type already registered: {type_key!r}")
        instance = cls()
        instance.type_key = type_key
        _REGISTRY[type_key] = instance
        return cls

    return decorator


def get_cell_behaviour(type_key: str) -> BaseCell:
    """Return the behaviour for ``type_key`` (or the fallback no-op behaviour)."""
    behaviour = _REGISTRY.get(type_key)
    if behaviour is None:
        return _REGISTRY["__fallback__"]
    return behaviour


def registered_types() -> list[str]:
    return sorted(k for k in _REGISTRY if not k.startswith("__"))


def is_registered(type_key: str) -> bool:
    return type_key in _REGISTRY
