"""Readable Markdown output for production simulations."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from city_bots import bot_policy_label
from city_engine.constants import DISTRICT_IDS, ROLE_IDS
from city_engine.content import load_catalog


def render_markdown(result: dict[str, Any]) -> str:
    catalog = load_catalog()
    config = result["config"]
    specialist = (
        f"{config.specialist_position},{config.specialist_role}" if config.specialist_position is not None else "нет"
    )
    lines = [
        "# Результаты production-симуляции «Города влияния»",
        "",
        f"Обновлено: {datetime.now(UTC).isoformat(timespec='seconds')}",
        "",
        "Эти партии сыграны через `city_engine` теми же командами и bot policy, что использует REST.",
        "",
        "## Конфигурация",
        "",
        f"- Игр: {result['games']}",
        f"- Раундов: {config.rounds}",
        f"- Игроков: {config.players}",
        f"- Цена роли: {config.role_price}◆; переворот: {config.role_price * 3}◆",
        f"- Боты: {', '.join(bot_policy_label(bot) for bot in config.bots)}",
        f"- Специалист: {specialist}",
        f"- Seed: {config.seed}",
        "",
        "## Общий результат",
        "",
        f"- Средний счёт победителя: {result['avg_winner_score']}",
        f"- Средний отрыв: {result['avg_victory_gap']}",
        f"- Победы стартового игрока: {result['starting_player_win_pct']}%",
        "",
        "### Win rate по месту",
        "",
        "| Место | Победы |",
        "|---|---:|",
    ]
    lines.extend(f"| {seat} | {value}% |" for seat, value in result["seat_win_pct"].items())
    lines.extend(["", "### Win rate по bot policy", "", "| Бот | Победы |", "|---|---:|"])
    lines.extend(
        f"| {bot_policy_label(difficulty)} | {value}% |" for difficulty, value in result["difficulty_win_pct"].items()
    )
    lines.extend(["", "## Роли", "", "| Роль | Встречалась | Win rate финального владельца |", "|---|---:|---:|"])
    for role in ROLE_IDS:
        win_rate = result["final_role_win_rate_pct"][role]
        lines.append(
            f"| {catalog.roles[role].icon} {catalog.roles[role].title} | "
            f"{result['role_seen_pct'][role]}% | {'—' if win_rate is None else f'{win_rate}%'} |"
        )
    lines.extend(
        [
            "",
            "## Районы",
            "",
            "| Район | Win rate сборок | Среднее объектов у победителя |",
            "|---|---:|---:|",
        ]
    )
    for district in DISTRICT_IDS:
        win_rate = result["district_win_rate_pct"][district]
        lines.append(
            f"| {catalog.districts[district].icon} {catalog.districts[district].title} | "
            f"{'—' if win_rate is None else f'{win_rate}%'} | "
            f"{result['avg_winner_district_assets'][district]} |"
        )
    if "specialist" in result:
        item = result["specialist"]
        lines.extend(
            [
                "",
                "## Специалист",
                "",
                f"- Win rate: {item['win_pct']}%",
                f"- Средний счёт: {item['avg_score']}",
                f"- Получил целевую роль хотя бы раз: {item['acquisition_pct']}%",
                f"- Удерживал роль в финале: {item['final_hold_pct']}%",
            ]
        )
    lines.extend(["", "## Частые объекты победителей", "", "| Объект | Победители с объектом |", "|---|---:|"])
    lines.extend(f"| {catalog.assets[asset_id].title} | {count} |" for asset_id, count in result["top_winner_assets"])
    lines.extend(["", "## Карты, сыгранные победителями", "", "| Карта | Победители, сыгравшие карту |", "|---|---:|"])
    lines.extend(
        f"| {catalog.action_cards[card_id].title} | {count} |" for card_id, count in result["top_winner_cards"]
    )
    lines.extend(
        [
            "",
            "## Источники денег победителей",
            "",
            "| Источник за всю партию | Среднее |",
            "|---|---:|",
        ]
    )
    lines.extend(f"| {source} | {value} |" for source, value in result["avg_winner_income_sources"].items())
    return "\n".join(lines) + "\n"


def write_report(path: Path, result: dict[str, Any]) -> None:
    path.write_text(render_markdown(result), encoding="utf-8")
