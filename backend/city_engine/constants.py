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
# and the publication costs an action for two scandals. Fraudster: one flat chance bonus instead of
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
RULES_VERSION = "city-1.13.0"
# 1.13.0: the settlement that closed the last round is deleted, and one action card may be bought
# per turn (the cap that used to sit on playing and discarding one).
#
# A settlement is what a player carries into the *next* round; after the final round there is none,
# so the payout could only ever be scored at the passive rate — 3 to 10 points a seat that no
# decision at that table could still influence, on top of the objects and projects the score
# already pays for. Six exported matches moved every player by 4-7 points and one one-point finish
# became a tie. The debt row survives the cut on purpose: «Мостовой кредит» is 10$ now against 4$
# at the end of the round, and dropping the whole settlement would make the last round the one
# where the loan is free.
# 1.12.0: the role pass. Every charter that worked by fiat is replaced by something the table can
# see and answer, and the two roles that only had passives get a line to press.
#
# Journalist: the rating ceiling is gone. It was 2 plus one per housing object, which capped the
# role's own currency exactly when it was working and quietly turned it into a housing engine. One
# housing object now switches the line on and the rating *is* the scandal counter.
# Fraudster: the grey comeback (+1◆ per place behind) is deleted — a reward for losing, on the one
# layer that already pays for itself.
# Capitalist: the business charter and the virtual district link both go, and in their place the
# role gets `capitalist_claim` — an action and a scandal mark a card on the open market, and it
# pays the capitalist as if it stood in their city while everyone else can still buy it away.
# Politician: the virtual administrative link goes; the Административный квартал becomes the role's
# own district and pays a dollar an object like every other role's, while housing pays 1◆ per
# residential object anywhere in the city. Plus two new lines: `politician_deal` rents a district
# for the round out of the Серый сектор, and `politician_veto` closes one project to everybody else.
# Mafia: `mafia_lock` spends a Крыша, not an action, to close a market slot to everybody else for
# a round.
# Military: `military_roof_sweep` is replaced by `military_inspection` (a scandal for every rival
# standing in the Серый сектор) and `military_roof_seize` (take one Крыша and keep it).
# «Зонирование» no longer requires an object in the district it opens — that requirement made the
# card a multiplier on a quarter you had instead of a way into one you did not.
#
# `MarketAsset` gains two marks and `PlayerState` a mirror of the capitalist's, so 1.11.0 snapshots
# describe a board this engine cannot read.
# 1.11.0: the base roof limit falls from two to one (the Мафия keeps one extra), and the Силовик
# gains a repeatable action that removes one roof from every rival and scores once per removed token.
# 1.10.0: object blocking is deleted, and a role no longer carries its ceilings out of the seat.
#
# Blocking existed for one card in a deck of 34 («Заморозка активов»), plus a second card whose
# only job was to undo it. For that it put a mutable flag on every object in every portfolio, and
# every rule that reads a portfolio then had to decide whether to honour it — half of them did not.
# `district_count` never did, so a frozen object still opened grey operations (whose own error
# message promised an *active* object), still paid the district synergy of its neighbours, and
# still satisfied project conditions, while `_income_breakdown` and `passive_influence_breakdown`
# honoured it. Two readings of one flag is not a mechanic, it is a bug surface. `OwnedAsset.blocked`
# leaves the state, `freeze`/`unblock` leave the catalog, and every "is this object active" test in
# the engine collapses into "does the player own it".
#
# Roles: `scandal_limit` and `roof_limit` both depend on the role, and nothing re-checked them when
# the role changed. A journalist who hit their own limit of 6 was parked at 6 scandals under a
# limit of 5 — one point of score worse than the same event for any other role, and a state the
# engine's own invariant says cannot exist. A mafia holding its extra Крыша kept it after claiming
# another seat. Both are now clamped by `_apply_role_limits`, called at every point where
# a role is gained, swapped, stripped or lost. Claiming a role is gated on BASE_SCANDAL_LIMIT for
# everybody, so the journalist's extra headroom can no longer be laundered into a different seat.
#
# Also: «Враждебное поглощение» pays the attacker what the victim loses (card.value, scaled by the
# round) instead of a hardcoded 2 — a dollar used to vanish from the table on every play.
# 1.8.0: the fraudster's crypto scam finally follows the rule printed on the role card: one
# command takes 25% of every unprotected rival wallet and always creates five scandals.  The old
# implementation exposed six flat amounts (1..6), which let a one-point reduction turn amount=1
# into a free, repeatable table-wide drain.  Reduction perks remain deliberately stackable: their
# payoff is the reward for assembling a specialised grey engine.
# 1.7.0: district development is deleted outright — object income is the printed number plus
# synergies, with no `ceil(base × 1.25)` per level. `district_levels` leaves the player state, so a
# 1.6.0 snapshot describes a board this engine cannot score. Repeatable projects and their
# surcharge are gone with it, as is `antitrust_active`. Rooms opened under 1.6.0 will not load —
# that is the point: the alternative is a game that loads and then fails on a card nobody can play.
#
# 2026-08-26a: 34 action cards, 40 projects. Removed: the two city initiatives (`city_initiative`,
# `municipal_programme`), the two cards that referenced district development (`antitrust`,
# `infrastructure`) and «Антимонопольное расследование», which punished the same
# «4 objects in a district» threshold that `synergyInfluence` now rewards. Added: `self_target` on
# the three scandal cards, `synergyInfluence` on all 19 epic and legendary assets. Repriced the
# four projects whose permanent perk cost less than it paid.
#
# 2026-08-22a: the role texts finally describe the game. They still advertised investment
# actions, forged roles, the burn-contacts power and the district tribute — all deleted between
# 1.4.0 and 1.5.1 — and a player read them in the role tooltip.
#
# 2026-08-21a: 37 action cards. The automation and role-forgery cards are gone, replaced by the
# «деньги → очки» family and «Предписание о демонтаже» (takes a development level); the two defence
# cards now hand out the same Крыша as the third; the two projects that required automation ask for
# tagged objects instead. The events array is gone from the catalog entirely.
CONTENT_VERSION = "city-content-2026-08-29c"
# 2026-08-29c: the same pass over the five remaining roles. The Капиталист's card said it had no
# active ability while `capitalist_claim` existed and still promised the charter deleted in 1.12.0;
# the Политик's described the housing tax as money and the Спальный as its own quarter, when the
# role has paid influence off the whole city and owned the Администрация since that same pass; the
# Аферист's advertised the grey comeback; the Мафиози's never mentioned `mafia_lock`; the Силовик's
# still described the mass roof sweep, replaced by the inspection and the seizure. No number moved.
# 2026-08-29b: the journalist's role text finally describes the role. It still promised a rating
# capped at "2 plus one per housing object" — the ceiling 1.12.0 deleted — and said nothing about
# the Крыша cancelling «Раздуть историю» outright, which is the single most common thing that
# happens when the power is pressed. No card, price or effect moved.
# 2026-08-29a: the legendary pass. Four of the eight printed a number and nothing else, so they
# were replaced by cards that reach a lever no object could touch before: «Маркет-мейкер» re-deals
# a market slot, «Агломерация» counts a built quarter twice, «Градостроительная хартия» waives one
# project condition per game, «Лоббистский кабинет» draws a card every turn. The offshore keeps its
# grey discount and loses the roof capacity it shared with the fortress.
# 2026-08-28b: non-resource engine projects score two fewer points at the same price; the base
# roof limit is one (two for the Мафия); the Силовик gains the mass roof-sweep action.
# 2026-08-28a: 32 action cards. «Заморозка активов» (freeze) and the card that undid it (unblock)
# are gone with the blocking mechanic — see the 1.10.0 note above. Nothing replaces them: the deck
# already carries eleven other ways to spend a card on an opponent, and the freeze was the only one
# whose effect the rest of the engine could not agree on.
# 2026-08-26b: point-buying action cards are the premium money sink again.  Their 5$/point rate
# was strictly worse than the always-available 20$ -> 5 point patronage button, despite first
# costing a blind draw, 3$, 1 influence and an action.  The card rate is now 3$/point.

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
# The publication costs an action now and lands twice as hard. Two free attacks a turn — inflate
# *and* publish on top of three ordinary actions — was the journalist's real edge over every other
# role, none of which has a power that skips the action cost.
PUBLICATION_SCANDALS = 2
# The fraudster's grey bonus, flat and single. It used to be split in two — +20% for the role and
# +10% more for holding any Технокластер object — which meant the crypto exchange, itself a
# Технокластер object, silently granted both and pinned every fraudster operation at the 0.9 ceiling.
# One number that the player can read off the role card is worth more than two that stack invisibly.
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
ACTION_CARD_COST = 3
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
# One purchase a turn. The cap used to sit on the play and the discard instead, because buying
# twice and shredding four cards beat the campaign as an influence pump. Capping the supply closes
# that at the source and leaves a hand the player has already paid for free to spend at any speed —
# which is what a card layer needs to feel alive rather than rationed.
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
# The layer used to be five ways of asking the same question — "spend an action, get a resource" —
# so a player picked whichever number was biggest and the other three lines were furniture: crypto
# 41.9% of runs, smuggling 28.3%, hack 25.7%, laundering 4.9%, compromat 0.6%. Each operation now
# produces something the others cannot, and the pick follows the position on the board rather than
# a comparison of expected values:
#
#   behind on tempo        → Вброс         (a scandal on every rival at once)
#   behind on money        → Памп и дамп   (drains every rival into your own wallet)
#   target hides behind a  → Пробить крышу (strips the whole stack, pays per token taken)
#     wall of Крыша
#   a rival is banking     → Взлом         (takes influence, the only scarce currency)
#     influence for a role
#   a rival holds a role   → Слив компромата (takes the role itself)
#
# Laundering left the set entirely: it traded money for influence, which is exactly what the
# campaign does — for free, without a scandal, and at a better rate — so it was never the right
# click. Smuggling left because the pump does the same job against all three rivals at once.
#
# The influence a hack takes, growing with the round. Flat 4◆ meant half of somebody's war chest in
# the third round and a rounding error in the twelfth; the scarce resource has to be priced against
# how much of it is in circulation, which is what every other money figure here already does.
HACK_INFLUENCE_BASE = 2
# What the pump takes from *every* rival, not just the leader. As a leader-only jab it was a rider
# on an operation that already paid its owner, which made the operation two effects in one and the
# smuggling run redundant next to it. As a table-wide drain it is the money operation, and it is
# the only one that scales with the number of players.
PUMP_DRAIN_BASE = 2
# Пробить крышу pays a point per token it takes. Without it the operation is a pure set-up: you
# spend the action and the scandal, and the defenceless target is defenceless for everybody —
# two thirds of the value goes to the neighbours in a four-player game. Measured: Крыша absorbs
# 59% of every targeted command in the game and 68.8% of the hits it eats land on a stack of two,
# so the operation is worth exactly two tokens against the players it is aimed at and nothing at
# all against the 36% who hold none. The per-token point is what makes aiming it worthwhile.
ROOF_BREAK_POINT_PER_ROOF = 1
# Leaking compromat strips a role: -3 points, the whole passive behind it, and the seat opens at
# the free price instead of the threefold takeover. It used to carry four separate conditions —
# a target holding a role, 3◆ paid up front and forfeited on failure, one attempt per round, and
# the per-turn cap — and it was run in 0.6% of all grey operations. Three of the four are gone.
# The prepayment is the one that mattered: an operation that charges the scarce resource before
# the dice, on top of the scandal it charges after, is not a gamble, it is a tax.
# Its odds live in GREY_OPERATION_CHANCE with everybody else's.
