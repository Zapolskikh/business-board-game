"""Launcher for the agent-play CLI: `python play.py state`, `python play.py do 4`, ...

Exists so the harness runs from a clean checkout without an editable install and without
PYTHONPATH juggling — which also makes it a single, precise entry point to allowlist.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from agent_play.cli import main  # noqa: E402  — import needs the path above

if __name__ == "__main__":
    raise SystemExit(main())
