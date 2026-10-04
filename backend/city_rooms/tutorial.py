"""The tutorial table: a prepared position, three extras who only end their turns, and a loaded die.

The tutorial is played through the real engine — every step is an ordinary command, checked and
applied the way it is at any table — so the rules it teaches cannot drift from the rules the game
plays. What is prepared is only the position: the player's purse, the market, the project board,
the top of the action deck and a rival one scandal short of losing his seat. The client walks the
player through it step by step; the script lives there, the position lives here.

One long first turn instead of the usual three actions: the whole lesson fits in it, so the rivals do
not move, the market does not rotate and nothing can knock the script off course. When the player
ends that turn the round closes for real — settlement, market rotation, the project board, the
turn order — and the client shows what changed. Victor, stripped of his seat during the lesson,
answers with a «Компромат» in that round transition, so the player watches the Защита they bought
take the hit and burn.
"""

from __future__ import annotations

import secrets

from city_engine.commands import Command
from city_engine.constants import GREY_DIE_SIDES
from city_engine.engine import CityEngine
from city_engine.factory import PlayerSetup, create_game_from_catalog
from city_engine.models import GameState, HeldCard, MarketAsset
from city_rooms.models import RoomSeat, RoomState

PLAYER_ID = "seat-1"
VICTOR_ID = "seat-2"

# The extras' names in the player's language; the first one is the rival the lesson aims at.
RIVAL_NAMES = {
    "ru": ("Виктор", "Лина", "Марко"),
    "en": ("Victor", "Lina", "Marco"),
    "cs": ("Viktor", "Lina", "Marco"),
}

# The position, tuned so that every step of the script is affordable and nothing is left over that
# would tempt the player off it (see test_tutorial for the full walk). One long first turn: ten
# actions, plus the one «Мобилизация ресурсов» adds.
START_MONEY = 38
START_INFLUENCE = 14
START_ACTIONS = 10
# The market: the object of step 3, the key of step 8 (Серый сектор and logistics at once — it opens
# the river port and the grey operations with one purchase), and four plain commons for the scenery.
MARKET = ("pharmacy_chain", "smuggling", "metal_base", "insurance_agency", "accounting", "web_studio")
# A project with no condition, one that needs a logistics object, and two out of reach.
PROJECTS = ("charity_fund", "river_port", "craft_quarter", "city_board")
# The two cards the purchase of step 6 draws.
DECK_TOP = ("mobilization", "popular_support")
# Victor holds the seat the player strips him of, and a card to answer with.
VICTOR_ROLE = "capitalist"
VICTOR_SCANDALS = 4
VICTOR_CARD = "kompromat"
# The face the lesson's grey operation lands on: a full effect.
GREY_FACE = 5

# Room names never reach the room list (tutorial rooms are filtered out), but they must be unique.
_NAME_PREFIX = "tutorial"


def build_tutorial_room(player_name: str, lang: str, password_hash: str, seed: int | None = None) -> RoomState:
    names = RIVAL_NAMES.get(lang, RIVAL_NAMES["en"])
    room_id = secrets.token_urlsafe(8)
    seats = [
        RoomSeat(index=0, kind="human", player_id=PLAYER_ID, name=player_name),
        *(
            RoomSeat(index=index, kind="bot", player_id=f"seat-{index + 1}", name=name)
            for index, name in enumerate(names, start=1)
        ),
    ]
    game = create_game_from_catalog(
        room_id,
        [PlayerSetup(id=seat.player_id or "", name=seat.name or "", is_bot=seat.kind == "bot") for seat in seats],
        seed=secrets.randbelow(2**32) if seed is None else seed,
    )
    _prepare(game)
    room = RoomState(
        id=room_id,
        name=f"{_NAME_PREFIX}-{room_id}",
        password_hash=password_hash,
        seats=seats,
        status="playing",
        game=game,
        tutorial=True,
    )
    room.validate()
    return room


def _prepare(game: GameState) -> None:
    """Rewrite the dealt position into the lesson's: the player opens, with the lesson's market."""
    order = [player.id for player in game.players]
    game.starting_player_index = 0
    game.current_player_index = 0
    game.turn_order = order
    for player in game.players:
        player.turns = 1 if player.id == PLAYER_ID else 0
    game.actions_left = START_ACTIONS

    me = game.player_by_id(PLAYER_ID)
    me.money, me.influence = START_MONEY, START_INFLUENCE

    victor = game.player_by_id(VICTOR_ID)
    victor.role = VICTOR_ROLE
    victor.scandals = VICTOR_SCANDALS
    victor.hand = [HeldCard(uid=f"card:{VICTOR_CARD}:tutorial", card_id=VICTOR_CARD)]
    for player in game.players:
        player.roofs = 0

    dealt = [item.card_id for item in game.market]
    game.market = [MarketAsset(uid=f"asset:{card_id}", card_id=card_id) for card_id in MARKET]
    game.market_deck = [card_id for card_id in [*dealt, *game.market_deck] if card_id not in MARKET]

    rest = [project_id for project_id in [*game.project_board, *game.project_deck] if project_id not in PROJECTS]
    game.project_board = list(PROJECTS)
    game.project_deck = rest

    deck = list(game.action_deck)
    for card_id in DECK_TOP:
        deck.remove(card_id)
    game.action_deck = [*DECK_TOP, *deck]
    game.validate()


def extra_command(engine: CityEngine, game: GameState, actor_id: str) -> Command:
    """What an extra does on its turn: Victor answers once with his card, everybody else passes."""
    actor = game.player_by_id(actor_id)
    for held in actor.hand:
        target = game.player_by_id(PLAYER_ID)
        if held.card_id == VICTOR_CARD and target.roofs > 0:
            return Command(
                type="play_action_card",
                actor_id=actor_id,
                payload={"card_uid": held.uid, "target_id": PLAYER_ID},
                expected_revision=game.revision,
            )
    return Command(type="end_turn", actor_id=actor_id, payload={}, expected_revision=game.revision)


def load_the_die(game: GameState, face: int = GREY_FACE) -> None:
    """Preset the generator so the next roll shows ``face`` before modifiers — the lesson's success.

    The roll is the next value of the game's LCG; this is the same preset the bots use to price
    each face of the die (``city_bots.ledger.grey_outcomes``).
    """
    draw = ((face - 1) * 2**32) // GREY_DIE_SIDES + 1
    game.rng.state = ((draw - 1_013_904_223) * pow(1_664_525, -1, 2**32)) % 2**32
