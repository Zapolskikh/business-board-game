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
  politician_cleanup: "Урегулировать скандал",
  journalist_inflate: "Раздуть историю",
  journalist_publish: "Опубликовать расследование",
  mafia_racket: "Рэкет",
  mafia_cleanup: "Замять дело",
  military_sanction: "Санкции",
  military_inspection: "Прийти с проверкой",
  military_roof_seize: "Отобрать Крышу",
  fraudster_cleanup: "Снять скандал",
  fraudster_crypto_scam: "Криптоскам",
  capitalist_claim: "Поставить метку",
  mafia_lock: "Серая метка",
  politician_deal: "Договоримся",
  politician_veto: "Право вето",
};

/* Что делает каждая активная способность и во что обходится.
 *
 * Раньше в панели стояло только название и «сейчас недоступна»: игрок не знал ни что кнопка
 * делает, ни почему она серая, ни чего ему не хватает. Текст здесь — описание, а не правило:
 * все числа, по которым способность разрешается, приходят из движка в `game.role_powers`.
 */
export const powerDescriptions: Record<string, { what: string; cost: string }> = {
  capitalist_claim: {
    what:
      "Ставит вашу метку на карту рынка. Помеченная карта считается вашей: даёт доход, входит в " +
      "синергию района, засчитывается в условия проектов и открывает серые операции — но остаётся " +
      "в продаже, и любой может купить её у вас из-под носа. Очков за неё вы не получаете. " +
      "Метка одна: новая снимает предыдущую, при потере роли снимается сама.",
    cost: "действие + 1 скандал",
  },
  politician_cleanup: {
    what: "Снимает один свой скандал. Дешевле обычного антикризисного PR, но тоже стоит действие.",
    cost: "действие + 2◆",
  },
  politician_deal: {
    what:
      "Любой район на ваш выбор до конца раунда считается вашим: открывает проекты и серые " +
      "операции этого квартала и входит в синергию. Район не обязательно должен у вас быть.",
    cost: "3◆ + 1 скандал, действие не тратится, раз в ход",
  },
  politician_veto: {
    what:
      "Закрывает проект на доске: пока вето стоит, взять его можете только вы. Проект уходит " +
      "с доски по обычному расписанию и уносит вето с собой. Вето одно, его видят все.",
    cost: "действие + 3◆",
  },
  journalist_inflate: {
    what:
      "Один скандал сопернику — и один вам: раздувая историю, вы пачкаетесь сами. Крыша цели " +
      "гасит эффект целиком и тратится, тогда и вашего скандала не будет.",
    cost: "бесплатно, действие не тратится, раз в ход",
  },
  journalist_publish: {
    what: "Два скандала сопернику и без отдачи по вам. Крыша цели гасит публикацию целиком.",
    cost: "действие + 3◆, раз в ход",
  },
  fraudster_cleanup: {
    what: "Снимает один свой скандал даром — сама роль их и производит.",
    cost: "действие",
  },
  fraudster_crypto_scam: {
    what:
      "Забирает четверть кошелька у каждого соперника разом. Крыша защищает своего владельца " +
      "и тратится. Обходится в пять скандалов — весь бюджет роли, если не собран движок из " +
      "объектов и проектов, снижающих скандалы от серых операций.",
    cost: "действие + 5 скандалов, раз в ход",
  },
  mafia_racket: {
    what:
      "Дань с одного соперника: деньги по вашим объектам Серого сектора, влияние — по " +
      "Административному кварталу. Без своего объекта Администрации приносит ещё и скандал вам. " +
      "Крыша цели гасит рэкет и тратится.",
    cost: "действие, раз в ход",
  },
  mafia_cleanup: {
    what: "Хоронит сразу два своих скандала. Нужен свой объект Административного квартала.",
    cost: "действие + 3$",
  },
  mafia_lock: {
    what:
      "Серая метка на карту рынка: до конца раунда её не купит никто, кроме вас. Снять нельзя — " +
      "метку убирает только смена раунда. Видят все.",
    cost: "1 Крыша, действие не тратится, раз в ход",
  },
  military_sanction: {
    what:
      "Лестница по счётчику скандалов цели: с двух — деньги, с трёх — деньги и влияние, " +
      "с четырёх — ещё и роль. Скандал цели не снимается. Крыша гасит санкцию и тратится.",
    cost: "действие, раз в ход",
  },
  military_inspection: {
    what:
      "Скандал каждому сопернику, у кого есть объект Серого сектора. Бьёт по району, а не по " +
      "игроку, поэтому отсидеться тихо нельзя. Крыша отвечает за своего владельца и тратится.",
    cost: "действие",
  },
  military_roof_seize: {
    what:
      "Забирает одну Крышу у соперника и ставит её себе. Крыша от этого не защищает — иначе " +
      "способность нельзя было бы применить к тем, у кого она есть.",
    cost: "действие + 3◆",
  },
};

/* Чего не хватает. Ключи приходят из движка вместе с have/needed — клиент только подписывает. */
export function powerGateText(
  gate: { key: string; have: number; needed: number; district?: string; asset_id?: string },
  meta: CityMeta,
): string {
  const district = meta.districts.find(item => item.id === gate.district)?.title ?? gate.district;
  const asset = meta.assets.find(item => item.id === gate.asset_id)?.title ?? gate.asset_id;
  switch (gate.key) {
    case "action":
      return "нет действий в этом ходу";
    case "once_per_turn":
      return "уже использовано в этом ходу";
    case "influence":
      return `нужно ${gate.needed}◆, у вас ${gate.have}`;
    case "money":
      return `нужно ${gate.needed}$, у вас ${gate.have}`;
    case "own_scandal":
      return "нет своего скандала, который можно снять";
    case "scandal_room":
      return "скандал приведёт к потере роли";
    case "roof":
      return "нужна Крыша, у вас её нет";
    case "roof_room":
      return "предел Крыш достигнут — некуда положить";
    case "district":
      return `нужен ваш объект района «${district}»`;
    case "own_asset":
      return `нужен ваш объект «${asset}»`;
    case "market_slot":
      return "все слоты рынка уже помечены вами";
    case "project_slot":
      return "на доске нет проекта без вашего вето";
    case "rival":
      return "нет соперников";
    case "dirty_rival":
      return "ни у кого из соперников нет 2+ скандалов";
    case "grey_rival":
      return "ни у кого из соперников нет объекта Серого сектора";
    case "roofed_rival":
      return "ни у кого из соперников нет Крыши";
    default:
      return `${gate.key}: ${gate.have}/${gate.needed}`;
  }
}

export const greyOperationLabels: Record<string, string> = {
  smear: "Вброс",
  crypto: "Памп и дамп",
  roof_break: "Пробить крышу",
  datacenter: "Взлом",
  influence_broker: "Слив компромата",
};

// Mirrors `CityEngine.GREY_OPERATION_DISTRICTS`: an operation is unlocked by any active object of
// these districts, not by one card out of 71. Kept next to the labels because the object cards have
// to say the same thing the operation panel says — the panel used to announce the requirement only
// after you had already spent your money on something else.
export const greyOperationDistricts: Record<string, string[]> = {
  smear: ["shadows"],
  crypto: ["tech", "shadows"],
  roof_break: ["shadows"],
  datacenter: ["tech", "shadows"],
  influence_broker: ["shadows", "government"],
};

// Mirrors `CityEngine.grey_operation_points`. Every operation carries its own score now, so this
// reads a table instead of asking which ones are the "hard" ones.
export function greyOperationPoints(meta: CityMeta, operationId: string): number {
  return meta.scoring?.grey_operation_points?.[operationId] ?? (operationId === "datacenter" || operationId === "influence_broker" ? 3 : 2);
}

// Mirrors `CityEngine.hack_influence_steal` and `CityEngine.pump_drain`.
function hackSteal(meta: CityMeta, round: number): number {
  return (meta.scoring?.hack_influence_base ?? 2) + Math.floor(round / 3);
}

function pumpDrain(meta: CityMeta, round: number): number {
  return (meta.scoring?.pump_drain_base ?? 2) + Math.floor(round / 2);
}

export const greyOperationInfo: Record<string, { asset: string; effect: (round: number, meta: CityMeta) => string; chance: number; failure: string }> = {
  smear: {
    asset: "Сеть анонимных каналов",
    effect: () => "по 1 скандалу каждому сопернику",
    chance: 60,
    failure: "Единственный ход в игре, который бьёт по всем троим сразу — поэтому шанс у него ниже, чем у соседей. Крыша каждого соперника считается отдельно: она гасит его скандал и тратится. Одна операция может снять сразу три Крыши.",
  },
  crypto: {
    asset: "Городская криптобиржа",
    effect: (round, meta) => `забрать у каждого соперника до ${pumpDrain(meta, round)}$`,
    chance: 45,
    failure: "Деньги не появляются из воздуха — они переходят к вам из чужих кошельков, поэтому операция тем сильнее, чем больше игроков за столом. Крыша каждого соперника считается отдельно: она спасает его деньги и тратится.",
  },
  roof_break: {
    asset: "Бригада поджигателей",
    effect: (_round, meta) => `снять с цели все Крыши, +${meta.scoring?.roof_break_point_per_roof ?? 1} очко за каждую`,
    chance: 60,
    failure: "Единственная атака, которую Крыша не гасит — она по Крыше и бьёт. Доступна, только если у цели есть хотя бы одна Крыша. Крыша отражает 59% всех направленных атак в игре, так что это способ вскрыть игрока, который спрятался за защитой.",
  },
  datacenter: {
    asset: "Нелегальный дата-центр",
    effect: (round, meta) => `украсть у цели до ${hackSteal(meta, round)}◆`,
    chance: 40,
    failure: "Влияние — самый дефицитный ресурс, поэтому шанс здесь самый низкий, а размер кражи растёт с раундом. Крыша цели тратится и полностью отменяет кражу.",
  },
  influence_broker: {
    asset: "Торговец компроматом",
    effect: () => "снять роль с цели",
    chance: 60,
    failure: "Цель теряет роль: −3 очка, весь её пассив, а место освобождается по свободной цене, а не по цене переворота. Доступна, только если у цели есть роль. Крыша цели тратится и полностью гасит слив.",
  },
};

// Role powers that are gated on owning something, and on what exactly the engine checks. The scam
// checks a card id (`engine.py:1597`); the racket and the paid cleanup check a district
// (`engine.py:1459`, `engine.py:1497`), so there every object of that district is the key.
const assetGatedPowers: { power: string; role: string; asset?: string; district?: string; detail: string }[] = [
  { power: "fraudster_crypto_scam", role: "fraudster", asset: "crypto", detail: "забрать 25% денег у всех соперников" },
  { power: "mafia_racket", role: "mafia", district: "shadows", detail: "дань с выбранного соперника" },
  { power: "mafia_cleanup", role: "mafia", district: "government", detail: "снять до 2 скандалов за 3$" },
];

const capacityCosts: Record<number, number> = { 3: 6, 4: 10, 5: 15 };

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
 * объекты, район, арендованный «Зонированием» на раунд, и карта рынка, помеченная Капиталистом.
 * Плюс «Агломерация»: объект с `districtDouble` считает каждый ваш объект своего района за два —
 * умножается только построенное, аренда и метка не удваиваются.
 *
 * Здесь стояли только объекты и зонирование, поэтому карточка печатала «2/4» там, где движок
 * видел 4/4, и синергия на ней выглядела невключённой ровно тогда, когда она платила. */
export function districtCount(player: PlayerState, district: string, assets: Map<string, AssetMeta>): number {
  const owned = player.assets.filter(item => assets.get(item.card_id)?.district === district).length;
  const doubles = player.assets.filter(
    item => assets.get(item.card_id)?.effects?.districtDouble === district,
  ).length;
  const marked = player.marked_card_id ? assets.get(player.marked_card_id)?.district === district : false;
  return owned * (1 + doubles) + Number(player.zoning_district === district) + Number(marked);
}

// The engine ships the itemised score in `/state` (`score_breakdown`); it is never recomputed
// here. Money and influence convert at a rate now, and a second implementation of that would
// drift apart exactly like the market price did.
export function scoreOf(game: GameState, player: PlayerState): number {
  return game.final_scores?.[player.id] ?? game.score_breakdown?.[player.id]?.total ?? 0;
}

// Scoring rates come from the engine via `/meta`; the fallbacks only cover a stale cached meta.
// Scoring rates come from the engine via `/meta`; the fallbacks only cover a stale cached meta.
export function moneyPerPoint(meta: CityMeta): number {
  return meta.scoring?.money_per_point ?? 10;
}

export function influencePerPoint(meta: CityMeta): number {
  return meta.scoring?.influence_per_point ?? 3;
}

// Both sinks pay double the passive rate above, for one action and once a turn each.
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
export function campaignTier(meta: CityMeta, spend: unknown): { spend: number; gain: number } | undefined {
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

export function cleanupOffer(power: string | undefined, meta: CityMeta): { label: string; tooltip: string } {
  const base = `Базовый вариант — антикризисный PR: 1 действие и ${crisisPrInfluence(meta)}◆ за один скандал.`;
  switch (power) {
    case "politician_cleanup":
      return {
        label: "🧯 Урегулировать скандал: 2◆ → −1⚠",
        tooltip: `Способность Политика: 1 действие и 2◆ за один скандал — на 1◆ дешевле, чем у остальных. ${base}`,
      };
    case "fraudster_cleanup":
      return {
        label: "🧯 Замести следы: бесплатно → −1⚠",
        tooltip: `Способность Афериста: 1 действие и ничего больше за один скандал. У роли четыре действия за ход, так что чистка обходится дешевле всех в игре. ${base}`,
      };
    case "mafia_cleanup":
      return {
        label: "🧯 Замять дело: 3$ → −2⚠",
        tooltip: `Способность Мафиози: 1 действие и 3$ снимают сразу два скандала. Нужен активный объект Административного квартала — без него кнопка предлагает базовый вариант. ${base}`,
      };
    default:
      return {
        label: `🧯 Антикризисный PR: ${crisisPrInfluence(meta)}◆ → −1⚠`,
        tooltip: `Потратить 1 действие и ${crisisPrInfluence(meta)}◆, чтобы снять 1 свой скандал. Цена в влиянии, а не в деньгах: деньги слишком дёшевы в очках, чтобы скандал что-то значил. Роли Политика, Афериста и Мафиози чистят скандалы дешевле — эта же кнопка подставит их цену.`,
      };
  }
}

export function actionCardCost(meta: CityMeta): number {
  return meta.scoring?.action_card_cost ?? 3;
}

export function cardDiscardValue(meta: CityMeta): number {
  return meta.scoring?.card_discard_value ?? 2;
}

/** Human-readable project condition, built from the structured requirement. */
export function projectRequirementText(project: ProjectMeta, meta: CityMeta): string {
  const requirement = project.requirement ?? { type: "none" };
  const count = requirement.count ?? 1;
  const districtTitle = (id?: string): string => meta.districts.find(item => item.id === id)?.title ?? id ?? "";
  switch (requirement.type) {
    case "none": return "без условия";
    case "assets": return `объектов не меньше ${count}`;
    case "role": return "нужна любая роль";
    case "max_scandals": return `скандалов не больше ${count}`;
    case "district_objects": return `объектов в «${districtTitle(requirement.district)}» не меньше ${count}`;
    case "district_depth": return `не меньше ${count} объектов в одном районе`;
    case "distinct_districts": return `объекты в ${count} разных районах`;
    case "tag_objects": return `объектов с тегом «${requirement.tag}» не меньше ${count}`;
    default: return requirement.type;
  }
}

// The player's own standing on a condition, printed straight after it. The counting is the
// engine's (`project_requirement_standing`); this only formats what it sent. Without it a tag
// condition is homework: 16 tag projects left the board unused across two measured games.
export function projectProgressText(game: GameState, projectId: string): string {
  const standing = game.project_progress?.[projectId];
  if (!standing) return "";
  if (standing.binary) return standing.met ? " (вы: да)" : " (вы: нет)";
  return ` (вы: ${Math.min(standing.have, standing.needed)}/${standing.needed})`;
}

const perkLabels: Record<string, (value: number) => string> = {
  passiveMoney: value => `+${value}$ в каждый раунд`,
  passiveInfluence: value => `+${value}◆ в каждый раунд`,
  scandalReduction: value => `−${value} скандал в начале хода`,
  greyScandalReduction: value => `−${value} скандал от серых операций`,
  turnRoof: () => "+1 Крыша в начале каждого хода",
  roofCapacity: value => `+${value} к пределу Крыш`,
  extraInvestmentActions: () => "+1 инвестиционное действие в начале хода",
  carryAction: () => "переносит 1 неистраченное действие",
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
  return player.role === "mafia" ? base - 1 : base;
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
    if (payload.kind === "work") return "Городской заказ: +2$";
    if (payload.kind === "patronage") {
      const deal = patronage(meta);
      return `Патронаж: ${deal.money}$ → ${deal.points} очка`;
    }
    if (payload.kind === "lobbying") {
      const deal = lobbying(meta);
      return `Лоббирование: ${deal.influence}◆ → ${deal.points} очка`;
    }
    const tier = campaignTier(meta, payload.spend);
    return tier ? `Кампания: ${tier.spend}$ → ${tier.gain}◆` : "Кампания";
  }
  if (action.type === "end_turn") return "Завершить ход";
  if (action.type === "reroll_projects") return `Пересобрать доску проектов (${projectRerollMoney(meta)}$ + действие)`;
  if (action.type === "city_project") {
    // Хартия снимает требования проекта, но один раз за партию, и об этом нужно
    // предупредить до клика: обратно право не вернуть.
    const waiver = payload.use_waiver === true ? " · по Хартии, без требований" : "";
    return project
      ? `«${project.title}» · ${project.cost_influence}◆+${project.cost_money}$ → ${project.points} очков${waiver}`
      : `Городской проект${waiver}`;
  }
  if (action.type === "buy_capacity") return capacityLabel(player);
  if (action.type === "buy_roof") return `Купить Крышу (${roofCost(player, game)}$)`;
  // The engine charges influence, not money: CRISIS_PR_INFLUENCE, not the old 4$ price.
  if (action.type === "crisis_pr") return `Антикризисный PR: ${crisisPrInfluence(meta)}◆ → −1⚠`;
  if (action.type === "claim_role") return `${role?.icon ?? "🏷️"} ${role?.title ?? payload.role_id}`;
  if (action.type === "buy_asset") {
    const marketItem = game.market.find(item => item.uid === payload.market_uid);
    return `Купить «${assets.get(marketItem?.card_id ?? "")?.title ?? "объект"}»`;
  }
  if (action.type === "sell_asset") {
    const owned = player.assets.find(item => item.uid === payload.asset_uid);
    const asset = assets.get(owned?.card_id ?? "");
    const points = asset ? assetPoints(asset) : 0;
    return `Продать «${asset?.title ?? "объект"}» за ${points}$ (−${points} очков)`;
  }
  if (action.type === "market_refresh") {
    const marketItem = game.market.find(item => item.uid === payload.market_uid);
    return `Пересдать «${assets.get(marketItem?.card_id ?? "")?.title ?? "слот"}»`;
  }
  if (action.type === "buy_action_card") return `Купить «${cards.get(stringValue(payload.card_id))?.title ?? payload.card_id}»`;
  if (action.type === "convert_action_card") {
    const back = cardDiscardValue(meta);
    return payload.into === "money" ? `Продать карту → +${back}$` : `Сбросить карту → +${back}◆`;
  }
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
    return `${greyOperationLabels[stringValue(payload.asset_id)] ?? payload.asset_id}${target ? ` → ${target.name}` : ""}`;
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
  project_board_redealt: "пересобирает доску проектов",
  turn_order_set: "Порядок хода определён",
  role_takeover_blocked: "не смог перехватить роль",
  role_stripped: "сливает компромат и снимает роль",
  roof_bought: "покупает Крышу",
  crisis_pr: "проводит антикризисный PR",
  military_sanction: "вводит санкции",
  military_inspection: "приходит с проверкой",
  roof_seized: "отбирает Крышу",
  market_claimed: "ставит метку на карту рынка",
  market_locked: "закрывает слот серой меткой",
  market_refreshed: "пересдаёт слот рынка",
  project_vetoed: "накладывает право вето",
  capacity_bought: "расширяет бизнес",
  asset_bought: "покупает объект",
  asset_sold: "продаёт объект",
  asset_replaced: "меняет объект",
  role_claimed: "получает роль",
  role_taken: "захватывает роль",
  action_card_bought: "покупает карту действия",
  action_card_played: "разыгрывает карту",
  action_card_converted: "конвертирует карту",
  market_rotated: "Рынок объектов обновился",
  grey_operation: "проводит серую операцию",
  role_power_used: "использует способность роли",
  scandal_limit_reached: "доходит до предела скандалов",
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
      return lead(
        txt(` начинает ход · раунд ${numberValue(data.round_number)} · `),
        num(`${actions}⚡`, "neutral"),
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
      // После последнего раунда выплаты нет: движок присылает нули, и строка из четырёх «+0$»
      // читалась бы как сбой, а не как правило.
      if (numberValue(data.round_number) >= game.max_rounds && ids.every(id => paid(id) === 0 && gained(id) === 0)) {
        return [txt(`💰 Раунд ${numberValue(data.round_number)} — последний: выплаты за него нет`)];
      }
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
      if (data.kind === "patronage") {
        return lead(
          txt(" вкладывается в город ("),
          num(`${numberValue(data.spend)}$→${numberValue(data.gain)} очка`, "good"),
          txt(`, стало ${numberValue(data.money)}$)`),
        );
      }
      if (data.kind === "lobbying") {
        return lead(
          txt(" лоббирует свои интересы ("),
          num(`${numberValue(data.spend)}◆→${numberValue(data.gain)} очка`, "good"),
          txt(`, стало ${numberValue(data.influence)}◆)`),
        );
      }
      return data.kind === "work"
        ? lead(txt(" берёт городской заказ ("), num("+2$", "good"), txt(`, стало ${numberValue(data.money)}$)`))
        : lead(
            txt(" проводит кампанию ("),
            num(`${numberValue(data.spend)}$→${numberValue(data.gain)}◆`, "good"),
            txt(`, стало ${numberValue(data.influence)}◆)`),
          );
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
    case "project_board_redealt": {
      // A full re-deal, so naming one card would be misleading: the whole board changed.
      const titles = ((data.project_board as string[]) ?? [])
        .map(id => meta.projects.find(item => item.id === id)?.title ?? id)
        .join(", ");
      return lead(
        txt(" пересобирает доску проектов ("),
        signed(-numberValue(data.cost_money), "$"),
        txt(` и действие) → ${titles}`),
      );
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
    case "capacity_bought":
      return lead(txt(` расширяет бизнес до ${numberValue(data.capacity)} слотов (`), signed(-numberValue(data.cost), "$"), txt(")"));
    case "roof_bought":
      return lead(txt(" покупает Крышу ("), signed(-numberValue(data.cost), "$"), txt(`, крыш: ${numberValue(data.roofs)})`));
    case "military_sanction": {
      const stripped = stringValue(data.role_id);
      const roleTitle = meta.roles.find(item => item.id === stripped)?.title;
      const tail: LogSegment[] = [txt(" вводит санкции против "), playerSeg(game, stringValue(data.target_id))];
      tail.push(txt(` (${numberValue(data.scandals)}⚠): `));
      tail.push(num(`−${numberValue(data.money)}$`, "bad"));
      if (numberValue(data.influence)) tail.push(txt(", "), num(`−${numberValue(data.influence)}◆`, "bad"));
      if (roleTitle) tail.push(txt(` и роль «${roleTitle}» снята`));
      return lead(...tail);
    }
    case "military_inspection": {
      // Two sets, and the difference between them is the whole story: who the inspection reached
      // and who actually took the scandal. Printing only the first reads as four scandals when a
      // Крыша ate three of them.
      const reached = Array.isArray(data.target_ids) ? data.target_ids.map(stringValue) : [];
      const hit = new Set(Array.isArray(data.scandalised_ids) ? data.scandalised_ids.map(stringValue) : []);
      const tail: LogSegment[] = [txt(" приходит с проверкой в Серый сектор: ")];
      reached.forEach((targetId, index) => {
        if (index > 0) tail.push(txt(", "));
        tail.push(playerSeg(game, targetId));
        tail.push(hit.has(targetId) ? num(" +1⚠", "bad") : txt(" (Крыша)"));
      });
      return lead(...tail);
    }
    case "roof_seized":
      return lead(
        txt(" отбирает Крышу у "),
        playerSeg(game, stringValue(data.target_id)),
        txt("; теперь у него "),
        num(`${numberValue(data.roofs)} Крыш`, "good"),
      );
    case "market_claimed":
      return lead(txt(` ставит метку на «${asset ?? assetId}»: карта работает на него, но остаётся в продаже`));
    case "market_locked":
      return lead(txt(` закрывает «${asset ?? assetId}» серой меткой: до конца раунда её не купит никто другой`));
    case "market_refreshed":
      return lead(txt(` пересдаёт слот рынка: «${asset ?? assetId}» уходит в низ колоды`));
    case "project_vetoed": {
      const vetoed = meta.projects.find(item => item.id === stringValue(data.project_id));
      return lead(txt(` накладывает вето на «${vetoed?.title ?? stringValue(data.project_id)}»`));
    }
    case "crisis_pr":
      return lead(txt(" антикризисный PR ("), signed(-numberValue(data.cost), "◆"), txt(", "), num("−1⚠", "good"), txt(`, осталось ${numberValue(data.scandals)}⚠)`));
    case "asset_bought":
      // Deltas expose the grey-tag scandal and the purchase bonuses, which have no events of their own.
      return lead(txt(` покупает «${asset ?? assetId}» за `), num(`${numberValue(data.cost)}$`, "bad"), ...deltas);
    case "asset_sold": {
      const tail: LogSegment[] = [
        txt(` продаёт «${asset ?? "объект"}» за `),
        num(`${numberValue(data.value)}$`, "good"),
      ];
      // The token is freed by the sale; without this line it silently vanished from the board.
      return lead(...tail);
    }
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
    // "targeted_card_resolved" was dropped in 1.9.0: action_card_played already carries the
    // deltas of the whole play, so the sub-event printed every hit a second time.
    case "targeted_effect_blocked":
      // The actor of this event is the defender: one token now answers every kind of attack.
      return lead(txt(" отражает атаку Крышей"));
    case "role_stripped":
      return lead(
        txt(" сливает компромат на "),
        playerSeg(game, stringValue(data.target_id)),
        txt(` — роль «${role ?? roleId}» потеряна, место освободилось`),
      );
    // Both of these used to be invisible: the only trace was the scandal counter, so a player
    // discovered a lost role by noticing their passive income had stopped.
    case "scandal_limit_reached": {
      const limit = numberValue(data.limit) || 5;
      const roleTitle = meta.roles.find(item => item.id === stringValue(data.role_id))?.title;
      const tail: LogSegment[] = [txt(` набирает ${limit}⚠ — `)];
      tail.push(roleTitle ? txt(`роль «${roleTitle}» потеряна`) : txt("роли уже не было"));
      if (data.jailed) {
        tail.push(txt(", арест: следующий ход укорочен, скандалы сброшены до "), num("3⚠", "neutral"), txt(", Крыша снята"));
      }
      return lead(...tail);
    }
    case "player_jailed":
      // The arrest itself is reported by scandal_limit_reached, which knows the real limit —
      // it is 6 for everybody but the journalist, who survives one scandal longer.
      return lead(txt(" арестован прямо в свой ход: оставшиеся действия сгорают"));
    case "market_rotated":
      return [txt("🔄 Рынок объектов обновился")];
    case "grey_operation_resolved": {
      const chance = Math.round(numberValue(data.chance) * 100);
      const tail: LogSegment[] = [txt(` ${greyOperationLabels[assetId] ?? assetId}`)];
      if (target) tail.push(txt(" → "), playerSeg(game, targetId));
      tail.push(txt(": "));
      // A blocked run is not a failed one: the roll came in, the Крыша ate it. Reading it as
      // "провал" hid why the operation paid nothing.
      if (data.blocked) tail.push(num("погашено Крышей", "bad"));
      else tail.push(data.success ? num("успех", "good") : num("провал", "bad"));
      tail.push(txt(` (${chance}%)`));
      const points = numberValue(data.points);
      if (points) tail.push(txt(" "), num(`+${points} ${points >= 5 ? "очков" : "очка"}`, "good"));
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

// One row per source in the round forecast. `total` is rendered separately, and a zero row is kept
// on screen greyed out: "объекты +0◆" is the answer to "why is my influence not growing".
const forecastLabels: Record<string, string> = {
  objects: "🏢 Объекты",
  projects: "🏗️ Проекты",
  residents: "🏘️ Влияние с жителей",
  journalist: "📰 Публикации",
  debt: "🏦 Кредит",
  rating: "⭐ Рейтинг",
  industrial: "🏭 Промышленный ресурс",
};

// One row per perk of the viewer's role. `unit` is what the number means, and the second string is
// the sentence shown when a foreign district would raise the ceiling — a perk that quietly pays
// less is the same invisibility bug we fixed on the project board.
const rolePerkLabels: Record<string, { label: string; unit: string; hint: string }> = {
  capitalist_objects: { label: "Доход с каждого объекта", unit: "$/раунд", hint: "+1$ за каждый ваш активный объект" },
  capitalist_industrial_influence: {
    label: "Влияние с Промзоны",
    unit: "◆/раунд",
    hint: "+1◆ за каждый ваш объект Промзоны — купите объект Промзоны, чтобы включить",
  },
  politician_residents: {
    label: "Влияние с жителей",
    unit: "◆/раунд",
    hint: "+1◆ за каждый жилой объект на столе, включая чужие",
  },
  journalist_money: {
    label: "Деньги за чужие скандалы",
    unit: "$/раунд",
    hint: "1$ за каждый чужой скандал, 2$ при вашем объекте Делового центра",
  },
  journalist_rating: {
    label: "Влияние за свои скандалы",
    unit: "◆/раунд",
    hint: "+1◆ за каждый ваш скандал, без потолка — нужен хотя бы один объект Спального района",
  },
  fraudster_actions: { label: "Четыре действия за ход", unit: "", hint: "Больше, чем у любой другой роли" },
  fraudster_chance: {
    label: "Бонус к шансу серых операций",
    unit: "%",
    hint: "+30% к любой серой операции, без условий",
  },
  mafia_racket_money: {
    label: "Деньги рэкета",
    unit: "$",
    hint: "2$ плюс 2$ за каждый ваш объект Серого сектора (+5$ если цель лидер)",
  },
  mafia_racket_influence: {
    label: "Влияние рэкета",
    unit: "◆",
    hint: "1◆ за каждый ваш объект Административного квартала",
  },
  mafia_roofs: { label: "Предел Крыш", unit: "", hint: "2 вместо 1, и каждая на 1$ дешевле" },
  military_sanction_targets: {
    label: "Цели для санкции",
    unit: "",
    hint: "Соперники с 2+ скандалами: 2 — деньги, 3 — деньги и влияние, 4 — ещё и роль",
  },
  military_inspection_targets: {
    label: "Проверка достанет",
    unit: "соперников",
    hint: "Соперники с объектом Серого сектора получат по скандалу; за Крышей — гасится",
  },
  military_seize_targets: {
    label: "Крыши под перехват",
    unit: "",
    hint: "У кого есть Крыша: 3◆ и действие — забрать одну себе, Крыша не защищает",
  },
  role_district_income: {
    label: "Профильный район",
    unit: "$/раунд",
    hint: "+1$ к доходу каждого вашего объекта профильного района",
  },
};

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
      ? `${perk.value}${label.unit}${ceiling > perk.value ? ` (может быть ${ceiling}${label.unit})` : ""}`
      : perk.value > 0
        ? "работает"
        : "не работает";
    return [{
      key: perk.key,
      label: label.label,
      text,
      hint: need ? `${label.hint}. Район-ключ: ${need}.` : label.hint,
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
  const ranked = [...game.players].sort((a, b) => scoreOf(game, b) - scoreOf(game, a));
  const lines = [
    `# Город влияния — журнал партии «${room.name}»`,
    "",
    `- Версия сборки: v${version}`,
    `- Правила: ${game.rules_version ?? "—"} · контент: ${game.content_version ?? "—"}`,
    `- Раунд: ${game.round_number}/${game.max_rounds} · состояние: ${game.status}`,
    `- Записей в хронике: ${game.event_log.length}`,
    "",
    "## Итоги",
    "",
    "| # | Игрок | Очки | Проекты | Объекты | Роль | Деньги | Влияние | Скандалы |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  ranked.forEach((player, index) => {
    const score = game.score_breakdown?.[player.id];
    const role = meta.roles.find(item => item.id === player.role)?.title ?? "без роли";
    lines.push(
      `| ${index + 1} | ${player.name}${player.is_bot ? ` (бот ${difficultyLabels[player.difficulty] ?? player.difficulty})` : ""} · ${role} `
      + `| ${scoreOf(game, player)} | ${score?.projects ?? 0} | ${score?.assets ?? 0} | ${score?.role ?? 0} `
      + `| ${score?.money ?? 0} (${player.money}$) | ${score?.influence ?? 0} (${player.influence}◆) | ${score?.scandals ?? 0} |`,
    );
  });
  lines.push("", "## Портфели", "");
  for (const player of ranked) {
    const owned = player.assets.map(item => meta.assets.find(asset => asset.id === item.card_id)?.title ?? item.card_id);
    const projects = player.projects.map(id => meta.projects.find(item => item.id === id)?.title ?? id);
    lines.push(`### ${player.name}`, "", `- Объекты: ${owned.join(", ") || "нет"}`, `- Проекты: ${projects.join(", ") || "нет"}`, "");
  }
  lines.push("## Хроника", "");
  // Oldest first: the chronicle on screen is newest-first for reading, but a log to analyse has to
  // run in the direction the game actually went.
  game.event_log.forEach(event => lines.push(`${event.seq}. ${describeEvent(event, game, meta)}`));
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
export interface AssetEffectLine { text: string; short: string; active: boolean; boosted: boolean }

/* Профильный район каждой роли: за объект своего района роль доплачивает +1$.
 *
 * Совпадает с `supported` в `object_synergy_income`. У Политика это Административный квартал,
 * а не Спальный — район переехал в 1.12.0 вместе с тем, что жильё теперь платит ему влиянием со
 * всего города. Здесь оставался старый Спальный, и карточки жилья обещали политику доллар,
 * которого движок не платил, а на административных объектах строки не было вовсе. */
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
const districtShort: Record<string, string> = {
  residential: "Спальный",
  business: "Деловой",
  industrial: "Промзона",
  tech: "Технокластер",
  government: "Администрация",
  shadows: "Серый сектор",
};

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
   * арендован «Зонированием» или помечен меткой Капиталиста. Виртуальные связи Капиталиста с
   * Деловым центром и Политика с Администрацией удалены в 1.12.0 вместе с чартерами, а здесь
   * дожили и рисовали галочку у условия, которого движок не засчитывает. */
  const hasLink = (district: string): boolean => districtCount(owner, district, assets) > 0;
  const push = (text: string, label: string, active: boolean): void => {
    lines.push({ text, short: label, active, boosted: false });
  };

  // Generic district + role synergy (only for owned cards, where it is not shown elsewhere).
  if (includeSynergy) {
    const count = districtCount(owner, asset.district, assets);
    const synergy = count >= 4 ? 2 : count >= 2 ? 1 : 0;
    if (synergy > 0) {
      push(
        `+${synergy}$ синергия района «${districtTitle(asset.district)}» (${count}/4)`,
        `Район ${count}/4: +${synergy}$`,
        true,
      );
    }
    // The district's matching role always grants +1$ — shown for every object of that district,
    // active only while you actually hold the role (this is the "sector → role" bonus).
    const synergyRole = districtRoleMap[asset.district];
    if (synergyRole) {
      /* «Мафиози: район +1$», а не «Мафиози +1$»: у двенадцати объектов есть ещё и своя
       * доплата той же роли, и два одинаковых ярлыка в таблице читались бы как задвоение. */
      push(
        `+1$ пока вы «${roleTitle(synergyRole)}» (синергия сектора)`,
        `${roleTitle(synergyRole)}: район +1$`,
        hasRole(synergyRole),
      );
    }
    /* Награда за глубину: эпик и легендарка полностью собранного района платят ещё и влиянием.
     * Справочник обещает, что она «написана на самой карточке» — а на карточке её не было. */
    const synergyInfluence = numberValue(effects.synergyInfluence);
    if (synergyInfluence) {
      push(
        `+${synergyInfluence}◆/раунд, когда район собран полностью (${count}/4)`,
        `+${synergyInfluence}◆ при 4/4`,
        count >= 4,
      );
    }
  }

  const influenceBonus = effects.influenceBonus as { value: number; district?: string; role?: string } | undefined;
  if (influenceBonus) {
    const roleOk = !influenceBonus.role || hasRole(influenceBonus.role);
    const districtOk = !influenceBonus.district || hasLink(influenceBonus.district);
    const cond = [
      influenceBonus.district ? `объект «${districtTitle(influenceBonus.district)}»` : "",
      influenceBonus.role ? `роль «${roleTitle(influenceBonus.role)}»` : "",
    ].filter(Boolean).join(" и ");
    const label = [
      influenceBonus.district ? short(influenceBonus.district) : "",
      influenceBonus.role ? roleTitle(influenceBonus.role) : "",
    ].filter(Boolean).join(" + ");
    push(
      `+${influenceBonus.value}◆/раунд${cond ? ` при наличии ${cond}` : ""}`,
      label ? `${label}: +${influenceBonus.value}◆` : `+${influenceBonus.value}◆/раунд`,
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
        `+${per}$ за каждый объект «${districtTitle(districtBonus.district)}» · сейчас ${count} → +${per * count}$`,
        `${short(districtBonus.district)} ×${count}: +${per * count}$`,
        count > 0,
      );
    } else {
      push(
        `+${districtBonus.value}$ при наличии объекта «${districtTitle(districtBonus.district)}»`,
        `${short(districtBonus.district)} +${districtBonus.value}$`,
        hasLink(districtBonus.district),
      );
    }
  }

  const roleBonus = effects.roleBonus as { role: string; value: number } | undefined;
  if (roleBonus) {
    push(
      `+${roleBonus.value}$ пока вы «${roleTitle(roleBonus.role)}»`,
      `${roleTitle(roleBonus.role)} +${roleBonus.value}$`,
      hasRole(roleBonus.role),
    );
  }
  for (const bonus of (effects.roleBonuses as { role: string; value: number }[] | undefined) ?? []) {
    push(
      `+${bonus.value}$ пока вы «${roleTitle(bonus.role)}»`,
      `${roleTitle(bonus.role)} +${bonus.value}$`,
      hasRole(bonus.role),
    );
  }
  for (const link of (effects.districtLinks as { district: string; value: number }[] | undefined) ?? []) {
    push(
      `+${link.value}$ при наличии «${districtTitle(link.district)}»`,
      `${short(link.district)} +${link.value}$`,
      hasLink(link.district),
    );
  }

  /* Постоянные способности: полная фраза для поповера, ярлык для ячейки карточки. */
  const passive: [string, string][] = [];
  if (numberValue(effects.extraActions)) passive.push([`+1 действие в начале хода`, `+1 действие/ход`]);
  if (numberValue(effects.extraInvestmentActions))
    passive.push([`+1 инвестиционное действие в начале хода`, `+1 инвест. действие`]);
  if (numberValue(effects.turnRoof)) passive.push([`+1 Крыша в начале каждого хода`, `+1 Крыша/ход`]);
  if (numberValue(effects.roofCapacity))
    passive.push([
      `+${numberValue(effects.roofCapacity)} к пределу Крыш`,
      `+${numberValue(effects.roofCapacity)} к пределу Крыш`,
    ]);
  if (numberValue(effects.scandalReduction))
    passive.push([
      `−${numberValue(effects.scandalReduction)} скандал в начале хода`,
      `−${numberValue(effects.scandalReduction)} скандал/ход`,
    ]);
  if (numberValue(effects.greyScandalReduction))
    passive.push([
      `−${numberValue(effects.greyScandalReduction)} скандала от серых операций`,
      `−${numberValue(effects.greyScandalReduction)}⚠ от серых`,
    ]);
  if (numberValue(effects.carryAction))
    passive.push([`Переносит 1 неистраченное действие на следующий ход`, `Перенос действия`]);
  if (numberValue(effects.turnCard)) passive.push([`+1 карта действий в начале хода`, `+1 карта/ход`]);
  if (numberValue(effects.marketRefresh))
    passive.push([`Раз в раунд без действия: пересдать карту рынка`, `Пересдача рынка`]);
  if (numberValue(effects.projectWaiver))
    passive.push([`Раз за партию: проект без выполнения условия`, `Проект без условия`]);
  if (typeof effects.districtDouble === "string")
    passive.push([
      `Каждый ваш объект «${districtTitle(effects.districtDouble)}» считается за два`,
      `${short(effects.districtDouble)} ×2`,
    ]);
  if (numberValue(effects.takeoverCompensation))
    passive.push([
      `+${numberValue(effects.takeoverCompensation)}◆, если у вас перехватят роль`,
      `+${numberValue(effects.takeoverCompensation)}◆ за перехват`,
    ]);
  for (const [text, label] of passive) push(text, label, true);

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
    // Ярлык без слова «действия»: в ячейке от него остаётся многоточие, а смысл несёт число.
    const brief = parts.map(part => part.replace(" Крыша", "🛡").replace("карта действия", "карта"));
    if (parts.length) push(`При покупке: ${parts.join(", ")}`, `Покупка: ${brief.join(", ")}`, false);
  }

  return lines;
}

export interface AssetHint {
  kind: "grey" | "power" | "project" | "upgrade";
  icon: string;
  title: string;
  detail: string;
  // Whether the owner could act on it right now: the object is active in their business and the
  // role, if the ability needs one, is theirs. A market card is a promise, so nothing is ready yet.
  ready: boolean;
  tooltip: string;
}

// What an object hands its owner besides income: the operations only it unlocks, and the projects on
// the board that count it. This is an index over the catalog and the board, not a second
// implementation of any rule — nothing here re-evaluates a condition, so it cannot drift from the
// engine the way a local copy of `project_requirement_met` would.
export function assetHints(
  asset: AssetMeta,
  owner: PlayerState,
  game: GameState,
  meta: CityMeta,
  assets: Map<string, AssetMeta>,
  options?: { active?: boolean; market?: boolean },
): { special: boolean; hints: AssetHint[] } {
  const active = options?.active ?? false;
  const roleTitle = (id: string): string => meta.roles.find(item => item.id === id)?.title ?? id;
  const districtTitle = (id?: string): string => meta.districts.find(item => item.id === id)?.title ?? id ?? "";
  const hasRole = (id: string): boolean => owner.role === id;
  const hints: AssetHint[] = [];

  // The Серый сектор unlocks all five operations, so listing them one per line would bury the card
  // under its own hints. One line each up to two, a single summary line beyond that.
  const unlocked = Object.entries(greyOperationDistricts).filter(([, districts]) => districts.includes(asset.district));
  const operationLine = (operationId: string): string => {
    const grey = greyOperationInfo[operationId];
    return `${greyOperationLabels[operationId] ?? operationId}: ${grey.effect(game.round_number, meta)} · шанс от ${grey.chance}%`;
  };
  if (unlocked.length > 2) {
    hints.push({
      kind: "grey",
      icon: "🌒",
      title: `Серые операции (${unlocked.length})`,
      detail: unlocked.map(([operationId]) => greyOperationLabels[operationId] ?? operationId).join(", "),
      ready: active,
      tooltip: `Любой активный объект этого района открывает ${unlocked.length} серых операций, роль для них не нужна, каждая стоит 1 действие. ${unlocked.map(([operationId]) => operationLine(operationId)).join(" · ")}`,
    });
  } else {
    for (const [operationId, districts] of unlocked) {
      const grey = greyOperationInfo[operationId];
      const label = greyOperationLabels[operationId] ?? operationId;
      const effect = grey.effect(game.round_number, meta);
      hints.push({
        kind: "grey",
        icon: "🌒",
        title: label,
        detail: `${effect} · шанс от ${grey.chance}%`,
        ready: active,
        tooltip: `Серая операция «${label}» открыта любому владельцу активного объекта районов: ${districts.map(districtTitle).join(", ")}. Роль для неё не нужна. Стоит 1 действие. Эффект при успехе: ${effect}. Базовый шанс ${grey.chance}%, у Афериста выше. ${grey.failure}`,
      });
    }
  }

  for (const gate of assetGatedPowers) {
    if (gate.asset ? gate.asset !== asset.id : gate.district !== asset.district) continue;
    const label = powerLabels[gate.power] ?? gate.power;
    const owns = hasRole(gate.role);
    hints.push({
      kind: "power",
      icon: "✴",
      title: label,
      detail: owns ? gate.detail : `нужна роль «${roleTitle(gate.role)}»`,
      ready: active && owns,
      tooltip: `Способность «${label}» роли «${roleTitle(gate.role)}» работает только при ${gate.asset ? "этом объекте" : `активном объекте района «${districtTitle(gate.district)}»`}: ${gate.detail}.`,
    });
  }

  // With every slot taken, money only becomes points through a swap, and the swap is invisible: the
  // refund equals the points the outgoing object was worth, so the gain is purely the difference.
  if (options?.market && owner.assets.length >= owner.capacity) {
    const owned = owner.assets
      .map(item => assets.get(item.card_id))
      .filter((item): item is AssetMeta => Boolean(item));
    const weakest = owned.reduce<AssetMeta | null>(
      (worst, item) => (worst === null || assetPoints(item) < assetPoints(worst) ? item : worst),
      null,
    );
    const gain = weakest ? assetPoints(asset) - assetPoints(weakest) : 0;
    if (weakest && gain > 0) {
      hints.push({
        kind: "upgrade",
        icon: "⇄",
        title: `Замена «${weakest.title}»`,
        detail: `+${gain} очков · продажа вернёт ${assetPoints(weakest)}$`,
        ready: false,
        tooltip: `Слоты заняты, поэтому это единственный способ доложить очков за деньги: продайте «${weakest.title}» (${assetPoints(weakest)} очков, столько же вернётся деньгами, продажа бесплатна и не тратит действие) и купите этот объект за ${asset.cost}$ — чистыми +${gain} очков за одно действие покупки.`,
      });
    }
  }

  for (const project of boardProjectsFor(asset, game, meta)) {
    hints.push({
      kind: "project",
      icon: "🏗️",
      title: project.title,
      detail: `${project.points} очков · ${projectRequirementText(project, meta)}`,
      ready: false,
      tooltip: `Проект «${project.title}» с доски требует: ${projectRequirementText(project, meta)}. Этот объект в условие входит. Награда: ${project.points} очков и ${projectPerkText(project)}.`,
    });
  }

  return { special: unlocked.length > 0, hints };
}

// Projects on the board whose condition names this object's tag or district. Conditions counting
// districts in the abstract (`distinct_districts`, `district_depth`) are left out on purpose: every
// object feeds them somehow, so listing those would put the same two lines on all 71 cards.
function boardProjectsFor(asset: AssetMeta, game: GameState, meta: CityMeta): ProjectMeta[] {
  return game.project_board
    .map(projectId => meta.projects.find(item => item.id === projectId))
    .filter((project): project is ProjectMeta => {
      const requirement = project?.requirement;
      if (!requirement) return false;
      if (requirement.type === "tag_objects") return Boolean(requirement.tag && asset.tags.includes(requirement.tag));
      if (requirement.type === "district_objects") return requirement.district === asset.district;
      return false;
    })
    .sort((left, right) => right.points - left.points)
    .slice(0, 3);
}

export function activeBonuses(player: PlayerState, meta: CityMeta, assets: Map<string, AssetMeta>): { text: string; active: boolean }[] {
  const role = meta.roles.find(item => item.id === player.role);
  const result: { text: string; active: boolean }[] = [
    role
      ? { text: `Роль «${role.title}»: ${role.passive}`, active: true }
      : { text: "Роль отсутствует.", active: false },
  ];
  for (const district of meta.districts) {
    const count = districtCount(player, district.id, assets);
    if (count >= 2) result.push({ text: `${district.title}: ${count}/4 объекта, районная синергия активна.`, active: true });
    if (count >= 4) result.push({ text: `${district.title}: район собран полностью — эпические и легендарные объекты района приносят влияние каждый раунд.`, active: true });
  }
  if (player.debt > 0) result.push({ text: `Мостовой кредит: −${player.debt}$ при ближайшей выплате.`, active: false });
  // One token, three jobs: the merged rule only reads as a rule if the panel states all three.
  if (player.roofs > 0) {
    result.push({
      text: `Крыша (${player.roofs}): погасит следующую атаку — перехват роли, слив компромата или начисление скандалов.`,
      active: true,
    });
  }
  // A finished project can neither be blocked nor confiscated, so its perk is always on.
  for (const projectId of player.projects) {
    const project = meta.projects.find(item => item.id === projectId);
    if (project) result.push({ text: `Проект «${project.title}»: ${project.points} очков, ${projectPerkText(project)}.`, active: true });
  }
  return result;
}

