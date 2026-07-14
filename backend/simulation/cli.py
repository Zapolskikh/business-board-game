"""Command-line entry point for authoritative simulations."""

from __future__ import annotations

import argparse
from pathlib import Path

from city_bots import normalize_bot_policy
from city_engine.constants import ROLE_IDS
from simulation.report import write_report
from simulation.runner import SimulationConfig, recommended_workers, run_batch


def parse_specialist(value: str) -> tuple[int, str]:
    try:
        position, role = value.split(",", 1)
        parsed = int(position), role.strip().lower()
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("specialist must use POSITION,ROLE") from exc
    if parsed[1] not in ROLE_IDS:
        raise argparse.ArgumentTypeError(
            f"unknown specialist role {parsed[1]!r}; expected one of: {', '.join(ROLE_IDS)}"
        )
    return parsed


def parse_bots(value: str) -> tuple[str, ...]:
    names = [item.strip() for item in value.split(",") if item.strip()]
    if not names:
        raise argparse.ArgumentTypeError("bots must be a comma-separated list")
    try:
        return tuple(normalize_bot_policy(item) for item in names)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Run bot games through the production City engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Bot policies: easy/oleg, medium/codex, hard/claude\n"
            f"Specialist roles: {', '.join(ROLE_IDS)}\n\n"
            "Examples:\n"
            "  --players=4 --bots=oleg,codex,claude,codex\n"
            "  --players=4 --bots=oleg,codex,claude,codex --specialist=2,mafia"
        ),
    )
    result.add_argument("--games", type=int, default=100, help="number of complete games")
    result.add_argument("--rounds", type=int, default=15, help="rounds in each game (5-30)")
    result.add_argument("--players", type=int, default=4, help="number of bot seats (2-6)")
    result.add_argument("--role-price", type=int, default=3, help="role claim price (2-10)")
    result.add_argument(
        "--bots",
        type=parse_bots,
        default=parse_bots("codex,codex,codex,codex"),
        help="one comma-separated policy per seat",
    )
    result.add_argument(
        "--specialist",
        type=parse_specialist,
        metavar="POSITION,ROLE",
        help="make one 1-based seat rationally prioritize a role",
    )
    result.add_argument("--seed", type=int, default=104_729, help="base deterministic RNG seed")
    result.add_argument("--workers", type=int, default=recommended_workers(), help="parallel worker processes")
    result.add_argument("--output", type=Path, help="report path; defaults to SIMULATION_RESULTS_*.md")
    return result


def main() -> None:
    argument_parser = parser()
    args = argument_parser.parse_args()
    specialist_position, specialist_role = args.specialist or (None, None)
    output = args.output or Path(
        f"SIMULATION_RESULTS_{specialist_role}.md" if specialist_role else "SIMULATION_RESULTS_any.md"
    )
    config = SimulationConfig(
        games=args.games,
        rounds=args.rounds,
        players=args.players,
        role_price=args.role_price,
        bots=args.bots,
        specialist_position=specialist_position,
        specialist_role=specialist_role,
        seed=args.seed,
        workers=args.workers,
    )
    try:
        result = run_batch(config)
    except ValueError as exc:
        argument_parser.error(str(exc))
    write_report(output, result)
    print(f"Completed {config.games} games. Report overwritten: {output.resolve()}")


if __name__ == "__main__":
    main()
