export type Difficulty = "easy" | "medium" | "hard";
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
  automated: boolean;
  scaled: boolean;
  blocked: boolean;
}

export interface HeldCard { uid: string; card_id: string }
export interface MarketAsset { uid: string; card_id: string; expires_at_turn: number }

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
  copied_role: string | null;
  pending_role: string | null;
  jail_turns: number;
  assets: OwnedAsset[];
  hand?: HeldCard[];
  hand_count?: number;
  projects: number;
  capacity: number;
  debt: number;
  role_shields: number;
  scandal_shields: number;
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

export interface PendingDecision {
  id: string;
  actor_id: string;
  type: string;
  options: string[];
  context: Record<string, unknown>;
}

export interface GameState {
  game_id: string;
  revision: number;
  status: "playing" | "finished";
  max_rounds: number;
  role_price: number;
  round_number: number;
  current_player_index: number;
  actions_left: number;
  investment_actions: number;
  event_id: string;
  players: PlayerState[];
  market: MarketAsset[];
  action_market: string[];
  turn_flags: Record<string, unknown>;
  pending_decision: PendingDecision | null;
  event_log: DomainEvent[];
  market_deck_count: number;
  action_deck_count: number;
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
export interface AssetMeta { id: string; title: string; district: string; rarity: string; cost: number; income: number; influence: number; text: string; tags: string[] }
export interface ActionMeta { id: string; title: string; tone: string; text: string; kind: string; value: number; targeted?: boolean }
export interface EventMeta { id: string; title: string; text: string }
export interface CityMeta {
  content_version: string;
  districts: DistrictMeta[];
  roles: RoleMeta[];
  assets: AssetMeta[];
  action_cards: ActionMeta[];
  events: EventMeta[];
}
