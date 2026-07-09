"""Game store with optional Upstash Redis (KV) persistence.

For local development (no KV env vars) this behaves exactly as before: a plain
in-process ``dict``. That keeps ``pytest`` and the local dev server dependency
free and deterministic.

On Vercel the API runs as **serverless functions that do not share memory**
between invocations, so two players (or even two requests) can hit different
instances. For multiplayer we therefore need a shared store: when the Upstash
REST credentials are present (``KV_REST_API_URL`` / ``KV_REST_API_TOKEN``, with
``UPSTASH_REDIS_REST_*`` accepted as aliases) each game is pickled and written to
KV, and a single ``room:current`` pointer names the one shared game everybody
joins. The client talks to Upstash over plain HTTPS (stdlib ``urllib``) so no
extra Python dependency is added to the deployment.

The whole ``GameState`` graph (dataclasses + ``random.Random`` + event log) is
picklable, so we avoid hand-writing a ``from_dict`` for the board/rng/log.
"""
from __future__ import annotations

import base64
import json
import os
import pickle
import urllib.request
import uuid
from typing import Any

from game_engine import GameEngine, GameState, build_game

# Keys are namespaced so the KV database can be shared with other apps if needed.
_ROOM_KEY = "bbg:room:current"
_GAME_PREFIX = "bbg:game:"
# Rooms self-expire so the free KV tier does not slowly fill up with dead games.
_TTL_SECONDS = 60 * 60 * 6  # 6 hours


class _KV:
    """Minimal Upstash Redis REST client (standard library only).

    Commands are sent as a JSON array to the base URL, e.g. ``["GET", key]`` —
    the format documented by Upstash. Returns the ``result`` field of the JSON
    response (``None`` when a key is missing).
    """

    def __init__(self) -> None:
        self.url = (
            os.getenv("KV_REST_API_URL")
            or os.getenv("UPSTASH_REDIS_REST_URL")
            or ""
        ).rstrip("/")
        self.token = (
            os.getenv("KV_REST_API_TOKEN")
            or os.getenv("UPSTASH_REDIS_REST_TOKEN")
            or ""
        )

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.token)

    def command(self, *args: Any) -> Any:
        body = json.dumps(list(args)).encode("utf-8")
        req = urllib.request.Request(
            self.url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return payload.get("result")

    def get(self, key: str) -> str | None:
        return self.command("GET", key)

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        if ttl:
            self.command("SET", key, value, "EX", ttl)
        else:
            self.command("SET", key, value)

    def delete(self, key: str) -> None:
        self.command("DEL", key)


def _encode(state: GameState) -> str:
    return base64.b64encode(pickle.dumps(state)).decode("ascii")


def _decode(blob: str) -> GameState:
    return pickle.loads(base64.b64decode(blob))


class GameManager:
    """Stores active games either in KV (shared) or in memory (local dev)."""

    def __init__(self) -> None:
        self._kv = _KV()
        self._games: dict[str, GameState] = {}  # memory fallback
        self._room_id: str | None = None  # memory fallback

    @property
    def persistent(self) -> bool:
        """True when a shared KV backend is configured (i.e. multiplayer works)."""
        return self._kv.enabled

    # ---- games -----------------------------------------------------------
    def create(
        self,
        players: list[dict[str, Any]],
        board: str | None = None,
        seed: int | None = None,
        config_overrides: dict[str, Any] | None = None,
    ) -> GameState:
        game_id = uuid.uuid4().hex[:8]
        state = build_game(
            game_id, players, board_name=board, seed=seed, config_overrides=config_overrides
        )
        self.save(state)
        return state

    def get(self, game_id: str) -> GameState:
        if self._kv.enabled:
            blob = self._kv.get(_GAME_PREFIX + game_id)
            if blob is None:
                raise KeyError(game_id)
            return _decode(blob)
        if game_id not in self._games:
            raise KeyError(game_id)
        return self._games[game_id]

    def save(self, state: GameState) -> None:
        """Persist ``state`` back to the store (required after every mutation in
        KV mode, where each request works on a freshly-unpickled copy)."""
        if self._kv.enabled:
            self._kv.set(_GAME_PREFIX + state.game_id, _encode(state), ttl=_TTL_SECONDS)
        else:
            self._games[state.game_id] = state

    def engine(self, game_id: str) -> GameEngine:
        return GameEngine(self.get(game_id))

    def delete(self, game_id: str) -> None:
        if self._kv.enabled:
            self._kv.delete(_GAME_PREFIX + game_id)
        else:
            self._games.pop(game_id, None)

    def list_ids(self) -> list[str]:
        # Only meaningful in memory mode; KV mode tracks a single room instead.
        return list(self._games)

    # ---- single shared room ---------------------------------------------
    def set_room(self, game_id: str | None) -> None:
        if self._kv.enabled:
            if game_id is None:
                self._kv.delete(_ROOM_KEY)
            else:
                self._kv.set(_ROOM_KEY, game_id, ttl=_TTL_SECONDS)
        else:
            self._room_id = game_id

    def get_room(self) -> str | None:
        """Return the current shared game id, or ``None``. Tolerant of transient
        KV errors so the setup screen still loads if the store is unreachable."""
        try:
            if self._kv.enabled:
                return self._kv.get(_ROOM_KEY)
            return self._room_id
        except Exception:  # noqa: BLE001 — never let a flaky store break room lookup
            return None


# Single shared manager for the app process.
manager = GameManager()
