"""Version and rules constants persisted with every game snapshot."""

SCHEMA_VERSION = 1
# 1.4.0-rc.1: the asset market expires in rounds instead of turns and rotates only when a round
# opens, so `MarketAsset` carries a different field and old snapshots cannot be replayed.
#
# 1.3.0-rc.2: the project board is re-dealt in full instead of rotating one card, and that now costs
# an action on top of the money; money printed on action cards grows with the round.
#
# 1.3.0-rc.1: the influence economy pass. Campaign converts money in tiers, selling an object is
# free, object replacement is gone, both rerolls are priced in money, and two grey operations now
# trade in influence instead of cash. Snapshots taken under 1.2.x would be scored against rules
# their players never agreed to, so state validation rejects them.
# 1.5.0: money and influence stop scoring. They used to pay 1 point per 10$ and per 3◆, and two
# measured games ended with a quarter to a third of every final score sitting in a wallet its owner
# never spent — one bot finished last holding 410$, another ended on 72◆ with nothing left to buy.
# Both are fuel now. The only way out of a pile is an action: patronage (10$ → 2) for money,
# lobbying (6◆ → 2) for influence, one press of each a turn.
#
# 1.4.1: patronage. A live 15-round game on 1.4.0 finished with 1217$ unspent across the table —
# 121 points of dead capital — because the only sinks need a slot or influence. One basic action now
# turns 10$ into 2 points, unbounded and repeatable, at a rate deliberately worse than an object or
# a project.
#
# 1.4.0: the simplification pass. Automation, city events, forged/copied roles, the investment
# action pool and business upkeep leave the game; the three defences merge into one Крыша; campaign
# has one tier; every scandal cleanup costs an action; grey operations gate on a district instead of
# one card; the asset market rotates its three oldest slots once a round; cards can buy points
# outright. Snapshots taken under 1.3.x describe a game with different rules, so state validation
# rejects them — old rooms will not open.
RULES_VERSION = "city-1.5.0"
# 2026-08-21a: 37 action cards. The automation and role-forgery cards are gone, replaced by the
# «деньги → очки» family and «Предписание о демонтаже» (takes a development level); the two defence
# cards now hand out the same Крыша as the third; the two projects that required automation ask for
# tagged objects instead. The events array is gone from the catalog entirely.
CONTENT_VERSION = "city-content-2026-08-21a"

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

MIN_PLAYERS = 2
MAX_PLAYERS = 6
MIN_ROUNDS = 5
MAX_ROUNDS = 30
MIN_ROLE_PRICE = 2
MAX_ROLE_PRICE = 10
MAX_CAPACITY = 6
CAPACITY_COSTS = {3: 6, 4: 10, 5: 15}

# Money and influence do not score at all. Two measured games ended with 25-45 points per player
# sitting in a wallet nobody had spent — a third of the final score decided by a resource its owner
# never played. The passive rates are gone; both currencies are pure fuel, and the only way out of a
# pile is an action: patronage for money, lobbying for influence, one press of each a turn.
#
# What the rates were, for the record: 10$ and 3◆ a point. The sinks below are priced against them —
# money is dearer per point than it used to be for a reason (income runs to 60$ a round), influence
# keeps the same 3◆ because it was never the currency in surplus.
PATRONAGE_MONEY = 10
PATRONAGE_POINTS = 2
LOBBYING_INFLUENCE = 6
LOBBYING_POINTS = 2
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
# How many market slots the opening of a round replaces: the oldest three of six.
#
# This used to be a per-slot countdown — six independent timers printed as "⏳2р" on every card —
# and before that it was counted in turns, which made the printed number a lie at any table size.
# One rotation a round, at a fixed size, is the same freshness with one rule instead of six clocks,
# and the three slots leaving are marked so the choice "buy now or wait" stays answerable.
#
# Not all six: half the market has to survive, or the see-it/save-for-it/buy-it loop breaks. Income
# in rounds 1-5 is 3-15$ while a legendary object costs 17-18$, and the expensive rarities only
# enter the deck from a certain round (`rarity_min_round`) — with a full rotation the round you are
# rich has to coincide with the round the card appears, which turns the top of the catalog into a
# lottery. Cards that rotate out go to the bottom of the deck, so nothing leaves the game.
MARKET_ROTATION_SIZE = 3

# The journalist trades in scandals, so the role-loss threshold that everybody else hits at 5
# would put their optimal play one point from collapse. Jail still follows one step later.
JOURNALIST_SCANDAL_LIMIT = 6
# Money into influence, one action, three tiers. The action — not the money — was the real price
# of influence: campaign was the only scalable source and it was capped at 2◆ per action, so a
# player holding 264$ and 2◆ had no way to convert. Rates worsen as the tier grows (1.0 / 1.67 /
# 2.25 $ per ◆), so the cheap trade stays the default and the expensive one is for a full wallet.
CAMPAIGN_TIERS = {5: 3}
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
# What a point costs when a card buys it outright: worse than an object (2$) and much better than a
# hoarded point (10$), and it needs no slot — which is the whole point. Six slots cap the object
# channel, so a full tableau had nowhere to put money: two measured matches ended with 248$ and 864$
# unspent across the table, 24 and 86 points nobody made a decision about.
POINTS_CARD_RATE = 5
# What discarding a card returns, so a bad draw is not a dead 3$.
CARD_DISCARD_VALUE = 2
# What the tax manoeuvre pays to run money into influence. It has to beat the discard — a card that
# gives 2◆ for 8$ is strictly worse than the same card thrown away for 2◆ — and it buys the top
# campaign tier without spending the action, which is the point of playing a card at all.
CASH_TO_INFLUENCE_MONEY = 8
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
#
# The campaign now has a single tier at 5$ → 3◆, which is a better rate than the old top tier, so
# the grey channel had to move again: at 3 + round/3 it pays 9$ → 6◆ by round ten and stays ahead
# of the button in every round of the game. That is the whole argument for owning the object.
LAUNDERING_BASE_GAIN = 3
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
