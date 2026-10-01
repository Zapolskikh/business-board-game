"""Подозрительные решения из JSON турнира — список для прицельных контрфактических развилок.

Читает ``TOURNAMENT_*.json`` (``simulation.tournament``), находит решения, которые выглядят сломанными
или мёртвыми, и пишет их ключи по одному на строку. Этот файл потом отдаётся турниру через
``--fork-focus``: развилки идут только в эти решения, и каждое получает десятки сравнений вместо пяти.

Что считается подозрительным (каждый критерий — со своей квотой, чтобы один не съел весь список):

* **ценность за действие** значимо выше или ниже среднего по своему типу решения (объект, карта,
  проект, роль, способность, серая операция);
* **отдача объекта** значимо выше или ниже средней покупки;
* **лифт победы** владельца объекта значимо отличается от нуля;
* **мёртвое**: решение было доступно сотни раз, а выбрано почти никогда.

Запуск::

    python -m simulation.suspects TOURNAMENT_4p.json --output=suspects.txt --limit=30
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

# Сколько ключей каждого критерия брать, не больше.
QUOTA = {"value_high": 6, "value_low": 6, "object_high": 4, "object_low": 4, "lift": 4, "dead": 6}
MIN_OBSERVATIONS = 30
DEAD_AVAILABLE = 200
DEAD_PICK_RATE = 0.03
# Решения, которые не про контент: их развилки ничего не скажут о балансе.
SKIP = ("end_turn", "sell_asset:", "convert_action_card:", "market_refresh", "basic_action:work")


def _sum_by(counter: dict[str, float], position: int = 1) -> dict[str, float]:
    """Сложить счётчик вида «бот|ключ[|треть]» по ключу."""
    totals: dict[str, float] = defaultdict(float)
    for name, value in counter.items():
        parts = name.split("|")
        if len(parts) > position:
            totals[parts[position]] += float(value)
    return totals


def _family(key: str) -> str:
    return key.split(":", 1)[0]


def _mean_se(total: float, square: float, count: float) -> tuple[float, float]:
    if count < 2:
        return float("nan"), float("inf")
    mean = total / count
    variance = max(0.0, (square - count * mean * mean) / (count - 1))
    return mean, math.sqrt(variance / count)


def find_suspects(report: dict[str, Any], limit: int = 30) -> list[tuple[str, str]]:
    """(ключ решения, причина) — самые подозрительные первыми внутри каждого критерия."""
    valued = _sum_by(report["valued"])
    value = _sum_by(report["value"])
    value_sq = _sum_by(report["value_sq"])
    actions = _sum_by(report["actions"])
    chosen = _sum_by(report["chosen"])
    avail = _sum_by(report["avail"])
    picks: list[tuple[str, str]] = []

    # 1. Ценность за действие против своего семейства решений.
    stats: dict[str, tuple[float, float]] = {}
    for key, count in valued.items():
        if count < MIN_OBSERVATIONS or key.startswith(SKIP):
            continue
        mean, se = _mean_se(value[key], value_sq[key], count)
        per_action = count / actions[key] if actions.get(key) else 1.0
        stats[key] = (mean * per_action, se * per_action)
    by_family: dict[str, list[str]] = defaultdict(list)
    for key in stats:
        by_family[_family(key)].append(key)
    deviations = []
    for keys in by_family.values():
        if len(keys) < 3:
            continue
        average = sum(stats[key][0] for key in keys) / len(keys)
        for key in keys:
            mean, se = stats[key]
            if math.isfinite(se) and se > 0:
                deviations.append(((mean - average) / se, key, mean))
    high = sorted((item for item in deviations if item[0] >= 2), reverse=True)
    low = sorted(item for item in deviations if item[0] <= -2)
    picks += [
        (key, f"ценность {mean:+.2f} за действие, значимо выше своего типа")
        for _z, key, mean in high[: QUOTA["value_high"]]
    ]
    picks += [
        (key, f"ценность {mean:+.2f} за действие, значимо ниже своего типа")
        for _z, key, mean in low[: QUOTA["value_low"]]
    ]

    # 2. Отдача объекта с покупки против средней покупки.
    net = _sum_by(report["obj_net"])
    net_sq = _sum_by(report["obj_net_sq"])
    closed = _sum_by(report["obj_closed"])
    overall = sum(net.values()) / max(1.0, sum(closed.values()))
    objects = []
    for card, count in closed.items():
        mean, se = _mean_se(net[card], net_sq[card], count)
        if count >= MIN_OBSERVATIONS and math.isfinite(se) and se > 0:
            objects.append(((mean - overall) / se, card, mean))
    objects.sort(reverse=True)
    picks += [
        (f"buy_asset:{card}", f"отдача {mean:.1f} очка с покупки, выше средней {overall:.1f}")
        for z, card, mean in objects
        if z >= 2
    ][: QUOTA["object_high"]]
    picks += [
        (f"buy_asset:{card}", f"отдача {mean:.1f} очка с покупки, ниже средней {overall:.1f}")
        for z, card, mean in reversed(objects)
        if z <= -2
    ][: QUOTA["object_low"]]

    # 3. Лифт победы владельца внутри бота.
    seats = {name: float(value) for name, value in report["seats"].items()}
    wins = {name: float(value) for name, value in report["wins"].items()}
    owner_games: dict[str, dict[str, float]] = defaultdict(dict)
    owner_wins: dict[str, dict[str, float]] = defaultdict(dict)
    for name, value in report["obj_owner_games"].items():
        bot, card = name.split("|")
        owner_games[card][bot] = float(value)
    for name, value in report["obj_owner_wins"].items():
        bot, card = name.split("|")
        owner_wins[card][bot] = float(value)
    lifts = []
    for card, games_by_bot in owner_games.items():
        lifted = weight = variance = 0.0
        for bot, games in games_by_bot.items():
            if games < 1 or not seats.get(bot):
                continue
            rate = owner_wins[card].get(bot, 0.0) / games
            lifted += (rate - wins.get(bot, 0.0) / seats[bot]) * games
            variance += games * max(rate * (1 - rate), 1 / (games + 2))
            weight += games
        if weight >= MIN_OBSERVATIONS:
            lift, se = lifted / weight, math.sqrt(variance) / weight
            if abs(lift) >= 2 * se:
                lifts.append((abs(lift) / se, card, lift))
    lifts.sort(reverse=True)
    picks += [
        (f"buy_asset:{card}", f"владелец выигрывает на {100 * lift:+.0f} п.п. чаще")
        for _z, card, lift in lifts[: QUOTA["lift"]]
    ]

    # 4. Мёртвое: доступно часто, выбирается почти никогда.
    dead = []
    for key, available in avail.items():
        if available >= DEAD_AVAILABLE and not key.startswith(SKIP):
            rate = chosen.get(key, 0.0) / available
            if rate < DEAD_PICK_RATE:
                dead.append((rate, key, available))
    dead.sort()
    picks += [
        (key, f"выбрано в {100 * rate:.1f}% из {int(available)} доступных")
        for rate, key, available in dead[: QUOTA["dead"]]
    ]

    unique: dict[str, str] = {}
    for key, reason in picks:
        unique.setdefault(key, reason)
    return list(unique.items())[:limit]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("report", help="JSON турнира (TOURNAMENT_*.json)")
    parser.add_argument("--output", default="suspects.txt")
    parser.add_argument("--limit", type=int, default=30)
    args = parser.parse_args(argv)
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    suspects = find_suspects(report, args.limit)
    output = Path(args.output)
    output.write_text("".join(f"{key}\n" for key, _reason in suspects), encoding="utf-8")
    output.with_suffix(".md").write_text(
        "# Подозрительные решения\n\n" + "".join(f"- `{key}` — {reason}\n" for key, reason in suspects),
        encoding="utf-8",
    )
    print(f"{len(suspects)} подозрительных решений: {output} (причины — {output.with_suffix('.md')})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
