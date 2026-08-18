"""Version and rules constants persisted with every game snapshot."""

SCHEMA_VERSION = 1
# 1.3.0-rc.1: the influence economy pass. Campaign converts money in tiers, selling an object is
# free, object replacement is gone, both rerolls are priced in money, and two grey operations now
# trade in influence instead of cash. Snapshots taken under 1.2.x would be scored against rules
# their players never agreed to, so state validation rejects them.
RULES_VERSION = "city-1.3.0-rc.1"
CONTENT_VERSION = "city-content-2026-08-18a"

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
# At 2$ it was measured free — four expert bots spent 3.6$ each on it across a whole game while
# finishing on 264$. 4$ is still cheap enough to use as a tool and dear enough to notice.
MARKET_REROLL_COST = 4
# Money into influence, one action, three tiers. The action — not the money — was the real price
# of influence: campaign was the only scalable source and it was capped at 2◆ per action, so a
# player holding 264$ and 2◆ had no way to convert. Rates worsen as the tier grows (1.0 / 1.67 /
# 2.25 $ per ◆), so the cheap trade stays the default and the expensive one is for a full wallet.
CAMPAIGN_TIERS = {2: 2, 5: 3, 9: 4}
# One automation token per player, bought once and then moved between own objects for free.
AUTOMATION_COST = 6
# Refreshing the oldest project on the board: the expired card goes to the bottom of the deck.
# Priced in money, but an order of magnitude above the market reroll. Influence was the wrong
# currency: it is the one the projects themselves are bought with, so the reroll was a tax on the
# exact resource the board wants you to spend, and 39.6% of measured turns already ended with a
# satisfied project the player could not afford. Money has the opposite problem — at 3$ a
# four-expert table paid 18 rotations a game and re-dealt 3.4 of the 4 slots every round, which
# deletes the planning layer. 10$ once a turn is the price at which a rotation is a decision
# about a dead board rather than a default end-of-turn click.
PROJECT_REROLL_MONEY = 10
# An action card is a blind draw that costs an action, so it competes with the basic actions.
ACTION_CARD_COST = 3
# What discarding a card returns, so a bad draw is not a dead 3$.
CARD_DISCARD_VALUE = 2
# Scandal cleanup is priced in influence: at 10$ = 1 point money made it effectively free and the
# whole attack layer stopped mattering.
CRISIS_PR_INFLUENCE = 3

# --- grey operations -------------------------------------------------------------------------
# Laundering used to pay 2◆ for 5+round dollars: it spent the scarce resource to make the one
# already in surplus, which is why it was taken 15 times in 24 measured games. Reversed, it is the
# only unbounded money→influence channel in the game, and it charges scandals for the privilege.
#
# Both sides scale with the round, and that is the whole point. A flat 3◆ against a stake that grew
# with the round was measured strictly worse than the top campaign tier by round six — 11$ for 3◆
# against 9$ for 4◆, plus a scandal — and four expert bots used it zero times in 24 games. The gain
# has to outpace the stake, or the grey channel is dominated by the basic action it is meant to
# beat. It stays honest because a scandal is a point and the object costs a slot.
LAUNDERING_BASE_GAIN = 2
LAUNDERING_BASE_COST = 4
# Hacking used to block the target's best object for one round — worth about 4$ against a player
# holding 264$, so it was used zero times in 24 games. It now takes influence instead, which is
# the only resource anybody is short of, and the block mechanic leaves the operation entirely.
HACK_INFLUENCE_STEAL = 4
# Leaking compromat strips a role: -3 points, the whole passive behind it, and the seat opens at
# the free price instead of the threefold takeover. Priced in influence so it competes with the
# projects, and limited to once a round because a per-turn cadence would let one player hold the
# whole role board hostage. A roof or a court injunction absorbs it like any other attack.
COMPROMAT_INFLUENCE = 3
COMPROMAT_CHANCE = 0.7
