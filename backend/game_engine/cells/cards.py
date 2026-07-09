"""Held and instant "?" cards.

The card system intentionally reuses the same Decision flow as cells: using a
card can pause the game, ask for a target, then resolve through this behaviour.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from game_engine.cells.base import BaseCell
from game_engine.cells.common import CANCEL_OPTION_ID, MapCandidate, do_upgrade, map_pick_decision, player_options, upgraded_value
from game_engine.config_loader import load_question_cards, load_role_ids, load_roles
from game_engine.enums import DecisionType
from game_engine.models import Decision, DecisionOption
from game_engine.registry import register_cell

if TYPE_CHECKING:
    from game_engine.engine import GameEngine
    from game_engine.models import BoardCell, Player


_CARDS = load_question_cards()
_BY_ID = {c["id"]: c for c in _CARDS}
_ROLE_IDS = load_role_ids()
_ROLE_TITLES = {r["id"]: r["title"] for r in load_roles()}


def cards_by_deck(deck: str) -> list[dict[str, Any]]:
    return [c for c in _CARDS if c.get("deck", "hand") == deck]


def card_title(card_id: str) -> str:
    return _BY_ID.get(card_id, {}).get("title", card_id)


def draw_card(engine: GameEngine, deck: str) -> dict[str, Any]:
    cards = cards_by_deck(deck)
    if not cards:
        cards = _CARDS
    weights = [max(1, int(c.get("weight", 1))) for c in cards]
    total = sum(weights)
    pick = engine.rng.randint(1, total)
    upto = 0
    for card, weight in zip(cards, weights, strict=True):
        upto += weight
        if pick <= upto:
            return card
    return cards[-1]


def give_card(engine: GameEngine, player: Player, deck: str = "hand") -> None:
    card = draw_card(engine, deck)
    if card.get("play", "held") == "instant":
        engine.log_event("card_drawn", f"{player.name} тянет мгновенную карту: «{card['title']}».", player.id, card_id=card["id"])
        CardSystem().start_card(engine, player, card["id"], from_hand=False)
        return
    player.cards.append(card["id"])
    engine.log_event("card_drawn", f"{player.name} получает карту в руку: «{card['title']}».", player.id, card_id=card["id"])


@register_cell("cards")
class CardSystem(BaseCell):
    """Virtual behaviour used as a decision handler for playing cards."""

    def start_card(self, engine: GameEngine, player: Player, card_id: str, *, from_hand: bool = True) -> None:
        card = _BY_ID.get(card_id)
        if not card:
            engine.log_event("card", f"Неизвестная карта: {card_id}", player.id)
            return
        effect = card.get("effect", {})
        kind = effect.get("kind")
        ctx = {"card_id": card_id, "kind": kind, "from_hand": from_hand}

        if kind in {"kompromat", "crisis"}:
            targets = [p for p in engine.state.players if p.id != player.id]
            if not targets:
                return
            prompt = "Выберите игрока для карты «{}».".format(card["title"])
            engine.request_decision(Decision(DecisionType.CHOOSE_PLAYER, player.id, prompt, player_options(targets), "cards", context=ctx))
        elif kind == "public_hearing":
            for target in engine.state.players:
                if target.role:
                    engine.add_scandal(target, 1, reason=card["title"])
            self._consume(engine, player, card_id, from_hand)
        elif kind == "staff_shuffle":
            taken = {p.role for p in engine.state.players if p.role}
            roles = [r for r in _ROLE_IDS if r not in taken]
            if not roles:
                engine.log_event("card", "Свободных ролей нет.", player.id)
                self._consume(engine, player, card_id, from_hand)
                return
            options = [DecisionOption(r, _ROLE_TITLES.get(r, r), {"role": r}) for r in roles]
            engine.request_decision(Decision(DecisionType.CHOOSE_ROLE, player.id, "Кадровая перестановка: выберите свободную роль.", options, "cards", context=ctx))
        elif kind == "free_upgrade":
            self._pick_owned_cell(engine, player, ctx, "Выберите свой объект для бесплатного улучшения.", lambda c: c.buyable and c.owner_id == player.id and not c.state.get("upgraded"))
        elif kind == "tax_optimization":
            player.flags["payment_shield"] = player.flags.get("payment_shield", 0) + 1
            engine.log_event("card", f"{player.name}: следующий платеж или штраф будет отменен.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "insurance_case":
            player.flags["bankruptcy_full_refund"] = player.flags.get("bankruptcy_full_refund", 0) + 1
            engine.log_event("card", f"{player.name}: следующий банкротный откат вернет 100%.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "good_sale":
            self._pick_owned_cell(engine, player, ctx, "Выгодная продажа: выберите свой объект.", lambda c: c.owner_id == player.id)
        elif kind == "taxi_card":
            self._pick_any_cell(engine, player, ctx, "Такси по знакомству: выберите клетку текущего круга.", lambda c: c.ring == player.ring and c.id != engine.state.board.cell_at(player.ring, player.position).id)
        elif kind == "ticket":
            self._pick_any_cell(engine, player, ctx, "Билет: выберите любой вокзал.", lambda c: c.type == "station")
        elif kind == "detour":
            player.flags["detour"] = player.flags.get("detour", 0) + 1
            engine.log_event("card", f"{player.name}: следующая Засада/Блокпост будет проигнорирована.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "navigator":
            player.flags["navigator"] = player.flags.get("navigator", 0) + 1
            engine.log_event("card", f"{player.name}: следующий бросок движения будет увеличен на 1.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "double_turn":
            player.extra_rolls += 1
            engine.log_event("card", f"{player.name} получает дополнительный бросок.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "aggressive_expansion":
            player.flags["next_purchase_discount"] = max(float(player.flags.get("next_purchase_discount", 0) or 0), 0.5)
            engine.add_scandal(player, 1, reason=card["title"])
            self._consume(engine, player, card_id, from_hand)
        elif kind == "lawyers":
            player.flags["lawyers"] = player.flags.get("lawyers", 0) + 1
            engine.log_event("card", f"{player.name}: следующая потеря роли будет отменена.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "black_accounting":
            player.flags["next_income_x2"] = player.flags.get("next_income_x2", 0) + 1
            engine.log_event("card", f"{player.name}: следующий денежный доход будет x2.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "family_business":
            player.flags["family_business"] = True
            engine.log_event("card", f"{player.name} открывает семейный бизнес: Еда/Жилье дают +1 опыт при покупке.", player.id)
            self._consume(engine, player, card_id, from_hand)
        elif kind == "relative_admin":
            engine.request_decision(Decision(DecisionType.CHOOSE_OPTION, player.id, "Родственник в администрации: что выбрать?", [
                DecisionOption("roof", "Получить Крышу"),
                DecisionOption("scandal", "Снять 1 скандал"),
            ], "cards", context=ctx))
        elif kind == "awkward_interview":
            leader = max(engine.state.players, key=engine.state.net_worth)
            engine.add_scandal(leader, 1, reason=card["title"])
            self._consume(engine, player, card_id, from_hand)
        elif kind == "charity":
            for target in engine.state.players:
                engine.charge_money(target, 50, reason=card["title"])
            self._consume(engine, player, card_id, from_hand)
        elif kind == "raid_interest":
            self._pick_any_cell(engine, player, ctx, "Рейдерский интерес: выберите чужой объект.", lambda c: c.buyable and c.owner_id and c.owner_id != player.id)
        elif kind == "fire_inspection":
            self._pick_any_cell(engine, player, ctx, "Пожарная инспекция: выберите улучшенный объект.", lambda c: c.buyable and c.state.get("upgraded"))
        elif kind == "bad_reviews":
            self._strip_upgrades(engine, "food", "Плохие отзывы")
            self._consume(engine, player, card_id, from_hand)
        elif kind == "eviction":
            self._strip_upgrades(engine, "dormitory", "Выселение")
            self._consume(engine, player, card_id, from_hand)
        else:
            engine.log_event("card", f"Карта «{card['title']}» пока не имеет эффекта.", player.id)
            self._consume(engine, player, card_id, from_hand)

    def on_resolve(self, engine, player, cell, decision, option) -> None:
        ctx = decision.context
        card_id = ctx["card_id"]
        kind = ctx["kind"]
        from_hand = bool(ctx.get("from_hand", True))

        if kind == "kompromat":
            target = engine.state.player_by_id(option.data["player_id"])
            engine.add_scandal(target, 1, reason=card_title(card_id))
        elif kind == "crisis":
            target = engine.state.player_by_id(option.data["player_id"])
            engine.remove_role(target, reason=card_title(card_id))
        elif kind == "staff_shuffle":
            engine.set_role(player, option.data["role"])
        elif kind == "free_upgrade":
            target = engine.state.board.by_id(option.data["cell_id"])
            do_upgrade(engine, player, target, free=True)
        elif kind == "good_sale":
            target = engine.state.board.by_id(option.data["cell_id"])
            value = upgraded_value(engine, target)
            target.owner_id = None
            target.state.pop("upgraded", None)
            engine.grant_money(player, value, reason=f"выгодная продажа «{target.title}»")
        elif kind == "taxi_card" or kind == "ticket":
            if option.id != CANCEL_OPTION_ID:
                target = engine.state.board.by_id(option.data["cell_id"])
                engine.teleport(player, target.ring, target.slot, activate=True)
        elif kind == "relative_admin":
            if option.id == "roof":
                engine.add_roof(player)
            else:
                engine.remove_scandal(player, reason=card_title(card_id))
        elif kind == "raid_interest":
            if option.id != CANCEL_OPTION_ID:
                target = engine.state.board.by_id(option.data["cell_id"])
                owner = engine.state.player_by_id(target.owner_id)
                price = upgraded_value(engine, target) * 2
                if engine.transfer_money(player, owner, price, reason=f"рейдерская покупка «{target.title}»"):
                    target.owner_id = player.id
                    engine.log_event("card", f"{player.name} выкупает «{target.title}» за {price}$.", player.id, cell_id=target.id)
        elif kind == "fire_inspection":
            if option.id != CANCEL_OPTION_ID:
                target = engine.state.board.by_id(option.data["cell_id"])
                target.state.pop("upgraded", None)
                engine.log_event("card", f"«{target.title}» теряет улучшение.", player.id, cell_id=target.id)

        self._consume(engine, player, card_id, from_hand)

    def _consume(self, engine: GameEngine, player: Player, card_id: str, from_hand: bool) -> None:
        if from_hand and card_id in player.cards:
            player.cards.remove(card_id)

    def _pick_owned_cell(self, engine: GameEngine, player: Player, ctx: dict[str, Any], prompt: str, predicate) -> None:
        self._pick_any_cell(engine, player, ctx, prompt, predicate)

    def _pick_any_cell(self, engine: GameEngine, player: Player, ctx: dict[str, Any], prompt: str, predicate) -> None:
        candidates = [
            MapCandidate(c.id, affordable=True, cost=0, note=f"«{c.title}»")
            for c in engine.state.board.all_cells()
            if predicate(c)
        ]
        if not candidates:
            engine.log_event("card", "Нет подходящих целей для карты.", player.id)
            self._consume(engine, player, ctx["card_id"], bool(ctx.get("from_hand", True)))
            return
        engine.request_decision(map_pick_decision(
            player,
            handler="cards",
            cell_id=None,
            prompt=prompt,
            candidates=candidates,
            action_kind="card_target",
            confirm_label="Применить карту",
            cancel_label="Отмена",
            extra_context=ctx,
        ))

    def _strip_upgrades(self, engine: GameEngine, type_key: str, reason: str) -> None:
        count = 0
        for cell in engine.state.board.all_cells():
            if cell.type == type_key and cell.state.get("upgraded"):
                cell.state.pop("upgraded", None)
                count += 1
        engine.log_event("card", f"{reason}: улучшения потеряны ({count}).")
