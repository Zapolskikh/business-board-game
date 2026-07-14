"""Version and rules constants persisted with every game snapshot."""

SCHEMA_VERSION = 1
RULES_VERSION = "city-1.0.0-rc.1"
CONTENT_VERSION = "city-content-2026-07-14"

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
BOT_DIFFICULTIES = ("easy", "medium", "hard")

MIN_PLAYERS = 2
MAX_PLAYERS = 6
MIN_ROUNDS = 5
MAX_ROUNDS = 30
MIN_ROLE_PRICE = 2
MAX_ROLE_PRICE = 10
MAX_CAPACITY = 6
CAPACITY_COSTS = {3: 6, 4: 10, 5: 15}
