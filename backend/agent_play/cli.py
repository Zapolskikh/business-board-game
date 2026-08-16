"""`python -m agent_play` — an agent-friendly seat at the City of Influence table.

Typical session against a local `uvicorn app.main:app --app-dir backend`:

    python -m agent_play new --bots 3            # room + my seat + bots, game started
    python -m agent_play state                   # full board and numbered legal actions
    python -m agent_play do 4                    # play [ 4]; prints events + short status, not the board
    python -m agent_play turn "4" "basic_action kind=work" "end_turn"   # whole turn in one call
    python -m agent_play wait                    # block until my turn, then draw the board

The cheap loop for a multi-agent table is **two calls per turn**: `wait` (it draws the board when
the turn comes round) then `turn` with every action of the turn including `end_turn`. `do`/`turn`
print only what changed plus the counters — redrawing the board after each single action used to
be 82% of everything a four-agent session had to read.

To share a table with a human: `new --capacity 4 --bots 2 --no-start` leaves seat 1 free,
the human joins it in the browser with the same room password, then `agent_play start`.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from agent_play.client import DEFAULT_BASE_URL, CityClient, HttpError
from agent_play.render import (
    Catalog,
    describe_action,
    describe_event,
    render_state,
    render_turn_status,
    resolve_action,
)
from agent_play.session import Session, session_dir
from city_engine.constants import BOT_DIFFICULTIES


def parse_value(raw: str) -> Any:
    if raw.lower() in {"true", "false"}:
        return raw.lower() == "true"
    if raw.lower() in {"null", "none"}:
        return None
    try:
        return int(raw)
    except ValueError:
        return raw


def parse_pairs(items: list[str]) -> dict[str, Any]:
    pairs: dict[str, Any] = {}
    for item in items:
        if "=" not in item:
            raise SystemExit(f"payload arguments must look like key=value, got {item!r}")
        key, _, value = item.partition("=")
        pairs[key] = parse_value(value)
    return pairs


def load_catalog(client: CityClient, session: Session) -> Catalog:
    cached = session.cached_meta()
    if cached is None:
        cached = client.meta()
        session.store_meta(cached)
    return Catalog.from_meta(cached)


def fetch_state(client: CityClient, session: Session) -> dict[str, Any]:
    return client.state(session.room_id, password=session.password, viewer_id=session.player_id)


def print_state(room: dict[str, Any], catalog: Catalog, session: Session, args: argparse.Namespace) -> None:
    if getattr(args, "json", False):
        print(json.dumps(room, ensure_ascii=False, indent=1))
        return
    print(
        render_state(
            room,
            catalog,
            session.player_id,
            actions=not getattr(args, "no_actions", False),
            log_lines=getattr(args, "log", 8),
        )
    )


def command_new(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    directory = session_dir(args.dir)
    if args.bots + 1 > args.capacity:
        raise SystemExit("capacity must leave room for my seat and every bot")
    room = client.create_room(
        name=args.name,
        password=args.password,
        capacity=args.capacity,
        max_rounds=args.rounds,
        role_price=args.role_price,
    )
    room_id = str(room["id"])
    client.join(room_id, password=args.password, seat_index=args.seat, player_name=args.me)
    bot_seats = [index for index in range(args.capacity - 1, -1, -1) if index != args.seat][: args.bots]
    for index in sorted(bot_seats):
        client.set_bot(
            room_id,
            password=args.password,
            seat_index=index,
            difficulty=args.difficulty,
            preferred_role=args.bot_role,
        )
    session = Session(
        base_url=args.url,
        room_id=room_id,
        password=args.password,
        player_id=f"seat-{args.seat + 1}",
        player_name=args.me,
        directory=directory,
    )
    session.save()
    session.journal({"action": "new", "room_id": room_id, "seat": args.seat, "bots": sorted(bot_seats)})
    catalog = load_catalog(client, session)

    empty = args.capacity - 1 - args.bots
    if args.no_start or empty > 0:
        print(f"комната {room_id} создана · пароль {args.password} · свободных мест: {empty}")
        print("люди могут занять свободные места в браузере, затем: python -m agent_play start")
        print_state(client.room(room_id), catalog, session, args)
        return 0
    client.start(room_id, password=args.password, seed=args.seed)
    session.journal({"action": "start", "seed": args.seed})
    print(f"комната {room_id} создана и запущена · пароль {args.password} · я {session.player_id} ({args.me})")
    print_state(fetch_state(client, session), catalog, session, args)
    return 0


def command_join(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    client.join(args.room, password=args.password, seat_index=args.seat, player_name=args.me)
    session = Session(
        base_url=args.url,
        room_id=args.room,
        password=args.password,
        player_id=f"seat-{args.seat + 1}",
        player_name=args.me,
        directory=session_dir(args.dir),
    )
    session.save()
    session.journal({"action": "join", "room_id": args.room, "seat": args.seat})
    catalog = load_catalog(client, session)
    print(f"занял место {args.seat} ({session.player_id}) в комнате {args.room}")
    summary = client.room(args.room)
    # A waiting room has no game yet, so /state would only report the seats anyway.
    print_state(summary if summary["status"] == "waiting" else fetch_state(client, session), catalog, session, args)
    return 0


def command_start(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    session = Session.load(session_dir(args.dir))
    client.start(session.room_id, password=session.password, seed=args.seed)
    session.journal({"action": "start", "seed": args.seed})
    print_state(fetch_state(client, session), load_catalog(client, session), session, args)
    return 0


def command_state(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    session = Session.load(session_dir(args.dir))
    print_state(fetch_state(client, session), load_catalog(client, session), session, args)
    return 0


def play_one(
    client: CityClient,
    session: Session,
    catalog: Catalog,
    room: dict[str, Any],
    selector: str,
    pairs: dict[str, Any],
) -> dict[str, Any]:
    """Resolve one action against the current room view, send it and print what happened."""
    game = room.get("game")
    if not game:
        raise SystemExit("the game has not started yet")
    legal = room.get("legal_actions") or []
    if not legal:
        raise SystemExit(f"не мой ход: ходит {game['players'][game['current_player_index']]['name']}")
    try:
        action = resolve_action(legal, selector, pairs)
    except KeyError as exc:
        raise SystemExit(str(exc)) from exc

    me = next(player for player in game["players"] if player["id"] == session.player_id)
    print(f"→ {describe_action(legal.index(action), action, game, me, catalog)}")
    seen = len(game["event_log"])
    command_id = f"agent-{uuid.uuid4().hex[:12]}"
    try:
        room = client.command(
            session.room_id,
            password=session.password,
            actor_id=session.player_id,
            command_type=action["type"],
            payload=action["payload"],
            expected_revision=int(game["revision"]),
            command_id=command_id,
        )
    except HttpError as exc:
        session.journal({"action": "command", "failed": exc.detail, "command": action})
        raise SystemExit(f"команда отклонена: {exc.detail}") from exc
    session.journal(
        {
            "action": "command",
            "command_id": command_id,
            "type": action["type"],
            "payload": action["payload"],
            "revision": room.get("game", {}).get("revision"),
        }
    )
    game = room["game"]
    for event in game["event_log"][seen:]:
        print(f"  {describe_event(event, game, catalog)}")
    return room


def report_after_actions(room: dict[str, Any], catalog: Catalog, session: Session, args: argparse.Namespace) -> None:
    """Default output after acting: the short status, not the whole board again.

    Reprinting the board after every action was 82% of everything a four-agent session read.
    The board barely moves between two actions of the same turn, and the events above already
    say what changed — the agent only needs the counters and the updated action list.
    """
    if getattr(args, "board", False) or getattr(args, "json", False):
        print_state(room, catalog, session, args)
    elif not args.quiet and room.get("game"):
        print(render_turn_status(room, catalog, session.player_id))


def command_do(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    session = Session.load(session_dir(args.dir))
    catalog = load_catalog(client, session)
    room = play_one(client, session, catalog, fetch_state(client, session), args.selector, parse_pairs(args.pairs))
    report_after_actions(room, catalog, session, args)
    return 0


def command_turn(args: argparse.Namespace) -> int:
    """Play several actions in one call: one round trip per turn instead of one per action."""
    client = CityClient(args.url)
    session = Session.load(session_dir(args.dir))
    catalog = load_catalog(client, session)
    room = fetch_state(client, session)
    for number, step in enumerate(args.actions, start=1):
        parts = step.split()
        if not parts:
            raise SystemExit("каждый шаг должен выглядеть как «3» или «basic_action kind=work»")
        try:
            room = play_one(client, session, catalog, room, parts[0], parse_pairs(parts[1:]))
        except SystemExit as exc:
            # Earlier steps already went through, so say exactly where the chain stopped.
            raise SystemExit(f"шаг {number} из {len(args.actions)} («{step}») не сыгран: {exc}") from exc
        game = room.get("game")
        if game and game["status"] != "playing":
            break
    report_after_actions(room, catalog, session, args)
    return 0


def command_log(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    session = Session.load(session_dir(args.dir))
    catalog = load_catalog(client, session)
    room = fetch_state(client, session)
    game = room.get("game")
    if not game:
        raise SystemExit("the game has not started yet")
    log = game["event_log"]
    window = log if args.limit <= 0 else log[-args.limit :]
    for event in window:
        print(describe_event(event, game, catalog))
    return 0


def command_wait(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    session = Session.load(session_dir(args.dir))
    catalog = load_catalog(client, session)
    deadline = time.monotonic() + args.timeout
    revision: int | None = None
    while True:
        room = client.state(
            session.room_id,
            password=session.password,
            viewer_id=session.player_id,
            after_revision=revision,
        )
        if room.get("changed") is not False:
            revision = int(room["revision"])
            game = room.get("game")
            if game and (game["status"] == "finished" or room.get("legal_actions")):
                print_state(room, catalog, session, args)
                return 0
        if time.monotonic() >= deadline:
            print(f"за {args.timeout}s ход так и не перешёл ко мне (rev {revision})")
            return 1
        time.sleep(args.interval)


def command_rooms(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    for room in client.rooms():
        print(
            f"{room['id']:<14} {room['name']:<24} {room['status']:<9} "
            f"игроков {room['players']}/{room['capacity']} (людей {room['humans']}) rev {room['revision']}"
        )
    return 0


def command_seats(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    room_id = args.room or Session.load(session_dir(args.dir)).room_id
    room = client.room(room_id)
    print(f"комната «{room['name']}» ({room['id']}) · {room['status']}")
    for seat in room["seats"]:
        print(
            f"  место {seat['index']}: {seat['kind']:<6} {seat.get('name') or '—':<16} "
            f"id={seat.get('player_id') or '—'} {seat.get('difficulty') if seat['kind'] == 'bot' else ''}"
        )
    return 0


def command_delete(args: argparse.Namespace) -> int:
    client = CityClient(args.url)
    session = Session.load(session_dir(args.dir))
    client.delete(session.room_id, password=session.password)
    session.journal({"action": "delete", "room_id": session.room_id})
    print(f"комната {session.room_id} удалена")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent_play", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--url", default=DEFAULT_BASE_URL, help="backend base URL")
    parser.add_argument("--dir", type=Path, default=None, help="session directory (default .agent_play)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_view_flags(target: argparse.ArgumentParser) -> None:
        target.add_argument("--json", action="store_true", help="dump the raw room view instead of text")
        target.add_argument("--no-actions", action="store_true", help="hide the legal-action list")
        target.add_argument("--log", type=int, default=8, help="how many chronicle lines to show")

    new = subparsers.add_parser("new", help="create a room, take a seat, add bots and start")
    new.add_argument("--name", default="Agent table", help="room name")
    new.add_argument("--password", default="agentplay", help="room password (4+ chars)")
    new.add_argument("--capacity", type=int, default=4, help="total seats")
    new.add_argument("--bots", type=int, default=3, help="bot seats to fill from the end")
    new.add_argument("--difficulty", default="expert", choices=BOT_DIFFICULTIES)
    new.add_argument("--bot-role", default=None, help="preferred role for every bot")
    new.add_argument("--rounds", type=int, default=15, help="rounds in the game")
    new.add_argument("--role-price", type=int, default=3, help="influence price of a free role")
    new.add_argument("--seat", type=int, default=0, help="my seat index")
    new.add_argument("--me", default="Claude", help="my player name")
    new.add_argument("--seed", type=int, default=None, help="deterministic RNG seed")
    new.add_argument("--no-start", action="store_true", help="do not start; wait for humans to join")
    add_view_flags(new)
    new.set_defaults(handler=command_new)

    join = subparsers.add_parser("join", help="take a seat in an existing room")
    join.add_argument("--room", required=True)
    join.add_argument("--password", required=True)
    join.add_argument("--seat", type=int, required=True)
    join.add_argument("--me", default="Claude")
    add_view_flags(join)
    join.set_defaults(handler=command_join)

    start = subparsers.add_parser("start", help="start the saved room")
    start.add_argument("--seed", type=int, default=None)
    add_view_flags(start)
    start.set_defaults(handler=command_start)

    state = subparsers.add_parser("state", help="print the board and my legal actions")
    add_view_flags(state)
    state.set_defaults(handler=command_state)

    do = subparsers.add_parser("do", help="play a legal action by index or by type plus payload")
    do.add_argument("selector", help="printed index, or a command type such as basic_action")
    do.add_argument("pairs", nargs="*", help="payload filters, e.g. kind=work target_id=seat-2")
    do.add_argument("--quiet", action="store_true", help="print only the action and the new events")
    do.add_argument("--board", action="store_true", help="redraw the whole board instead of the short status")
    add_view_flags(do)
    do.set_defaults(handler=command_do)

    turn = subparsers.add_parser("turn", help="play several actions in one call")
    turn.add_argument("actions", nargs="+", help='one quoted step each: "3" "basic_action kind=work" "end_turn"')
    turn.add_argument("--quiet", action="store_true", help="print only the actions and the new events")
    turn.add_argument("--board", action="store_true", help="redraw the whole board at the end")
    add_view_flags(turn)
    turn.set_defaults(handler=command_turn)

    log = subparsers.add_parser("log", help="print the chronicle")
    log.add_argument("--limit", type=int, default=25, help="0 for the whole log")
    log.set_defaults(handler=command_log)

    wait = subparsers.add_parser("wait", help="poll until it is my turn again, then draw the board")
    # Three opponents thinking through a turn each can easily outlast ten minutes.
    wait.add_argument("--timeout", type=float, default=1800.0)
    wait.add_argument("--interval", type=float, default=4.0)
    add_view_flags(wait)
    wait.set_defaults(handler=command_wait)

    rooms = subparsers.add_parser("rooms", help="list active rooms")
    rooms.set_defaults(handler=command_rooms)

    seats = subparsers.add_parser("seats", help="show seats of a room")
    seats.add_argument("--room", default=None, help="defaults to the saved session room")
    seats.set_defaults(handler=command_seats)

    delete = subparsers.add_parser("delete", help="delete the saved room")
    delete.set_defaults(handler=command_delete)
    return parser


def main(argv: list[str] | None = None) -> int:
    # The board is rendered in Russian; a piped stdout on Windows defaults to the ANSI codepage
    # and would raise UnicodeEncodeError on the first line.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    try:
        return int(args.handler(args))
    except HttpError as exc:
        print(f"ошибка API: {exc}", file=sys.stderr)
        return 2
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
