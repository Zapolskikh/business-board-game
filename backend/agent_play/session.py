"""Where the agent keeps its seat between CLI calls.

Each command is also appended to a journal, so a room lost to a server restart
(ROOM_STORE=auto keeps games in process memory) can still be reconstructed.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

DEFAULT_DIR = Path(".agent_play")


def session_dir(explicit: str | os.PathLike[str] | None = None) -> Path:
    if explicit is not None:
        return Path(explicit)
    return Path(os.getenv("AGENT_PLAY_DIR", DEFAULT_DIR))


@dataclass(slots=True)
class Session:
    base_url: str
    room_id: str
    password: str
    player_id: str
    player_name: str
    directory: Path = DEFAULT_DIR

    @property
    def path(self) -> Path:
        return self.directory / "session.json"

    @property
    def meta_path(self) -> Path:
        return self.directory / "meta.json"

    @property
    def journal_path(self) -> Path:
        return self.directory / "journal.jsonl"

    def save(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        data = {key: value for key, value in asdict(self).items() if key != "directory"}
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, directory: Path) -> Session:
        path = directory / "session.json"
        if not path.exists():
            raise FileNotFoundError(f"no session at {path}; run `agent_play new` or `agent_play join` first")
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            base_url=str(data["base_url"]),
            room_id=str(data["room_id"]),
            password=str(data["password"]),
            player_id=str(data["player_id"]),
            player_name=str(data.get("player_name", "Agent")),
            directory=directory,
        )

    def journal(self, entry: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        with self.journal_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def cached_meta(self) -> dict[str, Any] | None:
        if not self.meta_path.exists():
            return None
        try:
            return json.loads(self.meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None

    def store_meta(self, meta: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        self.meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
