"""FastAPI application entry point.

Run with::

    uvicorn app.main:app --reload

The engine and simulator are exposed under ``/api``. CORS origins are controlled
by the ALLOWED_ORIGINS environment variable (comma-separated). Falls back to the
Vite dev server for local development.
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import router

app = FastAPI(
    title="Сатирическая бизнес-игра — API",
    version="0.1.0",
    description="REST-интерфейс поверх игрового движка и симулятора.",
)

_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/")
def root() -> dict:
    return {"name": "business-board-game", "docs": "/docs", "api": "/api"}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
