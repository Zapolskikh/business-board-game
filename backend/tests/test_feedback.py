from __future__ import annotations

from fastapi.testclient import TestClient

from app.feedback import InMemoryFeedbackStore, get_feedback_store
from app.main import app


def _client(store: InMemoryFeedbackStore) -> TestClient:
    app.dependency_overrides[get_feedback_store] = lambda: store
    return TestClient(app)


def test_feedback_is_stored_newest_first() -> None:
    store = InMemoryFeedbackStore()
    client = _client(store)
    try:
        first = client.post("/api/feedback", json={"kind": "bug", "message": "Карточка не открывается"})
        second = client.post(
            "/api/feedback", json={"kind": "idea", "message": "Добавьте ещё район", "contact": "@player"}
        )
        assert first.status_code == 201 and second.status_code == 201
        assert [item["kind"] for item in store.recent()] == ["idea", "bug"]
        assert store.recent()[0]["contact"] == "@player"
    finally:
        app.dependency_overrides.clear()


def test_feedback_rejects_empty_and_unknown_kinds() -> None:
    store = InMemoryFeedbackStore()
    client = _client(store)
    try:
        assert client.post("/api/feedback", json={"message": "      "}).status_code == 422
        assert client.post("/api/feedback", json={"kind": "spam", "message": "привет"}).status_code == 422
        assert store.recent() == []
    finally:
        app.dependency_overrides.clear()


def test_feedback_honeypot_is_accepted_but_not_stored() -> None:
    store = InMemoryFeedbackStore()
    client = _client(store)
    try:
        response = client.post("/api/feedback", json={"message": "buy cheap", "website": "http://spam"})
        assert response.status_code == 201
        assert store.recent() == []
    finally:
        app.dependency_overrides.clear()
