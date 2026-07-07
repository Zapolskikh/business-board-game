"""PvP cell: Auction (Аукцион) — live, all-players bidding (design 7.12).

Flow:

1. The player who landed picks a free buyable object on the board (opening price
   = 50% of the object's nominal value).
2. If that player is Mafia, they may bar one rival from the auction.
3. Every remaining player bids in turn. Bidding order is by capital ascending —
   richer players decide later (more information) — and the Capitalist is always
   last. On your turn you either raise by the increment or pass; passing drops you
   out. The last remaining bidder wins, pays their bid to the bank and takes the
   object.

Role effects:
* Аферист (fraudster): if he wins, he *also* receives the second-place bid.
* Мафиози (mafia): bars one player from bidding (step 2).
* Капиталист (capitalist): no special bonus, but always bids last.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from game_engine.cells.base import BaseCell
from game_engine.cells.common import CANCEL_OPTION_ID, MapCandidate, map_pick_decision
from game_engine.enums import DecisionType, Role
from game_engine.models import Decision, DecisionOption
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


@register_cell("auction")
class AuctionCell(BaseCell):
    # ---- step 1: the lander picks the object ----------------------------
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        free = engine.state.board.free_buyable_cells()
        if not free:
            engine.log_event("auction", "На аукционе нет свободных объектов.", player.id)
            return
        start_fraction = float(engine.balance.get("auction.start_fraction", 0.5))
        candidates = [
            MapCandidate(
                cell_id=obj.id,
                affordable=True,  # the lander only *nominates*; anyone may win it
                cost=max(1, round(obj.price * start_fraction)),
                note=f"«{obj.title}» (старт {max(1, round(obj.price * start_fraction))}$)",
            )
            for obj in free
        ]
        engine.request_decision(
            map_pick_decision(
                player,
                handler=cell.type,
                cell_id=cell.id,
                prompt="Аукцион: выберите объект для торгов.",
                candidates=candidates,
                action_kind="auction",
                confirm_label="Выставить на торги",
                cancel_label="Не проводить аукцион",
                extra_context={"phase": "pick", "lander": player.id},
            )
        )

    # ---- dispatch --------------------------------------------------------
    def on_resolve(self, engine, player, cell, decision, option) -> None:
        phase = decision.context.get("phase")
        if phase == "pick":
            self._resolve_pick(engine, player, cell, decision, option)
        elif phase == "exclude":
            self._resolve_exclude(engine, player, cell, decision, option)
        elif phase == "bid":
            self._resolve_bid(engine, player, cell, decision, option)

    def _resolve_pick(self, engine, player, cell, decision, option) -> None:
        if option.id == CANCEL_OPTION_ID:
            engine.log_event("auction", f"{player.name} не проводит аукцион.", player.id)
            return
        object_id = option.data["cell_id"]
        # Mafia may bar one rival before the bidding starts.
        if self.has_role(player, Role.MAFIA):
            rivals = [p for p in engine.state.players if p.id != player.id]
            options = [DecisionOption(p.id, f"Не пустить: {p.name}", {"player_id": p.id}) for p in rivals]
            options.append(DecisionOption("none", "Пустить всех"))
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_OPTION, player.id,
                    "Мафиози: кого не пустить на аукцион?",
                    options, handler=cell.type, cell_id=cell.id,
                    context={"phase": "exclude", "object_id": object_id, "lander": player.id},
                )
            )
            return
        self._start_bidding(engine, cell, object_id, excluded=None)

    def _resolve_exclude(self, engine, player, cell, decision, option) -> None:
        excluded = None if option.id == "none" else option.data.get("player_id")
        if excluded:
            barred = engine.state.player_by_id(excluded)
            engine.log_event("auction", f"{player.name} не пускает {barred.name} на торги.", player.id)
        self._start_bidding(engine, cell, decision.context["object_id"], excluded=excluded)

    # ---- step 3: sequential bidding -------------------------------------
    def _start_bidding(self, engine: GameEngine, cell: BoardCell, object_id: str, excluded: str | None) -> None:
        obj = engine.state.board.by_id(object_id)
        start_fraction = float(engine.balance.get("auction.start_fraction", 0.5))
        start_price = max(1, round(obj.price * start_fraction))
        increment = int(engine.balance.get("auction.bid_step", 25))

        eligible = [p for p in engine.state.players if p.id != excluded]
        # Capital ascending: richer players bid later. Capitalist forced to the end.
        eligible.sort(key=lambda p: engine.state.net_worth(p))
        cap = next((p for p in eligible if p.role == Role.CAPITALIST.value), None)
        if cap is not None:
            eligible = [p for p in eligible if p.id != cap.id] + [cap]
        order = [p.id for p in eligible]

        engine.log_event(
            "auction",
            f"Торги за «{obj.title}»: старт {start_price}$, шаг {increment}$.",
        )
        ctx: dict[str, Any] = {
            "phase": "bid",
            "object_id": object_id,
            "start_price": start_price,
            "increment": increment,
            "current_bid": 0,
            "high_bidder": None,
            "order": order,
            "passed": [],
            "pos": 0,
            "bids": {},
        }
        self._offer_or_finalize(engine, cell, ctx)

    def _pick_next(self, ctx: dict[str, Any]) -> tuple[str | None, int]:
        """Return (next actor id, position after them). Skips passed players and
        the current high bidder (who should not bid against themselves)."""
        order: list[str] = ctx["order"]
        passed = set(ctx["passed"])
        high = ctx["high_bidder"]
        n = len(order)
        start = ctx["pos"]
        for k in range(n):
            i = (start + k) % n
            pid = order[i]
            if pid in passed or pid == high:
                continue
            return pid, (i + 1) % n
        return None, ctx["pos"]

    def _offer_or_finalize(self, engine: GameEngine, cell: BoardCell, ctx: dict[str, Any]) -> None:
        obj = engine.state.board.by_id(ctx["object_id"])
        step = int(ctx["increment"])
        # Find the next player who can actually raise; auto-pass those who cannot,
        # so the auction ends crisply the moment nobody can outbid the leader.
        while True:
            actor_id, next_pos = self._pick_next(ctx)
            if actor_id is None:
                self._finalize(engine, cell, ctx)
                return
            actor = engine.state.player_by_id(actor_id)
            min_lead = ctx["start_price"] if ctx["high_bidder"] is None else ctx["current_bid"] + 1
            if actor.money < min_lead:
                ctx["passed"] = list(ctx["passed"]) + [actor_id]
                ctx["pos"] = next_pos
                engine.log_event("auction", f"{actor.name} пасует (не хватает средств).", actor_id)
                continue
            break

        base_ask = ctx["start_price"] if ctx["high_bidder"] is None else ctx["current_bid"] + step
        if ctx["high_bidder"] is None:
            high_txt = "ставок нет"
        else:
            high_txt = f"{ctx['current_bid']}$ ({engine.state.player_by_id(ctx['high_bidder']).name})"

        options: list[DecisionOption] = []
        if actor.money >= base_ask:
            options.append(
                DecisionOption(
                    "bid", f"+{step}$ (до {base_ask}$)", {"ask": base_ask},
                    hint="Поднять ставку на фиксированный шаг.",
                )
            )
        if actor.money != base_ask:  # all-in is a distinct, valid lead here
            options.append(
                DecisionOption(
                    "allin", f"Ва-банк ({actor.money}$)", {"ask": actor.money},
                    hint="Поставить весь свой капитал.",
                )
            )
        options.append(DecisionOption("pass", "Пас", hint="Выйти из торгов за этот объект."))

        new_ctx = {**ctx, "pos": next_pos, "ask": base_ask}
        engine.request_decision(
            Decision(
                DecisionType.CHOOSE_OPTION, actor_id,
                f"Аукцион «{obj.title}». Ставка: {high_txt}. Ваш ход.",
                options, handler=cell.type, cell_id=cell.id, context=new_ctx,
            )
        )

    def _resolve_bid(self, engine, player, cell, decision, option) -> None:
        ctx = dict(decision.context)
        ctx["passed"] = list(ctx["passed"])
        ctx["bids"] = dict(ctx["bids"])
        if option.id in ("bid", "allin"):
            ask = int(option.data.get("ask", ctx["ask"]))
            ctx["bids"][player.id] = ask
            ctx["current_bid"] = ask
            ctx["high_bidder"] = player.id
            engine.log_event("auction", f"{player.name} ставит {ask}$.", player.id)
        else:  # pass
            ctx["passed"].append(player.id)
            engine.log_event("auction", f"{player.name} пасует.", player.id)
        self._offer_or_finalize(engine, cell, ctx)

    def _finalize(self, engine: GameEngine, cell: BoardCell, ctx: dict[str, Any]) -> None:
        obj = engine.state.board.by_id(ctx["object_id"])
        winner_id = ctx["high_bidder"]
        if winner_id is None:
            engine.log_event("auction", f"Никто не купил «{obj.title}».")
            return
        winner = engine.state.player_by_id(winner_id)
        bid = ctx["current_bid"]
        engine.charge_money(winner, bid, reason=f"покупка «{obj.title}» на аукционе")
        obj.owner_id = winner.id
        winner.bump("properties_bought")
        engine.log_event(
            "auction", f"{winner.name} выигрывает «{obj.title}» за {bid}$.",
            winner.id, cell_id=obj.id,
        )
        # Fraudster scam: additionally takes the second-place bid FROM the runner-up
        # (a transfer, not minted money — keeps the economy balanced).
        if winner.role == Role.FRAUDSTER.value:
            others = [(pid, amount) for pid, amount in ctx["bids"].items() if pid != winner_id]
            if others:
                second_pid, second = max(others, key=lambda t: t[1])
                if second > 0:
                    runner = engine.state.player_by_id(second_pid)
                    engine.transfer_money(runner, winner, second, reason="Аферист: обман второго места")

