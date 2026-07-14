"""REST adapter for the transport-neutral City engine and room service."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, Query, Response, status
from pydantic import BaseModel, Field

from city_engine.commands import Command
from city_engine.content import load_catalog
from city_rooms.repository import InMemoryRoomRepository
from city_rooms.service import CityRoomService
from city_rooms.upstash import UpstashRoomRepository
from city_rooms.views import room_view

router = APIRouter(prefix="/api/city", tags=["city"])


class CreateRoomRequest(BaseModel):
    name: str = Field(min_length=1, max_length=48)
    password: str = Field(min_length=4, max_length=128)
    capacity: int = Field(default=4, ge=2, le=6)
    max_rounds: int = Field(default=15, ge=5, le=30)
    role_price: int = Field(default=3, ge=2, le=10)


class JoinRoomRequest(BaseModel):
    password: str = Field(min_length=4, max_length=128)
    seat_index: int = Field(ge=0, le=5)
    player_name: str = Field(min_length=1, max_length=32)


class SeatRequest(BaseModel):
    password: str = Field(min_length=4, max_length=128)
    seat_index: int = Field(ge=0, le=5)
    kind: Literal["bot", "empty"]
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    preferred_role: str | None = None


class StartRoomRequest(BaseModel):
    password: str = Field(min_length=4, max_length=128)
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)


class DeleteRoomRequest(BaseModel):
    password: str = Field(min_length=4, max_length=128)


class CommandRequest(BaseModel):
    password: str = Field(min_length=4, max_length=128)
    type: str = Field(min_length=1, max_length=64)
    actor_id: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    command_id: str | None = Field(default=None, max_length=128)
    expected_revision: int | None = Field(default=None, ge=0)


@lru_cache(maxsize=1)
def get_room_service() -> CityRoomService:
    store = os.getenv("ROOM_STORE", "auto").lower()
    if store not in {"auto", "memory", "upstash"}:
        raise RuntimeError("ROOM_STORE must be auto, memory or upstash")
    has_upstash = bool(
        (os.getenv("UPSTASH_REDIS_REST_URL") and os.getenv("UPSTASH_REDIS_REST_TOKEN"))
        or (os.getenv("KV_REST_API_URL") and os.getenv("KV_REST_API_TOKEN"))
    )
    if store == "auto" and os.getenv("VERCEL") and not has_upstash:
        raise RuntimeError("persistent Upstash credentials are required on Vercel")
    use_upstash = store == "upstash" or (store == "auto" and has_upstash)
    repository = UpstashRoomRepository.from_env() if use_upstash else InMemoryRoomRepository()
    return CityRoomService(repository)


@router.get("/meta")
def meta() -> dict[str, Any]:
    return load_catalog().public_meta()


@router.get("/rooms")
def list_rooms(
    limit: int = Query(default=50, ge=1, le=100),
    service: CityRoomService = Depends(get_room_service),
) -> list[dict[str, Any]]:
    return [room.public_summary() for room in service.list_rooms(limit)]


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
def create_room(
    request: CreateRoomRequest,
    service: CityRoomService = Depends(get_room_service),
) -> dict[str, Any]:
    room = service.create_room(**request.model_dump())
    return room_view(room)


@router.get("/rooms/{room_id}")
def get_room(
    room_id: str,
    service: CityRoomService = Depends(get_room_service),
) -> dict[str, Any]:
    room = service.get_room(room_id)
    return {**room.public_summary(), "seats": [seat.to_dict() for seat in room.seats]}


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    room_id: str,
    request: DeleteRoomRequest,
    service: CityRoomService = Depends(get_room_service),
) -> Response:
    service.delete_room(room_id, password=request.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/rooms/{room_id}/join")
def join_room(
    room_id: str,
    request: JoinRoomRequest,
    service: CityRoomService = Depends(get_room_service),
) -> dict[str, Any]:
    room = service.join(room_id, **request.model_dump())
    viewer_id = room.seats[request.seat_index].player_id
    return room_view(room, viewer_id)


@router.post("/rooms/{room_id}/seats")
def configure_seat(
    room_id: str,
    request: SeatRequest,
    service: CityRoomService = Depends(get_room_service),
) -> dict[str, Any]:
    if request.kind == "empty":
        room = service.clear_seat(
            room_id,
            password=request.password,
            seat_index=request.seat_index,
        )
    else:
        room = service.set_bot(
            room_id,
            password=request.password,
            seat_index=request.seat_index,
            difficulty=request.difficulty,
            preferred_role=request.preferred_role,
        )
    return room_view(room)


@router.post("/rooms/{room_id}/start")
def start_room(
    room_id: str,
    request: StartRoomRequest,
    service: CityRoomService = Depends(get_room_service),
) -> dict[str, Any]:
    return room_view(service.start(room_id, **request.model_dump()))


@router.get("/rooms/{room_id}/state")
def get_room_state(
    room_id: str,
    viewer_id: str | None = Query(default=None),
    after_revision: int | None = Query(default=None, ge=0),
    room_password: str = Header(alias="X-Room-Password"),
    service: CityRoomService = Depends(get_room_service),
) -> dict[str, Any]:
    if after_revision is not None:
        current_revision = service.get_revision(room_id)
        if current_revision == after_revision:
            return {"changed": False, "revision": current_revision}
    room = service.get_room(room_id)
    service.authorize_viewer(room, room_password, viewer_id)
    legal_actions = (
        service.engine.legal_actions(room.game, viewer_id) if room.game is not None and viewer_id is not None else []
    )
    return {"changed": True, **room_view(room, viewer_id, legal_actions)}


@router.post("/rooms/{room_id}/commands")
def apply_command(
    room_id: str,
    request: CommandRequest,
    service: CityRoomService = Depends(get_room_service),
) -> dict[str, Any]:
    data = request.model_dump(exclude={"password"})
    room = service.apply_command(room_id, password=request.password, command=Command.from_dict(data))
    legal_actions = service.engine.legal_actions(room.game, request.actor_id) if room.game is not None else []
    return room_view(room, request.actor_id, legal_actions)
