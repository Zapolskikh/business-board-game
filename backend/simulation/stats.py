"""Aggregate simulation results into a balance report.

The headline metric is **win-rate per starting role**: with random bots, a
balanced design should give every role a similar win-rate (≈ 1 / players). Large,
stable deviations point to over/under-powered roles. Secondary metrics (average
net worth, bankruptcies, object landings) help localise *why*.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from simulation.runner import GameResult

# Per-player counters worth summing globally to spot object/mechanic imbalance.
_INTERESTING_TOTALS = [
    "properties_bought",
    "hospital_visits",
    "jail_visits",
    "roles_taken",
    "roles_lost",
    "bankruptcies",
    "promotions",
    "start_passes",
    "rolls",
]


def compute_report(results: list[GameResult]) -> dict[str, Any]:
    games = len(results)
    if games == 0:
        return {"games": 0}

    appearances: Counter[str] = Counter()
    wins: Counter[str] = Counter()
    net_sum: defaultdict[str, int] = defaultdict(int)
    money_sum: defaultdict[str, int] = defaultdict(int)
    exp_sum: defaultdict[str, int] = defaultdict(int)
    bankrupt_sum: defaultdict[str, int] = defaultdict(int)
    roleslost_sum: defaultdict[str, int] = defaultdict(int)

    end_reasons: Counter[str] = Counter()
    totals: Counter[str] = Counter()
    landings: Counter[str] = Counter()
    rounds_sum = 0
    turns_sum = 0

    for result in results:
        end_reasons[result.end_reason] += 1
        rounds_sum += result.rounds
        turns_sum += result.turns
        for pr in result.players:
            role = pr.starting_role or "none"
            appearances[role] += 1
            net_sum[role] += pr.net_worth
            money_sum[role] += pr.money
            exp_sum[role] += pr.experience
            bankrupt_sum[role] += pr.stats.get("bankruptcies", 0)
            roleslost_sum[role] += pr.stats.get("roles_lost", 0)
            if pr.won:
                wins[role] += 1
            for key in _INTERESTING_TOTALS:
                totals[key] += pr.stats.get(key, 0)
            for key, value in pr.stats.items():
                if key.startswith("land_"):
                    landings[key[len("land_"):]] += value

    roles: dict[str, Any] = {}
    for role, count in sorted(appearances.items()):
        roles[role] = {
            "appearances": count,
            "wins": wins[role],
            "win_rate": round(wins[role] / count, 4) if count else 0.0,
            "avg_net_worth": round(net_sum[role] / count, 1),
            "avg_money": round(money_sum[role] / count, 1),
            "avg_experience": round(exp_sum[role] / count, 2),
            "avg_bankruptcies": round(bankrupt_sum[role] / count, 3),
            "avg_roles_lost": round(roleslost_sum[role] / count, 3),
        }

    return {
        "games": games,
        "avg_rounds": round(rounds_sum / games, 1),
        "avg_turns": round(turns_sum / games, 1),
        "end_reasons": dict(end_reasons),
        "roles": roles,
        "totals": dict(totals),
        "landings": dict(sorted(landings.items(), key=lambda kv: -kv[1])),
    }


def format_report(report: dict[str, Any]) -> str:
    if report.get("games", 0) == 0:
        return "Нет данных (0 игр)."

    lines: list[str] = []
    lines.append(f"Игр сыграно: {report['games']}")
    lines.append(f"Средн. раундов: {report['avg_rounds']}, средн. ходов: {report['avg_turns']}")
    lines.append(f"Причины завершения: {report['end_reasons']}")
    lines.append("")
    lines.append("Баланс ролей (по стартовой роли):")
    header = f"  {'роль':<12}{'игр':>6}{'побед':>7}{'win%':>8}{'капитал':>10}{'банкр.':>8}{'потери роли':>13}"
    lines.append(header)
    lines.append("  " + "-" * (len(header) - 2))
    roles = report["roles"]
    for role, r in sorted(roles.items(), key=lambda kv: -kv[1]["win_rate"]):
        lines.append(
            f"  {role:<12}{r['appearances']:>6}{r['wins']:>7}"
            f"{r['win_rate'] * 100:>7.1f}%{r['avg_net_worth']:>10}"
            f"{r['avg_bankruptcies']:>8}{r['avg_roles_lost']:>13}"
        )
    lines.append("")
    lines.append(f"Итоги по механикам (сумма по всем игрокам): {report['totals']}")
    lines.append("")
    lines.append("Частота попаданий на клетки (топ):")
    for cell_type, count in list(report["landings"].items())[:12]:
        lines.append(f"  {cell_type:<18}{count:>8}")
    return "\n".join(lines)
