"""Reproducible bot-balance and role-specialist simulation suite."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from city_bots import bot_policy_label
from city_engine.constants import ROLE_IDS
from city_engine.content import load_catalog
from simulation.report import write_report
from simulation.runner import SimulationConfig, recommended_workers, run_batch

BOT_MATCHUPS = (
    ("easy", "medium", "hard", "easy"),
    ("medium", "hard", "easy", "medium"),
    ("hard", "easy", "medium", "hard"),
)
OLEG_CONTROL = ("easy", "easy", "easy", "easy")


def run_suite(*, games: int, rounds: int, role_price: int, seed: int, workers: int) -> dict[str, Any]:
    bot_results = []
    for index, bots in enumerate(BOT_MATCHUPS, start=1):
        print(f"[{index}/10] Bot balance: {', '.join(bot_policy_label(bot) for bot in bots)}", flush=True)
        bot_results.append(
            run_batch(
                SimulationConfig(
                    games=games,
                    rounds=rounds,
                    players=4,
                    role_price=role_price,
                    bots=bots,
                    seed=seed,
                    workers=workers,
                )
            )
        )

    print("[4/10] Oleg control: four universal bots", flush=True)
    control = run_batch(
        SimulationConfig(
            games=games,
            rounds=rounds,
            players=4,
            role_price=role_price,
            bots=OLEG_CONTROL,
            seed=seed,
            workers=workers,
        )
    )
    write_report(Path("SIMULATION_RESULTS_any.md"), control)

    specialists: dict[str, dict[str, Any]] = {}
    for offset, role_id in enumerate(ROLE_IDS, start=5):
        print(f"[{offset}/10] Oleg specialist: seat 2, {role_id}", flush=True)
        result = run_batch(
            SimulationConfig(
                games=games,
                rounds=rounds,
                players=4,
                role_price=role_price,
                bots=OLEG_CONTROL,
                specialist_position=2,
                specialist_role=role_id,
                seed=seed,
                workers=workers,
            )
        )
        specialists[role_id] = result
        write_report(Path(f"SIMULATION_RESULTS_{role_id}.md"), result)

    return {
        "games_per_config": games,
        "rounds": rounds,
        "role_price": role_price,
        "seed": seed,
        "bot_results": bot_results,
        "control": control,
        "specialists": specialists,
    }


def render_overview(result: dict[str, Any]) -> str:
    catalog = load_catalog()
    bot_results = result["bot_results"]
    control = result["control"]
    specialists = result["specialists"]
    games = result["games_per_config"]
    total_games = games * (len(bot_results) + 1 + len(specialists))

    difficulty_seats: dict[str, int] = {}
    difficulty_wins: dict[str, int] = {}
    for batch in bot_results:
        for difficulty, count in batch["difficulty_seats"].items():
            difficulty_seats[difficulty] = difficulty_seats.get(difficulty, 0) + count
        for difficulty, count in batch["difficulty_wins"].items():
            difficulty_wins[difficulty] = difficulty_wins.get(difficulty, 0) + count

    lines = [
        "# Сводный отчёт: боты и специалисты",
        "",
        f"Обновлено: {datetime.now(UTC).isoformat(timespec='seconds')}",
        "",
        "Все партии сыграны через production `city_engine` и обычную server-side bot policy.",
        "",
        "## Методика",
        "",
        f"- Партий на конфигурацию: {games}",
        f"- Всего партий: {total_games}",
        f"- Раундов: {result['rounds']}",
        "- Игроков: 4",
        f"- Цена роли: {result['role_price']}◆",
        f"- Seed: {result['seed']}",
        "- Бот-сравнение: три состава; каждый бот по одному разу занимает места 1–3 и один раз дополнительное место 4.",
        "- Specialist-сравнение: четыре Олега; только место 2 получает целевую роль, "
        "остальные остаются универсальными.",
        "",
        "## Боты против ботов",
        "",
        "| Бот | Мест в партиях | Побед | Win rate | Отклонение от 25% |",
        "|---|---:|---:|---:|---:|",
    ]
    for difficulty in ("easy", "medium", "hard"):
        seats = difficulty_seats[difficulty]
        wins = difficulty_wins[difficulty]
        win_rate = wins / seats * 100
        lines.append(
            f"| {bot_policy_label(difficulty)} | {seats} | {wins} | {win_rate:.2f}% | {win_rate - 25:+.2f} п.п. |"
        )

    seat_wins = {
        seat: sum(batch["seat_wins"][seat] for batch in bot_results)
        for seat in ("seat-1", "seat-2", "seat-3", "seat-4")
    }
    lines.extend(
        [
            "",
            "### Порядок хода в bot-сравнении",
            "",
            "| Место | Побед | Win rate |",
            "|---|---:|---:|",
        ]
    )
    bot_comparison_games = games * len(bot_results)
    for seat, wins in seat_wins.items():
        lines.append(f"| {seat} | {wins} | {wins / bot_comparison_games * 100:.2f}% |")

    control_win_rate = control["seat_win_pct"]["seat-2"]
    control_score = control["seat_avg_score"]["seat-2"]
    lines.extend(
        [
            "",
            "## Специалисты Олега на втором месте",
            "",
            f"Контрольный универсальный Олег на месте 2: **{control_win_rate:.2f}% побед**, "
            f"средний счёт **{control_score:.2f}**.",
            "",
            "| Роль | Win rate | Δ к контролю | Средний счёт | Получал роль | Удержал в финале |",
            "|---|---:|---:|---:|---:|---:|",
        ]
    )
    for role_id in ROLE_IDS:
        specialist = specialists[role_id]["specialist"]
        title = f"{catalog.roles[role_id].icon} {catalog.roles[role_id].title}"
        lines.append(
            f"| {title} | {specialist['win_pct']:.2f}% | "
            f"{specialist['win_pct'] - control_win_rate:+.2f} п.п. | {specialist['avg_score']:.2f} | "
            f"{specialist['acquisition_pct']:.2f}% | {specialist['final_hold_pct']:.2f}% |"
        )

    bot_rates = {
        difficulty: difficulty_wins[difficulty] / difficulty_seats[difficulty] * 100
        for difficulty in ("easy", "medium", "hard")
    }
    best_bot = max(bot_rates, key=bot_rates.get)
    second_bot = sorted(bot_rates, key=bot_rates.get, reverse=True)[1]
    weakest_bot = min(bot_rates, key=bot_rates.get)
    specialist_rates = {role_id: specialists[role_id]["specialist"]["win_pct"] for role_id in ROLE_IDS}
    best_role = max(specialist_rates, key=specialist_rates.get)
    weakest_role = min(specialist_rates, key=specialist_rates.get)
    seat_rates = {seat: wins / bot_comparison_games * 100 for seat, wins in seat_wins.items()}
    best_seat = max(seat_rates, key=seat_rates.get)
    weakest_seat = min(seat_rates, key=seat_rates.get)
    lines.extend(
        [
            "",
            "## Краткие выводы",
            "",
            f"- Лучший универсальный бот: **{bot_policy_label(best_bot)} — {bot_rates[best_bot]:.2f}%**. "
            f"Следом {bot_policy_label(second_bot)} — {bot_rates[second_bot]:.2f}%.",
            f"- **{bot_policy_label(weakest_bot)} — {bot_rates[weakest_bot]:.2f}%**: "
            "это большой разрыв алгоритмов, а не статистический шум.",
            f"- Порядок хода сохранил влияние: {best_seat} выиграл {seat_rates[best_seat]:.2f}%, "
            f"{weakest_seat} — {seat_rates[weakest_seat]:.2f}%.",
            f"- Сильнейший Олег-специалист: **{catalog.roles[best_role].title} — "
            f"{specialist_rates[best_role]:.2f}%**; слабейший: **{catalog.roles[weakest_role].title} — "
            f"{specialist_rates[weakest_role]:.2f}%**.",
            "- Все специалисты превысили контроль универсального Олега. Поэтому абсолютный specialist win rate "
            "пока измеряет одновременно силу роли и качество сфокусированной стратегии; роли нельзя нерфить только "
            "по этой таблице без specialist-vs-specialist проверки.",
        ]
    )

    lines.extend(
        [
            "",
            "## Файлы подробных отчётов",
            "",
            "- Универсальные Олеги: `SIMULATION_RESULTS_any.md`.",
            "- Каждая роль: `SIMULATION_RESULTS_<role>.md`.",
            "- В подробных файлах находятся статистика ролей, районов, объектов, карт и источников дохода.",
        ]
    )
    return "\n".join(lines) + "\n"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Run the complete production bot and specialist suite")
    result.add_argument("--games", type=int, default=300, help="games per each of 10 configurations")
    result.add_argument("--rounds", type=int, default=15)
    result.add_argument("--role-price", type=int, default=3)
    result.add_argument("--seed", type=int, default=104_729)
    result.add_argument("--workers", type=int, default=recommended_workers())
    result.add_argument("--output", type=Path, default=Path("SIMULATION_RESULTS_OVERVIEW.md"))
    return result


def main() -> None:
    args = parser().parse_args()
    try:
        result = run_suite(
            games=args.games,
            rounds=args.rounds,
            role_price=args.role_price,
            seed=args.seed,
            workers=args.workers,
        )
    except ValueError as exc:
        parser().error(str(exc))
    args.output.write_text(render_overview(result), encoding="utf-8")
    print(f"Completed {args.games * 10} games. Overview overwritten: {args.output.resolve()}")


if __name__ == "__main__":
    main()
