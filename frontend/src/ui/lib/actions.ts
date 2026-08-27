import type { GameState, LegalAction, PlayerState } from "../../online/types";

/* Доступность действия — один механизм на всю доску.
 *
 * Правило: разрешает движок. Клиент ищет действие в `legal_actions` и, если не нашёл,
 * объясняет почему, сравнивая уже присланные значения (чей ход, остаток действий).
 * Клиент НИКОГДА не воспроизводит условие движка, чтобы решить, показывать ли кнопку.
 *
 * Появится в движке новое условие — кнопка погаснет сама, устареть сможет только подпись.
 */

export type Availability =
  | { kind: "ready"; action: LegalAction }
  | { kind: "pending"; action: LegalAction }
  | { kind: "blocked"; reason: string };

export interface ActionContext {
  game: GameState;
  me: PlayerState;
  legal: LegalAction[];
  pending?: LegalAction;
}

/** Частичное совпадение по payload: `{power: "mafia_racket"}` найдёт вариант на любую цель. */
export type PayloadMatch = Record<string, string | number | boolean>;

export function matches(action: LegalAction, type: string, payload?: PayloadMatch): boolean {
  if (action.type !== type) return false;
  if (!payload) return true;
  return Object.entries(payload).every(([key, value]) => action.payload[key] === value);
}

export function findAction(
  context: ActionContext,
  type: string,
  payload?: PayloadMatch,
): LegalAction | undefined {
  return context.legal.find(action => matches(action, type, payload));
}

export function findActions(
  context: ActionContext,
  type: string,
  payload?: PayloadMatch,
): LegalAction[] {
  return context.legal.filter(action => matches(action, type, payload));
}

/** Причина, по которой недоступно вообще ничего. Общая для всех кнопок доски. */
export function turnBlock(context: ActionContext): string | undefined {
  const { game, me } = context;
  if (game.status !== "playing") return "Партия окончена";
  if (game.players[game.current_player_index]?.id !== me.id) {
    const current = game.players[game.current_player_index];
    return current ? `Ход игрока ${current.name}` : "Сейчас не ваш ход";
  }
  if (me.jail_turns > 0) return `Тюрьма: ходов ${me.jail_turns}`;
  if (game.actions_left <= 0) return "Действия на этот ход закончились";
  return undefined;
}

export function resolve(
  context: ActionContext,
  type: string,
  payload?: PayloadMatch,
  hint?: string,
): Availability {
  if (context.pending && matches(context.pending, type, payload)) {
    return { kind: "pending", action: context.pending };
  }
  const action = findAction(context, type, payload);
  if (action) return { kind: "ready", action };
  return { kind: "blocked", reason: hint ?? turnBlock(context) ?? "Сейчас недоступно" };
}

/** Действие, у которого много вариантов по цели: открывается поповером со списком. */
export function resolveMany(
  context: ActionContext,
  type: string,
  payload?: PayloadMatch,
  hint?: string,
): { options: LegalAction[]; blocked?: string; pending: boolean } {
  const pending = Boolean(context.pending && matches(context.pending, type, payload));
  const options = findActions(context, type, payload);
  if (options.length > 0 || pending) return { options, pending };
  return { options, pending, blocked: hint ?? turnBlock(context) ?? "Сейчас недоступно" };
}

export const isReady = (state: Availability): state is { kind: "ready"; action: LegalAction } =>
  state.kind === "ready";

/** Отметки «уже в этом ходу» приходят из движка в turn_flags — клиент их только читает. */
export function usedThisTurn(game: GameState, flag: string): boolean {
  return Boolean(game.turn_flags?.[flag]);
}
