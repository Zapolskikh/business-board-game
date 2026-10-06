"""Аномалии и кандидаты в аномалии из JSON турнира — и список для прицельных развилок.

Цель балансировки — не свести все решения к одной ценности, а вылечить аномалии. Поэтому здесь нет
сравнения «со средним по своему типу»: на сотнях партий значимо отличается от среднего почти всё, и
такой критерий тянул бы игру к медиане. Вместо него — **абсолютные границы** в очках финала (партия
кончается около 105–120 очков, действие по норме стоит 2).

Аномалия — решение, у которого выполнены все три условия:

1. **эффект большой** — за границей из таблицы ниже;
2. **эффект надёжный** — за границей лежит весь 95% интервал, а развилок не меньше ``MIN_FORKS``;
3. **эффект устойчивый** — тот же знак в смешанном столе и в контрольных, либо в прицельных развилках.

Этот модуль проверяет первые два по одному отчёту. Третье — дело сводки: она сверяет столы.

Границы (развилка — «относительно стола», в очках финала):

* **обязательный выбор** — развилка ≥ ``MUST_PICK``, или лифт победы владельца ≥ ``LIFT`` у трёх ботов;
* **ловушка** — развилка ≤ ``TRAP``, и при этом решение выбирают (не реже ``DEAD_PICK_RATE``);
* **мёртвый контент** — выбрано реже ``DEAD_PICK_RATE`` из ``DEAD_AVAILABLE``+ доступностей и развилка
  ≤ ``DEAD_FORK``;
* **слепая зона ботов** (не баланс) — выбрано так же редко, но развилка ≥ ``BLIND_FORK``;
* **карта** — ≥ ``CARD_STRONG`` очков за розыгрыш, или 0 очков и сброс ≥ ``CARD_DISCARD``;
* **роль** — лифт финала за ±``ROLE_LIFT`` с одним знаком у двух и более ботов;
* **место за столом** — доля побед вне ``SEAT_RANGE``;
* **снежный ком** — лидер после второй трети партии побеждает чаще ``SNOWBALL``.

Всё, что внутри границ, — статистика, без выводов. Решение, у которого эффект большой, но интервал
ещё задевает границу или развилок мало, попадает в **«наблюдать»** — это и есть список для
``--fork-focus``: там оно получит свои развилки.

Запуск::

    python -m simulation.suspects TOURNAMENT_4p.json --output=suspects.txt --limit=40
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

MUST_PICK = 6.0
TRAP = -5.0
DEAD_FORK = -3.0
BLIND_FORK = 3.0
LIFT = 0.10
ROLE_LIFT = 0.08
CARD_STRONG = 5.0
CARD_DISCARD = 0.40
SEAT_RANGE = (0.20, 0.30)
SNOWBALL = 0.70
MIN_FORKS = 50
# С какого размера эффекта решение стоит прицельных развилок, пока интервал широк.
WATCH_FORK = 3.0
WATCH_MIN_FORKS = 4
DEAD_AVAILABLE = 200
DEAD_PICK_RATE = 0.03
MIN_OWNER_GAMES = 30
MIN_ROLE_FINALS = 10
# Решения, которые не про контент: их развилки ничего не скажут о балансе.
SKIP = ("end_turn", "sell_asset:", "convert_action_card:", "market_refresh", "basic_action:work")


def _by_key(counter: dict[str, float], position: int) -> dict[str, float]:
    """Сложить счётчик вида «…|ключ|…» по части с номером ``position``."""
    totals: dict[str, float] = defaultdict(float)
    for name, value in counter.items():
        parts = name.split("|")
        if len(parts) > position:
            totals[parts[position]] += float(value)
    return totals


def _mean_se(total: float, square: float, count: float) -> tuple[float, float]:
    if count < 2:
        return (total / count if count else float("nan")), float("inf")
    mean = total / count
    variance = max(0.0, (square - count * mean * mean) / (count - 1))
    return mean, math.sqrt(variance / count)


def _forks(report: dict[str, Any]) -> dict[str, tuple[float, float, int]]:
    """Развилки по решению: (среднее «относительно стола», стандартная ошибка, число)."""
    count = _by_key(report.get("cf_n", {}), 0)
    total = _by_key(report.get("cf_rel", {}), 0)
    square = _by_key(report.get("cf_rel_sq", {}), 0)
    return {key: (*_mean_se(total[key], square[key], n), int(n)) for key, n in count.items() if n}


def _lifts(report: dict[str, Any], games: str, wins: str) -> dict[str, list[tuple[str, float, float]]]:
    """Лифт победы внутри бота: предмет -> [(бот, лифт, число партий)]."""
    seats = {name: float(value) for name, value in report["seats"].items()}
    base = {name: float(report["wins"].get(name, 0)) / seats[name] for name in seats if seats[name]}
    won = {name: float(value) for name, value in report[wins].items()}
    rows: dict[str, list[tuple[str, float, float]]] = defaultdict(list)
    for name, value in report[games].items():
        bot, item = name.split("|")
        if bot in base and float(value) > 0:
            rows[item].append((bot, won.get(name, 0.0) / float(value) - base[bot], float(value)))
    return rows


def classify(report: dict[str, Any]) -> dict[str, list[tuple[str, str]]]:
    """Три списка (ключ, причина): аномалии, наблюдать, слепые зоны ботов."""
    anomalies: list[tuple[str, str]] = []
    watch: list[tuple[float, str, str]] = []
    blind: list[tuple[str, str]] = []

    avail = _by_key(report["avail"], 1)
    chosen = _by_key(report["chosen"], 1)
    forks = _forks(report)

    def pick_rate(key: str) -> float | None:
        return chosen.get(key, 0.0) / avail[key] if avail.get(key, 0.0) >= DEAD_AVAILABLE else None

    # --- развилки: обязательный выбор, ловушка, мёртвое, слепая зона ---------------------------
    for key, (mean, se, n) in forks.items():
        if key.startswith(SKIP) or not math.isfinite(mean):
            continue
        low, high = mean - 1.96 * se, mean + 1.96 * se
        rate = pick_rate(key)
        rare = rate is not None and rate < DEAD_PICK_RATE
        shown = f"развилка {mean:+.1f} ± {1.96 * se:.1f} ({n})" if math.isfinite(se) else f"развилка {mean:+.1f} ({n})"
        solid = n >= MIN_FORKS
        if rare and solid and low >= BLIND_FORK:
            blind.append((key, f"выбрано в {100 * rate:.1f}% случаев, но {shown}: боты не видят хода"))
        elif rare and solid and high <= DEAD_FORK:
            anomalies.append((key, f"мёртвое: выбрано в {100 * rate:.1f}% случаев и {shown}"))
        elif not rare and solid and low >= MUST_PICK:
            anomalies.append((key, f"обязательный выбор: {shown}"))
        elif not rare and solid and high <= TRAP:
            anomalies.append((key, f"ловушка: {shown}"))
        elif n >= WATCH_MIN_FORKS and abs(mean) >= WATCH_FORK and not (solid and low < 0 < high):
            # Эффект большой, но развилок мало или интервал ещё задевает границу.
            weight = abs(mean) / se if math.isfinite(se) and se > 0 else abs(mean)
            watch.append((weight, key, f"{shown} — нужны прицельные развилки"))

    # --- мёртвое по выбору, пока без развилок ---------------------------------------------------
    for key, available in avail.items():
        if available < DEAD_AVAILABLE or key.startswith(SKIP) or key in forks and forks[key][2] >= MIN_FORKS:
            continue
        rate = chosen.get(key, 0.0) / available
        if rate < DEAD_PICK_RATE:
            watch.append((1.0, key, f"выбрано в {100 * rate:.1f}% из {int(available)} доступных — мёртвое или слепая зона"))

    # --- лифт победы владельца объекта у трёх ботов ---------------------------------------------
    for card, rows in _lifts(report, "obj_owner_games", "obj_owner_wins").items():
        strong = [row for row in rows if row[2] >= MIN_OWNER_GAMES and row[1] >= LIFT]
        if len(strong) >= 3:
            anomalies.append((f"buy_asset:{card}", f"обязательный выбор: лифт победы ≥ {100 * LIFT:.0f} п.п. у {len(strong)} ботов"))
        elif len(strong) == 2:
            watch.append((2.0, f"buy_asset:{card}", "лифт победы ≥ 10 п.п. у двух ботов"))

    # --- роли -----------------------------------------------------------------------------------
    for role, rows in _lifts(report, "role_final", "role_final_wins").items():
        counted = [row for row in rows if row[2] >= MIN_ROLE_FINALS]
        for sign, label in ((1, "сильная"), (-1, "слабая")):
            same = [row for row in counted if sign * row[1] >= ROLE_LIFT]
            if len(same) >= 2:
                detail = ", ".join(f"{bot} {100 * lift:+.0f} п.п." for bot, lift, _games in same)
                anomalies.append((f"claim_role:{role}", f"роль {label}: лифт финала {detail}"))

    # --- карты ----------------------------------------------------------------------------------
    valued = _by_key(report["valued"], 1)
    value = _by_key(report["value"], 1)
    drawn = _by_key(report["card_drawn"], 1)
    converted = _by_key(report["card_converted"], 1)
    for card, count in drawn.items():
        key = f"play_action_card:{card}"
        plays = valued.get(key, 0.0)
        worth = value.get(key, 0.0) / plays if plays else 0.0
        if plays >= MIN_OWNER_GAMES and worth >= CARD_STRONG:
            anomalies.append((key, f"карта: {worth:.1f} очка за розыгрыш ({int(plays)})"))
        elif count >= DEAD_AVAILABLE and abs(worth) < 0.05 and converted.get(card, 0.0) / count >= CARD_DISCARD:
            watch.append((1.5, key, f"карта: 0 очков за розыгрыш, сброшена в {100 * converted[card] / count:.0f}% случаев"))

    # --- стол -----------------------------------------------------------------------------------
    table: list[tuple[str, str]] = []
    for seat, games in report.get("seat_games", {}).items():
        share = float(report.get("seat_wins", {}).get(seat, 0)) / float(games) if games else 0.0
        margin = 1.96 * math.sqrt(share * (1 - share) / float(games)) if games else 0.0
        if share + margin < SEAT_RANGE[0] or share - margin > SEAT_RANGE[1]:
            table.append((f"seat:{seat}", f"место {seat}: {100 * share:.1f}% побед, вне {SEAT_RANGE[0]:.0%}–{SEAT_RANGE[1]:.0%}"))
    checks = {name: float(value) for name, value in report.get("leader_checks", {}).items()}
    for name, total in checks.items():
        share = float(report.get("leader_won", {}).get(name, 0)) / total if total else 0.0
        if name == max(checks, key=lambda item: int(item) if item.isdigit() else 0) and share > SNOWBALL:
            table.append((f"leader:{name}", f"снежный ком: лидер после раунда {name} побеждает в {100 * share:.0f}%"))

    watch.sort(key=lambda item: (-item[0], item[1]))
    seen: set[str] = set()
    unique_watch: list[tuple[str, str]] = []
    for _weight, key, reason in watch:
        if key not in seen and key not in {item[0] for item in anomalies}:
            seen.add(key)
            unique_watch.append((key, reason))
    return {"anomalies": anomalies + table, "watch": unique_watch, "blind": blind}


def find_suspects(report: dict[str, Any], limit: int = 40) -> list[tuple[str, str]]:
    """Список для прицельных развилок: «наблюдать», затем аномалии, которым ещё нужна проверка."""
    found = classify(report)
    forkable = [item for item in found["anomalies"] if ":" in item[0] and not item[0].startswith(("seat:", "leader:"))]
    return [*found["watch"], *forkable][:limit]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("report", help="JSON турнира (TOURNAMENT_*.json)")
    parser.add_argument("--output", default="suspects.txt")
    parser.add_argument("--limit", type=int, default=40)
    args = parser.parse_args(argv)
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    found = classify(report)
    suspects = find_suspects(report, args.limit)
    output = Path(args.output)
    output.write_text("".join(f"{key}\n" for key, _reason in suspects), encoding="utf-8")
    sections = (
        ("Аномалии (эффект большой и надёжный в этом отчёте; устойчивость — по другим столам)", found["anomalies"]),
        ("Наблюдать (эффект большой, но данных мало — в прицельные развилки)", found["watch"]),
        ("Слепые зоны ботов (ход хороший, боты его не делают — не баланс)", found["blind"]),
    )
    lines = ["# Подозрительные решения", ""]
    for title, rows in sections:
        lines += [f"## {title}", ""]
        lines += [f"- `{key}` — {reason}" for key, reason in rows] or ["- нет"]
        lines.append("")
    output.with_suffix(".md").write_text("\n".join(lines), encoding="utf-8")
    print(
        f"аномалий: {len(found['anomalies'])}, наблюдать: {len(found['watch'])}, слепых зон: {len(found['blind'])}; "
        f"в прицельные развилки — {len(suspects)}: {output} (причины — {output.with_suffix('.md')})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
