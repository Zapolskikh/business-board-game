import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ApiError, cityApi } from "./api";
import {
  actionIdentity,
  actionLabel,
  activeBonuses,
  capacityLabel,
  describeEvent,
  difficultyLabels,
  districtCount,
  greyOperationLabels,
  marketPrice,
  powerLabels,
  rarityLabels,
  scoreOf,
  stringValue,
} from "./gameUi";
import type {
  ActionMeta,
  AssetMeta,
  CityMeta,
  GameState,
  LegalAction,
  OwnedAsset,
  PlayerState,
  RoomView,
} from "./types";

interface Props {
  roomId: string;
  password: string;
  playerId: string;
  meta: CityMeta;
  onExit: () => void;
}

interface ChoiceState { title: string; actions: LegalAction[] }

const playerColors = ["#58a6ff", "#3fb950", "#f0883e", "#d65db1", "#e3b341", "#9b6ee7"];
const rolePowers: Record<string, string[]> = {
  capitalist: ["capitalist_financing"],
  politician: ["politician_tax", "politician_cleanup"],
  journalist: ["journalist_inflate", "journalist_publish"],
  mafia: ["mafia_racket", "mafia_sweep", "mafia_cleanup"],
  military: ["military_sanction"],
  fraudster: ["fraudster_cleanup", "fraudster_crypto_scam", "fraudster_forge"],
};

export function Game({ roomId, password, playerId, meta, onExit }: Props) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState(meta.districts[0]?.id ?? "business");
  const [viewedPlayerId, setViewedPlayerId] = useState(playerId);
  const [choice, setChoice] = useState<ChoiceState | null>(null);
  const [showRules, setShowRules] = useState(false);

  const assets = useMemo(() => new Map(meta.assets.map(asset => [asset.id, asset])), [meta.assets]);
  const cards = useMemo(() => new Map(meta.action_cards.map(card => [card.id, card])), [meta.action_cards]);
  const roles = useMemo(() => new Map(meta.roles.map(role => [role.id, role])), [meta.roles]);
  const districts = useMemo(() => new Map(meta.districts.map(district => [district.id, district])), [meta.districts]);

  const reload = useCallback(async (afterRevision?: number) => {
    try {
      const next = await cityApi.state(roomId, password, playerId, afterRevision);
      if (next.changed !== false) setRoom(next);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Состояние игры недоступно");
    }
  }, [password, playerId, roomId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (room?.game?.status === "finished") return;
    const poll = () => void reload(room?.revision);
    const timer = window.setInterval(poll, document.hidden ? 20_000 : 5_000);
    const onVisibility = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [reload, room?.game?.status, room?.revision]);

  const send = useCallback(async (action: LegalAction) => {
    if (!room?.game || busy) return;
    setBusy(true);
    setError("");
    setChoice(null);
    try {
      setRoom(await cityApi.command(roomId, password, playerId, room.game.revision, action));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Команда не выполнена");
      if (reason instanceof ApiError && reason.status === 409) await reload();
    } finally {
      setBusy(false);
    }
  }, [busy, password, playerId, reload, room, roomId]);

  if (!room?.game) {
    return <main className="online-shell"><section className="panel loading-panel"><p>{error || "Загрузка игры…"}</p><button onClick={onExit}>← К комнатам</button></section></main>;
  }

  const game = room.game;
  const me = game.players.find(player => player.id === playerId) ?? game.players[0];
  const current = game.players[game.current_player_index];
  const viewed = game.players.find(player => player.id === viewedPlayerId) ?? me;
  const viewingOther = viewed.id !== me.id;
  const event = meta.events.find(item => item.id === game.event_id);
  const legal = room.legal_actions ?? [];
  const labelContext = { game, player: me, assets, cards, roles, districts };

  const matching = (type: string, predicate?: (action: LegalAction) => boolean) =>
    legal.filter(action => action.type === type && (!predicate || predicate(action)));
  const offer = (title: string, actions: LegalAction[]) => {
    if (actions.length === 1) void send(actions[0]);
    else if (actions.length > 1) setChoice({ title, actions });
  };

  const buyActions = new Map(matching("buy_asset").map(action => [stringValue(action.payload.market_uid), action]));
  const buyCardActions = new Map(matching("buy_action_card").map(action => [stringValue(action.payload.card_id), action]));
  const ranking = [...game.players].sort((a, b) => (game.final_scores?.[b.id] ?? scoreOf(b, assets)) - (game.final_scores?.[a.id] ?? scoreOf(a, assets)));

  return <div className="city-game">
    <header className="city-head">
      <div className="city-head-title">
        <h1>Город влияния <small>online release</small> <span className="game-version">v{__GAME_VERSION__}</span></h1>
        <p>{room.name} · Раунд {game.round_number}/{game.max_rounds} · Ход: <b>{current.name}</b> · Действий: <b>{game.actions_left}</b>{game.investment_actions > 0 && <> · Инвестиционных: <b className="investment-actions">{game.investment_actions}</b></>}</p>
      </div>
      <div className="city-event" title="Событие действует всю партию">
        <strong>📰 {event?.title ?? game.event_id}</strong><span>{event?.text}</span>
      </div>
      <div className="city-head-buttons"><button onClick={() => setShowRules(value => !value)}>📖 Правила</button><button onClick={onExit}>← Комнаты</button></div>
    </header>

    {error && <p className="game-error">{error}</p>}
    {game.status === "finished" && <FinishPanel ranking={ranking} scores={game.final_scores} assets={assets} onExit={onExit} />}

    <main className="city-layout">
      <div className="city-main-col">
        <PlayerStrip game={game} viewedId={viewed.id} playerId={playerId} assets={assets} roles={roles} onView={setViewedPlayerId} />
        <DistrictMarket
          game={game} meta={meta} me={me} viewed={viewed} viewingOther={viewingOther} assets={assets}
          selectedDistrict={selectedDistrict} onSelectDistrict={setSelectedDistrict}
          buyActions={buyActions} busy={busy} onAction={send}
        />
        {!viewingOther && <CardDesk game={game} me={me} cards={cards} legal={legal} buyActions={buyCardActions} busy={busy} onAction={send} onOffer={offer} labelContext={labelContext} />}
        <BusinessBoard viewed={viewed} me={me} game={game} meta={meta} assets={assets} legal={legal} viewingOther={viewingOther} busy={busy} onAction={send} />
      </div>

      <div className="city-side">
        <DecisionPanel
          game={game} me={me} meta={meta} roles={roles} districts={districts} legal={legal}
          selectedDistrict={selectedDistrict} busy={busy} onAction={send} onOffer={offer} labelContext={labelContext}
        />
        <Chronicle game={game} meta={meta} />
      </div>
    </main>

    {showRules && <Rules rolePrice={game.role_price} onClose={() => setShowRules(false)} />}
    {choice && <ChoiceModal choice={choice} game={game} labelContext={labelContext} busy={busy} onClose={() => setChoice(null)} onAction={send} />}
  </div>;
}

function PlayerStrip({ game, viewedId, playerId, assets, roles, onView }: {
  game: GameState;
  viewedId: string;
  playerId: string;
  assets: Map<string, AssetMeta>;
  roles: Map<string, { title: string; icon: string; color: string }>;
  onView: (id: string) => void;
}) {
  const current = game.players[game.current_player_index];
  return <section className="city-players">{game.players.map((player, index) => {
    const role = roles.get(player.role ?? "");
    const preferred = roles.get(player.preferred_role ?? "");
    const color = playerColors[index % playerColors.length];
    return <button
      className={`city-player scandal-${Math.min(6, player.scandals)} ${player.id === current.id ? "active" : ""} ${player.id === viewedId ? "viewed" : ""} ${player.id === playerId ? "mine" : ""}`}
      style={{ "--player": color } as CSSProperties} onClick={() => onView(player.id)} key={player.id}
    >
      <b><span className="player-name"><span className="player-avatar" style={{ borderColor: role?.color ?? "#3d4757" }}>{role?.icon ?? "👤"}</span><span style={{ color }}>{player.name}</span>{player.is_bot && <span className={`bot-badge diff-${player.difficulty}`}>{difficultyLabels[player.difficulty] ?? player.difficulty}</span>}</span><em>🎲 {player.turns} · {scoreOf(player, assets)} оч.</em></b>
      <span>💰 {player.money}　◆ {player.influence}　⚠ {player.scandals}/6　🛡 {player.roofs}</span>
      <small>{role?.title ?? "без роли"} · объектов {player.assets.length}/{player.capacity}{preferred ? ` · цель ${preferred.icon} ${preferred.title}` : ""}</small>
      {player.jail_turns > 0 && <small className="scandal-status">ТЮРЬМА: ходов {player.jail_turns}</small>}
      {player.id === viewedId && player.id !== playerId && <small className="viewing-badge">👁 просмотр бизнеса</small>}
    </button>;
  })}</section>;
}

function DistrictMarket({ game, meta, me, viewed, viewingOther, assets, selectedDistrict, onSelectDistrict, buyActions, busy, onAction }: {
  game: GameState;
  meta: CityMeta;
  me: PlayerState;
  viewed: PlayerState;
  viewingOther: boolean;
  assets: Map<string, AssetMeta>;
  selectedDistrict: string;
  onSelectDistrict: (id: string) => void;
  buyActions: Map<string, LegalAction>;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  return <section className="city-map">
    <h2>Районы и рынок <small className="market-remaining">уникальных объектов в колоде: {game.market_deck_count}</small></h2>
    <div className="district-grid">{meta.districts.map(district => {
      const count = districtCount(viewed, district.id, assets);
      const level = viewed.district_levels[district.id] ?? 0;
      const market = game.market.filter(item => assets.get(item.card_id)?.district === district.id);
      return <article className={`district ${selectedDistrict === district.id ? "selected" : ""}`} style={{ "--district": district.color } as CSSProperties} onClick={() => onSelectDistrict(district.id)} key={district.id}>
        <h3>{district.icon} {district.title}<span className="district-level"><span className="district-objects">{count}/4</span>{count >= 2 && <span className="district-synergy">синергия +{count >= 4 ? 2 : 1}$</span>}<span className={`district-dev ${level ? "active" : ""}`}>{"★".repeat(level)}{"☆".repeat(2 - level)}{level ? ` +${level * 25}%` : ""}</span></span></h3>
        <p>{district.description}</p>
        <div className="market-cards">{market.length ? market.map(item => {
          const asset = assets.get(item.card_id);
          if (!asset) return null;
          const buy = buyActions.get(item.uid);
          const remaining = Math.max(0, item.expires_at_turn - (game.turn_serial ?? 0));
          return <button className={`market-card rarity-${asset.rarity}`} disabled={busy || viewingOther || !buy} onClick={event => { event.stopPropagation(); if (buy) void onAction(buy); }} key={item.uid}>
            <span className="rarity-badge">{rarityLabels[asset.rarity] ?? asset.rarity}</span><b>{asset.title}</b>
            <span>{marketPrice(game, me, asset, meta)}$ · доход {asset.income}$ · ◆{asset.influence}</span><small>{asset.text}</small><small className="market-expiry">⏳ ещё {remaining} ходов</small>
          </button>;
        }) : <span className="empty-district">На рынке пока нет объектов района</span>}</div>
      </article>;
    })}</div>
  </section>;
}

function CardDesk({ game, me, cards, legal, buyActions, busy, onAction, onOffer, labelContext }: {
  game: GameState;
  me: PlayerState;
  cards: Map<string, ActionMeta>;
  legal: LegalAction[];
  buyActions: Map<string, LegalAction>;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
  onOffer: (title: string, actions: LegalAction[]) => void;
  labelContext: Parameters<typeof actionLabel>[1];
}) {
  const playFor = (uid: string) => legal.filter(action => action.type === "play_action_card" && action.payload.card_uid === uid);
  const convertFor = (uid: string, into: string) => legal.find(action => action.type === "convert_action_card" && action.payload.card_uid === uid && action.payload.into === into);
  return <section className="city-cards action-group g-cards">
    <h3 className="group-title">🃏 Карты <span className="group-hint">3$ + 1◆ + действие · резерв {game.action_deck_count}</span></h3>
    <p className="dim card-rule">Рынок обновляется каждый раунд. Розыгрыш бесплатный. Рука {me.hand?.length ?? 0}/3.</p>
    <div className="action-market">{game.action_market.map(cardId => { const card = cards.get(cardId); const buy = buyActions.get(cardId); return <button className={`action-card market-action tone-${card?.tone}`} disabled={busy || !buy} onClick={() => buy && void onAction(buy)} key={cardId}><strong>{card?.title}<em>купить</em></strong><small>{card?.text}</small></button>; })}</div>
    <div className="hand-grid">{me.hand?.map(held => {
      const card = cards.get(held.card_id);
      const variants = playFor(held.uid);
      const money = convertFor(held.uid, "money");
      const influence = convertFor(held.uid, "influence");
      return <article className={`hand-card tone-${card?.tone}`} key={held.uid}>
        <button className="action-card" disabled={busy || variants.length === 0} onClick={() => onOffer(`«${card?.title}» — выберите вариант`, variants)}><strong>{card?.title}<em>{variants.length > 1 ? "выбрать" : "сыграть"}</em></strong><small>{card?.text}</small></button>
        <div><button disabled={busy || !money} onClick={() => money && void onAction(money)}>Продать +1$</button><button disabled={busy || !influence} onClick={() => influence && void onAction(influence)}>Сбросить +1◆</button></div>
        {variants.length > 1 && <small className="variant-preview">{variants.slice(0, 2).map(action => actionLabel(action, labelContext)).join(" · ")}</small>}
      </article>;
    })}{!me.hand?.length && <p className="empty-hand">В руке нет карт</p>}</div>
  </section>;
}

function BusinessBoard({ viewed, me, game, meta, assets, legal, viewingOther, busy, onAction }: {
  viewed: PlayerState;
  me: PlayerState;
  game: GameState;
  meta: CityMeta;
  assets: Map<string, AssetMeta>;
  legal: LegalAction[];
  viewingOther: boolean;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  const actionFor = (type: string, uid: string, kind?: string) => legal.find(action => action.type === type && action.payload.asset_uid === uid && (!kind || action.payload.kind === kind));
  return <section className="business-board">
    <h2>{viewingOther ? `Бизнес: ${viewed.name}` : "Ваш бизнес"} <small>слоты {viewed.assets.length}/{viewed.capacity}</small></h2>
    <div className="active-bonuses"><strong>Активные бонусы</strong><ul>{activeBonuses(viewed, game, meta, assets).map(text => <li key={text}>{text}</li>)}</ul></div>
    <div className="owned-grid">{viewed.assets.map((owned, index) => <OwnedAssetCard key={owned.uid} owned={owned} index={index} owner={viewed} asset={assets.get(owned.card_id)} viewingOther={viewingOther} busy={busy} automate={actionFor("improve_asset", owned.uid, "automate")} scale={actionFor("improve_asset", owned.uid, "scale")} sell={actionFor("sell_asset", owned.uid)} onAction={onAction} />)}{!viewed.assets.length && <p className="empty-business">У игрока пока нет объектов.</p>}</div>
    {!viewingOther && me.assets.length >= me.capacity && <p className="capacity-warning">Все слоты заняты: расширьте бизнес или продайте объект.</p>}
  </section>;
}

function OwnedAssetCard({ owned, index, owner, asset, viewingOther, busy, automate, scale, sell, onAction }: {
  owned: OwnedAsset;
  index: number;
  owner: PlayerState;
  asset?: AssetMeta;
  viewingOther: boolean;
  busy: boolean;
  automate?: LegalAction;
  scale?: LegalAction;
  sell?: LegalAction;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  if (!asset) return null;
  const managed = index < owner.capacity;
  return <article className={`owned-asset rarity-${asset.rarity} ${owned.blocked ? "blocked" : ""} ${!managed ? "unmanaged" : ""}`}>
    <header><span className="rarity-badge">{rarityLabels[asset.rarity]}</span><span>{owned.blocked ? "🔒 заблокирован" : owned.automated ? "⚙ автоматизирован" : owned.scaled ? "🔧 модернизирован" : "работает"}</span></header>
    <h3>{asset.title}</h3><p>{asset.income}$ базовый доход · ◆{asset.influence}</p><small>{asset.text}</small>
    {!viewingOther && <div className="owned-actions"><button disabled={busy || !automate} onClick={() => automate && void onAction(automate)}>⚙ Авто · 5$</button><button disabled={busy || !scale} onClick={() => scale && void onAction(scale)}>🔧 Доход · 4$</button><button className="danger" disabled={busy || !sell} onClick={() => sell && void onAction(sell)}>Продать</button></div>}
  </article>;
}

function DecisionPanel({ game, me, meta, roles, districts, legal, selectedDistrict, busy, onAction, onOffer, labelContext }: {
  game: GameState;
  me: PlayerState;
  meta: CityMeta;
  roles: Map<string, { id: string; title: string; icon: string; color: string; passive: string; power: string }>;
  districts: Map<string, { title: string }>;
  legal: LegalAction[];
  selectedDistrict: string;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
  onOffer: (title: string, actions: LegalAction[]) => void;
  labelContext: Parameters<typeof actionLabel>[1];
}) {
  const find = (type: string, predicate?: (action: LegalAction) => boolean) => legal.find(action => action.type === type && (!predicate || predicate(action)));
  const all = (type: string, predicate?: (action: LegalAction) => boolean) => legal.filter(action => action.type === type && (!predicate || predicate(action)));
  const current = game.players[game.current_player_index];
  const endTurn = find("end_turn");
  const resolve = all("resolve_decision");
  const roleHolder = (roleId: string) => game.players.find(player => player.role === roleId);
  const roleCost = (roleId: string) => roleHolder(roleId) ? game.role_price * 3 : game.role_price;
  const districtAction = find("develop_district", action => action.payload.district === selectedDistrict);
  const displayRoleId = me.role ?? me.copied_role;
  const powers = Array.from(new Set([
    ...(rolePowers[me.role ?? ""] ?? []),
    ...(rolePowers[me.copied_role ?? ""] ?? []),
    ...all("use_role_power").map(action => stringValue(action.payload.power)),
  ])).filter(Boolean);
  const dotCount = Math.max(3, game.actions_left);
  return <aside className="city-actions">
    <div className="actions-head"><h2>🎛️ Решения</h2><div className={`action-tokens ${game.actions_left === 0 ? "spent" : ""}`}><span className="token-label">Действий</span><span className="token-dots">{Array.from({ length: dotCount }).map((_, index) => <i className={index < game.actions_left ? "on" : "off"} key={index} />)}</span><b>{game.actions_left}</b>{game.investment_actions > 0 && <span className="token-invest">+{game.investment_actions} 💼</span>}</div></div>
    {busy && <p className="bot-action-note">Сервер выполняет команду и ходы ботов…</p>}
    {!busy && legal.length === 0 && game.status === "playing" && <p className="bot-action-note">Ожидаем ход игрока <b>{current.name}</b>.</p>}
    {game.pending_decision && <div className="pending-decision"><strong>Требуется решение</strong><span>{game.pending_decision.type === "roof_defence" ? "Использовать Крышу для защиты?" : game.pending_decision.type}</span>{resolve.map(action => <ActionButton action={action} context={labelContext} busy={busy} onAction={onAction} key={actionIdentity(action)} />)}</div>}

    <div className="action-group g-city"><h3 className="group-title">🏙️ Город <span className="group-hint">доход и развитие</span></h3>
      <StaticAction action={find("basic_action", item => item.payload.kind === "work")} label="💵 Городской заказ: +2$" busy={busy} onAction={onAction} />
      <StaticAction action={find("basic_action", item => item.payload.kind === "campaign")} label="📣 Кампания: 2$ → 2◆" busy={busy} onAction={onAction} />
      <StaticAction action={find("city_project")} label="🏗️ Городской проект: 3◆ → 6 очков" busy={busy} onAction={onAction} />
      <StaticAction action={find("buy_capacity")} label={`📦 ${capacityLabel(me)}`} busy={busy} onAction={onAction} />
      <StaticAction action={districtAction} label={`⭐ Развить «${districts.get(selectedDistrict)?.title}»`} busy={busy} onAction={onAction} />
    </div>

    <div className="action-group g-roles"><h3 className="group-title">🏷️ Роли <span className="group-hint">свободная {game.role_price}◆ · переворот {game.role_price * 3}◆</span></h3><div className="role-market">{meta.roles.map(role => {
      const claim = find("claim_role", action => action.payload.role_id === role.id);
      const holder = roleHolder(role.id);
      return <button disabled={busy || !claim} onClick={() => claim && void onAction(claim)} style={{ borderColor: role.color }} title={role.passive} key={role.id}><span className="role-line"><span className="role-icon" style={{ borderColor: role.color }}>{role.icon}</span>{role.title} · {roleCost(role.id)}◆</span><small>{holder ? `занята: ${holder.name}` : role.passive}</small></button>;
    })}</div>
      {displayRoleId && <div className="role-powers" style={{ borderColor: roles.get(displayRoleId)?.color }}><strong>{roles.get(displayRoleId)?.icon} Способности: {roles.get(displayRoleId)?.title}{me.copied_role && me.role !== me.copied_role ? " + временный мандат" : ""}</strong><small>{roles.get(displayRoleId)?.power}</small>{powers.map(power => {
        const variants = all("use_role_power", action => action.payload.power === power);
        return <button className={power.includes("racket") || power.includes("sanction") || power.includes("scam") ? "danger" : ""} disabled={busy || variants.length === 0} onClick={() => onOffer(powerLabels[power] ?? power, variants)} key={power}>{powerLabels[power] ?? power}{variants.length > 1 ? " → выбрать" : ""}</button>;
      })}</div>}
    </div>

    <div className="action-group g-grey"><h3 className="group-title">🌒 Серые операции <span className="group-hint">через теневые объекты</span></h3><p className="dim card-rule">Страховка Крышей защищает от провала операции.</p>{Object.entries(greyOperationLabels).map(([assetId, label]) => {
      const variants = all("grey_operation", action => action.payload.asset_id === assetId);
      return <button disabled={busy || variants.length === 0} onClick={() => onOffer(label, variants)} key={assetId}>{label}{variants.length ? " → выбрать вариант" : ` 🔒 нужен объект`}</button>;
    })}</div>

    <div className="action-group g-defence"><h3 className="group-title">🛡️ Защита и репутация</h3><StaticAction action={find("crisis_pr")} label="🧯 Антикризисный PR: 4$ → −1⚠" busy={busy} onAction={onAction} /><StaticAction action={find("buy_roof")} label={`🛡️ Купить Крышу (${me.role === "mafia" ? 2 : 3}$)`} busy={busy} onAction={onAction} /></div>
    <button className="end-turn" disabled={busy || !endTurn} onClick={() => endTurn && void onAction(endTurn)}>✅ Завершить ход</button>
  </aside>;
}

function StaticAction({ action, label, busy, onAction }: { action?: LegalAction; label: string; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  return <button disabled={busy || !action} onClick={() => action && void onAction(action)}>{label}</button>;
}

function ActionButton({ action, context, busy, onAction }: { action: LegalAction; context: Parameters<typeof actionLabel>[1]; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  return <button disabled={busy} onClick={() => void onAction(action)}>{actionLabel(action, context)}</button>;
}

function Chronicle({ game, meta }: { game: GameState; meta: CityMeta }) {
  return <aside className="city-log"><h2>📜 Хроника <small>события партии</small></h2><div className="log-scroll">{[...game.event_log].reverse().slice(0, 80).map(event => <p className={`log-entry ${event.actor_id ? "log-player" : "log-system"}`} key={event.seq}><b>#{event.seq}</b> {describeEvent(event, game, meta)}</p>)}</div></aside>;
}

function ChoiceModal({ choice, game, labelContext, busy, onClose, onAction }: {
  choice: ChoiceState;
  game: GameState;
  labelContext: Parameters<typeof actionLabel>[1];
  busy: boolean;
  onClose: () => void;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="choice-modal panel" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}><header><div><small>Выбор команды</small><h2>{choice.title}</h2></div><button onClick={onClose}>✕</button></header><div className="choice-list">{choice.actions.map(action => {
    const target = game.players.find(player => player.id === action.payload.target_id);
    return <button disabled={busy} onClick={() => void onAction(action)} key={actionIdentity(action)}>{target && <span className="choice-avatar">👤</span>}<span><strong>{actionLabel(action, labelContext)}</strong>{Boolean(action.payload.protect_failure) && <small>При провале будет потрачена Крыша</small>}</span></button>;
  })}</div></section></div>;
}

function FinishPanel({ ranking, scores, assets, onExit }: { ranking: PlayerState[]; scores?: Record<string, number>; assets: Map<string, AssetMeta>; onExit: () => void }) {
  return <section className="city-finish"><h2>🏆 Итоги города</h2><div>{ranking.map((player, index) => <p key={player.id}><b>{index + 1}. {player.name}</b><span>{scores?.[player.id] ?? scoreOf(player, assets)} очков</span></p>)}</div><button className="primary" onClick={onExit}>Вернуться к комнатам</button></section>;
}

function Rules({ rolePrice, onClose }: { rolePrice: number; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="rules-modal panel" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}><header><h2>Как играть</h2><button onClick={onClose}>✕</button></header><div className="help-grid"><article><h3>Цель</h3><p>К концу партии набрать больше очков: деньги, влияние, объекты, проекты и роль увеличивают результат, скандалы уменьшают.</p></article><article><h3>Ход</h3><p>Обычные действия расходуются на город, роли, защиту и серые операции. Инвестиционные — только на объекты, слоты и улучшения.</p></article><article><h3>Районы</h3><p>Два объекта включают синергию +1$, четыре — +2$. Развитие района повышает базовый доход объектов всем игрокам.</p></article><article><h3>Роли</h3><p>Свободная роль стоит {rolePrice}◆, захват занятой — {rolePrice * 3}◆. Роли дают пассивный бонус и уникальные способности.</p></article><article><h3>Карты</h3><p>Покупка стоит 3$ + 1◆ и действие. Карта хранится в руке, разыгрывается бесплатно либо конвертируется в ресурс.</p></article><article><h3>Крыша и скандалы</h3><p>Крыша защищает от направленных эффектов и страхует серые операции. При 5 скандалах роль теряется, следующий ведёт в тюрьму.</p></article></div></section></div>;
}
