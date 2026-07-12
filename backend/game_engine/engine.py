"""The authoritative game engine.

The engine is a small state machine driven by two actions: ``ROLL_DICE`` and
``RESOLVE_DECISION``. Cells never mutate state on their own — they call the
helper methods on this class (``grant_money``, ``add_scandal``,
``send_to_hospital`` …) so that cross-cutting rules (bankruptcy, "2 scandals
remove the role", Крыша consumption) live in exactly one place.

Flow of a turn::

    ROLL_DICE
      -> roll die, advance player (Start bonus, optional ring promotion)
      -> activate landing cell
           -> cell may finish immediately, or raise a pending Decision
    RESOLVE_DECISION (repeated until no decision remains)
      -> route the answer back to the cell that raised it
    -> grant extra roll (if any) OR advance to the next player
    -> check victory / round limit
"""
from __future__ import annotations

# Importing the cells package registers all cell behaviours via decorators.
import game_engine.cells  # noqa: F401
from game_engine.cells.cards import CardSystem
from game_engine.cells.common import upgrade_cost
from game_engine.config import Balance, GameConfig
from game_engine.enums import ActionType, Phase, Role
from game_engine.events import GameEvent
from game_engine.models import BoardCell, Decision, DecisionOption, GameState, Player
from game_engine.registry import get_cell_behaviour
from game_engine.rng import GameRNG


class GameEngine:
    """Applies actions to a :class:`GameState` and produces events."""

    def __init__(self, state: GameState) -> None:
        self.state = state

    # ---- convenient accessors -------------------------------------------
    @property
    def config(self) -> GameConfig:
        return self.state.config

    @property
    def balance(self) -> Balance:
        return self.state.config.balance

    @property
    def rng(self) -> GameRNG:
        return self.state.rng

    # ---- public API ------------------------------------------------------
    def apply_action(
        self, player_id: str, action_type: str, payload: dict | None = None
    ) -> list[GameEvent]:
        """Apply one action from ``player_id`` and return the events it produced."""
        payload = payload or {}
        if self.state.finished:
            raise ValueError("Игра уже завершена.")

        pending = self.state.pending_decision
        # Normally only the current player may act. The exception is a pending
        # decision addressed to *another* player (e.g. every player bidding in an
        # Auction): then the addressee is the one who must answer it.
        if action_type == ActionType.RESOLVE_DECISION and pending is not None:
            if player_id != pending.player_id:
                raise ValueError("Сейчас отвечает другой игрок.")
        elif player_id != self.state.current_player.id:
            raise ValueError("Сейчас не ход этого игрока.")

        start_index = len(self.state.log)

        if action_type == ActionType.ROLL_DICE:
            self._require_phase(Phase.AWAIT_ROLL)
            self._do_roll(self.state.current_player)
        elif action_type == ActionType.RESOLVE_DECISION:
            self._require_phase(Phase.AWAIT_DECISION)
            self._do_resolve(payload.get("option_id"))
        elif action_type == ActionType.USE_CARD:
            self._do_use_card(player_id, str(payload.get("card_id", "")))
        else:
            raise ValueError(f"Неизвестное действие: {action_type}")

        return self.state.log.since(start_index)

    def _require_phase(self, phase: str) -> None:
        if self.state.phase != phase:
            raise ValueError(f"Ожидалась фаза {phase}, сейчас {self.state.phase}.")

    # ---- turn flow -------------------------------------------------------
    def _do_roll(self, player: Player) -> None:
        die = self.rng.roll_die(self.config.dice_sides)
        if player.flags.get("navigator"):
            player.flags["navigator"] -= 1
            if player.flags["navigator"] <= 0:
                player.flags.pop("navigator", None)
            die = min(self.config.dice_sides, die + 1)
            self.log_event("card", f"{player.name}: Навигатор меняет бросок на {die}.", player.id, die=die)
        self.state.last_die = die
        self.state.last_die_player_id = player.id
        self.log_event("dice_rolled", f"{player.name} бросает кубик: {die}", player.id, die=die)
        player.bump("rolls")
        player.flags.pop("no_taxi", None)  # anti-abuse flag resets each roll
        player.flags.pop("no_station", None)  # station-travel chaining also resets
        self.advance_player(player, die)  # emits the "player_moved" walk event
        # Passing Start with enough experience offers a paid ring promotion. The
        # landing is deferred until that choice is made (buying moves you to the
        # next ring's Start instead of activating the cell you rolled onto).
        if self._maybe_offer_promotion(player):
            self._finish_step()
            return
        self._activate_landing(player)
        self._finish_step()

    def _do_resolve(self, option_id: str | None) -> None:
        decision = self.state.pending_decision
        if decision is None:
            raise ValueError("Нет ожидающего решения.")
        if option_id not in decision.option_ids():
            raise ValueError(f"Недопустимый вариант: {option_id!r}.")
        option = next(o for o in decision.options if o.id == option_id)

        # The player answering may not be the current player (auction bidding).
        actor = self.state.player_by_id(decision.player_id)
        # Clear the decision before dispatching; the handler may raise a new one.
        self.state.pending_decision = None
        cell = self.state.board.by_id(decision.cell_id) if decision.cell_id else None
        behaviour = get_cell_behaviour(decision.handler)
        behaviour.on_resolve(self, actor, cell, decision, option)
        if decision.handler == "cards" and self.state.pending_decision is None:
            self.state.phase = Phase.AWAIT_ROLL
            return
        self._finish_step()

    def _do_use_card(self, player_id: str, card_id: str) -> None:
        self._require_phase(Phase.AWAIT_ROLL)
        player = self.state.player_by_id(player_id)
        if player.id != self.state.current_player.id:
            raise ValueError("Карту можно применить только в свой ход перед броском.")
        if card_id not in player.cards:
            raise ValueError("Такой карты нет в руке.")
        CardSystem().start_card(self, player, card_id, from_hand=True)
        if self.state.pending_decision is not None:
            self.state.phase = Phase.AWAIT_DECISION
        else:
            self.state.phase = Phase.AWAIT_ROLL

    def _activate_landing(self, player: Player) -> None:
        cell = self.state.board.cell_at(player.ring, player.position)
        player.bump(f"land_{cell.type}")
        self.log_event(
            "landed",
            f"{player.name} попадает на «{cell.title}» (круг {cell.ring + 1})",
            player.id,
            cell_id=cell.id,
            cell_type=cell.type,
        )
        get_cell_behaviour(cell.type).on_land(self, player, cell)

    def _finish_step(self) -> None:
        """Decide what happens after a roll/decision resolves."""
        if self.state.pending_decision is not None:
            self.state.phase = Phase.AWAIT_DECISION
            return
        player = self.state.current_player
        if player.extra_rolls > 0:
            player.extra_rolls -= 1
            self.state.phase = Phase.AWAIT_ROLL
            self.log_event("extra_roll", f"{player.name} бросает ещё раз.", player.id)
            return
        self._advance_turn()

    def _advance_turn(self) -> None:
        # Victory by reaching the target net worth.
        leader = max(self.state.players, key=self.state.net_worth)
        if self.state.net_worth(leader) >= self.config.victory.target_net_worth:
            self._end_game(leader, reason="target_net_worth")
            return

        self.state.turn_number += 1
        self.state.current_index += 1
        if self.state.current_index >= len(self.state.players):
            self.state.current_index = 0
            self.state.round_number += 1

        if self.state.round_number >= self.config.victory.max_turns:
            winner = max(self.state.players, key=self.state.net_worth)
            self._end_game(winner, reason="max_turns")
            return

        self.state.phase = Phase.AWAIT_ROLL

    def _end_game(self, winner: Player, reason: str) -> None:
        self.state.winner_id = winner.id
        self.state.phase = Phase.GAME_OVER
        self.log_event(
            "game_over",
            f"Игра окончена. Победитель: {winner.name} "
            f"(капитал {self.state.net_worth(winner)}).",
            winner.id,
            reason=reason,
        )

    # ---- movement --------------------------------------------------------
    def advance_player(self, player: Player, steps: int) -> None:
        """Move ``player`` by ``steps`` slots within the ring.

        Forward movement awards the Start bonus *and* Start experience for each
        crossing of slot 0 — this applies to dice rolls AND to Taxi/Station
        travel, which now walk **in the direction of play** rather than teleport
        (so passing Start is never skipped). Backward movement awards nothing.
        Only Hospital/Jail (and ring promotion) teleport. Ring promotion is
        offered separately (see :meth:`_maybe_offer_promotion`).
        """
        from_ring, from_slot = player.ring, player.position
        size = self.state.board.ring_size(player.ring)
        if steps >= 0:
            crossings, final = divmod(player.position + steps, size)
            player.position = final
            for _ in range(crossings):
                start_bonus = self.balance.ring_value("start_bonus", player.ring)
                if player.loan_payments_left > 0:
                    player.flags["last_start_paid_loan"] = True
                    player.loan_payments_left -= 1
                    self.log_event(
                        "loan_payment",
                        f"{player.name}: доход за Старт ({start_bonus}$) уходит в банк по кредиту. Осталось: {player.loan_payments_left}.",
                        player.id,
                    )
                else:
                    player.flags["last_start_paid_loan"] = False
                    self.grant_money(player, start_bonus, reason="Проход через Старт")
                base_exp = int(self.config.extra.get("start_experience", self.balance.get("start_experience_base", 1)))
                coefficients = self.balance.get("start_experience_coefficients", [1, 2, 0])
                coefficient = coefficients[player.ring] if player.ring < len(coefficients) else 0
                exp = base_exp * int(coefficient)
                self.grant_experience(player, exp, reason="Проход через Старт")
                player.bump("start_passes")
            player.flags["crossed_start"] = crossings > 0
        else:
            player.position = (player.position + steps) % size
            player.flags["crossed_start"] = False
        self._log_move(player, from_ring, from_slot, "walk" if steps >= 0 else "back")

    def walk_to_slot(self, player: Player, dest_slot: int, *, activate: bool = True) -> int:
        """Walk FORWARD (in the direction of play) to ``dest_slot`` on the current
        ring, collecting the Start bonus if the path crosses slot 0. Used by Taxi
        and Station so those moves no longer teleport past Start (only Hospital,
        Jail and ring promotion teleport). ``advance_player`` emits the movement
        event. Returns the number of forward steps taken.
        """
        size = self.state.board.ring_size(player.ring)
        steps = (dest_slot - player.position) % size
        self.advance_player(player, steps)
        if activate:
            # Taxi/Station movement is still real movement: pause at Start's
            # promotion checkpoint before resolving the destination interaction.
            if not self._maybe_offer_promotion(player):
                self._activate_landing(player)
        return steps

    def _log_move(self, player: Player, from_ring: int, from_slot: int, mode: str) -> None:
        """Emit a ``player_moved`` event so the UI can animate the token. ``mode``
        is ``"walk"``/``"back"`` (step-by-step) or ``"teleport"`` (snap)."""
        if from_ring == player.ring and from_slot == player.position and mode != "teleport":
            return
        self.log_event(
            "player_moved",
            "",  # purely visual; filtered out of the narrative log
            player.id,
            from_ring=from_ring,
            from_slot=from_slot,
            to_ring=player.ring,
            to_slot=player.position,
            mode=mode,
        )

    def _maybe_offer_promotion(self, player: Player) -> bool:
        """Offer a paid ring promotion when a player passes Start with enough XP.

        Returns ``True`` if a decision was raised (landing is then deferred until
        the player answers). Promotion is *bought* with experience: 10 XP for
        ring 2, 30 XP for ring 3 (configurable in ``promotion`` in balance.json).
        """
        promo = self.config.promotion
        if not promo.enabled or not player.flags.get("crossed_start"):
            return False
        next_ring = player.ring + 1
        if next_ring >= self.state.board.ring_count:
            return False
        required = promo.experience_required
        need = required[next_ring] if next_ring < len(required) else required[-1]
        if player.experience < need:
            return False
        self.request_decision(
            Decision(
                type="yes_no",
                player_id=player.id,
                prompt=f"Вы прошли Старт. Купить повышение на круг {next_ring + 1} за {need} опыта?",
                options=[
                    DecisionOption("promote", f"Повыситься за {need} опыта"),
                    DecisionOption(
                        "stay",
                        f"Продолжить к «{self.state.board.cell_at(player.ring, player.position).title}»",
                    ),
                ],
                handler="start",
                cell_id=None,
                context={"kind": "promotion", "next_ring": next_ring, "cost": need},
            )
        )
        return True

    def promote_player(self, player: Player, next_ring: int, cost: int) -> None:
        """Spend ``cost`` experience to move ``player`` to ``next_ring``'s Start."""
        from_ring, from_slot = player.ring, player.position
        self.lose_experience(player, cost, reason="покупка повышения")
        # The crossing is valued as a Start on the new ring. The old-ring bonus
        # was already paid by advance_player, so add only the difference. Credit
        # crossings are the exception and never produce this extra income.
        if not player.flags.get("last_start_paid_loan"):
            old_bonus = int(self.balance.ring_value("start_bonus", player.ring))
            new_bonus = int(self.balance.ring_value("start_bonus", next_ring))
            self.grant_money(player, max(0, new_bonus - old_bonus), reason="повышение: бонус нового круга")
        player.ring = next_ring
        player.position = 0
        player.bump("promotions")
        self.log_event(
            "promotion",
            f"{player.name} покупает переход на круг {next_ring + 1}.",
            player.id,
            ring=next_ring,
        )
        self._log_move(player, from_ring, from_slot, "teleport")
        self._activate_landing(player)

    def resume_landing(self, player: Player) -> None:
        """Activate the cell the player is standing on (used after declining a
        deferred promotion offer)."""
        self._activate_landing(player)

    def teleport(self, player: Player, ring: int, slot: int, activate: bool = True) -> None:
        from_ring, from_slot = player.ring, player.position
        player.ring = ring
        player.position = slot
        self._log_move(player, from_ring, from_slot, "teleport")
        if activate:
            self._activate_landing(player)

    def move_and_activate(self, player: Player, steps: int) -> None:
        """Move within the current ring and activate the destination cell.

        Used by "move forward/back N" filler cells. Forward moves award the Start
        bonus (via :meth:`advance_player`, which also emits the movement event);
        backward moves do not.
        """
        self.advance_player(player, steps)
        self._activate_landing(player)

    # ---- resource helpers ------------------------------------------------
    def grant_money(self, player: Player, amount: int, reason: str) -> None:
        amount = int(amount)
        if amount <= 0:
            return
        if player.flags.get("next_income_x2"):
            player.flags["next_income_x2"] -= 1
            if player.flags["next_income_x2"] <= 0:
                player.flags.pop("next_income_x2", None)
            amount *= 2
            reason = f"{reason}, Черная бухгалтерия x2"
        player.money += amount
        self.log_event(
            "money_gained", f"{player.name}: +{amount}$ ({reason})", player.id, amount=amount
        )

    def charge_money(
        self, player: Player, amount: int, reason: str, to_player: Player | None = None
    ) -> bool:
        """Charge ``amount`` from ``player``. Returns ``True`` if fully paid.

        On shortfall the player pays what they can and goes bankrupt (a setback,
        never elimination — see :meth:`_handle_bankruptcy`).
        """
        amount = int(amount)
        if amount <= 0:
            return True
        if player.flags.get("payment_shield"):
            player.flags["payment_shield"] -= 1
            if player.flags["payment_shield"] <= 0:
                player.flags.pop("payment_shield", None)
            self.log_event("payment_blocked", f"{player.name}: платеж {amount}$ отменен картой.", player.id, amount=amount)
            return True
        if player.money >= amount:
            player.money -= amount
            if to_player is not None:
                to_player.money += amount
            recipient = f" -> {to_player.name}" if to_player else ""
            self.log_event(
                "money_paid",
                f"{player.name}: -{amount}$ ({reason}){recipient}",
                player.id,
                amount=amount,
                to_player=to_player.id if to_player else None,
            )
            return True

        paid = player.money
        if to_player is not None and paid > 0:
            to_player.money += paid
        player.money = 0
        self.log_event(
            "money_paid",
            f"{player.name} не может заплатить {amount}$ ({reason}) — банкротство.",
            player.id,
            amount=paid,
        )
        self._handle_bankruptcy(player)
        return False

    def transfer_money(self, src: Player, dst: Player, amount: int, reason: str) -> bool:
        return self.charge_money(src, amount, reason, to_player=dst)

    def apply_negative_effect(
        self,
        player: Player,
        kind: str,
        *,
        roof_protectable: bool = True,
        reason: str = "",
        **data,
    ) -> bool:
        """Apply a serialisable negative effect, optionally offering Крыша.

        New effects opt in/out with ``roof_protectable``. Returning ``False``
        means the effect was deferred until the player answers the roof choice.
        """
        if self.state.pending_decision is not None and self.state.pending_decision.handler == "roof_protection":
            self.state.negative_effect_queue.append({
                "player_id": player.id, "kind": kind, "roof_protectable": roof_protectable,
                "reason": reason, "data": data,
            })
            return False
        if roof_protectable and player.roofs > 0:
            label = reason or {
                "money": "денежный штраф", "experience": "потерю опыта",
                "scandal": "скандал", "role": "потерю роли",
                "hospital": "отправку в Больницу", "jail": "отправку в Тюрьму",
            }.get(kind, "негативный эффект")
            self.request_decision(Decision(
                type="roof_protection",
                player_id=player.id,
                prompt=f"Крыша может отменить: {label}. Что выбрать?",
                options=[
                    DecisionOption("use_roof", "Потратить Крышу и отменить эффект"),
                    DecisionOption("take_effect", "Сохранить Крышу и принять эффект"),
                ],
                handler="roof_protection",
                context={"kind": kind, "reason": reason, "data": data},
            ))
            return False
        self.execute_negative_effect(player, kind, reason=reason, **data)
        return True

    def continue_negative_queue(self) -> None:
        """Resolve queued group effects until another player needs a roof choice."""
        while self.state.negative_effect_queue and self.state.pending_decision is None:
            item = self.state.negative_effect_queue.pop(0)
            self.apply_negative_effect(
                self.state.player_by_id(item["player_id"]), item["kind"],
                roof_protectable=item["roof_protectable"], reason=item["reason"], **item["data"],
            )

    def execute_negative_effect(self, player: Player, kind: str, *, reason: str = "", **data) -> None:
        """Execute a previously confirmed negative effect without another prompt."""
        if kind == "money":
            target = self.state.player_by_id(data["to_player_id"]) if data.get("to_player_id") else None
            self.charge_money(player, int(data.get("amount", 0)), reason or "штраф", to_player=target)
        elif kind == "experience":
            self.lose_experience(player, int(data.get("amount", 0)), reason or "потеря опыта")
        elif kind == "scandal":
            self.add_scandal(player, int(data.get("count", 1)), reason=reason)
        elif kind == "role":
            self.remove_role(player, reason=reason)
        elif kind == "hospital":
            self.send_to_hospital(player)
        elif kind == "jail":
            self.send_to_jail(player)
        else:
            raise ValueError(f"Неизвестный негативный эффект: {kind}")

    def _handle_bankruptcy(self, player: Player) -> None:
        """Bankruptcy = setback, not elimination (design section 3.5).

        The player loses their cheapest un-insured property (getting back half
        its price as cash) and a point of experience. Placeholder rules — tune or
        replace once the full bankruptcy design exists.
        """
        player.bankrupt_count += 1
        player.bump("bankruptcies")
        owned = [
            c
            for c in self.state.board.cells_owned_by(player.id)
            if c.id not in player.insured_cells
        ]
        if owned:
            upgraded = [c for c in owned if c.state.get("upgraded")]
            full_refund = bool(player.flags.get("bankruptcy_full_refund"))
            if full_refund:
                player.flags["bankruptcy_full_refund"] -= 1
                if player.flags["bankruptcy_full_refund"] <= 0:
                    player.flags.pop("bankruptcy_full_refund", None)
            if upgraded:
                cheapest = min(upgraded, key=lambda c: c.price + int(c.state.get("upgrade_cost", c.price)))
                value = cheapest.price + int(cheapest.state.get("upgrade_cost", cheapest.price))
                cheapest.state.pop("upgraded", None)
                cheapest.state.pop("upgrade_cost", None)
                refund = value if full_refund else value // 2
                player.money += refund
                self.log_event(
                    "bankruptcy",
                    f"{player.name} теряет улучшение «{cheapest.title}» и получает {refund}$ отката.",
                    player.id,
                    cell_id=cheapest.id,
                    refund=refund,
                )
            else:
                cheapest = min(owned, key=lambda c: c.price)
                cheapest.owner_id = None
                value = cheapest.price
                refund = value if full_refund else value // 2
                player.money += refund
                self.log_event(
                    "bankruptcy",
                    f"{player.name} теряет «{cheapest.title}» и получает {refund}$ отката.",
                    player.id,
                    cell_id=cheapest.id,
                    refund=refund,
                )
        elif player.loan_payments_left > 0:
            player.scandals += 1
            player.bump("scandals_received")
            self.log_event("scandal", f"{player.name} получает 1 скандал (банкротство с кредитом).", player.id, count=1)
        if player.experience > 0:
            player.experience -= 1
        self.log_event("bankruptcy", f"{player.name} проходит банкротство.", player.id)

    def grant_experience(self, player: Player, amount: int, reason: str) -> None:
        amount = int(amount)
        if amount <= 0:
            return
        player.experience += amount
        self.log_event(
            "exp_gained", f"{player.name}: +{amount} опыта ({reason})", player.id, amount=amount
        )

    def lose_experience(self, player: Player, amount: int, reason: str) -> None:
        amount = int(amount)
        if amount <= 0:
            return
        before = player.experience
        player.experience = max(0, player.experience - amount)
        lost = before - player.experience
        if lost:
            self.log_event(
                "exp_lost", f"{player.name}: -{lost} опыта ({reason})", player.id, amount=lost
            )

    # ---- status helpers --------------------------------------------------
    def add_scandal(self, player: Player, count: int = 1, reason: str = "") -> None:
        # Scandals track reputation of a role; a roleless player has none to lose.
        if not player.role:
            self.log_event("scandal_ignored", f"{player.name}: без роли скандал не начисляется.", player.id)
            return
        player.scandals += count
        player.bump("scandals_received", count)
        suffix = f" ({reason})" if reason else ""
        self.log_event(
            "scandal", f"{player.name} получает {count} скандал{suffix}.", player.id, count=count
        )
        if player.scandals >= 3:
            if player.role:
                self.remove_role(player, reason="3 скандала")
            player.scandals = 0

    def remove_scandal(self, player: Player, count: int = 1, reason: str = "") -> None:
        """Clear up to ``count`` scandals (never below zero)."""
        if player.scandals <= 0:
            return
        removed = min(count, player.scandals)
        player.scandals -= removed
        suffix = f" ({reason})" if reason else ""
        self.log_event(
            "scandal_removed",
            f"{player.name} снимает {removed} скандал{suffix}.",
            player.id,
            count=removed,
        )

    def clear_scandals(self, player: Player, reason: str = "") -> None:
        self.remove_scandal(player, player.scandals, reason)

    def add_roof(self, player: Player, count: int = 1) -> None:
        """Grant Крыша (roof) charges. Everyone may hold **at most one** roof; the
        Military is the exception and may stack them without limit. Roofs are NOT
        lost when a role is lost (see :meth:`remove_role`).
        """
        if player.role == Role.MILITARY.value:
            player.roofs += count
        elif player.roofs >= 1:
            self.log_event(
                "roof_gained", f"{player.name}: Крыша уже есть (максимум одна).", player.id, count=0
            )
            return
        else:
            player.roofs = 1
        self.log_event(
            "roof_gained", f"{player.name} получает Крышу (x{count}).", player.id, count=count
        )

    def consume_roof(self, player: Player) -> bool:
        """Spend one Крыша charge. Returns ``True`` if one was available."""
        if player.roofs > 0:
            player.roofs -= 1
            self.log_event("roof_used", f"{player.name} тратит Крышу.", player.id)
            return True
        return False

    def set_role(self, player: Player, role_id: str) -> bool:
        """Assign ``role_id`` to ``player`` if it is free (roles are unique)."""
        holder = self.state.role_holder(role_id)
        if holder is not None and holder.id != player.id:
            return False
        old_role = player.role
        if player.role and player.role != role_id:
            self.remove_role(player, reason="смена роли")
        player.role = role_id
        player.bump("roles_taken")
        self.log_event("role_taken", f"{player.name} берёт роль: {role_id}.", player.id, role=role_id)
        if old_role != role_id:
            from game_engine.cells.role_power import start_role_power
            start_role_power(self, player, role_id)
        return True

    def remove_role(self, player: Player, reason: str = "") -> None:
        if not player.role:
            return
        if player.flags.get("lawyers"):
            player.flags["lawyers"] -= 1
            if player.flags["lawyers"] <= 0:
                player.flags.pop("lawyers", None)
            self.log_event("role_saved", f"{player.name}: Юристы отменяют потерю роли.", player.id, role=player.role)
            return
        lost = player.role
        player.role = None
        player.bump("roles_lost")
        suffix = f" ({reason})" if reason else ""
        self.log_event("role_lost", f"{player.name} теряет роль {lost}{suffix}.", player.id, role=lost)

    def send_to_hospital(self, player: Player) -> None:
        from_ring, from_slot = player.ring, player.position
        cell = self._first_cell("hospital")
        player.ring = cell.ring
        player.position = cell.slot
        player.bump("hospital_visits")
        self.log_event("hospital", f"{player.name} отправляется в Больницу.", player.id)
        self._log_move(player, from_ring, from_slot, "teleport")

    def send_to_jail(self, player: Player) -> None:
        from_ring, from_slot = player.ring, player.position
        exp_loss = self.balance.ring_value("jail.experience_loss", player.ring)
        self.lose_experience(player, exp_loss, reason="Тюрьма")
        self.remove_role(player, reason="Тюрьма")
        cell = self._first_cell("jail")
        player.ring = cell.ring
        player.position = cell.slot
        player.bump("jail_visits")
        self.log_event("jail", f"{player.name} отправляется в Тюрьму.", player.id)
        self._log_move(player, from_ring, from_slot, "teleport")

    def _first_cell(self, type_key: str) -> BoardCell:
        cells = self.state.board.find_by_type(type_key)
        if not cells:
            # Fall back to Start on ring 0 if the map lacks this destination.
            return self.state.board.cell_at(0, 0)
        return cells[0]

    # ---- decisions -------------------------------------------------------
    def request_decision(self, decision: Decision) -> None:
        """Register a pending decision; the turn pauses until it is resolved."""
        self.state.pending_decision = decision

    def interaction_roll(self, player: Player, reason: str = "", sides: int | None = None) -> int:
        """Roll the die for an *interaction* (Bank risk, Casino gamble, '?' card …).

        This is a **separate** roll from the movement roll: cells raise a "roll"
        decision, and the player triggers this explicitly. The result is stored in
        ``last_die`` (so the UI's dice widget shows it) and logged.
        """
        die = self.rng.roll_die(sides or self.config.dice_sides)
        self.state.last_die = die
        self.state.last_die_player_id = player.id
        label = f" ({reason})" if reason else ""
        self.log_event(
            "dice_rolled", f"{player.name} бросает кубик{label}: {die}", player.id, die=die, interaction=True
        )
        player.bump("interaction_rolls")
        return die

    # ---- logging ---------------------------------------------------------
    def log_event(self, type: str, message: str, player_id: str | None = None, **data) -> GameEvent:
        return self.state.log.add(type, message, player_id=player_id, **data)
