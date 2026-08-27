import type { CityMeta, GameState, PlayerState } from "../../online/types";

/* Мелкие чтения серверных полей — в одном месте, с осмысленными запасными значениями.
 *
 * Ни одна функция здесь НЕ считает правило: все числа приходят из движка. Запасные значения
 * нужны только на случай устаревшего кеша /meta, чтобы доска не печатала нули.
 */

export const scandalLimit = (player: PlayerState): number => player.scandal_limit ?? 5;

export const roofPrice = (game: GameState): number => game.roof_price ?? 3;

export const maxCapacity = (meta: CityMeta): number => meta.scoring?.max_capacity ?? 6;

/** Цена следующего слота города. undefined — расширяться некуда. */
export function nextSlotPrice(meta: CityMeta, player: PlayerState): number | undefined {
  return meta.scoring?.capacity_costs?.[String(player.capacity)];
}

/** Все цены лестницы расширения — для поповера слотов. */
export function slotLadder(meta: CityMeta): { capacity: number; cost: number }[] {
  const costs = meta.scoring?.capacity_costs ?? {};
  return Object.entries(costs)
    .map(([capacity, cost]) => ({ capacity: Number(capacity), cost }))
    .sort((left, right) => left.capacity - right.capacity);
}

export const isMyTurn = (game: GameState, me: PlayerState): boolean =>
  game.status === "playing" && game.players[game.current_player_index]?.id === me.id;

export const currentPlayer = (game: GameState): PlayerState | undefined =>
  game.players[game.current_player_index];

/** Порядок хода в раунде: движок присылает turn_order, клиент только ищет позицию. */
export function turnPosition(game: GameState, playerId: string): number {
  const order = game.turn_order ?? game.players.map(player => player.id);
  return order.indexOf(playerId);
}

export const atScandalRisk = (player: PlayerState): boolean =>
  player.role !== null && player.scandals >= scandalLimit(player) - 1;

export function indexMaps(meta: CityMeta) {
  return {
    assets: new Map(meta.assets.map(asset => [asset.id, asset])),
    districts: new Map(meta.districts.map(district => [district.id, district])),
    roles: new Map(meta.roles.map(role => [role.id, role])),
    projects: new Map(meta.projects.map(project => [project.id, project])),
    cards: new Map(meta.action_cards.map(card => [card.id, card])),
  };
}

export type Indexes = ReturnType<typeof indexMaps>;
