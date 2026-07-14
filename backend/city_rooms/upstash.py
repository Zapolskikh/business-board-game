"""Upstash Redis implementation with atomic optimistic writes."""

from __future__ import annotations

import json
import os
import time
from typing import Any

from city_rooms.errors import RoomConflictError, RoomNotFoundError
from city_rooms.models import RoomState

_INDEX_KEY = "city:rooms:active"
_CREATE_SCRIPT = """
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
redis.call('SET', KEYS[3], ARGV[5], 'EX', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
return 1
"""
_SAVE_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if not current then return -1 end
local state = cjson.decode(current)
if tonumber(state['revision']) ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[6])
redis.call('SET', KEYS[3], ARGV[7], 'EX', ARGV[6])
if ARGV[5] == 'finished' then
  redis.call('ZREM', KEYS[2], ARGV[4])
else
  redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
end
return 1
"""


class UpstashRoomRepository:
    def __init__(self, redis: Any) -> None:
        self.redis = redis

    @classmethod
    def from_env(cls) -> UpstashRoomRepository:
        from upstash_redis import Redis

        url = os.getenv("UPSTASH_REDIS_REST_URL") or os.getenv("KV_REST_API_URL")
        token = os.getenv("UPSTASH_REDIS_REST_TOKEN") or os.getenv("KV_REST_API_TOKEN")
        if not url or not token:
            raise RuntimeError(
                "Upstash credentials are missing; set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN"
            )
        return cls(Redis(url=url, token=token, allow_telemetry=False))

    @staticmethod
    def _key(room_id: str) -> str:
        return f"city:room:{room_id}"

    @staticmethod
    def _revision_key(room_id: str) -> str:
        return f"city:room-revision:{room_id}"

    @staticmethod
    def _ttl(status: str) -> int:
        defaults = {"waiting": 86_400, "playing": 2_592_000, "finished": 604_800}
        variable = f"ROOM_TTL_{status.upper()}"
        return max(300, int(os.getenv(variable, defaults[status])))

    def create(self, room: RoomState) -> None:
        room.validate()
        created = self.redis.eval(
            _CREATE_SCRIPT,
            keys=[self._key(room.id), _INDEX_KEY, self._revision_key(room.id)],
            args=[
                room.to_json(),
                str(time.time()),
                room.id,
                str(self._ttl(room.status)),
                str(room.revision),
            ],
        )
        if int(created) != 1:
            raise RoomConflictError("room id already exists")

    def get(self, room_id: str) -> RoomState:
        raw = self.redis.get(self._key(room_id))
        if raw is None:
            raise RoomNotFoundError("room not found")
        if isinstance(raw, dict):
            return RoomState.from_dict(raw)
        return RoomState.from_dict(json.loads(raw))

    def get_revision(self, room_id: str) -> int:
        raw = self.redis.get(self._revision_key(room_id))
        if raw is not None:
            return int(raw)
        # Compatibility with rooms created before the lightweight polling key.
        return self.get(room_id).revision

    def list_active(self, limit: int = 50) -> list[RoomState]:
        room_ids = self.redis.zrange(_INDEX_KEY, 0, max(limit * 2, 1) - 1, rev=True)
        if not room_ids:
            return []
        pipeline = self.redis.pipeline()
        for room_id in room_ids:
            pipeline.get(self._key(str(room_id)))
        values = pipeline.exec()
        rooms: list[RoomState] = []
        stale: list[str] = []
        for room_id, raw in zip(room_ids, values, strict=True):
            if raw is None:
                stale.append(str(room_id))
                continue
            data = raw if isinstance(raw, dict) else json.loads(raw)
            room = RoomState.from_dict(data)
            if room.status != "finished":
                rooms.append(room)
            if len(rooms) >= limit:
                break
        if stale:
            self.redis.zrem(_INDEX_KEY, *stale)
        return rooms

    def save(self, room: RoomState, expected_revision: int) -> None:
        room.validate()
        saved = self.redis.eval(
            _SAVE_SCRIPT,
            keys=[self._key(room.id), _INDEX_KEY, self._revision_key(room.id)],
            args=[
                str(expected_revision),
                room.to_json(),
                str(time.time()),
                room.id,
                room.status,
                str(self._ttl(room.status)),
                str(room.revision),
            ],
        )
        if int(saved) == -1:
            raise RoomNotFoundError("room not found")
        if int(saved) != 1:
            raise RoomConflictError("room changed; reload and retry")
