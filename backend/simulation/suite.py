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

# One policy is left, so the suite measures the game, not a ladder of bots: four Reborns as the
# control table, then each role pursued by the Reborn in seat 2.
REBORN_CONTROL = ("expert", "expert", "expert", "expert")
CONFIGS = 1 + len(ROLE_IDS)


def run_suite(*, games: int, rounds: int, role_price: int, seed: int, workers: int) -> dict[str, Any]:
    print(f"[1/{CONFIGS}] Control: four {bot_policy_label('expert')}", flush=True)
    control = run_batch(
        SimulationConfig(
            games=games,
            rounds=rounds,
            players=4,
            role_price=role_price,
            bots=REBORN_CONTROL,
            seed=seed,
            workers=workers,
        )
    )
    write_report(Path("SIMULATION_RESULTS_any.md"), control)

    specialists: dict[str, dict[str, Any]] = {}
    for offset, role_id in enumerate(ROLE_IDS, start=2):
        print(f"[{offset}/{CONFIGS}] Specialist: seat 2, {role_id}", flush=True)
        result = run_batch(
            SimulationConfig(
                games=games,
                rounds=rounds,
                players=4,
                role_price=role_price,
                bots=REBORN_CONTROL,
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
        "control": control,
        "specialists": specialists,
    }


def render_overview(result: dict[str, Any]) -> str:
    catalog = load_catalog()
    control = result["control"]
    specialists = result["specialists"]
    games = result["games_per_config"]
    total_games = games * (1 + len(specialists))
    lines = [
        "# Сводный отчёт: контрольный стол и специалисты",
        "",
        f"Обновлено: {datetime.now(UTC).isoformat(timespec='seconds')}",
        "",
        "Все партии сыграны через production `city_engine` и server-side bot policy Claude Reborn.",
        "",
        "## Методика",
        "",
        f"- Партий на конфигурацию: {games}",
        f"- Всего партий: {total_games}",
        f"- Раундов: {result['rounds']}",
        "- Игроков: 4",
        f"- Цена роли: {result['role_price']}◆",
        f"- Seed: {result['seed']}",
        "- Контроль: четыре универсальных Reborn.",
        "- Специалист: те же четыре Reborn, но место 2 целенаправленно добивается своей роли.",
        "",
        "## Порядок хода в контрольном столе",
        "",
        "| Место | Win rate | Средний счёт |",
        "|---|---:|---:|",
    ]
    for seat in ("seat-1", "seat-2", "seat-3", "seat-4"):
        lines.append(f"| {seat} | {control['seat_win_pct'][seat]:.2f}% | {control['seat_avg_score'][seat]:.2f} |")

    control_win_rate = control["seat_win_pct"]["seat-2"]
    control_score = control["seat_avg_score"]["seat-2"]
    lines.extend(
        [
            "",
            "## Специалисты на втором месте",
            "",
            f"Контрольный универсальный Reborn на месте 2: **{control_win_rate:.2f}% побед**, "
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
    lines.extend(
        [
            "",
            "## Файлы подробных отчётов",
            "",
            "- Контрольный стол: `SIMULATION_RESULTS_any.md`.",
            "- Каждая роль: `SIMULATION_RESULTS_<role>.md`.",
            "- В подробных файлах находятся статистика ролей, районов, объектов, карт и источников дохода.",
        ]
    )
    return "\n".join(lines) + "\n"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Run the complete production bot and specialist suite")
    result.add_argument("--games", type=int, default=300, help=f"games per each of {CONFIGS} configurations")
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
    print(f"Completed {args.games * CONFIGS} games. Overview overwritten: {args.output.resolve()}")


if __name__ == "__main__":
    main()
