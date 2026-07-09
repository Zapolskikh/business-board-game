// Type mirror of the backend's state dicts. Kept intentionally light — the engine
// is the source of truth; these types just describe what the API returns.

export interface PlayerState {
  id: string;
  name: string;
  is_bot: boolean;
  money: number;
  experience: number;
  ring: number;
  position: number;
  role: string | null;
  scandals: number;
  roofs: number;
  insured_cells: string[];
  bankrupt_count: number;
  stats: Record<string, number>;
}

export interface CellState {
  id: string;
  ring: number;
  slot: number;
  type: string;
  title: string;
  buyable: boolean;
  price: number;
  owner_id: string | null;
  tags: string[];
}

export interface BoardState {
  ring_sizes: number[];
  rings: CellState[][];
}

export interface DecisionOption {
  id: string;
  label: string;
  data: Record<string, unknown>;
  // UI hints from the backend: rolls_dice shows a 🎲 badge; hint is a tooltip;
  // role is the role id when the option is exclusive to a specific role.
  rolls_dice?: boolean;
  hint?: string;
  role?: string;
}

export interface Decision {
  type: string;
  player_id: string;
  prompt: string;
  options: DecisionOption[];
  handler: string;
  cell_id: string | null;
  context: Record<string, unknown>;
}

// --- Map-pick: "choose a cell visually on the board, then confirm/cancel" ---
// Raised by Taxi, Station (travel) and Auction. The backend only lists affordable
// candidates as real options; `context.candidates` describes every selectable cell
// (including greyed-out unaffordable ones) so the UI can highlight and detail them.
export const MAP_PICK = "choose_cell_on_map";
export const CANCEL_OPTION = "cancel";

export interface MapCandidateInfo {
  cell_id: string;
  affordable: boolean;
  cost: number;
  note: string;
}

export interface MapPickContext {
  action_kind: string;
  confirm_label: string;
  cancel_label: string;
  candidates: Record<string, MapCandidateInfo>;
  [key: string]: unknown;
}

export interface GameState {
  game_id: string;
  players: PlayerState[];
  current_index: number;
  current_player_id: string | null;
  turn_number: number;
  round_number: number;
  phase: "await_roll" | "await_decision" | "game_over";
  pending_decision: Decision | null;
  winner_id: string | null;
  net_worth: Record<string, number>;
  board: BoardState;
  // Last dice result, surfaced under the players ("what did the current player roll?").
  last_die: number | null;
  last_die_player_id: string | null;
  // Victory rules, used for the "round X / max" indicator above the board.
  victory: { max_turns: number; target_net_worth: number };
  // Bounded tail of the event log (multiplayer pollers read the narrative here);
  // `log_size` is the total event count so `event.seq` stays absolute/stable.
  log?: GameEvent[];
  log_size?: number;
  chat?: ChatMessage[];
}

export interface ChatMessage {
  player_id: string;
  name: string;
  text: string;
  idx: number;
}

export interface GameEvent {
  type: string;
  message: string;
  player_id: string | null;
  data: Record<string, unknown>;
  // Absolute index of this event in the full server log. Stable across polls, so
  // the UI can tell a genuinely new move from a repeated one when observing.
  seq?: number;
}

// Payload of a "player_moved" event — drives the token animation on the board.
// `mode` is "walk"/"back" (step through cells along the ring) or "teleport"
// (instant jump: hospital/jail/ring promotion). `seq` is the event index, added
// by the UI so repeated identical moves still retrigger the animation.
export interface PlayerMovedData {
  seq: number;
  player_id: string;
  from_ring: number;
  from_slot: number;
  to_ring: number;
  to_slot: number;
  mode: "walk" | "back" | "teleport";
}

export interface RoleMeta {
  id: string;
  title: string;
  color: string;
  themes?: string[];
  weaknesses?: string[];
}

export interface CellMeta {
  title: string;
  buyable: boolean;
  tags: string[];
  color: string;
  price_key?: string;
  // Buyable "object" cells (food, dormitory) show a different name per ring
  // (Coffee shop / Diner / Restaurant, Hostel / Dorm / Hotel).
  ring_titles?: string[];
}

// Human-readable description of what a cell does overall and per role (from
// cell_effects.json). `roles` keys are role ids.
export interface CellEffect {
  base: string;
  roles: Record<string, string>;
}

// A single "?" card the QuestionCell can draw (from question_cards.json). Shown
// verbatim in the FAQ so players can see every possible outcome.
export interface QuestionCardEffect {
  kind: string;
  key?: string;
  amount?: number;
}

export interface QuestionCard {
  id: string;
  title: string;
  text: string;
  weight: number;
  effect: QuestionCardEffect;
}

// Balance numbers the UI shows in the detailed cell panel. Most values are
// indexed by ring (0..2); a few are scalars.
export interface Economy {
  start_bonus: number[];
  start_experience: number[];
  promotion: { enabled?: boolean; experience_required: number[] };
  prices: Record<string, number[]>;
  // Flat rent paid to the owner when landing on their food/dormitory object
  // (Monopoly-style, no upgrades), indexed by ring.
  rent: Record<string, number[]>;
  roof_price: number[];
  taxi: { price: number[] };
  station: { fare: number[]; capitalist_buyout_multiplier?: number };
  auction: { min_bid: number[]; start_fraction: number; increment_fraction: number };
  [key: string]: unknown;
}

export interface Meta {
  roles: RoleMeta[];
  cells: Record<string, CellMeta>;
  cell_effects: Record<string, CellEffect>;
  cell_types: string[];
  question_cards: QuestionCard[];
  economy: Economy;
}
