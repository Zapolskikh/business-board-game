"""Отчёт турнира стратегий: игровые названия, доверительные интервалы и пометка значимости.

Каждое число, по которому делается вывод, идёт с 95% интервалом и одной из трёх пометок:

* **значимо** — эффект больше двух стандартных ошибок: при этом объёме случайностью он почти не
  объясняется;
* **тенденция** — от одной до двух ошибок: направление вероятно, величина не установлена;
* **шум** — меньше одной ошибки: из этих данных вывода нет.

Доли — интервал Уилсона. Средние — нормальное приближение по наблюдениям (ошибка партий между собой не
коррелирована, наблюдения внутри партии — слабо; интервалы поэтому чуть оптимистичны, а не наоборот).
"""

# ruff: noqa: E501 — строки Markdown-таблиц отчёта читаются целиком, а не по кускам

from __future__ import annotations

import itertools
import math
from collections import Counter, defaultdict

from city_bots.policy import BOT_POLICY_NAMES
from city_engine.constants import ACTION_CARD_COST
from city_engine.engine import CityEngine
from simulation.balance import ANCHORS, BUCKETS, MONEY_EXIT_RATE
from simulation.names import Names
from simulation.tournament import (
    HOARD_INFLUENCE,
    HOARD_MONEY,
    INFLUENCE_EXIT_RATE,
    LOOP_REPEATS,
    SCORE_PARTS,
    Tally,
    TournamentConfig,
    checkpoints,
)

PARTS = {"assets": "Объекты", "projects": "Проекты", "bonus": "Бонусы", "role": "Роль", "scandals": "Скандалы"}
THIRDS = {"early": "начало", "mid": "середина", "late": "конец"}
REQUIREMENTS = {
    "none": "без условия",
    "district_objects": "объекты района",
    "tag_objects": "объекты с признаком",
    "assets": "число объектов",
    "distinct_districts": "разные районы",
    "district_depth": "глубина района",
    "role": "любая роль",
    "max_scandals": "мало скандалов",
}
HARM = {"money": "$", "infl": "◆", "pts": "очки", "scandals": "скандалы"}
# Порог «подозрительно сильного» действия: вдвое выше лучшего калибровочного якоря за действие.
STRONG_ACTION_VALUE = 2 * max(ANCHORS.values())


# --- статистика ----------------------------------------------------------------------------------


def wilson(hits: float, trials: float) -> tuple[float, float]:
    if trials <= 0:
        return 0.0, 1.0
    z = 1.96
    p = hits / trials
    centre = (p + z * z / (2 * trials)) / (1 + z * z / trials)
    half = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / (1 + z * z / trials)
    return max(0.0, centre - half), min(1.0, centre + half)


def mean_se(total: float, total_sq: float, count: float) -> tuple[float, float]:
    if count <= 0:
        return float("nan"), float("nan")
    mean = total / count
    if count < 2:
        return mean, float("inf")
    variance = max(0.0, (total_sq - count * mean * mean) / (count - 1))
    return mean, math.sqrt(variance / count)


def verdict(effect: float, se: float) -> str:
    if not math.isfinite(effect) or not math.isfinite(se):
        return "мало данных"
    if se == 0:
        return "значимо" if effect else "шум"
    z = abs(effect) / se
    return "**значимо**" if z >= 2 else "тенденция" if z >= 1 else "шум"


def rate_verdict(hits: float, trials: float, expected: float) -> str:
    if trials < 5:
        return "мало данных"
    p = hits / trials
    se = math.sqrt(max(expected * (1 - expected), 1e-9) / trials)
    return verdict(p - expected, se)


def pct(part: float, whole: float) -> str:
    return f"{100 * part / whole:.1f}%" if whole else "—"


def pct_ci(hits: float, trials: float) -> str:
    if not trials:
        return "—"
    low, high = wilson(hits, trials)
    return f"{100 * hits / trials:.1f}% [{100 * low:.0f}–{100 * high:.0f}]"


def num(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}" if math.isfinite(value) else "—"


def num_ci(mean: float, se: float, digits: int = 1) -> str:
    if not math.isfinite(mean):
        return "—"
    if not math.isfinite(se):
        return num(mean, digits)
    return f"{mean:.{digits}f} ± {1.96 * se:.{digits}f}"


def ratio(part: float, whole: float, digits: int = 1) -> str:
    return num(part / whole, digits) if whole else "—"


def total(counter: Counter, policy: str | None = None, key: str | None = None, bucket: str | None = None) -> float:
    """Сумма по ключам вида (бот, предмет[, треть]) с фильтрами."""
    result = 0.0
    for name, value in counter.items():
        if policy is not None and name[0] != policy:
            continue
        if key is not None and name[1] != key:
            continue
        if bucket is not None and name[2] != bucket:
            continue
        result += value
    return result


def keys_of(counter: Counter) -> list[str]:
    return sorted({name[1] for name in counter})


# --- отчёт ---------------------------------------------------------------------------------------


def render(tally: Tally, config: TournamentConfig) -> str:
    engine = CityEngine()
    names = Names(engine)
    bots = list(dict.fromkeys(config.lineup))
    bot_names = {bot: BOT_POLICY_NAMES.get(bot, bot) for bot in bots}
    lines = [
        "# Турнир стратегий: баланс «Города влияния»",
        "",
        f"Партий: {tally.games} · игроков: {config.players} · раундов: {config.rounds} · цена роли: "
        f"{config.role_price}◆ · сид: {config.seed}",
        f"Состав: {', '.join(bot_names[bot] for bot in bots)}; рассадка перебирает все порядки мест.",
        "",
        "### Как читать",
        "",
        "- Ценность считается в очках. Деньги и влияние переводятся в очки по их выходам: "
        f"{MONEY_EXIT_RATE:.2f} очка за $ (патронаж) и {INFLUENCE_EXIT_RATE:.2f} за ◆ (лоббирование).",
        "- В квадратных скобках и после «±» — 95% доверительный интервал.",
        "- **значимо** — эффект больше двух стандартных ошибок; «тенденция» — от одной до двух; «шум» — "
        "из этих данных вывода нет. Выводы делаются только по «значимо».",
        "- «Выбор» — доля решений, где вариант был доступен (легален и по карману) и его взяли.",
        "",
    ]
    lines += _bots(tally, bots, bot_names)
    lines += _seats(tally, config)
    lines += _deals(tally, bots, bot_names, config)
    lines += _dynamics(tally, bots, bot_names, config)
    lines += _diversity(tally, names)
    lines += _objects(engine, tally, names, bots, bot_names)
    lines += _market(engine, tally, names)
    lines += _projects(engine, tally, names, bots, bot_names)
    lines += _cards(engine, tally, names, bots, bot_names)
    lines += _grey(tally, names, bots, bot_names)
    lines += _roles(tally, names, bots, bot_names)
    lines += _interaction(tally, names, bots, bot_names)
    lines += _basic(tally, names, bots, bot_names)
    lines += _decisions(tally, names, bots, bot_names)
    lines += _thirds(tally, names)
    lines += _counterfactual(tally, names)
    lines += _oracle(tally, names)
    lines += _anomalies(engine, tally, names, bots, bot_names)
    lines += _checks(tally)
    lines += _glossary(names)
    return "\n".join(lines) + "\n"


def _bots(tally: Tally, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    share = 1 / max(1, len(bots))
    lines = [
        "## Боты",
        "",
        "| Бот | Мест | Побед | Против равной доли | Средний счёт | Остаток $ | Остаток ◆ | Тюрьма за партию | Время на решение |",
        "|---|---:|---:|---|---:|---:|---:|---:|---:|",
    ]
    for bot in bots:
        seats = tally.seats[bot]
        mean, se = mean_se(tally.score_sum[bot], tally.score_sq[bot], seats)
        lines.append(
            f"| {bot_names[bot]} | {seats} | {pct_ci(tally.wins[bot], seats)} | {rate_verdict(tally.wins[bot], seats, share)} | "
            f"{num_ci(mean, se)} | {ratio(tally.leftover[(bot, 'money')], seats)} | {ratio(tally.leftover[(bot, 'influence')], seats)} | "
            f"{ratio(tally.jailed[bot], seats, 2)} | {ratio(tally.seconds[bot] * 1000, tally.decisions[bot])} мс |"
        )
    lines += ["", "Из чего складывается счёт (в среднем за партию):", ""]
    lines += ["| Бот | " + " | ".join(PARTS[part] for part in SCORE_PARTS) + " |", "|---|" + "---:|" * len(SCORE_PARTS)]
    for bot in bots:
        seats = tally.seats[bot]
        lines.append(
            f"| {bot_names[bot]} | " + " | ".join(ratio(tally.parts[(bot, part)], seats) for part in SCORE_PARTS) + " |"
        )
    winners = sum(tally.wins.values())
    lines.append(
        "| **Победитель** | " + " | ".join(ratio(tally.winner_parts[part], winners) for part in SCORE_PARTS) + " |"
    )
    return [*lines, ""]


def _seats(tally: Tally, config: TournamentConfig) -> list[str]:
    share = 1 / config.players
    lines = [
        "## Места за столом",
        "",
        f"Ожидаемая доля побед для честного места — {100 * share:.0f}%.",
        "",
        "| Место | Партий | Побед | Отклонение |",
        "|---|---:|---:|---|",
    ]
    for seat in sorted(tally.seat_games):
        lines.append(
            f"| {seat} | {tally.seat_games[seat]} | {pct_ci(tally.seat_wins[seat], tally.seat_games[seat])} | "
            f"{rate_verdict(tally.seat_wins[seat], tally.seat_games[seat], share)} |"
        )
    margins = [game["margin"] for game in tally.games_log]
    if margins:
        lines += [
            "",
            f"Средний отрыв победителя: {sum(margins) / len(margins):.1f} очка; ничьих: {sum(1 for value in margins if value == 0)}.",
        ]
    return [*lines, ""]


def _expected_top_share(draws: int, categories: int) -> float:
    """Средняя доля самого частого исхода среди ``draws`` равновероятных: базовая линия «случайности»."""
    total_share = 0.0
    outcomes = list(itertools.product(range(categories), repeat=draws))
    for outcome in outcomes:
        total_share += max(Counter(outcome).values()) / draws
    return total_share / len(outcomes)


def _deals(tally: Tally, bots: list[str], bot_names: dict[str, str], config: TournamentConfig) -> list[str]:
    """Удача раздачи против мастерства: каждая раздача сыграна всеми ботами со всех мест."""
    blocks: dict[int, list[dict]] = defaultdict(list)
    for game in tally.games_log:
        blocks[game.get("block", game["game"])].append(game)
    complete = [games for games in blocks.values() if len(games) == config.rotations]
    if config.rotations < 2 or len(complete) < 2:
        return []
    rotations = config.rotations
    bot_top = sum(max(Counter(game["winner"] for game in games).values()) for games in complete) / (
        len(complete) * rotations
    )
    seat_top = sum(max(Counter(game["winner_seat"] for game in games).values()) for games in complete) / (
        len(complete) * rotations
    )
    baseline = _expected_top_share(rotations, config.players)
    # Разброс счёта: какая его доля объясняется самой раздачей (общий уровень стола), а не игрой.
    scores = [value for games in complete for game in games for value in game["scores"].values()]
    grand = sum(scores) / len(scores)
    total_var = sum((value - grand) ** 2 for value in scores) / len(scores)
    block_means = [
        sum(value for game in games for value in game["scores"].values()) / (rotations * config.players)
        for games in complete
    ]
    between = sum((mean - grand) ** 2 for mean in block_means) / len(block_means)
    lines = [
        "## Раздачи и удача",
        "",
        f"Каждая раздача сыграна {rotations} раза с поворотом рассадки: каждый бот посидел на каждом месте одной и той же "
        f"раздачи. Раздач: {len(complete)}.",
        "",
        f"- Доля разброса счёта, которую объясняет сама раздача (насколько щедрым был стол): **{100 * between / total_var:.0f}%**. "
        "Остальное — игра и места.",
        f"- Один и тот же **бот** выигрывает раздачу в среднем в {100 * bot_top:.0f}% её повторов; при чистой случайности было бы {100 * baseline:.0f}%. "
        "Чем выше, тем больше исход определяет мастерство.",
        f"- Одно и то же **место** выигрывает раздачу в {100 * seat_top:.0f}% повторов (случайность — {100 * baseline:.0f}%). "
        "Заметно выше случайности — раздача дарит победу месту, а не игроку.",
        "",
        "Разница счёта бота со средним столом внутри одной раздачи (удача раздачи вычтена):",
        "",
        "| Бот | Разница внутри раздачи | Вывод |",
        "|---|---:|---|",
    ]
    for bot in bots:
        diffs = []
        for games in complete:
            mine = [game["scores"][bot] for game in games if bot in game["scores"]]
            table = [value for game in games for value in game["scores"].values()]
            if mine:
                diffs.append(sum(mine) / len(mine) - sum(table) / len(table))
        mean, se = mean_se(sum(diffs), sum(value * value for value in diffs), len(diffs))
        lines.append(f"| {bot_names[bot]} | {num_ci(mean, se)} | {verdict(mean, se)} |")
    return [*lines, ""]


def _dynamics(tally: Tally, bots: list[str], bot_names: dict[str, str], config: TournamentConfig) -> list[str]:
    games = max(1, tally.games)
    lines = [
        "## Динамика партии",
        "",
        "Насколько исход решён заранее. Если лидер середины почти всегда побеждает, а последний никогда не "
        "отыгрывается, игра линейна и камбэка нет.",
        "",
        "| Срез | Лидер среза побеждает | Победитель был на месте 1 | 2 | 3 | 4 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for checkpoint in checkpoints(config.rounds):
        checks = tally.leader_checks[checkpoint]
        ranks = [tally.winner_rank_at[(checkpoint, rank)] for rank in range(1, config.players + 1)]
        lines.append(
            f"| после раунда {checkpoint} | {pct_ci(tally.leader_won[checkpoint], checks)} | "
            + " | ".join(pct(count, checks) for count in ranks)
            + " |"
        )
    lines += [
        "",
        f"Смен лидера за партию в среднем: {tally.lead_changes / games:.1f}. Случайный порядок дал бы "
        f"{100 / config.players:.0f}% в колонке «лидер среза побеждает»; 100% — исход решён к срезу.",
        "",
        "Отыгрывание: сколько очков в среднем набирает за раунд игрок с каждого места в начале раунда. Если "
        "отстающие набирают больше лидера, механика догоняющих (отстающий ходит первым) работает.",
        "",
        "| Место в начале раунда | Очков за раунд |",
        "|---|---:|",
    ]
    for rank in sorted(tally.rank_gain_n):
        lines.append(f"| {rank} | {ratio(tally.rank_gain[rank], tally.rank_gain_n[rank], 2)} |")
    rounds = sorted({closed for _bot, closed in tally.curve_n})
    shown = [closed for closed in rounds if closed % 3 == 0 or closed == rounds[-1]] if rounds else []
    if shown:
        lines += ["", "Кривая счёта (в среднем после раунда) и дохода $ за раунд:", ""]
        lines += [
            "| Бот | "
            + " | ".join(f"Р{closed} очки" for closed in shown)
            + " | "
            + " | ".join(f"Р{closed} доход" for closed in shown)
            + " |"
        ]
        lines += ["|---|" + "---:|" * (2 * len(shown))]
        for bot in bots:
            scores = [ratio(tally.curve_score[(bot, closed)], tally.curve_n[(bot, closed)], 0) for closed in shown]
            income = [ratio(tally.curve_income[(bot, closed)], tally.curve_n[(bot, closed)], 0) for closed in shown]
            lines.append(f"| {bot_names[bot]} | " + " | ".join(scores) + " | " + " | ".join(income) + " |")
    return [*lines, ""]


def _diversity(tally: Tally, names: Names) -> list[str]:
    winners = max(1, sum(tally.winner_role.values()))
    players = sum(tally.build_games.values())
    lines = [
        "## Разнообразие победных стратегий",
        "",
        "Здоровая игра выигрывается разными путями. Основной район — где у игрока больше всего объектов к концу.",
        "",
        "| Основной район | Игроков | Доля среди победителей | Побед у строивших его | Против среднего |",
        "|---|---:|---:|---:|---|",
    ]
    base = sum(tally.build_wins.values()) / players if players else 0.0
    for district in sorted(tally.build_games, key=lambda name: -tally.build_games[name]):
        games = tally.build_games[district]
        lines.append(
            f"| {names.district(district) if district != '—' else 'без объектов'} | {games} | {pct(tally.build_wins[district], winners)} | "
            f"{pct_ci(tally.build_wins[district], games)} | {rate_verdict(tally.build_wins[district], games, base)} |"
        )
    lines += ["", "| Роль победителя в конце | Доля |", "|---|---:|"]
    for role, count in tally.winner_role.most_common():
        lines.append(f"| {names.role(role)} | {pct(count, winners)} |")
    lines += ["", "| Главный источник очков победителя | Доля |", "|---|---:|"]
    for part, count in tally.winner_source.most_common():
        lines.append(f"| {PARTS[part]} | {pct(count, winners)} |")
    shares = [count / winners for count in tally.build_wins.values() if count]
    entropy = -sum(share * math.log(share) for share in shares)
    if shares:
        lines += [
            "",
            f"Разнообразие районов победителей: {math.exp(entropy):.1f} «равноценных путей» из {len(names.districts)} возможных.",
        ]
    return [*lines, ""]


def _object_value(tally: Tally, card: str) -> tuple[float, float, float]:
    count = total(tally.obj_closed, None, card)
    mean, se = mean_se(total(tally.obj_net, None, card), total(tally.obj_net_sq, None, card), count)
    return mean, se, count


def _lift(tally: Tally, bots: list[str], card: str) -> tuple[float, float]:
    """Насколько чаще выигрывает владелец, чем этот же бот в среднем, и ошибка этой разницы."""
    lifted, weight, variance = 0.0, 0.0, 0.0
    for bot in bots:
        games = tally.obj_owner_games[(bot, card)]
        if not games or not tally.seats[bot]:
            continue
        rate = tally.obj_owner_wins[(bot, card)] / games
        lifted += (rate - tally.wins[bot] / tally.seats[bot]) * games
        variance += games * max(rate * (1 - rate), 1 / (games + 2))
        weight += games
    if not weight:
        return float("nan"), float("nan")
    return lifted / weight, math.sqrt(variance) / weight


def _objects(engine: CityEngine, tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    cards = list(engine.catalog.assets)
    closed_total = sum(tally.obj_closed.values())
    overall = sum(tally.obj_net.values()) / closed_total if closed_total else 0.0
    rows = []
    for card in cards:
        mean, se, count = _object_value(tally, card)
        rows.append((card, mean, se, count))
    lines = [
        "## Объекты рынка",
        "",
        "«Отдача» — чистые очки с одной покупки: очки объекта в конце (или возврат при продаже) + доход деньгами и "
        "влиянием − цена, по курсам выхода. **Особые эффекты** (дополнительное действие, Защита, обход условия "
        "проекта, бесплатная карта, снижение скандалов, бонус при покупке) в отдачу не входят — их силу показывают "
        "выбор, лифт и мнение Oracle. «Лифт» — насколько чаще выигрывает владелец, чем тот же бот в среднем.",
        "",
        f"Средняя отдача покупки по всем объектам: {overall:.1f} очка. Значимость отдачи — отличие от этого среднего.",
        "",
    ]
    strong = [row for row in rows if row[3] >= 10 and math.isfinite(row[2]) and row[1] - overall > 2 * row[2]]
    weak = [row for row in rows if row[3] >= 10 and math.isfinite(row[2]) and overall - row[1] > 2 * row[2]]
    lines.append(
        "**Значимо выше среднего:** "
        + (", ".join(f"{names.asset(row[0])} ({row[1]:.1f})" for row in sorted(strong, key=lambda r: -r[1])) or "нет")
    )
    lines.append("")
    lines.append(
        "**Значимо ниже среднего:** "
        + (", ".join(f"{names.asset(row[0])} ({row[1]:.1f})" for row in sorted(weak, key=lambda r: r[1])) or "нет")
    )
    lines.append("")
    header = (
        "| Объект | Район | Редкость | Цена | Куплен | Выбор | "
        + " | ".join(f"Выбор: {bot_names[bot]}" for bot in bots)
        + " | Раунд покупки | $ за раунд | ◆ за раунд | Продан | Отдача | Отдача: вывод | Лифт победы | Лифт: вывод |"
    )
    lines += [header, "|---|---|---|" + "---:|" * (3 + len(bots) + 5) + "---|---:|---|"]
    for card, mean, se, count in sorted(rows, key=lambda row: -(row[1] if math.isfinite(row[1]) else -99)):
        asset = engine.asset(card)
        bought = total(tally.obj_bought, None, card)
        offers = total(tally.obj_offers, None, card)
        picks = " | ".join(pct(total(tally.obj_bought, bot, card), total(tally.obj_offers, bot, card)) for bot in bots)
        slot_rounds = total(tally.obj_slot_rounds, None, card)
        lift, lift_se = _lift(tally, bots, card)
        lines.append(
            f"| {names.asset(card)} | {names.district(asset.district)} | {names.rarity(asset.rarity)} | {asset.cost} | {int(bought)} | "
            f"{pct_ci(bought, offers)} | {picks} | {ratio(total(tally.obj_round, None, card), bought)} | "
            f"{ratio(total(tally.obj_money, None, card), slot_rounds, 2)} | {ratio(total(tally.obj_infl, None, card), slot_rounds, 2)} | "
            f"{pct(total(tally.obj_sold, None, card), bought)} | {num_ci(mean, se)} | {verdict(mean - overall, se) if count >= 10 else 'мало данных'} | "
            f"{num_ci(100 * lift, 100 * lift_se)} п.п. | {verdict(lift, lift_se)} |"
        )
    return [*lines, ""]


def _market(engine: CityEngine, tally: Tally, names: Names) -> list[str]:
    lines = [
        "## Показ на рынке",
        "",
        "Отделяет «редко покупают» от «редко бывает на рынке». «Ушёл непроданным» — доля появлений, закончившихся "
        "ротацией рынка без покупки; «Пересдан» — сколько раз его убрали «Маркет-мейкером».",
        "",
        "| Объект | Редкость | Появлений | Раундов на рынке | Куплен | Куплен из появлений | Ушёл непроданным | Пересдан | Ждал до покупки, раундов |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    rarity_order = {name: index for index, name in enumerate(engine.catalog.rarity_min_round)}
    for card in sorted(
        engine.catalog.assets, key=lambda card: (rarity_order[engine.asset(card).rarity], -tally.mkt_appear[card])
    ):
        appear = tally.mkt_appear[card]
        bought = tally.mkt_bought[card]
        lines.append(
            f"| {names.asset(card)} | {names.rarity(engine.asset(card).rarity)} | {appear} | {tally.mkt_slot_rounds[card]} | {bought} | "
            f"{pct_ci(bought, appear)} | {pct(tally.mkt_expired[card], appear)} | {tally.mkt_refreshed[card]} | {ratio(tally.mkt_wait[card], bought)} |"
        )
    never = [names.asset(card) for card in engine.catalog.assets if tally.mkt_appear[card] == 0]
    if never:
        lines += ["", "**Ни разу не вышли на рынок:** " + ", ".join(never)]
    return [*lines, ""]


def _projects(engine: CityEngine, tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    lines = [
        "## Проекты",
        "",
        "«Доступен» — решений, где проект можно было взять (условие выполнено и хватает ресурсов). «Чистые очки» — "
        "очки минус цена по курсам выхода. «Спорность» — сколько соперников в момент взятия тоже могли его взять.",
        "",
        "| Проект | Очки | Условие | Раундов на доске | Ушёл с доски | Доступен | Взят | Взят из доступных | "
        + " | ".join(bot_names[bot] for bot in bots)
        + " | Раунд | Цена $ | Цена ◆ | Чистые очки | Спорность |",
        "|---|---:|---|" + "---:|" * (10 + len(bots)),
    ]
    rows = []
    for project_id in engine.catalog.projects:
        project = engine.project(project_id)
        taken = total(tally.proj_taken, None, project_id)
        key = f"city_project:{project_id}"
        chosen, avail = total(tally.chosen, None, key), total(tally.avail, None, key)
        cost_money, cost_infl = (
            total(tally.proj_cost_money, None, project_id),
            total(tally.proj_cost_infl, None, project_id),
        )
        net = (
            (
                total(tally.proj_points, None, project_id)
                - cost_money * MONEY_EXIT_RATE
                - cost_infl * INFLUENCE_EXIT_RATE
            )
            / taken
            if taken
            else float("nan")
        )
        rows.append((project_id, project, taken, chosen, avail, cost_money, cost_infl, net))
    for project_id, project, taken, chosen, avail, cost_money, cost_infl, net in sorted(
        rows, key=lambda row: -(row[7] if math.isfinite(row[7]) else -99)
    ):
        by_bot = " | ".join(str(int(total(tally.proj_taken, bot, project_id))) for bot in bots)
        requirement = REQUIREMENTS.get(
            str(project.requirement.get("type", "none")), str(project.requirement.get("type"))
        )
        lines.append(
            f"| {names.project(project_id)} | {project.points} | {requirement} | {tally.proj_board_rounds[project_id]} | "
            f"{tally.proj_expired[project_id]} | {int(avail)} | {int(taken)} | {pct_ci(chosen, avail)} | {by_bot} | "
            f"{ratio(total(tally.proj_round, None, project_id), taken)} | {ratio(cost_money, taken)} | {ratio(cost_infl, taken)} | "
            f"{num(net)} | {ratio(tally.proj_rivals_met[project_id], taken, 2)} |"
        )
    never = [names.project(row[0]) for row in rows if row[2] == 0 and tally.proj_board_rounds[row[0]] >= 10]
    if never:
        lines += ["", "**Стоял на доске, но не взят ни разу:** " + ", ".join(never)]
    return [*lines, ""]


def _cards(engine: CityEngine, tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    purchases = total(tally.chosen, None, "buy_action_card")
    gained = 0.0
    for key in keys_of(tally.valued):
        if key.startswith(("play_action_card:", "convert_action_card:")):
            gained += total(tally.value, None, key)
    drawn = sum(tally.card_drawn.values())
    per_card = gained / drawn if drawn else 0.0
    # The price from the rules, not a copy: a hard-coded 6$ kept printing 2.10 after the cards fell to 4$.
    cost = ACTION_CARD_COST * MONEY_EXIT_RATE + INFLUENCE_EXIT_RATE
    lines = [
        "## Карты действий",
        "",
        f"Покупок карт: {int(purchases)}, вытянуто карт всего (включая бесплатные): {int(drawn)}. Карта в среднем принесла "
        f"{per_card:.2f} очка, покупка из двух карт — {2 * per_card:.2f} при цене {cost:.2f} очка ресурсами плюс действие.",
        "",
        "«Ценность» — очки игравшего + его деньги и влияние по курсам выхода, за розыгрыш. Урон соперникам — суммарно по всем.",
        "",
        "| Карта | Вытянута | Сыграна | Сброшена | Осталась в руке | Погашена Защитой | "
        + " | ".join(f"Сыграл {bot_names[bot]}" for bot in bots)
        + " | Ценность себе | Очки соперникам | $ соперникам | ◆ соперникам | Скандалов соперникам |",
        "|---|" + "---:|" * (10 + len(bots)),
    ]
    rows = []
    for card_id in engine.catalog.action_cards:
        key = f"play_action_card:{card_id}"
        valued = total(tally.valued, None, key)
        mean, se = mean_se(total(tally.value, None, key), total(tally.value_sq, None, key), valued)
        rows.append((card_id, key, valued, mean, se))
    for card_id, key, valued, mean, se in sorted(rows, key=lambda row: -(row[3] if math.isfinite(row[3]) else -99)):
        by_bot = " | ".join(str(int(total(tally.card_played, bot, card_id))) for bot in bots)
        lines.append(
            f"| {names.card(card_id)} | {int(total(tally.card_drawn, None, card_id))} | {int(total(tally.card_played, None, card_id))} | "
            f"{int(total(tally.card_converted, None, card_id))} | {int(total(tally.card_end_hand, None, card_id))} | "
            f"{int(total(tally.card_blocked, None, card_id))} | {by_bot} | {num_ci(mean, se, 2)} | "
            f"{ratio(total(tally.rival_pts, None, key), valued, 2)} | {ratio(total(tally.rival_money, None, key), valued)} | "
            f"{ratio(total(tally.rival_infl, None, key), valued)} | {ratio(total(tally.rival_scandals, None, key), valued, 2)} |"
        )
    return [*lines, ""]


def _grey(tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    lines = [
        "## Серые операции",
        "",
        "Кубик: грани 1–2 — провал, 3–4 — слабый эффект, 5–6 — полный (после модификаторов роли и карт).",
        "",
        "| Операция | Запусков | "
        + " | ".join(bot_names[bot] for bot in bots)
        + " | Провал | Слабый | Полный | Средний модификатор | Погашена Защитой | Ценность себе за действие | Скандалов себе | Очки соперникам | $ соперникам | ◆ соперникам |",
        "|---|" + "---:|" * (11 + len(bots)),
    ]
    for operation in keys_of(tally.grey_runs):
        runs = total(tally.grey_runs, None, operation)
        key = f"grey_operation:{operation}"
        valued = total(tally.valued, None, key)
        mean, se = mean_se(total(tally.value, None, key), total(tally.value_sq, None, key), valued)
        by_bot = " | ".join(str(int(total(tally.grey_runs, bot, operation))) for bot in bots)
        tiers = " | ".join(pct(tally.grey_tiers[(operation, tier)], runs) for tier in ("fail", "weak", "full"))
        lines.append(
            f"| {names.grey(operation)} | {int(runs)} | {by_bot} | {tiers} | {ratio(total(tally.grey_modifier, None, operation), runs, 2)} | "
            f"{pct(total(tally.grey_blocked, None, operation), runs)} | "
            f"{num_ci(mean, se, 2)} | {ratio(total(tally.self_scandals, None, key), valued, 2)} | {ratio(total(tally.rival_pts, None, key), valued, 2)} | "
            f"{ratio(total(tally.rival_money, None, key), valued)} | {ratio(total(tally.rival_infl, None, key), valued)} |"
        )
    roles = sorted({role for _operation, role in tally.grey_by_role})
    if roles:
        lines += [
            "",
            "Кто запускает (роль в момент запуска):",
            "",
            "| Операция | " + " | ".join(names.role(role) for role in roles) + " |",
            "|---|" + "---:|" * len(roles),
        ]
        for operation in keys_of(tally.grey_runs):
            lines.append(
                f"| {names.grey(operation)} | "
                + " | ".join(str(tally.grey_by_role[(operation, role)]) for role in roles)
                + " |"
            )
    return [*lines, ""]


def _roles(tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    roles = sorted({role for _bot, role in tally.role_claims} | {role for _bot, role in tally.role_turns})
    lines = [
        "## Роли",
        "",
        "«Лифт финала» — насколько чаще выигрывает финальный владелец роли, чем тот же бот в среднем.",
        "",
        "| Роль | Захватов | Перекупов | Ходов с ролью | "
        + " | ".join(f"Ходов: {bot_names[bot]}" for bot in bots)
        + " | Потерь | Потерь на захват | Финальных владельцев | Лифт финала | Вывод |",
        "|---|" + "---:|" * (7 + len(bots)) + "---|",
    ]
    for role in roles:
        by_bot = " | ".join(str(int(total(tally.role_turns, bot, role))) for bot in bots)
        lifted, weight, variance = 0.0, 0.0, 0.0
        for bot in bots:
            games = tally.role_final[(bot, role)]
            if games and tally.seats[bot]:
                rate = tally.role_final_wins[(bot, role)] / games
                lifted += (rate - tally.wins[bot] / tally.seats[bot]) * games
                variance += games * max(rate * (1 - rate), 1 / (games + 2))
                weight += games
        lift, lift_se = (lifted / weight, math.sqrt(variance) / weight) if weight else (float("nan"), float("nan"))
        claims = total(tally.role_claims, None, role)
        lost = sum(count for (lost_role, _cause), count in tally.role_lost.items() if lost_role == role)
        lines.append(
            f"| {names.role(role)} | {int(claims)} | {int(total(tally.role_takeovers, None, role))} | {int(total(tally.role_turns, None, role))} | "
            f"{by_bot} | {lost} | {ratio(lost, claims, 2)} | {int(total(tally.role_final, None, role))} | "
            f"{num_ci(100 * lift, 100 * lift_se)} п.п. | {verdict(lift, lift_se)} |"
        )
    lines += [
        "",
        "Причины потери роли (что именно её отняло):",
        "",
        "| Роль | Причина | Решение, после которого потеряна | Случаев |",
        "|---|---|---|---:|",
    ]
    for role in roles:
        causes = sorted(
            ((cause, count) for (lost_role, cause), count in tally.role_lost.items() if lost_role == role),
            key=lambda item: -item[1],
        )
        for cause, count in causes[:5]:
            reason, _, command = cause.partition("|")
            lines.append(f"| {names.role(role)} | {reason} | {names.decision(command) if command else '—'} | {count} |")
    rounds = sum(value for (_bot, kind), value in tally.journalist_income.items() if kind == "rounds")
    if rounds:
        lines += [
            "",
            "Доход Журналиста по источникам, за оплаченный раунд с ролью: деньги — за чужие скандалы (нужен объект "
            "Делового центра), рейтинг — влияние за свои (нужен объект Спального района).",
            "",
            "| Бот | Раундов с ролью | $ за раунд | ◆ за раунд |",
            "|---|---:|---:|---:|",
        ]
        for bot in [*bots, None]:
            have = total(tally.journalist_income, bot, "rounds")
            if have:
                lines.append(
                    f"| {bot_names[bot] if bot else '**Все**'} | {int(have)} | "
                    f"{ratio(total(tally.journalist_income, bot, 'money'), have, 2)} | "
                    f"{ratio(total(tally.journalist_income, bot, 'rating'), have, 2)} |"
                )
    return [*lines, ""]


def _interaction(tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    lines = [
        "## Взаимодействие и защита",
        "",
        "Урон — только потерянное соперником (деньги, влияние, очки) и полученные им скандалы, в среднем за партию.",
        "",
        "| Бот | Нанёс $ | Нанёс ◆ | Нанёс очков | Нанёс скандалов | Получил $ | Получил ◆ | Получил очков | Получил скандалов |",
        "|---|" + "---:|" * 8,
    ]
    for bot in bots:
        seats = tally.seats[bot]
        dealt = [ratio(tally.dealt[(bot, kind)], seats) for kind in HARM]
        received = [ratio(tally.received[(bot, kind)], seats) for kind in HARM]
        lines.append(f"| {bot_names[bot]} | " + " | ".join(dealt) + " | " + " | ".join(received) + " |")
    lines += [
        "",
        "Защита: сколько получено за партию, сколько ударов погашено и сколько осталось неиспользованной к концу.",
        "",
        "| Бот | Получено Защит | Погашено ударов | Ударов на одну Защиту | Осталось к концу |",
        "|---|---:|---:|---:|---:|",
    ]
    for bot in bots:
        seats = tally.seats[bot]
        lines.append(
            f"| {bot_names[bot]} | {ratio(tally.roofs_gained[bot], seats, 2)} | {ratio(tally.roofs_blocked[bot], seats, 2)} | "
            f"{ratio(tally.roofs_blocked[bot], tally.roofs_gained[bot], 2)} | {ratio(tally.roofs_end[bot], seats, 2)} |"
        )
    lost = sum(tally.roofs_lost.values())
    if lost:
        lines += [
            "",
            "Чем сняты Защиты соперников: решение, после которого жетон пропал (погашенный удар, отъём или пробой).",
            "",
            "| Решение | Снято Защит | Доля | За партию |",
            "|---|---:|---:|---:|",
        ]
        for command, count in sorted(tally.roofs_lost.items(), key=lambda item: (-item[1], item[0]))[:12]:
            lines.append(
                f"| {names.decision(command)} | {int(count)} | {pct(count, lost)} | {ratio(count, tally.games, 2)} |"
            )
    return [*lines, ""]


def _basic(tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    lines = [
        "## Базовые действия и калибровка",
        "",
        "Патронаж и лоббирование обязаны давать ровно свой курс в очках: если нет, измерение врёт.",
        "",
        "| Действие | Ожидаемо очков | Измерено | " + " | ".join(f"Раз: {bot_names[bot]}" for bot in bots) + " |",
        "|---|---:|---:|" + "---:|" * len(bots),
    ]
    for key, expected in ANCHORS.items():
        valued = total(tally.valued, None, key)
        by_bot = " | ".join(str(int(total(tally.chosen, bot, key))) for bot in bots)
        lines.append(
            f"| {names.decision(key)} | {expected:.2f} | {ratio(total(tally.self_pts, None, key), valued, 3)} | {by_bot} |"
        )
    return [*lines, ""]


def _decisions(tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    lines = [
        "## Все решения",
        "",
        "Ценность — очки + деньги и влияние по курсам выхода, за одно потраченное действие (бесплатные — за использование).",
        "",
        "| Решение | Выбрано | Выбор | " + " | ".join(bot_names[bot] for bot in bots) + " | Ценность за действие |",
        "|---|---:|---:|" + "---:|" * (len(bots) + 1),
    ]
    rows = []
    for key in keys_of(tally.chosen):
        chosen, avail = total(tally.chosen, None, key), total(tally.avail, None, key)
        if chosen < 5:
            continue
        actions = total(tally.actions, None, key)
        valued = total(tally.valued, None, key)
        mean, se = mean_se(total(tally.value, None, key), total(tally.value_sq, None, key), valued)
        per_action = valued / actions if actions else 1.0
        rows.append((key, chosen, avail, mean * per_action, se * per_action))
    for key, chosen, avail, mean, se in sorted(rows, key=lambda row: -row[1]):
        by_bot = " | ".join(pct(total(tally.chosen, bot, key), total(tally.avail, bot, key)) for bot in bots)
        lines.append(
            f"| {names.decision(key)} | {int(chosen)} | {pct(chosen, avail)} | {by_bot} | {num_ci(mean, se, 2)} |"
        )
    return [*lines, ""]


def _thirds(tally: Tally, names: Names) -> list[str]:
    lines = [
        "## По третям партии",
        "",
        "Выбор и ценность за действие отдельно для начала, середины и конца партии: решение, сильное в начале и "
        "бесполезное в конце, иначе усредняется в ничто.",
        "",
        "| Решение | "
        + " | ".join(f"Выбор: {THIRDS[bucket]}" for bucket in BUCKETS)
        + " | "
        + " | ".join(f"Ценность: {THIRDS[bucket]}" for bucket in BUCKETS)
        + " |",
        "|---|" + "---:|" * (2 * len(BUCKETS)),
    ]
    popular = sorted(keys_of(tally.chosen), key=lambda key: -total(tally.chosen, None, key))
    for key in popular[:60]:
        picks, values = [], []
        for bucket in BUCKETS:
            picks.append(pct(total(tally.chosen, None, key, bucket), total(tally.avail, None, key, bucket)))
            actions = total(tally.actions, None, key, bucket)
            valued = total(tally.valued, None, key, bucket)
            worth = total(tally.value, None, key, bucket)
            values.append(num(worth / actions, 2) if actions else (num(worth / valued, 2) if valued else "—"))
        lines.append(f"| {names.decision(key)} | " + " | ".join(picks) + " | " + " | ".join(values) + " |")
    return [*lines, ""]


def _counterfactual(tally: Tally, names: Names) -> list[str]:
    keys = sorted({key for key, _bucket in tally.cf_n})
    if not keys:
        return []
    rows = []
    for key in keys:
        count = sum(value for (name, _bucket), value in tally.cf_n.items() if name == key)
        stats = {}
        for metric in ("score", "rel", "win"):
            total_value = sum(value for (name, _bucket), value in getattr(tally, f"cf_{metric}").items() if name == key)
            total_sq = sum(value for (name, _bucket), value in getattr(tally, f"cf_{metric}_sq").items() if name == key)
            stats[metric] = mean_se(total_value, total_sq, count)
        rows.append((key, count, stats))
    forks = sum(tally.cf_n.values())
    lines = [
        "## Контрфактические развилки",
        "",
        f"Развилок: {forks} (≈{forks / max(1, tally.games):.1f} на партию, {tally.cf_seconds / 60:.0f} мин счёта). В случайном "
        "решении партия раздваивалась: в одной ветке игрок делал вариант X, в другой — то, что выбрал бы сам; обе "
        "доигрывались до конца одинаково (Reborn и Boris — сами, Ledger и Oracle — быстрым Ledger) при одинаковых бросках.",
        "",
        "Колонки — насколько X лучше обычного хода бота: в очках игрока, в очках относительно среднего соперника и в "
        "шансе на победу. **Плюс** — вариант сильнее того, что боты обычно делают в этой ситуации (недооценён или силён); "
        "**минус** — слабее. Это предельная ценность решения «в руках игрока уровня этих ботов», без смещения выбора.",
        "",
        "| Решение | Развилок | Очки | Относительно стола | Шанс победы | Вывод |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for key, count, stats in sorted(
        rows, key=lambda row: -(row[2]["rel"][0] if math.isfinite(row[2]["rel"][0]) else -99)
    ):
        if count < 5:
            continue
        rel_mean, rel_se = stats["rel"]
        win_mean, win_se = stats["win"]
        lines.append(
            f"| {names.decision(key)} | {count} | {num_ci(*stats['score'])} | {num_ci(rel_mean, rel_se)} | "
            f"{num_ci(100 * win_mean, 100 * win_se, 0)} п.п. | {verdict(rel_mean, rel_se)} |"
        )
    rare = sum(1 for _key, count, _stats in rows if count < 5)
    if rare:
        lines += ["", f"Ещё {rare} решений встретились в развилках реже 5 раз и не показаны."]
    return [*lines, ""]


def _oracle(tally: Tally, names: Names) -> list[str]:
    lines = [
        "## Мнение Oracle",
        "",
        f"Пересчётов плана: {tally.oracle_replans}. Для каждого класса первого действия — сколько раз Oracle доигрывал "
        "его до конца горизонта, сколько раз он оказался лучшим, и насколько в среднем уступал лучшему (≈ очках "
        "относительно стола). Oracle доигрывает только лучшие планы по оценке Ledger, поэтому редкие варианты здесь "
        "представлены слабо.",
        "",
        "| Решение | Рассмотрен | Лучший | Доля лучших | Средний разрыв | В выбранных планах |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for key in sorted(tally.oracle_considered, key=lambda name: -tally.oracle_considered[name]):
        considered = tally.oracle_considered[key]
        if considered < 10:
            continue
        lines.append(
            f"| {names.decision(key)} | {considered} | {tally.oracle_best[key]} | {pct_ci(tally.oracle_best[key], considered)} | "
            f"{ratio(tally.oracle_gap[key], considered, 2)} | {tally.oracle_plan[key]} |"
        )
    return [*lines, ""]


def _anomalies(engine: CityEngine, tally: Tally, names: Names, bots: list[str], bot_names: dict[str, str]) -> list[str]:
    lines = ["## Аномалии", ""]
    strong = []
    for key in keys_of(tally.chosen):
        actions = total(tally.actions, None, key)
        if actions >= 10 and total(tally.valued, None, key) >= 10:
            per_action = total(tally.value, None, key) / actions
            if per_action > STRONG_ACTION_VALUE:
                strong.append((key, per_action))
    lines.append(
        f"**Решения с ценностью выше {STRONG_ACTION_VALUE:.0f} очков за действие:** "
        + (
            ", ".join(f"{names.decision(key)} ({value:.1f})" for key, value in sorted(strong, key=lambda r: -r[1]))
            or "нет"
        )
    )
    lines.append("")
    loops = sorted(tally.loops.items(), key=lambda item: -item[1])
    lines.append(
        f"**Одно и то же решение {LOOP_REPEATS}+ раз за ход:** "
        + (
            ", ".join(
                f"{bot_names.get(bot, bot)} · {names.decision(key)} ({count})" for (bot, key), count in loops[:12]
            )
            or "нет"
        )
    )
    for example in tally.loop_examples[:6]:
        lines.append(
            f"- сид {example['seed']} (партия {example['game']}), раунд {example['round']}: {bot_names.get(example['bot'], example['bot'])} · {names.decision(example['action'])}"
        )
    lines.append("")
    lines.append(
        f"**Конец партии с кучей ≥{HOARD_MONEY}$ или ≥{HOARD_INFLUENCE}◆:** "
        + (f"{len(tally.hoard_examples)} случаев (показаны первые)" if tally.hoard_examples else "нет")
    )
    for example in tally.hoard_examples[:6]:
        lines.append(
            f"- сид {example['seed']} (партия {example['game']}): {bot_names.get(example['bot'], example['bot'])} — {example['money']}$, {example['influence']}◆"
        )
    lines.append("")
    if tally.games_log:
        top = max(tally.games_log, key=lambda game: max(game["scores"].values()))
        low = min(tally.games_log, key=lambda game: min(game["scores"].values()))
        wide = max(tally.games_log, key=lambda game: game["margin"])
        lines.append("**Крайние партии** (для разбора по сиду):")
        for title, game in (("рекорд счёта", top), ("худший счёт", low), ("самый большой отрыв", wide)):
            scores = ", ".join(f"{bot_names.get(bot, bot)} {value}" for bot, value in game["scores"].items())
            lines.append(f"- {title}: сид {game['seed']} (партия {game['game']}) — {scores}")
        lines.append("")
    dominant = []
    for card in engine.catalog.assets:
        lift, se = _lift(tally, bots, card)
        owners = sum(1 for bot in bots if tally.obj_owner_games[(bot, card)] >= 10)
        if math.isfinite(lift) and lift > 0.10 and lift > 2 * se and owners >= 3:
            dominant.append((card, lift))
    lines.append(
        "**Объекты, чей владелец значимо чаще выигрывает у трёх и более ботов (лифт > 10 п.п.):** "
        + (
            ", ".join(
                f"{names.asset(card)} (+{lift * 100:.0f} п.п.)" for card, lift in sorted(dominant, key=lambda r: -r[1])
            )
            or "нет"
        )
    )
    return [*lines, ""]


def _checks(tally: Tally) -> list[str]:
    return [
        "## Самопроверки",
        "",
        f"- Выплат раундов: {tally.settlements}; расхождений разложения дохода по объектам: {tally.settle_mismatch}.",
        f"- Команд, закрывших раунд (исключены из оценки действий): {tally.settling}.",
        "",
    ]


def _glossary(names: Names) -> list[str]:
    lines = ["## Глоссарий для разработчика", "", "| Раздел | Название | Код |", "|---|---|---|"]
    lines += [f"| {section} | {title} | `{key}` |" for section, title, key in names.glossary()]
    return [*lines, ""]


__all__ = ["render", "wilson", "mean_se", "verdict"]
