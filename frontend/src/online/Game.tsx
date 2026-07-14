import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, cityApi } from "./api";
import type { CityMeta, LegalAction, RoomView } from "./types";

interface Props { roomId: string; password: string; playerId: string; meta: CityMeta; onExit: () => void }

export function Game({ roomId, password, playerId, meta, onExit }: Props) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const assets = useMemo(() => new Map(meta.assets.map(asset => [asset.id, asset])), [meta]);
  const cards = useMemo(() => new Map(meta.action_cards.map(card => [card.id, card])), [meta]);
  const roles = useMemo(() => new Map(meta.roles.map(role => [role.id, role])), [meta]);
  const districts = useMemo(() => new Map(meta.districts.map(district => [district.id, district])), [meta]);

  const reload = useCallback(async (afterRevision?: number) => {
    try {
      const next = await cityApi.state(roomId, password, playerId, afterRevision);
      if (next.changed !== false) setRoom(next);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Состояние недоступно"); }
  }, [roomId, password, playerId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (room?.game?.status === "finished") return;
    const delay = document.hidden ? 20_000 : 5_000;
    const timer = window.setInterval(() => void reload(room?.revision), delay);
    return () => clearInterval(timer);
  }, [reload, room?.revision, room?.game?.status]);

  const send = async (action: LegalAction) => {
    if (!room?.game || busy) return;
    setBusy(true); setError("");
    try { setRoom(await cityApi.command(roomId, password, playerId, room.game.revision, action)); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : "Команда не выполнена");
      if (reason instanceof ApiError && reason.status === 409) await reload();
    } finally { setBusy(false); }
  };

  if (!room?.game) return <main className="online-shell"><p>{error || "Загрузка игры…"}</p><button onClick={onExit}>← К комнатам</button></main>;
  const game = room.game;
  const me = game.players.find(player => player.id === playerId);
  const current = game.players[game.current_player_index];
  const legal = room.legal_actions ?? [];
  const ranking = game.status === "finished"
    ? [...game.players].sort((a, b) => (game.final_scores?.[b.id] ?? 0) - (game.final_scores?.[a.id] ?? 0))
    : [];
  const actionLabel = (action: LegalAction) => {
    const p = action.payload; const target = game.players.find(player => player.id === p.target_id);
    const district = districts.get(String(p.district)); const role = roles.get(String(p.role_id));
    if (action.type === "basic_action") return p.kind === "work" ? "Городской заказ · +2$" : "Кампания · 2$ → 2◆";
    if (action.type === "end_turn") return "Закончить ход";
    if (action.type === "city_project") return "Городской проект · 3◆ → 6 очков";
    if (action.type === "buy_capacity") return "Расширить бизнес";
    if (action.type === "buy_roof") return "Купить Крышу";
    if (action.type === "crisis_pr") return "Антикризисный PR · 4$";
    if (action.type === "claim_role") return `Получить роль: ${role?.icon ?? ""} ${role?.title ?? p.role_id}`;
    if (action.type === "buy_asset") { const item = game.market.find(asset => asset.uid === p.market_uid); return `Купить «${assets.get(item?.card_id ?? "")?.title}»`; }
    if (action.type === "sell_asset") { const item = me?.assets.find(asset => asset.uid === p.asset_uid); return `Продать «${assets.get(item?.card_id ?? "")?.title}»`; }
    if (action.type === "improve_asset") { const item = me?.assets.find(asset => asset.uid === p.asset_uid); return `${p.kind === "automate" ? "Автоматизировать" : "Модернизировать"} «${assets.get(item?.card_id ?? "")?.title}»`; }
    if (action.type === "develop_district") return `Развить район: ${district?.title}`;
    if (action.type === "buy_action_card") return `Купить карту «${cards.get(String(p.card_id))?.title}»`;
    if (action.type === "convert_action_card") { const held = me?.hand?.find(card => card.uid === p.card_uid); return `Сбросить «${cards.get(held?.card_id ?? "")?.title}» → ${p.into === "money" ? "1$" : "1◆"}`; }
    if (action.type === "play_action_card") { const held = me?.hand?.find(card => card.uid === p.card_uid); return `Сыграть «${cards.get(held?.card_id ?? "")?.title}»${target ? ` → ${target.name}` : district ? ` · ${district.title}` : role ? ` · ${role.title}` : ""}`; }
    if (action.type === "grey_operation") return `Серая операция: ${String(p.asset_id)}${target ? ` → ${target.name}` : ""}${p.protect_failure ? " · страховать Крышей" : ""}`;
    if (action.type === "use_role_power") return `${powerLabels[String(p.power)] ?? p.power}${target ? ` → ${target.name}` : district ? ` · ${district.title}` : role ? ` · ${role.title}` : ""}`;
    if (action.type === "resolve_decision") return p.option === "use_roof" ? "Потратить Крышу и отменить" : "Принять эффект";
    return action.type;
  };

  return <main className="game-shell">
    <header className="game-header"><div><button onClick={onExit}>← Комнаты</button><h1>{room.name}</h1><p>{game.status === "finished" ? "Партия завершена" : <>Раунд {game.round_number}/{game.max_rounds} · ход: <strong>{current.name}</strong> · действий {game.actions_left} · инвестиционных {game.investment_actions}</>}</p></div><div className="event-card"><strong>{meta.events.find(event => event.id === game.event_id)?.title}</strong><span>{meta.events.find(event => event.id === game.event_id)?.text}</span></div></header>
    {game.status === "finished" && <section className="panel final-ranking"><h2>Итоги</h2>{ranking.map((player, index) => <p key={player.id}><strong>{index + 1}. {player.name}</strong><span>{game.final_scores?.[player.id] ?? 0} очков</span></p>)}</section>}
    {error && <p className="error game-error">{error}</p>}
    <section className="players-strip">{game.players.map(player => <article className={`player-card ${player.id === current.id ? "current" : ""} ${player.id === playerId ? "mine" : ""}`} key={player.id}>
      <strong>{player.name} {player.is_bot && <small>{player.difficulty}</small>}</strong><span>💰{player.money} · ◆{player.influence} · ⚠{player.scandals} · 🛡{player.roofs}</span><span>{player.role ? `${roles.get(player.role)?.icon} ${roles.get(player.role)?.title}` : "без роли"} · объектов {player.assets.length}/{player.capacity}</span>
    </article>)}</section>
    <div className="game-columns">
      <section className="panel game-board"><h2>Рынок объектов <small>в колоде {game.market_deck_count}</small></h2><div className="asset-grid">{game.market.map(item => { const asset = assets.get(item.card_id); return <article className={`asset rarity-${asset?.rarity}`} key={item.uid}><strong>{asset?.title}</strong><span>{districts.get(asset?.district ?? "")?.title} · {asset?.cost}$ · доход {asset?.income}$ · ◆{asset?.influence}</span><small>{asset?.text}</small><small>⏳ до хода {item.expires_at_turn}</small></article>; })}</div>
        <h2>Рынок карт <small>в колоде {game.action_deck_count}</small></h2><div className="asset-grid">{game.action_market.map(cardId => { const card = cards.get(cardId); return <article className="asset action-market-card" key={cardId}><strong>{card?.title}</strong><span>3$ + 1◆</span><small>{card?.text}</small></article>; })}</div>
        <h2>Ваши объекты</h2><div className="asset-grid">{me?.assets.map(item => { const asset = assets.get(item.card_id); return <article className={`asset owned ${item.blocked ? "blocked" : ""}`} key={item.uid}><strong>{asset?.title}</strong><span>{item.automated ? "⚙ автоматизирован" : item.scaled ? "🔧 модернизирован" : "без улучшения"}</span><small>{asset?.text}</small></article>; })}</div>
      </section>
      <aside className="panel decision-panel"><h2>{game.status === "finished" ? "Партия окончена" : game.pending_decision ? "Ожидается решение" : legal.length ? "Доступные действия" : "Чужой ход"}</h2>{busy && <p className="muted">Сервер выполняет команду и ходы ботов…</p>}<div className="action-list">{legal.map((action, index) => <button className={action.type === "end_turn" ? "end-turn" : ""} disabled={busy} onClick={() => send(action)} key={`${action.type}-${index}`}>{actionLabel(action)}</button>)}</div>
        <h2>Карты действий <small>{me?.hand?.length ?? 0}/3</small></h2>{me?.hand?.map(card => <article className="hand-card" key={card.uid}><strong>{cards.get(card.card_id)?.title}</strong><small>{cards.get(card.card_id)?.text}</small></article>)}
      </aside>
      <aside className="panel event-log"><h2>Хроника</h2>{[...game.event_log].reverse().slice(0, 40).map(event => <article key={event.seq}><strong>#{event.seq} {event.type}</strong><span>{event.actor_id ? game.players.find(player => player.id === event.actor_id)?.name : "Город"}</span><small>{formatData(event.data)}</small></article>)}</aside>
    </div>
  </main>;
}

const powerLabels: Record<string, string> = {
  capitalist_financing: "Ускоренное финансирование", politician_tax: "Налог района", politician_cleanup: "Урегулировать скандал", journalist_inflate: "Раздуть историю", journalist_publish: "Опубликовать расследование", mafia_racket: "Рэкет", mafia_sweep: "Сжечь связи", mafia_cleanup: "Замять дело", military_sanction: "Санкции", fraudster_cleanup: "Снять скандал", fraudster_crypto_scam: "Криптоскам", fraudster_forge: "Подделать документы",
};

function formatData(data: Record<string, unknown>): string {
  return Object.entries(data).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ");
}
