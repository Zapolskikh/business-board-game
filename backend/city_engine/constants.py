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
# 1.6.0: the role pass. Every perk either earns its place or leaves, and three roles gain a tie to
# a district that is not their own. Capitalist: the -1$ discount goes, business conditions are
# satisfied by charter, +1◆ per own industrial object. Politician: the flat +1◆ and the housing
# influence go, administrative objects pay 2◆ each. Journalist: the news line goes, money is 1$ a
# rival scandal and 2$ with a business object, the rating ceiling is 2 plus one per housing object,
# and the publication costs an action for two scandals. Fraudster: flat +20%/+10% chance instead of
# two ladders, the comeback pays influence, and the crypto scam is now 25% of every wallet for five
# scandals. Mafia: racket money from Серый сектор objects, influence from administrative ones.
# Military: a sanction ladder at 2/3/4 scandals, no object confiscation, no healing the target.
#
# 1.5.1: the passive payout is back at 10$ and 3◆ a point, and lobbying is repriced to 3◆ → 2
# points so that both sinks pay double what hoarding pays. See the note above the constants for the
# measurement that reverted 1.5.0.
#
# 1.5.0: money and influence stopped scoring. They used to pay 1 point per 10$ and per 3◆, and two
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
RULES_VERSION = "city-1.6.0"
# 2026-08-22a: the role texts finally describe the game. They still advertised investment
# actions, forged roles, the burn-contacts power and the district tribute — all deleted between
# 1.4.0 and 1.5.1 — and a player read them in the role tooltip.
#
# 2026-08-21a: 37 action cards. The automation and role-forgery cards are gone, replaced by the
# «деньги → очки» family and «Предписание о демонтаже» (takes a development level); the two defence
# cards now hand out the same Крыша as the third; the two projects that required automation ask for
# tagged objects instead. The events array is gone from the catalog entirely.
CONTENT_VERSION = "city-content-2026-08-22a"

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

# Both currencies score at the end, at a deliberately poor rate. Removing the payout entirely was
# tried and reverted: the score became honest — only what a player had actually played — but the
# winner's margin doubled from 11 points to 19, because the trailing players' wallets had been the
# thing keeping the table close. A cushion that flatters the loser turns out to be doing real work.
MONEY_PER_POINT = 10
INFLUENCE_PER_POINT = 3
# ...and the two sinks stay, because holding is not supposed to be the best a pile can do. Each
# costs an action, each may be pressed once a turn, and each pays **exactly double** what the same
# resource would score sitting still: 10$ scores 1 point but patronage pays 2, and 3◆ scores 1 point
# but lobbying pays 2. That factor is the whole design — enough to be worth a turn when the board
# has nothing left to sell you, never enough to beat an object (2$ a point) or a project (~1◆ a
# point). Lobbying was 6◆ for 2 while the passive rate was gone; at 3◆ = 1 point it had to halve or
# it would have been an action spent to gain nothing.
PATRONAGE_MONEY = 10
PATRONAGE_POINTS = 2
LOBBYING_INFLUENCE = 3
LOBBYING_POINTS = 2
# Unique city projects are the score engine, so the board is a shared race, not a personal counter.
PROJECT_BOARD_SIZE = 4
# Repeatable initiatives: never in the deck, never leave, may be taken any number of times by
# anybody. They are the floor that stops the last rounds from having no scoring outlet at all.
# Listed here (and cross-checked against the catalog) so state validation can exempt them from
# the "every project exists once" rule without loading content.
REPEATABLE_PROJECT_IDS = ("city_initiative", "municipal_programme")
# These are genuinely unlimited. A per-game cap of three lived here for a while, but it was a rule
# no surface ever printed: the board header, the card face and the catalog text all promise "any
# number of times", so the cap only ever showed up as a project silently vanishing from the legal
# moves. The influence sink is the point — without it a politician ends the game sitting on 55◆ of
# dead weight once the board stops offering projects whose condition he meets.
#
# What stops the sink from becoming the whole game is price, not a wall: every initiative already
# taken makes the next one dearer. Uncapped and flat, initiatives took 31% of all project points
# and one live game ended 18 initiatives out of 21 projects — nine identical clicks in the last
# three rounds. Escalating keeps the first few as the good deal they should be, and makes the
# eleventh arithmetically worse than lobbying, which is what should be reclaiming those actions.
INITIATIVE_SURCHARGE_INFLUENCE = 1
INITIATIVE_SURCHARGE_MONEY = 2
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

# --- roles ------------------------------------------------------------------------------------
# The journalist owns no district, so both of its lines hang off somebody else's quarter: the
# influence ceiling starts here and rises by one for every housing object it owns (readers), and
# the money rate is 1$ per rival scandal, doubled by a single business object (connections).
JOURNALIST_RATING_BASE = 2
# The publication costs an action now and lands twice as hard. Two free attacks a turn — inflate
# *and* publish on top of three ordinary actions — was the journalist's real edge over every other
# role, none of which has a power that skips the action cost.
PUBLICATION_SCANDALS = 2
# The fraudster's grey bonus, flat and single. It used to be split in two — +20% for the role and
# +10% more for holding any Технокластер object — which meant the crypto exchange, itself a
# Технокластер object, silently granted both and pinned every fraudster operation at the 0.9 ceiling.
# One number that the player can read off the role card is worth more than two that stack invisibly.
FRAUDSTER_GREY_BONUS = 0.30
# Grey operations pay victory points on success, not just money. Measured over four games: a
# fraudster who ran ten operations converted them into roughly twelve points, because the payout was
# money and money is the weakest currency in the game at 10$ per point. An operation now scores like
# a small project, and the odds pay for it — every base chance below dropped by 15 points, so the
# move became a real bet instead of a formality. Fraudster at 75% on the crypto exchange nets 4.1
# points per action against 2.3 before; everybody else sits near a coin flip, slightly ahead of the
# 2 points a patronage would have paid, which is exactly where a gamble belongs.
GREY_OPERATION_POINTS = 3
# The hack and the compromat leak cost two scandals apiece and the leak strips a role outright, so
# they carry the higher payout — and, after the 15-point cut, the two longest odds on the board.
GREY_OPERATION_POINTS_HARD = 5
# The crypto scam takes this share of every rival's cash and hands the fraudster five scandals —
# its entire scandal budget. Bare, the role loses itself; with two reduction perks it survives.
CRYPTO_SCAM_SHARE = 25
CRYPTO_SCAM_SCANDALS = 5
# What the racket adds when its target is leading the table. The rest of the demand comes from the
# mafia's own districts: 2$ per Серый сектор object, plus a slow drift with the round.
RACKET_LEADER_BONUS = 5
# The sanction reads the target's own scandal counter: money at two, money and influence at three,
# and the role itself at four.
SANCTION_MONEY_TIER = 2
SANCTION_INFLUENCE_TIER = 3
SANCTION_ROLE_TIER = 4

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
