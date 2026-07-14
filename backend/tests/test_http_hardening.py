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
