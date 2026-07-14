"""Command-line entry point for authoritative simulations."""

from __future__ import annotations

import argparse
from pathlib import Path

from simulation.report import write_report
from simulation.runner import SimulationConfig, recommended_workers, run_batch


def parse_specialist(value: str) -> tuple[int, str]:
    try:
        position, role = value.split(",", 1)
        return int(position), role.strip()
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("specialist must use POSITION,ROLE") from exc


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Run production City games through city_engine")
    result.add_argument("--games", type=int, default=100)
    result.add_argument("--rounds", type=int, default=15)
    result.add_argument("--players", type=int, default=4)
    result.add_argument("--role-price", type=int, default=3)
    result.add_argument("--bots", default="medium,medium,medium,medium")
    result.add_argument("--specialist", type=parse_specialist)
    result.add_argument("--seed", type=int, default=104_729)
    result.add_argument("--workers", type=int, default=recommended_workers())
    result.add_argument("--output", type=Path)
    return result


def main() -> None:
    args = parser().parse_args()
    bots = tuple(item.strip() for item in args.bots.split(",") if item.strip())
    specialist_position, specialist_role = args.specialist or (None, None)
    output = args.output or Path(
        f"SIMULATION_RESULTS_{specialist_role}.md" if specialist_role else "SIMULATION_RESULTS_any.md"
    )
    config = SimulationConfig(
        games=args.games,
        rounds=args.rounds,
        players=args.players,
        role_price=args.role_price,
        bots=bots,
        specialist_position=specialist_position,
        specialist_role=specialist_role,
        seed=args.seed,
        workers=args.workers,
    )
    result = run_batch(config)
    write_report(output, result)
    print(f"Completed {config.games} games. Report overwritten: {output.resolve()}")


if __name__ == "__main__":
    main()
