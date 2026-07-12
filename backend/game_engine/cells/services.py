"""Service / interactive cells: Bank, Business School, Government, Security Agency.

Implements design sections 7.1, 7.5, 7.9, 7.13.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from game_engine.cells.base import BaseCell
from game_engine.cells.common import other_players, roll_decision
from game_engine.enums import DecisionType, Role
from game_engine.models import Decision, DecisionOption
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


# ---------------------------------------------------------------------------
# Bank (Банк) — instant money bonus. The Fraudster may OPT IN to a risky roll.
# ---------------------------------------------------------------------------
@register_cell("bank")
class BankCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        bonus = int(engine.balance.ring_value("bank_bonus", cell.ring))
        start_bonus = int(engine.balance.ring_value("start_bonus", player.ring))
        loan_amount = start_bonus * int(engine.balance.get("loan.start_multiplier", 4))
        loan_term = int(engine.balance.get("loan.term_starts", 4))
        options = [DecisionOption("bonus", f"Взять банковский бонус {bonus}$")]
        if player.loan_payments_left <= 0:
            options.append(DecisionOption("loan", f"Кредит {loan_amount}$ ({loan_term} Стартов без дохода)"))
            if self.has_role(player, Role.CAPITALIST):
                options.append(DecisionOption("loan_capitalist", f"Капиталист: кредит {loan_amount}$ на {max(1, loan_term - 1)} Старта", role="capitalist"))
            if self.has_role(player, Role.POLITICIAN):
                options.append(DecisionOption("loan_politician", f"Политик: кредит {loan_amount}$ на 3 Старта (+1 скандал)", role="politician"))
            if self.has_role(player, Role.FRAUDSTER):
                options.append(DecisionOption("loan_fraudster", f"Аферист: серый кредит {int(loan_amount * 1.25)}$ (1-2 Тюрьма)", rolls_dice=True, role="fraudster"))
        elif player.money > 0:
            options.append(DecisionOption("repay", f"Погасить кредит досрочно ({player.loan_payments_left} счетч.)"))
        options.append(DecisionOption("skip", "Пропустить"))
        engine.request_decision(Decision(DecisionType.CHOOSE_OPTION, player.id, "Банк: бонус или кредит?", options, cell.type, cell.id, context={"bonus": bonus, "loan_amount": loan_amount, "loan_term": loan_term}))

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        bonus = decision.context.get("bonus", 0)
        loan_amount = int(decision.context.get("loan_amount", 0))
        loan_term = int(decision.context.get("loan_term", 4))
        if decision.context.get("kind") == "fraudster_bonus":
            if option.id == "skip":
                engine.grant_money(player, bonus, reason="Банк")
                return
            die = engine.interaction_roll(player, reason="Банк (Аферист)")
            if die <= 3:
                engine.send_to_jail(player)
            else:
                engine.grant_money(player, bonus * 2, reason="Банк (Аферист x2)")
            return
        if option.id == "skip":
            return
        if option.id == "bonus":
            if self.has_role(player, Role.CAPITALIST):
                engine.grant_money(player, bonus * 2, reason="Банк (Капиталист x2)")
            elif self.has_role(player, Role.POLITICIAN):
                engine.grant_money(player, bonus, reason="Банк")
                engine.remove_scandal(player, reason="Банк")
            elif self.has_role(player, Role.FRAUDSTER):
                engine.request_decision(roll_decision(player, "bank", cell.id, f"Банк: рискнуть? 1-3 Тюрьма, 4-6 {bonus * 2}$.", context={"kind": "fraudster_bonus", "bonus": bonus}, skip_label=f"Взять {bonus}$ без риска"))
            else:
                engine.grant_money(player, bonus, reason="Банк")
        elif option.id == "loan":
            engine.grant_money(player, loan_amount, reason="кредит банка")
            player.loan_payments_left = loan_term
        elif option.id == "loan_capitalist":
            engine.grant_money(player, loan_amount, reason="кредит банка (Капиталист)")
            player.loan_payments_left = max(1, loan_term - 1)
        elif option.id == "loan_politician":
            engine.grant_money(player, loan_amount, reason="субсидированный кредит")
            player.loan_payments_left = 3
            engine.add_scandal(player, 1, reason="субсидированный кредит")
        elif option.id == "loan_fraudster":
            die = engine.interaction_roll(player, reason="серый кредит")
            if die <= 2:
                engine.send_to_jail(player)
            else:
                engine.grant_money(player, int(loan_amount * 1.25), reason="серый кредит")
                player.loan_payments_left = loan_term
        elif option.id == "repay":
            cost = min(player.money, player.loan_payments_left * int(engine.balance.ring_value("start_bonus", player.ring)))
            if engine.charge_money(player, cost, reason="досрочное погашение кредита"):
                player.loan_payments_left = 0


# ---------------------------------------------------------------------------
# Business School (Бизнес-школа) — buy experience.
# ---------------------------------------------------------------------------
@register_cell("business_school")
class BusinessSchoolCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        cost = int(engine.balance.ring_value("business_school.cost", cell.ring))
        exp = int(engine.balance.ring_value("business_school.exp_gain", cell.ring))
        options = [DecisionOption("skip", "Пропустить")]
        context = {"cost": cost, "exp": exp}

        if self.has_role(player, Role.CAPITALIST):
            options.insert(0, DecisionOption("pay2", f"Заплатить {cost * 2}$ → {exp * 2} опыта", role="capitalist"))
            options.insert(0, DecisionOption("pay", f"Заплатить {cost}$ → {exp} опыта"))
        elif self.has_role(player, Role.POLITICIAN):
            options.insert(0, DecisionOption("free_scandal", f"Бесплатно {exp} опыта (+1 скандал)", role="politician"))
        elif self.has_role(player, Role.FRAUDSTER):
            options.insert(0, DecisionOption(
                "fake", "Фальшивый диплом (1-2 Тюрьма, 3-6 опыт даром)",
                rolls_dice=True, hint="Риск: бросок 1-2 → Тюрьма, 3-6 → опыт бесплатно.", role="fraudster",
            ))
            options.insert(0, DecisionOption("pay", f"Заплатить {cost}$ → {exp} опыта"))
        else:
            options.insert(0, DecisionOption("pay", f"Заплатить {cost}$ → {exp} опыта"))

        engine.request_decision(
            Decision(
                type=DecisionType.CHOOSE_OPTION,
                player_id=player.id,
                prompt="Бизнес-школа: получить опыт?",
                options=options,
                handler=cell.type,
                cell_id=cell.id,
                context=context,
            )
        )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        cost = decision.context["cost"]
        exp = decision.context["exp"]
        if decision.context.get("kind") == "fake_roll":
            die = engine.interaction_roll(player, reason="фальшивый диплом")
            if die <= 2:
                engine.send_to_jail(player)
            else:
                engine.grant_experience(player, exp, reason="фальшивый диплом")
            return
        if option.id == "pay":
            if engine.charge_money(player, cost, reason="Бизнес-школа"):
                engine.grant_experience(player, exp, reason="Бизнес-школа")
        elif option.id == "pay2":
            if engine.charge_money(player, cost * 2, reason="Бизнес-школа x2"):
                engine.grant_experience(player, exp * 2, reason="Бизнес-школа x2")
        elif option.id == "free_scandal":
            engine.grant_experience(player, exp, reason="Бизнес-школа (Политик)")
            engine.add_scandal(player, 1, reason="Бизнес-школа даром")
        elif option.id == "fake":
            # Deliberate, separate roll for the risky fake diploma.
            engine.request_decision(
                roll_decision(
                    player, cell.type, cell.id,
                    "Фальшивый диплом: бросьте кубик (1-2 Тюрьма, 3-6 опыт даром).",
                    context={"kind": "fake_roll", "cost": cost, "exp": exp},
                )
            )


# ---------------------------------------------------------------------------
# Government (Госучреждение) — bureaucracy, subsidies, checks.
# ---------------------------------------------------------------------------
@register_cell("government")
class GovernmentCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        fee = int(engine.balance.ring_value("government.fee", cell.ring))
        subsidy = int(engine.balance.ring_value("government.subsidy", cell.ring))
        mafia_fine = int(engine.balance.ring_value("government.mafia_fine", cell.ring))
        context = {"fee": fee, "subsidy": subsidy, "mafia_fine": mafia_fine}

        if self.has_role(player, Role.POLITICIAN):
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_OPTION, player.id,
                    "Политик: выбрать одно",
                    [
                        DecisionOption("subsidy", f"Субсидия +{subsidy}$", role="politician"),
                        DecisionOption("scandal", "Снять 1 скандал", role="politician"),
                    ],
                    handler=cell.type, cell_id=cell.id, context={**context, "kind": "politician"},
                )
            )
        elif self.has_role(player, Role.CAPITALIST):
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_OPTION, player.id,
                    f"Капиталист: заплати {fee}$ и выбери одно",
                    [
                        DecisionOption("roof", "Легальная защита (Крыша)", role="capitalist"),
                        DecisionOption("scandal", "Снять 1 скандал", role="capitalist"),
                    ],
                    handler=cell.type, cell_id=cell.id, context={**context, "kind": "capitalist"},
                )
            )
        elif self.has_role(player, Role.FRAUDSTER):
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_OPTION, player.id,
                    "Аферист: пройти проверку или притвориться Политиком?",
                    [
                        DecisionOption("base", f"Заплатить сбор {fee}$", role="fraudster"),
                        DecisionOption(
                            "pretend", "Притвориться (1-2 Тюрьма, 3-6 субсидия)",
                            rolls_dice=True, hint="Риск: бросок 1-2 → Тюрьма, 3-6 → субсидия.", role="fraudster",
                        ),
                    ],
                    handler=cell.type, cell_id=cell.id, context={**context, "kind": "fraudster"},
                )
            )
        elif self.has_role(player, Role.MAFIA):
            engine.request_decision(
                Decision(
                    DecisionType.CHOOSE_OPTION, player.id,
                    f"Мафиози: заплати штраф {mafia_fine}$ или Тюрьма",
                    [
                        DecisionOption("pay", f"Заплатить {mafia_fine}$", role="mafia"),
                        DecisionOption("jail", "В Тюрьму", role="mafia"),
                    ],
                    handler=cell.type, cell_id=cell.id, context={**context, "kind": "mafia"},
                )
            )
        else:
            engine.charge_money(player, fee, reason="административный сбор")

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        ctx = decision.context
        kind = ctx.get("kind")
        if kind == "pretend_roll":
            die = engine.interaction_roll(player, reason="притвориться Политиком")
            if die <= 2:
                engine.send_to_jail(player)
            else:
                engine.grant_money(player, ctx["subsidy"], reason="поддельная субсидия")
            return
        if kind == "politician":
            if option.id == "subsidy":
                engine.grant_money(player, ctx["subsidy"], reason="субсидия")
            else:
                engine.remove_scandal(player)
        elif kind == "capitalist":
            if not engine.charge_money(player, ctx["fee"], reason="госсбор"):
                return
            if option.id == "roof":
                engine.add_roof(player)
            else:
                engine.remove_scandal(player)
        elif kind == "fraudster":
            if option.id == "base":
                engine.charge_money(player, ctx["fee"], reason="административный сбор")
            else:
                # Deliberate, separate roll for the risky impersonation.
                engine.request_decision(
                    roll_decision(
                        player, cell.type, cell.id,
                        "Притвориться Политиком: бросьте кубик (1-2 Тюрьма, 3-6 субсидия).",
                        context={**ctx, "kind": "pretend_roll"},
                    )
                )
        elif kind == "mafia":
            if option.id == "pay":
                engine.charge_money(player, ctx["mafia_fine"], reason="штраф госучреждению")
            else:
                engine.send_to_jail(player)

    @staticmethod
    def _remove_scandal(engine: GameEngine, player: Player) -> None:
        engine.remove_scandal(player)


# ---------------------------------------------------------------------------
# Security Agency (Охранное агентство) — Крыша marketplace. Not buyable.
# ---------------------------------------------------------------------------
@register_cell("security_agency")
class SecurityAgencyCell(BaseCell):
    def on_land(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        if self.has_role(player, Role.MAFIA):
            engine.add_roof(player)  # free roof
            return
        if self.has_role(player, Role.MILITARY):
            self._offer_military(engine, player, cell)
            return
        if self.has_role(player, Role.CAPITALIST):
            owned = [c for c in engine.state.board.cells_owned_by(player.id) if c.id not in player.insured_cells]
            if owned:
                engine.request_decision(
                    Decision(
                        DecisionType.CHOOSE_OPTION, player.id, "Капиталист: какой объект застраховать?",
                        [DecisionOption(c.id, c.title, {"cell_id": c.id}, role="capitalist") for c in owned]
                        + [DecisionOption("skip", "Не страховать")],
                        handler=cell.type, cell_id=cell.id, context={"kind": "insure"},
                    )
                )
                return
        # Base: buy Крыша.
        self._offer_roof(engine, player, cell)

    def _offer_roof(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        if player.roofs > 0:
            engine.log_event("roof_owned", f"{player.name}: Крыша уже есть, повторная покупка недоступна.", player.id)
            return
        price = int(engine.balance.ring_value("roof_price", cell.ring))
        engine.request_decision(
            Decision(
                DecisionType.YES_NO, player.id, f"Купить Крышу за {price}$?",
                [DecisionOption("buy", f"Купить за {price}$"), DecisionOption("skip", "Отказаться")],
                handler=cell.type, cell_id=cell.id, context={"kind": "buy", "price": price},
            )
        )

    def _offer_military(self, engine: GameEngine, player: Player, cell: BoardCell) -> None:
        """Военный: снять Крышу с игрока (если у кого-то есть) ИЛИ купить свою."""
        price = int(engine.balance.ring_value("roof_price", cell.ring))
        targets = [p for p in other_players(engine.state, player) if p.roofs > 0]
        options: list[DecisionOption] = [
            DecisionOption(f"remove:{p.id}", f"Снять Крышу с {p.name}", {"player_id": p.id}, role="military")
            for p in targets
        ]
        if player.money >= price:
            options.append(DecisionOption("buy", f"Купить свою Крышу за {price}$", role="military"))
        options.append(DecisionOption("skip", "Отказаться"))
        engine.request_decision(
            Decision(
                DecisionType.CHOOSE_OPTION, player.id,
                "Военный: снять Крышу с игрока или купить свою?",
                options, handler=cell.type, cell_id=cell.id,
                context={"kind": "military", "price": price},
            )
        )

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        kind = decision.context.get("kind")
        if kind == "buy":
            if option.id == "buy" and player.roofs == 0 and engine.charge_money(player, decision.context["price"], reason="Крыша"):
                engine.add_roof(player)
        elif kind == "military":
            if option.id == "buy":
                if engine.charge_money(player, decision.context["price"], reason="Крыша"):
                    engine.add_roof(player)
            elif option.id.startswith("remove:"):
                target = engine.state.player_by_id(option.data["player_id"])
                if engine.consume_roof(target):
                    engine.log_event("security", f"{player.name} снял Крышу с {target.name}.", player.id)
            # "skip" -> ничего не делаем
        elif kind == "insure":
            if option.id != "skip":
                target_cell = engine.state.board.by_id(option.data["cell_id"])
                player.insured_cells.add(target_cell.id)
                engine.log_event("insured", f"{player.name} застраховал «{target_cell.title}».", player.id)
