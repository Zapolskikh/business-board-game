import type {
  ActionMeta,
  AssetMeta,
  CityMeta,
  DistrictMeta,
  GameState,
  GreyTable,
  GreyTier,
  LegalAction,
  MarketAsset,
  PlayerState,
  ProjectMeta,
  RoleMeta,
  RoomView,
  ScoringMeta,
} from "../../online/types";

/* Фикстуры для /dev-галереи и юнит-тестов.
 *
 * Смысл: состояния доски (нет слота, не хватает денег, объект уходит, не ваш ход,
 * действия кончились) в живой партии достигаются игрой на двадцать минут с подгадыванием.
 * Здесь они достижимы за один клик, и те же данные идут в Vitest.
 *
 * Значения списаны с backend/city_engine/content/catalog.json и constants.py, чтобы
 * длины строк и порядок величин были честными.
 */

export const districts: DistrictMeta[] = [
  { id: "residential", title: "Спальный район", icon: "🏘️", color: "#8fc4d8", description: "Жильё и сервис." },
  { id: "business", title: "Деловой центр", icon: "🏙️", color: "#d9bd78", description: "Офисы и финансы." },
  { id: "industrial", title: "Промзона", icon: "🏭", color: "#d9a17e", description: "Логистика и производство." },
  { id: "tech", title: "Технокластер", icon: "🧠", color: "#bca1d9", description: "Технологии и данные." },
  { id: "government", title: "Административный квартал", icon: "🏛️", color: "#9aaee6", description: "Власть и регламент." },
  { id: "shadows", title: "Серый сектор", icon: "🌒", color: "#ca91a4", description: "То, о чём не пишут." },
];

export const roles: RoleMeta[] = [
  { id: "capitalist", title: "Капиталист", icon: "💼", color: "#d9bd78", passive: "+1$ за каждый свой активный объект; Деловой центр +1$ к доходу; +1◆ за раунд за каждый свой объект Промзоны.", power: "Поставить метку (1 действие и 1 скандал, метка одна): помеченная карта рынка работает на вас как своя — доход, синергия, условия проектов и серые операции, — но остаётся в продаже и очков не приносит.", districts: ["business"] },
  { id: "politician", title: "Политик", icon: "🏛️", color: "#9aaee6", passive: "Административный квартал +1$ к доходу; +1◆ за раунд за каждый жилой объект на столе, включая чужие.", power: "Урегулировать скандал: 1 действие и 2◆ → −1 свой скандал. Право вето (без действия, раз в ход): проект на доске закрыт для всех, кроме вас.", districts: ["government"] },
  { id: "journalist", title: "Журналист", icon: "📰", color: "#8fc7aa", passive: "+1$ за каждый чужой скандал в конце раунда, если есть хотя бы один свой объект Делового центра, — без него чужие скандалы денег не дают; +1◆ за каждый свой скандал, если есть хотя бы один свой объект Спального района, — потолка нет, без жилого объекта рейтинг не платит вовсе; роль теряется на 6 скандалах вместо 5. Своего района у роли нет.", power: "Раздуть историю (без действия, раз в ход): +1 скандал вам и цели; Защита цели гасит эффект целиком, тогда и своего скандала не будет. Публикация (раз в ход): 1 действие и 3◆ → +2 скандала цели, Защита гасит и её.", districts: [] },
  { id: "fraudster", title: "Аферист", icon: "🎭", color: "#c0a2dc", passive: "4 действия за ход; +30% к шансу любой серой операции без условий; Технокластер +1$.", power: "Криптоскам (1 действие, раз в ход, нужна своя «Городская криптобиржа»): забрать 25% денег у каждого соперника — Защита защищает своего владельца — и получить 5 скандалов. Очистка следов: 1 действие → −1 свой скандал, можно повторять.", districts: ["tech"] },
  { id: "mafia", title: "Мафиози", icon: "🔪", color: "#d4939a", passive: "Серый сектор +1$; Защита на 1$ дешевле и предел хранения 2 вместо 1.", power: "Рэкет (1 действие, раз в ход, нужен свой объект Серого сектора): 2$ + 2$ за каждый свой объект Серого сектора + ⌊раунд/3⌋ (+5$ если цель лидер) и 1◆ за каждый свой объект Административного квартала; Защита цели отменяет рэкет. Замять дело: 1 действие, 3$ и свой административный объект → −2 своих скандала. Серая метка (1 Защита, без действия, раз в ход): слот рынка до конца раунда закрыт для всех, кроме вас.", districts: ["shadows"] },
  { id: "military", title: "Силовик", icon: "⚖️", color: "#aab5bd", passive: "Промзона +1$; санкция читает счётчик скандалов соперника.", power: "Санкции (1 действие, раз в ход) по числу скандалов цели: 2 — деньги, 3 — деньги и влияние, 4 — деньги, влияние и снятие роли; Защита цели отменяет санкцию целиком. Проверка (1 действие): по скандалу каждому сопернику с объектом Серого сектора, Защита гасит. Отобрать Защиту (1 действие и 3◆): одна Защита соперника переходит к вам, Защита от этого не защищает.", districts: ["industrial"] },
];

export const assets: AssetMeta[] = [
  { id: "flex_offices", title: "Сеть гибких офисов", district: "business", rarity: "common", cost: 5, income: 2, influence: 1, points: 2, text: "Доступный доход и 1 влияние при покупке.", tags: ["finance"] },
  { id: "planning_charter", title: "Градостроительная хартия", district: "government", rarity: "legendary", cost: 16, income: 1, influence: 2, points: 8, text: "Раз за партию: взять городской проект без выполнения условия. Цену и действие платите как обычно.", tags: ["government"], effects: { projectWaiver: 1, synergyInfluence: 1 } },
  { id: "insurance", title: "Страховое агентство", district: "business", rarity: "uncommon", cost: 7, income: 3, influence: 0, points: 3, text: "+1$ за каждый ваш объект Делового центра.", tags: ["finance"] },
  { id: "invest_fund", title: "Инвестиционный фонд", district: "business", rarity: "rare", cost: 8, income: 3, influence: 1, points: 4, text: "+1$ за каждый ваш объект Делового центра. Синергия 4+: +1◆ каждый раунд.", tags: ["finance"] },
  { id: "auto_warehouse", title: "Автоматизированный склад", district: "industrial", rarity: "uncommon", cost: 5, income: 2, influence: 0, points: 2, text: "Простой стабильный доход без условий.", tags: ["logistics"] },
  { id: "datacenter", title: "Центр обработки данных", district: "tech", rarity: "epic", cost: 12, income: 3, influence: 0, points: 6, text: "Открывает серую операцию «Взлом». Синергия 4+: +1◆ каждый раунд.", tags: ["tech"] },
  { id: "coworking", title: "Коворкинг стартапов", district: "tech", rarity: "common", cost: 5, income: 2, influence: 1, points: 2, text: "Разовое влияние при покупке.", tags: ["tech"] },
  { id: "city_ecosystem", title: "Городская экосистема", district: "government", rarity: "legendary", cost: 16, income: 0, influence: 2, points: 8, text: "+2◆ за раунд. Синергия 4+: +1◆ каждый раунд.", tags: ["administration"] },
  { id: "media_net", title: "Городская медиасеть", district: "residential", rarity: "uncommon", cost: 7, income: 1, influence: 0, points: 3, text: "+1◆ за раунд, если есть объект Административного квартала.", tags: ["media"] },
  { id: "pawnshops", title: "Ломбардная сеть", district: "shadows", rarity: "rare", cost: 9, income: 2, influence: 0, points: 4, text: "Открывает «Вброс» и «Пробить защиту».", tags: ["shadow"] },
  { id: "industrial_cluster", title: "Промышленный кластер", district: "industrial", rarity: "epic", cost: 13, income: 3, influence: 0, points: 6, text: "+1$ за каждый связанный район. Синергия 4+: +1◆ каждый раунд.", tags: ["production", "infrastructure"], effects: { districtLinks: [{ district: "residential", value: 1 }, { district: "business", value: 1 }, { district: "shadows", value: 1 }], synergyInfluence: 1 } },
  { id: "city_management_centre", title: "Центр городского управления", district: "government", rarity: "epic", cost: 12, income: 1, influence: 2, points: 6, text: "+1$ за каждый связанный район. Синергия 4+: +1◆ каждый раунд.", tags: ["government", "infrastructure"], effects: { districtLinks: [{ district: "residential", value: 1 }, { district: "business", value: 1 }, { district: "industrial", value: 1 }, { district: "tech", value: 1 }], synergyInfluence: 1 } },
  { id: "regulator", title: "Федеральное агентство развития", district: "government", rarity: "epic", cost: 12, income: 2, influence: 3, points: 6, text: "+1$ за Политика и +2$ при наличии объекта Делового центра. Синергия 4+: +1◆ каждый раунд.", tags: ["government", "finance"], effects: { roleBonus: { role: "politician", value: 1 }, districtBonus: { district: "business", value: 2 }, synergyInfluence: 1 } },
];

export const projects: ProjectMeta[] = [
  { id: "metro", title: "Линия метро", text: "Метро связывает город: нужны объекты в трёх разных районах.", cost_influence: 5, cost_money: 6, points: 8, requirement: { type: "distinct_districts", count: 3 }, perk: {} },
  { id: "archive", title: "Городской архив", text: "Архив собирает документы из двух районов сразу.", cost_influence: 3, cost_money: 3, points: 5, requirement: { type: "distinct_districts", count: 2 }, perk: {} },
  { id: "dominant", title: "Городская доминанта", text: "Небоскрёб ставят там, где у одного владельца уже четыре объекта.", cost_influence: 5, cost_money: 8, points: 8, requirement: { type: "district_depth", count: 4 }, perk: { influence: 1 } },
  { id: "social_housing", title: "Социальное жильё", text: "Городская программа расселения: нужен серьёзный жилой портфель.", cost_influence: 4, cost_money: 3, points: 7, requirement: { type: "district_objects", district: "residential", count: 3 }, perk: {} },
];

export const actionCards: ActionMeta[] = [
  { id: "data_leak", title: "Утечка данных", tone: "attack", text: "Цель получает 1 скандал.", kind: "scandal", value: 1, targeted: true },
  { id: "urgent_credit", title: "Срочный кредит", tone: "resource", text: "Вы получаете +5$.", kind: "money", value: 5 },
];

const scoring: ScoringMeta = {
  lobbying_influence: 10,
  lobbying_points: 6,
  project_board_size: 4,
  project_reroll_money: 10,
  market_rotation_size: 3,
  patronage_money: 20,
  patronage_points: 5,
  crisis_pr_influence: 3,
  action_card_cost: 4,
  card_discard_money: 2,
  card_discard_influence: 1,
  campaign_tiers: [{ spend: 5, gain: 3 }],
  grey_die_sides: 6,
  grey_roll_cap: 3,
  fraudster_grey_roll: 1,
  mafia_grey_roll_per_object: 1,
  mafia_grey_roll_max: 2,
  underdog_influence: 1,
  capacity_costs: { "3": 7, "4": 12, "5": 18 },
  capacity_influence: { "3": 0, "4": 1, "5": 3 },
  grey_faces: fixtureGreyFaces(),
  max_capacity: 6,
};

export const meta: CityMeta = {
  content_version: "city-content-2026-08-26b",
  scoring,
  districts,
  roles,
  assets,
  action_cards: actionCards,
  projects,
};

export const assetIndex = new Map(assets.map(asset => [asset.id, asset]));

function player(overrides: Partial<PlayerState> & Pick<PlayerState, "id" | "name">): PlayerState {
  return {
    is_bot: true,
    difficulty: "expert",
    preferred_role: null,
    money: 10,
    influence: 4,
    scandals: 0,
    roofs: 0,
    roof_limit: 2,
    scandal_limit: 5,
    role: null,
    jail_turns: 0,
    assets: [],
    projects: [],
    capacity: 3,
    debt: 0,
    zoning_district: null,
    turns: 5,
    ...overrides,
  };
}

export const ME = "p-me";

const basePlayers: PlayerState[] = [
  player({ id: "p-bot4", name: "Bot 4", difficulty: "expert", role: "politician", money: 8, influence: 3, scandals: 2, turns: 6, assets: [
    { uid: "o-1", card_id: "city_ecosystem" },
    { uid: "o-2", card_id: "media_net" },
    { uid: "o-3", card_id: "insurance" },
  ], projects: ["metro"] }),
  player({ id: "p-bot2", name: "Bot 2", role: "fraudster", money: 6, influence: 5, scandals: 4, turns: 6, assets: [
    { uid: "o-4", card_id: "pawnshops" },
    { uid: "o-5", card_id: "coworking" },
  ] }),
  player({
    id: ME,
    name: "Вы",
    is_bot: false,
    role: "journalist",
    roof_limit: 2,
    // Журналисту движок даёт шестой скандал — именно это клиент не должен зашивать как «/5».
    scandal_limit: 6,
    roofs: 1,
    money: 14,
    influence: 7,
    scandals: 1,
    turns: 6,
    hand: [
      { uid: "h-1", card_id: "data_leak" },
      { uid: "h-2", card_id: "urgent_credit" },
    ],
    assets: [
      { uid: "o-6", card_id: "flex_offices" },
      { uid: "o-7", card_id: "insurance" },
      { uid: "o-8", card_id: "coworking" },
    ],
    projects: ["archive", "social_housing"],
  }),
  // Стресс-кейс левой колонки: длинная роль, пять объектов и предупреждение третьей строкой.
  player({ id: "p-bot3", name: "Bot 3", difficulty: "expert", role: "mafia", money: 11, influence: 4,
    roofs: 2, scandals: 4, capacity: 6, turns: 5, assets: [
      { uid: "o-9", card_id: "auto_warehouse" },
      { uid: "o-10", card_id: "pawnshops" },
      { uid: "o-11", card_id: "coworking" },
      { uid: "o-12", card_id: "insurance" },
      { uid: "o-13", card_id: "media_net" },
    ] }),
];

const baseMarket: MarketAsset[] = [
  { uid: "m-1", card_id: "invest_fund", price: 8, claimed_by: "p-bot4" },
  { uid: "m-2", card_id: "auto_warehouse", price: 5, leaving: true },
  { uid: "m-3", card_id: "datacenter", price: 12, leaving: true },
  { uid: "m-4", card_id: "city_ecosystem", price: 16 },
  { uid: "m-5", card_id: "media_net", price: 7, leaving: true },
  { uid: "m-6", card_id: "pawnshops", price: 9, locked_by: "p-bot3", locked_round: 7 },
];

// Таблицы граней для книги правил — как их отдаёт /meta (scoring.grey_faces).
function fixtureGreyFaces(): NonNullable<ScoringMeta["grey_faces"]> {
  const byThird = (rows: number[][], key: string) => rows.map(row => row.map(value => ({ [key]: value })));
  const flat = (make: (face: number) => Record<string, number | boolean>) => [0, 1, 2].map(() => [1, 2, 3, 4, 5, 6].map(make));
  return {
    smear: { scandals: [2, 1, 1, 1, 1, 0], effects: flat(face => ({ scandal_each: face >= 3 ? 1 : 0, influence_per_hit: [0, 0, 1, 1, 2, 2][face - 1] })) },
    crypto: { scandals: [2, 1, 1, 1, 1, 0], effects: byThird([[0, 0, 1, 1, 2, 3], [0, 0, 2, 2, 4, 6], [0, 0, 4, 4, 6, 8]], "money_each") },
    datacenter: { scandals: [2, 1, 1, 1, 1, 0], effects: byThird([[0, 0, 1, 1, 2, 3], [0, 0, 2, 2, 3, 5], [0, 0, 3, 3, 5, 7]], "influence") },
    influence_broker: {
      scandals: [2, 1, 1, 1, 1, 0],
      effects: flat(face => ({ target_scandals: [0, 0, 2, 2, 0, 0][face - 1], strip_role: face >= 5, influence: [0, 0, 1, 1, 2, 3][face - 1] })),
    },
    roof_break: { scandals: [2, 1, 1, 0, 0, 0], effects: flat(face => ({ strip_roofs: face >= 3, influence_per_roof: [0, 0, 0, 0, 1, 2][face - 1] })) },
  };
}

// Таблицы граней серых операций такими, какими их прислал бы движок в середине партии игроку с +1
// (аферист): грань 1 читается как 2, шестёрка — дважды.
function fixtureGreyTables(): GreyTable[] {
  const scandals = [2, 1, 1, 1, 1, 0];
  const tier = (face: number): GreyTier => (face <= 2 ? "fail" : face <= 4 ? "weak" : "full");
  const effects: Record<string, (face: number) => Record<string, number | boolean>> = {
    smear: face => ({ scandal_each: face >= 3 ? 1 : 0, influence_per_hit: [0, 0, 1, 1, 2, 2][face - 1] }),
    crypto: face => ({ money_each: [0, 0, 2, 2, 4, 6][face - 1] }),
    datacenter: face => ({ influence: [0, 0, 2, 2, 3, 5][face - 1] }),
    influence_broker: face => ({
      target_scandals: [0, 0, 2, 2, 0, 0][face - 1],
      strip_role: face >= 5,
      influence: [0, 0, 1, 1, 2, 3][face - 1],
    }),
    roof_break: face => ({ strip_roofs: face >= 3, influence_per_roof: [0, 0, 0, 0, 1, 2][face - 1] }),
  };
  return Object.entries(effects).map(([asset_id, effect]) => ({
    asset_id,
    unlocked: asset_id !== "influence_broker",
    targeted: asset_id === "datacenter" || asset_id === "influence_broker",
    modifier: 1,
    sources: [{ source: "fraudster", value: 1 }],
    third: 1,
    rows: [1, 2, 3, 4, 5, 6].map(roll => {
      const face = Math.min(6, roll + 1);
      const rowScandals = (asset_id === "roof_break" ? [2, 1, 1, 0, 0, 0] : scandals)[face - 1];
      return { roll, face, tier: tier(face), scandals: rowScandals, effect: effect(face) };
    }),
  }));
}

export function makeGame(overrides: Partial<GameState> = {}): GameState {
  const players = overrides.players ?? basePlayers.map(item => ({ ...item }));
  return {
    game_id: "g-fixture",
    revision: 42,
    status: "playing",
    max_rounds: 15,
    role_price: 4,
    round_number: 6,
    current_player_index: players.findIndex(item => item.id === ME),
    actions_left: 2,
    // Цена Защиты растёт с раундом; в шестом раунде движок отдаёт 5$.
    roof_price: 5,
    turn_order: players.map(item => item.id),
    turns_taken_in_round: 2,
    turn_serial: 21,
    players,
    market: baseMarket.map(item => ({ ...item })),
    project_board: ["metro", "archive", "dominant", "social_housing"],
    project_progress: {
      metro: { binary: false, met: true, have: 3, needed: 3 },
      archive: { binary: false, met: true, have: 3, needed: 2 },
      dominant: { binary: false, met: false, have: 2, needed: 4 },
      social_housing: { binary: false, met: false, have: 1, needed: 3 },
    },
    // Меценатство и публикация уже потрачены в этом ходу — полоска «уже потрачено» это покажет.
    turn_flags: { patronage: true, card_played: false },
    event_log: [
      { seq: 61, type: "city_project_taken", actor_id: "p-bot4", data: { project_id: "metro", points: 8 } },
      { seq: 62, type: "grey_operation", actor_id: "p-bot2", data: { asset_id: "crypto", success: true } },
      { seq: 63, type: "asset_bought", actor_id: ME, data: { card_id: "insurance", price: 7 } },
    ],
    grey_tables: fixtureGreyTables(),
    market_deck_count: 63,
    action_deck_count: 41,
    project_deck_count: 36,
    score_breakdown: {
      "p-bot4": { assets: 14, projects: 8, role: 1, scandals: -2, total: 24 },
      "p-bot2": { assets: 6, projects: 3, role: 1, scandals: -4, total: 15 },
      [ME]: { assets: 7, projects: 13, role: 0, scandals: -5, total: 18 },
      "p-bot3": { assets: 2, projects: 0, role: 0, scandals: 0, total: 12 },
    },
    round_forecast: {
      money: { objects: 5, projects: 4, residents_tax: 1, journalist: 2, debt: 0, total: 12 },
      influence: { objects: 0, administrative: 0, projects: 1, synergy: 0, news: 1, rating: 0, total: 2 },
      passive: { roofs: 1, scandals: -1 },
    },
    ...overrides,
  };
}

const buy = (uid: string): LegalAction => ({ type: "buy_asset", payload: { market_uid: uid } });
const act = (type: string, payload: Record<string, unknown> = {}): LegalAction => ({ type, payload });

/** Полный набор действий «богатого хода»: чтобы правая панель светилась целиком. */
function richLegal(game: GameState): LegalAction[] {
  const rivals = game.players.filter(player => player.id !== ME);
  return [
    act("end_turn"),
    act("basic_action", { kind: "work" }),
    act("basic_action", { kind: "campaign", spend: 5 }),
    act("basic_action", { kind: "lobbying" }),
    act("buy_roof"),
    act("crisis_pr"),
    act("buy_capacity"),
    act("reroll_projects"),
    act("buy_action_card"),
    act("city_project", { project_id: "metro" }),
    act("city_project", { project_id: "archive" }),
    ...game.market.map(item => buy(item.uid)),
    ...(game.players.find(player => player.id === ME)?.assets ?? []).map(owned =>
      act("sell_asset", { asset_uid: owned.uid }),
    ),
    ...(game.players.find(player => player.id === ME)?.hand ?? []).flatMap(held => [
      act("convert_action_card", { card_uid: held.uid, into: "money" }),
      act("convert_action_card", { card_uid: held.uid, into: "influence" }),
    ]),
    ...rivals.map(rival => act("play_action_card", { card_uid: "h-1", target_id: rival.id })),
    // Журналист: обе способности с выбором цели.
    ...rivals.flatMap(rival => [
      act("use_role_power", { power: "journalist_inflate", target_id: rival.id }),
      act("use_role_power", { power: "journalist_publish", target_id: rival.id }),
    ]),
    act("grey_operation", { asset_id: "smear" }),
    act("grey_operation", { asset_id: "crypto" }),
    ...(rivals.some(rival => rival.roofs > 0) ? [act("grey_operation", { asset_id: "roof_break" })] : []),
    ...rivals.map(rival => act("grey_operation", { asset_id: "datacenter", target_id: rival.id })),
    act("claim_role", { role_id: "capitalist" }),
    act("claim_role", { role_id: "mafia" }),
  ];
}

export function makeRoom(overrides: Partial<RoomView> = {}): RoomView {
  const game = overrides.game ?? makeGame();
  return {
    id: "room-fixture",
    name: "Вечерняя партия",
    status: "playing",
    revision: game?.revision ?? 42,
    players: 4,
    humans: 1,
    capacity: 4,
    updated_at: "2026-08-27T18:00:00Z",
    seats: [],
    game,
    // Ровно то, что вернул бы движок для этой позиции: у «Вы» 14$ и 3 из 3 слотов заняты,
    // поэтому покупок нет ни одной — все шесть карточек должны объяснить почему.
    legal_actions: [{ type: "end_turn", payload: {} }],
    ...overrides,
  };
}

/** Именованные позиции для галереи. Каждая ставит карточки рынка в нужное состояние. */
export const scenarios = {
  "Слоты заняты": makeRoom(),

  "Максимум текста": (() => {
    const market: MarketAsset[] = [
      { uid: "stress-1", card_id: "industrial_cluster", price: 13 },
      { uid: "stress-2", card_id: "city_management_centre", price: 12 },
      { uid: "stress-3", card_id: "regulator", price: 12 },
      { uid: "stress-4", card_id: "industrial_cluster", price: 13 },
      { uid: "stress-5", card_id: "city_management_centre", price: 12 },
      { uid: "stress-6", card_id: "regulator", price: 12 },
    ];
    const game = makeGame({
      market,
      players: basePlayers.map(item => item.id === ME ? {
        ...item,
        role: "politician",
        capacity: 6,
        assets: [
          { uid: "stress-owned-1", card_id: "city_management_centre" },
          { uid: "stress-owned-2", card_id: "industrial_cluster" },
          { uid: "stress-owned-3", card_id: "regulator" },
          { uid: "stress-owned-4", card_id: "media_net" },
          { uid: "stress-owned-5", card_id: "flex_offices" },
          { uid: "stress-owned-6", card_id: "coworking" },
        ],
      } : { ...item }),
    });
    return makeRoom({ game, legal_actions: [{ type: "end_turn", payload: {} }] });
  })(),

  /* Хартия в городе и её заряд не потрачен: 📜 на карте объекта и на проекте, который можно
   * взять только по ней. Обычное «Взять» у такого проекта погашено. */
  "Хартия заряжена": makeRoom({
    game: makeGame({
      players: basePlayers.map(item =>
        item.id === ME
          ? { ...item, capacity: 4, project_waiver_ready: true, assets: [...item.assets, { uid: "o-charter", card_id: "planning_charter" }] }
          : { ...item },
      ),
    }),
    legal_actions: [
      { type: "city_project", payload: { project_id: "dominant", use_waiver: true } },
      { type: "city_project", payload: { project_id: "archive" } },
      { type: "end_turn", payload: {} },
    ],
  }),

  "Есть свободный слот": makeRoom({
    game: makeGame({
      players: basePlayers.map(item =>
        item.id === ME ? { ...item, capacity: 5, money: 14 } : { ...item },
      ),
    }),
    legal_actions: [buy("m-1"), buy("m-2"), buy("m-5"), buy("m-6"), { type: "end_turn", payload: {} }],
  }),

  "Богатый ход": (() => {
    const game = makeGame({
      actions_left: 3,
      turn_flags: {},
      players: basePlayers.map(item =>
        item.id === ME ? { ...item, capacity: 6, money: 60, influence: 24 } : { ...item },
      ),
    });
    return makeRoom({ game, legal_actions: richLegal(game) });
  })(),

  "Действия кончились": makeRoom({
    game: makeGame({
      actions_left: 0,
      players: basePlayers.map(item => (item.id === ME ? { ...item, capacity: 6 } : { ...item })),
    }),
    legal_actions: [{ type: "end_turn", payload: {} }],
  }),

  /* Способности с целью и без: таблица «цель — результат» у санкций, подтверждение проверки
   * Числа превью — как их прислал бы движок. */
  "Силовик: способности": (() => {
    const players = basePlayers.map(item =>
      item.id === ME ? { ...item, role: "military", scandal_limit: 5, influence: 9 } : { ...item },
    );
    const rivals = players.filter(item => item.id !== ME);
    const game = makeGame({
      actions_left: 3,
      turn_flags: {},
      players,
      power_previews: [
        ...rivals.map(rival => ({
          power: "military_sanction",
          target_id: rival.id,
          blocked_by_roof: rival.roofs > 0,
          money: Math.min(rival.money, 9),
          influence: rival.scandals >= 4 ? Math.min(rival.influence, 3) : 0,
          strips_role: rival.scandals >= 5 && Boolean(rival.role),
        })),
        // Проверка: в Сером секторе стоят двое, у одного из них Защита.
        { power: "military_inspection", target_id: "p-bot2", blocked_by_roof: false, scandals: 1 },
        { power: "military_inspection", target_id: "p-bot3", blocked_by_roof: true, scandals: 1 },
        { power: "military_inspection", target_id: "p-bot4", blocked_by_roof: false },
      ],
    });
    return makeRoom({
      game,
      legal_actions: [
        ...rivals.filter(rival => rival.scandals >= 2).map(rival =>
          act("use_role_power", { power: "military_sanction", target_id: rival.id })),
        act("use_role_power", { power: "military_inspection" }),
        { type: "end_turn", payload: {} },
      ],
    });
  })(),

  "Ход соперника": makeRoom({
    game: makeGame({ current_player_index: 1, actions_left: 3 }),
    legal_actions: [],
  }),

  "Партия окончена": makeRoom({
    status: "finished",
    game: makeGame({
      status: "finished",
      round_number: 15,
      actions_left: 0,
      final_scores: { "p-bot4": 61, "p-bot2": 48, [ME]: 57, "p-bot3": 33 },
    }),
    legal_actions: [],
  }),
} satisfies Record<string, RoomView>;

export type ScenarioName = keyof typeof scenarios;
