"""Version and rules constants persisted with every game snapshot.

Why the versions matter: a snapshot carries the rules it was played under, and the engine refuses
to open a room whose version does not match. Scoring an old board by today's rules would settle it
against an agreement its players never made. Every bump and the reasoning behind it is in
``CHANGELOG.md`` at the repository root.
"""

SCHEMA_VERSION = 1

# Bumped whenever a rule changes what a snapshot means. 1.15.0: a holder with a Крыша cannot be
# bought out of their role at all, the mafia's grey mark lasts through the next round, and a tie
# goes to whoever took more city projects. 1.16.0: an action-card draw costs 6$ instead of 3$, and the late market
# is a weighted draw instead of the recycled round-one commons.
RULES_VERSION = "city-1.16.0"

# Bumped whenever the catalog changes, even if no rule moved: card texts are part of the agreement
# too. 2026-09-30: removed the unsupported cash-exchange purchase payout. 2026-09-30b: «Судебный
# запрет» no longer promises to absorb a takeover — a Крыша now closes the seat instead.
# 2026-10-01: «Крыша» is «Защита» in every Russian text; round-scaled cards say «номер раунда»
# (which is what the engine always added) instead of «за каждый прошедший раунд».
# 2026-10-01b: city projects repriced by how hard their condition is — see CHANGELOG.
CONTENT_VERSION = "city-content-2026-10-01b"

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
# Четверо — предел стола. Шестеро растягивали круг настолько, что между своими ходами
# успевала смениться половина рынка и цели атак, а панель игроков уходила в скролл.
MAX_PLAYERS = 4
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
# costs an action and each may be pressed once a turn.
#
# The rate has to be read as a *delta*, not as a price. A pile already scores by itself, so what
# the button really pays is the difference: patronage takes 20$ that were worth 2 points and pays
# 5, lobbying takes 10◆ that were worth 3 and pays 6. Both net +3 against an action worth ~2, so
# both are worth pressing and neither is worth building a strategy around.
#
# The thresholds are deliberately large. Small ones (10$ → 2, 3◆ → 2) made these a drip pressed
# every turn by everybody, which is not a decision — it is a conversion rate with extra steps.
# A big lump means a player has to *choose* the round in which the pile stops working for them.
# Note there is no money → influence → points ladder to farm: campaign into lobbying is two actions
# for what patronage does in one, so each currency has exactly one way out.
PATRONAGE_MONEY = 20
PATRONAGE_POINTS = 5
LOBBYING_INFLUENCE = 10
LOBBYING_POINTS = 6
# Unique city projects are the score engine, so the board is a shared race, not a personal counter.
PROJECT_BOARD_SIZE = 4
# How many market slots the opening of a round replaces: the oldest three of six.
#
# Not a per-slot countdown: six independent timers printed as "⏳2р" on every card are six clocks
# for one rule, and a countdown measured in turns makes the printed number a lie at any table size.
# One rotation a round, at a fixed size, is the same freshness with one rule, and the three slots
# leaving are marked so the choice "buy now or wait" stays answerable.
#
# Not all six: half the market has to survive, or the see-it/save-for-it/buy-it loop breaks. Income
# in rounds 1-5 is 3-15$ while a legendary object costs 17-18$, and the expensive rarities only
# enter the deck from a certain round (`rarity_min_round`) — with a full rotation the round you are
# rich has to coincide with the round the card appears, which turns the top of the catalog into a
# lottery. Cards that rotate out go to the bottom of the deck, so nothing leaves the game.
MARKET_ROTATION_SIZE = 3
# How a late market slot is drawn. The fresh deck is dealt in order, which is what builds the
# progression — commons early, legendaries from round 8. After that, dealing in order walked the
# market back down: the cards left under the skipped rarer ones were round-one commons, and rotated
# cards went to the bottom of the same deck, so by round 15 the market held 2.5 commons and 2.4
# uncommons out of six. Now, once every rarity is open, rare-and-up fresh cards still come in order
# and everything else is a random draw from the deck and the discard together, weighted so the late
# market stays late: rare and up are the draw, common and uncommon the filler.
MARKET_DISCARD_WEIGHTS = {"common": 1, "uncommon": 2, "rare": 6, "epic": 12, "legendary": 12}
# Rarities that stop being dealt in deck order once every rarity is open: from then on they only
# come out of the weighted draw, as filler.
LATE_FILLER_RARITIES = frozenset({"common", "uncommon"})

# --- roles ------------------------------------------------------------------------------------
# The publication costs an action and lands twice as hard. Two free attacks a turn — inflate
# *and* publish on top of three ordinary actions — would be the journalist's edge over every other
# role, none of which has a power that skips the action cost.
PUBLICATION_SCANDALS = 2
# The fraudster's grey bonus, flat and single. Split in two — a share for the role and more for
# holding any Технокластер object — the crypto exchange, itself a Технокластер object, would
# silently grant both and pin every fraudster operation at the 0.9 ceiling.
# One number the player can read off the role card is worth more than two that stack invisibly.
FRAUDSTER_GREY_BONUS = 0.30
# --- grey operation payouts ---------------------------------------------------------------------
# Every operation scores the same kind of thing, so the score sits in one table instead of being
# split between a plain tier and a "hard" one. Three is the price of the two that reach into a
# rival's sheet permanently — the hack takes influence outright, the leak takes the role — and two
# is the price of the rest, which is roughly what a patronage pays for the same action.
GREY_OPERATION_POINTS = {
    "smear": 2,
    "crypto": 2,
    "roof_break": 2,
    "datacenter": 3,
    "influence_broker": 3,
}
# Base odds before the fraudster's bonus. The smear hits all three rivals at once and is the
# strongest line in the table by a distance, so it deliberately sits below its neighbours rather
# than above them; the hack is the longest shot because what it takes is the scarce resource.
GREY_OPERATION_CHANCE = {
    "smear": 0.60,
    "crypto": 0.45,
    "roof_break": 0.60,
    "datacenter": 0.40,
    "influence_broker": 0.60,
}
# One rule for the whole layer, replacing five bespoke failure penalties (lose the stake, lose a
# roof, pay influence). A coin flip decides between "the effect happens and costs you one scandal"
# and "nothing happens and it costs you two" — so an operation is worth 2 - chance ≈ 1.4 scandals
# on average, and the five-scandal limit funds three or four runs a game before a cleanup is
# mandatory. The scandal, not the odds and not the price, is what paces the grey layer now.
GREY_SUCCESS_SCANDALS = 1
GREY_FAILURE_SCANDALS = 2
# One grey operation a turn, whichever the player picks. Measured over 80 games: 46.8% of every
# fraudster turn ran two or more, and 45% of the role's grey points came from those repeats — the
# fraudster finished 19 points (29%) ahead of the table on the strength of an engine it could fire
# as many times as it had actions. The cap is on the whole layer rather than per operation type: a
# limit of one *of each* raises the ceiling instead of lowering it, because a wide fraudster board
# unlocks all five by the twelfth round and a diversified run scores more than a repeated one.
# The turn flag is spent on the attempt, not the hit — see _grey_operation.
GREY_OPERATION_FLAG = "grey_operation_used"
# The crypto scam takes this share of every rival's cash and hands the fraudster five scandals —
# its entire scandal budget. Bare, the role loses itself; stacked reduction perks can make the
# prepared strategy safe. A roof protects its owner's wallet, just like from the ordinary pump.
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

# At how many scandals a held role falls. Jail follows one step later.
BASE_SCANDAL_LIMIT = 5
# The journalist trades in scandals, so the role-loss threshold that everybody else hits at 5
# would put their optimal play one point from collapse. Jail still follows one step later.
#
# The higher ceiling belongs to the seat, not to the player: a journalist who leaves the seat —
# by losing it to the limit, by being stripped, or by claiming another role — is measured against
# BASE_SCANDAL_LIMIT again from that moment, and their counter is clamped to it. Buying a role is
# gated on BASE_SCANDAL_LIMIT for everybody, so the extra headroom can never be laundered into
# another seat.
JOURNALIST_SCANDAL_LIMIT = 6
# --- the marks three roles write on the shared board --------------------------------------------
# «Договоримся»: the politician rents a district for the round the way «Зонирование» does. Priced
# in the two things the role has to weigh rather than in an action, because the politician's turn
# is already spoken for by projects. The Серый сектор is the gate — a clean politician cannot
# strike the deal at all.
POLITICIAN_DEAL_INFLUENCE = 3
# A veto closes one project to everybody else for as long as it stays on the board. The project
# rotates on the ordinary schedule and takes the veto with it, so this buys tempo on one card
# rather than freezing the board.
POLITICIAN_VETO_INFLUENCE = 3
# Taking a Крыша off a rival and putting it on your own stack. Not blocked by the token it is
# aimed at, for the same reason «Пробить крышу» is not: a defence that answers the attack on
# itself makes the whole line unreachable.
MILITARY_SEIZE_INFLUENCE = 3
# Money into influence: one action, one exchange, 5$ → 3◆. The action — not the money — was the
# real price of influence: campaign was the only scalable source and it was capped at 2◆ per
# action, so a player holding 264$ and 2◆ had no way to convert.
#
# A ladder of three tiers (2$→2◆, 5$→3◆, 9$→4◆) was tried here and did not survive: with three
# rates on one button the pick was arithmetic rather than a decision, and the cheap tier was
# simply the campaign again at a worse rate. The mapping stays a dict because the engine offers
# one candidate per key and the clients render one button per key — restoring a tier is a one-line
# change, not a refactor.
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
# 6$, not 3$: at 3$ and 1◆ the draw was the most-picked action in the game (27% of the turns it
# was legal, +1.16 points a buy against a 0.63 price), and discarding both cards for influence
# turned 3$ into 3◆ — a better rate than the exchange (5$ → 3◆) with a free lottery on top. At 6$
# the discard floor is the exchange rate, so the cards have to earn the rest by being played.
ACTION_CARD_COST = 6
# How many copies of each card the deck holds. One copy meant a four-player table exhausted the
# deck around round 9 — every draw is two cards, so the catalogue lasted about seventeen buys. From
# there on the whole card layer was simply gone, and it went precisely when the late game needs
# things to spend an action on: the board is capped at six slots, the projects want influence, and
# the money channel collapses into repeating Патронаж. Two copies carry the deck to the final
# round. Duplicates are fine by design — a card is a blind draw, not a collectible, and seeing the
# same card twice in fifteen rounds reads as luck rather than repetition.
ACTION_DECK_COPIES = 2
# How many cards a hand holds. Reaching the cap is the player's problem, not the engine's: a draw
# that finds no room is simply lost, which is what makes the «Лоббистский кабинет» a reason to
# keep spending rather than a reason to hoard.
HAND_LIMIT = 3
# One purchase a turn. The cap sits on the supply, not on the play and the discard: buying twice
# and shredding four cards would beat the campaign as an influence pump, and capping the supply
# closes that at the source while leaving a hand the player has already paid for free to spend at
# any speed — which is what a card layer needs to feel alive rather than rationed.
CARD_PURCHASE_FLAG = "action_card_bought"
# What a point costs when a card buys it outright: worse than an object (2$) and much better than a
# hoarded point (10$), and it needs no slot — which is the whole point. Six slots cap the object
# channel, so a full tableau had nowhere to put money: two measured matches ended with 248$ and 864$
# unspent across the table, 24 and 86 points nobody made a decision about.
POINTS_CARD_RATE = 3
# What discarding a card returns, so a bad draw is not a dead 3$.
CARD_DISCARD_VALUE = 2
# What the tax manoeuvre pays to run money into influence. It has to beat the discard — a card that
# gives 2◆ for 8$ is strictly worse than the same card thrown away for 2◆ — and it buys the top
# campaign tier without spending the action, which is the point of playing a card at all.
CASH_TO_INFLUENCE_MONEY = 8
# Scandal cleanup is priced in influence: at 10$ = 1 point money made it effectively free and the
# whole attack layer stopped mattering.
CRISIS_PR_INFLUENCE = 3

# --- chronicle ordering ----------------------------------------------------------------------
# Events that are the fallout of a deed rather than a deed of their own. A handler has to resolve
# these first — the block, the stripped role, the arrest all have to be known before the headline
# can report the resulting deltas — so without help the log prints the consequence above its
# cause. The engine sorts them behind the deed of the same command; see
# CityEngine._order_command_events.
CONSEQUENCE_EVENTS = frozenset(
    {
        "targeted_effect_blocked",
        "roofs_broken",
        "role_stripped",
        "free_action_card_drawn",
        "scandal_limit_reached",
        "player_jailed",
    }
)

# --- grey operations -------------------------------------------------------------------------
# The layer must not be five ways of asking the same question — "spend an action, get a resource" —
# because then a player picks whichever number is biggest and the other lines are furniture. Each
# operation produces something the others cannot, and the pick follows the position on the board
# rather than a comparison of expected values:
#
#   behind on tempo        → Вброс         (a scandal on every rival at once)
#   behind on money        → Памп и дамп   (drains every rival into your own wallet)
#   target hides behind a  → Пробить крышу (strips the whole stack, pays per token taken)
#     wall of Крыша
#   a rival is banking     → Взлом         (takes influence, the only scarce currency)
#     influence for a role
#   a rival holds a role   → Слив компромата (takes the role itself)
#
# There is deliberately no laundering line: trading money for influence is exactly what the
# campaign does — for free, without a scandal, and at a better rate — so it would never be the
# right click. Nor a smuggling one: the pump does that job against all three rivals at once.
#
# The influence a hack takes, growing with the round. A flat 4◆ is half of somebody's war chest in
# the third round and a rounding error in the twelfth; the scarce resource has to be priced against
# how much of it is in circulation, which is what every other money figure here already does.
HACK_INFLUENCE_BASE = 2
# What the pump takes from *every* rival, not just the leader. A leader-only jab would be a rider
# on an operation that already pays its owner, making the operation two effects in one. As a
# table-wide drain it is the money operation, and it is the only one that scales with the number
# of players.
PUMP_DRAIN_BASE = 2
# Пробить крышу pays a point per token it takes. Without it the operation is a pure set-up: you
# spend the action and the scandal, and the defenceless target is defenceless for everybody —
# two thirds of the value goes to the neighbours in a four-player game. Measured: Крыша absorbs
# 59% of every targeted command in the game and 68.8% of the hits it eats land on a stack of two,
# so the operation is worth exactly two tokens against the players it is aimed at and nothing at
# all against the 36% who hold none. The per-token point is what makes aiming it worthwhile.
ROOF_BREAK_POINT_PER_ROOF = 1
# Leaking compromat strips a role: -3 points, the whole passive behind it, and the seat opens at
# the free price instead of the threefold takeover. Its only gate is a target holding a role: an
# operation that charges the scarce resource before the dice, on top of the scandal it charges
# after, is not a gamble, it is a tax, and nobody runs it.
# Its odds live in GREY_OPERATION_CHANCE with everybody else's.
