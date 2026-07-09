"""Request/response schemas for the API.

Game *state* is serialised via ``GameState.to_dict()`` (a plain dict) rather than
mirrored into Pydantic models — this keeps the engine as the single source of
truth for state shape and avoids drift as the game grows.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PlayerIn(BaseModel):
    name: str = Field(..., description="Отображаемое имя игрока.")
    is_bot: bool = Field(False, description="Управляется ли игрок ботом.")
    role: str | None = Field(None, description="Стартовая роль (необязательно).")


class CreateGameIn(BaseModel):
    players: list[PlayerIn] = Field(..., min_length=2, max_length=6)
    board: str | None = Field(None, description="Имя поля, напр. board_60 / board_72.")
    seed: int | None = Field(None, description="Seed для воспроизводимости.")
    config: dict[str, Any] | None = Field(
        None, description="Переопределения конфига (напр. victory: max_turns / target_net_worth)."
    )


class ActionIn(BaseModel):
    player_id: str
    action: str = Field(..., description="roll_dice | resolve_decision")
    payload: dict[str, Any] | None = None


class SimulateIn(BaseModel):
    games: int = Field(100, ge=1, le=20000)
    players: int = Field(4, ge=2, le=6)
    board: str | None = None
    seed: int = 0
    bot: str = "random"


class ActionResult(BaseModel):
    events: list[dict[str, Any]]
    state: dict[str, Any]


class GameStateResponse(BaseModel):
    state: dict[str, Any]


class ChatIn(BaseModel):
    player_id: str
    text: str = Field(..., min_length=1, max_length=200)
