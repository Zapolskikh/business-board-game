"""Command-line simulation runner.

Examples::

    python -m simulation.cli --games 500 --players 4 --board board_72 --seed 42
    python -m simulation.cli --games 1000 --bot greedy --out out/report.json

The report highlights win-rate per role — the primary balance signal.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from simulation.bots import BOTS, make_bot
from simulation.runner import run_batch
from simulation.stats import compute_report, format_report


def _force_utf8_stdout() -> None:
    """Windows consoles default to cp1252 and choke on Cyrillic/emoji output.

    Reconfigure stdout/stderr to UTF-8 so ``python -m simulation.cli`` prints the
    Russian balance report regardless of the active code page.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (ValueError, OSError):  # pragma: no cover - best effort
                pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Симулятор партий для поиска дисбаланса.")
    parser.add_argument("--games", type=int, default=200, help="Сколько партий сыграть.")
    parser.add_argument("--players", type=int, default=4, help="Игроков в партии (2-6).")
    parser.add_argument("--board", type=str, default=None, help="Имя поля (board_60 / board_72).")
    parser.add_argument("--seed", type=int, default=0, help="Базовый seed (для воспроизводимости).")
    parser.add_argument(
        "--bot", type=str, default="random", choices=sorted(BOTS), help="Тип бота."
    )
    parser.add_argument("--out", type=str, default=None, help="Путь для сохранения JSON-отчёта.")
    return parser


def main(argv: list[str] | None = None) -> int:
    _force_utf8_stdout()
    args = build_parser().parse_args(argv)
    bot = make_bot(args.bot)

    start = time.perf_counter()
    results = run_batch(
        games=args.games,
        num_players=args.players,
        board_name=args.board,
        bot=bot,
        base_seed=args.seed,
    )
    elapsed = time.perf_counter() - start

    report = compute_report(results)
    report["config"] = {
        "games": args.games,
        "players": args.players,
        "board": args.board or "(default)",
        "bot": args.bot,
        "seed": args.seed,
        "elapsed_seconds": round(elapsed, 2),
    }

    print(format_report(report))
    print(f"\nВремя: {elapsed:.2f}s ({args.games / elapsed:.0f} партий/с)")

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Отчёт сохранён: {out_path}")

    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
