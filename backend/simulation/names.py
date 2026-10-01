"""Игровые названия для отчётов: тестировщики читают «Робототехника», а не ``robotics``.

Названия объектов, проектов, карт, ролей и районов берутся из каталога игры, остальное — способности,
серые операции, базовые действия — из русской локализации клиента, той же, что видит игрок. Если файл
локализации недоступен (сборка без фронтенда), подпись падает обратно на код: отчёт не должен ломаться
из-за отсутствующего перевода.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from city_engine.engine import CityEngine

_LOCALE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n" / "locales" / "ru" / "game.json"

_BASIC = {
    "work": "Городской заказ (+2$)",
    "patronage": "Патронаж",
    "lobbying": "Лоббирование",
    "campaign": "Кампания",
}
_PLAIN = {
    "end_turn": "Завершить ход",
    "buy_capacity": "Купить слот",
    "buy_roof": "Купить Защиту",
    "crisis_pr": "Антикризисный PR",
    "buy_action_card": "Купить карты действий",
    "reroll_projects": "Пересобрать доску проектов",
    "market_refresh": "Пересдать слот рынка",
}


@cache
def _locale() -> dict[str, Any]:
    try:
        return json.loads(_LOCALE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _find(tree: dict[str, Any], section: str) -> dict[str, Any]:
    """Первый раздел с таким именем на любой глубине: ``power`` и ``grey`` лежат внутри ``game``."""
    stack = [tree]
    while stack:
        node = stack.pop()
        for key, value in node.items():
            if isinstance(value, dict):
                if key == section:
                    return value
                stack.append(value)
    return {}


def _label(section: str, key: str) -> str | None:
    entry = _find(_locale(), section).get(key)
    if isinstance(entry, dict):
        return entry.get("label")
    return entry if isinstance(entry, str) else None


class Names:
    def __init__(self, engine: CityEngine) -> None:
        self.engine = engine
        catalog = engine.catalog
        self.assets = {key: value.title for key, value in catalog.assets.items()}
        self.projects = {key: value.title for key, value in catalog.projects.items()}
        self.cards = {key: value.title for key, value in catalog.action_cards.items()}
        self.roles = {key: value.title for key, value in catalog.roles.items()}
        self.districts = {key: value.title for key, value in catalog.districts.items()}
        rarity = _find(_locale(), "rarity")
        self.rarities = {key: str(rarity.get(key, key)) for key in catalog.rarity_min_round}

    def asset(self, card: str) -> str:
        return self.assets.get(card, card)

    def project(self, project_id: str) -> str:
        return self.projects.get(project_id, project_id)

    def card(self, card_id: str) -> str:
        return self.cards.get(card_id, card_id)

    def role(self, role: str | None) -> str:
        return "без роли" if role in (None, "—") else self.roles.get(role, role)

    def district(self, district: str | None) -> str:
        return "—" if district is None else self.districts.get(district, district)

    def rarity(self, rarity: str) -> str:
        return self.rarities.get(rarity, rarity)

    def power(self, power: str) -> str:
        return _label("power", power) or power

    def grey(self, operation: str) -> str:
        return _label("grey", operation) or operation

    def decision(self, key: str) -> str:
        """Подпись класса решения из ``simulation.balance.action_key``."""
        kind, _, rest = key.partition(":")
        if kind == "basic_action":
            flavour, _, spend = rest.partition(":")
            base = _BASIC.get(flavour, flavour)
            return f"{base} ({spend}$)" if spend else base
        if kind == "buy_asset":
            return f"Купить «{self.asset(rest)}»"
        if kind == "sell_asset":
            return f"Продать «{self.asset(rest)}»"
        if kind == "play_action_card":
            return f"Сыграть «{self.card(rest)}»"
        if kind == "convert_action_card":
            return "Сбросить карту за $" if rest == "money" else "Сбросить карту за ◆"
        if kind == "use_role_power":
            return f"Способность: {self.power(rest)}"
        if kind == "grey_operation":
            return f"Серая операция: {self.grey(rest)}"
        if kind == "city_project":
            return f"Проект «{self.project(rest)}»"
        if kind == "claim_role":
            return f"Взять роль: {self.role(rest)}"
        return _PLAIN.get(kind, key)

    def glossary(self) -> list[tuple[str, str, str]]:
        """(раздел, название, код) — для разработчика, который ищет строку отчёта в контенте."""
        rows: list[tuple[str, str, str]] = []
        for section, table in (
            ("Объект", self.assets),
            ("Проект", self.projects),
            ("Карта", self.cards),
            ("Роль", self.roles),
            ("Район", self.districts),
        ):
            rows.extend((section, title, key) for key, title in table.items())
        return sorted(rows, key=lambda row: (row[0], row[1]))


__all__ = ["Names"]
