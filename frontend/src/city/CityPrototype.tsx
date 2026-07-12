import { useMemo, useState } from "react";
import { ACTIONS, ASSETS, DISTRICTS, EVENTS, ROLES, type ActionCard, type AssetCard, type DistrictId, type EventCard, type RoleId } from "./data";

interface Player {
  id: number; name: string; money: number; influence: number; scandals: number; roofs: number;
  role: RoleId | null; assets: AssetCard[]; hand: ActionCard[]; blockedAsset: string | null;
}

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - .5);
const initialPlayers = (): Player[] => ["Игрок 1", "Игрок 2", "Игрок 3", "Игрок 4"].map((name, id) => ({
  id, name, money: 10, influence: 2, scandals: 0, roofs: 0, role: null, assets: [], hand: shuffle(ACTIONS).slice(0, 3), blockedAsset: null,
}));

export default function CityPrototype() {
  const [players, setPlayers] = useState(initialPlayers);
  const [round, setRound] = useState(1);
  const [turn, setTurn] = useState(0);
  const [actionsLeft, setActionsLeft] = useState(3);
  const [rolePowerUsed, setRolePowerUsed] = useState(false);
  const [marketDeck, setMarketDeck] = useState(() => shuffle(ASSETS));
  const [market, setMarket] = useState<AssetCard[]>(() => shuffle(ASSETS).slice(0, 6));
  const [eventDeck, setEventDeck] = useState(() => shuffle(EVENTS));
  const [event, setEvent] = useState<EventCard>(() => shuffle(EVENTS)[0]);
  const [target, setTarget] = useState(1);
  const [district, setDistrict] = useState<DistrictId>("shadows");
  const [log, setLog] = useState<string[]>(["Город просыпается. Начинается борьба за капитал и влияние."]);
  const [finished, setFinished] = useState(false);
  const me = players[turn];
  const role = ROLES.find(r => r.id === me.role);
  const occupied = new Set(players.map(p => p.role).filter(Boolean));

  const scores = useMemo(() => players.map(p => ({
    ...p, score: p.money + p.influence * 2 + p.assets.reduce((s, a) => s + a.cost, 0) + (p.role ? 3 : 0) - p.scandals * 2,
  })).sort((a, b) => b.score - a.score), [players]);

  const update = (id: number, fn: (p: Player) => Player) => setPlayers(ps => ps.map(p => p.id === id ? fn(p) : p));
  const say = (text: string) => setLog(xs => [text, ...xs].slice(0, 30));
  const spendAction = () => setActionsLeft(x => Math.max(0, x - 1));

  const buy = (asset: AssetCard) => {
    const discount = event.district === asset.district ? (event.marketDiscount ?? 0) : 0;
    const capitalist = me.role === "capitalist" ? 2 : 0;
    const cost = Math.max(1, asset.cost - discount - capitalist);
    if (me.money < cost || actionsLeft < 1) return;
    update(me.id, p => ({ ...p, money: p.money - cost, influence: p.influence + asset.influence + (event.id === "election" && asset.district === "government" ? asset.influence : 0), roofs: p.roofs + (asset.tags.includes("security") ? 1 : 0), assets: [...p.assets, asset] }));
    setMarket(xs => xs.filter(a => a.id !== asset.id));
    say(`${me.name} покупает «${asset.title}» в районе «${DISTRICTS.find(d => d.id === asset.district)?.title}» за ${cost}$.`);
    spendAction();
  };

  const claimRole = (roleId: RoleId) => {
    if (actionsLeft < 1 || me.influence < 3 || occupied.has(roleId)) return;
    update(me.id, p => ({ ...p, influence: p.influence - 3, role: roleId }));
    say(`${me.name} тратит 3 влияния и получает роль «${ROLES.find(r => r.id === roleId)?.title}».`);
    spendAction();
  };

  const rolePower = () => {
    if (!me.role || actionsLeft < 1 || rolePowerUsed) return;
    if (me.role === "politician") update(me.id, p => p.scandals ? { ...p, scandals: p.scandals - 1 } : { ...p, money: p.money + 2 });
    if (me.role === "journalist") {
      const leader = scores.find(p => p.id !== me.id)!;
      update(leader.id, p => protectOr(p, q => ({ ...q, scandals: q.scandals + 1 })));
    }
    if (me.role === "mafia") update(target, p => p.money >= 2 ? { ...p, money: p.money - 2 } : { ...p, scandals: p.scandals + 1 });
    if (me.role === "military") update(target, p => ({ ...p, blockedAsset: p.assets[0]?.id ?? null }));
    if (me.role === "capitalist") update(me.id, p => ({ ...p, money: p.money + 2 }));
    if (me.role === "fraudster") update(me.id, p => ({ ...p, money: p.money + 1, influence: p.influence + 1 }));
    say(`${me.name} использует полномочия роли «${role?.title}».`);
    setRolePowerUsed(true);
    spendAction();
  };

  const protectOr = (p: Player, effect: (p: Player) => Player) => {
    if (p.roofs > 0 && window.confirm(`${p.name}: потратить Крышу и отменить направленный эффект?`)) {
      return { ...p, roofs: p.roofs - 1 };
    }
    return effect(p);
  };

  const playCard = (card: ActionCard) => {
    if (actionsLeft < 1) return;
    if (card.kind === "clean") update(me.id, p => ({ ...p, scandals: Math.max(0, p.scandals - 1) }));
    if (card.kind === "roof") update(me.id, p => ({ ...p, roofs: p.roofs + 1 }));
    if (card.kind === "grant") update(me.id, p => ({ ...p, money: p.money + card.value, influence: p.influence + (p.assets.some(a => a.tags.includes("ai")) ? 1 : 0) }));
    if (card.kind === "influence" && me.money >= 2) update(me.id, p => ({ ...p, money: p.money - 2, influence: p.influence + 2 }));
    if (card.kind === "deal") { update(me.id, p => ({ ...p, money: p.money + 2 })); update(target, p => ({ ...p, money: p.money + 2 })); }
    if (card.kind === "scandal") update(target, p => protectOr(p, q => ({ ...q, scandals: q.scandals + 1 })));
    if (card.kind === "fine") update(target, p => protectOr(p, q => q.money >= 3 ? ({ ...q, money: q.money - 3 }) : ({ ...q, scandals: q.scandals + 1 })));
    if (card.kind === "steal") { update(me.id, p => ({ ...p, money: p.money + 1 })); update(target, p => protectOr(p, q => ({ ...q, money: Math.max(0, q.money - 2) }))); }
    update(me.id, p => ({ ...p, hand: p.hand.filter(c => c.id !== card.id) }));
    say(`${me.name} играет карту «${card.title}» против ${players[target]?.name ?? "города"}.`);
    spendAction();
  };

  const greyScheme = (risk: "safe" | "bold") => {
    if (actionsLeft < 1) return;
    const hasGrey = me.assets.some(a => a.tags.includes("grey"));
    const success = Math.random() < (risk === "safe" ? .75 : .5) + (me.role === "fraudster" ? .15 : 0);
    const reward = (risk === "safe" ? 3 : 6) + (hasGrey ? 1 : 0) + (me.role === "fraudster" ? 2 : 0);
    if (success) {
      update(me.id, p => ({ ...p, money: p.money + reward }));
      say(`${me.name} проводит ${risk === "safe" ? "осторожную" : "наглую"} серую схему: +${reward}$.`);
    } else {
      update(me.id, p => ({ ...p, scandals: p.scandals + (risk === "safe" ? 1 : 2) }));
      say(`Схема ${me.name} раскрыта: получены скандалы.`);
    }
    spendAction();
  };

  const buyRoof = () => {
    const cost = me.role === "mafia" ? 2 : 3;
    if (actionsLeft < 1 || me.money < cost) return;
    update(me.id, p => ({ ...p, money: p.money - cost, roofs: p.roofs + 1 }));
    say(`${me.name} покупает Крышу за ${cost}$.`); spendAction();
  };

  const endTurn = () => {
    if (turn < players.length - 1) { setTurn(turn + 1); setTarget(turn + 1 === players.length - 1 ? 0 : turn + 2); setActionsLeft(3); setRolePowerUsed(false); return; }
    if (round >= 10) { setFinished(true); say(`Игра окончена. Побеждает ${scores[0].name}: ${scores[0].score} очков.`); return; }
    const nextEventDeck = eventDeck.length > 1 ? eventDeck.slice(1) : shuffle(EVENTS);
    const nextEvent = nextEventDeck[0];
    setPlayers(ps => ps.map(p => {
      let income = p.assets.reduce((sum, a) => sum + (a.id === p.blockedAsset ? 0 : a.income * (event.district === a.district ? event.incomeMultiplier ?? 1 : 1)), 0);
      if (p.role === "capitalist") income += p.assets.filter(a => a.district === "business").length;
      const losesRole = p.scandals >= 3;
      return { ...p, money: p.money + income, role: losesRole ? null : p.role, scandals: losesRole ? 0 : p.scandals, blockedAsset: null, hand: [...p.hand, shuffle(ACTIONS)[0]].slice(-4) };
    }));
    const owned = new Set(players.flatMap(p => p.assets.map(a => a.id)));
    const available = marketDeck.filter(a => !market.some(m => m.id === a.id) && !owned.has(a.id));
    const refill = available.slice(0, Math.max(0, 6 - market.length));
    setMarket(xs => [...xs, ...refill]); setMarketDeck(available.slice(refill.length));
    setEventDeck(nextEventDeck); setEvent(nextEvent); setRound(round + 1); setTurn(0); setTarget(1); setActionsLeft(3); setRolePowerUsed(false);
    say(`Начинается раунд ${round + 1}. Событие: «${nextEvent.title}».`);
  };

  return <div className="city-game">
    <header className="city-head"><div><h1>Город влияния <small>digital prototype</small></h1><p>Раунд {round}/10 · Ход: <b>{me.name}</b> · Действий: <b>{actionsLeft}</b></p></div><a className="btn" href="?legacy=1">← Старый MVP</a></header>
    <div className="city-event"><strong>📰 {event.title}</strong><span>{event.text}</span></div>
    <section className="city-players">{players.map(p => <article className={`city-player ${p.id === me.id ? "active" : ""}`} key={p.id}><b>{p.name}</b><span>💰{p.money}　◆{p.influence}　⚠{p.scandals}/3　🛡{p.roofs}</span><small>{ROLES.find(r => r.id === p.role)?.title ?? "без роли"} · объектов {p.assets.length}</small></article>)}</section>
    {finished ? <section className="city-finish"><h2>Итоги города</h2>{scores.map((p, i) => <p key={p.id}>{i + 1}. <b>{p.name}</b> — {p.score} очков</p>)}<button className="btn primary" onClick={() => location.reload()}>Новая партия</button></section> :
    <main className="city-layout">
      <section className="city-map"><h2>Районы и рынок</h2><div className="district-grid">{DISTRICTS.map(d => <div className={`district ${district === d.id ? "selected" : ""}`} style={{"--district": d.color} as React.CSSProperties} onClick={() => setDistrict(d.id)} key={d.id}><h3>{d.icon} {d.title}</h3><p>{d.description}</p><div className="market-cards">{market.filter(a => a.district === d.id).map(a => { const price = Math.max(1, a.cost - (event.district === a.district ? event.marketDiscount ?? 0 : 0) - (me.role === "capitalist" ? 2 : 0)); return <button className="market-card" disabled={me.money < price || actionsLeft < 1} onClick={() => buy(a)} key={a.id}><b>{a.title}</b><span>Цена {price}$ · Доход {a.income}$ · ◆{a.influence}</span><small>{a.text}</small></button>})}</div></div>)}</div></section>
      <aside className="city-actions"><h2>Решения</h2><label>Цель<select value={target} onChange={e => setTarget(Number(e.target.value))}>{players.filter(p => p.id !== me.id).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <div className="action-group"><b>Роль</b><div className="role-market">{ROLES.map(r => <button disabled={occupied.has(r.id) || me.influence < 3 || actionsLeft < 1} onClick={() => claimRole(r.id)} style={{borderColor:r.color}} key={r.id}>{r.title}<small>{r.passive}</small></button>)}</div>{me.role && <button className="btn full-width" disabled={rolePowerUsed || actionsLeft < 1} onClick={rolePower}>{rolePowerUsed ? "Полномочие уже использовано" : `Использовать роль: ${role?.power}`}</button>}</div>
        <div className="action-group"><b>Карты в руке</b>{me.hand.map(c => <button className={`action-card ${c.tone}`} onClick={() => playCard(c)} disabled={actionsLeft < 1} key={c.id}><strong>{c.title}</strong><small>{c.text}</small></button>)}</div>
        <div className="action-group"><b>Серые схемы</b><button className="btn" onClick={() => greyScheme("safe")}>Осторожная: 75% → +3$</button><button className="btn danger" onClick={() => greyScheme("bold")}>Наглая: 50% → +6$ / 2 скандала</button></div>
        <button className="btn" onClick={buyRoof}>Купить Крышу ({me.role === "mafia" ? 2 : 3}$)</button><button className="btn primary full-width" onClick={endTurn}>Завершить ход</button>
      </aside>
      <aside className="city-log"><h2>Городская хроника</h2>{log.map((x,i)=><p key={i}>{x}</p>)}</aside>
    </main>}
  </div>;
}
