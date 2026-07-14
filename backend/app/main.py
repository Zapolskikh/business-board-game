"""FastAPI entry point for the production City game backend."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.city_api import router as city_router
from app.http_middleware import harden_http
from city_rooms.errors import (
    RoomAccessError,
    RoomConflictError,
    RoomNotFoundError,
    RoomValidationError,
)

app = FastAPI(
    title="City of Influence API",
    version="0.2.0",
    description="Authoritative REST API for City rooms and game commands.",
)

_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
_origins = [origin.strip() for origin in _raw.split(",") if origin.strip()]
_wildcard = "*" in _origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _wildcard else _origins,
    allow_credentials=not _wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(harden_http)


@app.exception_handler(RoomNotFoundError)
async def room_not_found(_request: object, exc: RoomNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(RoomAccessError)
async def room_access_denied(_request: object, exc: RoomAccessError) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(RoomConflictError)
async def room_conflict(_request: object, exc: RoomConflictError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(RoomValidationError)
async def room_validation(_request: object, exc: RoomValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


app.include_router(city_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "city-influence", "docs": "/docs", "api": "/api/city"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, str]:
    from app.city_api import get_room_service

    service = get_room_service()
    service.list_rooms(1)
    return {"status": "ready", "store": service.repository.__class__.__name__}
