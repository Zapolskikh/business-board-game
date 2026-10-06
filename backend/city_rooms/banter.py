"""What the bots say at the table: a rare line when something happens to them or because of them.

A bot's remark is a chat message like any other — on the room, out of the game, out of the journal —
except that it carries no text. The server only decides *that* a bot speaks and *about what*
(``line = {trigger, n}``); the words live in the clients' locale files, picked by the bot's policy
and ``n``. So the server stays out of the language question: three players reading three languages
at one table each get the joke in their own.

Rare on purpose. A bot that comments on every purchase is a notification feed; one that speaks up
twice a game — when it lost its seat, when its operation blew up — is a character. Hence the three
brakes: a chance per trigger, one line per bot a round, and a cap per bot a game.

Nothing here touches the game's own dice: the choice uses the service's separate generator.
"""

from __future__ import annotations

from random import Random
from typing import Any

from city_engine.engine import CityEngine
from city_rooms.models import RoomState

# How likely each trigger is to be voiced, in the order the triggers are preferred when one command
# produced several: losing a seat outranks a blocked hit, which outranks a nice purchase.
TRIGGERS: dict[str, float] = {
    "won": 1.0,
    "lost": 0.6,
    "jailed": 0.8,
    "lost_role": 0.6,
    "took_your_role": 0.6,
    "blocked": 0.5,
    "robbed": 0.4,
    "smeared": 0.35,
    "grey_fail": 0.35,
    "grey_full": 0.25,
    "legendary": 0.35,
    "big_project": 0.3,
}
BIG_PROJECT_POINTS = 8
LINES_PER_BOT = 6
# Powers a human points at a bot: what the bot says depends on what the power does.
SMEAR_POWERS = frozenset({"journalist_inflate", "journalist_publish"})
ROBBERY_POWERS = frozenset({"mafia_racket", "military_sanction", "fraudster_crypto_scam"})


def _candidates(engine: CityEngine, room: RoomState, events: list[Any]) -> list[tuple[str, str]]:
    """(bot id, trigger) for everything in these events a bot could have something to say about."""
    game = room.game
    if game is None:
        return []
    bots = {player.id for player in game.players if player.is_bot}
    found: list[tuple[str, str]] = []
    for event in events:
        actor = event.actor_id
        data = event.data
        target = data.get("target_id")
        if event.type == "scandal_limit_reached" and actor in bots:
            found.append((actor, "jailed" if data.get("jailed") else "lost_role"))
        elif event.type == "role_stripped" and target in bots:
            found.append((target, "lost_role"))
        elif event.type == "role_claimed" and data.get("previous_holder_id"):
            holder = data["previous_holder_id"]
            if actor in bots and holder not in bots:
                found.append((actor, "took_your_role"))
            elif holder in bots and actor not in bots:
                found.append((holder, "lost_role"))
        elif event.type == "targeted_effect_blocked" and actor in bots:
            found.append((actor, "blocked"))
        elif event.type == "grey_operation_resolved":
            if actor in bots:
                if data.get("tier") == "fail":
                    found.append((actor, "grey_fail"))
                elif data.get("tier") == "full" and not data.get("blocked"):
                    found.append((actor, "grey_full"))
            elif target in bots and data.get("success") and not data.get("blocked"):
                found.append((target, "robbed"))
        elif event.type == "role_power_used" and actor not in bots and target in bots:
            if data.get("power") in SMEAR_POWERS:
                found.append((target, "smeared"))
            elif data.get("power") in ROBBERY_POWERS:
                found.append((target, "robbed"))
        elif event.type == "asset_bought" and actor in bots:
            if engine.asset(str(data.get("asset_id"))).rarity == "legendary":
                found.append((actor, "legendary"))
        elif event.type == "city_project_taken" and actor in bots:
            if int(data.get("points", 0)) >= BIG_PROJECT_POINTS:
                found.append((actor, "big_project"))
        elif event.type == "game_finished":
            winner = data.get("winner_id")
            found += [(bot, "won" if bot == winner else "lost") for bot in sorted(bots)]
    # A hit the Защита swallowed is «blocked», not «smeared»: the story never landed.
    shielded = {bot for bot, trigger in found if trigger == "blocked"}
    return [(bot, trigger) for bot, trigger in found if not (bot in shielded and trigger in {"smeared", "robbed"})]


def bot_remark(engine: CityEngine, room: RoomState, events: list[Any], rng: Random) -> dict[str, Any] | None:
    """At most one line for everything that just happened, appended to the room's chat."""
    game = room.game
    if game is None or room.tutorial:
        return None
    spoken: dict[str, list[dict[str, Any]]] = {}
    for message in room.chat:
        if message.get("line"):
            spoken.setdefault(str(message["player_id"]), []).append(message)
    order = list(TRIGGERS)
    for bot, trigger in sorted(_candidates(engine, room, events), key=lambda item: (order.index(item[1]), item[0])):
        said = spoken.get(bot, [])
        final = trigger in {"won", "lost"}
        if len(said) >= LINES_PER_BOT and not final:
            continue
        if said and said[-1].get("round") == game.round_number and not final:
            continue
        if rng.random() >= TRIGGERS[trigger]:
            continue
        seat = next(seat for seat in room.seats if seat.player_id == bot)
        message = room.add_chat(bot, str(seat.name), "")
        message["line"] = {"trigger": trigger, "n": rng.randrange(1000)}
        return message
    return None
