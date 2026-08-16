"""Stdlib-only HTTP client for the City room API.

The transport is injectable so tests can drive the very same client through FastAPI's
TestClient instead of a live server.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

Transport = Callable[[str, str, "dict[str, Any] | None", "dict[str, str]"], "tuple[int, Any]"]

DEFAULT_BASE_URL = "http://127.0.0.1:8000"


class HttpError(RuntimeError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.detail = detail


def urllib_transport(base_url: str, timeout: float = 30.0) -> Transport:
    def send(
        method: str,
        path: str,
        body: dict[str, Any] | None,
        headers: dict[str, str],
    ) -> tuple[int, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(f"{base_url}{path}", data=data, method=method)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        for key, value in headers.items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - local API
                payload = response.read()
                return response.status, json.loads(payload) if payload else None
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            try:
                return exc.code, json.loads(payload) if payload else None
            except json.JSONDecodeError:
                return exc.code, {"detail": payload.decode("utf-8", "replace")[:500]}
        except urllib.error.URLError as exc:
            raise HttpError(0, f"{base_url} is unreachable ({exc.reason}); is uvicorn running?") from exc

    return send


class CityClient:
    """One method per REST endpoint, with the room password kept out of the URL."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, transport: Transport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self._send = transport or urllib_transport(self.base_url)

    def _call(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        status, payload = self._send(method, path, body, headers or {})
        if status >= 400:
            detail = payload.get("detail") if isinstance(payload, dict) else payload
            raise HttpError(status, str(detail or "request failed"))
        return payload

    def meta(self) -> dict[str, Any]:
        return self._call("GET", "/api/city/meta")

    def rooms(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._call("GET", f"/api/city/rooms?limit={limit}")

    def room(self, room_id: str) -> dict[str, Any]:
        return self._call("GET", f"/api/city/rooms/{room_id}")

    def create_room(
        self,
        *,
        name: str,
        password: str,
        capacity: int = 4,
        max_rounds: int = 15,
        role_price: int = 3,
    ) -> dict[str, Any]:
        return self._call(
            "POST",
            "/api/city/rooms",
            {
                "name": name,
                "password": password,
                "capacity": capacity,
                "max_rounds": max_rounds,
                "role_price": role_price,
            },
        )

    def join(self, room_id: str, *, password: str, seat_index: int, player_name: str) -> dict[str, Any]:
        return self._call(
            "POST",
            f"/api/city/rooms/{room_id}/join",
            {"password": password, "seat_index": seat_index, "player_name": player_name},
        )

    def set_bot(
        self,
        room_id: str,
        *,
        password: str,
        seat_index: int,
        difficulty: str = "medium",
        preferred_role: str | None = None,
    ) -> dict[str, Any]:
        return self._call(
            "POST",
            f"/api/city/rooms/{room_id}/seats",
            {
                "password": password,
                "seat_index": seat_index,
                "kind": "bot",
                "difficulty": difficulty,
                "preferred_role": preferred_role,
            },
        )

    def clear_seat(self, room_id: str, *, password: str, seat_index: int) -> dict[str, Any]:
        return self._call(
            "POST",
            f"/api/city/rooms/{room_id}/seats",
            {"password": password, "seat_index": seat_index, "kind": "empty"},
        )

    def start(self, room_id: str, *, password: str, seed: int | None = None) -> dict[str, Any]:
        return self._call("POST", f"/api/city/rooms/{room_id}/start", {"password": password, "seed": seed})

    def delete(self, room_id: str, *, password: str) -> None:
        self._call("DELETE", f"/api/city/rooms/{room_id}", {"password": password})

    def state(
        self,
        room_id: str,
        *,
        password: str,
        viewer_id: str,
        after_revision: int | None = None,
    ) -> dict[str, Any]:
        path = f"/api/city/rooms/{room_id}/state?viewer_id={viewer_id}"
        if after_revision is not None:
            path = f"{path}&after_revision={after_revision}"
        return self._call("GET", path, None, {"X-Room-Password": password})

    def command(
        self,
        room_id: str,
        *,
        password: str,
        actor_id: str,
        command_type: str,
        payload: dict[str, Any],
        expected_revision: int | None = None,
        command_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "password": password,
            "actor_id": actor_id,
            "type": command_type,
            "payload": payload,
        }
        if expected_revision is not None:
            body["expected_revision"] = expected_revision
        if command_id is not None:
            body["command_id"] = command_id
        return self._call("POST", f"/api/city/rooms/{room_id}/commands", body)
