"""Compact text projections of a room view, tuned for an agent reading a terminal.

Everything here is derived from `/state`: the same JSON the React client renders. Nothing in
this module talks to the engine, so it also works against a remote deployment.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

POWER_LABELS = {
    "capitalist_financing": "ускоренное финансирование",
    "politician_tax": "налог района",
    "politician_cleanup": "снять скандал",
    "journalist_inflate": "раздуть историю",
    "journalist_publish": "публикация",
    "mafia_racket": "рэкет",
    "mafia_sweep": "сжечь связи",
    "mafia_cleanup": "замять дело",
    "military_sanction": "санкции",
    "fraudster_cleanup": "очистка следов",
    "fraudster_crypto_scam": "криптоскам",
    "fraudster_forge": "подделка документов",
}

# Which offers do not consume one of the three turn actions. The engine spends an action inside
# each handler, so this is the only place a reader can learn it — and a whole match was misplayed
# on the assumption that a role power costs a turn action the way a basic action does.
FREE_ACTION_TYPES = frozenset(
    {
        "reroll_market",
        "reroll_projects",
        "play_action_card",
        "convert_action_card",
        "move_automation",
        # Selling is free: the only reason to sell is the purchase that follows, and charging an
        # action for the sale made a swap cost two actions where a purchase costs one.
        "sell_asset",
    }
)
FREE_POWERS = frozenset(
    {
        "capitalist_financing",
        "politician_tax",
        "politician_cleanup",
        "journalist_inflate",
        "journalist_publish",
        "mafia_cleanup",
    }
)

GREY_LABELS = {
    "cash": "отмывание: за деньги получить влияние",
    "market": "контрабанда: украсть деньги у цели",
    "crypto": "памп и дамп: деньги и удар по лидеру",
    "datacenter": "взлом: украсть влияние у цели",
    "influence_broker": "слив компромата: снять роль с цели (раз в раунд, Крыша гасит)",
}

CAPACITY_COSTS = {3: 6, 4: 10, 5: 15}


@dataclass(slots=True)
class Catalog:
    districts: dict[str, dict[str, Any]]
    roles: dict[str, dict[str, Any]]
    assets: dict[str, dict[str, Any]]
    cards: dict[str, dict[str, Any]]
    projects: dict[str, dict[str, Any]]
    events: dict[str, dict[str, Any]]
    # Not all of `scoring` is a number: the campaign tiers travel as a list of {spend, gain} pairs.
    scoring: dict[str, Any]

    @classmethod
    def from_meta(cls, meta: dict[str, Any]) -> Catalog:
        def index(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
            return {str(row["id"]): row for row in rows}

        return cls(
            districts=index(meta.get("districts", [])),
            roles=index(meta.get("roles", [])),
            assets=index(meta.get("assets", [])),
            cards=index(meta.get("action_cards", [])),
            projects=index(meta.get("projects", [])),
            events=index(meta.get("events", [])),
            scoring=dict(meta.get("scoring") or {}),
        )

    def project_title(self, project_id: str) -> str:
        return str(self.projects.get(project_id, {}).get("title", project_id))

    def project_requirement(self, project_id: str) -> str:
        requirement = dict(self.projects.get(project_id, {}).get("requirement") or {})
        kind = str(requirement.get("type", "none"))
        count = int(requirement.get("count", 1))
        if kind == "none":
            return "без условия"
        if kind == "assets":
            return f"объектов ≥{count}"
        if kind == "automation":
            return "нужен жетон автоматизации"
        if kind == "role":
            return "любая роль"
        if kind == "max_scandals":
            return f"скандалов ≤{count}"
        if kind == "district_objects":
            return f"{self.district_title(str(requirement.get('district')))} ≥{count}"
        if kind == "district_depth":
            return f"в одном районе ≥{count}"
        if kind == "distinct_districts":
            return f"разных районов ≥{count}"
        if kind == "tag_objects":
            return f"объектов с тегом {requirement.get('tag')} ≥{count}"
        return kind

    def asset_title(self, card_id: str) -> str:
        return str(self.assets.get(card_id, {}).get("title", card_id))

    def card_title(self, card_id: str) -> str:
        return str(self.cards.get(card_id, {}).get("title", card_id))

    def role_title(self, role_id: str) -> str:
        return str(self.roles.get(role_id, {}).get("title", role_id))

    def district_title(self, district_id: str) -> str:
        return str(self.districts.get(district_id, {}).get("title", district_id))


def player_name(game: dict[str, Any], player_id: Any) -> str:
    for player in game["players"]:
        if player["id"] == player_id:
            return str(player["name"])
    return "—" if player_id in (None, "") else str(player_id)


def score_of(game: dict[str, Any], player: dict[str, Any]) -> int:
    """The engine ships the breakdown in `/state`; never recompute the formula here."""
    breakdown = game.get("score_breakdown", {}).get(player["id"], {})
    return int(breakdown.get("total", 0))


def roof_price(game: dict[str, Any], player: dict[str, Any]) -> int:
    base = 3 + (int(game["round_number"]) - 1) // 2
    return base - 1 if "mafia" in (player["role"], player["copied_role"]) else base


def _payload_hint(action: dict[str, Any], game: dict[str, Any], me: dict[str, Any], catalog: Catalog) -> str:
    payload = action["payload"]
    bits: list[str] = []
    market_uid = payload.get("market_uid")
    if market_uid:
        item = next((entry for entry in game["market"] if entry["uid"] == market_uid), None)
        if item:
            asset = catalog.assets.get(item["card_id"], {})
            price = item.get("price", asset.get("cost"))
            bits.append(
                f"«{catalog.asset_title(item['card_id'])}» {price}$ доход {asset.get('income', '?')}$ "
                f"{catalog.district_title(str(asset.get('district', '')))} {asset.get('rarity', '')}"
            )
    asset_uid = payload.get("asset_uid")
    if asset_uid:
        owned = next((entry for entry in me["assets"] if entry["uid"] == asset_uid), None)
        if owned:
            bits.append(f"«{catalog.asset_title(owned['card_id'])}»")
        if action["type"] in {"move_automation", "buy_automation"}:
            # A total reads as a price tag; the decision is the difference against where the
            # token stands now — or against no token at all when it is still being bought.
            income = (game.get("automation_preview") or {}).get(asset_uid)
            baseline = game.get("automation_baseline")
            current = (game.get("automation_preview") or {}).get(me.get("automation_uid"))
            reference = baseline if action["type"] == "buy_automation" else current
            if income is not None and reference is not None:
                bits.append(f"{income - reference:+d}$/раунд (итого {income}$)")
            elif income is not None:
                bits.append(f"доход станет {income}$/раунд")
    card_uid = payload.get("card_uid")
    if card_uid:
        held = next((entry for entry in me.get("hand", []) if entry["uid"] == card_uid), None)
        if held:
            bits.append(f"«{catalog.card_title(held['card_id'])}»")
    if payload.get("card_id"):
        bits.append(f"«{catalog.card_title(str(payload['card_id']))}»")
    project_id = payload.get("project_id")
    if project_id:
        project = catalog.projects.get(str(project_id), {})
        bits.append(
            f"«{catalog.project_title(str(project_id))}» {project.get('cost_influence', '?')}◆"
            f"+{project.get('cost_money', '?')}$ → {project.get('points', '?')} очков"
        )
    if payload.get("power"):
        bits.append(POWER_LABELS.get(str(payload["power"]), str(payload["power"])))
        if str(payload["power"]) in FREE_POWERS:
            bits.append("действие не расходуется")
    if payload.get("asset_id") and action["type"] == "grey_operation":
        bits.append(GREY_LABELS.get(str(payload["asset_id"]), str(payload["asset_id"])))
    if payload.get("target_id"):
        bits.append(f"→ {player_name(game, payload['target_id'])}")
    if payload.get("district"):
        bits.append(catalog.district_title(str(payload["district"])))
    if payload.get("role_id"):
        bits.append(catalog.role_title(str(payload["role_id"])))
    if action["type"] == "buy_roof":
        bits.append(f"{roof_price(game, me)}$")
    if action["type"] == "buy_capacity":
        bits.append(f"слот {int(me['capacity']) + 1} за {CAPACITY_COSTS.get(int(me['capacity']), '?')}$")
    if action["type"] == "claim_role":
        holder = next((p for p in game["players"] if p["role"] == payload.get("role_id")), None)
        price = int(game["role_price"]) * (3 if holder else 1)
        bits.append(f"{price}◆" + (f", перехват у {holder['name']}" if holder else ", свободна"))
    if action["type"] == "develop_district":
        bits.append("2$ · +25% к базовому доходу ваших объектов района, максимум 2 уровня, +1◆")
    if action["type"] == "crisis_pr":
        bits.append("снять 1 скандал")
    if action["type"] == "buy_action_card":
        bits.append("две случайные карты из колоды")
    if action["type"] == "basic_action":
        # The tier is the decision: the same action buys 2◆, 3◆ or 4◆ at a worsening rate.
        tiers = {int(row["spend"]): int(row["gain"]) for row in catalog.scoring.get("campaign_tiers") or []}
        spend = payload.get("spend")
        # No "→" in a hint: the transcript uses "→ " to mark the commands it played.
        if payload.get("kind") == "campaign" and spend is not None and int(spend) in tiers:
            bits.append(f"{int(spend)}$ за {tiers[int(spend)]}◆")
        elif payload.get("kind") == "work":
            bits.append("+2$")
    if action["type"] == "sell_asset":
        bits.append("слот освобождается, жетон автоматизации снимается")
    return " ".join(bits)


def describe_action(
    index: int, action: dict[str, Any], game: dict[str, Any], me: dict[str, Any], catalog: Catalog
) -> str:
    payload = " ".join(f"{key}={value}" for key, value in sorted(action["payload"].items()))
    hint = _payload_hint(action, game, me, catalog)
    if action["type"] in FREE_ACTION_TYPES:
        hint = f"{hint} · действие не расходуется" if hint else "действие не расходуется"
    line = f"[{index:>2}] {action['type']}"
    if payload:
        line = f"{line} {payload}"
    return f"{line}   · {hint}" if hint else line


# A family printed one line per variant is what made the action list 43% of the whole board dump.
# Folded families are still playable — `resolve_action` addresses them by type plus payload filters.
FOLD_AFTER = 6
FOLD_HINTS = {
    "sell_asset": "продать свой объект за половину цены (без действия)",
    "move_automation": "перенести жетон автоматизации (бесплатно, раз в ход)",
    "buy_asset": "купить объект с рынка",
    "convert_action_card": "сбросить карту в 1$ или 1◆",
    "claim_role": "занять роль",
    "buy_action_card": "купить карту действия",
    "city_project": "забрать проект с доски",
    "play_action_card": "разыграть карту из руки",
    "use_role_power": "способность роли",
    "grey_operation": "серая операция",
    "develop_district": "развить район",
    "buy_automation": "купить жетон автоматизации и поставить на объект",
    "buy_capacity": "купить дополнительный слот бизнеса",
}


def _value_label(key: str, value: str, game: dict[str, Any], me: dict[str, Any], catalog: Catalog) -> str:
    """A payload value with the one number that makes it a decision — price, refund, income."""
    if key == "market_uid":
        item = next((entry for entry in game["market"] if entry["uid"] == value), None)
        if item:
            asset = catalog.assets.get(item["card_id"], {})
            price = item.get("price", asset.get("cost", "?"))
            return f"{value} ({catalog.asset_title(item['card_id'])}, {price}$, доход {asset.get('income', '?')}$)"
    if key == "asset_uid":
        owned = next((entry for entry in me["assets"] if entry["uid"] == value), None)
        if owned:
            cost = int(catalog.assets.get(owned["card_id"], {}).get("cost", 0))
            return f"{value} ({catalog.asset_title(owned['card_id'])}, возврат {cost // 2}$)"
    if key == "project_id":
        project = catalog.projects.get(value, {})
        price = f"{project.get('cost_influence', '?')}◆+{project.get('cost_money', '?')}$"
        return f"{value} ({price} → {project.get('points', '?')} очков)"
    if key in {"target_id", "previous_holder_id"}:
        return f"{value} ({player_name(game, value)})"
    if key == "role_id":
        return f"{value} ({catalog.role_title(value)})"
    if key == "district":
        return f"{value} ({catalog.district_title(value)})"
    return value


def render_actions(
    legal: list[dict[str, Any]],
    game: dict[str, Any],
    me: dict[str, Any],
    catalog: Catalog,
    *,
    fold_after: int = FOLD_AFTER,
) -> list[str]:
    """Numbered lines for small families, one folded block for the combinatorial ones."""
    if not legal:
        return ["  нет доступных команд (ход соперника или партия завершена)"]
    groups: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for index, action in enumerate(legal):
        groups.setdefault(str(action["type"]), []).append((index, action))

    lines: list[str] = []
    for action_type, entries in groups.items():
        if len(entries) <= fold_after:
            lines.extend(describe_action(index, action, game, me, catalog) for index, action in entries)
            continue
        keys = sorted({key for _, action in entries for key in action["payload"]})
        lines.append(f"[по типу] {action_type} ×{len(entries)} — {FOLD_HINTS.get(action_type, '')}")
        for key in keys:
            values = sorted({str(action["payload"][key]) for _, action in entries if key in action["payload"]})
            labelled = [_value_label(key, value, game, me, catalog) for value in values[:10]]
            shown = ", ".join(labelled) + (f" … ещё {len(values) - 10}" if len(values) > 10 else "")
            lines.append(f"          {key}: {shown}")
        lines.append("          сыграть: do " + action_type + " " + " ".join(f"{key}=…" for key in keys))
    return lines


def render_turn_status(room: dict[str, Any], catalog: Catalog, player_id: str) -> str:
    """Everything an agent needs between two actions of the same turn, without redrawing the board."""
    game = room["game"]
    me = next(player for player in game["players"] if player["id"] == player_id)
    legal = room.get("legal_actions") or []
    breakdown = dict(game.get("score_breakdown", {}).get(player_id, {}))
    invest = f" +{game['investment_actions']}💼" if game["investment_actions"] else ""
    head = (
        f"действий {game['actions_left']}{invest} · {me['money']}$ {me['influence']}◆ "
        f"{me['scandals']}⚠ {me['roofs']}🛡 · очки {breakdown.get('total', 0)} · раунд "
        f"{game['round_number']}/{game['max_rounds']}"
    )
    if game["players"][int(game["current_player_index"])]["id"] != player_id:
        return f"{head}\nход перешёл дальше — `wait`, чтобы дождаться своей очереди"
    return "\n".join([head, f"— действия ({len(legal)}) —", *render_actions(legal, game, me, catalog)])


def _deltas(data: dict[str, Any], game: dict[str, Any]) -> str:
    raw = data.get("deltas")
    if not isinstance(raw, dict):
        return ""
    parts: list[str] = []
    for player_id, change in raw.items():
        if not isinstance(change, dict):
            continue
        bits = [
            f"{int(change[key]):+d}{glyph}"
            for key, glyph in (("money", "$"), ("influence", "◆"), ("scandals", "⚠"), ("roofs", "🛡"))
            if int(change.get(key, 0)) != 0
        ]
        if bits:
            parts.append(f"{player_name(game, player_id)} {' '.join(bits)}")
    return f" [{'; '.join(parts)}]" if parts else ""


_HIDDEN_EVENT_KEYS = {"deltas", "round_number", "incomes", "income_sources", "influence_sources"}


def describe_event(event: dict[str, Any], game: dict[str, Any], catalog: Catalog) -> str:
    data = dict(event.get("data") or {})
    kind = str(event["type"])
    head = f"#{event['seq']:>3} {kind}"
    actor = event.get("actor_id")
    if actor:
        head = f"{head} {player_name(game, actor)}"

    if kind == "round_settled":
        sources = data.get("income_sources") or {}
        incomes = data.get("incomes") or {}
        influence = data.get("influence_sources") or {}
        totals: list[str] = []
        for player_id in sources or incomes:
            breakdown = sources.get(player_id)
            paid = sum(int(value) for value in breakdown.values()) if breakdown else int(incomes.get(player_id, 0))
            parts = [f"{key} {int(value):+d}" for key, value in (breakdown or {}).items() if int(value) != 0]
            # Influence is settled here too and used to be invisible in the log.
            gained = sum(int(value) for value in (influence.get(player_id) or {}).values())
            if gained:
                parts.extend(
                    f"{key} {int(value):+d}◆" for key, value in influence[player_id].items() if int(value) != 0
                )
            suffix = f" ({', '.join(parts)})" if parts else ""
            totals.append(f"{player_name(game, player_id)} {paid:+d}$" + (f" {gained:+d}◆" if gained else "") + suffix)
        return f"{head} раунд {data.get('round_number')}: " + "; ".join(totals)
    if kind == "scandal_limit_reached":
        # The whole point of the event is that the player notices it, so it does not go through
        # the generic key=value tail.
        role_id = data.get("role_id")
        lost = f"роль {catalog.role_title(str(role_id))} потеряна" if role_id else "роли уже не было"
        jail = ", арест: следующий ход укорочен, скандалы сброшены до 3⚠, Крыша снята" if data.get("jailed") else ""
        return f"{head} набрал {data.get('limit')}⚠ — {lost}{jail}"
    if kind == "scandal_shield_spent":
        absorbed = data.get("absorbed", 1)
        return f"{head} погасил {absorbed}⚠ Щитом от скандала (щитов осталось {data.get('scandal_shields')})"
    if kind == "game_finished":
        scores = data.get("scores") or {}
        table = ", ".join(f"{player_name(game, key)} {value}" for key, value in scores.items())
        return f"{head} победитель {player_name(game, data.get('winner_id'))} · {table}"

    tail: list[str] = []
    for key, value in data.items():
        if key in _HIDDEN_EVENT_KEYS or value is None:
            continue
        if key == "asset_id" and value in catalog.assets:
            tail.append(f"«{catalog.asset_title(str(value))}»")
        elif key == "card_id":
            tail.append(f"«{catalog.card_title(str(value))}»")
        elif key == "role_id":
            tail.append(f"роль {catalog.role_title(str(value))}")
        elif key == "district":
            tail.append(catalog.district_title(str(value)))
        elif key in {"target_id", "previous_holder_id"}:
            tail.append(f"→ {player_name(game, value)}")
        elif key == "power":
            tail.append(POWER_LABELS.get(str(value), str(value)))
        else:
            tail.append(f"{key}={value}")
    return f"{head} " + " ".join(tail) + _deltas(data, game) if tail or _deltas(data, game) else head


def _player_line(player: dict[str, Any], game: dict[str, Any], catalog: Catalog, mine: bool) -> str:
    role = catalog.role_title(player["role"]) if player["role"] else "без роли"
    if player["copied_role"]:
        role = f"{role}+{catalog.role_title(player['copied_role'])}"
    hand = player.get("hand")
    hand_text = f"рука {len(hand)}" if hand is not None else f"карт {player.get('hand_count', 0)}"
    scores = game.get("final_scores") or {}
    points = scores.get(player["id"], score_of(game, player))
    current = game["players"][int(game["current_player_index"])]["id"] == player["id"]
    order = list(game.get("turn_order") or [])
    position = order.index(player["id"]) + 1 if player["id"] in order else 0
    flags = []
    if position:
        flags.append(f"{position}-й в раунде")
    if current:
        flags.append("ХОДИТ")
    if int(player["jail_turns"]) > 0:
        flags.append(f"тюрьма {player['jail_turns']}")
    if int(player["debt"]) > 0:
        flags.append(f"кредит -{player['debt']}$")
    if int(player["role_shields"]) > 0:
        flags.append("щит роли")
    if int(player["scandal_shields"]) > 0:
        flags.append("щит скандала")
    return (
        f"{'*' if mine else ' '} {player['name']:<12} {player['id']:<8} {points:>3}оч "
        f"{player['money']:>3}$ {player['influence']:>2}◆ {player['scandals']}⚠ {player['roofs']}🛡 "
        f"{role:<24} объектов {len(player['assets'])}/{player['capacity']} · {hand_text} · "
        f"проектов {len(player['projects'])}" + (f" · {', '.join(flags)}" if flags else "")
    )


def _owned_line(owned: dict[str, Any], me: dict[str, Any], game: dict[str, Any], catalog: Catalog) -> str:
    asset = catalog.assets.get(owned["card_id"], {})
    marks = []
    if me.get("automation_uid") == owned["uid"]:
        marks.append("⚙жетон отключён до выплаты" if me.get("automation_disabled") else "⚙жетон здесь")
    elif me.get("automation_owned"):
        # Moving is free, so the payoff of every option belongs on screen, not in the head.
        preview = game.get("automation_preview") or {}
        here, now = preview.get(owned["uid"]), preview.get(me.get("automation_uid"))
        if here is not None:
            delta = here - now if now is not None else here
            marks.append(f"перенос жетона: доход {here}$/раунд ({delta:+d})")
    if owned["blocked"]:
        marks.append("🔒заблокирован")
    return (
        f"    {owned['uid']:<28} {catalog.asset_title(owned['card_id']):<26} "
        f"{catalog.district_title(str(asset.get('district', ''))):<18} доход {asset.get('income', '?')}$ "
        f"[{','.join(asset.get('tags', [])) or '—'}] " + " ".join(marks)
    )


def _market_line(item: dict[str, Any], game: dict[str, Any], catalog: Catalog) -> str:
    asset = catalog.assets.get(item["card_id"], {})
    price = item.get("price", asset.get("cost", "?"))
    remaining = max(0, int(item["expires_at_round"]) - int(game.get("round_number", 0)))
    influence = int(asset.get("influence", 0))
    return (
        f"    {item['uid']:<28} {catalog.asset_title(item['card_id']):<26} "
        f"{catalog.district_title(str(asset.get('district', ''))):<18} {price}$ доход {asset.get('income', '?')}$"
        + f" [{','.join(asset.get('tags', [])) or '—'}]"
        + (f" +{influence}◆ разово" if influence else "")
        + f" {asset.get('rarity', '')} ⏳{remaining}р"
        # Conditions and bonuses are the whole point of the expensive cards; buying blind is worse
        # than the extra line width.
        + (f"\n{'':<38}└ {asset['text']}" if asset.get("text") else "")
    )


ROLE_POWERS = {
    "capitalist": ("capitalist_financing",),
    "politician": ("politician_tax", "politician_cleanup"),
    "journalist": ("journalist_inflate", "journalist_publish"),
    "mafia": ("mafia_racket", "mafia_sweep", "mafia_cleanup"),
    "military": ("military_sanction",),
    "fraudster": ("fraudster_cleanup", "fraudster_crypto_scam", "fraudster_forge"),
}


def _project_line(project_id: str, catalog: Catalog) -> str:
    project = catalog.projects.get(project_id, {})
    perk = ", ".join(f"{key} {value}" for key, value in (project.get("perk") or {}).items())
    return (
        f"    {project_id:<22} {catalog.project_title(project_id):<30} "
        f"{project.get('cost_influence', '?')}◆+{project.get('cost_money', '?')}$ → "
        f"{project.get('points', '?')} очков · условие: {catalog.project_requirement(project_id)}"
        + (f" · перк: {perk}" if perk else "")
    )


def _card_line(card_id: str, uid: str, catalog: Catalog) -> str:
    card = catalog.cards.get(card_id, {})
    target = "по цели" if card.get("targeted") else "на себя"
    return f"    {uid:<28} «{card.get('title', card_id)}» [{card.get('tone', '?')}, {target}] {card.get('text', '')}"


def _role_powers_line(me: dict[str, Any], game: dict[str, Any], legal: list[dict[str, Any]]) -> str:
    """List every power of the held role, marking the unavailable ones.

    The legal-action list only shows what is possible right now, so a power whose precondition
    fails simply vanished — one agent never learned its role could clean scandals at half price.
    """
    roles = [role for role in (me["role"], me["copied_role"]) if role]
    powers = [power for role in roles for power in ROLE_POWERS.get(role, ())]
    if not powers:
        return "способности роли: нет роли"
    available = {str(action["payload"].get("power")) for action in legal if action["type"] == "use_role_power"}
    flags = game.get("turn_flags") or {}
    marks = []
    for power in dict.fromkeys(powers):
        label = POWER_LABELS.get(power, power)
        if flags.get(f"used:{power}"):
            marks.append(f"{label} (использовано в этом ходу)")
        elif power in available:
            marks.append(f"{label} ✅")
        else:
            marks.append(f"{label} 🔒")
    return "способности роли: " + " · ".join(marks)


def render_state(
    room: dict[str, Any],
    catalog: Catalog,
    player_id: str,
    *,
    actions: bool = True,
    log_lines: int = 8,
) -> str:
    game = room.get("game")
    if not game:
        seats = ", ".join(
            f"{seat['index']}:{seat['kind']}" + (f"({seat['name']})" if seat.get("name") else "")
            for seat in room.get("seats", [])
        )
        return f"комната «{room['name']}» ({room['id']}) · {room['status']} · места: {seats}\nигра ещё не начата"

    me = next(player for player in game["players"] if player["id"] == player_id)
    event = catalog.events.get(str(game["event_id"]), {})
    current = game["players"][int(game["current_player_index"])]
    lines = [
        f"комната «{room['name']}» ({room['id']}) · rev {game['revision']} · {game['status']}",
        f"раунд {game['round_number']}/{game['max_rounds']} · событие «{event.get('title', game['event_id'])}»: "
        f"{event.get('text', '')}",
        f"ходит {current['name']}"
        + (
            f" — ЭТО Я · действий {game['actions_left']}"
            + (f" + {game['investment_actions']} инвестиционных" if game["investment_actions"] else "")
            if current["id"] == player_id
            else " (не я)"
        ),
        "— игроки —",
    ]
    lines.extend(_player_line(player, game, catalog, player["id"] == player_id) for player in game["players"])

    districts = ", ".join(
        f"{catalog.district_title(district)} {count}/4"
        + ("★" * int(me["district_levels"].get(district, 0)) if me["district_levels"].get(district) else "")
        for district in catalog.districts
        if (
            count := sum(
                1 for owned in me["assets"] if catalog.assets.get(owned["card_id"], {}).get("district") == district
            )
        )
        or me["district_levels"].get(district)
    )
    lines.append("— мой бизнес —")
    lines.extend(_owned_line(owned, me, game, catalog) for owned in me["assets"])
    lines.append(f"    районы: {districts or 'пусто'}")
    slot = CAPACITY_COSTS.get(int(me["capacity"]))
    reroll = catalog.scoring.get("market_reroll_cost", 4)
    automation = catalog.scoring.get("automation_cost", 6)
    project_reroll = catalog.scoring.get("project_reroll_money", 10)
    card_cost = catalog.scoring.get("action_card_cost", 3)
    token = (
        "жетон автоматизации: куплен"
        if me.get("automation_owned")
        else f"жетон автоматизации {automation}$ (один на партию, переносится бесплатно раз в ход)"
    )
    tiers = " / ".join(
        f"{int(row['spend'])}$→{int(row['gain'])}◆" for row in catalog.scoring.get("campaign_tiers") or []
    )
    lines.append(
        f"    цены сейчас: Крыша {roof_price(game, me)}$ · {token} · "
        f"две карты {card_cost}$+1◆ и действие · "
        f"реролл рынка {reroll}$ и доски проектов {project_reroll}$ — без действия, доски общие · "
        + (f"кампания {tiers} за одно действие · " if tiers else "")
        + (f"слот {int(me['capacity']) + 1} за {slot}$" if slot else "слоты максимум")
    )
    breakdown = dict(game.get("score_breakdown", {}).get(player_id, {}))
    if breakdown:
        per_money = catalog.scoring.get("money_per_point", 10)
        per_influence = catalog.scoring.get("influence_per_point", 3)
        lines.append(
            f"    мои очки {breakdown.get('total', 0)}: проекты {breakdown.get('projects', 0)} · "
            f"объекты {breakdown.get('assets', 0)} · роль {breakdown.get('role', 0)} · "
            f"деньги {breakdown.get('money', 0)} ({per_money}$=1) · "
            f"влияние {breakdown.get('influence', 0)} ({per_influence}◆=1) · "
            f"скандалы {breakdown.get('scandals', 0)}"
        )

    legal = room.get("legal_actions") or []
    lines.append(f"    {_role_powers_line(me, game, legal)}")

    # Unique and shared: whoever takes a project denies it to everybody else for the rest of the game.
    lines.append(f"— доска городских проектов (в колоде ещё {game.get('project_deck_count', 0)}) —")
    board = game.get("project_board", [])
    for index, project_id in enumerate(board):
        # Exactly one project rotates out each round, and it is always the longest-standing one.
        suffix = "  ⏳ уходит под низ колоды в конце раунда" if index == 0 else ""
        lines.append(_project_line(project_id, catalog) + suffix)
    repeatable = [pid for pid, row in catalog.projects.items() if row.get("repeatable")]
    if repeatable:
        lines.append("    всегда доступны (берутся сколько угодно раз):")
        lines.extend(_project_line(pid, catalog) for pid in repeatable)
    if me["projects"]:
        taken = ", ".join(catalog.project_title(project_id) for project_id in me["projects"])
        lines.append(f"    мои проекты: {taken}")

    lines.append(f"— рынок объектов ({len(game['market'])}) —")
    lines.extend(_market_line(item, game, catalog) for item in game["market"])
    lines.append(
        f"— карты действий: покупка 3$+1◆ и 1 действие, карта случайная, в колоде {game['action_deck_count']} —"
    )
    lines.append("    рука (розыгрыш бесплатный, одна карта за ход):")
    lines.extend(_card_line(held["card_id"], held["uid"], catalog) for held in me.get("hand", []))
    if not me.get("hand"):
        lines.append("    пусто")

    log = game.get("event_log", [])
    if log_lines > 0 and log:
        lines.append(f"— хроника (последние {min(log_lines, len(log))} из {len(log)}) —")
        lines.extend(f"  {describe_event(item, game, catalog)}" for item in log[-log_lines:])

    if actions:
        lines.append(f"— действия ({len(legal)}) —")
        lines.extend(render_actions(legal, game, me, catalog))
    return "\n".join(lines)


def resolve_action(legal: list[dict[str, Any]], selector: str, pairs: dict[str, Any]) -> dict[str, Any]:
    """Pick a legal action either by its printed index or by type plus payload filters."""
    if selector.isdigit():
        index = int(selector)
        if not 0 <= index < len(legal):
            raise KeyError(f"index {index} is out of range (0..{len(legal) - 1})")
        return legal[index]
    matches = [
        action
        for action in legal
        if action["type"] == selector
        and all(str(action["payload"].get(key)) == str(value) for key, value in pairs.items())
    ]
    if not matches:
        raise KeyError(f"no legal action matches {selector} {pairs}")
    if len(matches) > 1:
        details = "; ".join(str(action["payload"]) for action in matches[:6])
        raise KeyError(f"{len(matches)} actions match {selector}; narrow it down: {details}")
    return matches[0]
