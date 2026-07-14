import type {
  ActionMeta,
  AssetMeta,
  CityMeta,
  DomainEvent,
  GameState,
  LegalAction,
  PlayerState,
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

export function scoreOf(player: PlayerState, assets: Map<string, AssetMeta>): number {
  const assetScore = player.assets.reduce((sum, item) => {
    const cost = assets.get(item.card_id)?.cost ?? 0;
    return sum + Math.floor(cost / 2) + Number(item.automated) * 2 + Number(item.scaled) * 2;
  }, 0);
  return player.money + player.influence + assetScore + player.projects * 6 + (player.role ? 3 : 0) - player.scandals;
}

export function marketPrice(game: GameState, player: PlayerState, asset: AssetMeta, meta: CityMeta): number {
  const event = meta.events.find(item => item.id === game.event_id);
  let discount = event?.globalMarketDiscount ?? 0;
  if (event?.district === asset.district) discount += event.marketDiscount ?? 0;
  if ((player.role === "capitalist" || player.copied_role === "capitalist") && districtCount(player, asset.district, new Map(meta.assets.map(item => [item.id, item]))) === 0) discount += 1;
  if (asset.district === "industrial" && player.assets.some(item => item.card_id === "logistics")) discount += 1;
  discount += numberValue(game.turn_flags.market_discount);
  return Math.max(1, asset.cost - discount);
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
}

export function actionLabel(action: LegalAction, context: LabelContext): string {
  const { game, player, assets, cards, roles, districts } = context;
  const payload = action.payload;
  const target = game.players.find(item => item.id === stringValue(payload.target_id));
  const district = districts.get(stringValue(payload.district));
  const role = roles.get(stringValue(payload.role_id));
  if (action.type === "basic_action") return payload.kind === "work" ? "Городской заказ: +2$" : "Кампания: 2$ → 2◆";
  if (action.type === "end_turn") return "Завершить ход";
  if (action.type === "city_project") return "Городской проект: 3◆ → 6 очков";
  if (action.type === "buy_capacity") return capacityLabel(player);
  if (action.type === "buy_roof") return `Купить Крышу (${player.role === "mafia" ? 2 : 3}$)`;
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
  if (action.type === "improve_asset") {
    const owned = player.assets.find(item => item.uid === payload.asset_uid);
    const verb = payload.kind === "automate" ? "Автоматизировать" : "Модернизировать";
    return `${verb} «${assets.get(owned?.card_id ?? "")?.title ?? "объект"}»`;
  }
  if (action.type === "develop_district") return `Развить район «${district?.title ?? payload.district}»`;
  if (action.type === "buy_action_card") return `Купить «${cards.get(stringValue(payload.card_id))?.title ?? payload.card_id}»`;
  if (action.type === "convert_action_card") return payload.into === "money" ? "Продать карту → +1$" : "Сбросить карту → +1◆";
  if (action.type === "play_action_card") {
    const held = player.hand?.find(item => item.uid === payload.card_uid);
    const title = cards.get(held?.card_id ?? "")?.title ?? "Карта";
    return `${title}${target ? ` → ${target.name}` : district ? ` · ${district.title}` : role ? ` · ${role.title}` : ""}`;
  }
  if (action.type === "grey_operation") {
    const protectedText = payload.protect_failure ? " · страховка Крышей" : "";
    return `${greyOperationLabels[stringValue(payload.asset_id)] ?? payload.asset_id}${target ? ` → ${target.name}` : ""}${protectedText}`;
  }
  if (action.type === "use_role_power") {
    const details = target ? ` → ${target.name}` : district ? ` · ${district.title}` : role ? ` · ${role.title}` : payload.amount ? ` · ${payload.amount}⚠` : payload.method ? ` · ${payload.method === "roof" ? "Крышей" : "деньгами"}` : "";
    return `${powerLabels[stringValue(payload.power)] ?? payload.power}${details}`;
  }
  if (action.type === "resolve_decision") return payload.option === "use_roof" ? "Потратить Крышу и отменить эффект" : "Принять эффект";
  return action.type;
}

const eventVerbs: Record<string, string> = {
  game_created: "Партия началась",
  turn_started: "начинает ход",
  turn_ended: "завершает ход",
  round_started: "Начался новый раунд",
  round_settled: "Город выплатил доходы",
  basic_action: "выполняет городское действие",
  city_project: "запускает городской проект",
  roof_bought: "покупает Крышу",
  crisis_pr: "проводит антикризисный PR",
  capacity_bought: "расширяет бизнес",
  asset_bought: "покупает объект",
  asset_sold: "продаёт объект",
  asset_improved: "улучшает объект",
  district_developed: "развивает район",
  role_claimed: "получает роль",
  role_taken: "захватывает роль",
  action_card_bought: "покупает карту действия",
  action_card_played: "разыгрывает карту",
  action_card_converted: "конвертирует карту",
  action_market_rotated: "Рынок карт обновился",
  market_rotated: "Рынок объектов обновился",
  grey_operation: "проводит серую операцию",
  role_power_used: "использует способность роли",
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
      const incomes = (data.incomes as Record<string, unknown>) ?? {};
      const segments: LogSegment[] = [txt(`💰 Выплаты за раунд ${numberValue(data.round_number)}: `)];
      const entries = Object.entries(incomes);
      entries.forEach(([playerId, value], index) => {
        if (index > 0) segments.push(txt(", "));
        segments.push(playerSeg(game, playerId), txt(" "), signed(numberValue(value), "$"));
      });
      return segments;
    }
    case "basic_action":
      return data.kind === "work"
        ? lead(txt(" берёт городской заказ ("), num("+2$", "good"), txt(`, стало ${numberValue(data.money)}$)`))
        : lead(txt(" проводит кампанию ("), num("2$→2◆", "good"), txt(`, стало ${numberValue(data.influence)}◆)`));
    case "city_project_created":
      return lead(txt(" запускает городской проект ("), num("3◆ → +6 очков", "good"), txt(`, проектов: ${numberValue(data.projects)})`));
    case "capacity_bought":
      return lead(txt(` расширяет бизнес до ${numberValue(data.capacity)} слотов (`), signed(-numberValue(data.cost), "$"), txt(")"));
    case "roof_bought":
      return lead(txt(" покупает Крышу ("), signed(-numberValue(data.cost), "$"), txt(`, крыш: ${numberValue(data.roofs)})`));
    case "crisis_pr":
      return lead(txt(" антикризисный PR ("), num("−4$", "bad"), txt(", "), num("−1⚠", "good"), txt(`, осталось ${numberValue(data.scandals)}⚠)`));
    case "asset_bought":
      return lead(txt(` покупает «${asset ?? assetId}» за `), num(`${numberValue(data.cost)}$`, "bad"));
    case "asset_sold":
      return lead(txt(` продаёт «${asset ?? "объект"}» за `), num(`${numberValue(data.value)}$`, "good"));
    case "asset_improved":
      return lead(txt(` ${data.kind === "automate" ? "автоматизирует" : "модернизирует"} «${asset ?? "объект"}» (`), signed(-numberValue(data.cost), "$"), txt(")"));
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
      return lead(txt(` покупает карту «${card ?? cardId}»`));
    case "free_action_card_drawn":
      return lead(txt(` бесплатно получает карту «${card ?? cardId}»`));
    case "action_card_played": {
      const tail: LogSegment[] = [txt(` разыгрывает «${card ?? cardId}»`)];
      if (target) tail.push(txt(" против "), playerSeg(game, targetId));
      if (data.deferred) tail.push(txt(" (ждёт решения Крыши)"));
      return lead(...tail, ...deltas);
    }
    case "action_card_converted":
      return lead(txt(` конвертирует «${card ?? cardId}» → `), num(data.into === "money" ? "+1$" : "+1◆", "good"));
    case "targeted_card_resolved":
      return lead(txt(` эффект «${card ?? cardId}» на `), playerSeg(game, targetId), ...deltas);
    case "targeted_effect_blocked":
      return lead(txt(" отражает атаку Крышей"));
    case "market_rotated":
      return [txt("🔄 Рынок объектов обновился")];
    case "action_market_rotated":
      return [txt("🔄 Рынок карт обновился")];
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
  const hasRole = (role: string): boolean => owner.role === role || owner.copied_role === role;
  const hasLink = (district: string): boolean =>
    districtCount(owner, district, assets) > 0
    || (district === "business" && hasRole("capitalist"))
    || (district === "government" && hasRole("politician"));
  const doubled = (base: number): number => (automated ? base * 2 : base);

  // Generic district + role synergy (only for owned cards, where it is not shown elsewhere).
  if (includeSynergy) {
    const count = districtCount(owner, asset.district, assets);
    const synergy = count >= 4 ? 2 : count >= 2 ? 1 : 0;
    if (synergy > 0) {
      lines.push({ text: `+${doubled(synergy)}$ синергия района «${districtTitle(asset.district)}» (${count}/4)`, active: true, boosted: automated });
    }
    // The district's matching role always grants +1$ — shown for every object of that district,
    // active only while you actually hold the role (this is the "sector → role" bonus).
    const synergyRole = districtRoleMap[asset.district];
    if (synergyRole) {
      lines.push({ text: `+${doubled(1)}$ пока вы «${roleTitle(synergyRole)}» (синергия сектора)`, active: hasRole(synergyRole), boosted: automated });
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
  const event = meta.events.find(item => item.id === game.event_id);
  const result: { text: string; active: boolean }[] = [
    role
      ? { text: `Роль «${role.title}»: ${role.passive}`, active: true }
      : { text: "Роль отсутствует.", active: false },
    { text: event ? `Событие «${event.title}»: ${event.text}` : "Город работает в обычном режиме.", active: true },
  ];
  for (const district of meta.districts) {
    const count = districtCount(player, district.id, assets);
    const level = player.district_levels[district.id] ?? 0;
    if (count >= 2) result.push({ text: `${district.title}: ${count}/4 объекта, районная синергия активна.`, active: true });
    if (level > 0) result.push({ text: `${district.title}: развитие ${"★".repeat(level)}${"☆".repeat(2 - level)}, +${level * 25}% к базовому доходу.`, active: true });
  }
  if (player.debt > 0) result.push({ text: `Мостовой кредит: −${player.debt}$ при ближайшей выплате.`, active: false });
  if (player.role_shields > 0) result.push({ text: `Судебный запрет защитит роль: ${player.role_shields}.`, active: true });
  if (player.scandal_shields > 0) result.push({ text: `Репутационный резерв отменит следующее получение скандалов.`, active: true });
  if (player.copied_role) result.push({ text: `Временный мандат: ${meta.roles.find(item => item.id === player.copied_role)?.title ?? player.copied_role}.`, active: true });
  result.push({ text: `Содержание бизнеса: −${Math.max(0, player.assets.length - maintenanceReduction(player, assets))}$ в конце раунда.`, active: false });
  return result;
}

function maintenanceReduction(player: PlayerState, assets: Map<string, AssetMeta>): number {
  return player.assets.reduce((sum, item) => {
    if (item.blocked) return sum;
    const value = assets.get(item.card_id)?.effects?.maintenanceReduction;
    return sum + numberValue(value);
  }, 0);
}
