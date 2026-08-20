import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ApiError, cityApi } from "./api";
import {
  actionIdentity,
  actionLabel,
  activeBonuses,
  assetEffectLines,
  assetHints,
  assetPoints,
  buildGameLogMarkdown,
  campaignTiers,
  capacityLabel,
  describeEventSegments,
  difficultyLabels,
  districtCount,
  forecastRows,
  greyOperationInfo,
  greyOperationDistricts,
  greyOperationLabels,
  influencePerPoint,
  launderingCost,
  marketPrice,
  marketRerollCost,
  moneyPerPoint,
  powerLabels,
  cleanupOffer,
  cleanupPowerFor,
  projectPerkText,
  projectRequirementText,
  projectRerollMoney,
  rarityLabels,
  roofCost,
  scoreOf,
  stringValue,
} from "./gameUi";
import type { AssetHint } from "./gameUi";
import { buildRulesHtml } from "./rulesDocument";
import type {
  ActionMeta,
  AssetMeta,
  CityMeta,
  GameState,
  LegalAction,
  OwnedAsset,
  PlayerState,
  ProjectMeta,
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
// Cleanups are missing on purpose: they all live on the single 🧯 button in «Защита и репутация»,
// which substitutes the price of whichever role the viewer holds.
const rolePowers: Record<string, string[]> = {
  capitalist: [],
  politician: [],
  journalist: ["journalist_inflate", "journalist_publish"],
  mafia: ["mafia_racket"],
  military: ["military_sanction"],
  fraudster: ["fraudster_crypto_scam"],
};

const powerDescriptions: Record<string, string> = {
  politician_cleanup: "За 1 действие: потратить 2◆ и снять 1 свой скандал. Ограничения по числу применений нет — только действия.",
  journalist_inflate: "Действие не расходуется, один раз за ход: вы и выбранный соперник получаете по 1 скандалу. У Журналиста порог сдвинут: роль теряется на 6 скандалах, тюрьма на 7 — у всех остальных на 5 и 6.",
  journalist_publish: "Действие не расходуется, один раз за ход: потратить 3◆ и дать выбранному сопернику 1 скандал.",
  mafia_racket: "Один раз за ход и за 1 действие: нужен активный объект Серого сектора. Базово отбирает до 2$, сумма растёт от раунда, ваших объектов и лидерства цели; её Крыша отменяет рэкет.",
  mafia_cleanup: "За 1 действие: 3$ и активный административный объект — снять до 2 своих скандалов.",
  military_sanction: "Один раз за ход и за 1 действие: цель должна иметь минимум 2 скандала. Снимает ей скандал и взыскивает деньги либо объект; Крыша принимает удар.",
  fraudster_cleanup: "За 1 действие снять 1 свой скандал.",
  fraudster_crypto_scam: "Один раз за ход и за 1 действие: нужна активная Городская криптобиржа. Украсть у каждого соперника выбранную сумму и получить столько же скандалов (Аферист — на 1 меньше со снижением). Внимание: на 5 скандалах теряется роль, на 6 — тюрьма (пропуск хода), поэтому большая сумма может вас посадить.",
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
  const [seenEvents, setSeenEvents] = useState<number | null>(null);

  const selectMobileTab = useCallback((tab: MobileGameTab) => {
    setMobileTab(tab);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const assets = useMemo(() => new Map(meta.assets.map(asset => [asset.id, asset])), [meta.assets]);
  const cards = useMemo(() => new Map(meta.action_cards.map(card => [card.id, card])), [meta.action_cards]);
  const roles = useMemo(() => new Map(meta.roles.map(role => [role.id, role])), [meta.roles]);
  const districts = useMemo(() => new Map(meta.districts.map(district => [district.id, district])), [meta.districts]);
  const projects = useMemo(() => new Map(meta.projects.map(project => [project.id, project])), [meta.projects]);

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

  // Chronicle badge counts entries added since the log was last on screen. The baseline is
  // taken on first load so joining a game in progress does not show a wall of old events.
  const logCount = room?.game?.event_log.length ?? 0;
  const hasGame = Boolean(room?.game);
  useEffect(() => {
    if (!hasGame) return;
    setSeenEvents(seen => (seen === null || mobileTab === "log" ? logCount : seen));
  }, [hasGame, logCount, mobileTab]);
  const unseenEvents = seenEvents === null ? 0 : Math.max(0, logCount - seenEvents);

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
  const legal = room.legal_actions ?? [];
  const labelContext = { game, meta, player: me, assets, cards, roles, districts, projects };

  const matching = (type: string, predicate?: (action: LegalAction) => boolean) =>
    legal.filter(action => action.type === type && (!predicate || predicate(action)));
  const offer = (title: string, actions: LegalAction[]) => {
    if (actions.length === 1) void send(actions[0]);
    else if (actions.length > 1) setChoice({ title, actions });
  };

  const buyActions = new Map(matching("buy_asset").map(action => [stringValue(action.payload.market_uid), action]));
  const buyCardAction = matching("buy_action_card")[0];
  const projectActions = new Map(matching("city_project").map(action => [stringValue(action.payload.project_id), action]));
  const ranking = [...game.players].sort((a, b) => scoreOf(game, b) - scoreOf(game, a));

  return <div className="city-game">
    <header className="city-head">
      <div className="city-head-title">
        <h1>Город влияния <small>online release</small> <span className="game-version">v{__GAME_VERSION__}</span></h1>
        <p>{room.name} · Раунд {game.round_number}/{game.max_rounds} · Ход: <b>{current.name}</b> · Действий: <b>{game.actions_left}</b></p>
      </div>
      <div className="city-head-buttons"><button onClick={() => setShowRules(true)}>📖 Правила</button><button onClick={onExit}>← Комнаты</button></div>
    </header>

    {error && <p className="game-error">{error}</p>}
    {game.status === "finished" && <FinishPanel room={room} game={game} meta={meta} ranking={ranking} roomId={roomId} password={password} playerId={playerId} onExit={onExit} />}

    <main className="city-layout" data-mobile-tab={mobileTab}>
      <div className="city-main-col">
        <PlayerStrip game={game} viewedId={viewed.id} playerId={playerId} roles={roles} onView={setViewedPlayerId} />
        <ProjectBoard game={game} meta={meta} me={me} projects={projects} actions={projectActions} reroll={matching("reroll_projects")[0]} busy={busy} onAction={send} />
        <DistrictMarket
          game={game} meta={meta} me={me} viewed={viewed} viewingOther={viewingOther} assets={assets}
          selectedDistrict={selectedDistrict} onSelectDistrict={setSelectedDistrict}
          buyActions={buyActions} reroll={matching("reroll_market")[0]} busy={busy} onAction={send}
        />
        {!viewingOther && <CardDesk game={game} me={me} cards={cards} legal={legal} buyCard={buyCardAction} busy={busy} onAction={send} onOffer={offer} labelContext={labelContext} />}
        <BusinessBoard viewed={viewed} me={me} game={game} meta={meta} assets={assets} legal={legal} viewingOther={viewingOther} busy={busy} onAction={send} />
      </div>

      <div className="city-side">
        <DecisionPanel
          game={game} me={me} meta={meta} roles={roles} districts={districts} assets={assets} legal={legal}
          selectedDistrict={selectedDistrict} busy={busy} onAction={send} onOffer={offer}
        />
        <Chronicle room={room} game={game} meta={meta} />
      </div>

      <section className="mobile-game-menu">
        <h2>Меню</h2>
        <button onClick={() => setShowRules(true)}><span>📖</span><strong>Правила игры</strong><small>Механики, роли, объекты и события</small></button>
        <button onClick={onExit}><span>🏠</span><strong>Вернуться в комнаты</strong><small>Выйти из текущего игрового экрана</small></button>
      </section>
    </main>

    <MobileGameTabs active={mobileTab} onChange={selectMobileTab} actions={game.actions_left} events={unseenEvents} />

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

function PlayerStrip({ game, viewedId, playerId, roles, onView }: {
  game: GameState;
  viewedId: string;
  playerId: string;
  roles: Map<string, { title: string; icon: string; color: string }>;
  onView: (id: string) => void;
}) {
  const current = game.players[game.current_player_index];
  const order = game.turn_order ?? [];
  const seat = new Map(game.players.map((player, index) => [player.id, index]));
  // Panel order follows the round's turn order — the trailing player opens the round, so the strip
  // has to re-sort itself when the standings change, or "who is next" is unreadable.
  const strip = order.length === game.players.length
    ? order.map(id => game.players.find(player => player.id === id)!).filter(Boolean)
    : game.players;
  return <section className="city-players">{strip.map(player => {
    const role = roles.get(player.role ?? "");
    const preferred = roles.get(player.preferred_role ?? "");
    const color = playerColors[(seat.get(player.id) ?? 0) % playerColors.length];
    const position = order.indexOf(player.id);
    const done = position >= 0 && position < (game.turns_taken_in_round ?? 0);
    // The counter used to read "n/6", which is the arrest threshold — it silently hid the cliff
    // that actually matters: the role is stripped one scandal earlier, and the journalist has
    // both thresholds shifted up by one.
    const roleLimit = player.role === "journalist" ? 6 : 5;
    const atRisk = player.role !== null && player.scandals >= roleLimit - 1;
    return <button
      className={`city-player scandal-${Math.min(6, player.scandals)} ${player.id === current.id ? "active" : ""} ${player.id === viewedId ? "viewed" : ""} ${player.id === playerId ? "mine" : ""} ${done ? "turn-done" : ""}`}
      style={{ "--player": color } as CSSProperties} onClick={() => onView(player.id)} title={`Показать бизнес игрока «${player.name}». Порядок хода в раунде: ${position + 1}. Раунд начинает последний в рейтинге.`} key={player.id}
    >
      <b><span className="player-name">{position >= 0 && <span className="turn-position" title="Очередь хода в этом раунде">{position + 1}</span>}<span className="player-avatar" style={{ borderColor: role?.color ?? "#3d4757" }}>{role?.icon ?? "👤"}</span><span style={{ color }}>{player.name}</span>{player.is_bot && <span className={`bot-badge diff-${player.difficulty}`}>{difficultyLabels[player.difficulty] ?? player.difficulty}</span>}</span><em>🎲 {player.turns} · {scoreOf(game, player)} оч.</em></b>
      <span>💰 {player.money}　◆ {player.influence}　<span className={atRisk ? "scandal-at-risk" : undefined} title={`Скандалы: ${player.scandals}. На ${roleLimit} роль теряется, на ${roleLimit + 1} — арест и сброс до 3⚠. Без роли 1 скандал снимается в начале хода.`}>⚠ {player.scandals}/{roleLimit}</span>　🛡 {player.roofs}</span>
      {atRisk && <small className="scandal-status">ещё 1 скандал — и роль потеряна</small>}
      <small>{role?.title ?? "без роли"} · объектов {player.assets.length}/{player.capacity} · проектов {player.projects.length}{preferred ? ` · цель ${preferred.icon} ${preferred.title}` : ""}</small>
      {player.jail_turns > 0 && <small className="scandal-status">ТЮРЬМА: ходов {player.jail_turns}</small>}
      {player.id === viewedId && player.id !== playerId && <small className="viewing-badge">👁 просмотр бизнеса</small>}
    </button>;
  })}</section>;
}

function ProjectBoard({ game, meta, me, projects, actions, reroll, busy, onAction }: {
  game: GameState;
  meta: CityMeta;
  me: PlayerState;
  projects: Map<string, ProjectMeta>;
  actions: Map<string, LegalAction>;
  reroll?: LegalAction;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  const mine = me.projects.map(id => projects.get(id)).filter(Boolean) as ProjectMeta[];
  const minePoints = mine.reduce((sum, project) => sum + project.points, 0);
  const initiatives = meta.projects.filter(project => project.repeatable);
  return <section className="city-projects">
    <h2>🏗️ Городские проекты <small>главный источник очков · в колоде ещё {game.project_deck_count} · один проект уходит под низ колоды каждый раунд</small>
      <button className="market-reroll" disabled={busy || !reroll} onClick={() => reroll && void onAction(reroll)} title={`Все четыре проекта уходят обратно в колоду, колода перемешивается и раздаётся заново. Цена: ${projectRerollMoney(meta)}$ и 1 обычное действие, один раз за ход. Цена в деньгах, а не в влиянии: влияние — это то, чем сами проекты и покупаются. Доска общая: она меняется у всех, в том числе у того, кто уже собрал условие под лежащий на ней проект.`}>🔄 Пересобрать доску · {projectRerollMoney(meta)}$ + ⚡</button>
    </h2>
    <p className="dim card-rule">Проект уникален: кто взял — тот и забрал очки, остальным он больше недоступен. Взятие стоит 1 обычное действие, влияние и деньги; условие проверяется по вашим объектам.</p>
    <div className="project-grid">{game.project_board.map((projectId, index) => {
      const project = projects.get(projectId);
      if (!project) return null;
      const action = actions.get(projectId);
      // Exactly one project rotates out per round, always the longest-standing one.
      const leaving = index === 0;
      const affordable = me.influence >= project.cost_influence && me.money >= project.cost_money;
      return <button
        className={`project-card ${action ? "available" : "locked"}`}
        disabled={busy || !action}
        onClick={() => action && void onAction(action)}
        title={`${project.text} Цена: ${project.cost_influence}◆ и ${project.cost_money}$ плюс 1 обычное действие. Условие: ${projectRequirementText(project, meta)}. Награда: ${project.points} очков и постоянный бонус — ${projectPerkText(project)}.`}
        key={projectId}
      >
        <strong>{project.title}<em>{project.points} очков</em></strong>
        <span className="project-cost">{project.cost_influence}◆ + {project.cost_money}${leaving && <i className="project-leaving"> ⏳ уходит в конце раунда</i>}</span>
        <small className={action ? "project-condition met" : "project-condition"}>
          {action ? "✅ " : affordable ? "🔒 " : "💸 "}{projectRequirementText(project, meta)}
        </small>
        <small className="project-perk">🎁 {projectPerkText(project)}</small>
      </button>;
    })}{game.project_board.length === 0 && <p className="empty-district">Проекты в городе закончились.</p>}</div>
    {initiatives.length > 0 && <>
      {/* The floor: always available, any number of times, priced worse than a real project — so
          the last rounds always have somewhere to put money and influence. */}
      <h3 className="group-title">Всегда доступны <span className="group-hint">берутся сколько угодно раз</span></h3>
      <div className="project-grid">{initiatives.map(project => {
        const action = actions.get(project.id);
        return <button className={`project-card repeatable ${action ? "available" : "locked"}`} disabled={busy || !action} onClick={() => action && void onAction(action)} title={`${project.text} Цена: ${project.cost_influence}◆ и ${project.cost_money}$ плюс 1 обычное действие.`} key={project.id}>
          <strong>{project.title}<em>{project.points} очков</em></strong>
          <span className="project-cost">{project.cost_influence}◆ + {project.cost_money}$</span>
          <small className="project-condition met">♾ без условия, сколько угодно раз</small>
        </button>;
      })}</div>
    </>}
    <p className="project-mine">Ваши проекты: {mine.length ? `${mine.map(project => project.title).join(", ")} — ${minePoints} очков` : "пока ни одного"}</p>
  </section>;
}

function DistrictMarket({ game, meta, me, viewed, viewingOther, assets, selectedDistrict, onSelectDistrict, buyActions, reroll, busy, onAction }: {
  game: GameState;
  meta: CityMeta;
  me: PlayerState;
  viewed: PlayerState;
  viewingOther: boolean;
  assets: Map<string, AssetMeta>;
  selectedDistrict: string;
  onSelectDistrict: (id: string) => void;
  buyActions: Map<string, LegalAction>;
  reroll?: LegalAction;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  return <section className="city-map">
    <h2>Районы и рынок <small className="market-remaining">уникальных объектов в колоде: {game.market_deck_count}</small>
      <button className="market-reroll" disabled={busy || !reroll} onClick={() => reroll && void onAction(reroll)} title={`Обновить сразу все шесть позиций рынка за ${marketRerollCost(meta)}$. Рынок общий: текущие предложения исчезают у всех игроков. Действие не расходуется, один реролл за ход.`}>🔄 Обновить рынок · {marketRerollCost(meta)}$</button>
    </h2>
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
          const price = marketPrice(asset, item);
          const effectLines = assetEffectLines(asset, me, meta, assets, { includeSynergy: true });
          // Not owned yet, so nothing it unlocks is `ready` — the panel is advertising, not status.
          const hints = assetHints(asset, me, game, meta, assets, { market: true });
          const points = assetPoints(asset);
          return <button className={`market-card rarity-${asset.rarity} ${hints.special ? "special" : ""}`} disabled={busy || viewingOther || !buy} onClick={event => { event.stopPropagation(); if (buy) void onAction(buy); }} title={`Купить за ${price}$. Занимает свободный слот и расходует обычное либо инвестиционное действие. В финальном счёте объект стоит ${points} очков — это ${moneyPerPoint(meta) / 2}$ за очко против ${moneyPerPoint(meta)}$ за очко у денег в кошельке, поэтому объекты и есть главный сток денег.${asset.influence > 0 ? ` Даёт ${asset.influence}◆ разово в момент покупки.` : ""} ${asset.text}${hints.special ? ` Специальный объект: без него серая операция «${greyOperationLabels[asset.id]}» недоступна вообще.` : ""}`} key={item.uid}>
            <span className="card-main">
              <span className="rarity-badge">{rarityLabels[asset.rarity] ?? asset.rarity}</span><b>{asset.title}</b>
              {asset.tags.length > 0 && <span className="asset-tags">{asset.tags.map(tag => <i key={tag}>{tag}</i>)}</span>}
              {/* Points first: it is the number the whole late game turns on and it used to be nowhere. */}
              <span className="asset-stats"><b className="stat-points on">{points} очк</b> · {price}$ · доход <b className={asset.income > 0 ? "stat-income on" : "stat-income"}>{asset.income}$</b>/раунд{asset.influence > 0 && <> · <b className="stat-inf on">+{asset.influence}◆</b> разово</>}</span>
              {effectLines.length > 0
                ? <ul className="asset-effects">{effectLines.map((line, index) => <li key={index} className={line.active ? "effect-active" : "effect-idle"}>{line.text}{line.boosted && <span className="effect-boost">⚙×2</span>}</li>)}</ul>
                : asset.text && <small className="asset-summary">{asset.text}</small>}
              {/* One rotation a round replaces the oldest three slots, and the server says which
                  ones: six independent countdowns were six clocks for one rule. */}
              {item.leaving && <small className="market-expiry">⏳ уходит в конце раунда</small>}
            </span>
            <AssetHintPanel hints={hints} />
          </button>;
        }) : <span className="empty-district">На рынке пока нет объектов района</span>}</div>
      </article>;
    })}</div>
  </section>;
}

// The right-hand column of an object card. Two thirds of the width sat empty while the only place
// that named an object's operation was a locked button in the action panel — read after the money
// was already spent on something else. `special` is the loud part: five objects in the catalog are
// the sole key to their grey operation, and nothing on the card used to say so.
function AssetHintPanel({ hints }: { hints: { special: boolean; hints: AssetHint[] } }) {
  if (hints.hints.length === 0) return null;
  return <span className="asset-hints">
    {hints.special && <span className="hint-badge">🌒 Специальный объект</span>}
    {hints.hints.map(hint => <span className={`asset-hint hint-${hint.kind} ${hint.ready ? "ready" : ""}`} title={hint.tooltip} key={`${hint.kind}:${hint.title}`}>
      <b>{hint.icon} {hint.title}{hint.ready && <i className="hint-ready">доступно</i>}</b>
      <i>{hint.detail}</i>
    </span>)}
  </span>;
}

function CardDesk({ game, me, cards, legal, buyCard, busy, onAction, onOffer, labelContext }: {
  game: GameState;
  me: PlayerState;
  cards: Map<string, ActionMeta>;
  legal: LegalAction[];
  buyCard?: LegalAction;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
  onOffer: (title: string, actions: LegalAction[]) => void;
  labelContext: Parameters<typeof actionLabel>[1];
}) {
  const playFor = (uid: string) => legal.filter(action => action.type === "play_action_card" && action.payload.card_uid === uid);
  const convertFor = (uid: string, into: string) => legal.find(action => action.type === "convert_action_card" && action.payload.card_uid === uid && action.payload.into === into);
  return <section className="city-cards action-group g-cards">
    <h3 className="group-title">🃏 Карты <span className="group-hint">3$ + 1◆ и 1 действие · в колоде {game.action_deck_count}</span></h3>
    {/* A face-up market bought without an action made the influence card strictly better than
        the campaign action. The draw is blind and costs an action; the discard cushions it. */}
    {/* `card-rule-market` describes the purchase button above it, and the portrait layout hides both
        on the tab that shows only the hand. */}
    <p className="dim card-rule card-rule-market">За одно действие вы тянете <b>две</b> случайные карты. Розыгрыш бесплатный — одна карта за ход; сброс тоже бесплатный и тоже один за ход. Рука {me.hand?.length ?? 0}/3.</p>
    <div className="action-market"><button className="action-card market-action tone-deal" disabled={busy || !buyCard} onClick={() => buyCard && void onAction(buyCard)} title="Потратить 1 обычное действие, 3$ и 1◆ и вытянуть две случайные карты из колоды (в руке максимум 3)."><strong>Вытянуть 2 карты<em>3$ + 1◆ + действие</em></strong><small>Случайные из колоды ({game.action_deck_count} осталось)</small></button></div>
    <div className="hand-grid">{me.hand?.map(held => {
      const card = cards.get(held.card_id);
      const variants = playFor(held.uid);
      const money = convertFor(held.uid, "money");
      const influence = convertFor(held.uid, "influence");
      return <article className={`hand-card tone-${card?.tone}`} key={held.uid}>
        <button className="action-card" disabled={busy || variants.length === 0} onClick={() => onOffer(`«${card?.title}» — выберите вариант`, variants)} title={`Разыграть бесплатно; разрешена одна карта за ход. ${card?.text ?? ""}`}><strong>{card?.title}<em>{variants.length > 1 ? "выбрать" : "сыграть"}</em></strong><small>{card?.text}</small></button>
        <div><button disabled={busy || !money} onClick={() => money && void onAction(money)} title="Удалить карту из руки и сразу получить 2$. Действие не расходуется, но сбросить можно только одну карту за ход.">Продать +2$</button><button disabled={busy || !influence} onClick={() => influence && void onAction(influence)} title="Удалить карту из руки и сразу получить 2◆. Действие не расходуется, но сбросить можно только одну карту за ход.">Сбросить +2◆</button></div>
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
  const actionFor = (type: string, uid: string) => legal.find(action => action.type === type && action.payload.asset_uid === uid);
  return <section className="business-board">
    <h2>{viewingOther ? `Бизнес: ${viewed.name}` : "Ваш бизнес"} <small>слоты {viewed.assets.length}/{viewed.capacity}</small></h2>
    <div className="active-bonuses"><strong>Активные бонусы</strong><ul>{activeBonuses(viewed, game, meta, assets).map(item => <li key={item.text} className={item.active ? "bonus-active" : "bonus-inactive"}>{item.text}</li>)}</ul></div>
    <div className="owned-grid">{viewed.assets.map((owned, index) => {
      const assetMeta = assets.get(owned.card_id);
      const districtInfo = meta.districts.find(d => d.id === assetMeta?.district);
      const effectLines = assetMeta ? assetEffectLines(assetMeta, viewed, meta, assets, { includeSynergy: true }) : [];
      // A blocked object opens nothing: every gate in the engine checks `not asset.blocked`.
      const hints = assetMeta
        ? assetHints(assetMeta, viewed, game, meta, assets, { active: !owned.blocked })
        : { special: false, hints: [] };
      return <OwnedAssetCard
        key={owned.uid} owned={owned} index={index} owner={viewed} asset={assetMeta} districtInfo={districtInfo}
        effectLines={effectLines} hints={hints} viewingOther={viewingOther} busy={busy}
        sell={actionFor("sell_asset", owned.uid)}
        onAction={onAction}
      />;
    })}{!viewed.assets.length && <p className="empty-business">У игрока пока нет объектов.</p>}</div>
    {!viewingOther && me.assets.length >= me.capacity && <p className="capacity-warning">Все слоты заняты. Продажа бесплатна и не тратит действие — продайте слабый объект и купите на рынке сильный: весь обмен стоит ровно одно действие покупки.</p>}
  </section>;
}

function OwnedAssetCard({ owned, index, owner, asset, districtInfo, effectLines, hints, viewingOther, busy, sell, onAction }: {
  owned: OwnedAsset;
  index: number;
  owner: PlayerState;
  asset?: AssetMeta;
  districtInfo?: { title: string; icon: string; color: string };
  effectLines: { text: string; active: boolean; boosted: boolean }[];
  hints: { special: boolean; hints: AssetHint[] };
  viewingOther: boolean;
  busy: boolean;
  sell?: LegalAction;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  if (!asset) return null;
  const managed = index < owner.capacity;
  // One number, two meanings: the refund in money equals the points the object is carrying.
  const sellValue = assetPoints(asset);
  const status = owned.blocked ? "🔒 заблокирован" : "работает";
  return <article className={`owned-asset rarity-${asset.rarity} ${owned.blocked ? "blocked" : ""} ${!managed ? "unmanaged" : ""} ${hints.special ? "special" : ""}`}>
    <header>
      <span className="rarity-badge">{rarityLabels[asset.rarity]}</span>
      {districtInfo && <span className="asset-district" style={{ color: districtInfo.color }}>{districtInfo.icon} {districtInfo.title}</span>}
      <span>{status}</span>
    </header>
    <h3>{asset.title}</h3>
    {asset.tags.length > 0 && <span className="asset-tags">{asset.tags.map(tag => <i key={tag}>{tag}</i>)}</span>}
    {/* No ◆ here: the influence on a card is a one-off purchase bonus, already collected. */}
    <p className="asset-stats"><b className="stat-points on">{sellValue} очк</b> · <b className="stat-income on">{asset.income}$</b> доход/раунд</p>
    {effectLines.length > 0
      ? <ul className="asset-effects">{effectLines.map((line, i) => <li key={i} className={line.active ? "effect-active" : "effect-idle"}>{line.text}{line.boosted && <span className="effect-boost">⚙×2</span>}</li>)}</ul>
      : asset.text && <small className="asset-summary">{asset.text}</small>}
    <AssetHintPanel hints={hints} />
    {!viewingOther && <div className="owned-actions">
      {/* The sale is free, so "sell then buy" costs exactly the one action a purchase costs — which
          is what the separate replacement command used to cost, without its choice matrix. */}
      <button className="danger" disabled={busy || !sell} onClick={() => sell && void onAction(sell)} title={`Продать объект за ${sellValue}$ и потерять его ${sellValue} очков в финальном счёте — возврат и очки это одно и то же число. Смысл продажи только в том, что покупается вместо: объект дороже даст больше очков. Продажа бесплатна и не расходует действие, слот освобождается сразу. Жетон автоматизации, если он стоит здесь, снимается — перенесите его бесплатно на другой объект.`}>
        <strong>Продать · +{sellValue}$</strong><small>−{sellValue} очков, без действия</small>
      </button>
    </div>}
  </article>;
}

function DecisionPanel({ game, me, meta, roles, districts, assets, legal, selectedDistrict, busy, onAction, onOffer }: {
  game: GameState;
  me: PlayerState;
  meta: CityMeta;
  roles: Map<string, { id: string; title: string; icon: string; color: string; passive: string; power: string }>;
  districts: Map<string, { title: string }>;
  assets: Map<string, AssetMeta>;
  legal: LegalAction[];
  selectedDistrict: string;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
  onOffer: (title: string, actions: LegalAction[]) => void;
}) {
  const find = (type: string, predicate?: (action: LegalAction) => boolean) => legal.find(action => action.type === type && (!predicate || predicate(action)));
  const all = (type: string, predicate?: (action: LegalAction) => boolean) => legal.filter(action => action.type === type && (!predicate || predicate(action)));
  const current = game.players[game.current_player_index];
  const endTurn = find("end_turn");
  const roleHolder = (roleId: string) => game.players.find(player => player.role === roleId);
  const roleCost = (roleId: string) => roleHolder(roleId) ? game.role_price * 3 : game.role_price;
  const districtAction = find("develop_district", action => action.payload.district === selectedDistrict);
  const displayRoleId = me.role;
  const powers = Array.from(new Set([
    ...(rolePowers[me.role ?? ""] ?? []),
    ...all("use_role_power").map(action => stringValue(action.payload.power)),
  ])).filter(power => power && !power.endsWith("_cleanup"));
  // One cleanup button: the role's own price when the role can actually pay it, the basic
  // antikrizisny PR otherwise. The engine still offers both commands; only the panel merges them.
  const cleanupPower = cleanupPowerFor(me.role);
  const cleanupRoleAction = cleanupPower ? find("use_role_power", action => action.payload.power === cleanupPower) : undefined;
  const cleanupAction = cleanupRoleAction ?? find("crisis_pr");
  const cleanup = cleanupOffer(cleanupRoleAction ? cleanupPower : undefined, meta);
  const dotCount = Math.max(3, game.actions_left);
  const greyRequirement = (assetId: string): string => {
    // The gate is a district, so the lock message has to name districts — the old text named one
    // card out of 71, which is exactly why three of the five operations were never run.
    const gates = greyOperationDistricts[assetId] ?? [];
    if (!gates.some(district => districtCount(me, district, assets) > 0)) {
      return `🔒 Нужен активный объект: ${gates.map(id => districts.get(id)?.title ?? id).join(" или ")}`;
    }
    if (game.actions_left < 1) return "🔒 Нужно 1 обычное действие";
    if (assetId === "cash" && me.money < launderingCost(meta, game.round_number)) return `🔒 Нужно ${launderingCost(meta, game.round_number)}$`;
    if (assetId === "influence_broker") {
      const cost = meta.scoring?.compromat_influence ?? 3;
      if (me.influence < cost) return `🔒 Нужно ${cost}◆`;
      if (!game.players.some(player => player.id !== me.id && player.role)) return "🔒 Ни у кого из соперников нет роли";
      return "🔒 Уже использовано в этом раунде";
    }
    return "Недоступно в текущий ход";
  };
  return <aside className="city-actions">
    <div className="actions-head"><h2>🎛️ Решения</h2><div className={`action-tokens ${game.actions_left === 0 ? "spent" : ""}`}><span className="token-label">Действий</span><span className="token-dots">{Array.from({ length: dotCount }).map((_, index) => <i className={index < game.actions_left ? "on" : "off"} key={index} />)}</span><b>{game.actions_left}</b></div></div>
    {busy && <p className="bot-action-note">Сервер выполняет команду и ходы ботов…</p>}
    {!busy && legal.length === 0 && game.status === "playing" && <p className="bot-action-note">Ожидаем ход игрока <b>{current.name}</b>.</p>}

    <ScorePanel game={game} me={me} meta={meta} />
    <IncomePanel game={game} />

    <div className="action-group g-city"><h3 className="group-title">🏙️ Город <span className="group-hint">доход и развитие</span></h3>
      <StaticAction action={find("basic_action", item => item.payload.kind === "work")} label="💵 Городской заказ: +2$" tooltip={`Потратить 1 обычное действие и сразу получить 2$. Деньги — топливо: в конце партии ${moneyPerPoint(meta)}$ дают лишь 1 очко, поэтому копить их невыгодно.`} busy={busy} onAction={onAction} />
      {/* One action, three rates: the action — not the money — was the real price of influence, so a
          single 2$→2◆ tier capped everybody at 2◆ per action no matter how rich they were. */}
      <div className="campaign-tiers">{campaignTiers(meta).map(tier => {
        const action = find("basic_action", item => item.payload.kind === "campaign" && item.payload.spend === tier.spend);
        return <button
          key={tier.spend}
          disabled={busy || !action}
          onClick={() => action && void onAction(action)}
          title={`Потратить 1 обычное действие и ${tier.spend}$, чтобы получить ${tier.gain}◆. Курс ухудшается с ростом ступени (${(tier.spend / tier.gain).toFixed(2)}$ за 1◆), зато одно действие приносит больше влияния. Влияние нужно для проектов и ролей.`}
        >📣 {tier.spend}$ → {tier.gain}◆</button>;
      })}</div>
      <StaticAction action={find("reroll_market")} label={`🔄 Обновить рынок: ${marketRerollCost(meta)}$ + действие`} tooltip="Полностью сменить все шесть позиций рынка объектов, не дожидаясь ротации: 1 обычное действие и деньги, один раз за ход. Сам рынок и так обновляет три самые старые позиции в начале каждого раунда — эта кнопка для тех случаев, когда ждать нельзя." busy={busy} onAction={onAction} />
      <StaticAction action={find("reroll_projects")} label={`🔄 Пересобрать доску проектов: ${projectRerollMoney(meta)}$ + действие`} tooltip={`Все четыре проекта возвращаются в колоду, колода перемешивается и раздаётся заново. Цена: ${projectRerollMoney(meta)}$ и 1 обычное действие, один раз за ход. Доска общая: она меняется у всех.`} busy={busy} onAction={onAction} />
      <StaticAction action={find("buy_capacity")} label={`📦 ${capacityLabel(me)}`} tooltip="Купить постоянный дополнительный слот бизнеса. Можно потратить обычное либо инвестиционное действие; максимум 6 слотов." busy={busy} onAction={onAction} />
      <StaticAction action={districtAction} label={`⭐ Развить «${districts.get(selectedDistrict)?.title}»`} tooltip="Нужно минимум 2 своих объекта в выбранном районе. Потратить 1 действие и 2$: +25% к базовому доходу всех ваших объектов района с округлением вверх (то есть минимум +1$ каждому) и +1◆. Максимум 2 уровня; уровень личный и соперникам ничего не даёт." busy={busy} onAction={onAction} />
    </div>

    <div className="action-group g-roles"><h3 className="group-title">🏷️ Роли <span className="group-hint">свободная {game.role_price}◆ · переворот {game.role_price * 3}◆</span></h3><div className="role-market">{meta.roles.map(role => {
      const claim = find("claim_role", action => action.payload.role_id === role.id);
      const holder = roleHolder(role.id);
      return <button disabled={busy || !claim} onClick={() => claim && void onAction(claim)} style={{ borderColor: role.color }} title={`${role.passive} Способность: ${role.power} Получение роли расходует 1 обычное действие и ${roleCost(role.id)}◆.${holder ? ` Сейчас роль у ${holder.name}; его Крыша или судебный запрет могут заблокировать захват.` : ""}`} key={role.id}><span className="role-line"><span className="role-icon" style={{ borderColor: role.color }}>{role.icon}</span>{role.title} · {roleCost(role.id)}◆</span><small>{holder ? `занята: ${holder.name}` : role.passive}</small></button>;
    })}</div>
      {displayRoleId && <div className="role-powers" style={{ borderColor: roles.get(displayRoleId)?.color }}><strong>{roles.get(displayRoleId)?.icon} Способности: {roles.get(displayRoleId)?.title}</strong><small>{roles.get(displayRoleId)?.power}</small>{powers.map(power => {
        const variants = all("use_role_power", action => action.payload.power === power);
        return <button className={power.includes("racket") || power.includes("sanction") || power.includes("scam") ? "danger" : ""} disabled={busy || variants.length === 0} onClick={() => onOffer(powerLabels[power] ?? power, variants)} title={powerDescriptions[power]} key={power}>{powerLabels[power] ?? power}{variants.length > 1 ? " → выбрать" : ""}</button>;
      })}</div>}
    </div>

    <div className="action-group g-grey"><h3 className="group-title">🌒 Серые операции <span className="group-hint">через специальные объекты</span></h3><p className="dim card-rule">Операцию открывает любой активный объект нужного района, роль не нужна. Каждая стоит 1 обычное действие; при выборе можно застраховать провал Крышей.</p>{Object.entries(greyOperationLabels).map(([assetId, label]) => {
      const variants = all("grey_operation", action => action.payload.asset_id === assetId);
      const info = greyOperationInfo[assetId];
      const effect = info.effect(game.round_number, meta);
      return <button className="described-action" disabled={busy || variants.length === 0} onClick={() => onOffer(label, variants)} title={`Открывает любой активный объект районов: ${(greyOperationDistricts[assetId] ?? []).map(id => districts.get(id)?.title ?? id).join(", ")}. Эффект при успехе: ${effect}. Базовый шанс успеха ${info.chance}%; у Афериста он может быть выше. ${info.failure} Страховка при провале тратит 1 Крышу и отменяет денежный либо объектный штраф, но скандалы всё равно начисляются и действие расходуется.`} key={assetId}><strong>{label}</strong><small>{variants.length ? `${effect} · шанс от ${info.chance}%` : greyRequirement(assetId)}</small></button>;
    })}</div>

    <div className="action-group g-defence"><h3 className="group-title">🛡️ Защита и репутация</h3><StaticAction action={cleanupAction} label={cleanup.label} tooltip={cleanup.tooltip} busy={busy} onAction={onAction} /><StaticAction action={find("buy_roof")} label={`🛡️ Купить Крышу (${roofCost(me, game)}$)`} tooltip={`Потратить 1 обычное действие и ${roofCost(me, game)}$. Цена растёт на 1$ каждые два раунда. Крыша — единственная защита в игре: она гасит направленный на вас эффект другого игрока (карту, рэкет, санкцию, взлом), попытку отобрать роль и любое начисление скандалов целиком. Последствия ваших собственных решений она не отменяет, но может застраховать провал вашей серой операции. Лимит 2, у Мафиози 3.`} busy={busy} onAction={onAction} /></div>
    <button className="end-turn" disabled={busy || !endTurn} onClick={() => endTurn && void onAction(endTurn)} title="Завершить текущий ход. Неиспользованные обычные действия пропадут, кроме разрешённого переносимого действия; затем сервер выполнит ходы ботов.">✅ Завершить ход</button>
  </aside>;
}

// Money converts at a rate now, so the conversion has to be on screen from the first turn —
// nobody should discover in the final scoring that their 200$ were worth 20 points.
function ScorePanel({ game, me, meta }: { game: GameState; me: PlayerState; meta: CityMeta }) {
  const score = game.score_breakdown?.[me.id];
  if (!score) return null;
  const rows: { label: string; value: number; hint: string }[] = [
    { label: "🏗️ Проекты", value: score.projects, hint: "Городские проекты — главный источник очков" },
    { label: "🏢 Объекты", value: score.assets, hint: "Половина цены объекта: дорогие карточки дают больше очков" },
    { label: "🎖️ Прочие очки", value: score.bonus ?? 0, hint: "Очки, купленные картами: 5$ за очко, слот не нужен" },
    { label: "🏷️ Роль", value: score.role, hint: "3 очка, пока роль у вас" },
    { label: `💰 ${me.money}$`, value: score.money, hint: `Деньги — топливо: ${moneyPerPoint(meta)}$ дают 1 очко` },
    { label: `◆ ${me.influence}`, value: score.influence, hint: `Влияние: ${influencePerPoint(meta)}◆ дают 1 очко` },
    { label: "⚠ Скандалы", value: score.scandals, hint: "Минус очко за каждый скандал" },
  ];
  return <div className="score-panel">
    <h3 className="group-title">🏆 Мой счёт <span className="group-hint">{score.total} очков</span></h3>
    <ul>{rows.map(row => <li key={row.label} title={row.hint} className={row.value === 0 ? "score-zero" : ""}>
      <span>{row.label}</span><b>{row.value > 0 ? `+${row.value}` : row.value}</b>
    </li>)}</ul>
  </div>;
}

// Money accrues passively every round while influence has to be bought with actions, so "is this
// perk doing anything?" was unanswerable: nothing on screen added the passives up. The engine ships
// the same breakdown it pays out with (`round_forecast`), so this panel can never drift from it.
function IncomePanel({ game }: { game: GameState }) {
  const forecast = game.round_forecast;
  if (!forecast) return null;
  const column = (
    title: string,
    glyph: string,
    row: Record<string, number>,
    hint: string,
  ) => <div className="income-column">
    <h4>{title}<b className={row.total > 0 ? "income-total on" : "income-total"}>{row.total > 0 ? "+" : ""}{row.total}{glyph}</b></h4>
    <ul>{forecastRows(row).map(item => <li key={item.key} className={item.value === 0 ? "score-zero" : undefined}>
      <span>{item.label}</span><b>{item.value > 0 ? `+${item.value}` : item.value}{glyph}</b>
    </li>)}</ul>
    <small className="dim">{hint}</small>
  </div>;
  return <div className="income-panel">
    <h3 className="group-title">📈 Доход за раунд <span className="group-hint">начисляется в конце раунда</span></h3>
    <div className="income-columns">
      {column("Деньги", "$", forecast.money, "Постоянные бонусы проектов входят в строку «Проекты».")}
      {column("Влияние", "◆", forecast.influence, "Влияние почти не растёт само: его дают объекты с +◆, проекты и роль Политика.")}
    </div>
  </div>;
}

function StaticAction({ action, label, tooltip, busy, onAction }: { action?: LegalAction; label: string; tooltip: string; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  return <button disabled={busy || !action} onClick={() => action && void onAction(action)} title={tooltip}>{label}</button>;
}

/** Copy/download the whole match. Rooms expire, so an unexported game is gone for good. */
function useGameLogExport(room: RoomView, meta: CityMeta) {
  const [status, setStatus] = useState("");
  const text = useCallback(() => buildGameLogMarkdown(room, meta, __GAME_VERSION__), [room, meta]);
  const save = useCallback((body: string, extension: string) => {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `city-of-influence-${room.name.replace(/[^\w\-]+/g, "_")}-${stamp}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  }, [room.name]);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text());
      setStatus("Журнал скопирован в буфер");
    } catch {
      setStatus("Скопировать не удалось — скачайте файл");
    }
  }, [text]);
  const download = useCallback(() => {
    save(text(), "md");
    setStatus("Журнал сохранён (.md)");
  }, [save, text]);
  return { status, copy, download, save, setStatus };
}

function LogExportButtons({ room, meta, roomId, password, playerId, replayable }: {
  room: RoomView;
  meta: CityMeta;
  roomId: string;
  password: string;
  playerId: string;
  replayable: boolean;
}) {
  const { status, copy, download, save, setStatus } = useGameLogExport(room, meta);
  const downloadJournal = async () => {
    try {
      const journal = await cityApi.journal(roomId, password, playerId);
      save(JSON.stringify(journal, null, 2), "json");
      setStatus("Полный журнал сохранён (.json) — партию можно переиграть");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Журнал недоступен");
    }
  };
  return <div className="log-export">
    <button onClick={() => void copy()} title="Скопировать читаемый журнал партии в буфер обмена: итоги, портфели и вся хроника от начала к концу.">📋 Копировать журнал</button>
    <button onClick={download} title="Скачать читаемый журнал партии в формате Markdown.">💾 Скачать .md</button>
    {/* The seed plus the command log is what makes a match replayable, not just readable. */}
    {replayable && <button onClick={() => void downloadJournal()} title="Скачать полный журнал: сид, все команды и финальный снапшот. По нему партию можно точно воспроизвести и разобрать. Доступно только после завершения партии.">🧾 Скачать .json для разбора</button>}
    {status && <small className="log-export-status">{status}</small>}
  </div>;
}

function Chronicle({ room, game, meta }: { room: RoomView; game: GameState; meta: CityMeta }) {
  const { status, copy, download } = useGameLogExport(room, meta);
  return <aside className="city-log"><h2>📜 Хроника <small>события партии</small></h2>
    {/* Also mid-game: a room lost to an expiry or a restart takes the whole match with it. */}
    <div className="log-export">
      <button onClick={() => void copy()} title="Скопировать журнал партии на текущий момент.">📋 Копировать</button>
      <button onClick={download} title="Скачать журнал партии на текущий момент в формате Markdown.">💾 .md</button>
      {status && <small className="log-export-status">{status}</small>}
    </div>
    <div className="log-scroll">{[...game.event_log].reverse().slice(0, 80).map(event => <p className={`log-entry ${event.actor_id ? "log-player" : "log-system"}`} key={event.seq}><b>#{event.seq}</b>{" "}{describeEventSegments(event, game, meta).map((segment, index) => {
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

function FinishPanel({ room, game, meta, ranking, roomId, password, playerId, onExit }: {
  room: RoomView;
  game: GameState;
  meta: CityMeta;
  ranking: PlayerState[];
  roomId: string;
  password: string;
  playerId: string;
  onExit: () => void;
}) {
  return <section className="city-finish"><h2>🏆 Итоги города</h2><div>{ranking.map((player, index) => {
    const score = game.score_breakdown?.[player.id];
    return <p key={player.id}>
      <b>{index + 1}. {player.name}</b>
      <span>{scoreOf(game, player)} очков</span>
      {score && <small>проекты {score.projects} · объекты {score.assets} · роль {score.role} · деньги {score.money} · влияние {score.influence} · скандалы {score.scandals}</small>}
    </p>;
  })}</div>
    <h3>Журнал партии</h3>
    <p className="dim">Записей: {game.event_log.length}. Комната со временем удаляется, поэтому сохраните партию, если хотите её потом разобрать.</p>
    <LogExportButtons room={room} meta={meta} roomId={roomId} password={password} playerId={playerId} replayable />
    <button className="primary" onClick={onExit}>Вернуться к комнатам</button></section>;
}
