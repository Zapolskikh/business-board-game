"""Small HTTP hardening layer suitable for local runs and serverless instances."""

from __future__ import annotations

import logging
import os
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from threading import RLock

from fastapi import Request
from fastapi.responses import JSONResponse, Response

logger = logging.getLogger("city.http")


@dataclass(frozen=True, slots=True)
class RateRule:
    limit: int
    window_seconds: int = 60


class FixedWindowLimiter:
    """Per-instance safety net; Vercel Firewall remains the global edge limiter."""

    def __init__(self) -> None:
        self._counts: dict[tuple[str, str, int], int] = defaultdict(int)
        self._lock = RLock()
        self._checks = 0

    def allow(self, client: str, bucket: str, rule: RateRule, now: float | None = None) -> tuple[bool, int]:
        timestamp = time.time() if now is None else now
        window = int(timestamp // rule.window_seconds)
        key = (client, bucket, window)
        with self._lock:
            self._checks += 1
            self._counts[key] += 1
            count = self._counts[key]
            if self._checks % 512 == 0:
                self._counts = {
                    stored_key: value for stored_key, value in self._counts.items() if stored_key[2] >= window - 1
                }
        retry_after = max(1, int((window + 1) * rule.window_seconds - timestamp))
        return count <= rule.limit, retry_after


limiter = FixedWindowLimiter()


def _client_ip(request: Request) -> str:
    if os.getenv("VERCEL"):
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def _rule_for(request: Request) -> tuple[str, RateRule] | None:
    if not request.url.path.startswith("/api/city/rooms"):
        return None
    if request.method == "POST" and request.url.path == "/api/city/rooms":
        return "create-room", RateRule(12)
    if request.method == "GET" and request.url.path.endswith("/state"):
        return "private-state", RateRule(300)
    if request.method == "POST" and request.url.path.endswith("/commands"):
        return "game-command", RateRule(120)
    if request.method == "POST":
        return "room-auth-write", RateRule(40)
    return None


async def harden_http(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
    request_id = request.headers.get("x-request-id") or secrets.token_hex(8)
    content_length = request.headers.get("content-length")
    if request.method in {"POST", "PUT", "PATCH"} and content_length:
        try:
            if int(content_length) > 65_536:
                return JSONResponse(status_code=413, content={"detail": "request body is too large"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "invalid Content-Length"})

    selected = _rule_for(request)
    if selected is not None:
        bucket, rule = selected
        allowed, retry_after = limiter.allow(_client_ip(request), bucket, rule)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "too many requests"},
                headers={"Retry-After": str(retry_after), "X-Request-ID": request_id},
            )

    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path == "/api/city/meta" and request.method == "GET":
        response.headers["Cache-Control"] = "public, max-age=300, s-maxage=3600"
    elif request.url.path == "/api/city/rooms" and request.method == "GET":
        response.headers["Cache-Control"] = "public, max-age=0, s-maxage=5, stale-while-revalidate=10"
    elif request.url.path.startswith("/api/city/rooms"):
        response.headers["Cache-Control"] = "no-store"
    logger.info(
        "request method=%s path=%s status=%s duration_ms=%.1f request_id=%s",
        request.method,
        request.url.path,
        response.status_code,
        (time.perf_counter() - started) * 1000,
        request_id,
    )
    return response
