"""Обратная связь от игроков: баги, предложения, просто слова.

Сообщения складываются в тот же Upstash, где живут комнаты, одним списком без срока жизни —
в отличие от комнат, отзыв не должен исчезать через полчаса. Список обрезается сверху, чтобы
случайный поток спама не съел квоту базы.

Прочитать накопленное: консоль Upstash → Data Browser → ключ ``city:feedback``, или
``python -m app.feedback`` с переменными окружения базы.
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Literal, Protocol

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field

FEEDBACK_KEY = "city:feedback"
# Хватит на годы честных сообщений и не даст спаму вырасти в гигабайты.
FEEDBACK_LIMIT = 2000

FeedbackKind = Literal["bug", "idea", "other"]


class FeedbackRequest(BaseModel):
    # Пробелы обрезаются до проверки длины: «   » — не сообщение.
    model_config = ConfigDict(str_strip_whitespace=True)

    kind: FeedbackKind = "other"
    message: str = Field(min_length=3, max_length=4000)
    # Необязательно: почта, Telegram — как игроку удобнее, чтобы ему можно было ответить.
    contact: str = Field(default="", max_length=200)
    # Служебное, заполняет клиент: версия игры и устройство помогают воспроизвести баг.
    version: str = Field(default="", max_length=64)
    user_agent: str = Field(default="", max_length=400)
    # Ловушка для ботов: настоящая форма это поле не показывает и оставляет пустым.
    website: str = Field(default="", max_length=200)


class FeedbackStore(Protocol):
    def add(self, entry: dict[str, Any]) -> None: ...

    def recent(self, limit: int = 50) -> list[dict[str, Any]]: ...


class InMemoryFeedbackStore:
    """Для разработки и тестов: сообщения живут, пока жив процесс."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []

    def add(self, entry: dict[str, Any]) -> None:
        self.entries.insert(0, entry)
        del self.entries[FEEDBACK_LIMIT:]

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        return self.entries[:limit]


class UpstashFeedbackStore:
    def __init__(self, redis: Any) -> None:
        self.redis = redis

    def add(self, entry: dict[str, Any]) -> None:
        pipeline = self.redis.pipeline()
        pipeline.lpush(FEEDBACK_KEY, json.dumps(entry, ensure_ascii=False))
        pipeline.ltrim(FEEDBACK_KEY, 0, FEEDBACK_LIMIT - 1)
        pipeline.exec()

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        raw = self.redis.lrange(FEEDBACK_KEY, 0, limit - 1) or []
        return [item if isinstance(item, dict) else json.loads(item) for item in raw]


def _upstash_credentials() -> tuple[str, str] | None:
    url = os.getenv("UPSTASH_REDIS_REST_URL") or os.getenv("KV_REST_API_URL")
    token = os.getenv("UPSTASH_REDIS_REST_TOKEN") or os.getenv("KV_REST_API_TOKEN")
    return (url, token) if url and token else None


@lru_cache(maxsize=1)
def get_feedback_store() -> FeedbackStore:
    """Тот же выбор хранилища, что у комнат: Upstash, когда он настроен, иначе память."""
    store = os.getenv("ROOM_STORE", "auto").lower()
    credentials = _upstash_credentials()
    if store == "upstash" or (store == "auto" and credentials):
        from upstash_redis import Redis

        if not credentials:
            raise RuntimeError("Upstash credentials are missing for feedback storage")
        url, token = credentials
        return UpstashFeedbackStore(Redis(url=url, token=token, allow_telemetry=False))
    return InMemoryFeedbackStore()


router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("", status_code=status.HTTP_201_CREATED)
def send_feedback(request: FeedbackRequest, store: FeedbackStore = Depends(get_feedback_store)) -> dict[str, str]:
    entry_id = secrets.token_hex(6)
    # Бот заполнил скрытое поле: отвечаем как обычно, чтобы он не учился обходить ловушку.
    if request.website:
        return {"id": entry_id}
    store.add(
        {
            "id": entry_id,
            "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "kind": request.kind,
            "message": request.message,
            "contact": request.contact,
            "version": request.version,
            "user_agent": request.user_agent,
        }
    )
    return {"id": entry_id}


if __name__ == "__main__":
    # Быстрый просмотр последних сообщений из терминала.
    for item in get_feedback_store().recent(100):
        contact = f"  ↩ {item['contact']}" if item.get("contact") else ""
        print(f"[{item['created_at']}] {item['kind']:5} v{item.get('version', '')}{contact}\n  {item['message']}\n")
