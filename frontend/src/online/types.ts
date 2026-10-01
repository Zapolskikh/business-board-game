// Only Claude Reborn is left; the server reads retired ids in saved games back as "expert".
export type Difficulty = "expert" | "ledger" | "oracle" | "boris";
export type RoomStatus = "waiting" | "playing" | "finished";

export interface RoomSummary {
  id: string;
  name: string;
  status: RoomStatus;
  revision: number;
  players: number;
  humans: number;
  capacity: number;
  updated_at: string;
  /** Открытое лобби: без пароля, в него попадают и через «случайную игру». */
  open?: boolean;
}

export interface RoomSeat {
  index: number;
  kind: "empty" | "human" | "bot";
  player_id: string | null;
  name: string | null;
  difficulty: Difficulty;
  preferred_role: string | null;
}

export interface OwnedAsset {
  uid: string;
  card_id: string;
}

export interface PowerGate {
  key: string;
  have: number;
  needed: number;
  met: boolean;
  district?: string;
  asset_id?: string;
}

export interface PowerStatus {
  power: string;
  available: boolean;
  spends_action: boolean;
  /** Гасит ли Крыша цели этот эффект. Все, кроме «Отобрать Крышу»: она бьёт мимо защиты. */
  blocked_by_roof: boolean;
  gates: PowerGate[];
}

// Итог применения способности к конкретной цели, посчитанный движком заранее.
// Поля появляются только те, которые эта способность вправду трогает.
export interface PowerPreview {
  power: string;
  target_id: string;
  blocked_by_roof: boolean;
  money?: number;
  influence?: number;
  scandals?: number;
  roofs?: number;
  leader_bonus?: boolean;
  self_scandals?: number;
  strips_role?: boolean;
}

export interface HeldCard { uid: string; card_id: string }
// `price` is the viewer's own price, computed by the engine (discounts are per-player).
export interface MarketAsset {
  uid: string;
  card_id: string;
  leaving?: boolean;
  price?: number;
  /** Метка капиталиста: карта работает на него, но остаётся в продаже для всех. */
  claimed_by?: string | null;
  /** Серая метка мафиози: до конца locked_round слот закрыт для всех, кроме него. */
  locked_by?: string | null;
  locked_round?: number;
  /** На сколько вырастет доход зрителя за раунд, если купить этот слот. Считает движок:
   * синергия платится за каждый объект района, и покупка поднимает уже стоящие карты. */
  preview?: AssetYield;
}

/** Деньги и влияние за раунд. */
export interface AssetYield {
  money: number;
  influence: number;
}

export interface PlayerState {
  id: string;
  name: string;
  /** Карта рынка, помеченная капиталистом: работает на него, но остаётся в продаже. */
  marked_card_id?: string | null;
  is_bot: boolean;
  difficulty: Difficulty;
  preferred_role: string | null;
  money: number;
  influence: number;
  scandals: number;
  roofs: number;
  // Engine-derived: 2 by default, 3 for the Мафия, plus any object that raises the cap.
  roof_limit: number;
  // Engine-derived too: 5 for everybody, 6 for the Журналист. The role is stripped on reaching
  // it and the arrest follows one step later.
  scandal_limit: number;
  role: string | null;
  jail_turns: number;
  assets: OwnedAsset[];
  hand?: HeldCard[];
  hand_count?: number;
  projects: string[];
  capacity: number;
  debt: number;
  zoning_district: string | null;
  turns: number;
  /** Что каждый объект приносит владельцу за раунд сейчас: uid → доля объекта в выплате. */
  asset_yields?: Record<string, AssetYield>;
}

export interface DomainEvent {
  seq: number;
  type: string;
  actor_id: string | null;
  data: Record<string, unknown>;
}

// Itemised live score, computed by the engine. The client must never re-derive the formula:
// money and influence convert at a rate now, and two implementations would drift apart.
export interface ScoreBreakdown {
  assets: number;
  projects: number;
  // Points from neither projects nor objects: the cards that buy score outright.
  bonus?: number;
  role: number;
  scandals: number;
  total: number;
}

// What settling the round right now would pay the viewer, itemised by the engine. Both rows carry
// a `total`; every other key sums to it. Without the itemisation nothing on screen adds the
// passives up, and a permanent project perk paying +1◆ a round reads as one paying nothing.
export interface RoundForecast {
  money: { objects: number; projects: number; residents_tax: number; journalist: number; debt: number; total: number };
  influence: { objects: number; administrative: number; projects: number; synergy: number; news: number; rating: number; total: number };
}

export interface GameState {
  schema_version?: number;
  rules_version?: string;
  content_version?: string;
  game_id: string;
  revision: number;
  status: "playing" | "finished";
  max_rounds: number;
  role_price: number;
  round_number: number;
  starting_player_index?: number;
  current_player_index: number;
  turn_order?: string[];
  turns_taken_in_round?: number;
  turn_serial?: number;
  actions_left: number;
  players: PlayerState[];
  market: MarketAsset[];
  /** Вето политика: id проекта → id игрока, который единственный может его взять. */
  project_veto?: Record<string, string>;
  /** Статус активных способностей своей роли: доступна ли и чего не хватает. Считает движок. */
  role_powers?: PowerStatus[];
  // Что именно снимет способность с каждой цели, посчитанное тем же кодом, что её исполняет.
  // Без этого выбор цели — гадание: списки показывают очки, но не добычу.
  power_previews?: PowerPreview[];
  // Для карт, которые больше не спрашивают район: движок сам берёт лучший и говорит сумму.
  card_previews?: Record<string, { district: string | null; money: number }>;
  project_board: string[];
  // Every perk of the viewer's role: what it pays now, the ceiling, and the district that
  // unlocks the difference. Computed by the engine — the client only prints labels.
  role_perks?: { key: string; value: number; potential?: number; needs?: string | null }[];
  // The grey die of every operation, face by face, for the viewer: their role, their cards and
  // the third of the game are already in the numbers. Computed by the engine — never here.
  grey_tables?: GreyTable[];
  // What a Крыша costs the viewer right now: the price grows with the round and the Мафия pays
  // one less. Shipped rather than derived — a client-side copy of the formula drifts.
  roof_price?: number;
  // The viewer's own standing on every board condition, counted by the engine — never here.
  project_progress?: Record<string, { binary: boolean; met: boolean; have: number; needed: number }>;
  turn_flags: Record<string, unknown>;
  event_log: DomainEvent[];
  market_deck_count: number;
  action_deck_count: number;
  project_deck_count: number;
  score_breakdown: Record<string, ScoreBreakdown>;
  round_forecast?: RoundForecast | null;
  final_scores?: Record<string, number>;
}

export interface LegalAction { type: string; payload: Record<string, unknown> }

export interface RoomView extends RoomSummary {
  seats: RoomSeat[];
  max_rounds?: number;
  role_price?: number;
  created_at?: string;
  game?: GameState | null;
  legal_actions?: LegalAction[];
  changed?: boolean;
}

export interface DistrictMeta { id: string; title: string; icon: string; color: string; description: string }
export interface RoleMeta { id: string; title: string; icon: string; color: string; passive: string; power: string; districts: string[] }
export interface AssetMeta {
  id: string;
  title: string;
  district: string;
  rarity: string;
  cost: number;
  income: number;
  influence: number;
  text: string;
  tags: string[];
  effects?: Record<string, unknown>;
  // Final-scoring points, computed by the engine (`content.asset_points`) and also what a sale pays
  // back in money. Shipped rather than derived: money buys points at 2$ each through an object and
  // at 10$ each held, and that rate is the whole late game.
  points?: number;
}
export interface ActionMeta {
  id: string;
  title: string;
  tone: string;
  text: string;
  kind: string;
  value: number;
  targeted?: boolean;
  /** Карту разрешено направить на себя — ход Журналиста. */
  self_target?: boolean;
}
export interface ProjectRequirement { type: string; count?: number; district?: string; tag?: string; role?: string }
export interface ProjectMeta {
  id: string;
  title: string;
  text: string;
  cost_influence: number;
  cost_money: number;
  points: number;
  requirement: ProjectRequirement;
  perk: Record<string, number>;
}
// Rates owned by the engine (`city_engine/constants.py`) and shipped with the catalog, so no
// client hardcodes the conversion.
export interface ScoringMeta {
  lobbying_influence: number;
  lobbying_points: number;
  project_board_size: number;
  project_reroll_money: number;
  market_rotation_size: number;
  patronage_money: number;
  patronage_points: number;
  crisis_pr_influence: number;
  action_card_cost: number;
  // What discarding a card pays back: so much money, or so much influence.
  card_discard_money?: number;
  card_discard_influence?: number;
  // One entry per campaign tier: the same action buys more influence at a worsening rate.
  campaign_tiers: { spend: number; gain: number }[];
  // The grey die. The face-by-face table of every operation comes with the game view
  // (``GameState.grey_tables``), computed for the viewer; these are what the rules quote.
  grey_die_sides?: number;
  grey_roll_cap?: number;
  fraudster_grey_roll?: number;
  mafia_grey_roll_per_object?: number;
  mafia_grey_roll_max?: number;
  // What the trailing player gets at the start of a round.
  underdog_influence?: number;
  // Every operation's die for the rules book: scandals per face, effects per face per third.
  grey_faces?: Record<string, { scandals: number[]; effects: Record<string, number | boolean>[][] }>;
  // Price of the next city slot, keyed by the capacity the player has now (JSON string keys).
  capacity_costs?: Record<string, number>;
  // The influence the same slot costs on top of the money.
  capacity_influence?: Record<string, number>;
  max_capacity?: number;
}

export interface CityMeta {
  schema_version?: number;
  content_version: string;
  scoring?: ScoringMeta;
  districts: DistrictMeta[];
  roles: RoleMeta[];
  assets: AssetMeta[];
  action_cards: ActionMeta[];
  projects: ProjectMeta[];
  /** С какого раунда карты каждой редкости попадают на рынок. */
  rarity_min_round?: Record<string, number>;
}

export type GreyTier = "fail" | "weak" | "full";

export interface GreyTableRow {
  /** The face printed on the die. */
  roll: number;
  /** What it reads as after the player's modifiers (never above six). */
  face: number;
  tier: GreyTier;
  scandals: number;
  effect: Record<string, number | boolean>;
}

export interface GreyTable {
  asset_id: string;
  unlocked: boolean;
  targeted: boolean;
  modifier: number;
  sources: { source: "fraudster" | "mafia" | "card" | string; value: number }[];
  /** 0 opening, 1 middle, 2 endgame third of the match. */
  third: number;
  rows: GreyTableRow[];
}
