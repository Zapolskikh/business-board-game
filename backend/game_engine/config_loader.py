"""Loading of JSON game data (balance, roles, cell catalog, board specs).

All files live under ``backend/data``. Paths are resolved relative to this
module so the loaders work no matter the current working directory.
"""
from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from game_engine.config import Balance, GameConfig

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BOARDS_DIR = DATA_DIR / "boards"


def _read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


@cache
def _load_raw(name: str) -> dict[str, Any]:
    return _read_json(DATA_DIR / f"{name}.json")


def load_balance_dict() -> dict[str, Any]:
    """Return a fresh copy of the raw balance dict (safe to mutate)."""
    return json.loads(json.dumps(_load_raw("balance")))


def load_balance() -> Balance:
    return Balance(load_balance_dict())


def load_roles() -> list[dict[str, Any]]:
    return list(_load_raw("roles")["roles"])


def load_role_ids() -> list[str]:
    return [r["id"] for r in load_roles()]


def load_cell_catalog() -> dict[str, dict[str, Any]]:
    return dict(_load_raw("cells")["cells"])


def load_cell_effects() -> dict[str, dict[str, Any]]:
    """Per-cell human-readable descriptions (base + per-role) for the UI."""
    return dict(_load_raw("cell_effects")["effects"])


def load_question_cards() -> list[dict[str, Any]]:
    """The '?' card deck (source of truth for both the game and the FAQ)."""
    return list(_load_raw("question_cards")["cards"])


def load_board_spec(board_name: str) -> dict[str, Any]:
    path = BOARDS_DIR / f"{board_name}.json"
    if not path.exists():
        available = ", ".join(p.stem for p in BOARDS_DIR.glob("*.json"))
        raise FileNotFoundError(
            f"Board spec '{board_name}' not found in {BOARDS_DIR}. Available: {available}"
        )
    return _read_json(path)


def load_game_config(board_name: str | None = None, overrides: dict[str, Any] | None = None) -> GameConfig:
    """Build a :class:`GameConfig` from balance.json plus optional overrides.

    ``balance.json`` doubles as the top-level config source: it holds both the
    tunable numbers (wrapped in :class:`Balance`) and the game-level settings
    (starting money, victory rules, promotion, board name).
    """
    data = load_balance_dict()
    if overrides:
        data.update(overrides)
    if board_name:
        data["board_name"] = board_name
    balance = Balance(data)
    return GameConfig.from_dict(data, balance)
