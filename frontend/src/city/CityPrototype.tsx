import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS, ASSETS, DISTRICTS, EVENTS, ROLES,
  type ActionCard, type AssetCard, type DistrictId, type EventCard, type RoleId,
} from "./data";

type OwnedAsset = AssetCard & { uid: string; automated: boolean; scaled: boolean; blocked: boolean };
type MarketAsset = AssetCard & { uid: string };
type HeldActionCard = ActionCard & { uid: string };
interface Player {
  id: number; name: string; isBot: boolean; money: number; influence: number; scandals: number; roofs: number;
  role: RoleId | null; assets: OwnedAsset[]; hand: HeldActionCard[]; projects: number;
}
type DistrictLevels = Record<DistrictId, number>;

const MAX_ROUNDS = 10;
const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - .5);
const freshMarket = (cycle: number): MarketAsset[] => shuffle(ASSETS).map((a, i) => ({ ...a, uid: `${a.id}:${cycle}:${i}` }));
let cardSequence = 0;
const actionCard = (card: ActionCard): HeldActionCard => ({ ...card, uid: `${card.id}:${++cardSequence}` });
const freshHand = () => shuffle(ACTIONS).slice(0, 3).map(actionCard);
const initialPlayers = (): Player[] => ["Игрок 1", "Бот-инвестор", "Бот-политик", "Бот-аферист"].map((name, id) => ({
  id, name, isBot: id > 0, money: 10, influence: 2, scandals: 0, roofs: 0, role: null,
  assets: [], hand: freshHand(), projects: 0,
}));
const initialDistricts = (): DistrictLevels => ({ residential: 0, business: 0, industrial: 0, tech: 0, government: 0, shadows: 0 });
const directedKinds = new Set(["deal", "scandal", "fine", "steal"]);

export default function CityPrototype() {
  const firstDeck = useMemo(() => freshMarket(1), []);
  const firstEvents = useMemo(() => shuffle(EVENTS), []);
  const [players, setPlayers] = useState(initialPlayers);
  const [round, setRound] = useState(1);
  const [turn, setTurn] = useState(0);
  const [actionsLeft, setActionsLeft] = useState(3);
  const [rolePowerUsed, setRolePowerUsed] = useState(false);
  const [marketCycle, setMarketCycle] = useState(1);
  const [marketDeck, setMarketDeck] = useState<MarketAsset[]>(firstDeck.slice(6));
  const [market, setMarket] = useState<MarketAsset[]>(firstDeck.slice(0, 6));
  const [eventDeck, setEventDeck] = useState(firstEvents.slice(1));
  const [event, setEvent] = useState<EventCard>(firstEvents[0]);
  const [districtLevels, setDistrictLevels] = useState<DistrictLevels>(initialDistricts);
  const [target, setTarget] = useState<number | null>(null);
  const [district, setDistrict] = useState<DistrictId>("business");
  const [log, setLog] = useState<string[]>(["Город открыт для инвестиций. Постройте экономику и захватите влияние."]);
  const [finished, setFinished] = useState(false);
  const [showRules, setShowRules] = useState(true);
  const [logExportStatus, setLogExportStatus] = useState("");
  const processingCards = useRef(new Set<string>());

  const me = players[turn];
  const role = ROLES.find(r => r.id === me.role);
  const targetPlayer = target === null ? null : players.find(p => p.id === target) ?? null;
  const roleHolder = (id: RoleId) => players.find(p => p.role === id);

  const assetValue = (a: OwnedAsset) => Math.floor(a.cost / 2) + (a.automated ? 2 : 0) + (a.scaled ? 2 : 0);
  const isManaged = (assets: OwnedAsset[], index: number) => assets[index].automated
    || assets.slice(0, index).filter(a => !a.automated).length < 3;
  const scoreOf = (p: Player) => p.money + p.influence + p.assets.reduce((s, a) => s + assetValue(a), 0)
    + p.projects * 6 + (p.role ? 3 : 0) - p.scandals * 2;
  const scores = useMemo(() => players.map(p => ({ ...p, score: scoreOf(p) })).sort((a, b) => b.score - a.score), [players]);

  const gameLogText = () => [
    "Город влияния — полный журнал игры",
    `Версия: v${__GAME_VERSION__}`,
    `Дата экспорта: ${new Date().toLocaleString("ru-RU")}`,
    `Раунд: ${round}/${MAX_ROUNDS}`,
    "",
    "Итоги:",
    ...scores.map((p, i) => `${i + 1}. ${p.name} — ${p.score} очков; деньги ${p.money}$; влияние ${p.influence}; объектов ${p.assets.length}`),
    "",
    `Хронология (${log.length} записей):`,
    ...[...log].reverse().map((entry, i) => `${i + 1}. ${entry}`),
  ].join("\n");

  const copyGameLog = async () => {
    try {
      await navigator.clipboard.writeText(gameLogText());
      setLogExportStatus("Лог скопирован");
    } catch {
      setLogExportStatus("Не удалось скопировать — скачайте файл");
    }
  };

  const downloadGameLog = () => {
    const blob = new Blob([gameLogText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `business-board-game-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setLogExportStatus("Лог скачан");
  };

  const update = (id: number, fn: (p: Player) => Player) => setPlayers(ps => ps.map(p => p.id === id ? fn(p) : p));
  const say = (text: string) => setLog(xs => [text, ...xs]);
  const spendAction = () => setActionsLeft(x => Math.max(0, x - 1));
  const priceOf = (asset: AssetCard) => {
    const eventDiscount = event.district === asset.district ? (event.marketDiscount ?? 0) : 0;
    const roleDiscount = me.role === "capitalist" ? 1 : 0;
    return Math.max(1, asset.cost - eventDiscount - roleDiscount);
  };

  const buy = (asset: MarketAsset) => {
    const cost = priceOf(asset);
    if (actionsLeft < 1 || me.money < cost) return;
    const owned: OwnedAsset = { ...asset, automated: false, scaled: false, blocked: false };
    update(me.id, p => ({
      ...p, money: p.money - cost,
      influence: p.influence + asset.influence + (event.id === "election" && asset.district === "government" ? asset.influence : 0),
      roofs: p.roofs + (asset.tags.includes("security") ? 1 : 0), assets: [...p.assets, owned],
    }));
    setMarket(xs => xs.filter(a => a.uid !== asset.uid));
    say(`${me.name} инвестирует ${cost}$ в «${asset.title}».`); spendAction();
  };

  const improve = (uid: string, kind: "automate" | "scale") => {
    const asset = me.assets.find(a => a.uid === uid);
    const cost = kind === "automate" ? 4 : 3;
    if (!asset || actionsLeft < 1 || me.money < cost || (kind === "automate" ? asset.automated : asset.scaled)) return;
    update(me.id, p => ({ ...p, money: p.money - cost, assets: p.assets.map(a => a.uid === uid ? { ...a, automated: kind === "automate" || a.automated, scaled: kind === "scale" || a.scaled } : a) }));
    say(`${me.name} ${kind === "automate" ? "автоматизирует" : "масштабирует"} «${asset.title}».`); spendAction();
  };

  const sellAsset = (uid: string) => {
    const asset = me.assets.find(a => a.uid === uid); if (!asset || actionsLeft < 1) return;
    const value = assetValue(asset);
    update(me.id, p => ({ ...p, money: p.money + value, assets: p.assets.filter(a => a.uid !== uid) }));
    say(`${me.name} продаёт «${asset.title}» за ${value}$.`); spendAction();
  };

  const claimRole = (roleId: RoleId) => {
    const holder = roleHolder(roleId);
    const cost = holder ? Math.max(3, 5 - holder.scandals) : 3;
    if (actionsLeft < 1 || me.influence < cost || holder?.id === me.id) return;
    setPlayers(ps => ps.map(p => p.id === me.id ? { ...p, influence: p.influence - cost, role: roleId }
      : p.id === holder?.id ? { ...p, role: null } : p));
    say(holder ? `${me.name} проводит переворот и отбирает роль «${ROLES.find(r => r.id === roleId)?.title}» у ${holder.name} за ${cost} влияния.`
      : `${me.name} получает роль «${ROLES.find(r => r.id === roleId)?.title}» за ${cost} влияния.`);
    spendAction();
  };

  const protectOr = (p: Player, effect: (p: Player) => Player) => {
    if (p.roofs > 0 && window.confirm(`${p.name}: потратить Крышу и отменить направленный эффект?`)) return { ...p, roofs: p.roofs - 1 };
    return effect(p);
  };

  const rolePower = () => {
    if (!me.role || actionsLeft < 1 || rolePowerUsed) return;
    if ((me.role === "mafia" || me.role === "military") && target === null) return;
    if (me.role === "politician") update(me.id, p => p.scandals ? { ...p, scandals: p.scandals - 1 } : { ...p, money: p.money + 2 });
    if (me.role === "journalist") {
      const leader = scores.find(p => p.id !== me.id)!;
      update(leader.id, p => protectOr(p, q => ({ ...q, scandals: q.scandals + 1 })));
    }
    if (me.role === "mafia" && target !== null) update(target, p => protectOr(p, q => q.money >= 2 ? { ...q, money: q.money - 2 } : { ...q, scandals: q.scandals + 1 }));
    if (me.role === "military" && target !== null) update(target, p => protectOr(p, q => ({ ...q, assets: q.assets.map((a, i) => i === 0 ? { ...a, blocked: true } : a) })));
    if (me.role === "capitalist") update(me.id, p => ({ ...p, money: p.money + 2 }));
    if (me.role === "fraudster") update(me.id, p => ({ ...p, money: p.money + 1, influence: p.influence + 1 }));
    say(`${me.name} применяет полномочие роли «${role?.title}».`); setRolePowerUsed(true); spendAction();
  };

  const playCard = (card: HeldActionCard) => {
    const targeted = directedKinds.has(card.kind);
    if (processingCards.current.has(card.uid) || !me.hand.some(c => c.uid === card.uid)
      || actionsLeft < 1 || (targeted && target === null) || (card.kind === "influence" && me.money < 2)) return;
    processingCards.current.add(card.uid);
    if (card.kind === "clean") update(me.id, p => ({ ...p, scandals: Math.max(0, p.scandals - 1) }));
    if (card.kind === "roof") update(me.id, p => ({ ...p, roofs: Math.min(2, p.roofs + 1) }));
    if (card.kind === "grant") update(me.id, p => ({ ...p, money: p.money + card.value, influence: p.influence + (p.assets.some(a => a.tags.includes("ai")) ? 1 : 0) }));
    if (card.kind === "influence" && me.money >= 2) update(me.id, p => ({ ...p, money: p.money - 2, influence: p.influence + 2 }));
    if (card.kind === "deal" && target !== null) { update(me.id, p => ({ ...p, money: p.money + 2 })); update(target, p => ({ ...p, money: p.money + 2 })); }
    if (card.kind === "scandal" && target !== null) update(target, p => protectOr(p, q => ({ ...q, scandals: q.scandals + 1 })));
    if (card.kind === "fine" && target !== null) update(target, p => protectOr(p, q => q.money >= 3 ? { ...q, money: q.money - 3 } : { ...q, scandals: q.scandals + 1 }));
    if (card.kind === "steal" && target !== null) { update(me.id, p => ({ ...p, money: p.money + 1 })); update(target, p => protectOr(p, q => ({ ...q, money: Math.max(0, q.money - 2) }))); }
    update(me.id, p => ({ ...p, hand: p.hand.filter(c => c.uid !== card.uid) }));
    say(`${me.name} играет «${card.title}»${targeted ? ` против ${targetPlayer?.name}` : ""}.`); spendAction();
  };

  const convertCard = (card: HeldActionCard, into: "money" | "influence") => {
    if (processingCards.current.has(card.uid) || !me.hand.some(c => c.uid === card.uid)) return;
    processingCards.current.add(card.uid);
    update(me.id, p => {
      if (!p.hand.some(c => c.uid === card.uid)) return p;
      return { ...p, money: p.money + (into === "money" ? 1 : 0), influence: p.influence + (into === "influence" ? 1 : 0), hand: p.hand.filter(c => c.uid !== card.uid) };
    });
    say(`${me.name} сбрасывает «${card.title}» и получает ${into === "money" ? "1$" : "1 влияние"}.`);
  };

  const greyScheme = (risk: "safe" | "bold") => {
    const greyAssets = me.assets.filter(a => a.tags.includes("grey") && !a.blocked);
    if (actionsLeft < 1 || greyAssets.length === 0) return;
    const baseChance = risk === "safe" ? .75 : .45;
    const chance = Math.min(.9, baseChance + (me.role === "fraudster" ? .2 : 0) + Math.min(.1, greyAssets.length * .05));
    const reward = (risk === "safe" ? 3 : 7) + (me.role === "fraudster" ? 1 : 0);
    if (Math.random() < chance) { update(me.id, p => ({ ...p, money: p.money + reward })); say(`${me.name}: серая схема успешна, +${reward}$.`); }
    else { update(me.id, p => ({ ...p, scandals: p.scandals + (risk === "safe" ? 1 : 2), assets: risk === "bold" ? p.assets.map(a => a.uid === greyAssets[0].uid ? { ...a, blocked: true } : a) : p.assets })); say(`${me.name}: схема раскрыта.`); }
    spendAction();
  };

  const investDistrict = () => {
    if (actionsLeft < 1 || me.money < 2 || districtLevels[district] >= 2) return;
    update(me.id, p => ({ ...p, money: p.money - 2, influence: p.influence + (p.assets.some(a => a.district === district) ? 1 : 0) }));
    setDistrictLevels(ds => ({ ...ds, [district]: ds[district] + 1 })); say(`${me.name} развивает район: ${DISTRICTS.find(d => d.id === district)?.title}.`); spendAction();
  };
  const basicAction = (kind: "work" | "campaign") => {
    if (actionsLeft < 1 || (kind === "campaign" && me.money < 2)) return;
    update(me.id, p => kind === "work" ? { ...p, money: p.money + 2 } : { ...p, money: p.money - 2, influence: p.influence + 2 });
    say(`${me.name} ${kind === "work" ? "берёт городской заказ: +2$." : "проводит кампанию: +2 влияния."}`); spendAction();
  };
  const cityProject = () => {
    if (actionsLeft < 1 || me.influence < 3) return;
    update(me.id, p => ({ ...p, influence: p.influence - 3, projects: p.projects + 1 }));
    say(`${me.name} запускает городской проект: +6 итоговых очков.`); spendAction();
  };
  const buyRoof = () => {
    const cost = me.role === "mafia" ? 2 : 3; const cap = me.role === "mafia" ? 2 : 1;
    if (actionsLeft < 1 || me.money < cost || me.roofs >= cap) return;
    update(me.id, p => ({ ...p, money: p.money - cost, roofs: p.roofs + 1 })); say(`${me.name} покупает Крышу.`); spendAction();
  };

  const refillMarket = () => {
    let deck = [...marketDeck]; let cycle = marketCycle; const additions: MarketAsset[] = [];
    for (let i = market.length; i < 6; i++) {
      if (!deck.length) { cycle += 1; deck = freshMarket(cycle); }
      additions.push(deck.shift()!);
    }
    setMarket(xs => [...xs, ...additions]); setMarketDeck(deck); setMarketCycle(cycle);
  };
  const endTurn = () => {
    if (turn < players.length - 1) { setTurn(turn + 1); setTarget(null); setActionsLeft(3); setRolePowerUsed(false); return; }
    if (round >= MAX_ROUNDS) { setFinished(true); say(`Игра окончена. Побеждает ${scores[0].name}: ${scores[0].score} очков.`); return; }
    const nextEventDeck = eventDeck.length > 1 ? eventDeck.slice(1) : shuffle(EVENTS); const nextEvent = nextEventDeck[0];
    setPlayers(ps => ps.map(p => {
      let management = 3; let income = 0;
      const assets = p.assets.map(a => {
        const managed = a.automated || management-- > 0; const active = managed && !a.blocked;
        const districtFactor = 1 + districtLevels[a.district] * .25;
        const eventFactor = event.district === a.district ? event.incomeMultiplier ?? 1 : 1;
        if (active) income += Math.floor((a.income + (a.scaled ? 2 : 0)) * districtFactor * eventFactor);
        return { ...a, blocked: false };
      });
      if (p.role === "capitalist") income += assets.filter(a => a.district === "business").length;
      const losesRole = p.scandals >= 3;
      const rolelessFine = losesRole && !p.role ? 3 : 0;
      return { ...p, assets, money: Math.max(0, p.money + income - rolelessFine), role: losesRole ? null : p.role, scandals: losesRole ? 0 : p.scandals, hand: [...p.hand, actionCard(shuffle(ACTIONS)[0])].slice(-4) };
    }));
    refillMarket(); setEventDeck(nextEventDeck); setEvent(nextEvent); setRound(round + 1); setTurn(0); setTarget(null); setActionsLeft(3); setRolePowerUsed(false);
    say(`Раунд ${round + 1}: «${nextEvent.title}».`);
  };

  useEffect(() => {
    if (!me.isBot || finished) return;
    const timer = window.setTimeout(() => {
      if (actionsLeft <= 0) { endTurn(); return; }
      const safeCard = me.hand.find(c => !directedKinds.has(c.kind) && (c.kind !== "influence" || me.money >= 2));
      if (safeCard) { playCard(safeCard); return; }
      const unusedCard = me.hand[0];
      if (unusedCard) { convertCard(unusedCard, me.id === 2 ? "influence" : "money"); return; }
      const managed = me.assets.filter(a => !a.automated).length;
      const affordable = market.filter(a => priceOf(a) <= me.money)
        .sort((a, b) => (b.income / priceOf(b) + b.influence * .08) - (a.income / priceOf(a) + a.influence * .08));
      if (affordable.length && managed < 3) { buy(affordable[0]); return; }
      if (!me.role) {
        const wanted: RoleId[] = me.id === 1 ? ["capitalist", "military"] : me.id === 2 ? ["politician", "journalist"] : ["fraudster", "mafia"];
        const available = wanted.find(r => roleHolder(r)?.id !== me.id && me.influence >= (roleHolder(r) ? Math.max(3, 5 - roleHolder(r)!.scandals) : 3));
        if (available) { claimRole(available); return; }
      }
      if (me.id === 3 && me.assets.some(a => a.tags.includes("grey"))) { greyScheme(me.scandals < 2 ? "bold" : "safe"); return; }
      if (me.id === 2 && me.money >= 2) { basicAction("campaign"); return; }
      const scalable = me.assets.find(a => !a.scaled);
      if (me.id === 1 && scalable && me.money >= 3) { improve(scalable.uid, "scale"); return; }
      basicAction("work");
    }, 550);
    return () => window.clearTimeout(timer);
  }, [turn, actionsLeft, round, finished, players, market]);

  return <div className="city-game">
    <header className="city-head"><div><h1>Город влияния <small>strategy prototype v2</small> <span className="game-version" title="Версия сборки">v{__GAME_VERSION__}</span></h1><p>Раунд {round}/{MAX_ROUNDS} · Ход: <b>{me.name}</b> · Действий: <b>{actionsLeft}</b>{me.isBot && <span className="bot-thinking"> · принимает решение…</span>}</p></div><div className="city-head-buttons"><button className="btn" onClick={() => setShowRules(x => !x)}>📖 Правила</button><a className="btn" href="?legacy=1">Старый MVP</a></div></header>
    <div className="city-event"><strong>📰 {event.title}</strong><span>{event.text}</span><em>Городские проекты: 3◆ → 6 итоговых очков</em></div>
    <section className="city-players">{players.map(p => <article className={`city-player ${p.id === me.id ? "active" : ""}`} key={p.id}><b>{p.name} <em>{scoreOf(p)} оч.</em></b><span>💰{p.money}　◆{p.influence}　⚠{p.scandals}/3　🛡{p.roofs}</span><small>{ROLES.find(r => r.id === p.role)?.title ?? "без роли"} · объектов {p.assets.length}</small></article>)}</section>
    {finished ? <section className="city-finish"><h2>Итоги города</h2>{scores.map((p, i) => <p key={p.id}>{i + 1}. <b>{p.name}</b> — {p.score} очков</p>)}<h3>Полный журнал</h3><p className="dim">Сохранено записей: {log.length}. В файле действия расположены от начала игры к завершению.</p><div className="log-export-actions"><button className="btn" onClick={copyGameLog}>Копировать лог</button><button className="btn" onClick={downloadGameLog}>Скачать .txt</button></div>{logExportStatus && <p className="log-export-status">{logExportStatus}</p>}<button className="btn primary" onClick={() => location.reload()}>Новая партия</button></section> : <main className="city-layout">
      <section className="city-map"><h2>Районы и рынок</h2><div className="district-grid">{DISTRICTS.map(d => <div className={`district ${district === d.id ? "selected" : ""}`} style={{"--district": d.color} as React.CSSProperties} onClick={() => setDistrict(d.id)} key={d.id}><h3>{d.icon} {d.title} <span className="district-level">{districtLevels[d.id] >= 0 ? "+" : ""}{districtLevels[d.id]}</span></h3><p>{d.description}</p><div className="market-cards">{market.filter(a => a.district === d.id).map(a => <button className="market-card" disabled={me.money < priceOf(a) || actionsLeft < 1} onClick={() => buy(a)} key={a.uid}><b>{a.title}</b><span>{priceOf(a)}$ · доход {a.income}$ · ◆{a.influence}</span><small>{a.text}</small></button>)}</div></div>)}</div>
        <div className="owned-panel"><h2>Ваш бизнес · управление 3</h2><p className="dim">Доход приносят 3 неавтоматизированных объекта. Автоматизированные работают сверх этого лимита.</p>{me.assets.length === 0 ? <p className="dim">Купите первый объект на рынке.</p> : <div className="owned-grid">{me.assets.map((a, i) => <article className={a.blocked ? "blocked" : ""} key={a.uid}><b>{a.title}</b><span>{isManaged(me.assets, i) ? "● управляется" : "○ без управления"} · доход {a.income + (a.scaled ? 2 : 0)}$</span><div><button title="Объект всегда приносит доход и не занимает один из 3 слотов управления" disabled={a.automated || me.money < 4 || actionsLeft < 1} onClick={() => improve(a.uid,"automate")}>Автоматизация 4$</button><button title="Постоянно добавляет объекту +2$ дохода" disabled={a.scaled || me.money < 3 || actionsLeft < 1} onClick={() => improve(a.uid,"scale")}>Масштаб 3$</button><button disabled={actionsLeft < 1} onClick={() => sellAsset(a.uid)}>Продать {assetValue(a)}$</button></div></article>)}</div>}</div>
      </section>
      <aside className={`city-actions ${me.isBot ? "bot-turn" : ""}`}><h2>Решения <span className="action-counter">{actionsLeft}/3</span></h2>{me.isBot && <p className="bot-action-note">🤖 Бот анализирует рынок и продолжит автоматически.</p>}{actionsLeft === 0 && !me.isBot && <p className="no-actions">Действия потрачены. Завершите ход.</p>}<label className={`target-picker ${target === null ? "required" : ""}`}>Цель<select value={target ?? ""} onChange={e => setTarget(e.target.value === "" ? null : Number(e.target.value))}><option value="">— выберите игрока —</option>{players.filter(p => p.id !== me.id).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <div className="action-group"><b>Город</b><button className="btn" disabled={actionsLeft < 1} onClick={() => basicAction("work")}>Городской заказ: +2$</button><button className="btn" disabled={actionsLeft < 1 || me.money < 2} onClick={() => basicAction("campaign")}>Кампания: 2$ → 2 влияния</button><button className="btn" disabled={actionsLeft < 1 || me.influence < 3} onClick={cityProject}>Городской проект: 3◆ → 6 очков</button><button className="btn" title="+25% дохода всем объектам выбранного района; +1◆, если у вас там есть объект. Максимум 2 уровня" disabled={actionsLeft < 1 || me.money < 2 || districtLevels[district] >= 2} onClick={investDistrict}>Развить район: 2$ → +25% дохода{me.assets.some(a => a.district === district) ? " +1◆" : ""}</button></div>
        <div className="action-group"><b>Роли · свободная 3◆, переворот 3–5◆</b><div className="role-market">{ROLES.map(r => { const holder=roleHolder(r.id);const cost=holder?Math.max(3,5-holder.scandals):3;return <button disabled={holder?.id===me.id || me.influence<cost || actionsLeft<1} onClick={() => claimRole(r.id)} style={{borderColor:r.color}} key={r.id}>{r.title} · {cost}◆<small>{holder ? `занята: ${holder.name}` : r.passive}</small></button>})}</div>{me.role && <button className="btn full-width" disabled={rolePowerUsed || actionsLeft<1 || (["mafia","military"].includes(me.role)&&target===null)} onClick={rolePower}>{rolePowerUsed ? "Полномочие использовано" : role?.power}</button>}</div>
        <div className="action-group"><b>Карты · сыграть или конвертировать без действия</b>{me.hand.map(c => { const targeted=directedKinds.has(c.kind);return <div className={`hand-card ${c.tone}`} key={c.uid}><button className="action-card" onClick={() => playCard(c)} disabled={actionsLeft<1||(targeted&&target===null)||(c.kind==="influence"&&me.money<2)}><strong>{c.title}<em>{targeted?`→ ${targetPlayer?.name??"цель"}`:"→ себе"}</em></strong><small>{c.text}</small></button><div><button onClick={() => convertCard(c,"money")}>Продать +1$</button><button onClick={() => convertCard(c,"influence")}>Сбросить +1◆</button></div></div>})}</div>
        <div className="action-group"><b>Серые схемы · нужен серый объект</b><button className="btn" disabled={actionsLeft<1||!me.assets.some(a=>a.tags.includes("grey"))} onClick={() => greyScheme("safe")}>Осторожная: 75% → +3$</button><button className="btn danger" disabled={actionsLeft<1||!me.assets.some(a=>a.tags.includes("grey"))} onClick={() => greyScheme("bold")}>Наглая: 45% → +7$ / 2 скандала</button></div>
        <button className="btn" disabled={actionsLeft<1||me.money<(me.role==="mafia"?2:3)||me.roofs>=(me.role==="mafia"?2:1)} onClick={buyRoof}>Купить Крышу ({me.role==="mafia"?2:3}$)</button><button className="btn primary full-width" onClick={endTurn}>Завершить ход</button>
      </aside>
      <aside className="city-log"><h2>Хроника</h2>{log.map((x,i)=><p key={i}>{x}</p>)}</aside>
    </main>}
    {showRules && <Rules />}
  </div>;
}

function Rules() { return <section className="city-help"><h2>Как играть</h2><div className="help-grid">
  <article><h3>🎯 Победа</h3><p>Деньги + влияние + половина стоимости бизнеса + проекты + роль − скандалы. Текущий прогноз виден у каждого игрока.</p></article>
  <article><h3>⏱️ Три действия</h3><p>Покупайте и улучшайте бизнес, развивайте районы, боритесь за роли, играйте карты или стройте серые схемы.</p></article>
  <article><h3>🏙️ Районы</h3><p>Развитие стоит 2$ и добавляет +25% к доходу каждого объекта района за уровень (максимум +2). Если у вас уже есть объект в этом районе, вы сразу получаете +1 влияние.</p></article>
  <article><h3>⚙️ Управление</h3><p>Доход приносят только три неавтоматизированных объекта. Автоматизация за 4$ заставляет объект работать всегда и не занимать слот управления. Масштабирование за 3$ постоянно добавляет объекту +2$ дохода.</p></article>
  <article><h3>🏷️ Роли</h3><p>Свободная роль стоит 3 влияния. Занятую можно отобрать за 3–5. Три скандала снимают роль; игрок без роли платит кризисный штраф 3$.</p></article>
  <article><h3>🃏 Карты</h3><p>Карту можно сыграть за действие, продать за 1$ или сбросить за 1 влияние. Поэтому разыгрывать всю руку не всегда выгодно.</p></article>
  <article><h3>🌒 Серые схемы</h3><p>Требуют хотя бы один объект Серого сектора. Аферист повышает шанс и награду; провал блокирует бизнес и создаёт скандалы.</p></article>
  <article><h3>🛡️ Крыша</h3><p>Отменяет направленный финансовый, репутационный или силовой эффект. Обычный лимит — одна, у Мафиози — две.</p></article>
  <article><h3>💡 Первый план</h3><p>Купите 1–2 компании → получите влияние → захватите профильную роль → решите, масштабировать экономику или атаковать лидера.</p></article>
</div></section>; }
