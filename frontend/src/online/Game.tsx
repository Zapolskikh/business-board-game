import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ApiError, cityApi } from "./api";
import {
  actionIdentity,
  actionLabel,
  activeBonuses,
  assetEffectLines,
  capacityLabel,
  describeEventSegments,
  difficultyLabels,
  districtCount,
  greyOperationLabels,
  marketPrice,
  numberValue,
  powerLabels,
  rarityLabels,
  scoreOf,
  stringValue,
} from "./gameUi";
import { buildRulesHtml } from "./rulesDocument";
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
type MobileGameTab = "city" | "players" | "actions" | "log" | "menu";

const playerColors = ["#58a6ff", "#3fb950", "#f0883e", "#d65db1", "#e3b341", "#9b6ee7"];
const rolePowers: Record<string, string[]> = {
  capitalist: ["capitalist_financing"],
  politician: ["politician_tax", "politician_cleanup"],
  journalist: ["journalist_inflate", "journalist_publish"],
  mafia: ["mafia_racket", "mafia_sweep", "mafia_cleanup"],
  military: ["military_sanction"],
  fraudster: ["fraudster_cleanup", "fraudster_crypto_scam", "fraudster_forge"],
};

const powerDescriptions: Record<string, string> = {
  capitalist_financing: "Один раз за ход: потратить 3◆ и получить 1 инвестиционное действие для покупки объекта, слота или улучшения.",
  politician_tax: "Один раз за ход: потратить 4◆ и получить по 1$ за каждый объект всех игроков в выбранном районе.",
  politician_cleanup: "Один раз за ход: потратить 2◆ и снять 1 свой скандал.",
  journalist_inflate: "Один раз за ход: вы и выбранный соперник получаете по 1 скандалу. Внимание: на 5 скандалах теряется роль, на 6 — тюрьма (пропуск хода).",
  journalist_publish: "Один раз за ход: потратить 3◆ и дать выбранному сопернику 1 скандал.",
  mafia_racket: "Один раз за ход и за 1 действие: нужен активный объект Серого сектора. Базово отбирает до 2$, сумма растёт от раунда, ваших объектов и лидерства цели; её Крыша отменяет рэкет.",
  mafia_sweep: "Один раз за ход и за 1 действие: потратить 1 Крышу, после чего каждый игрок теряет по 1 Крыше.",
  mafia_cleanup: "Один раз за ход: снять до 2 скандалов, потратив 1 Крышу либо 3$ при наличии административного объекта.",
  military_sanction: "Один раз за ход и за 1 действие: цель должна иметь минимум 2 скандала. Снимает ей скандал и взыскивает деньги либо объект; Крыша принимает удар.",
  fraudster_cleanup: "За 1 действие снять 1 свой скандал.",
  fraudster_crypto_scam: "Один раз за ход и за 1 действие: нужна активная Городская криптобиржа. Украсть у каждого соперника выбранную сумму и получить столько же скандалов (Аферист — на 1 меньше со снижением). Внимание: на 5 скандалах теряется роль, на 6 — тюрьма (пропуск хода), поэтому большая сумма может вас посадить.",
  fraudster_forge: "Один раз за ход: 1 действие, 5◆ и +2 скандала — гарантированно получить выбранную роль со следующего хода. Внимание: если два скандала доведут вас до 5 — роль потеряется, до 6 — тюрьма.",
};

const greyOperationInfo: Record<string, { asset: string; effect: (round: number) => string; chance: number; failure: string }> = {
  cash: {
    asset: "Сеть наличных обменников",
    effect: round => `2◆ → ${5 + round}$`,
    chance: 85,
    failure: "При успехе: +1 скандал. При провале: −3$ и −3◆. Скандалы: Аферист +1, остальные +2. На 5 скандалах теряется роль, на 6 — тюрьма.",
  },
  market: {
    asset: "Ночной рынок",
    effect: round => `украсть у цели до ${3 + Math.floor(round / 2)}$`,
    chance: 75,
    failure: "При успехе: +1 скандал. При провале теряется Крыша, если она есть. Скандалы: Аферист +1, остальные +2. На 5 скандалах теряется роль, на 6 — тюрьма.",
  },
  crypto: {
    asset: "Городская криптобиржа",
    effect: round => `получить ${6 + round}$ и лишить лидера до ${2 + Math.floor(round / 2)}$`,
    chance: 60,
    failure: "При успехе: +2 скандала. При провале: −5$ и сброс улучшений криптобиржи. Скандалы при провале: Аферист +1, остальные +3. На 5 скандалах теряется роль, на 6 — тюрьма.",
  },
  datacenter: {
    asset: "Нелегальный дата-центр",
    effect: () => "заблокировать самый доходный объект выбранного соперника на раунд",
    chance: 55,
    failure: "При успехе: +2 скандала. При провале дата-центр блокируется и теряет улучшение. Скандалы при провале: Аферист +1, остальные +3. На 5 скандалах теряется роль, на 6 — тюрьма.",
  },
};

export function Game({ roomId, password, playerId, meta, onExit }: Props) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState(meta.districts[0]?.id ?? "business");
  const [viewedPlayerId, setViewedPlayerId] = useState(playerId);
  const [choice, setChoice] = useState<ChoiceState | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileGameTab>("city");
  const [showMobileEvent, setShowMobileEvent] = useState(false);

  const selectMobileTab = useCallback((tab: MobileGameTab) => {
    setMobileTab(tab);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

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
        <p>{room.name} · Раунд {game.round_number}/{game.max_rounds} · Ход: <b>{current.name}</b> · Действий: <b>{game.actions_left}</b>{game.investment_actions > 0 && <> · Инвестиционных: <b className="investment-actions">{game.investment_actions}</b></>}<button className="mobile-event-trigger" onClick={() => setShowMobileEvent(value => !value)} aria-expanded={showMobileEvent}> · 📅 {event?.title ?? game.event_id}</button></p>
        {showMobileEvent && <button className="mobile-event-detail" onClick={() => setShowMobileEvent(false)}><strong>{event?.title ?? game.event_id}</strong><span>{event?.text}</span></button>}
      </div>
      <div className="city-event" title="Событие действует всю партию">
        <strong>📰 {event?.title ?? game.event_id}</strong><span>{event?.text}</span>
      </div>
      <div className="city-head-buttons"><button onClick={() => setShowRules(true)}>📖 Правила</button><button onClick={onExit}>← Комнаты</button></div>
    </header>

    {error && <p className="game-error">{error}</p>}
    {game.status === "finished" && <FinishPanel ranking={ranking} scores={game.final_scores} assets={assets} onExit={onExit} />}

    <main className="city-layout" data-mobile-tab={mobileTab}>
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

      <section className="mobile-game-menu">
        <h2>Меню</h2>
        <button onClick={() => setShowRules(true)}><span>📖</span><strong>Правила игры</strong><small>Механики, роли, объекты и события</small></button>
        <button onClick={onExit}><span>🏠</span><strong>Вернуться в комнаты</strong><small>Выйти из текущего игрового экрана</small></button>
      </section>
    </main>

    <MobileGameTabs active={mobileTab} onChange={selectMobileTab} actions={game.actions_left} events={game.event_log.length} />

    {choice && <ChoiceModal choice={choice} game={game} labelContext={labelContext} busy={busy} onClose={() => setChoice(null)} onAction={send} />}
    {showRules && <RulesModal html={buildRulesHtml(meta, game.role_price)} onClose={() => setShowRules(false)} />}
  </div>;
}

function MobileGameTabs({ active, onChange, actions, events }: {
  active: MobileGameTab;
  onChange: (tab: MobileGameTab) => void;
  actions: number;
  events: number;
}) {
  const tabs: { id: MobileGameTab; icon: string; label: string; badge?: number }[] = [
    { id: "city", icon: "🏙️", label: "Город" },
    { id: "players", icon: "👥", label: "Игроки" },
    { id: "actions", icon: "🎛️", label: "Ход", badge: actions > 0 ? actions : undefined },
    { id: "log", icon: "📜", label: "Хроника", badge: events > 0 ? Math.min(events, 99) : undefined },
    { id: "menu", icon: "☰", label: "Меню" },
  ];
  return <nav className="mobile-game-tabs" aria-label="Разделы игры">{tabs.map(tab => <button
    key={tab.id}
    className={`mobile-game-tab ${active === tab.id ? "active" : ""}`}
    onClick={() => onChange(tab.id)}
    aria-current={active === tab.id ? "page" : undefined}
  >
    <span className="mobile-tab-icon">{tab.icon}{tab.badge !== undefined && <i>{tab.badge}</i>}</span>
    <span>{tab.label}</span>
  </button>)}</nav>;
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
      style={{ "--player": color } as CSSProperties} onClick={() => onView(player.id)} title={`Показать бизнес игрока «${player.name}»`} key={player.id}
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
          const price = marketPrice(game, me, asset, meta);
          const effectLines = assetEffectLines(asset, me, game, meta, assets, { includeSynergy: true });
          return <button className={`market-card rarity-${asset.rarity}`} disabled={busy || viewingOther || !buy} onClick={event => { event.stopPropagation(); if (buy) void onAction(buy); }} title={`Купить за ${price}$. Занимает свободный слот и расходует обычное либо инвестиционное действие. ${asset.text}`} key={item.uid}>
            <span className="rarity-badge">{rarityLabels[asset.rarity] ?? asset.rarity}</span><b>{asset.title}</b>
            <span className="asset-stats">{price}$ · доход <b className={asset.income > 0 ? "stat-income on" : "stat-income"}>{asset.income}$</b> · <b className={asset.influence > 0 ? "stat-inf on" : "stat-inf"}>◆{asset.influence}</b></span>
            {effectLines.length > 0
              ? <ul className="asset-effects">{effectLines.map((line, index) => <li key={index} className={line.active ? "effect-active" : "effect-idle"}>{line.text}{line.boosted && <span className="effect-boost">⚙×2</span>}</li>)}</ul>
              : asset.text && <small className="asset-summary">{asset.text}</small>}
            <small className="market-expiry">⏳ ещё {remaining} ходов</small>
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
    <div className="action-market">{game.action_market.map(cardId => { const card = cards.get(cardId); const buy = buyActions.get(cardId); return <button className={`action-card market-action tone-${card?.tone}`} disabled={busy || !buy} onClick={() => buy && void onAction(buy)} title={`Покупка стоит 3$ + 1◆ и расходует 1 действие. ${card?.text ?? ""}`} key={cardId}><strong>{card?.title}<em>купить</em></strong><small>{card?.text}</small></button>; })}</div>
    <div className="hand-grid">{me.hand?.map(held => {
      const card = cards.get(held.card_id);
      const variants = playFor(held.uid);
      const money = convertFor(held.uid, "money");
      const influence = convertFor(held.uid, "influence");
      return <article className={`hand-card tone-${card?.tone}`} key={held.uid}>
        <button className="action-card" disabled={busy || variants.length === 0} onClick={() => onOffer(`«${card?.title}» — выберите вариант`, variants)} title={`Разыграть бесплатно; разрешена одна карта за ход. ${card?.text ?? ""}`}><strong>{card?.title}<em>{variants.length > 1 ? "выбрать" : "сыграть"}</em></strong><small>{card?.text}</small></button>
        <div><button disabled={busy || !money} onClick={() => money && void onAction(money)} title="Удалить карту из руки и сразу получить 1$; действие не расходуется.">Продать +1$</button><button disabled={busy || !influence} onClick={() => influence && void onAction(influence)} title="Удалить карту из руки и сразу получить 1◆; действие не расходуется.">Сбросить +1◆</button></div>
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
  const upgradeDiscount = numberValue(game.turn_flags.upgrade_discount);
  return <section className="business-board">
    <h2>{viewingOther ? `Бизнес: ${viewed.name}` : "Ваш бизнес"} <small>слоты {viewed.assets.length}/{viewed.capacity}</small></h2>
    <div className="active-bonuses"><strong>Активные бонусы</strong><ul>{activeBonuses(viewed, game, meta, assets).map(item => <li key={item.text} className={item.active ? "bonus-active" : "bonus-inactive"}>{item.text}</li>)}</ul></div>
    <div className="owned-grid">{viewed.assets.map((owned, index) => {
      const assetMeta = assets.get(owned.card_id);
      const districtInfo = meta.districts.find(d => d.id === assetMeta?.district);
      const effectLines = assetMeta ? assetEffectLines(assetMeta, viewed, game, meta, assets, { automated: owned.automated, includeSynergy: true }) : [];
      return <OwnedAssetCard key={owned.uid} owned={owned} index={index} owner={viewed} asset={assetMeta} districtInfo={districtInfo} effectLines={effectLines} viewingOther={viewingOther} busy={busy} automateCost={Math.max(1, 5 - upgradeDiscount)} scaleCost={Math.max(1, 4 - upgradeDiscount)} automate={actionFor("improve_asset", owned.uid, "automate")} scale={actionFor("improve_asset", owned.uid, "scale")} sell={actionFor("sell_asset", owned.uid)} onAction={onAction} />;
    })}{!viewed.assets.length && <p className="empty-business">У игрока пока нет объектов.</p>}</div>
    {!viewingOther && me.assets.length >= me.capacity && <p className="capacity-warning">Все слоты заняты: расширьте бизнес или продайте объект.</p>}
  </section>;
}

function OwnedAssetCard({ owned, index, owner, asset, districtInfo, effectLines, viewingOther, busy, automateCost, scaleCost, automate, scale, sell, onAction }: {
  owned: OwnedAsset;
  index: number;
  owner: PlayerState;
  asset?: AssetMeta;
  districtInfo?: { title: string; icon: string; color: string };
  effectLines: { text: string; active: boolean; boosted: boolean }[];
  viewingOther: boolean;
  busy: boolean;
  automateCost: number;
  scaleCost: number;
  automate?: LegalAction;
  scale?: LegalAction;
  sell?: LegalAction;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  if (!asset) return null;
  const managed = index < owner.capacity;
  const sellValue = Math.floor(asset.cost / 2) + Number(owned.automated) * 2 + Number(owned.scaled) * 2;
  return <article className={`owned-asset rarity-${asset.rarity} ${owned.blocked ? "blocked" : ""} ${!managed ? "unmanaged" : ""}`}>
    <header>
      <span className="rarity-badge">{rarityLabels[asset.rarity]}</span>
      {districtInfo && <span className="asset-district" style={{ color: districtInfo.color }}>{districtInfo.icon} {districtInfo.title}</span>}
      <span>{owned.blocked ? "🔒 заблокирован" : owned.automated ? "⚙ автоматизирован" : owned.scaled ? "🔧 модернизирован" : "работает"}</span>
    </header>
    <h3>{asset.title}</h3>
    <p className="asset-stats"><b className="stat-income on">{asset.income + (owned.scaled ? 2 : 0)}$</b> доход{owned.scaled ? ` (базовый ${asset.income}$ +2 масштаб)` : ""} · <b className={asset.influence > 0 ? "stat-inf on" : "stat-inf"}>◆{asset.influence}</b></p>
    {effectLines.length > 0
      ? <ul className="asset-effects">{effectLines.map((line, i) => <li key={i} className={line.active ? "effect-active" : "effect-idle"}>{line.text}{line.boosted && <span className="effect-boost">⚙×2</span>}</li>)}</ul>
      : asset.text && <small className="asset-summary">{asset.text}</small>}
    {!viewingOther && <div className="owned-actions">
      <button disabled={busy || !automate} onClick={() => automate && void onAction(automate)} title="Автоматизация удваивает районную синергию, ролевой и специальный бонус объекта, а также его активный бонус влияния. Базовый доход не удваивается. Объект можно улучшить только один раз."><strong>⚙ Автоматизация · {automateCost}$</strong><small>Удваивает бонусы объекта</small></button>
      <button disabled={busy || !scale} onClick={() => scale && void onAction(scale)} title="Масштабирование навсегда добавляет +2$ к базовому доходу объекта. Объект можно улучшить только один раз."><strong>🔧 Масштабирование · {scaleCost}$</strong><small>+2$ к базовому доходу</small></button>
      <button className="danger" disabled={busy || !sell} onClick={() => sell && void onAction(sell)} title={`Продать объект за ${sellValue}$. Продажа расходует 1 обычное действие и освобождает слот.`}>Продать · {sellValue}$</button>
    </div>}
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
  const greyRequirement = (assetId: string): string => {
    const info = greyOperationInfo[assetId];
    const hasAsset = me.assets.some(asset => asset.card_id === assetId && !asset.blocked);
    if (!hasAsset) return `🔒 Нужен активный объект «${info.asset}»`;
    if (game.actions_left < 1) return "🔒 Нужно 1 обычное действие";
    if (assetId === "cash" && me.influence < 2) return "🔒 Нужно 2◆";
    if (assetId === "datacenter" && !game.players.some(player => player.id !== me.id && player.assets.length > 0)) return "🔒 У соперников нет объектов для взлома";
    return "Недоступно в текущий ход";
  };
  return <aside className="city-actions">
    <div className="actions-head"><h2>🎛️ Решения</h2><div className={`action-tokens ${game.actions_left === 0 ? "spent" : ""}`}><span className="token-label">Действий</span><span className="token-dots">{Array.from({ length: dotCount }).map((_, index) => <i className={index < game.actions_left ? "on" : "off"} key={index} />)}</span><b>{game.actions_left}</b>{game.investment_actions > 0 && <span className="token-invest">+{game.investment_actions} 💼</span>}</div></div>
    {busy && <p className="bot-action-note">Сервер выполняет команду и ходы ботов…</p>}
    {!busy && legal.length === 0 && game.status === "playing" && <p className="bot-action-note">Ожидаем ход игрока <b>{current.name}</b>.</p>}
    {game.pending_decision && <div className="pending-decision"><strong>Требуется решение</strong><span>{game.pending_decision.type === "roof_defence" ? "Использовать Крышу для защиты?" : game.pending_decision.type}</span>{resolve.map(action => <ActionButton action={action} context={labelContext} busy={busy} onAction={onAction} key={actionIdentity(action)} />)}</div>}

    <div className="action-group g-city"><h3 className="group-title">🏙️ Город <span className="group-hint">доход и развитие</span></h3>
      <StaticAction action={find("basic_action", item => item.payload.kind === "work")} label="💵 Городской заказ: +2$" tooltip="Потратить 1 обычное действие и сразу получить 2$." busy={busy} onAction={onAction} />
      <StaticAction action={find("basic_action", item => item.payload.kind === "campaign")} label="📣 Кампания: 2$ → 2◆" tooltip="Потратить 1 обычное действие и 2$, чтобы сразу получить 2◆ влияния." busy={busy} onAction={onAction} />
      <StaticAction action={find("city_project")} label="🏗️ Городской проект: 3◆ → 6 очков" tooltip="Потратить 1 обычное действие и 3◆. Проект навсегда добавляет 6 очков к итоговому результату." busy={busy} onAction={onAction} />
      <StaticAction action={find("buy_capacity")} label={`📦 ${capacityLabel(me)}`} tooltip="Купить постоянный дополнительный слот бизнеса. Можно потратить обычное либо инвестиционное действие; максимум 6 слотов." busy={busy} onAction={onAction} />
      <StaticAction action={districtAction} label={`⭐ Развить «${districts.get(selectedDistrict)?.title}»`} tooltip="Нужно минимум 2 своих объекта в выбранном районе. Потратить 1 действие и до 2$: +25% к базовому доходу всех ваших объектов района и +1◆. Максимум 2 уровня." busy={busy} onAction={onAction} />
    </div>

    <div className="action-group g-roles"><h3 className="group-title">🏷️ Роли <span className="group-hint">свободная {game.role_price}◆ · переворот {game.role_price * 3}◆</span></h3><div className="role-market">{meta.roles.map(role => {
      const claim = find("claim_role", action => action.payload.role_id === role.id);
      const holder = roleHolder(role.id);
      return <button disabled={busy || !claim} onClick={() => claim && void onAction(claim)} style={{ borderColor: role.color }} title={`${role.passive} Способность: ${role.power} Получение роли расходует 1 обычное действие и ${roleCost(role.id)}◆.${holder ? ` Сейчас роль у ${holder.name}; его Крыша или судебный запрет могут заблокировать захват.` : ""}`} key={role.id}><span className="role-line"><span className="role-icon" style={{ borderColor: role.color }}>{role.icon}</span>{role.title} · {roleCost(role.id)}◆</span><small>{holder ? `занята: ${holder.name}` : role.passive}</small></button>;
    })}</div>
      {displayRoleId && <div className="role-powers" style={{ borderColor: roles.get(displayRoleId)?.color }}><strong>{roles.get(displayRoleId)?.icon} Способности: {roles.get(displayRoleId)?.title}{me.copied_role && me.role !== me.copied_role ? " + временный мандат" : ""}</strong><small>{roles.get(displayRoleId)?.power}</small>{powers.map(power => {
        const variants = all("use_role_power", action => action.payload.power === power);
        return <button className={power.includes("racket") || power.includes("sanction") || power.includes("scam") ? "danger" : ""} disabled={busy || variants.length === 0} onClick={() => onOffer(powerLabels[power] ?? power, variants)} title={powerDescriptions[power]} key={power}>{powerLabels[power] ?? power}{variants.length > 1 ? " → выбрать" : ""}</button>;
      })}</div>}
    </div>

    <div className="action-group g-grey"><h3 className="group-title">🌒 Серые операции <span className="group-hint">через специальные объекты</span></h3><p className="dim card-rule">Каждая операция требует свой активный объект и 1 обычное действие. При выборе можно застраховать провал Крышей.</p>{Object.entries(greyOperationLabels).map(([assetId, label]) => {
      const variants = all("grey_operation", action => action.payload.asset_id === assetId);
      const info = greyOperationInfo[assetId];
      const effect = info.effect(game.round_number);
      return <button className="described-action" disabled={busy || variants.length === 0} onClick={() => onOffer(label, variants)} title={`Требуется «${info.asset}». Эффект при успехе: ${effect}. Базовый шанс успеха ${info.chance}%; у Афериста он может быть выше. ${info.failure} Страховка при провале тратит 1 Крышу и отменяет денежный либо объектный штраф, но скандалы всё равно начисляются и действие расходуется.`} key={assetId}><strong>{label}</strong><small>{variants.length ? `${effect} · шанс от ${info.chance}%` : greyRequirement(assetId)}</small></button>;
    })}</div>

    <div className="action-group g-defence"><h3 className="group-title">🛡️ Защита и репутация</h3><StaticAction action={find("crisis_pr")} label="🧯 Антикризисный PR: 4$ → −1⚠" tooltip="Потратить 1 обычное действие и 4$, чтобы снять 1 свой скандал." busy={busy} onAction={onAction} /><StaticAction action={find("buy_roof")} label={`🛡️ Купить Крышу (${me.role === "mafia" ? 2 : 3}$)`} tooltip="Потратить 1 обычное действие и деньги. Крыша может отменить направленную карту, поглотить рэкет или застраховать провал серой операции; обычно лимит 1, у Мафиози 2." busy={busy} onAction={onAction} /></div>
    <button className="end-turn" disabled={busy || !endTurn} onClick={() => endTurn && void onAction(endTurn)} title="Завершить текущий ход. Неиспользованные обычные действия пропадут, кроме разрешённого переносимого действия; затем сервер выполнит ходы ботов.">✅ Завершить ход</button>
  </aside>;
}

function StaticAction({ action, label, tooltip, busy, onAction }: { action?: LegalAction; label: string; tooltip: string; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  return <button disabled={busy || !action} onClick={() => action && void onAction(action)} title={tooltip}>{label}</button>;
}

function ActionButton({ action, context, busy, onAction }: { action: LegalAction; context: Parameters<typeof actionLabel>[1]; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  const label = actionLabel(action, context);
  return <button disabled={busy} onClick={() => void onAction(action)} title={label}>{label}</button>;
}

function Chronicle({ game, meta }: { game: GameState; meta: CityMeta }) {
  return <aside className="city-log"><h2>📜 Хроника <small>события партии</small></h2><div className="log-scroll">{[...game.event_log].reverse().slice(0, 80).map(event => <p className={`log-entry ${event.actor_id ? "log-player" : "log-system"}`} key={event.seq}><b>#{event.seq}</b>{" "}{describeEventSegments(event, game, meta).map((segment, index) => {
    if (segment.kind === "player") return <span className="log-name" style={{ color: segment.color }} key={index}>{segment.text}</span>;
    if (segment.kind === "num") return <span className={`log-num log-num-${segment.tone}`} key={index}>{segment.text}</span>;
    return <span key={index}>{segment.text}</span>;
  })}</p>)}</div></aside>;
}

function RulesModal({ html, onClose }: { html: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);
  return <div className="rules-fullscreen" role="dialog" aria-modal="true" aria-label="Правила игры">
    <button className="rules-close" onClick={onClose} aria-label="Закрыть правила">✕ Закрыть</button>
    <iframe className="rules-frame" srcDoc={html} title="Правила игры" />
  </div>;
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
    const label = actionLabel(action, labelContext);
    return <button disabled={busy} onClick={() => void onAction(action)} title={label} key={actionIdentity(action)}>{target && <span className="choice-avatar">👤</span>}<span><strong>{label}</strong>{Boolean(action.payload.protect_failure) && <small>При провале Крыша отменит материальный штраф; скандалы останутся</small>}</span></button>;
  })}</div></section></div>;
}

function FinishPanel({ ranking, scores, assets, onExit }: { ranking: PlayerState[]; scores?: Record<string, number>; assets: Map<string, AssetMeta>; onExit: () => void }) {
  return <section className="city-finish"><h2>🏆 Итоги города</h2><div>{ranking.map((player, index) => <p key={player.id}><b>{index + 1}. {player.name}</b><span>{scores?.[player.id] ?? scoreOf(player, assets)} очков</span></p>)}</div><button className="primary" onClick={onExit}>Вернуться к комнатам</button></section>;
}
