import { useEffect, useRef, useState } from "react";
import { describeEventSegments, numberValue, stringValue, type LogSegment } from "../../online/gameUi";
import type { CityMeta, DomainEvent, GameState, PlayerState } from "../../online/types";

/* Сводка «что со мной случилось, пока я не ходил».
 *
 * Хроника показывает всё подряд и по порядку — по ней невозможно за секунду понять,
 * что лично у тебя сняли роль, забрали крышу и украли деньги. Поэтому сводка считает
 * две вещи отдельно: дельту собственных показателей (было → стало) и те события чужих
 * ходов, которые задели именно тебя.
 *
 * Считается целиком на клиенте из снимка своего состояния на конец прошлого хода:
 * движок такой истории не хранит, а добавлять её в протокол ради одного окна дорого.
 */

export type BriefingTone = "good" | "bad" | "neutral";

export interface BriefingSnapshot {
  turnKey: number;
  lastSeq: number;
  round: number;
  money: number;
  influence: number;
  scandals: number;
  roofs: number;
  role: string | null;
  assets: number;
  projects: number;
  capacity: number;
  debt: number;
  jailTurns: number;
  markedCard: string | null;
  lockedSlots: number;
  score: number;
}

export interface BriefingStat {
  key: string;
  label: string;
  icon: string;
  from: number;
  to: number;
  tone: BriefingTone;
}

export interface BriefingFlag {
  key: string;
  text: string;
  tone: BriefingTone;
}

export interface BriefingLine {
  seq: number;
  tone: BriefingTone;
  segments: LogSegment[];
}

export interface Briefing {
  round: number;
  fromRound: number;
  stats: BriefingStat[];
  flags: BriefingFlag[];
  lines: BriefingLine[];
}

function scoreTotal(game: GameState, playerId: string): number {
  return game.score_breakdown?.[playerId]?.total ?? 0;
}

function lockedSlotsOf(game: GameState, playerId: string): number {
  return game.market.filter(item => item.locked_by === playerId).length;
}

export function snapshotOf(game: GameState, me: PlayerState, turnKey: number): BriefingSnapshot {
  return {
    turnKey,
    lastSeq: game.event_log.length > 0 ? game.event_log[game.event_log.length - 1].seq : 0,
    round: game.round_number,
    money: me.money,
    influence: me.influence,
    scandals: me.scandals,
    roofs: me.roofs,
    role: me.role ?? null,
    assets: me.assets.length,
    projects: me.projects.length,
    capacity: me.capacity,
    debt: me.debt,
    jailTurns: me.jail_turns,
    markedCard: me.marked_card_id ?? null,
    lockedSlots: lockedSlotsOf(game, me.id),
    score: scoreTotal(game, me.id),
  };
}

/** «Хорошо» для запаса — рост, для скандалов и долга — падение. */
function toneOf(delta: number, positiveIsGood: boolean): BriefingTone {
  if (delta === 0) return "neutral";
  return delta > 0 === positiveIsGood ? "good" : "bad";
}

const STAT_ROWS: { key: keyof BriefingSnapshot; label: string; icon: string; positiveIsGood: boolean }[] = [
  { key: "money", label: "Деньги", icon: "$", positiveIsGood: true },
  { key: "influence", label: "Влияние", icon: "◆", positiveIsGood: true },
  { key: "score", label: "Очки", icon: "★", positiveIsGood: true },
  { key: "scandals", label: "Скандалы", icon: "⚠", positiveIsGood: false },
  { key: "roofs", label: "Крыши", icon: "🛡", positiveIsGood: true },
  { key: "assets", label: "Объекты", icon: "🏢", positiveIsGood: true },
  { key: "projects", label: "Проекты", icon: "🏗", positiveIsGood: true },
  { key: "capacity", label: "Ёмкость города", icon: "📐", positiveIsGood: true },
  { key: "debt", label: "Долг", icon: "🏦", positiveIsGood: false },
];

/** Кого задело событие: движок кладёт цель то в `target_id`, то в список. */
function touches(event: DomainEvent, playerId: string): boolean {
  const data = event.data;
  if (stringValue(data.target_id) === playerId) return true;
  for (const key of ["target_ids", "scandalised_ids", "reached_ids", "hit_ids", "players"]) {
    const value = data[key];
    if (Array.isArray(value) && value.some(item => stringValue(item) === playerId)) return true;
  }
  const deltas = data.deltas;
  if (deltas && typeof deltas === "object" && playerId in (deltas as Record<string, unknown>)) return true;
  return false;
}

/* События, где `actor_id` — это пострадавший, а не тот, кто бил. Их приходится знать
 * поимённо: в остальных случаях актор — атакующий, и совпадение с собой означало бы,
 * что событие своё собственное и в сводке ему не место. */
const VICTIM_EVENTS = new Set([
  "targeted_effect_blocked",
  "scandal_limit_reached",
  "player_jailed",
]);

/** Событиям без дельт тон назначается по смыслу. */
const EVENT_TONE: Record<string, BriefingTone> = {
  targeted_effect_blocked: "good",
  role_takeover_blocked: "good",
  scandal_limit_reached: "bad",
  player_jailed: "bad",
  role_stripped: "bad",
  roofs_broken: "bad",
  roof_seized: "bad",
  military_inspection: "bad",
  military_sanction: "bad",
};

function lineTone(event: DomainEvent, playerId: string): BriefingTone {
  const deltas = event.data.deltas as Record<string, Record<string, unknown>> | undefined;
  const mine = deltas && typeof deltas === "object" ? deltas[playerId] : undefined;
  if (mine) {
    const money = numberValue(mine.money);
    const influence = numberValue(mine.influence);
    const scandals = numberValue(mine.scandals);
    const roofs = numberValue(mine.roofs);
    if (scandals > 0 || money < 0 || influence < 0 || roofs < 0) return "bad";
    if (money > 0 || influence > 0 || roofs > 0 || scandals < 0) return "good";
  }
  return EVENT_TONE[event.type] ?? "neutral";
}

export function buildBriefing(
  game: GameState,
  me: PlayerState,
  meta: CityMeta,
  snapshot: BriefingSnapshot,
): Briefing {
  const now = snapshotOf(game, me, snapshot.turnKey);

  const stats: BriefingStat[] = [];
  for (const row of STAT_ROWS) {
    const from = snapshot[row.key] as number;
    const to = now[row.key] as number;
    if (from === to) continue;
    stats.push({ key: row.key, label: row.label, icon: row.icon, from, to, tone: toneOf(to - from, row.positiveIsGood) });
  }

  const flags: BriefingFlag[] = [];
  const roleTitle = (id: string | null) => (id ? meta.roles.find(role => role.id === id)?.title ?? id : null);
  if (snapshot.role && !now.role) {
    flags.push({ key: "role-lost", text: `Роль «${roleTitle(snapshot.role)}» потеряна`, tone: "bad" });
  } else if (snapshot.role && now.role && snapshot.role !== now.role) {
    flags.push({ key: "role-changed", text: `Роль сменилась: «${roleTitle(snapshot.role)}» → «${roleTitle(now.role)}»`, tone: "neutral" });
  } else if (!snapshot.role && now.role) {
    flags.push({ key: "role-gained", text: `Получена роль «${roleTitle(now.role)}»`, tone: "good" });
  }
  if (snapshot.markedCard && !now.markedCard) {
    flags.push({ key: "mark-lost", text: "Метка капиталиста снята — карта больше не работает на вас", tone: "bad" });
  }
  if (now.lockedSlots < snapshot.lockedSlots) {
    flags.push({ key: "lock-lost", text: "Метка мафиози снята — слот рынка снова открыт для всех", tone: "bad" });
  }
  if (now.roofs < snapshot.roofs) {
    const lost = snapshot.roofs - now.roofs;
    flags.push({ key: "roof-lost", text: `Крыш снято: ${lost}`, tone: "bad" });
  }
  if (now.jailTurns > snapshot.jailTurns) {
    flags.push({ key: "jail", text: `Арест: пропуск ходов — ${now.jailTurns}`, tone: "bad" });
  } else if (snapshot.jailTurns > 0 && now.jailTurns === 0) {
    flags.push({ key: "jail-out", text: "Арест окончен — вы снова в игре", tone: "good" });
  }
  if (now.scandals >= me.scandal_limit) {
    flags.push({ key: "scandal-limit", text: `Скандалов ${now.scandals} из ${me.scandal_limit} — порог достигнут`, tone: "bad" });
  }

  const lines: BriefingLine[] = [];
  for (const event of game.event_log) {
    if (event.seq <= snapshot.lastSeq) continue;
    const isVictimEvent = VICTIM_EVENTS.has(event.type) && event.actor_id === me.id;
    const relevant = event.type === "round_settled" || isVictimEvent || (event.actor_id !== me.id && touches(event, me.id));
    if (!relevant) continue;
    const segments = describeEventSegments(event, game, meta);
    if (segments.length === 0) continue;
    lines.push({ seq: event.seq, tone: lineTone(event, me.id), segments });
  }

  return { round: game.round_number, fromRound: snapshot.round, stats, flags, lines };
}

/* Снимок обновляется на каждом обновлении состояния, пока ход мой, — значит к моменту,
 * когда ход уходит дальше, в нём лежит именно «как было на конец моего хода». Сводка
 * собирается один раз на новый `turn_serial`, поэтому закрытое окно само не всплывает. */
export function useTurnBriefing(game: GameState, me: PlayerState, meta: CityMeta) {
  const snapshotRef = useRef<BriefingSnapshot | null>(null);
  const reportedTurnRef = useRef<number | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);

  const myTurn = game.players[game.current_player_index]?.id === me.id;
  const turnKey = game.turn_serial ?? game.event_log.length;

  useEffect(() => {
    if (game.status !== "playing" || !myTurn) return;
    if (reportedTurnRef.current !== turnKey) {
      reportedTurnRef.current = turnKey;
      const previous = snapshotRef.current;
      if (previous && previous.turnKey !== turnKey) {
        const next = buildBriefing(game, me, meta, previous);
        if (next.stats.length > 0 || next.flags.length > 0 || next.lines.length > 0) setBriefing(next);
      }
    }
    snapshotRef.current = snapshotOf(game, me, turnKey);
  }, [game, me, meta, myTurn, turnKey]);

  return { briefing, close: () => setBriefing(null) };
}
