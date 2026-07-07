"""REST routes for games and simulation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.game_manager import manager
from app.schemas import (
    ActionIn,
    ActionResult,
    CreateGameIn,
    GameStateResponse,
    SimulateIn,
)
from game_engine.config_loader import (
    load_balance_dict,
    load_cell_catalog,
    load_cell_effects,
    load_question_cards,
    load_roles,
)
from game_engine.registry import registered_types
from simulation.bots import make_bot
from simulation.runner import run_batch
from simulation.stats import compute_report

router = APIRouter()


@router.get("/meta")
def get_meta() -> dict:
    """Static content the UI needs: roles, cell catalog, effects, economy."""
    balance = load_balance_dict()
    return {
        "roles": load_roles(),
        "cells": load_cell_catalog(),
        "cell_effects": load_cell_effects(),
        "cell_types": registered_types(),
        "question_cards": load_question_cards(),
        "economy": {
            "start_bonus": balance.get("start_bonus"),
            "start_experience": balance.get("start_experience"),
            "promotion": balance.get("promotion", {}),
            "prices": balance.get("prices", {}),
            "rent": balance.get("rent", {}),
            "roof_price": balance.get("roof_price"),
            "taxi": balance.get("taxi", {}),
            "station": balance.get("station", {}),
            "auction": balance.get("auction", {}),
        },
    }


@router.post("/games", response_model=GameStateResponse)
def create_game(body: CreateGameIn) -> GameStateResponse:
    players = [p.model_dump() for p in body.players]
    state = manager.create(
        players, board=body.board, seed=body.seed, config_overrides=body.config
    )
    return GameStateResponse(state=state.to_dict())


@router.get("/games/{game_id}", response_model=GameStateResponse)
def get_game(game_id: str) -> GameStateResponse:
    try:
        state = manager.get(game_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Игра не найдена.") from exc
    return GameStateResponse(state=state.to_dict())


@router.post("/games/{game_id}/action", response_model=ActionResult)
def post_action(game_id: str, body: ActionIn) -> ActionResult:
    try:
        engine = manager.engine(game_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Игра не найдена.") from exc
    try:
        events = engine.apply_action(body.player_id, body.action, body.payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ActionResult(
        events=[e.to_dict() for e in events],
        state=engine.state.to_dict(),
    )


@router.delete("/games/{game_id}")
def delete_game(game_id: str) -> dict:
    manager.delete(game_id)
    return {"ok": True}


@router.post("/simulate")
def simulate(body: SimulateIn) -> dict:
    """Run a batch simulation and return the balance report (no game is stored)."""
    try:
        bot = make_bot(body.bot)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    results = run_batch(
        games=body.games,
        num_players=body.players,
        board_name=body.board,
        bot=bot,
        base_seed=body.seed,
    )
    return compute_report(results)
