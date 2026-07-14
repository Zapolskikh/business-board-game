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

export function describeEvent(event: DomainEvent, game: GameState, meta: CityMeta): string {
  const actor = game.players.find(player => player.id === event.actor_id)?.name;
  const data = event.data;
  const prefix = actor ? `${actor} ` : "";
  const assetId = stringValue(data.asset_id);
  const cardId = stringValue(data.card_id);
  const roleId = stringValue(data.role_id);
  const targetId = stringValue(data.target_id);
  const target = game.players.find(player => player.id === targetId)?.name;
  const asset = meta.assets.find(item => item.id === assetId)?.title;
  const card = meta.action_cards.find(item => item.id === cardId)?.title;
  const role = meta.roles.find(item => item.id === roleId)?.title;
  if (event.type === "asset_bought") return `${prefix}покупает «${asset ?? assetId}» за ${data.cost ?? "?"}$`;
  if (event.type === "asset_sold") return `${prefix}продаёт «${asset ?? assetId}» за ${data.value ?? data.money ?? "?"}$`;
  if (event.type === "action_card_bought") return `${prefix}покупает карту «${card ?? cardId}»`;
  if (event.type === "action_card_played") return `${prefix}разыгрывает «${card ?? cardId}»${target ? ` против ${target}` : ""}`;
  if (event.type === "role_claimed" || event.type === "role_taken") return `${prefix}${eventVerbs[event.type]} «${role ?? roleId}»`;
  if (event.type === "basic_action") return `${prefix}${data.kind === "work" ? "берёт городской заказ" : "проводит кампанию"}`;
  if (event.type === "round_settled") return `Выплаты за раунд ${data.round_number}`;
  if (event.type === "turn_started") return `${prefix}начинает ход · раунд ${data.round_number}`;
  if (event.type === "turn_ended") return `${prefix}завершает ход`;
  if (event.type === "game_finished") return `Партия завершена · победитель ${game.players.find(player => player.id === data.winner_id)?.name ?? "определён"}`;
  const verb = eventVerbs[event.type] ?? event.type.split("_").join(" ");
  return `${prefix}${verb}`;
}

export function activeBonuses(player: PlayerState, game: GameState, meta: CityMeta, assets: Map<string, AssetMeta>): string[] {
  const role = meta.roles.find(item => item.id === player.role);
  const event = meta.events.find(item => item.id === game.event_id);
  const result = [
    role ? `Роль «${role.title}»: ${role.passive}` : "Роль отсутствует.",
    event ? `Событие «${event.title}»: ${event.text}` : "Город работает в обычном режиме.",
  ];
  for (const district of meta.districts) {
    const count = districtCount(player, district.id, assets);
    const level = player.district_levels[district.id] ?? 0;
    if (count >= 2) result.push(`${district.title}: ${count}/4 объекта, районная синергия активна.`);
    if (level > 0) result.push(`${district.title}: развитие ${"★".repeat(level)}${"☆".repeat(2 - level)}, +${level * 25}% к базовому доходу.`);
  }
  if (player.debt > 0) result.push(`Мостовой кредит: −${player.debt}$ при ближайшей выплате.`);
  if (player.role_shields > 0) result.push(`Судебный запрет защитит роль: ${player.role_shields}.`);
  if (player.scandal_shields > 0) result.push(`Репутационный резерв отменит следующее получение скандалов.`);
  if (player.copied_role) result.push(`Временный мандат: ${meta.roles.find(item => item.id === player.copied_role)?.title ?? player.copied_role}.`);
  result.push(`Содержание бизнеса: −${Math.max(0, player.assets.length - maintenanceReduction(player, assets))}$ в конце раунда.`);
  return result;
}

function maintenanceReduction(player: PlayerState, assets: Map<string, AssetMeta>): number {
  return player.assets.reduce((sum, item) => {
    if (item.blocked) return sum;
    const value = assets.get(item.card_id)?.effects?.maintenanceReduction;
    return sum + numberValue(value);
  }, 0);
}
