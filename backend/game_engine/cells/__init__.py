"""Cell behaviours package.

Importing this package registers every cell behaviour (via the ``@register_cell``
decorators in the submodules). The engine imports this package on load, so simply
adding a new module here — and importing it below — makes a new cell available
everywhere (engine, bots, API, UI).
"""
from __future__ import annotations

# Order: base first (registers the fallback), then all concrete behaviours.
from game_engine.cells import (
    base,  # noqa: F401
    cards,  # noqa: F401
    dangers,  # noqa: F401
    fillers,  # noqa: F401
    places,  # noqa: F401
    properties,  # noqa: F401
    pvp,  # noqa: F401
    role_cell,  # noqa: F401
    role_power,  # noqa: F401
    services,  # noqa: F401
)

__all__ = [
    "base",
    "cards",
    "dangers",
    "fillers",
    "places",
    "properties",
    "pvp",
    "role_cell",
    "role_power",
    "services",
]
