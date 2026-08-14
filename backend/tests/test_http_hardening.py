from __future__ import annotations

import pytest

from app.city_api import get_room_service
from app.http_middleware import FixedWindowLimiter, RateRule


def test_fixed_window_limiter_resets_and_returns_retry_after() -> None:
    limiter = FixedWindowLimiter()
    rule = RateRule(limit=2, window_seconds=60)

    assert limiter.allow("client", "create", rule, now=10.0)[0]
    assert limiter.allow("client", "create", rule, now=11.0)[0]
    allowed, retry_after = limiter.allow("client", "create", rule, now=12.0)
    assert not allowed
    assert retry_after == 48
    assert limiter.allow("client", "create", rule, now=61.0)[0]


def test_fixed_window_limiter_survives_its_own_pruning() -> None:
    """The prune must keep the default factory, or later windows raise KeyError and every
    rate-limited endpoint answers 500 until the process restarts."""
    limiter = FixedWindowLimiter()
    rule = RateRule(limit=1_000, window_seconds=60)

    for _ in range(512):  # the 512th check triggers the prune branch
        limiter.allow("client", "private-state", rule, now=1_000.0)

    assert limiter.allow("client", "private-state", rule, now=1_060.0)[0]  # next window
    assert limiter.allow("client", "game-command", rule, now=1_000.0)[0]  # unseen bucket
    assert limiter.allow("other", "private-state", rule, now=1_000.0)[0]  # unseen client


def test_vercel_fails_fast_without_persistent_store(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.delenv("UPSTASH_REDIS_REST_TOKEN", raising=False)
    monkeypatch.delenv("KV_REST_API_URL", raising=False)
    monkeypatch.delenv("KV_REST_API_TOKEN", raising=False)
    monkeypatch.delenv("ROOM_STORE", raising=False)
    get_room_service.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="persistent Upstash credentials"):
            get_room_service()
    finally:
        get_room_service.cache_clear()
