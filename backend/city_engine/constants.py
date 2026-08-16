"""Version and rules constants persisted with every game snapshot."""

SCHEMA_VERSION = 1
RULES_VERSION = "city-1.2.0-rc.1"
CONTENT_VERSION = "city-content-2026-08-16b"

DISTRICT_IDS = (
    "residential",
    "business",
    "industrial",
    "tech",
    "government",
    "shadows",
)
ROLE_IDS = (
    "capitalist",
    "politician",
    "journalist",
    "fraudster",
    "mafia",
    "military",
)
BOT_DIFFICULTIES = ("easy", "medium", "hard", "expert")
# Events are off while the base mechanics are tuned; every game runs the neutral year.
NEUTRAL_EVENT_ID = "stable_year"

MIN_PLAYERS = 2
MAX_PLAYERS = 6
MIN_ROUNDS = 5
MAX_ROUNDS = 30
MIN_ROLE_PRICE = 2
MAX_ROLE_PRICE = 10
MAX_CAPACITY = 6
CAPACITY_COSTS = {3: 6, 4: 10, 5: 15}

# Money and influence are fuel, not score: hoarding converts at a deliberately poor rate so the
# only good use of income is spending it. Kept as constants because these two numbers set the
# whole strategic tempo and are the first thing to retune after a measurement run.
MONEY_PER_POINT = 10
INFLUENCE_PER_POINT = 3
# Unique city projects are the score engine, so the board is a shared race, not a personal counter.
PROJECT_BOARD_SIZE = 4
# Repeatable initiatives: never in the deck, never leave, may be taken any number of times by
# anybody. They are the floor that stops the last rounds from having no scoring outlet at all.
# Listed here (and cross-checked against the catalog) so state validation can exempt them from
# the "every project exists once" rule without loading content.
REPEATABLE_PROJECT_IDS = ("city_initiative", "municipal_programme")
# ...but a floor that can be pressed forever becomes the engine: unlimited initiatives took 38%
# of all project points in the arena match, and one player's last sixteen actions were twelve
# identical clicks. Three per game keeps them as a way out of a dead hand, not as a strategy.
MAX_REPEATABLE_PROJECTS = 3
# Upkeep per object each round. Doubling it to 2$ was measured: dead capital halved (194$ → 96$)
# but the winner-loser spread doubled with it (35% → 67%), because upkeep hits hardest whoever is
# already behind and cannot replace the object. Left at 1$; the money surplus needs a sink that
# scales with success, not with ownership.
MAINTENANCE_PER_ASSET = 1

# The journalist trades in scandals, so the role-loss threshold that everybody else hits at 5
# would put their optimal play one point from collapse. Jail still follows one step later.
JOURNALIST_SCANDAL_LIMIT = 6
# Refreshing the whole asset market costs money but no action: a sink that buys tempo, not points.
MARKET_REROLL_COST = 2
# One automation token per player, bought once and then moved between own objects for free.
AUTOMATION_COST = 6
# Refreshing the oldest project on the board: the expired card goes to the bottom of the deck.
PROJECT_REROLL_COST = 3
# An action card is a blind draw that costs an action, so it competes with the basic actions.
ACTION_CARD_COST = 3
# What discarding a card returns, so a bad draw is not a dead 3$.
CARD_DISCARD_VALUE = 2
# Scandal cleanup is priced in influence: at 10$ = 1 point money made it effectively free and the
# whole attack layer stopped mattering.
CRISIS_PR_INFLUENCE = 3
