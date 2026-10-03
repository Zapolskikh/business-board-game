"""Турнир четырёх стратегий: баланс контента, измеренный разными ботами за одним столом.

Один бот меряет баланс своей функцией полезности, и что он не ценит, то и выглядит мусором. Здесь за
столом четыре политики, которые думают по-разному — Reborn (оценка действия), Ledger (план хода и
«капитал»), Oracle (видит колоды, доигрывает стол вперёд) и BorisTheTraxer (свод правил тестера), — и
каждая цифра снимается в разрезе «бот × предмет × треть партии». Предмет, который берут все четверо,
силён по-настоящему; предмет, который не берёт никто, включая Oracle, — аутсайдер; предмет, который
любит один бот, — вопрос к боту, а не к балансу.

Оси те же, что в ``simulation.balance``, и по той же причине не смешиваются с исходом партии:

* **частота выбора при доступности** — из решений, где предмет был легален, доля, где его взяли;
* **что он дал** — очки, деньги и влияние за действие, жизнь объекта от покупки до конца партии.

Сверху: показ на рынке, проекты, карты, роли и причины их потери, взаимодействие и защита, динамика
партии (насколько исход решён к середине, есть ли камбэк), разнообразие победных стратегий, мнение
Oracle об альтернативах и поиск аномалий. Отчёт — ``simulation.tournament_report``.

Запуск::

    python -m simulation.tournament --games=24 --workers=20 --output=TOURNAMENT.md
"""

from __future__ import annotations

import argparse
import itertools
import json
import random
import sys
import time
import zlib
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import city_bots.oracle as oracle
from city_bots import choose_bot_command
from city_bots.policy import BOT_POLICY_NAMES
from city_engine.constants import LOBBYING_INFLUENCE, LOBBYING_POINTS
from city_engine.engine import CityEngine
from city_engine.factory import GameSettings, PlayerSetup, create_game_from_catalog
from city_engine.models import GameState, PlayerState
from simulation.balance import MONEY_EXIT_RATE, _actions_consumed, action_key, bucket_of

DEFAULT_LINEUP = ("expert", "ledger", "oracle", "boris")
# Перевод денег и влияния в очки — по их единственным выходам, патронажу и лоббированию. Только для
# отчёта: движок кучу не считает ни во что.
INFLUENCE_EXIT_RATE = LOBBYING_POINTS / LOBBYING_INFLUENCE
# Одно и то же решение столько раз за ход — кандидат в цикл.
LOOP_REPEATS = 4
# Конец партии с такой кучей — ресурс, которому не нашлось стока.
HOARD_MONEY = 150
HOARD_INFLUENCE = 40
# Сколько примеров каждой аномалии хранить с сидами.
EXAMPLES = 12
# Решения, которые повторяются по природе и циклом не являются.
REPEATABLE = frozenset({"end_turn", "convert_action_card:money", "convert_action_card:influence"})
SCORE_PARTS = ("assets", "projects", "bonus", "role", "scandals")


@dataclass(frozen=True, slots=True)
class TournamentConfig:
    games: int = 24
    players: int = 4
    rounds: int = 15
    role_price: int = 3
    lineup: tuple[str, ...] = DEFAULT_LINEUP
    seed: int = 2026
    workers: int = 1
    # Одна раздача разыгрывается столько раз, с циклическим поворотом рассадки: так каждый бот сидит
    # на каждом месте той же раздачи, и удача раздачи вычитается из сравнения ботов и мест.
    rotations: int = 4
    # Сколько контрфактических развилок в среднем на партию (0 — без них).
    forks: float = 8.0
    # Прицельные развилки: только в эти решения (ключи ``action_key``). Пусто — в любые.
    fork_focus: tuple[str, ...] = ()


def block_of(config: TournamentConfig, index: int) -> tuple[int, int]:
    """(номер раздачи, поворот рассадки) партии."""
    rotations = max(1, config.rotations)
    return index // rotations, index % rotations


def seating(config: TournamentConfig, index: int) -> tuple[str, ...]:
    """Рассадка партии: базовый порядок раздачи, повёрнутый на номер повтора.

    Базовые порядки перебирают все упорядоченные выборки состава, а повороты внутри раздачи сажают
    каждого бота на каждое место — место не смешивается ни с ботом, ни с раздачей.
    """
    arrangements = sorted(itertools.permutations(config.lineup, config.players))
    block, rotation = block_of(config, index)
    base = arrangements[block % len(arrangements)]
    shift = rotation % len(base)
    return base[shift:] + base[:shift]


def tournament_seed(config: TournamentConfig, index: int) -> int:
    """Сид раздачи: одинаковый у всех повторов блока, случайный от блока к блоку."""
    block, _rotation = block_of(config, index)
    return random.Random(f"tournament:{config.seed}:{block}").randrange(1, 2**32)


def checkpoints(rounds: int) -> tuple[int, int]:
    """Раунды, на которых снимается положение стола: конец первой и второй трети партии."""
    third = max(1, rounds // 3)
    return third, 2 * third


@dataclass
class Tally:
    """Всё, что измерила пачка партий. Только счётчики и списки, поэтому слияние — сложение."""

    games: int = 0
    # --- решения: ключ (бот, решение, треть) ---------------------------------------------------
    avail: Counter = field(default_factory=Counter)
    chosen: Counter = field(default_factory=Counter)
    valued: Counter = field(default_factory=Counter)
    actions: Counter = field(default_factory=Counter)
    self_pts: Counter = field(default_factory=Counter)
    self_money: Counter = field(default_factory=Counter)
    self_infl: Counter = field(default_factory=Counter)
    self_scandals: Counter = field(default_factory=Counter)
    # Очки + деньги и влияние по курсам выхода: одна «ценность» решения, с квадратами для интервалов.
    value: Counter = field(default_factory=Counter)
    value_sq: Counter = field(default_factory=Counter)
    rival_pts: Counter = field(default_factory=Counter)
    rival_money: Counter = field(default_factory=Counter)
    rival_infl: Counter = field(default_factory=Counter)
    rival_scandals: Counter = field(default_factory=Counter)
    settling: int = 0
    # --- объекты: ключ (бот, карта) ------------------------------------------------------------
    obj_offers: Counter = field(default_factory=Counter)
    obj_bought: Counter = field(default_factory=Counter)
    obj_price: Counter = field(default_factory=Counter)
    obj_round: Counter = field(default_factory=Counter)
    obj_slot_rounds: Counter = field(default_factory=Counter)
    obj_money: Counter = field(default_factory=Counter)
    obj_infl: Counter = field(default_factory=Counter)
    obj_sold: Counter = field(default_factory=Counter)
    obj_net: Counter = field(default_factory=Counter)
    obj_net_sq: Counter = field(default_factory=Counter)
    obj_closed: Counter = field(default_factory=Counter)
    obj_owner_games: Counter = field(default_factory=Counter)
    obj_owner_wins: Counter = field(default_factory=Counter)
    # --- рынок: ключ карта ---------------------------------------------------------------------
    mkt_appear: Counter = field(default_factory=Counter)
    mkt_slot_rounds: Counter = field(default_factory=Counter)
    mkt_expired: Counter = field(default_factory=Counter)
    mkt_refreshed: Counter = field(default_factory=Counter)
    mkt_bought: Counter = field(default_factory=Counter)
    mkt_wait: Counter = field(default_factory=Counter)
    # --- проекты -------------------------------------------------------------------------------
    proj_board_rounds: Counter = field(default_factory=Counter)
    proj_expired: Counter = field(default_factory=Counter)
    proj_taken: Counter = field(default_factory=Counter)  # (бот, проект)
    proj_round: Counter = field(default_factory=Counter)
    proj_cost_money: Counter = field(default_factory=Counter)
    proj_cost_infl: Counter = field(default_factory=Counter)
    proj_points: Counter = field(default_factory=Counter)
    proj_rivals_met: Counter = field(default_factory=Counter)
    # --- карты действий: ключ (бот, карта) -----------------------------------------------------
    card_drawn: Counter = field(default_factory=Counter)
    card_played: Counter = field(default_factory=Counter)
    card_converted: Counter = field(default_factory=Counter)
    card_blocked: Counter = field(default_factory=Counter)
    card_end_hand: Counter = field(default_factory=Counter)
    # --- серые операции: ключ (бот, операция) --------------------------------------------------
    grey_runs: Counter = field(default_factory=Counter)
    grey_success: Counter = field(default_factory=Counter)
    grey_blocked: Counter = field(default_factory=Counter)
    grey_points: Counter = field(default_factory=Counter)
    grey_tiers: Counter = field(default_factory=Counter)  # (операция, исход кубика)
    grey_modifier: Counter = field(default_factory=Counter)  # (бот, операция) -> сумма модификаторов
    grey_by_role: Counter = field(default_factory=Counter)  # (операция, роль)
    # --- роли: ключ (бот, роль) ----------------------------------------------------------------
    role_claims: Counter = field(default_factory=Counter)
    role_takeovers: Counter = field(default_factory=Counter)
    role_turns: Counter = field(default_factory=Counter)
    role_lost: Counter = field(default_factory=Counter)  # (роль, причина)
    role_final: Counter = field(default_factory=Counter)
    role_final_wins: Counter = field(default_factory=Counter)
    # --- взаимодействие и защита: ключ (бот, вид) ----------------------------------------------
    dealt: Counter = field(default_factory=Counter)
    received: Counter = field(default_factory=Counter)
    roofs_gained: Counter = field(default_factory=Counter)
    roofs_blocked: Counter = field(default_factory=Counter)
    roofs_end: Counter = field(default_factory=Counter)
    # --- итоги ---------------------------------------------------------------------------------
    seats: Counter = field(default_factory=Counter)
    wins: Counter = field(default_factory=Counter)
    score_sum: Counter = field(default_factory=Counter)
    score_sq: Counter = field(default_factory=Counter)
    parts: Counter = field(default_factory=Counter)
    winner_parts: Counter = field(default_factory=Counter)
    leftover: Counter = field(default_factory=Counter)
    jailed: Counter = field(default_factory=Counter)
    seat_games: Counter = field(default_factory=Counter)
    seat_wins: Counter = field(default_factory=Counter)
    # --- динамика партии -----------------------------------------------------------------------
    leader_checks: Counter = field(default_factory=Counter)  # раунд-срез
    leader_won: Counter = field(default_factory=Counter)
    winner_rank_at: Counter = field(default_factory=Counter)  # (раунд-срез, место победителя)
    lead_changes: int = 0
    rank_gain: Counter = field(default_factory=Counter)  # место в начале раунда -> очки за раунд
    rank_gain_n: Counter = field(default_factory=Counter)
    curve_score: Counter = field(default_factory=Counter)  # (бот, раунд)
    curve_income: Counter = field(default_factory=Counter)
    curve_n: Counter = field(default_factory=Counter)
    # --- разнообразие победных стратегий -------------------------------------------------------
    build_games: Counter = field(default_factory=Counter)  # основной район
    build_wins: Counter = field(default_factory=Counter)
    winner_role: Counter = field(default_factory=Counter)
    winner_source: Counter = field(default_factory=Counter)
    # --- Oracle: ключ класс решения -------------------------------------------------------------
    oracle_considered: Counter = field(default_factory=Counter)
    oracle_best: Counter = field(default_factory=Counter)
    oracle_gap: Counter = field(default_factory=Counter)
    oracle_plan: Counter = field(default_factory=Counter)
    oracle_replans: int = 0
    # --- аномалии и самопроверки ---------------------------------------------------------------
    loops: Counter = field(default_factory=Counter)  # (бот, решение)
    loop_examples: list = field(default_factory=list)
    hoard_examples: list = field(default_factory=list)
    games_log: list = field(default_factory=list)
    settlements: int = 0
    settle_mismatch: int = 0
    seconds: Counter = field(default_factory=Counter)
    decisions: Counter = field(default_factory=Counter)
    # --- контрфактические развилки: ключ (решение, треть) ---------------------------------------
    cf_n: Counter = field(default_factory=Counter)
    cf_score: Counter = field(default_factory=Counter)
    cf_score_sq: Counter = field(default_factory=Counter)
    cf_rel: Counter = field(default_factory=Counter)
    cf_rel_sq: Counter = field(default_factory=Counter)
    cf_win: Counter = field(default_factory=Counter)
    cf_win_sq: Counter = field(default_factory=Counter)
    cf_seconds: float = 0.0

    def merge(self, other: Tally) -> None:
        for name, value in vars(other).items():
            mine = getattr(self, name)
            if isinstance(value, Counter):
                mine.update(value)
            elif isinstance(value, list):
                mine.extend(value)
            elif isinstance(value, (int, float)):
                setattr(self, name, mine + value)


def exit_value(points: float, money: float, influence: float) -> float:
    return points + money * MONEY_EXIT_RATE + influence * INFLUENCE_EXIT_RATE


# --- одна партия ---------------------------------------------------------------------------------


@dataclass
class _Game:
    """Состояние учёта одной партии, которое не сводится к счётчикам."""

    seed: int
    index: int
    policy_of: dict[str, str]
    live: dict[str, dict[str, Any]] = field(default_factory=dict)  # объекты у игроков, по uid
    market_since: dict[str, int] = field(default_factory=dict)  # uid слота рынка -> раунд появления
    per_turn: Counter = field(default_factory=Counter)
    standings: list[dict[str, int]] = field(default_factory=list)  # счёт после каждого раунда
    leader: str | None = None
    block: int = 0
    rotation: int = 0
    forks: int = 0


def play_game(engine: CityEngine, config: TournamentConfig, index: int) -> Tally:
    seed = tournament_seed(config, index)
    lineup = seating(config, index)
    setups = [
        PlayerSetup(id=f"seat-{seat}", name=f"{BOT_POLICY_NAMES[policy]} {seat}", is_bot=True, difficulty=policy)
        for seat, policy in enumerate(lineup, start=1)
    ]
    state = create_game_from_catalog(
        f"tournament-{index}",
        setups,
        seed=seed,
        settings=GameSettings(max_rounds=config.rounds, role_price=config.role_price),
    )
    game = _Game(seed=seed, index=index, policy_of={player.id: player.difficulty for player in state.players})
    game.block, game.rotation = block_of(config, index)
    tally = Tally(games=1)
    oracle.TELEMETRY = []
    oracle.forget_plans()
    _open_round(tally, game, state)
    # ~75 решений на игрока за партию: шанс развилки подобран под заданное среднее их число.
    fork_chance = config.forks / (75 * config.players) if config.forks else 0.0
    fork_rng = random.Random(f"fork:{config.seed}:{index}")
    focus = frozenset(config.fork_focus)

    while state.status == "playing":
        actor = state.current_player
        policy = game.policy_of[actor.id]
        bucket = bucket_of(state.round_number, config.rounds)
        transitions = engine.legal_transitions(state, actor.id)
        if not transitions:
            break
        for key in {action_key(state, actor, action) for action, _ in transitions}:
            tally.avail[(policy, key, bucket)] += 1
        for action, _ in transitions:
            if action["type"] == "buy_asset":
                tally.obj_offers[(policy, action_key(state, actor, action).split(":", 1)[1])] += 1

        seen = len(oracle.TELEMETRY)
        started = time.perf_counter()
        command = choose_bot_command(engine, state, actor.id, transitions).command
        tally.seconds[policy] += time.perf_counter() - started
        tally.decisions[policy] += 1
        for record in oracle.TELEMETRY[seen:]:
            _absorb_oracle(tally, state, actor, record)
        # Прицельный режим: подозрительное решение встречается редко, поэтому когда оно доступно,
        # развилка делается почти всегда, а в остальных позициях не делается вовсе.
        chance = fork_chance
        if focus:
            available = {action_key(state, actor, action) for action, _ in transitions}
            chance = FOCUS_FORK_CHANCE if available & focus else 0.0
        if chance and fork_rng.random() < chance:
            began = time.perf_counter()
            _fork(engine, tally, game, state, actor, transitions, command, bucket, fork_rng, focus)
            tally.cf_seconds += time.perf_counter() - began

        key = action_key(state, actor, {"type": command.type, "payload": dict(command.payload)})
        transition = engine.apply(state, command)
        after = transition.state
        tally.chosen[(policy, key, bucket)] += 1
        if any(event.type == "round_settled" for event in transition.events):
            # Закрывающая раунд команда несёт в себе доход всего стола, а не цену действия.
            tally.settling += 1
        else:
            _value_command(engine, tally, game, state, after, actor.id, command, (policy, key, bucket))

        if key not in REPEATABLE:
            game.per_turn[(actor.id, state.turn_serial, key)] += 1
            if game.per_turn[(actor.id, state.turn_serial, key)] == LOOP_REPEATS:
                tally.loops[(policy, key)] += 1
                if len(tally.loop_examples) < EXAMPLES:
                    tally.loop_examples.append(
                        {"seed": seed, "game": index, "round": state.round_number, "bot": policy, "action": key}
                    )
        _absorb_events(engine, tally, game, state, after, transition.events, key)
        state = after

    oracle.TELEMETRY = None
    _close_books(engine, tally, game, state, lineup, config)
    return tally


def _value_command(
    engine: CityEngine,
    tally: Tally,
    game: _Game,
    before: GameState,
    after: GameState,
    actor_id: str,
    command: Any,
    row: tuple[str, str, str],
) -> None:
    mine_before, mine_after = before.player_by_id(actor_id), after.player_by_id(actor_id)
    points = engine.score(mine_after) - engine.score(mine_before)
    money = mine_after.money - mine_before.money
    influence = mine_after.influence - mine_before.influence
    worth = exit_value(points, money, influence)
    tally.valued[row] += 1
    tally.actions[row] += _actions_consumed(before, after, actor_id, command)
    tally.self_pts[row] += points
    tally.self_money[row] += money
    tally.self_infl[row] += influence
    tally.self_scandals[row] += mine_after.scandals - mine_before.scandals
    tally.value[row] += worth
    tally.value_sq[row] += worth * worth
    if mine_after.roofs > mine_before.roofs:
        tally.roofs_gained[row[0]] += mine_after.roofs - mine_before.roofs
    for rival in before.players:
        if rival.id == actor_id:
            continue
        later = after.player_by_id(rival.id)
        change = {
            "pts": engine.score(later) - engine.score(rival),
            "money": later.money - rival.money,
            "infl": later.influence - rival.influence,
            "scandals": later.scandals - rival.scandals,
        }
        tally.rival_pts[row] += change["pts"]
        tally.rival_money[row] += change["money"]
        tally.rival_infl[row] += change["infl"]
        tally.rival_scandals[row] += change["scandals"]
        # Урон — только то, что соперник потерял: деньги, влияние, очки, полученные скандалы.
        harm = {
            "pts": max(0, -change["pts"]),
            "money": max(0, -change["money"]),
            "infl": max(0, -change["infl"]),
            "scandals": max(0, change["scandals"]),
        }
        victim = game.policy_of[rival.id]
        for kind, amount in harm.items():
            if amount:
                tally.dealt[(row[0], kind)] += amount
                tally.received[(victim, kind)] += amount


def _absorb_oracle(tally: Tally, state: GameState, actor: Any, record: dict[str, Any]) -> None:
    """Мнение Oracle: лучший доигранный план для каждого класса первого действия против лучшего вообще."""
    tally.oracle_replans += 1
    best_by_class: dict[str, float] = {}
    for first, value in record["rolled"]:
        key = action_key(state, actor, first)
        if value is not None and (key not in best_by_class or value > best_by_class[key]):
            best_by_class[key] = value
    if not best_by_class:
        return
    top = max(best_by_class.values())
    leader = max(best_by_class, key=lambda name: best_by_class[name])
    for key, value in best_by_class.items():
        tally.oracle_considered[key] += 1
        tally.oracle_gap[key] += top - value
    tally.oracle_best[leader] += 1
    for step in record["plan"]:
        tally.oracle_plan[action_key(state, actor, step)] += 1


def _open_round(tally: Tally, game: _Game, state: GameState) -> None:
    """Начало раунда: что стоит на рынке и на доске проектов."""
    _note_market(tally, game, state)
    for item in state.market:
        tally.mkt_slot_rounds[item.card_id] += 1
    for project_id in state.project_board:
        tally.proj_board_rounds[project_id] += 1


def _note_market(tally: Tally, game: _Game, state: GameState) -> None:
    """Карты, впервые вышедшие на рынок: при открытии раунда, после покупки, после пересдачи."""
    for item in state.market:
        if item.uid not in game.market_since:
            game.market_since[item.uid] = state.round_number
            tally.mkt_appear[item.card_id] += 1


def _absorb_events(
    engine: CityEngine,
    tally: Tally,
    game: _Game,
    before: GameState,
    after: GameState,
    events: list[Any],
    command_key: str,
) -> None:
    policy_of = game.policy_of
    current = before.current_player.id
    # Карты в руку приходят разными путями (покупка, «Лоббистский кабинет», «Рынок»), поэтому вытянутое
    # считается по разнице рук, а не по событиям: так ни один источник не потеряется.
    for player in after.players:
        old = {card.uid for card in before.player_by_id(player.id).hand}
        for card in player.hand:
            if card.uid not in old:
                tally.card_drawn[(policy_of[player.id], card.card_id)] += 1
    for event in events:
        data = event.data
        actor = str(event.actor_id) if event.actor_id else None
        policy = policy_of.get(actor or "", "?")
        if event.type == "asset_bought":
            card = str(data["asset_id"])
            uid = str(data["market_uid"])
            game.live[uid] = {"card": card, "policy": policy, "price": int(data["cost"]), "money": 0, "infl": 0}
            tally.obj_bought[(policy, card)] += 1
            tally.obj_price[(policy, card)] += int(data["cost"])
            tally.obj_round[(policy, card)] += before.round_number
            tally.mkt_bought[card] += 1
            tally.mkt_wait[card] += before.round_number - game.market_since.pop(uid, before.round_number)
        elif event.type == "asset_sold":
            item = game.live.pop(str(data["asset_uid"]), None)
            if item is not None:
                tally.obj_sold[(item["policy"], item["card"])] += 1
                _close_object(tally, item, points=0, refund=int(data["value"]))
        elif event.type == "market_rotated":
            for card in data.get("expired_asset_ids", []):
                tally.mkt_expired[str(card)] += 1
                game.market_since.pop(f"asset:{card}", None)
        elif event.type == "market_refreshed":
            tally.mkt_refreshed[str(data["asset_id"])] += 1
            game.market_since.pop(str(data["market_uid"]), None)
        elif event.type == "round_settled":
            _credit_settlement(engine, tally, game, before, data)
        elif event.type == "round_started":
            _record_standings(engine, tally, game, after)
            _open_round(tally, game, after)
        elif event.type == "project_board_rotated":
            tally.proj_expired[str(data["expired_project_id"])] += 1
        elif event.type == "city_project_taken":
            project_id = str(data["project_id"])
            row = (policy, project_id)
            tally.proj_taken[row] += 1
            tally.proj_round[row] += before.round_number
            tally.proj_cost_money[row] += int(data.get("cost_money", 0))
            tally.proj_cost_infl[row] += int(data.get("cost_influence", 0))
            tally.proj_points[row] += int(data.get("points", 0))
            project = engine.project(project_id)
            tally.proj_rivals_met[project_id] += sum(
                1 for other in before.players if other.id != actor and engine.project_requirement_met(other, project)
            )
        elif event.type == "action_card_played":
            tally.card_played[(policy, str(data["card_id"]))] += 1
        elif event.type == "action_card_converted":
            tally.card_converted[(policy, str(data["card_id"]))] += 1
        elif event.type == "targeted_effect_blocked":
            # Событие пишется от имени защитника: его Защита сработала. Карту или способность — тот, чей ход.
            if actor:
                tally.roofs_blocked[policy] += 1
            if data.get("card_id"):
                tally.card_blocked[(policy_of[current], str(data["card_id"]))] += 1
        elif event.type == "grey_operation_resolved":
            operation = str(data["asset_id"])
            role = before.player_by_id(actor).role if actor else None
            tally.grey_runs[(policy, operation)] += 1
            tally.grey_success[(policy, operation)] += int(bool(data.get("success")))
            tally.grey_blocked[(policy, operation)] += int(bool(data.get("blocked")))
            tally.grey_points[(policy, operation)] += int(data.get("points", 0))
            tally.grey_tiers[(operation, str(data.get("tier", "?")))] += 1
            tally.grey_modifier[(policy, operation)] += int(data.get("modifier", 0))
            tally.grey_by_role[(operation, role or "—")] += 1
        elif event.type == "role_claimed":
            role = str(data["role_id"])
            tally.role_claims[(policy, role)] += 1
            if data.get("previous_holder_id"):
                tally.role_takeovers[(policy, role)] += 1
                tally.role_lost[(role, "перекуплена соперником")] += 1
        elif event.type == "role_stripped" and data.get("role_id"):
            tally.role_lost[(str(data["role_id"]), f"снята соперником|{command_key}")] += 1
        elif event.type == "scandal_limit_reached" and data.get("role_id"):
            # Чья команда довела до предела: своя (роль съела сама себя) или соперника (атака).
            whose = "скандалы в свой ход" if actor == current else "скандалы от соперника"
            tally.role_lost[(str(data["role_id"]), f"{whose}|{command_key}")] += 1
        elif event.type == "player_jailed":
            tally.jailed[policy] += 1
        elif event.type == "turn_started" and actor:
            holder = after.player_by_id(actor)
            if holder.role:
                tally.role_turns[(policy, holder.role)] += 1
    _note_market(tally, game, after)


def _close_object(tally: Tally, item: dict[str, Any], *, points: int, refund: int) -> None:
    """Итог одной покупки: очки в конце (или возврат при продаже) + доход − цена, по курсам выхода."""
    net = exit_value(points, item["money"] + refund - item["price"], item["infl"])
    key = (item["policy"], item["card"])
    tally.obj_net[key] += net
    tally.obj_net_sq[key] += net * net
    tally.obj_closed[key] += 1


def _credit_settlement(engine: CityEngine, tally: Tally, game: _Game, before: GameState, data: dict[str, Any]) -> None:
    tally.settlements += 1
    sources = data.get("object_income_sources", {})
    for player_id, rows in sources.items():
        player = before.player_by_id(player_id)
        claimed = int(data["income_sources"][player_id]["objects"])
        attributed = 0
        owned = {asset.uid: asset for asset in player.assets}
        for uid, row in rows.items():
            money = int(row["printed"]) + int(row["synergy"])
            attributed += money
            item = game.live.get(uid)
            if item is None:
                continue
            key = (item["policy"], item["card"])
            influence = int(engine.owned_yield(before, player, owned[uid])["influence"]) if uid in owned else 0
            item["money"] += money
            item["infl"] += influence
            tally.obj_slot_rounds[key] += 1
            tally.obj_money[key] += money
            tally.obj_infl[key] += influence
        # Движок выплатил одно число, отчёт разложил его по объектам: если не сходится, разложение врёт.
        if attributed != claimed:
            tally.settle_mismatch += 1


def _record_standings(
    engine: CityEngine, tally: Tally, game: _Game, state: GameState, closed: int | None = None
) -> None:
    """Счёт после закрытого раунда: кривые по ботам, смены лидера и кто сколько набрал с какого места."""
    scores = {player.id: engine.score(player) for player in state.players}
    closed = state.round_number - 1 if closed is None else closed
    if game.standings:
        previous = game.standings[-1]
        ranked = sorted(previous, key=lambda pid: -previous[pid])
        for rank, pid in enumerate(ranked, start=1):
            tally.rank_gain[rank] += scores[pid] - previous[pid]
            tally.rank_gain_n[rank] += 1
    game.standings.append(scores)
    leader = max(scores, key=lambda pid: scores[pid])
    if game.leader is not None and leader != game.leader and scores[leader] > scores[game.leader]:
        tally.lead_changes += 1
    game.leader = leader
    for player in state.players:
        policy = game.policy_of[player.id]
        money_rate, _influence_rate = engine._round_rates(state, player)
        tally.curve_score[(policy, closed)] += scores[player.id]
        tally.curve_income[(policy, closed)] += money_rate
        tally.curve_n[(policy, closed)] += 1


def _main_district(engine: CityEngine, player: PlayerState) -> str:
    counts = Counter(engine.owned_definition(owned).district for owned in player.assets)
    return counts.most_common(1)[0][0] if counts else "—"


def _close_books(
    engine: CityEngine,
    tally: Tally,
    game: _Game,
    state: GameState,
    lineup: tuple[str, ...],
    config: TournamentConfig,
) -> None:
    if state.status != "finished":
        return
    policy_of = game.policy_of
    winner = engine.ranking(state)[0]
    scores = {player.id: engine.score(player) for player in state.players}
    for seat, player in enumerate(state.players, start=1):
        policy = policy_of[player.id]
        won = int(player.id == winner.id)
        score = scores[player.id]
        tally.seats[policy] += 1
        tally.wins[policy] += won
        tally.score_sum[policy] += score
        tally.score_sq[policy] += score * score
        tally.seat_games[seat] += 1
        tally.seat_wins[seat] += won
        breakdown = engine.score_breakdown(player)
        for part in SCORE_PARTS:
            tally.parts[(policy, part)] += breakdown[part]
            if won:
                tally.winner_parts[part] += breakdown[part]
        tally.leftover[(policy, "money")] += player.money
        tally.leftover[(policy, "influence")] += player.influence
        tally.roofs_end[policy] += player.roofs
        if player.role:
            tally.role_final[(policy, player.role)] += 1
            tally.role_final_wins[(policy, player.role)] += won
        district = _main_district(engine, player)
        tally.build_games[district] += 1
        tally.build_wins[district] += won
        if won:
            tally.winner_role[player.role or "—"] += 1
            tally.winner_source[max(("assets", "projects", "bonus"), key=lambda part: breakdown[part])] += 1
        for card in {owned.card_id for owned in player.assets}:
            tally.obj_owner_games[(policy, card)] += 1
            tally.obj_owner_wins[(policy, card)] += won
        for held in player.hand:
            tally.card_end_hand[(policy, held.card_id)] += 1
        hoard = player.money >= HOARD_MONEY or player.influence >= HOARD_INFLUENCE
        if hoard and len(tally.hoard_examples) < EXAMPLES:
            tally.hoard_examples.append(
                {
                    "seed": game.seed,
                    "game": game.index,
                    "bot": policy,
                    "money": player.money,
                    "influence": player.influence,
                }
            )
    # Объекты, дожившие до конца партии, закрываются своими очками.
    for player in state.players:
        for owned in player.assets:
            item = game.live.pop(owned.uid, None)
            if item is not None:
                _close_object(tally, item, points=engine.asset_value(owned), refund=0)
    # Последний раунд закрывается без события начала следующего: его положение снимается здесь.
    _record_standings(engine, tally, game, state, closed=state.round_number)
    _record_dynamics(tally, game, winner.id, config)
    ordered = sorted(scores.values(), reverse=True)
    tally.games_log.append(
        {
            "game": game.index,
            "seed": game.seed,
            "lineup": list(lineup),
            "scores": {policy_of[pid]: value for pid, value in scores.items()},
            "winner": policy_of[winner.id],
            "winner_seat": next(seat for seat, player in enumerate(state.players, start=1) if player.id == winner.id),
            "block": game.block,
            "rotation": game.rotation,
            "margin": ordered[0] - ordered[1] if len(ordered) > 1 else 0,
        }
    )


def _record_dynamics(tally: Tally, game: _Game, winner_id: str, config: TournamentConfig) -> None:
    """Решена ли партия к середине: держит ли лидер среза отрыв и откуда приходит победитель."""
    for checkpoint in checkpoints(config.rounds):
        if checkpoint > len(game.standings):
            continue
        scores = game.standings[checkpoint - 1]
        ranked = sorted(scores, key=lambda pid: -scores[pid])
        tally.leader_checks[checkpoint] += 1
        tally.leader_won[checkpoint] += int(ranked[0] == winner_id)
        tally.winner_rank_at[(checkpoint, ranked.index(winner_id) + 1)] += 1


# --- контрфактические развилки -------------------------------------------------------------------

# Классы решений, которые стоит проверять развилкой: контент и экономика, а не служебные ходы.
FORK_KINDS = (
    "buy_asset",
    "city_project",
    "play_action_card",
    "grey_operation",
    "claim_role",
    "use_role_power",
    "buy_action_card",
    "buy_roof",
    "buy_capacity",
    "basic_action",
    "crisis_pr",
)
SEARCHING = frozenset({"ledger", "oracle", "atlas"})
# Шанс развилки в прицельном режиме, когда подозрительное решение доступно в позиции.
FOCUS_FORK_CHANCE = 0.5
CONTINUATION_BUDGET = 0.03
CONTINUATION_WIDTHS = (3, 2)


def _fork(
    engine: CityEngine,
    tally: Tally,
    game: _Game,
    state: GameState,
    actor: PlayerState,
    transitions: list[tuple[dict[str, Any], Any]],
    chosen: Any,
    bucket: str,
    rng: random.Random,
    focus: frozenset[str] = frozenset(),
) -> None:
    """Развилка: вариант X против хода, который выбрал бот, обе ветки доиграны до конца.

    Обе ветки начинаются из одной позиции, доигрываются одними и теми же политиками и при бросках,
    привязанных к позиции, а не к потоку: разница финала объясняется одной развилкой. Ledger и Oracle
    в продолжении играют быстрым Ledger — Oracle слишком медленный для сотен доигрываний, — Reborn и
    Boris играют сами за себя. Ценность получается «в руках игрока этого уровня».
    """
    chosen_key = action_key(state, actor, {"type": chosen.type, "payload": dict(chosen.payload)})
    classes: dict[str, list[dict[str, Any]]] = {}
    for action, _ in transitions:
        if action["type"] not in FORK_KINDS:
            continue
        key = action_key(state, actor, action)
        if focus and key not in focus:
            continue
        if key != chosen_key:
            classes.setdefault(key, []).append(action)
    if not classes:
        return
    key = rng.choice(sorted(classes))
    alternative = rng.choice(classes[key])
    game.forks += 1
    tag = f"{state.game_id}:fork{game.forks}"
    picked = {"type": chosen.type, "payload": dict(chosen.payload)}
    outcomes = [
        _play_out(engine, state, actor.id, first, game.policy_of, f"{tag}{branch}", tag)
        for branch, first in (("a", alternative), ("b", picked))
    ]
    (score_a, rel_a, win_a), (score_b, rel_b, win_b) = outcomes
    row = (key, bucket)
    for name, diff in (("score", score_a - score_b), ("rel", rel_a - rel_b), ("win", win_a - win_b)):
        getattr(tally, f"cf_{name}")[row] += diff
        getattr(tally, f"cf_{name}_sq")[row] += diff * diff
    tally.cf_n[row] += 1


def _play_out(
    engine: CityEngine,
    start: GameState,
    player_id: str,
    first: dict[str, Any],
    policy_of: dict[str, str],
    game_id: str,
    luck: str,
) -> tuple[float, float, float]:
    """Доиграть ветку и вернуть (счёт игрока, счёт относительно среднего соперника, 1/0 победа)."""
    from city_bots.ledger import choose_ledger_command
    from city_engine.commands import Command

    state = start.clone()
    # Своё имя партии у ветки: кэши планов Oracle и Boris привязаны к нему и не должны смешаться.
    state.game_id = game_id
    command = Command(type=str(first["type"]), actor_id=player_id, payload=dict(first.get("payload") or {}))
    state = engine.apply(state, command).state
    for _ in range(4000):
        if state.status != "playing":
            break
        actor = state.current_player
        position = f"{luck}:{state.round_number}:{state.turn_serial}:{actor.id}:{state.actions_left}"
        state.rng.state = zlib.crc32(position.encode()) or 1
        if policy_of[actor.id] in SEARCHING:
            action, _value, _alternatives = choose_ledger_command(
                engine, state, actor.id, budget=CONTINUATION_BUDGET, widths=CONTINUATION_WIDTHS
            )
            command = Command(type=action["type"], actor_id=actor.id, payload=dict(action.get("payload") or {}))
        else:
            command = choose_bot_command(engine, state, actor.id).command
        state = engine.apply(state, command).state
    me = state.player_by_id(player_id)
    mine = engine.score(me)
    rivals = [engine.score(other) for other in state.players if other.id != player_id]
    won = float(engine.ranking(state)[0].id == player_id) if state.status == "finished" else 0.0
    return float(mine), mine - sum(rivals) / max(1, len(rivals)), won


# --- прогон --------------------------------------------------------------------------------------

_ENGINE: CityEngine | None = None


def _run_one(config: TournamentConfig, index: int) -> Tally:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = CityEngine()
    return play_game(_ENGINE, config, index)


def run_tournament(config: TournamentConfig, progress: bool = True) -> Tally:
    total = Tally()
    started = time.perf_counter()
    if config.workers <= 1:
        for index in range(config.games):
            total.merge(_run_one(config, index))
            if progress:
                _progress(index + 1, config.games, started)
        return total
    with ProcessPoolExecutor(max_workers=config.workers) as pool:
        futures = [pool.submit(_run_one, config, index) for index in range(config.games)]
        for done, future in enumerate(as_completed(futures), start=1):
            total.merge(future.result())
            if progress:
                _progress(done, config.games, started)
    return total


def _progress(done: int, games: int, started: float) -> None:
    elapsed = time.perf_counter() - started
    print(f"[{done}/{games}] {elapsed:.0f}s", file=sys.stderr, flush=True)


def machine_report(tally: Tally, config: TournamentConfig) -> dict[str, Any]:
    def plain(counter: Counter) -> dict[str, float]:
        return {
            "|".join(map(str, key)) if isinstance(key, tuple) else str(key): value for key, value in counter.items()
        }

    payload: dict[str, Any] = {
        "config": {
            "games": config.games,
            "players": config.players,
            "rounds": config.rounds,
            "role_price": config.role_price,
            "lineup": list(config.lineup),
            "seed": config.seed,
            "rotations": config.rotations,
            "forks": config.forks,
            "fork_focus": list(config.fork_focus),
        }
    }
    for name, value in vars(tally).items():
        payload[name] = plain(value) if isinstance(value, Counter) else value
    return payload


def main(argv: list[str] | None = None) -> int:
    from simulation.tournament_report import render

    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--games", type=int, default=24)
    parser.add_argument("--players", type=int, default=4)
    parser.add_argument("--rounds", type=int, default=15)
    parser.add_argument("--role-price", type=int, default=3)
    parser.add_argument("--lineup", default=",".join(DEFAULT_LINEUP))
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--rotations", type=int, default=4, help="повторов одной раздачи с поворотом рассадки")
    parser.add_argument("--forks", type=float, default=8.0, help="контрфактических развилок в среднем на партию")
    parser.add_argument("--fork-focus", help="файл с ключами решений (simulation.suspects): развилки только в них")
    parser.add_argument("--output", default="TOURNAMENT_RESULTS.md")
    args = parser.parse_args(argv)
    config = TournamentConfig(
        games=args.games,
        players=args.players,
        rounds=args.rounds,
        role_price=args.role_price,
        lineup=tuple(item.strip() for item in args.lineup.split(",") if item.strip()),
        seed=args.seed,
        workers=args.workers,
        rotations=args.rotations,
        forks=args.forks,
        fork_focus=tuple(
            line.strip() for line in Path(args.fork_focus).read_text(encoding="utf-8").splitlines() if line.strip()
        )
        if args.fork_focus
        else (),
    )
    tally = run_tournament(config)
    output = Path(args.output)
    # The counters first: they are the hours of play, the report is a view of them. A render that
    # fails (a catalog changed on disk mid-run, 2026-10-02) used to take 17 hours of forks with it.
    output.with_suffix(".json").write_text(
        json.dumps(machine_report(tally, config), ensure_ascii=False, indent=1, default=str), encoding="utf-8"
    )
    output.write_text(render(tally, config), encoding="utf-8")
    print(f"Отчёт: {output} ({tally.games} партий)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
