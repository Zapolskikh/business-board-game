export type Difficulty = "easy" | "medium" | "hard" | "expert";
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
  blocked: boolean;
}

export interface HeldCard { uid: string; card_id: string }
// `price` is the viewer's own price, computed by the engine (discounts are per-player).
export interface MarketAsset { uid: string; card_id: string; leaving?: boolean; price?: number }

export interface PlayerState {
  id: string;
  name: string;
  is_bot: boolean;
  difficulty: Difficulty;
  preferred_role: string | null;
  money: number;
  influence: number;
  scandals: number;
  roofs: number;
  role: string | null;
  jail_turns: number;
  assets: OwnedAsset[];
  hand?: HeldCard[];
  hand_count?: number;
  projects: string[];
  capacity: number;
  debt: number;
  zoning_district: string | null;
  district_levels: Record<string, number>;
  turns: number;
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
  money: number;
  influence: number;
  assets: number;
  projects: number;
  // Points from neither projects nor objects: the cards that buy score outright.
  bonus?: number;
  role: number;
  scandals: number;
  total: number;
}

// What settling the round right now would pay the viewer, itemised by the engine. Both rows carry
// a `total`; every other key sums to it. A permanent project perk paying +1◆ a round used to be
// indistinguishable from one paying nothing, because nothing on screen added the passives up.
export interface RoundForecast {
  money: { objects: number; projects: number; residents_tax: number; antitrust: number; journalist: number; debt: number; total: number };
  influence: { objects: number; administrative: number; projects: number; news: number; rating: number; total: number };
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
  project_board: string[];
  // What one more development level would pay in each district, and what a level costs. The
  // +25% rounds up per level over the district's actual objects, so only the engine can say.
  // Every perk of the viewer's role: what it pays now, the ceiling, and the district that
  // unlocks the difference. Computed by the engine — the client only prints labels.
  role_perks?: { key: string; value: number; potential?: number; needs?: string | null }[];
  development_preview?: Record<string, number>;
  development_cost?: number;
  // The viewer's own standing on every board condition, counted by the engine — never here.
  project_progress?: Record<string, { binary: boolean; met: boolean; have: number; needed: number }>;
  // Initiatives get dearer with every one you already hold, so the price is per-player and the
  // engine owns it — never print ProjectMeta.cost_* for a repeatable project.
  initiative_cost?: Record<string, { cost_influence: number; cost_money: number }>;
  turn_flags: Record<string, unknown>;
  antitrust_active?: boolean;
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
export interface ActionMeta { id: string; title: string; tone: string; text: string; kind: string; value: number; targeted?: boolean }
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
  // Repeatable initiatives are never in the deck and never leave the table.
  repeatable?: boolean;
}
// Rates owned by the engine (`city_engine/constants.py`) and shipped with the catalog, so no
// client hardcodes the conversion.
export interface ScoringMeta {
  money_per_point: number;
  influence_per_point: number;
  lobbying_influence: number;
  lobbying_points: number;
  project_board_size: number;
  project_reroll_money: number;
  market_rotation_size: number;
  patronage_money: number;
  patronage_points: number;
  crisis_pr_influence: number;
  action_card_cost: number;
  // What discarding a card pays back, in money or in influence.
  card_discard_value?: number;
  // One entry per campaign tier: the same action buys more influence at a worsening rate.
  campaign_tiers: { spend: number; gain: number }[];
  // Laundering scales on both sides: cost = base + ⌊раунд/2⌋, gain = base + ⌊раунд/3⌋.
  laundering_base_cost: number;
  laundering_base_gain: number;
  grey_operation_points: number;
  grey_operation_points_hard: number;
  initiative_surcharge_influence: number;
  initiative_surcharge_money: number;
  hack_influence_steal: number;
  compromat_influence: number;
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
}
