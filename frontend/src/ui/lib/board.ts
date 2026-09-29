import type { CityMeta, GameState, PlayerState } from "../../online/types";

/* Мелкие чтения серверных полей — в одном месте, с осмысленными запасными значениями.
 *
 * Ни одна функция здесь НЕ считает правило: все числа приходят из движка. Запасные значения
 * нужны только на случай устаревшего кеша /meta, чтобы доска не печатала нули.
 */

export const scandalLimit = (player: PlayerState): number => player.scandal_limit ?? 5;

export const roofPrice = (game: GameState): number => game.roof_price ?? 3;

export const maxCapacity = (meta: CityMeta): number => meta.scoring?.max_capacity ?? 6;

export const currentPlayer = (game: GameState): PlayerState | undefined =>
  game.players[game.current_player_index];

/** Порядок хода в раунде: движок присылает turn_order, клиент только ищет позицию. */
export function turnPosition(game: GameState, playerId: string): number {
  const order = game.turn_order ?? game.players.map(player => player.id);
  return order.indexOf(playerId);
}

export const atScandalRisk = (player: PlayerState): boolean =>
  player.role !== null && player.scandals >= scandalLimit(player) - 1;

/* Цвет игрока. Роль меняется по ходу партии и может быть отобрана, поэтому опознавать
 * игрока по цвету роли нельзя — цвет привязан к месту в порядке хода, которое неизменно.
 * Порядок берём из turn_order, как и всё остальное: движок — единственный источник.
 * Оттенки не пересекаются с золотым (очки), зелёным (свой ход) и акцентным (я).
 */
const PLAYER_COLORS = ["#9fc4d1", "#d39ca5", "#91c5a5", "#b9a2d4"];

export function playerColor(game: GameState, playerId: string): string {
  const position = turnPosition(game, playerId);
  return PLAYER_COLORS[(position >= 0 ? position : 0) % PLAYER_COLORS.length];
}

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
