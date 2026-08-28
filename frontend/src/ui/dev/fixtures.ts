import type {
  ActionMeta,
  AssetMeta,
  CityMeta,
  DistrictMeta,
  GameState,
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
  { id: "residential", title: "Спальный район", icon: "🏘️", color: "#4fa3d1", description: "Жильё и сервис." },
  { id: "business", title: "Деловой центр", icon: "🏙️", color: "#d7aa3d", description: "Офисы и финансы." },
  { id: "industrial", title: "Промзона", icon: "🏭", color: "#b56f42", description: "Логистика и производство." },
  { id: "tech", title: "Технокластер", icon: "🧠", color: "#9b6ee7", description: "Технологии и данные." },
  { id: "government", title: "Административный квартал", icon: "🏛️", color: "#5f78c8", description: "Власть и регламент." },
  { id: "shadows", title: "Серый сектор", icon: "🌒", color: "#8a455e", description: "То, о чём не пишут." },
];

export const roles: RoleMeta[] = [
  { id: "capitalist", title: "Капиталист", icon: "💼", color: "#d4af37", passive: "+1◆ за свой объект Промзоны.", power: "Нет активной способности.", districts: ["business"] },
  { id: "politician", title: "Политик", icon: "🏛️", color: "#4f7de0", passive: "2◆ за каждый административный объект.", power: "Нет активной способности.", districts: ["government"] },
  { id: "journalist", title: "Журналист", icon: "📰", color: "#32a86a", passive: "Рейтинг 2 плюс один за жилой объект.", power: "Раздуть скандал и Публикация.", districts: [] },
  { id: "fraudster", title: "Аферист", icon: "🎭", color: "#aa68ee", passive: "+30% к шансу серых операций.", power: "Криптоскам: 25% кошельков соперников.", districts: ["shadows"] },
  { id: "mafia", title: "Мафиози", icon: "🔪", color: "#b84343", passive: "Предел Крыш 3 вместо 2.", power: "Рэкет.", districts: ["shadows"] },
  { id: "military", title: "Силовик", icon: "⚖️", color: "#70848b", passive: "Читает счётчик скандалов цели.", power: "Санкция и массовая зачистка крыш.", districts: ["government"] },
];

export const assets: AssetMeta[] = [
  { id: "flex_offices", title: "Сеть гибких офисов", district: "business", rarity: "common", cost: 5, income: 2, influence: 1, points: 2, text: "Доступный доход и 1 влияние при покупке.", tags: ["finance"] },
  { id: "insurance", title: "Страховое агентство", district: "business", rarity: "uncommon", cost: 7, income: 3, influence: 0, points: 3, text: "+1$ за каждый ваш объект Делового центра.", tags: ["finance"] },
  { id: "invest_fund", title: "Инвестиционный фонд", district: "business", rarity: "rare", cost: 8, income: 3, influence: 1, points: 4, text: "+1$ за каждый ваш объект Делового центра. Синергия 4+: +1◆ каждый раунд.", tags: ["finance"] },
  { id: "auto_warehouse", title: "Автоматизированный склад", district: "industrial", rarity: "uncommon", cost: 5, income: 2, influence: 0, points: 2, text: "Простой стабильный доход без условий.", tags: ["logistics"] },
  { id: "datacenter", title: "Центр обработки данных", district: "tech", rarity: "epic", cost: 12, income: 3, influence: 0, points: 6, text: "Открывает серую операцию «Взлом». Синергия 4+: +1◆ каждый раунд.", tags: ["tech"] },
  { id: "coworking", title: "Коворкинг стартапов", district: "tech", rarity: "common", cost: 5, income: 2, influence: 1, points: 2, text: "Разовое влияние при покупке.", tags: ["tech"] },
  { id: "city_ecosystem", title: "Городская экосистема", district: "government", rarity: "legendary", cost: 16, income: 0, influence: 2, points: 8, text: "+2◆ за раунд. Синергия 4+: +1◆ каждый раунд.", tags: ["administration"] },
  { id: "media_net", title: "Городская медиасеть", district: "residential", rarity: "uncommon", cost: 7, income: 1, influence: 0, points: 3, text: "+1◆ за раунд, если есть объект Административного квартала.", tags: ["media"] },
  { id: "pawnshops", title: "Ломбардная сеть", district: "shadows", rarity: "rare", cost: 9, income: 2, influence: 0, points: 4, text: "Открывает «Вброс» и «Пробить крышу».", tags: ["shadow"] },
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
  money_per_point: 10,
  influence_per_point: 3,
  lobbying_influence: 10,
  lobbying_points: 6,
  project_board_size: 4,
  project_reroll_money: 10,
  market_rotation_size: 3,
  patronage_money: 20,
  patronage_points: 5,
  crisis_pr_influence: 3,
  action_card_cost: 3,
  card_discard_value: 2,
  campaign_tiers: [{ spend: 5, gain: 3 }],
  grey_operation_points: { smear: 2, crypto: 2, roof_break: 2, datacenter: 3, influence_broker: 3 },
  grey_operation_chance: { smear: 0.6, crypto: 0.45, roof_break: 0.6, datacenter: 0.4, influence_broker: 0.6 },
  grey_success_scandals: 1,
  grey_failure_scandals: 2,
  hack_influence_base: 2,
  pump_drain_base: 2,
  roof_break_point_per_roof: 1,
  capacity_costs: { "3": 6, "4": 10, "5": 15 },
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
    difficulty: "medium",
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
    // Журналисту движок даёт шестой скандал — именно это раньше было зашито в клиент как «/5».
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
  player({ id: "p-bot3", name: "Bot 3", difficulty: "easy", money: 11, influence: 4, roofs: 2, jail_turns: 2, turns: 5, assets: [
    { uid: "o-9", card_id: "auto_warehouse" },
  ] }),
];

const baseMarket: MarketAsset[] = [
  { uid: "m-1", card_id: "invest_fund", price: 8 },
  { uid: "m-2", card_id: "auto_warehouse", price: 5, leaving: true },
  { uid: "m-3", card_id: "datacenter", price: 12, leaving: true },
  { uid: "m-4", card_id: "city_ecosystem", price: 16 },
  { uid: "m-5", card_id: "media_net", price: 7, leaving: true },
  { uid: "m-6", card_id: "pawnshops", price: 9 },
];

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
    // Цена Крыши растёт с раундом; в шестом раунде движок отдаёт 5$.
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
    // Патронаж и публикация уже потрачены в этом ходу — полоска «уже потрачено» это покажет.
    turn_flags: { patronage: true, card_played: false },
    event_log: [
      { seq: 61, type: "city_project_taken", actor_id: "p-bot4", data: { project_id: "metro", points: 8 } },
      { seq: 62, type: "grey_operation", actor_id: "p-bot2", data: { asset_id: "crypto", success: true } },
      { seq: 63, type: "asset_bought", actor_id: ME, data: { card_id: "insurance", price: 7 } },
    ],
    market_deck_count: 63,
    action_deck_count: 41,
    project_deck_count: 36,
    score_breakdown: {
      "p-bot4": { money: 0, influence: 1, assets: 14, projects: 8, role: 1, scandals: -2, total: 24 },
      "p-bot2": { money: 0, influence: 1, assets: 6, projects: 3, role: 1, scandals: -4, total: 15 },
      [ME]: { money: 1, influence: 2, assets: 7, projects: 13, role: 0, scandals: -5, total: 18 },
      "p-bot3": { money: 1, influence: 1, assets: 2, projects: 0, role: 0, scandals: 0, total: 12 },
    },
    round_forecast: {
      money: { objects: 5, projects: 4, residents_tax: 1, journalist: 2, debt: 0, total: 12 },
      influence: { objects: 0, administrative: 0, projects: 1, synergy: 0, news: 1, rating: 0, total: 2 },
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
    ...rivals
      .filter(rival => rival.roofs > 0)
      .map(rival => act("grey_operation", { asset_id: "roof_break", target_id: rival.id })),
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
