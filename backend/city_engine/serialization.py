"""Canonical JSON encoding and hashes for snapshots and replay checks."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from city_engine.models import GameState


def canonical_json(value: Any) -> str:
    """Encode any JSON-safe value deterministically for persistence and hashing."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def dumps_state(state: GameState, *, pretty: bool = False) -> str:
    state.validate()
    if pretty:
        return json.dumps(state.to_dict(), ensure_ascii=False, indent=2, sort_keys=True)
    return canonical_json(state.to_dict())


def loads_state(payload: str | bytes) -> GameState:
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("game state JSON root must be an object")
    return GameState.from_dict(data)


def state_hash(state: GameState) -> str:
    return hashlib.sha256(dumps_state(state).encode("utf-8")).hexdigest()
