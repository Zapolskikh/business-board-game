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
  RoomView,
} from "./types";
import { chatText } from "./botTalk";
import { tr } from "../i18n";

/* Все подписи — из locales/<язык>/game.json. Таблицы ниже — объекты с геттерами: их можно
 * перебирать (Object.entries) и читать по ключу, а значение всегда на текущем языке. */
const tg = (key: string, options?: Record<string, unknown>): string => tr("game", key, options);

function labelTable<K extends string>(prefix: string, keys: readonly K[]): Record<string, string> {
  const table: Record<string, string> = {};
  for (const key of keys) {
    Object.defineProperty(table, key, { enumerable: true, get: () => tg(`${prefix}.${key}`) });
  }
  return table;
}

export const rarityLabels = labelTable("rarity", ["common", "uncommon", "rare", "epic", "legendary"]);

export const difficultyLabels: Record<string, string> = {};
for (const key of ["expert"]) {
  Object.defineProperty(difficultyLabels, key, { enumerable: true, get: () => tr("common", `difficulty.${key}`) });
}

const POWER_IDS = [
  "politician_cleanup",
  "journalist_inflate",
  "journalist_publish",
  "mafia_racket",
  "mafia_cleanup",
  "military_sanction",
  "military_inspection",
  "military_roof_seize",
  "fraudster_cleanup",
  "fraudster_crypto_scam",
  "capitalist_claim",
  "mafia_lock",
  "politician_veto",
] as const;

export const powerLabels: Record<string, string> = {};
for (const key of POWER_IDS) {
  Object.defineProperty(powerLabels, key, { enumerable: true, get: () => tg(`power.${key}.label`) });
}

/* Что делает каждая активная способность и во что обходится.
 *
 * Одного названия и «сейчас недоступна» в панели не хватает: игрок не узнаёт ни что кнопка
 * делает, ни почему она серая, ни чего ему не хватает. Текст здесь — описание, а не правило:
 * все числа, по которым способность разрешается, приходят из движка в `game.role_powers`.
 */
export const powerDescriptions: Record<string, { what: string; cost: string }> = {};
for (const key of POWER_IDS) {
  Object.defineProperty(powerDescriptions, key, {
    enumerable: true,
    get: () => ({ what: tg(`power.${key}.what`), cost: tg(`power.${key}.cost`) }),
  });
}

/* Чего не хватает. Ключи приходят из движка вместе с have/needed — клиент только подписывает. */
export function powerGateText(
  gate: { key: string; have: number; needed: number; district?: string; asset_id?: string },
  meta: CityMeta,
): string {
  const district = meta.districts.find(item => item.id === gate.district)?.title ?? gate.district;
  const asset = meta.assets.find(item => item.id === gate.asset_id)?.title ?? gate.asset_id;
  const known = [
    "action", "once_per_turn", "influence", "money", "own_scandal", "scandal_room", "roof", "roof_room",
    "district", "own_asset", "market_slot", "project_slot", "rival", "dirty_rival", "grey_rival", "roofed_rival",
  ];
  const values = { have: gate.have, needed: gate.needed, district, asset, key: gate.key };
  return tg(`gate.${known.includes(gate.key) ? gate.key : "other"}`, values);
}

const GREY_IDS = ["smear", "crypto", "roof_break", "datacenter", "influence_broker"] as const;

export const greyOperationLabels: Record<string, string> = {};
for (const key of GREY_IDS) {
  Object.defineProperty(greyOperationLabels, key, { enumerable: true, get: () => tg(`grey.${key}.label`) });
}

// Mirrors `CityEngine.GREY_OPERATION_DISTRICTS`: an operation is unlocked by any active object of
// these districts (all of them for `greyOperationNeedsAll`), not by one card out of 71. Kept next to the labels because the object cards have
// to say the same thing the operation panel says — a requirement announced only by the panel is a
// requirement you learn after spending your money on something else.
export const greyOperationDistricts: Record<string, string[]> = {
  smear: ["shadows"],
  crypto: ["tech", "shadows"],
  roof_break: ["shadows"],
  datacenter: ["tech", "shadows"],
  influence_broker: ["shadows", "government"],
};

// Mirrors `CityEngine.GREY_OPERATION_NEEDS_ALL`: these need an object in every listed district,
// the rest in any one of them.
export const greyOperationNeedsAll = new Set(["influence_broker"]);

// What one face of a grey operation does, in words, from the numbers the engine computed for it.
export function greyEffectText(operationId: string, effect: Record<string, number | boolean>, tier: string): string {
  if (tier === "fail") return tg("ui.grey.effect.none");
  const value = (key: string) => Number(effect[key] ?? 0);
  switch (operationId) {
    case "smear":
      return value("influence_per_hit")
        ? tg("ui.grey.effect.smearPaid", { influence: value("influence_per_hit") })
        : tg("ui.grey.effect.smear");
    case "crypto":
      return tg("ui.grey.effect.crypto", { money: value("money_each") });
    case "datacenter":
      return tg("ui.grey.effect.datacenter", { influence: value("influence") });
    case "influence_broker":
      return effect.strip_role
        ? tg("ui.grey.effect.leakStrip", { influence: value("influence") })
        : tg("ui.grey.effect.leakScandal", { scandals: value("target_scandals"), influence: value("influence") });
    case "roof_break":
      return value("influence_per_roof")
        ? tg("ui.grey.effect.roofBreakPaid", { influence: value("influence_per_roof") })
        : tg("ui.grey.effect.roofBreak");
    default:
      return "";
  }
}

const capacityCosts: Record<number, number> = { 3: 7, 4: 12, 5: 18 };
const capacityInfluence: Record<number, number> = { 3: 0, 4: 1, 5: 3 };

/** The next slot's price — money and the influence the fifth and sixth slots add. From /meta. */
export function slotPrice(meta: CityMeta, capacity: number): { money: number | undefined; influence: number } {
  const key = String(capacity);
  return {
    money: meta.scoring?.capacity_costs?.[key] ?? capacityCosts[capacity],
    influence: meta.scoring?.capacity_influence?.[key] ?? capacityInfluence[capacity] ?? 0,
  };
}

// Points an object adds to the final score, and what selling it refunds in money — one number for
// both, because the engine uses one rule (`content.asset_points`). The fallback keeps an older
// `/meta` payload rendering instead of printing zeroes everywhere.
export function assetPoints(asset: AssetMeta): number {
  return asset.points ?? Math.floor(asset.cost / 2);
}

export function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

/* Присутствие игрока в районе — ровно то, что считает движок (`district_count`): построенные
 * объекты и карта рынка, помеченная Капиталистом. Плюс «Агломерация»: объект с `districtDouble`
 * считает каждый ваш объект своего района за два — умножается только построенное, метка не
 * удваивается. (Аренда района «Зонированием» и «Договоримся» убрана в правилах 1.20.0.)
 *
 * Считать здесь меньше, чем считает движок, нельзя: карточка напечатает «2/4» там, где движок
 * видит 4/4, и синергия будет выглядеть невключённой ровно тогда, когда она платит. */
export function districtCount(player: PlayerState, district: string, assets: Map<string, AssetMeta>): number {
  const owned = player.assets.filter(item => assets.get(item.card_id)?.district === district).length;
  const doubles = player.assets.filter(
    item => assets.get(item.card_id)?.effects?.districtDouble === district,
  ).length;
  const marked = player.marked_card_id ? assets.get(player.marked_card_id)?.district === district : false;
  return owned * (1 + doubles) + Number(marked);
}

// The engine ships the itemised score in `/state` (`score_breakdown`); it is never recomputed
// here. Money and influence convert at a rate now, and a second implementation of that would
// drift apart exactly like the market price did.
export function scoreOf(game: GameState, player: PlayerState): number {
  return game.final_scores?.[player.id] ?? game.score_breakdown?.[player.id]?.total ?? 0;
}

/** Места за столом, как их считает движок: при равных очках выше тот, у кого больше проектов. */
export function rankPlayers(game: GameState): PlayerState[] {
  return [...game.players].sort(
    (a, b) => scoreOf(game, b) - scoreOf(game, a) || b.projects.length - a.projects.length,
  );
}

// Scoring rates come from the engine via `/meta`; the fallbacks only cover a stale cached meta.
// Money and influence score nothing by themselves: the two sinks are the only way to bank them,
// for one action and once a turn each.
export function lobbying(meta: CityMeta): { influence: number; points: number } {
  return { influence: meta.scoring?.lobbying_influence ?? 3, points: meta.scoring?.lobbying_points ?? 2 };
}

export function projectRerollMoney(meta: CityMeta): number {
  return meta.scoring?.project_reroll_money ?? 10;
}

export function marketRotationSize(meta: CityMeta): number {
  return meta.scoring?.market_rotation_size ?? 3;
}

export function campaignTiers(meta: CityMeta): { spend: number; gain: number }[] {
  return meta.scoring?.campaign_tiers ?? [{ spend: 5, gain: 3 }];
}

/** The tier of a campaign action, resolved from the payload the engine offered. */
function campaignTier(meta: CityMeta, spend: unknown): { spend: number; gain: number } | undefined {
  const wanted = numberValue(spend);
  return campaignTiers(meta).find(tier => tier.spend === wanted);
}

// The floor of the money economy: cash into points, no slot and no card needed. See
// `PATRONAGE_MONEY` in the engine for the 1217$ of dead capital that put it there.
export function patronage(meta: CityMeta): { money: number; points: number } {
  return { money: meta.scoring?.patronage_money ?? 10, points: meta.scoring?.patronage_points ?? 2 };
}

export function crisisPrInfluence(meta: CityMeta): number {
  return meta.scoring?.crisis_pr_influence ?? 3;
}

// Cleaning a scandal was 42 of the hottest events in two measured games and it was spread over
// five buttons at five prices in two different panels: the basic action, three role powers and a
// card. The mechanic stays; the screen shows one button, and it is the price *your* role pays.
const cleanupPowers: Record<string, string> = {
  politician: "politician_cleanup",
  fraudster: "fraudster_cleanup",
  mafia: "mafia_cleanup",
};

export function cleanupPowerFor(role: string | null): string | undefined {
  return role ? cleanupPowers[role] : undefined;
}

/* Цена и результат каждой чистки — те же числа, что берёт движок (`_politician_cleanup`,
 * `_fraudster_cleanup`, `_mafia_cleanup`, `_crisis_pr`). На кнопке печаталось «−1⚠» для всех
 * ролей, а «Замять дело» снимает два скандала за 3$, — игрок узнавал цену только из хроники. */
export type CleanupCost = { money: number; influence: number; scandals: number };

export function cleanupCost(power: string | undefined, meta: CityMeta): CleanupCost {
  switch (power) {
    case "politician_cleanup":
      return { money: 0, influence: 2, scandals: 1 };
    case "fraudster_cleanup":
      return { money: 0, influence: 0, scandals: 1 };
    case "mafia_cleanup":
      return { money: 3, influence: 0, scandals: 2 };
    default:
      return { money: 0, influence: crisisPrInfluence(meta), scandals: 1 };
  }
}

export function cleanupOffer(
  power: string | undefined,
  meta: CityMeta,
): { label: string; tooltip: string; cost: CleanupCost } {
  const cost = crisisPrInfluence(meta);
  const base = tg("cleanup.base", { cost });
  const key = power && ["politician_cleanup", "fraudster_cleanup", "mafia_cleanup"].includes(power) ? power : "default";
  return {
    label: tg(`cleanup.${key}.label`, { cost }),
    tooltip: tg(`cleanup.${key}.tooltip`, { cost, base }),
    cost: cleanupCost(key === "default" ? undefined : key, meta),
  };
}

export function actionCardCost(meta: CityMeta): number {
  return meta.scoring?.action_card_cost ?? 4;
}

/** What a discarded card pays back: money or influence. */
export function cardDiscardValue(meta: CityMeta): { money: number; influence: number } {
  return { money: meta.scoring?.card_discard_money ?? 2, influence: meta.scoring?.card_discard_influence ?? 1 };
}

/** Human-readable project condition, built from the structured requirement. */
export function projectRequirementText(project: ProjectMeta, meta: CityMeta): string {
  const requirement = project.requirement ?? { type: "none" };
  const count = requirement.count ?? 1;
  const districtTitle = (id?: string): string => meta.districts.find(item => item.id === id)?.title ?? id ?? "";
  const known = ["none", "assets", "role", "max_scandals", "district_objects", "district_depth", "distinct_districts", "tag_objects"];
  if (!known.includes(requirement.type)) return requirement.type;
  return tg(`requirement.${requirement.type}`, {
    count,
    district: districtTitle(requirement.district),
    tag: tagLabel(requirement.tag ?? ""),
  });
}

/* Теги в каталоге — служебные id. Игроку показываются названия на его языке: и на карточке
 * объекта, и в условии проекта, иначе «объекты с тегом government» не найти глазами на доске. */
export const tagLabels = labelTable("tag", [
  "finance", "grey", "government", "production", "politics", "security", "tech", "service", "infrastructure",
  "data", "logistics", "media", "energy", "ai", "legal", "office", "crypto", "contract", "lobby",
]);

export const tagLabel = (tag: string): string => tagLabels[tag] ?? tag;

const PERK_KEYS = [
  "passiveMoney", "passiveInfluence", "scandalReduction", "greyScandalReduction", "turnRoof", "roofCapacity",
  "extraInvestmentActions",
];

export function projectPerkText(project: ProjectMeta): string {
  const entries = Object.entries(project.perk ?? {});
  if (entries.length === 0) return tg("perk.none");
  return entries.map(([key, value]) => (PERK_KEYS.includes(key) ? tg(`perk.${key}`, { value }) : `${key} ${value}`)).join(", ");
}

// Market prices arrive precomputed from the engine (`market.price`); `asset.cost` is only the
// fallback for a view rendered without a viewer. Never recompute discounts here.
export function marketPrice(asset: AssetMeta, item: MarketAsset): number {
  return item.price ?? asset.cost;
}

// Matches the engine `roof_price`: the cost grows with the round, and a forged mafia mandate
// pays the discounted price too, because the engine checks the copied role as well.
function roofCost(player: PlayerState, game: GameState): number {
  const base = 3 + Math.floor((game.round_number - 1) / 2);
  return player.role === "mafia" ? base - 1 : base;
}

function capacityLabel(player: PlayerState): string {
  if (player.capacity >= 6) return tg("capacity.max");
  const price = capacityCosts[player.capacity];
  const influence = capacityInfluence[player.capacity] ?? 0;
  return influence
    ? tg("capacity.nextInfluence", { slot: player.capacity + 1, cost: price ?? "?", influence })
    : tg("capacity.next", { slot: player.capacity + 1, cost: price ?? "?" });
}

interface LabelContext {
  game: GameState;
  meta: CityMeta;
  player: PlayerState;
  assets: Map<string, AssetMeta>;
  cards: Map<string, ActionMeta>;
  roles: Map<string, RoleMeta>;
  districts: Map<string, { title: string }>;
  projects: Map<string, ProjectMeta>;
}

export function actionLabel(action: LegalAction, context: LabelContext): string {
  const { game, meta, player, assets, cards, roles, districts, projects } = context;
  const payload = action.payload;
  const target = game.players.find(item => item.id === stringValue(payload.target_id));
  const district = districts.get(stringValue(payload.district));
  const role = roles.get(stringValue(payload.role_id));
  const project = projects.get(stringValue(payload.project_id));
  if (action.type === "basic_action") {
    if (payload.kind === "work") return tg("action.work");
    if (payload.kind === "patronage") {
      const deal = patronage(meta);
      return tg("action.patronage", deal);
    }
    if (payload.kind === "lobbying") {
      const deal = lobbying(meta);
      return tg("action.lobbying", deal);
    }
    const tier = campaignTier(meta, payload.spend);
    return tier ? tg("action.campaign", tier) : tg("action.campaignPlain");
  }
  if (action.type === "end_turn") return tg("action.endTurn");
  if (action.type === "reroll_projects") return tg("action.rerollProjects", { money: projectRerollMoney(meta) });
  if (action.type === "city_project") {
    // Хартия снимает требования проекта, но один раз за партию, и об этом нужно
    // предупредить до клика: обратно право не вернуть.
    const waiver = payload.use_waiver === true ? tg("action.waiver") : "";
    return project
      ? tg("action.project", {
          title: project.title,
          influence: project.cost_influence,
          money: project.cost_money,
          points: project.points,
          waiver,
        })
      : tg("action.projectPlain", { waiver });
  }
  if (action.type === "buy_capacity") return capacityLabel(player);
  if (action.type === "buy_roof") return tg("action.buyRoof", { cost: roofCost(player, game) });
  // The engine charges influence, not money: CRISIS_PR_INFLUENCE, not the old 4$ price.
  if (action.type === "crisis_pr") return tg("action.crisisPr", { cost: crisisPrInfluence(meta) });
  if (action.type === "claim_role") return `${role?.icon ?? "🏷️"} ${role?.title ?? payload.role_id}`;
  if (action.type === "buy_asset") {
    const marketItem = game.market.find(item => item.uid === payload.market_uid);
    return tg("action.buyAsset", { title: assets.get(marketItem?.card_id ?? "")?.title ?? tg("action.object") });
  }
  if (action.type === "sell_asset") {
    const owned = player.assets.find(item => item.uid === payload.asset_uid);
    const asset = assets.get(owned?.card_id ?? "");
    const points = asset ? assetPoints(asset) : 0;
    return tg("action.sellAsset", { title: asset?.title ?? tg("action.object"), points });
  }
  if (action.type === "market_refresh") {
    const marketItem = game.market.find(item => item.uid === payload.market_uid);
    return tg("action.refresh", { title: assets.get(marketItem?.card_id ?? "")?.title ?? tg("action.slot") });
  }
  if (action.type === "buy_action_card") return tg("action.buyCard", { title: cards.get(stringValue(payload.card_id))?.title ?? payload.card_id });
  if (action.type === "convert_action_card") {
    const back = cardDiscardValue(meta);
    return payload.into === "money"
      ? tg("action.sellCard", { value: back.money })
      : tg("action.discardCard", { value: back.influence });
  }
  if (action.type === "play_action_card") {
    const held = player.hand?.find(item => item.uid === payload.card_uid);
    const title = cards.get(held?.card_id ?? "")?.title ?? tg("action.card");
    /* Карты, где игрок всё равно выбрал бы свой максимум, район больше не спрашивают:
     * движок берёт лучший сам и присылает посчитанную сумму. Печатаем её, иначе кнопка
     * «Разыграть» не говорит, ради чего её жмут. */
    const preview = game.card_previews?.[held?.card_id ?? ""];
    const auto = preview
      ? ` · ${preview.money}$${preview.district ? ` (${districts.get(preview.district)?.title ?? preview.district})` : ""}`
      : "";
    const detail = target ? ` → ${target.name}`
      : district ? ` · ${district.title}`
      : role ? ` · ${role.title}`
      : project ? tg("action.cardProject", { title: project.title, points: project.points })
      : payload.market_uid !== undefined
        ? tg("action.cardObject", {
            title: assets.get(game.market.find(item => item.uid === payload.market_uid)?.card_id ?? "")?.title ?? tg("action.object"),
          })
      : auto;
    return `${title}${detail}`;
  }
  if (action.type === "grey_operation") {
    return `${greyOperationLabels[stringValue(payload.asset_id)] ?? payload.asset_id}${target ? ` → ${target.name}` : ""}`;
  }
  if (action.type === "use_role_power") {
    const details = target ? ` → ${target.name}` : district ? ` · ${district.title}` : role ? ` · ${role.title}` : payload.amount ? ` · ${payload.amount}⚠` : payload.method ? ` · ${payload.method === "roof" ? tg("action.byRoof") : tg("action.byMoney")}` : "";
    return `${powerLabels[stringValue(payload.power)] ?? payload.power}${details}`;
  }
  return action.type;
}

const eventVerbs = labelTable("event.verbs", [
  "round_settled", "project_board_rotated", "turn_order_set", "role_takeover_blocked", "asset_replaced",
  "role_taken", "grey_operation", "role_power_used", "game_finished",
]);

// Colours assigned to players by seat order.
const playerColors = ["#9fc4d1", "#91c5a5", "#d9a17e", "#ca91b8", "#d9bd78", "#b9a2d4"];

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
      return [txt(tg("event.gameCreated"))];
    case "turn_started": {
      const actions = numberValue(data.actions);
      return lead(
        txt(tg("event.turnStarted", { round: numberValue(data.round_number) })),
        num(`${actions}⚡`, "neutral"),
      );
    }
    case "turn_ended":
      return lead(txt(tg("event.turnEnded")));
    case "round_started":
      return [txt(tg("event.roundStarted", { round: numberValue(data.round_number) }))];
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
      // После последнего раунда выплаты нет: движок присылает нули, и строка из четырёх «+0$»
      // читалась бы как сбой, а не как правило.
      if (numberValue(data.round_number) >= game.max_rounds && ids.every(id => paid(id) === 0 && gained(id) === 0)) {
        return [txt(tg("event.lastRound", { round: numberValue(data.round_number) }))];
      }
      const segments: LogSegment[] = [txt(tg("event.payouts", { round: numberValue(data.round_number) }))];
      ids.forEach((playerId, index) => {
        if (index > 0) segments.push(txt(", "));
        segments.push(playerSeg(game, playerId), txt(" "), signed(paid(playerId), "$"));
        // Passive influence is reported too: a wallet-only line settles it invisibly.
        if (gained(playerId) !== 0) segments.push(txt(" "), signed(gained(playerId), "◆"));
        // Since 1.21.0 the Защита refill and the scandal decay are settled here as well.
        const passive = (data.passive_sources as Record<string, Record<string, unknown>> | undefined)?.[playerId];
        const roofs = numberValue(passive?.roofs);
        const scandals = numberValue(passive?.scandals);
        if (roofs !== 0) segments.push(txt(" "), signed(roofs, "🛡"));
        if (scandals !== 0) segments.push(txt(" "), signed(scandals, "⚠", false));
      });
      return segments;
    }
    case "basic_action":
      if (data.kind === "patronage") {
        return lead(
          txt(tg("event.patronage")),
          num(tg("event.patronageGain", { spend: numberValue(data.spend), gain: numberValue(data.gain) }), "good"),
          txt(tg("event.nowMoney", { value: numberValue(data.money) })),
        );
      }
      if (data.kind === "lobbying") {
        return lead(
          txt(tg("event.lobbying")),
          num(tg("event.lobbyingGain", { spend: numberValue(data.spend), gain: numberValue(data.gain) }), "good"),
          txt(tg("event.nowInfluence", { value: numberValue(data.influence) })),
        );
      }
      return data.kind === "work"
        ? lead(txt(tg("event.work")), num("+2$", "good"), txt(tg("event.nowMoney", { value: numberValue(data.money) })))
        : lead(
            txt(tg("event.campaign")),
            num(`${numberValue(data.spend)}$→${numberValue(data.gain)}◆`, "good"),
            txt(tg("event.nowInfluence", { value: numberValue(data.influence) })),
          );
    case "city_project_taken": {
      const project = meta.projects.find(item => item.id === stringValue(data.project_id));
      return lead(
        txt(tg("event.projectTaken", { title: project?.title ?? stringValue(data.project_id) })),
        signed(-numberValue(data.cost_influence), "◆"),
        txt(" "),
        signed(-numberValue(data.cost_money), "$"),
        txt(" → "),
        num(tg("event.points", { count: numberValue(data.points) }), "good"),
        txt(")"),
      );
    }
    case "project_board_rotated": {
      const project = meta.projects.find(item => item.id === stringValue(data.expired_project_id));
      const title = project?.title ?? stringValue(data.expired_project_id);
      // Rotation recycles: the card goes under the deck, it does not leave the game.
      const tail = txt(tg("event.projectRotated", { title }));
      return event.actor_id ? lead(txt(tg("event.projectRotatedBy", { title }))) : [tail];
    }
    case "project_board_redealt": {
      // A full re-deal, so naming one card would be misleading: the whole board changed.
      const titles = ((data.project_board as string[]) ?? [])
        .map(id => meta.projects.find(item => item.id === id)?.title ?? id)
        .join(", ");
      return lead(
        txt(tg("event.projectRedealt")),
        signed(-numberValue(data.cost_money), "$"),
        txt(tg("event.projectRedealtTail", { titles })),
      );
    }
    case "turn_order_set": {
      const order = (data.order as string[]) ?? [];
      const segments: LogSegment[] = [txt(tg("event.turnOrder"))];
      order.forEach((playerId, index) => {
        if (index > 0) segments.push(txt(" → "));
        segments.push(playerSeg(game, playerId));
      });
      return segments;
    }
    case "capacity_bought": {
      const influence = numberValue(data.cost_influence);
      const price: LogSegment[] = [signed(-numberValue(data.cost), "$")];
      if (influence) price.push(txt(" "), signed(-influence, "◆"));
      return lead(txt(tg("event.capacity", { count: numberValue(data.capacity) })), ...price, txt(")"));
    }
    case "underdog_bonus": {
      const ids = (data.player_ids as string[] | undefined) ?? [];
      const segments: LogSegment[] = [txt(tg("event.underdog"))];
      ids.forEach((playerId, position) => {
        if (position > 0) segments.push(txt(", "));
        segments.push(playerSeg(game, playerId));
      });
      segments.push(txt(" "), num(`+${numberValue(data.influence)}◆`, "good"));
      return segments;
    }
    case "roof_bought":
      return lead(txt(tg("event.roofBought")), signed(-numberValue(data.cost), "$"), txt(tg("event.roofBoughtTail", { count: numberValue(data.roofs) })));
    case "military_sanction": {
      const stripped = stringValue(data.role_id);
      const roleTitle = meta.roles.find(item => item.id === stripped)?.title;
      const tail: LogSegment[] = [txt(tg("event.sanction")), playerSeg(game, stringValue(data.target_id))];
      tail.push(txt(` (${numberValue(data.scandals)}⚠): `));
      tail.push(num(`−${numberValue(data.money)}$`, "bad"));
      if (numberValue(data.influence)) tail.push(txt(", "), num(`−${numberValue(data.influence)}◆`, "bad"));
      if (roleTitle) tail.push(txt(tg("event.sanctionRole", { role: roleTitle })));
      return lead(...tail);
    }
    case "military_inspection": {
      // Two sets, and the difference between them is the whole story: who the inspection reached
      // and who actually took the scandal. Printing only the first reads as four scandals when a
      // Крыша ate three of them.
      const reached = Array.isArray(data.target_ids) ? data.target_ids.map(stringValue) : [];
      const hit = new Set(Array.isArray(data.scandalised_ids) ? data.scandalised_ids.map(stringValue) : []);
      const tail: LogSegment[] = [txt(tg("event.inspection"))];
      reached.forEach((targetId, index) => {
        if (index > 0) tail.push(txt(", "));
        tail.push(playerSeg(game, targetId));
        tail.push(hit.has(targetId) ? num(" +1⚠", "bad") : txt(tg("event.inspectionRoof")));
      });
      return lead(...tail);
    }
    case "roof_seized":
      // `kept: false` — a full stack: the target still loses the token, nobody gains it (1.18.0).
      if (data.kept === false) {
        return lead(txt(tg("event.roofSeized")), playerSeg(game, stringValue(data.target_id)), txt(tg("event.roofSeizedBurnt")));
      }
      return lead(
        txt(tg("event.roofSeized")),
        playerSeg(game, stringValue(data.target_id)),
        txt(tg("event.roofSeizedTail")),
        num(`${numberValue(data.roofs)}🛡`, "good"),
      );
    case "market_claimed":
      return lead(txt(tg("event.marketClaimed", { title: asset ?? assetId })));
    case "market_locked":
      return lead(txt(tg("event.marketLocked", { title: asset ?? assetId })));
    case "market_refreshed":
      return lead(txt(tg("event.marketRefreshed", { title: asset ?? assetId })));
    case "project_vetoed": {
      const vetoed = meta.projects.find(item => item.id === stringValue(data.project_id));
      return lead(txt(tg("event.vetoed", { title: vetoed?.title ?? stringValue(data.project_id) })));
    }
    case "crisis_pr":
      return lead(txt(tg("event.crisisPr")), signed(-numberValue(data.cost), "◆"), txt(", "), num("−1⚠", "good"), txt(tg("event.crisisPrTail", { count: numberValue(data.scandals) })));
    case "asset_bought":
      // «Приватизация» takes the object for nothing: say which card paid, not «за 0$».
      if (data.source_card_id) {
        const source = meta.action_cards.find(item => item.id === stringValue(data.source_card_id));
        return lead(txt(tg("event.assetFree", { title: asset ?? assetId, card: source?.title ?? stringValue(data.source_card_id) })), ...deltas);
      }
      // Deltas expose the grey-tag scandal and the purchase bonuses, which have no events of their own.
      return lead(txt(tg("event.assetBought", { title: asset ?? assetId })), num(`${numberValue(data.cost)}$`, "bad"), ...deltas);
    case "asset_sold": {
      const tail: LogSegment[] = [
        txt(tg("event.assetSold", { title: asset ?? tg("action.object") })),
        num(`${numberValue(data.value)}$`, "good"),
      ];
      // The token is freed by the sale; without this line it silently vanished from the board.
      return lead(...tail);
    }
    case "role_claimed":
    case "role_taken": {
      const tail: LogSegment[] = [txt(tg("event.roleClaimed", { role: role ?? roleId })), signed(-numberValue(data.cost), "◆"), txt(")")];
      const prev = stringValue(data.previous_holder_id);
      if (prev) tail.push(txt(tg("event.roleTakeover")), playerSeg(game, prev));
      return lead(...tail);
    }
    case "role_takeover_blocked":
      return lead(txt(tg("event.roleBlocked", { role: role ?? roleId, by: data.by === "roof" ? tg("event.blockedByRoof") : tg("event.blockedOther") })));
    case "action_card_bought":
      return lead(txt(tg("event.cardBought", { title: card ?? cardId })), signed(-numberValue(data.cost), "$"), txt(tg("event.cardBoughtTail")));
    case "free_action_card_drawn":
      return lead(txt(tg("event.cardFree", { title: card ?? cardId })));
    case "action_card_played": {
      const tail: LogSegment[] = [txt(tg("event.cardPlayed", { title: card ?? cardId }))];
      if (target) tail.push(txt(tg("event.against")), playerSeg(game, targetId));
      if (data.deferred) tail.push(txt(tg("event.cardDeferred")));
      return lead(...tail, ...deltas);
    }
    case "action_card_converted": {
      const value = numberValue(data.value) || 1;
      return lead(txt(tg("event.cardDiscarded", { title: card ?? cardId })), num(`+${value}${data.into === "money" ? "$" : "◆"}`, "good"));
    }
    // "targeted_card_resolved" was dropped in 1.9.0: action_card_played already carries the
    // deltas of the whole play, so the sub-event printed every hit a second time.
    case "targeted_effect_blocked":
      // The actor of this event is the defender: one token now answers every kind of attack.
      return lead(txt(tg("event.blocked")));
    case "role_stripped":
      return lead(
        txt(tg("event.roleStripped")),
        playerSeg(game, stringValue(data.target_id)),
        txt(tg("event.roleStrippedTail", { role: role ?? roleId })),
      );
    // Both of these must be announced: with only the scandal counter as a trace, a player
    // discovers a lost role by noticing their passive income has stopped.
    case "scandal_limit_reached": {
      const limit = numberValue(data.limit) || 5;
      const roleTitle = meta.roles.find(item => item.id === stringValue(data.role_id))?.title;
      const tail: LogSegment[] = [txt(tg("event.scandalLimit", { limit }))];
      tail.push(roleTitle ? txt(tg("event.roleLost", { role: roleTitle })) : txt(tg("event.noRole")));
      if (data.jailed) {
        tail.push(txt(tg("event.jailed")), num(`${numberValue(data.scandals)}⚠`, "neutral"), txt(tg("event.jailedTail")));
      }
      return lead(...tail);
    }
    case "player_jailed":
      // The arrest itself is reported by scandal_limit_reached, which knows the real limit —
      // it is 6 for everybody but the journalist, who survives one scandal longer.
      return lead(txt(tg("event.jailedNow")));
    case "market_rotated":
      return [txt(tg("event.marketRotated"))];
    case "grey_operation_resolved": {
      const tail: LogSegment[] = [txt(` ${greyOperationLabels[assetId] ?? assetId}`)];
      if (target) tail.push(txt(" → "), playerSeg(game, targetId));
      // The die first, then what it read as: «бросок 4 (+1) → 5».
      const roll = numberValue(data.roll);
      const modifier = numberValue(data.modifier);
      const face = numberValue(data.face);
      tail.push(txt(": "), txt(modifier ? tg("event.greyRollModified", { roll, modifier, face }) : tg("event.greyRoll", { roll })), txt(" — "));
      // A blocked run is not a failed one: the roll came in, the Защита held. Reading it as
      // "провал" hid why the operation did nothing.
      const tier = stringValue(data.tier);
      if (data.blocked) tail.push(num(tg("event.greyBlocked"), "bad"));
      else if (tier === "fail") tail.push(num(tg("event.greyFailure"), "bad"));
      else tail.push(num(tier === "full" ? tg("event.greyFull") : tg("event.greyWeak"), "good"));
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
      return [txt(tg("event.gameFinished")), playerSeg(game, winnerId), txt(tg("event.gameFinishedTail", { count: numberValue(scores[winnerId]) }))];
    }
    default: {
      const verb = eventVerbs[event.type] ?? event.type.split("_").join(" ");
      return hasActor ? lead(txt(` ${verb}`)) : [txt(verb)];
    }
  }
}

function describeEvent(event: DomainEvent, game: GameState, meta: CityMeta): string {
  return describeEventSegments(event, game, meta)
    .map(segment => segment.text)
    .join("");
}

// One row per source in the round forecast. `total` is rendered separately, and a zero row is kept
// on screen greyed out: "объекты +0◆" is the answer to "why is my influence not growing".
const forecastLabels = labelTable("forecast", [
  "objects", "projects", "residents", "journalist", "debt", "rating", "industrial",
]);

// One row per perk of the viewer's role. `unit` is what the number means, and the second string is
// the sentence shown when a foreign district would raise the ceiling — a perk that quietly pays
// less is the same invisibility bug we fixed on the project board.
const ROLE_PERK_KEYS = [
  "capitalist_objects", "capitalist_industrial_influence", "politician_residents", "journalist_money",
  "journalist_rating", "fraudster_actions", "fraudster_grey_roll", "mafia_racket_money", "mafia_racket_influence",
  "mafia_roofs", "military_sanction_targets", "military_inspection_targets", "military_seize_targets",
  "role_district_income",
];

const rolePerkLabels: Record<string, { label: string; unit: string; hint: string }> = {};
for (const key of ROLE_PERK_KEYS) {
  Object.defineProperty(rolePerkLabels, key, {
    enumerable: true,
    get: () => ({
      label: tg(`rolePerk.${key}.label`),
      unit: tg(`rolePerk.${key}.unit`, { defaultValue: "" }),
      hint: tg(`rolePerk.${key}.hint`),
    }),
  });
}

export interface RolePerkRow {
  key: string;
  label: string;
  text: string;
  hint: string;
  locked: boolean;
}

export function rolePerkRows(game: GameState, meta: CityMeta): RolePerkRow[] {
  const districts = new Map(meta.districts.map(item => [item.id, item.title]));
  return (game.role_perks ?? []).flatMap(perk => {
    const label = rolePerkLabels[perk.key];
    if (!label) return [];
    const ceiling = perk.potential ?? perk.value;
    const locked = perk.value === 0 || (perk.potential !== undefined && perk.value < perk.potential);
    const need = perk.needs ? districts.get(perk.needs) ?? perk.needs : "";
    const text = label.unit
      ? `${perk.value}${label.unit}${ceiling > perk.value ? tg("rolePerk.canBe", { value: `${ceiling}${label.unit}` }) : ""}`
      : perk.value > 0
        ? tg("rolePerk.works")
        : tg("rolePerk.off");
    return [{
      key: perk.key,
      label: label.label,
      text,
      hint: need ? tg("rolePerk.keyDistrict", { hint: label.hint, district: need }) : label.hint,
      locked,
    }];
  });
}

export interface ForecastRow { key: string; label: string; value: number }

export function forecastRows(row: Record<string, number> | undefined): ForecastRow[] {
  if (!row) return [];
  return Object.entries(row)
    .filter(([key]) => key !== "total" && key in forecastLabels)
    .map(([key, value]) => ({ key, label: forecastLabels[key], value }));
}

/** Full match record as Markdown: the chronicle plus the standings, ready to read or to share. */
export function buildGameLogMarkdown(room: RoomView, meta: CityMeta, version: string): string {
  const game = room.game;
  if (!game) return "";
  const ranked = rankPlayers(game);
  const lines = [
    tg("log.title", { name: room.name }),
    "",
    tg("log.build", { version }),
    tg("log.rules", { rules: game.rules_version ?? "—", content: game.content_version ?? "—" }),
    tg("log.round", { round: game.round_number, max: game.max_rounds, status: game.status }),
    tg("log.entries", { count: game.event_log.length }),
    "",
    tg("log.results"),
    "",
    tg("log.table"),
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  ranked.forEach((player, index) => {
    const score = game.score_breakdown?.[player.id];
    const role = meta.roles.find(item => item.id === player.role)?.title ?? tg("log.noRole");
    lines.push(
      `| ${index + 1} | ${player.name}${player.is_bot ? tg("log.bot", { level: difficultyLabels[player.difficulty] ?? player.difficulty }) : ""} · ${role} `
      + `| ${scoreOf(game, player)} | ${score?.projects ?? 0} | ${score?.assets ?? 0} | ${score?.role ?? 0} `
      + `| ${player.money}$ | ${player.influence}◆ | ${score?.scandals ?? 0} |`,
    );
  });
  lines.push("", tg("log.portfolios"), "");
  for (const player of ranked) {
    const owned = player.assets.map(item => meta.assets.find(asset => asset.id === item.card_id)?.title ?? item.card_id);
    const projects = player.projects.map(id => meta.projects.find(item => item.id === id)?.title ?? id);
    lines.push(
      `### ${player.name}`,
      "",
      tg("log.assets", { list: owned.join(", ") || tg("log.none") }),
      tg("log.projects", { list: projects.join(", ") || tg("log.none") }),
      "",
    );
  }
  lines.push(tg("log.chronicle"), "");
  // Oldest first: the chronicle on screen is newest-first for reading, but a log to analyse has to
  // run in the direction the game actually went.
  /* Реплики чата — на своих местах между событиями: `after_event` — последнее событие, которое
   * автор видел. Это читаемый журнал; в воспроизводимый .json чат не входит — реплика не ход. */
  const chat = room.chat ?? [];
  const said = (after: number) =>
    chat.filter(message => message.after_event === after).forEach(message => lines.push(`> 💬 **${message.name}:** ${chatText(message, game)}`));
  const known = new Set(game.event_log.map(event => event.seq));
  chat.filter(message => !known.has(message.after_event)).forEach(message => lines.push(`> 💬 **${message.name}:** ${chatText(message, game)}`));
  game.event_log.forEach(event => {
    lines.push(`${event.seq}. ${describeEvent(event, game, meta)}`);
    said(event.seq);
  });
  return lines.join("\n");
}

// A single bonus line for an object card. `active` → condition met for the owner right now
// (rendered green).
/* Строка таблицы свойств объекта.
 *
 * Две записи одного и того же, потому что мест для него два и они разного размера. `text` —
 * фраза для поповера, где ширина есть. `short` — ярлык для таблицы свойств на самой карточке:
 * четыре строки в два столбца, ячейка не переносится и обрезается многоточием, так что «+1$
 * пока вы „Мафиози“ (синергия сектора)» доезжало на ней до «+1$ пока вы „Ма…». Ярлык — то же
 * самое в форме «Мафиози +1$»: сначала условие, потом число, без служебных слов.
 *
 * Один построитель на обе формы, а не два списка: разъезжаются именно копии. */
export type AssetEffectKind = "district" | "sector" | "object" | "passive" | "purchase";
export interface AssetEffectLine {
  text: string;
  short: string;
  active: boolean;
  boosted: boolean;
  /** Общие правила района отделены от уникальных свойств самой карты. */
  kind: AssetEffectKind;
}

/** Общая лестница районной синергии. Используется и в расчёте строк, и в компактном футере карты. */
export function districtSynergyValue(count: number): number {
  return count >= 4 ? 2 : count >= 2 ? 1 : 0;
}

/* Профильный район каждой роли: за объект своего района роль доплачивает +1$.
 *
 * Совпадает с `supported` в `object_synergy_income`. У Политика это Административный квартал,
 * а не Спальный: жильё платит ему влиянием со всего города, а доллар за объект идёт с квартала.
 * Разойтись с движком здесь — значит обещать на карточках доллар, которого движок не платит. */
const roleDistrictMap: Record<string, string> = {
  capitalist: "business",
  politician: "government",
  fraudster: "tech",
  mafia: "shadows",
  military: "industrial",
};

// Reverse lookup: which role gains the flat +1$ synergy from an object of a given district.
// Спальный район в этой таблице отсутствует: профильной роли у него нет.
const districtRoleMap: Record<string, string> = Object.fromEntries(
  Object.entries(roleDistrictMap).map(([role, district]) => [district, role]),
);

/* Короткие имена районов для ярлыков. Полные названия («Административный квартал») занимают
 * ячейку целиком и не оставляют места числу, ради которого строка и существует. */
const districtShort = labelTable("districtShort", ["residential", "business", "industrial", "tech", "government", "shadows"]);

/** Build the full, numeric breakdown of an object's bonuses for its card. */
export function assetEffectLines(
  asset: AssetMeta,
  owner: PlayerState,
  meta: CityMeta,
  assets: Map<string, AssetMeta>,
  options?: { includeSynergy?: boolean },
): AssetEffectLine[] {
  const includeSynergy = options?.includeSynergy ?? false;
  const effects = (asset.effects ?? {}) as Record<string, unknown>;
  const lines: AssetEffectLine[] = [];
  const districtTitle = (id: string): string => meta.districts.find(item => item.id === id)?.title ?? id;
  const short = (id: string): string => districtShort[id] ?? districtTitle(id);
  const roleTitle = (id: string): string => meta.roles.find(item => item.id === id)?.title ?? id;
  const hasRole = (role: string): boolean => owner.role === role;
  /* Ровно `has_district_link` движка: район засчитывается тому, у кого он есть — построен,
   * или помечен меткой Капиталиста. Виртуальных связей роли с районом
   * нет ни у кого: лишняя такая связь рисует галочку у условия, которого движок не засчитывает. */
  const hasLink = (district: string): boolean => districtCount(owner, district, assets) > 0;
  const push = (
    text: string,
    label: string,
    active: boolean,
    kind: AssetEffectKind = "object",
  ): void => {
    lines.push({ text, short: label, active, boosted: false, kind });
  };

  // Generic district + role synergy (only for owned cards, where it is not shown elsewhere).
  if (includeSynergy) {
    const count = districtCount(owner, asset.district, assets);
    const synergy = districtSynergyValue(count);
    if (synergy > 0) {
      push(
        tg("effect.synergyText", { value: synergy, district: districtTitle(asset.district), count }),
        tg("effect.synergyShort", { value: synergy, count }),
        true,
        "district",
      );
    }
    // The district's matching role always grants +1$ — shown for every object of that district,
    // active only while you actually hold the role (this is the "sector → role" bonus).
    const synergyRole = districtRoleMap[asset.district];
    if (synergyRole) {
      /* «Мафиози: район +1$», а не «Мафиози +1$»: у двенадцати объектов есть ещё и своя
       * доплата той же роли, и два одинаковых ярлыка в таблице читались бы как задвоение. */
      push(
        tg("effect.sectorText", { role: roleTitle(synergyRole) }),
        tg("effect.sectorShort", { role: roleTitle(synergyRole) }),
        hasRole(synergyRole),
        "sector",
      );
    }
    /* Награда за глубину: эпик и легендарка полностью собранного района платят ещё и влиянием.
     * Справочник обещает, что она «написана на самой карточке» — а на карточке её не было. */
    const synergyInfluence = numberValue(effects.synergyInfluence);
    if (synergyInfluence) {
      push(
        tg("effect.fullDistrictText", { value: synergyInfluence, count }),
        tg("effect.fullDistrictShort", { value: synergyInfluence }),
        count >= 4,
      );
    }
  }

  const influenceBonus = effects.influenceBonus as { value: number; district?: string; role?: string } | undefined;
  if (influenceBonus) {
    const roleOk = !influenceBonus.role || hasRole(influenceBonus.role);
    const districtOk = !influenceBonus.district || hasLink(influenceBonus.district);
    const cond = [
      influenceBonus.district ? tg("effect.influenceCondDistrict", { district: districtTitle(influenceBonus.district) }) : "",
      influenceBonus.role ? tg("effect.influenceCondRole", { role: roleTitle(influenceBonus.role) }) : "",
    ].filter(Boolean).join(tg("effect.and"));
    const label = [
      influenceBonus.district ? short(influenceBonus.district) : "",
      influenceBonus.role ? roleTitle(influenceBonus.role) : "",
    ].filter(Boolean).join(" + ");
    push(
      tg("effect.influenceText", { value: influenceBonus.value, cond: cond ? tg("effect.influenceCond", { cond }) : "" }),
      label
        ? tg("effect.influenceShort", { label, value: influenceBonus.value })
        : tg("effect.influenceShortPlain", { value: influenceBonus.value }),
      roleOk && districtOk,
    );
  }

  const districtBonus = effects.districtBonus as
    | { district: string; value: number; perObject?: boolean; excludeSelf?: boolean; virtualRole?: string }
    | undefined;
  if (districtBonus) {
    if (districtBonus.perObject) {
      const adjust = districtBonus.excludeSelf && asset.district === districtBonus.district ? 1 : 0;
      const virtual = districtBonus.virtualRole && hasRole(districtBonus.virtualRole) ? 1 : 0;
      const count = Math.max(0, districtCount(owner, districtBonus.district, assets) - adjust + virtual);
      const per = districtBonus.value;
      push(
        tg("effect.perObjectText", { value: per, district: districtTitle(districtBonus.district), count, total: per * count }),
        tg("effect.perObjectShort", { district: short(districtBonus.district), count, total: per * count }),
        count > 0,
      );
    } else {
      push(
        tg("effect.linkText", { value: districtBonus.value, district: districtTitle(districtBonus.district) }),
        tg("effect.linkShort", { value: districtBonus.value, district: short(districtBonus.district) }),
        hasLink(districtBonus.district),
      );
    }
  }

  const roleBonus = effects.roleBonus as { role: string; value: number } | undefined;
  if (roleBonus) {
    push(
      tg("effect.roleText", { value: roleBonus.value, role: roleTitle(roleBonus.role) }),
      tg("effect.roleShort", { value: roleBonus.value, role: roleTitle(roleBonus.role) }),
      hasRole(roleBonus.role),
    );
  }
  for (const bonus of (effects.roleBonuses as { role: string; value: number }[] | undefined) ?? []) {
    push(
      tg("effect.roleText", { value: bonus.value, role: roleTitle(bonus.role) }),
      tg("effect.roleShort", { value: bonus.value, role: roleTitle(bonus.role) }),
      hasRole(bonus.role),
    );
  }
  for (const link of (effects.districtLinks as { district: string; value: number }[] | undefined) ?? []) {
    push(
      tg("effect.linkText", { value: link.value, district: districtTitle(link.district) }),
      tg("effect.linkShort", { value: link.value, district: short(link.district) }),
      hasLink(link.district),
    );
  }

  /* Постоянные способности: полная фраза для поповера, ярлык для ячейки карточки. */
  const passive: [string, string][] = [];
  const pair = (key: string, options?: Record<string, unknown>): [string, string] => [
    tg(`effect.${key}`, options),
    tg(`effect.${key}Short`, options),
  ];
  if (numberValue(effects.extraActions)) passive.push(pair("extraActions"));
  if (numberValue(effects.extraInvestmentActions)) passive.push(pair("extraInvestment"));
  if (numberValue(effects.turnRoof)) passive.push(pair("turnRoof"));
  if (numberValue(effects.roofCapacity)) passive.push(pair("roofCapacity", { value: numberValue(effects.roofCapacity) }));
  if (numberValue(effects.scandalReduction))
    passive.push(pair("scandalReduction", { value: numberValue(effects.scandalReduction) }));
  if (numberValue(effects.greyScandalReduction))
    passive.push(pair("greyReduction", { value: numberValue(effects.greyScandalReduction) }));
  if (numberValue(effects.turnCard)) passive.push(pair("turnCard"));
  if (numberValue(effects.marketRefresh)) passive.push(pair("marketRefresh"));
  if (numberValue(effects.projectWaiver)) passive.push(pair("projectWaiver"));
  if (typeof effects.districtDouble === "string")
    passive.push([
      tg("effect.districtDouble", { district: districtTitle(effects.districtDouble) }),
      tg("effect.districtDoubleShort", { district: short(effects.districtDouble) }),
    ]);
  if (numberValue(effects.takeoverCompensation))
    passive.push(pair("takeover", { value: numberValue(effects.takeoverCompensation) }));
  for (const [text, label] of passive) push(text, label, true, "passive");

  const purchase = effects.purchase as
    | { money?: number; influence?: number; roofs?: number; card?: boolean; scandals?: number }
    | undefined;
  if (purchase) {
    // Две формы: полная для окна и короткая для ячейки карточки (Крыша — значком, карта — одним словом).
    const parts: string[] = [];
    const brief: string[] = [];
    const add = (full: string, short = full) => {
      parts.push(full);
      brief.push(short);
    };
    if (purchase.money) add(`${purchase.money > 0 ? "+" : "−"}${Math.abs(purchase.money)}$`);
    if (purchase.influence) add(`+${purchase.influence}◆`);
    if (purchase.roofs) add(tg("effect.purchaseRoof", { count: purchase.roofs }), `+${purchase.roofs}🛡`);
    if (purchase.card) add(tg("effect.purchaseCard"), tg("effect.purchaseCardShort"));
    if (purchase.scandals) add(tg("effect.purchaseScandal", { count: purchase.scandals }));
    if (parts.length) push(
      tg("effect.purchase", { parts: parts.join(", ") }),
      tg("effect.purchaseShort", { parts: brief.join(", ") }),
      false,
      "purchase",
    );
  }

  return lines;
}
