import type {
  ActionMeta,
  AssetMeta,
  CityMeta,
  DomainEvent,
  GameState,
  LegalAction,
  MarketAsset,
  PlayerState,
  ProjectMeta,
  RoleMeta,
} from "./types";

export const rarityLabels: Record<string, string> = {
  common: "Обычный",
  uncommon: "Необычный",
  rare: "Редкий",
  epic: "Эпический",
  legendary: "Легендарный",
};

export const difficultyLabels: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Reborn",
};

export const powerLabels: Record<string, string> = {
  capitalist_financing: "Ускоренное финансирование",
  politician_tax: "Налог района",
  politician_cleanup: "Урегулировать скандал",
  journalist_inflate: "Раздуть историю",
  journalist_publish: "Опубликовать расследование",
  mafia_racket: "Рэкет",
  mafia_sweep: "Сжечь связи",
  mafia_cleanup: "Замять дело",
  military_sanction: "Санкции",
  fraudster_cleanup: "Снять скандал",
  fraudster_crypto_scam: "Криптоскам",
  fraudster_forge: "Подделать документы",
};

export const greyOperationLabels: Record<string, string> = {
  cash: "Отмывание",
  market: "Контрабанда",
  crypto: "Памп и дамп",
  datacenter: "Взлом",
};

const capacityCosts: Record<number, number> = { 3: 6, 4: 10, 5: 15 };

export function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function districtCount(player: PlayerState, district: string, assets: Map<string, AssetMeta>): number {
  return player.assets.filter(item => assets.get(item.card_id)?.district === district).length
    + Number(player.zoning_district === district);
}

// The engine ships the itemised score in `/state` (`score_breakdown`); it is never recomputed
// here. Money and influence convert at a rate now, and a second implementation of that would
// drift apart exactly like the market price did.
export function scoreOf(game: GameState, player: PlayerState): number {
  return game.final_scores?.[player.id] ?? game.score_breakdown?.[player.id]?.total ?? 0;
}

// Scoring rates come from the engine via `/meta`; the fallbacks only cover a stale cached meta.
export function moneyPerPoint(meta: CityMeta): number {
  return meta.scoring?.money_per_point ?? 10;
}

export function influencePerPoint(meta: CityMeta): number {
  return meta.scoring?.influence_per_point ?? 3;
}

export function marketRerollCost(meta: CityMeta): number {
  return meta.scoring?.market_reroll_cost ?? 2;
}

export function automationCost(meta: CityMeta): number {
  return meta.scoring?.automation_cost ?? 6;
}

/** Human-readable project condition, built from the structured requirement. */
export function projectRequirementText(project: ProjectMeta, meta: CityMeta): string {
  const requirement = project.requirement ?? { type: "none" };
  const count = requirement.count ?? 1;
  const districtTitle = (id?: string): string => meta.districts.find(item => item.id === id)?.title ?? id ?? "";
  switch (requirement.type) {
    case "none": return "без условия";
    case "assets": return `объектов не меньше ${count}`;
    case "automation": return "нужен жетон автоматизации";
    case "role": return "нужна любая роль";
    case "max_scandals": return `скандалов не больше ${count}`;
    case "district_objects": return `объектов в «${districtTitle(requirement.district)}» не меньше ${count}`;
    case "district_depth": return `не меньше ${count} объектов в одном районе`;
    case "distinct_districts": return `объекты в ${count} разных районах`;
    case "tag_objects": return `объектов с тегом «${requirement.tag}» не меньше ${count}`;
    default: return requirement.type;
  }
}

const perkLabels: Record<string, (value: number) => string> = {
  passiveMoney: value => `+${value}$ в каждый раунд`,
  passiveInfluence: value => `+${value}◆ в каждый раунд`,
  scandalReduction: value => `−${value} скандал в начале хода`,
  greyScandalReduction: value => `−${value} скандал от серых операций`,
  maintenanceReduction: value => `первые ${value} объектов без содержания`,
  turnRoof: () => "+1 Крыша в начале каждого хода",
  roofCapacity: value => `+${value} к пределу Крыш`,
  extraInvestmentActions: () => "+1 инвестиционное действие в начале хода",
  carryAction: () => "переносит 1 неистраченное действие",
  developmentDiscount: value => `−${value}$ к развитию района`,
};

export function projectPerkText(project: ProjectMeta): string {
  const entries = Object.entries(project.perk ?? {});
  if (entries.length === 0) return "без постоянного бонуса";
  return entries.map(([key, value]) => perkLabels[key]?.(value) ?? `${key} ${value}`).join(", ");
}

// Market prices arrive precomputed from the engine (`market.price`); `asset.cost` is only the
// fallback for a view rendered without a viewer. Never recompute discounts here.
export function marketPrice(asset: AssetMeta, item: MarketAsset): number {
  return item.price ?? asset.cost;
}

// Matches the engine `roof_price`: the cost grows with the round, and a forged mafia mandate
// pays the discounted price too, because the engine checks the copied role as well.
export function roofCost(player: PlayerState, game: GameState): number {
  const base = 3 + Math.floor((game.round_number - 1) / 2);
  return player.role === "mafia" || player.copied_role === "mafia" ? base - 1 : base;
}

export function capacityLabel(player: PlayerState): string {
  if (player.capacity >= 6) return "Максимум 6 слотов";
  return `Слот ${player.capacity + 1}: ${capacityCosts[player.capacity] ?? "?"}$`;
}

export function actionIdentity(action: LegalAction): string {
  return `${action.type}:${JSON.stringify(action.payload)}`;
}

interface LabelContext {
  game: GameState;
  player: PlayerState;
  assets: Map<string, AssetMeta>;
  cards: Map<string, ActionMeta>;
  roles: Map<string, RoleMeta>;
  districts: Map<string, { title: string }>;
  projects: Map<string, ProjectMeta>;
}

export function actionLabel(action: LegalAction, context: LabelContext): string {
  const { game, player, assets, cards, roles, districts, projects } = context;
  const payload = action.payload;
  const target = game.players.find(item => item.id === stringValue(payload.target_id));
  const district = districts.get(stringValue(payload.district));
  const role = roles.get(stringValue(payload.role_id));
  const project = projects.get(stringValue(payload.project_id));
  if (action.type === "basic_action") return payload.kind === "work" ? "Городской заказ: +2$" : "Кампания: 2$ → 2◆";
  if (action.type === "end_turn") return "Завершить ход";
  if (action.type === "reroll_market") return "Обновить рынок объектов (2$)";
  if (action.type === "city_project") {
    return project
      ? `«${project.title}» · ${project.cost_influence}◆+${project.cost_money}$ → ${project.points} очков`
      : "Городской проект";
  }
  if (action.type === "buy_capacity") return capacityLabel(player);
  if (action.type === "buy_roof") return `Купить Крышу (${roofCost(player, game)}$)`;
  if (action.type === "crisis_pr") return "Антикризисный PR: 4$ → −1⚠";
  if (action.type === "claim_role") return `${role?.icon ?? "🏷️"} ${role?.title ?? payload.role_id}`;
  if (action.type === "buy_asset") {
    const marketItem = game.market.find(item => item.uid === payload.market_uid);
    return `Купить «${assets.get(marketItem?.card_id ?? "")?.title ?? "объект"}»`;
  }
  if (action.type === "sell_asset") {
    const owned = player.assets.find(item => item.uid === payload.asset_uid);
    return `Продать «${assets.get(owned?.card_id ?? "")?.title ?? "объект"}»`;
  }
  if (action.type === "buy_automation" || action.type === "move_automation") {
    const owned = player.assets.find(item => item.uid === payload.asset_uid);
    const title = assets.get(owned?.card_id ?? "")?.title ?? "объект";
    const income = game.automation_preview?.[stringValue(payload.asset_uid)];
    const verb = action.type === "buy_automation" ? "Купить жетон автоматизации" : "Перенести жетон";
    return `${verb} → «${title}»${income !== undefined ? ` · доход ${income}$/раунд` : ""}`;
  }
  if (action.type === "replace_asset") {
    const owned = player.assets.find(item => item.uid === payload.asset_uid);
    const marketItem = game.market.find(item => item.uid === payload.market_uid);
    const incoming = assets.get(marketItem?.card_id ?? "");
    return `Заменить «${assets.get(owned?.card_id ?? "")?.title ?? "объект"}» на «${incoming?.title ?? "объект"}»`;
  }
  if (action.type === "develop_district") return `Развить район «${district?.title ?? payload.district}»`;
  if (action.type === "buy_action_card") return `Купить «${cards.get(stringValue(payload.card_id))?.title ?? payload.card_id}»`;
  if (action.type === "convert_action_card") return payload.into === "money" ? "Продать карту → +1$" : "Сбросить карту → +1◆";
  if (action.type === "play_action_card") {
    const held = player.hand?.find(item => item.uid === payload.card_uid);
    const title = cards.get(held?.card_id ?? "")?.title ?? "Карта";
    const detail = target ? ` → ${target.name}`
      : district ? ` · ${district.title}`
      : role ? ` · ${role.title}`
      : project ? ` · «${project.title}» (${project.cost_money}$ → ${project.points} очков)`
      : "";
    return `${title}${detail}`;
  }
  if (action.type === "grey_operation") {
    const protectedText = payload.protect_failure ? " · страховка Крышей" : "";
    return `${greyOperationLabels[stringValue(payload.asset_id)] ?? payload.asset_id}${target ? ` → ${target.name}` : ""}${protectedText}`;
  }
  if (action.type === "use_role_power") {
    const details = target ? ` → ${target.name}` : district ? ` · ${district.title}` : role ? ` · ${role.title}` : payload.amount ? ` · ${payload.amount}⚠` : payload.method ? ` · ${payload.method === "roof" ? "Крышей" : "деньгами"}` : "";
    return `${powerLabels[stringValue(payload.power)] ?? payload.power}${details}`;
  }
  return action.type;
}

const eventVerbs: Record<string, string> = {
  game_created: "Партия началась",
  turn_started: "начинает ход",
  turn_ended: "завершает ход",
  round_started: "Начался новый раунд",
  round_settled: "Город выплатил доходы",
  basic_action: "выполняет городское действие",
  city_project_taken: "забирает городской проект",
  project_board_rotated: "Доска проектов обновилась",
  turn_order_set: "Порядок хода определён",
  market_rerolled: "обновляет рынок объектов",
  role_takeover_blocked: "не смог перехватить роль",
  roof_bought: "покупает Крышу",
  crisis_pr: "проводит антикризисный PR",
  capacity_bought: "расширяет бизнес",
  asset_bought: "покупает объект",
  asset_sold: "продаёт объект",
  asset_replaced: "меняет объект",
  automation_bought: "покупает жетон автоматизации",
  automation_moved: "переносит жетон автоматизации",
  district_developed: "развивает район",
  role_claimed: "получает роль",
  role_taken: "захватывает роль",
  action_card_bought: "покупает карту действия",
  action_card_played: "разыгрывает карту",
  action_card_converted: "конвертирует карту",
  market_rotated: "Рынок объектов обновился",
  grey_operation: "проводит серую операцию",
  role_power_used: "использует способность роли",
  player_jailed: "арестован",
  game_finished: "Партия завершена",
};

// Colours assigned to players by seat order — must match Game.tsx rendering.
export const playerColors = ["#58a6ff", "#3fb950", "#f0883e", "#d65db1", "#e3b341", "#9b6ee7"];

export function playerColor(game: GameState, playerId: string | null | undefined): string {
  if (!playerId) return "var(--city-dim)";
  const index = game.players.findIndex(player => player.id === playerId);
  return index >= 0 ? playerColors[index % playerColors.length] : "var(--city-dim)";
}

// A log line is a list of segments so the UI can colour player names and numbers.
export type LogSegment =
  | { kind: "text"; text: string }
  | { kind: "player"; text: string; color: string }
  | { kind: "num"; text: string; tone: "good" | "bad" | "neutral" };

const txt = (text: string): LogSegment => ({ kind: "text", text });
const num = (text: string, tone: "good" | "bad" | "neutral" = "neutral"): LogSegment => ({ kind: "num", text, tone });

function playerSeg(game: GameState, playerId: string | null | undefined): LogSegment {
  const player = game.players.find(item => item.id === playerId);
  return { kind: "player", text: player?.name ?? "—", color: playerColor(game, playerId) };
}

function signed(value: number, glyph: string, positiveIsGood = true): LogSegment {
  const sign = value > 0 ? "+" : "−";
  const tone: "good" | "bad" | "neutral" = value === 0 ? "neutral" : (value > 0) === positiveIsGood ? "good" : "bad";
  return num(`${sign}${Math.abs(value)}${glyph}`, tone);
}

// Per-player resource deltas recorded by the engine ({money, influence, scandals, roofs}).
function deltaSegments(game: GameState, deltas: Record<string, unknown> | undefined): LogSegment[] {
  if (!deltas || typeof deltas !== "object") return [];
  const segments: LogSegment[] = [];
  const entries = Object.entries(deltas as Record<string, Record<string, unknown>>);
  entries.forEach(([playerId, change], index) => {
    const money = numberValue(change.money);
    const influence = numberValue(change.influence);
    const scandals = numberValue(change.scandals);
    const roofs = numberValue(change.roofs);
    if (!money && !influence && !scandals && !roofs) return;
    if (segments.length > 0 || index > 0) segments.push(txt("; "));
    segments.push(playerSeg(game, playerId), txt(" "));
    const parts: LogSegment[] = [];
    if (money) parts.push(signed(money, "$"));
    if (influence) parts.push(signed(influence, "◆"));
    if (scandals) parts.push(signed(scandals, "⚠", false));
    if (roofs) parts.push(signed(roofs, "🛡"));
    parts.forEach((part, i) => {
      if (i > 0) segments.push(txt(" "));
      segments.push(part);
    });
  });
  return segments.length > 0 ? [txt(" ["), ...segments, txt("]")] : [];
}

export function describeEventSegments(event: DomainEvent, game: GameState, meta: CityMeta): LogSegment[] {
  const data = event.data;
  const actorSeg = playerSeg(game, event.actor_id);
  const hasActor = !!event.actor_id;
  const assetId = stringValue(data.asset_id);
  const cardId = stringValue(data.card_id);
  const roleId = stringValue(data.role_id);
  const targetId = stringValue(data.target_id);
  const target = game.players.find(player => player.id === targetId);
  const owner = game.players.find(player => player.id === event.actor_id);
  const assetUid = stringValue(data.asset_uid);
  const ownedTitle = owner?.assets.find(item => item.uid === assetUid)?.card_id;
  const asset = meta.assets.find(item => item.id === (assetId || ownedTitle))?.title;
  const card = meta.action_cards.find(item => item.id === cardId)?.title;
  const role = meta.roles.find(item => item.id === roleId)?.title;
  const district = meta.districts.find(item => item.id === stringValue(data.district))?.title;
  const deltas = deltaSegments(game, data.deltas as Record<string, unknown> | undefined);
  const lead = (...tail: LogSegment[]): LogSegment[] => [actorSeg, ...tail];

  switch (event.type) {
    case "game_created":
      return [txt("🎬 Партия началась")];
    case "turn_started": {
      const actions = numberValue(data.actions);
      const invest = numberValue(data.investment_actions);
      return lead(
        txt(` начинает ход · раунд ${numberValue(data.round_number)} · `),
        num(`${actions}⚡`, "neutral"),
        ...(invest > 0 ? [txt(" +"), num(`${invest}💼`, "neutral")] : []),
      );
    }
    case "turn_ended":
      return lead(txt(" завершает ход"));
    case "round_started":
      return [txt(`▶️ Новый раунд ${numberValue(data.round_number)}`)];
    case "round_settled": {
      // `incomes` holds operations ± tribute only; the wallet also moves by the journalist payout
      // and the bridge-loan repayment. `income_sources` is the full breakdown, so sum that.
      const sources = (data.income_sources as Record<string, Record<string, unknown>>) ?? {};
      const incomes = (data.incomes as Record<string, unknown>) ?? {};
      const ids = Object.keys(sources).length > 0 ? Object.keys(sources) : Object.keys(incomes);
      const paid = (playerId: string): number => (sources[playerId]
        ? Object.values(sources[playerId]).reduce<number>((sum, value) => sum + numberValue(value), 0)
        : numberValue(incomes[playerId]));
      const influence = (data.influence_sources as Record<string, Record<string, unknown>>) ?? {};
      const gained = (playerId: string): number => (influence[playerId]
        ? Object.values(influence[playerId]).reduce<number>((sum, value) => sum + numberValue(value), 0)
        : 0);
      const segments: LogSegment[] = [txt(`💰 Выплаты за раунд ${numberValue(data.round_number)}: `)];
      ids.forEach((playerId, index) => {
        if (index > 0) segments.push(txt(", "));
        segments.push(playerSeg(game, playerId), txt(" "), signed(paid(playerId), "$"));
        // Passive influence used to be settled invisibly — only the wallet was reported.
        if (gained(playerId) !== 0) segments.push(txt(" "), signed(gained(playerId), "◆"));
      });
      return segments;
    }
    case "basic_action":
      return data.kind === "work"
        ? lead(txt(" берёт городской заказ ("), num("+2$", "good"), txt(`, стало ${numberValue(data.money)}$)`))
        : lead(txt(" проводит кампанию ("), num("2$→2◆", "good"), txt(`, стало ${numberValue(data.influence)}◆)`));
    case "city_project_taken": {
      const project = meta.projects.find(item => item.id === stringValue(data.project_id));
      return lead(
        txt(` забирает проект «${project?.title ?? stringValue(data.project_id)}» (`),
        signed(-numberValue(data.cost_influence), "◆"),
        txt(" "),
        signed(-numberValue(data.cost_money), "$"),
        txt(" → "),
        num(`+${numberValue(data.points)} очков`, "good"),
        txt(")"),
      );
    }
    case "project_board_rotated": {
      const project = meta.projects.find(item => item.id === stringValue(data.expired_project_id));
      const title = project?.title ?? stringValue(data.expired_project_id);
      // Rotation recycles: the card goes under the deck, it does not leave the game.
      const tail = txt(`🏗️ Проект «${title}» уходит под низ колоды`);
      return event.actor_id ? lead(txt(` обновляет доску проектов («${title}» под низ колоды)`)) : [tail];
    }
    case "turn_order_set": {
      const order = (data.order as string[]) ?? [];
      const segments: LogSegment[] = [txt("🔀 Порядок хода (отстающий первым): ")];
      order.forEach((playerId, index) => {
        if (index > 0) segments.push(txt(" → "));
        segments.push(playerSeg(game, playerId));
      });
      return segments;
    }
    case "market_rerolled":
      return lead(txt(" обновляет рынок объектов ("), signed(-numberValue(data.cost), "$"), txt(")"));
    case "capacity_bought":
      return lead(txt(` расширяет бизнес до ${numberValue(data.capacity)} слотов (`), signed(-numberValue(data.cost), "$"), txt(")"));
    case "roof_bought":
      return lead(txt(" покупает Крышу ("), signed(-numberValue(data.cost), "$"), txt(`, крыш: ${numberValue(data.roofs)})`));
    case "crisis_pr":
      return lead(txt(" антикризисный PR ("), signed(-numberValue(data.cost), "◆"), txt(", "), num("−1⚠", "good"), txt(`, осталось ${numberValue(data.scandals)}⚠)`));
    case "asset_bought":
      // Deltas expose the grey-tag scandal and the purchase bonuses, which have no events of their own.
      return lead(txt(` покупает «${asset ?? assetId}» за `), num(`${numberValue(data.cost)}$`, "bad"), ...deltas);
    case "asset_sold":
      return lead(txt(` продаёт «${asset ?? "объект"}» за `), num(`${numberValue(data.value)}$`, "good"));
    case "asset_replaced": {
      const sold = meta.assets.find(item => item.id === stringValue(data.sold_asset_id))?.title;
      return lead(
        txt(` меняет «${sold ?? "объект"}» на «${asset ?? assetId}» (`),
        num(`${numberValue(data.price)}$`, "bad"),
        txt(" − возврат "),
        num(`${numberValue(data.refund)}$`, "good"),
        txt(")"),
      );
    }
    case "automation_bought":
      return lead(txt(" покупает жетон автоматизации ("), signed(-numberValue(data.cost), "$"), txt(")"));
    case "automation_moved": {
      const owner = game.players.find(player => player.id === event.actor_id);
      const host = owner?.assets.find(item => item.uid === stringValue(data.asset_uid))?.card_id;
      const title = meta.assets.find(item => item.id === host)?.title;
      return lead(txt(` переносит жетон автоматизации на «${title ?? "объект"}»`));
    }
    case "district_developed":
      return lead(txt(` развивает район «${district ?? stringValue(data.district)}» до ${numberValue(data.level)}★ (`), signed(-numberValue(data.cost), "$"), txt(", "), num("+1◆", "good"), txt(")"));
    case "role_claimed":
    case "role_taken": {
      const tail: LogSegment[] = [txt(` получает роль «${role ?? roleId}» (`), signed(-numberValue(data.cost), "◆"), txt(")")];
      const prev = stringValue(data.previous_holder_id);
      if (prev) tail.push(txt(" — перехват у "), playerSeg(game, prev));
      return lead(...tail);
    }
    case "role_takeover_blocked":
      return lead(txt(` не смог захватить «${role ?? roleId}» — блок (${data.by === "roof" ? "Крыша" : "запрет"})`));
    case "action_card_bought":
      return lead(txt(` вытягивает карту «${card ?? cardId}» (`), signed(-numberValue(data.cost), "$"), txt(", −1◆)"));
    case "free_action_card_drawn":
      return lead(txt(` бесплатно получает карту «${card ?? cardId}»`));
    case "action_card_played": {
      const tail: LogSegment[] = [txt(` разыгрывает «${card ?? cardId}»`)];
      if (target) tail.push(txt(" против "), playerSeg(game, targetId));
      if (data.deferred) tail.push(txt(" (ждёт решения Крыши)"));
      return lead(...tail, ...deltas);
    }
    case "action_card_converted": {
      const value = numberValue(data.value) || 1;
      return lead(txt(` сбрасывает «${card ?? cardId}» → `), num(`+${value}${data.into === "money" ? "$" : "◆"}`, "good"));
    }
    case "targeted_card_resolved":
      return lead(txt(` эффект «${card ?? cardId}» на `), playerSeg(game, targetId), ...deltas);
    case "targeted_effect_blocked":
      return lead(txt(" отражает атаку Крышей"));
    case "asset_confiscated": {
      const resolutions: Record<string, string> = {
        seized: "объект переходит в его бизнес",
        swapped: "объект вытесняет слабейший в его бизнесе",
        cashed: "слоты заняты, объект обращён в деньги",
      };
      return lead(
        txt(` конфискует «${asset ?? assetId}» у `),
        playerSeg(game, stringValue(data.victim_id)),
        txt(` — ${resolutions[stringValue(data.resolution)] ?? "объект изъят"} (`),
        num(`${numberValue(data.value)} очков`, "neutral"),
        txt(")"),
      );
    }
    case "asset_state_changed": {
      const changes: Record<string, string> = {
        blocked: "заблокирован на раунд",
        automation_disabled: "жетон автоматизации не работает до выплаты раунда",
        blocked_and_automation_disabled: "заблокирован, жетон автоматизации не работает до выплаты",
      };
      const sourceCard = meta.action_cards.find(item => item.id === stringValue(data.source))?.title;
      const via = sourceCard ? ` (карта «${sourceCard}»)` : ` (${greyOperationLabels[stringValue(data.source)] ?? stringValue(data.source)})`;
      return lead(txt(`: «${asset ?? assetId}» ${changes[stringValue(data.change)] ?? stringValue(data.change)}${via}`));
    }
    case "antitrust_activated": {
      const affected = (data.affected_player_ids as string[]) ?? [];
      const tail: LogSegment[] = [txt(" вводит антимонопольное предписание: доход объектов в районах с 4+ объектами делится вдвое при расчёте раунда")];
      if (affected.length > 0) {
        tail.push(txt(" — под удар попадают "));
        affected.forEach((playerId, index) => {
          if (index > 0) tail.push(txt(", "));
          tail.push(playerSeg(game, playerId));
        });
      }
      return lead(...tail);
    }
    case "player_jailed":
      return lead(txt(" арестован: 6 скандалов, ход прерван, скандалы сброшены до "), num("3⚠", "neutral"));
    case "market_rotated":
      return [txt("🔄 Рынок объектов обновился")];
    case "grey_operation_resolved": {
      const chance = Math.round(numberValue(data.chance) * 100);
      const tail: LogSegment[] = [txt(` ${greyOperationLabels[assetId] ?? assetId}`)];
      if (target) tail.push(txt(" → "), playerSeg(game, targetId));
      tail.push(txt(": "), data.success ? num("успех", "good") : num("провал", "bad"), txt(` (${chance}%)`));
      return lead(...tail, ...deltas);
    }
    case "role_power_used": {
      const tail: LogSegment[] = [txt(` ${powerLabels[stringValue(data.power)] ?? stringValue(data.power)}`)];
      if (target) tail.push(txt(" → "), playerSeg(game, targetId));
      else if (district) tail.push(txt(` · ${district}`));
      return lead(...tail, ...deltas);
    }
    case "game_finished": {
      const scores = (data.scores as Record<string, unknown>) ?? {};
      const winnerId = stringValue(data.winner_id);
      return [txt("🏆 Партия завершена · победитель "), playerSeg(game, winnerId), txt(` (${numberValue(scores[winnerId])} очков)`)];
    }
    default: {
      const verb = eventVerbs[event.type] ?? event.type.split("_").join(" ");
      return hasActor ? lead(txt(` ${verb}`)) : [txt(verb)];
    }
  }
}

export function describeEvent(event: DomainEvent, game: GameState, meta: CityMeta): string {
  return describeEventSegments(event, game, meta)
    .map(segment => segment.text)
    .join("");
}

// A single bonus line for an object card. `active` → condition met for the owner right now
// (rendered green); `boosted` → value already doubled by automation.
export interface AssetEffectLine { text: string; active: boolean; boosted: boolean }

const roleDistrictMap: Record<string, string> = {
  capitalist: "business",
  politician: "residential",
  fraudster: "tech",
  mafia: "shadows",
  military: "industrial",
};

// Reverse lookup: which role gains the flat +1$ synergy from an object of a given district.
const districtRoleMap: Record<string, string> = Object.fromEntries(
  Object.entries(roleDistrictMap).map(([role, district]) => [district, role]),
);

/** Build the full, numeric breakdown of an object's bonuses for its card. */
export function assetEffectLines(
  asset: AssetMeta,
  owner: PlayerState,
  game: GameState,
  meta: CityMeta,
  assets: Map<string, AssetMeta>,
  options?: { automated?: boolean; includeSynergy?: boolean },
): AssetEffectLine[] {
  const automated = options?.automated ?? false;
  const includeSynergy = options?.includeSynergy ?? false;
  const effects = (asset.effects ?? {}) as Record<string, unknown>;
  const lines: AssetEffectLine[] = [];
  const districtTitle = (id: string): string => meta.districts.find(item => item.id === id)?.title ?? id;
  const roleTitle = (id: string): string => meta.roles.find(item => item.id === id)?.title ?? id;
  // Income and influence are paid out when the round is settled, after a forged mandate has
  // already expired (the engine clears copied_role when the turn ends), so only the main role
  // counts for these lines — unlike purchase discounts, which resolve during the turn.
  const hasRole = (role: string): boolean => owner.role === role;
  const hasLink = (district: string): boolean =>
    districtCount(owner, district, assets) > 0
    || (district === "business" && hasRole("capitalist"))
    || (district === "government" && hasRole("politician"));
  const doubled = (base: number): number => (automated ? base * 2 : base);

  // Generic district + role synergy (only for owned cards, where it is not shown elsewhere).
  // Never doubled by the token: automation multiplies the object's own printed effects only.
  if (includeSynergy) {
    const count = districtCount(owner, asset.district, assets);
    const synergy = count >= 4 ? 2 : count >= 2 ? 1 : 0;
    if (synergy > 0) {
      lines.push({ text: `+${synergy}$ синергия района «${districtTitle(asset.district)}» (${count}/4)`, active: true, boosted: false });
    }
    // The district's matching role always grants +1$ — shown for every object of that district,
    // active only while you actually hold the role (this is the "sector → role" bonus).
    const synergyRole = districtRoleMap[asset.district];
    if (synergyRole) {
      lines.push({ text: `+1$ пока вы «${roleTitle(synergyRole)}» (синергия сектора)`, active: hasRole(synergyRole), boosted: false });
    }
  }

  const eventBonus = effects.eventBonus as { eventId: string; value: number } | undefined;
  if (eventBonus) {
    const eventTitle = meta.events.find(item => item.id === eventBonus.eventId)?.title ?? eventBonus.eventId;
    lines.push({ text: `+${doubled(eventBonus.value)}$/раунд во время события «${eventTitle}»`, active: game.event_id === eventBonus.eventId, boosted: automated });
  }

  const influenceBonus = effects.influenceBonus as { value: number; district?: string; role?: string } | undefined;
  if (influenceBonus) {
    const roleOk = !influenceBonus.role || hasRole(influenceBonus.role);
    const districtOk = !influenceBonus.district || hasLink(influenceBonus.district);
    const cond = [
      influenceBonus.district ? `объект «${districtTitle(influenceBonus.district)}»` : "",
      influenceBonus.role ? `роль «${roleTitle(influenceBonus.role)}»` : "",
    ].filter(Boolean).join(" и ");
    lines.push({ text: `+${doubled(influenceBonus.value)}◆/раунд${cond ? ` при наличии ${cond}` : ""}`, active: roleOk && districtOk, boosted: automated });
  }

  const districtBonus = effects.districtBonus as
    | { district: string; value: number; perObject?: boolean; excludeSelf?: boolean; virtualRole?: string }
    | undefined;
  if (districtBonus) {
    if (districtBonus.perObject) {
      const adjust = districtBonus.excludeSelf && asset.district === districtBonus.district ? 1 : 0;
      const virtual = districtBonus.virtualRole && hasRole(districtBonus.virtualRole) ? 1 : 0;
      const count = Math.max(0, districtCount(owner, districtBonus.district, assets) - adjust + virtual);
      const per = doubled(districtBonus.value);
      lines.push({ text: `+${per}$ за каждый объект «${districtTitle(districtBonus.district)}» · сейчас ${count} → +${per * count}$`, active: count > 0, boosted: automated });
    } else {
      lines.push({ text: `+${doubled(districtBonus.value)}$ при наличии объекта «${districtTitle(districtBonus.district)}»`, active: hasLink(districtBonus.district), boosted: automated });
    }
  }

  const roleBonus = effects.roleBonus as { role: string; value: number } | undefined;
  if (roleBonus) {
    lines.push({ text: `+${doubled(roleBonus.value)}$ пока вы «${roleTitle(roleBonus.role)}»`, active: hasRole(roleBonus.role), boosted: automated });
  }
  for (const bonus of (effects.roleBonuses as { role: string; value: number }[] | undefined) ?? []) {
    lines.push({ text: `+${doubled(bonus.value)}$ пока вы «${roleTitle(bonus.role)}»`, active: hasRole(bonus.role), boosted: automated });
  }
  for (const link of (effects.districtLinks as { district: string; value: number }[] | undefined) ?? []) {
    lines.push({ text: `+${doubled(link.value)}$ при наличии «${districtTitle(link.district)}»`, active: hasLink(link.district), boosted: automated });
  }

  const passive: [string, string][] = [];
  const maintenance = numberValue(effects.maintenanceReduction);
  if (maintenance) passive.push([`Первые ${maintenance} объектов не требуют содержания`, "true"]);
  if (numberValue(effects.extraActions)) passive.push([`+1 обычное действие в начале хода`, "true"]);
  if (numberValue(effects.extraInvestmentActions)) passive.push([`+1 инвестиционное действие в начале хода`, "true"]);
  if (numberValue(effects.turnRoof)) passive.push([`+1 Крыша в начале каждого хода`, "true"]);
  if (numberValue(effects.roofCapacity)) passive.push([`+${numberValue(effects.roofCapacity)} к пределу Крыш`, "true"]);
  if (numberValue(effects.scandalReduction)) passive.push([`−${numberValue(effects.scandalReduction)} скандал в начале хода`, "true"]);
  if (numberValue(effects.greyScandalReduction)) passive.push([`−${numberValue(effects.greyScandalReduction)} скандала от серых операций`, "true"]);
  if (numberValue(effects.carryAction)) passive.push([`Переносит 1 неистраченное действие на следующий ход`, "true"]);
  if (numberValue(effects.takeoverCompensation)) passive.push([`+${numberValue(effects.takeoverCompensation)}◆, если у вас перехватят роль`, "true"]);
  if (numberValue(effects.developmentDiscount)) passive.push([`−${numberValue(effects.developmentDiscount)}$ к стоимости развития района`, "true"]);
  for (const [text] of passive) lines.push({ text, active: true, boosted: false });

  const purchase = effects.purchase as
    | { money?: number; influence?: number; roofs?: number; card?: boolean; scandals?: number }
    | undefined;
  if (purchase) {
    const parts: string[] = [];
    if (purchase.money) parts.push(`${purchase.money > 0 ? "+" : "−"}${Math.abs(purchase.money)}$`);
    if (purchase.influence) parts.push(`+${purchase.influence}◆`);
    if (purchase.roofs) parts.push(`+${purchase.roofs} Крыша`);
    if (purchase.card) parts.push(`карта действия`);
    if (purchase.scandals) parts.push(`+${purchase.scandals} скандал`);
    if (parts.length) lines.push({ text: `При покупке: ${parts.join(", ")}`, active: false, boosted: false });
  }

  return lines;
}

export function activeBonuses(player: PlayerState, game: GameState, meta: CityMeta, assets: Map<string, AssetMeta>): { text: string; active: boolean }[] {
  const role = meta.roles.find(item => item.id === player.role);
  const result: { text: string; active: boolean }[] = [
    role
      ? { text: `Роль «${role.title}»: ${role.passive}`, active: true }
      : { text: "Роль отсутствует.", active: false },
  ];
  for (const district of meta.districts) {
    const count = districtCount(player, district.id, assets);
    const level = player.district_levels[district.id] ?? 0;
    if (count >= 2) result.push({ text: `${district.title}: ${count}/4 объекта, районная синергия активна.`, active: true });
    if (level > 0) result.push({ text: `${district.title}: развитие ${"★".repeat(level)}${"☆".repeat(2 - level)}, +${level * 25}% к базовому доходу ваших объектов района (округление вверх).`, active: true });
  }
  // The antitrust card has no marker of its own; without this line a halved income is unexplainable.
  if (game.antitrust_active) {
    const exposed = meta.districts.filter(district => districtCount(player, district.id, assets) >= 4);
    result.push({
      text: exposed.length > 0
        ? `Антимонопольное предписание: в этом раунде доход объектов района «${exposed.map(item => item.title).join("», «")}» будет уменьшен вдвое.`
        : "Антимонопольное предписание действует, но у вас нет района с 4 объектами — вас оно не затронет.",
      active: exposed.length === 0,
    });
  }
  if (player.debt > 0) result.push({ text: `Мостовой кредит: −${player.debt}$ при ближайшей выплате.`, active: false });
  if (player.role_shields > 0) result.push({ text: `Судебный запрет защитит роль: ${player.role_shields}.`, active: true });
  if (player.scandal_shields > 0) result.push({ text: `Репутационный резерв отменит следующее получение скандалов.`, active: true });
  if (player.copied_role) result.push({ text: `Временный мандат: ${meta.roles.find(item => item.id === player.copied_role)?.title ?? player.copied_role}.`, active: true });
  // A finished project can neither be blocked nor confiscated, so its perk is always on.
  for (const projectId of player.projects) {
    const project = meta.projects.find(item => item.id === projectId);
    if (project) result.push({ text: `Проект «${project.title}»: ${project.points} очков, ${projectPerkText(project)}.`, active: true });
  }
  result.push({ text: `Содержание бизнеса: −${Math.max(0, player.assets.length - maintenanceReduction(player, meta, assets))}$ в конце раунда.`, active: false });
  return result;
}

function maintenanceReduction(player: PlayerState, meta: CityMeta, assets: Map<string, AssetMeta>): number {
  const fromAssets = player.assets.reduce((sum, item) => {
    if (item.blocked) return sum;
    const value = assets.get(item.card_id)?.effects?.maintenanceReduction;
    return sum + numberValue(value);
  }, 0);
  const fromProjects = player.projects.reduce((sum, projectId) => {
    const perk = meta.projects.find(item => item.id === projectId)?.perk ?? {};
    return sum + numberValue(perk.maintenanceReduction);
  }, 0);
  return fromAssets + fromProjects;
}
