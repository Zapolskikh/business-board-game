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
# is a weighted draw instead of the recycled round-one commons. 1.18.0: «Отобрать Защиту» works with
# a full stack too — it then only strips the target. 1.19.0: grey operations are dirty only on a
# miss; the crypto scam costs three scandals; «Раздуть историю» costs 1◆; the capitalist's mark and
# the politician's deal cost no scandal; the veto costs no action; the racket needs no own Серый
# сектор object and the mafia takes a Защита with the role; the «Агломерация» doubles its quarter
# for district synergy and project conditions, not for the role passives. 1.20.0: the racket always
# takes influence (1 + round/5, plus one per own administrative object); the crypto scam's three
# scandals are not cut by grey-scandal reductions; an arrest resets scandals to 0; the politician's
# «Договоримся» and the card «Изменение зонирования» are gone; legendaries open in round 9 and come
# out at most two a refill.
RULES_VERSION = "city-1.21.0"

# Bumped whenever the catalog changes, even if no rule moved: card texts are part of the agreement
# too. 2026-09-30: removed the unsupported cash-exchange purchase payout. 2026-09-30b: «Судебный
# запрет» no longer promises to absorb a takeover — a Крыша now closes the seat instead.
# 2026-10-01: «Крыша» is «Защита» in every Russian text; round-scaled cards say «номер раунда»
# (which is what the engine always added) instead of «за каждый прошедший раунд».
# 2026-10-01b: city projects repriced by how hard their condition is — see CHANGELOG.
# 2026-10-02b: the military's «Отобрать Защиту» text covers a full stack.
# 2026-10-02c: «Общественная инициатива» takes a project for free; new card «Приватизация» takes a
# market object for free.
# 2026-10-03: «Приватизация» — an object at half its price, no action; «Общественная инициатива» —
# a project without influence and 3$ off; «Теневая касса» 3$ an object; «Обход охраны» +1◆;
# «Автономная офшорная юрисдикция» 15 → 12$.
# 2026-10-05: the racket takes influence always; «Изменение зонирования» removed; legendaries open in
# round 9.
CONTENT_VERSION = "city-content-2026-10-05"

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
# Bot policies, by the id stored on a seat: Claude Reborn (easy), Ledger (normal), Oracle (hard),
# and BorisTheTraxer, the tester's rule-book strategy. The older
# easy/medium/hard profiles played rules that no longer exist and were removed. A saved room or
# game that still names one of them is read back as Reborn — see ``normalize_bot_difficulty``.
BOT_DIFFICULTIES = ("expert", "ledger", "oracle", "boris", "atlas")
DEFAULT_BOT_DIFFICULTY = "expert"
LEGACY_BOT_DIFFICULTIES = frozenset({"easy", "medium", "hard"})
# The policies that read a seat's favourite role. The others choose their seat from the position.
PREFERRED_ROLE_POLICIES = frozenset({"expert"})


def normalize_bot_difficulty(value: str) -> str:
    """A stored policy id, with the retired ones mapped onto the current default."""
    return DEFAULT_BOT_DIFFICULTY if value in LEGACY_BOT_DIFFICULTIES else value


MIN_PLAYERS = 2
# Четверо — предел стола. Шестеро растягивали круг настолько, что между своими ходами
# успевала смениться половина рынка и цели атак, а панель игроков уходила в скролл.
MAX_PLAYERS = 4
MIN_ROUNDS = 5
MAX_ROUNDS = 30
MIN_ROLE_PRICE = 2
MAX_ROLE_PRICE = 10
MAX_CAPACITY = 6
CAPACITY_COSTS = {3: 7, 4: 12, 5: 18}
# The influence the same slots cost on top of the money, keyed like CAPACITY_COSTS. A slot was the
# most underpriced decision in the game (balance patch 2026-10: +4.9 points against the table in
# paired forks, the best option in 84% of Oracle's rollouts). Influence is the scarce currency, so
# the fifth and sixth slots now compete with lobbying and projects instead of only with money.
CAPACITY_INFLUENCE = {3: 0, 4: 1, 5: 3}

# Money and influence are resources, not score: a pile left at the end of the game is worth
# nothing. (An earlier version paid 10$ and 3◆ a point; it was dropped by design decision on
# 2026-10-01 — the rules never explained it, and a hidden payout is a rule nobody plays.)
#
# The two sinks are the way out of a pile, and each costs an action and may be pressed once a
# turn: patronage turns 20$ into 5 points, lobbying 10◆ into 6.
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
# At most this many legendaries on the market at once (1.21.0). They used to open as a wave: by
# round 9-10 the market was full of them and by 11 they were all bought or sunk in the discard.
# 1.20.0 capped them per refill, but a purchase refills its slot on its own, so every legendary
# bought was replaced by the next one: the whole set of eight still came out in rounds 9-10.
MAX_LEGENDARIES_ON_MARKET = 2

# The catch-up: at the start of every round the trailing player (all of them, on a tie for last)
# gets this much influence. Not when the whole table is level — that is the opening, not a deficit.
# Moving first alone did not close the gap: the trailing seat scored 7.3 a round against 8.2 for
# the leader, and from last place after round ten only 2.7% of games were won (balance patch 2026-10).
UNDERDOG_INFLUENCE = 1

# --- roles ------------------------------------------------------------------------------------
# The publication costs an action and lands twice as hard. Two free attacks a turn — inflate
# *and* publish on top of three ordinary actions — would be the journalist's edge over every other
# role, none of which has a power that skips the action cost.
PUBLICATION_SCANDALS = 2
# --- grey operations: the die ------------------------------------------------------------------
# A grey operation is one roll of a six-sided die plus the player's modifiers; anything above six
# reads as six. Every operation has its own table, face by face, of what it does and how many
# scandals it costs — whole numbers the player reads off the panel, recomputed for their role,
# their cards and the third of the game. The old 40–60% all-or-nothing coin was impossible to
# price at the table and half of every attempt burned an action for two scandals; the strong
# bots picked the layer in 0.4–1.7% of the turns it was open (balance patch 2026-10).
#
# Faces 1–2 do nothing, 3–4 do the weak version, 5–6 the full one. Grey operations score no points
# any more: what they pay is in the effect itself.
GREY_DIE_SIDES = 6
# The sum of every modifier is capped, so no seat reaches a guaranteed clean six on every run.
GREY_ROLL_CAP = 3
# What the role gives the roll. The fraudster's flat +1 replaces the old +30% chance; the mafia's
# bonus is the role's grey power: +1 per own Серый сектор object, at most +2.
FRAUDSTER_GREY_ROLL = 1
MAFIA_GREY_ROLL_PER_OBJECT = 1
MAFIA_GREY_ROLL_MAX = 2
# Scandals for the attacker, face by face (index 0 is face 1). Only a miss is dirty (1.19.0): two on a
# one, one on a two, clean from three up. Every operation but «Пробить защиту» lost to an ordinary
# move in the nightly forks (Памп и дамп −2.4 over 3898 forks, Вброс −6.1, Слив компромата −7.5),
# and the ~0.8 scandal a run was most of the price: five of them cost the role.
GREY_SCANDALS = (2, 1, 0, 0, 0, 0)
# «Пробить защиту» is the one operation whose whole job is to open the table for the next turn, so
# it is cleaner on a hit.
GREY_SCANDALS_BY_OPERATION = {"roof_break": (2, 1, 1, 0, 0, 0)}
# The turn flag «Подкуп охраны» leaves behind: its bonus waits for the next roll this turn.
GREY_ROLL_BONUS_FLAG = "grey_roll_bonus"
# Effects, face by face. Thirds of the game (0 = opening, 1 = middle, 2 = endgame) for the two
# operations that take a resource, so a six in the second round cannot win the game.
SMEAR_INFLUENCE_PER_HIT = (0, 0, 1, 1, 2, 2)
PUMP_MONEY_EACH = {0: (0, 0, 1, 1, 2, 3), 1: (0, 0, 2, 2, 4, 6), 2: (0, 0, 4, 4, 6, 8)}
HACK_INFLUENCE = {0: (0, 0, 1, 1, 2, 3), 1: (0, 0, 2, 2, 3, 5), 2: (0, 0, 3, 3, 5, 7)}
LEAK_TARGET_SCANDALS = (0, 0, 2, 2, 0, 0)
LEAK_STRIPS_ROLE = (False, False, False, False, True, True)
LEAK_INFLUENCE = (0, 0, 1, 1, 2, 3)
ROOF_BREAK_INFLUENCE_PER_ROOF = (0, 0, 0, 0, 1, 2)
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
# 1.19.0: three, not five. Five was the whole scandal budget, so the scam cost the role it needs —
# −7.3 against the table in the nightly forks, picked in 0 of 2002 chances.
CRYPTO_SCAM_SCANDALS = 3
# What the racket adds when its target is leading the table. The rest of the demand comes from the
# mafia's own districts: 2$ per Серый сектор object, plus a slow drift with the round.
RACKET_LEADER_BONUS = 5
# The flat part of the racket demand, before 2$ per own Серый сектор object and the round drift.
RACKET_BASE = 3
# 1.20.0: the racket always takes influence — the flat part plus one per RACKET_INFLUENCE_ROUND_STEP
# rounds, plus one per own administrative object. Money alone was the resource every seat already
# had too much of by mid-game, so the role scored 7-11% in the nightly runs: the influence is what
# actually slows a rival down.
RACKET_INFLUENCE_BASE = 1
RACKET_INFLUENCE_ROUND_STEP = 5
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
# «Раздуть историю» was free and the most used power in the game (6795 presses over 768 games), and
# the main way the capitalist and the politician lost their seats. 1.19.0: it costs influence.
JOURNALIST_INFLATE_INFLUENCE = 1
# What the mafia takes with the seat (1.19.0): a Защита, within the role's own limit of two. Claiming
# the role lost 5.7 points against the table over 2648 forks — it paid off only on a Серый сектор
# already built, so the seat now brings something on the turn it is taken.
MAFIA_CLAIM_ROOFS = 1
# --- the marks three roles write on the shared board --------------------------------------------
# A veto closes one project to everybody else for as long as it stays on the board. The project
# rotates on the ordinary schedule and takes the veto with it, so this buys tempo on one card
# rather than freezing the board.
# Free since the 2026-10 balance patch: the veto lost 5.1 points against the table in paired forks,
# mostly because the vetoed project rotated away before the politician could take it and the 3◆
# burned. The action is the price now.
POLITICIAN_VETO_INFLUENCE = 0
# Taking a Крыша off a rival and putting it on your own stack. Not blocked by the token it is
# aimed at, for the same reason «Пробить крышу» is not: a defence that answers the attack on
# itself makes the whole line unreachable.
MILITARY_SEIZE_INFLUENCE = 2
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
#
# 4$ since the 2026-10 balance patch: at 6$ a purchase of two cards returned 1.91 points against a
# 2.10-point price plus the action, so the layer lost on average.
ACTION_CARD_COST = 4
# How many copies of each card the deck holds. One copy meant a four-player table exhausted the
# deck around round 9 — every draw is two cards, so the catalogue lasted about seventeen buys. From
# there on the whole card layer was simply gone, and it went precisely when the late game needs
# things to spend an action on: the board is capped at six slots, the projects want influence, and
# the money channel collapses into repeating Патронаж. Two copies carry the deck to the final
# round. Duplicates are fine by design — a card is a blind draw, not a collectible, and seeing the
# same card twice in fifteen rounds reads as luck rather than repetition.
#
# The default only: a card may print its own ``copies`` in the catalog.
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
# What a point costs when a card buys it outright: worse than an object (2$), but a hoarded dollar
# scores nothing at all, and it needs no slot — which is the whole point. Six slots cap the object
# channel, so a full tableau had nowhere to put money: two measured matches ended with 248$ and 864$
# unspent across the table, 24 and 86 points nobody made a decision about.
POINTS_CARD_RATE = 3
# What discarding a card returns, so a bad draw is not a dead purchase: 2$ or 1◆.
CARD_DISCARD_MONEY = 2
CARD_DISCARD_INFLUENCE = 1
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
# Leaking compromat strips a role: -3 points, the whole passive behind it, and the seat opens at
# the free price instead of the threefold takeover. Its only gate is a target holding a role: an
# operation that charges the scarce resource before the dice, on top of the scandal it charges
# after, is not a gamble, it is a tax, and nobody runs it.
