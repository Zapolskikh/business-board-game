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
  role: RoleId | null; assets: OwnedAsset[]; hand: HeldActionCard[]; projects: number; capacity: number;
}
type DistrictLevels = Record<DistrictId, number>;

const MAX_ROUNDS = 10;
const MAX_CAPACITY = 6;
const CAPACITY_COST: Record<number, number> = { 3: 6, 4: 10, 5: 15 };
const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - .5);
const freshMarket = (cycle: number): MarketAsset[] => shuffle(ASSETS).map((a, i) => ({ ...a, uid: `${a.id}:${cycle}:${i}` }));
let cardSequence = 0;
const actionCard = (card: ActionCard): HeldActionCard => ({ ...card, uid: `${card.id}:${++cardSequence}` });
const freshHand = () => shuffle(ACTIONS).slice(0, 3).map(actionCard);
const initialPlayers = (): Player[] => ["Игрок 1", "Бот-инвестор", "Бот-политик", "Бот-аферист"].map((name, id) => ({
  id, name, isBot: id > 0, money: 10, influence: 2, scandals: 0, roofs: 0, role: null,
  assets: [], hand: freshHand(), projects: 0, capacity: 3,
}));
const initialDistricts = (): DistrictLevels => ({ residential: 0, business: 0, industrial: 0, tech: 0, government: 0, shadows: 0 });
const directedKinds = new Set(["deal", "scandal", "fine", "steal"]);
const districtCount = (player: Player, district: DistrictId) => player.assets.filter(a => a.district === district).length;
const districtSynergy = (player: Player, district: DistrictId) => districtCount(player, district) >= 4 ? 2 : districtCount(player, district) >= 2 ? 1 : 0;
const roleSupports = (player: Player, district: DistrictId) => !!player.role && ROLES.find(r => r.id === player.role)?.districts.includes(district);
const specialIncome = (player: Player, asset: OwnedAsset, currentEvent: EventCard) => {
  const has = (district: DistrictId) => districtCount(player, district) > 0;
  if (asset.id === "delivery" && currentEvent.id === "festival") return 1;
  if (asset.id === "fund") return districtCount(player, "tech");
  if (asset.id === "bank") return Math.max(0, districtCount(player, "business") - 1);
  if (asset.id === "cowork" && has("residential")) return 1;
  if (asset.id === "battery" && has("residential")) return 1;
  if (asset.id === "ai" && has("business")) return 1;
  if (asset.id === "crypto" && has("shadows")) return 1;
  if (asset.id === "market" && (has("residential") || has("business"))) return 1;
  if (asset.id === "datacenter" && has("tech")) return 1;
  return 0;
};

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
  const roleCost = (holder?: Player) => holder
    ? Math.max(3, 5 - holder.scandals) + (holder.assets.some(a => a.id === "lobby") ? 1 : 0)
    : 3;

  const assetValue = (a: OwnedAsset) => Math.floor(a.cost / 2) + (a.automated ? 2 : 0) + (a.scaled ? 2 : 0);
  const isManaged = (_assets: OwnedAsset[], index: number) => index < me.capacity;
  const assetAbilities = (asset: OwnedAsset): { text: string; active: boolean }[] => {
    const has = (district: DistrictId) => districtCount(me, district) > 0;
    const abilities: Record<string, { text: string; active: boolean }[]> = {
      housing: [{ text: "Стабильный объект без условий.", active: true }],
      delivery: [{ text: "+1$ во время Городского фестиваля.", active: event.id === "festival" }],
      media: [{ text: "+1 влияние за раунд с Административным кварталом.", active: has("government") }],
      fund: [{ text: `+1$ за каждый объект Технокластера (${districtCount(me, "tech")}).`, active: has("tech") }],
      bank: [{ text: "+1$ за каждый другой объект Делового центра.", active: districtCount(me, "business") > 1 }],
      cowork: [{ text: "+1$ с объектом Спального района.", active: has("residential") }],
      robotics: [{ text: "Высокий базовый доход без дополнительного условия.", active: true }],
      battery: [{ text: "+1$ с объектом Спального района.", active: has("residential") }],
      logistics: [{ text: "Промышленные покупки дешевле на 1$.", active: true }],
      ai: [
        { text: "+1$ с объектом Делового центра.", active: has("business") },
        { text: "Инновационный грант даёт +1 влияние.", active: true },
      ],
      crypto: [
        { text: "+1$ с объектом Серого сектора.", active: has("shadows") },
        { text: "Открывает серые схемы.", active: !asset.blocked || asset.automated },
      ],
      data: [{ text: "+1 влияние за раунд с Административным кварталом.", active: has("government") }],
      contract: [{ text: "+1 влияние за раунд для Политика.", active: me.role === "politician" }],
      security: [{ text: "При покупке выдала Крышу.", active: true }],
      lobby: [{ text: "Переворот против вашей роли стоит на 1 влияние дороже.", active: me.role !== null }],
      cash: [{ text: "Открывает серые схемы.", active: !asset.blocked || asset.automated }],
      market: [
        { text: "+1$ со Спальным районом или Деловым центром.", active: has("residential") || has("business") },
        { text: "Открывает серые схемы.", active: !asset.blocked || asset.automated },
      ],
      datacenter: [
        { text: "+1$ с объектом Технокластера.", active: has("tech") },
        { text: "Открывает серые схемы.", active: !asset.blocked || asset.automated },
      ],
    };
    return abilities[asset.id] ?? [{ text: "Базовый объект.", active: true }];
  };
  const assetIncome = (asset: OwnedAsset, index: number) => {
    const roleIncome = me.role === "capitalist" && asset.district === "business" ? 1 : 0;
    if (!isManaged(me.assets, index) || (asset.blocked && !asset.automated)) return roleIncome;
    const base = asset.income + (asset.scaled ? 2 : 0) + (asset.automated ? 1 : 0);
    const districtBonus = 1 + districtLevels[asset.district] * .25;
    const eventBonus = event.district === asset.district ? event.incomeMultiplier ?? 1 : 1;
    return Math.floor(base * districtBonus * eventBonus) + roleIncome + districtSynergy(me, asset.district)
      + (roleSupports(me, asset.district) ? 1 : 0) + specialIncome(me, asset, event);
  };
  const roleBonuses: Record<RoleId, string> = {
    capitalist: "Все покупки дешевле на 1$; каждый объект Делового центра даёт +1$ за раунд; полномочие даёт +2$.",
    politician: "Профильные районы дают +1$ с объекта; госуслуги дают +1 влияние; полномочие снимает скандал или даёт +2$.",
    journalist: "Профильные районы дают +1$ с объекта; полномочие даёт 1 скандал лидеру по очкам.",
    fraudster: "Профильные районы дают +1$ с объекта; серые схемы получают +20% шанса и +1$; полномочие даёт +1$ и +1 влияние.",
    mafia: "Профильные районы дают +1$ с объекта; Крыша дешевле и лимит 2; полномочие отнимает 2$ или даёт скандал.",
    military: "Профильные районы дают +1$ с объекта; полномочие блокирует первый неавтоматизированный объект цели.",
  };
  const activeBonuses = [
    role ? `Роль «${role.title}»: ${roleBonuses[role.id]}` : "Роль: отсутствует.",
    `Событие «${event.title}»: ${event.text}`,
    ...DISTRICTS.filter(d => districtLevels[d.id] > 0)
      .map(d => `${d.title}: +${districtLevels[d.id] * 25}% к доходу объектов.`),
    ...DISTRICTS.filter(d => districtCount(me, d.id) >= 2)
      .map(d => `${d.title} ${districtCount(me, d.id)}/4: синергия +${districtSynergy(me, d.id)}$ каждому объекту района.`),
    ...(me.assets.some(a => a.tags.includes("grey") && !a.blocked) ? ["Серые объекты: доступны серые схемы."] : []),
    ...(me.assets.some(a => a.tags.includes("ai")) ? ["ИИ: «Инновационный грант» даёт дополнительно +1 влияние."] : []),
    ...(me.roofs > 0 ? [`Крыша: ${me.roofs} заряд(а) защиты от направленных эффектов.`] : []),
    `Содержание бизнеса: −${me.assets.length}$ в конце раунда.`,
  ];
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
    const logisticsDiscount = asset.district === "industrial" && me.assets.some(a => a.id === "logistics") ? 1 : 0;
    return Math.max(1, asset.cost - eventDiscount - roleDiscount - logisticsDiscount);
  };

  const buy = (asset: MarketAsset) => {
    const cost = priceOf(asset);
    if (actionsLeft < 1 || me.money < cost || me.assets.length >= me.capacity) return;
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
    const cost = kind === "automate" ? 5 : 4;
    if (!asset || actionsLeft < 1 || me.money < cost || asset.automated || asset.scaled) return;
    update(me.id, p => ({ ...p, money: p.money - cost, assets: p.assets.map(a => a.uid === uid ? { ...a, automated: kind === "automate" || a.automated, scaled: kind === "scale" || a.scaled } : a) }));
    say(`${me.name} ${kind === "automate" ? "автоматизирует" : "масштабирует"} «${asset.title}».`); spendAction();
  };

  const buyCapacity = () => {
    const cost = CAPACITY_COST[me.capacity];
    if (!cost || actionsLeft < 1 || me.money < cost || me.capacity >= MAX_CAPACITY) return;
    update(me.id, p => ({ ...p, money: p.money - cost, capacity: p.capacity + 1 }));
    say(`${me.name} расширяет бизнес до ${me.capacity + 1} активных слотов за ${cost}$.`); spendAction();
  };

  const sellAsset = (uid: string) => {
    const asset = me.assets.find(a => a.uid === uid); if (!asset || actionsLeft < 1) return;
    const value = assetValue(asset);
    update(me.id, p => ({ ...p, money: p.money + value, assets: p.assets.filter(a => a.uid !== uid) }));
    say(`${me.name} продаёт «${asset.title}» за ${value}$.`); spendAction();
  };

  const claimRole = (roleId: RoleId) => {
    const holder = roleHolder(roleId);
    const cost = roleCost(holder);
    if (actionsLeft < 1 || me.influence < cost || holder?.id === me.id) return;
    if (holder && holder.roofs > 0) {
      setPlayers(ps => ps.map(p => p.id === me.id ? { ...p, influence: p.influence - cost }
        : p.id === holder.id ? { ...p, roofs: p.roofs - 1 } : p));
      say(`${me.name} пытается отобрать роль «${ROLES.find(r => r.id === roleId)?.title}», но ${holder.name} тратит Крышу.`);
      spendAction(); return;
    }
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
    if (me.role === "military" && target !== null) update(target, p => protectOr(p, q => {
      const victim = q.assets.find(a => !a.automated);
      return { ...q, assets: q.assets.map(a => a.uid === victim?.uid ? { ...a, blocked: true } : a) };
    }));
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
    const greyAssets = me.assets.filter(a => a.tags.includes("grey") && (!a.blocked || a.automated));
    if (actionsLeft < 1 || greyAssets.length === 0) return;
    const baseChance = risk === "safe" ? .75 : .45;
    const chance = Math.min(.9, baseChance + (me.role === "fraudster" ? .2 : 0) + Math.min(.1, greyAssets.length * .05));
    const reward = (risk === "safe" ? 3 : 7) + (me.role === "fraudster" ? 1 : 0);
    if (Math.random() < chance) { update(me.id, p => ({ ...p, money: p.money + reward })); say(`${me.name}: серая схема успешна, +${reward}$.`); }
    else { update(me.id, p => ({ ...p, scandals: p.scandals + (risk === "safe" ? 1 : 2), assets: risk === "bold" ? p.assets.map(a => a.uid === greyAssets[0].uid ? { ...a, blocked: true } : a) : p.assets })); say(`${me.name}: схема раскрыта.`); }
    spendAction();
  };

  const investDistrict = () => {
    if (actionsLeft < 1 || me.money < 2 || districtLevels[district] >= 2 || districtCount(me, district) < 2) return;
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
      let income = -p.assets.length; // operating costs keep money relevant
      const assets = p.assets.map(a => {
        const active = !a.blocked || a.automated;
        const districtFactor = 1 + districtLevels[a.district] * .25;
        const eventFactor = event.district === a.district ? event.incomeMultiplier ?? 1 : 1;
        const base = a.income + (a.scaled ? 2 : 0) + (a.automated ? 1 : 0);
        if (active) income += Math.floor(base * districtFactor * eventFactor)
          + districtSynergy(p, a.district) + (roleSupports(p, a.district) ? 1 : 0) + specialIncome(p, a, event);
        return { ...a, blocked: false };
      });
      if (p.role === "capitalist") income += assets.filter(a => a.district === "business").length;
      const passiveInfluence = (assets.some(a => a.id === "media") && districtCount(p, "government") > 0 ? 1 : 0)
        + (assets.some(a => a.id === "data") && districtCount(p, "government") > 0 ? 1 : 0)
        + (p.role === "politician" ? assets.filter(a => a.id === "contract").length : 0);
      const losesRole = p.scandals >= 3;
      const rolelessFine = losesRole && !p.role ? 3 : 0;
      return { ...p, assets, money: Math.max(0, p.money + income - rolelessFine), influence: p.influence + passiveInfluence, role: losesRole ? null : p.role, scandals: losesRole ? 0 : p.scandals, hand: [...p.hand, actionCard(shuffle(ACTIONS)[0])].slice(-4) };
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
      const affordable = market.filter(a => priceOf(a) <= me.money)
        .sort((a, b) => (b.income / priceOf(b) + districtCount(me, b.district) * .35 + b.influence * .08)
          - (a.income / priceOf(a) + districtCount(me, a.district) * .35 + a.influence * .08));
      if (affordable.length && me.assets.length < me.capacity) { buy(affordable[0]); return; }
      const capacityCost = CAPACITY_COST[me.capacity];
      if (affordable.length && capacityCost && me.money >= capacityCost) { buyCapacity(); return; }
      if (!me.role) {
        const wanted: RoleId[] = me.id === 1 ? ["capitalist", "military"] : me.id === 2 ? ["politician", "journalist"] : ["fraudster", "mafia"];
        const available = wanted.find(r => roleHolder(r)?.id !== me.id && me.influence >= roleCost(roleHolder(r)));
        if (available) { claimRole(available); return; }
      }
      if (me.id === 3 && me.assets.some(a => a.tags.includes("grey") && (!a.blocked || a.automated))) { greyScheme(me.scandals < 2 ? "bold" : "safe"); return; }
      if (me.id === 2 && me.money >= 2) { basicAction("campaign"); return; }
      const scalable = me.assets.find(a => !a.scaled && !a.automated);
      if (scalable && me.money >= 4) { improve(scalable.uid, me.id === 1 ? "scale" : "automate"); return; }
      basicAction("work");
    }, 550);
    return () => window.clearTimeout(timer);
  }, [turn, actionsLeft, round, finished, players, market]);

  return <div className="city-game">
    <header className="city-head"><div><h1>Город влияния <small>strategy prototype v2</small> <span className="game-version" title="Версия сборки">v{__GAME_VERSION__}</span></h1><p>Раунд {round}/{MAX_ROUNDS} · Ход: <b>{me.name}</b> · Действий: <b>{actionsLeft}</b>{me.isBot && <span className="bot-thinking"> · принимает решение…</span>}</p></div><div className="city-head-buttons"><button className="btn" onClick={() => setShowRules(x => !x)}>📖 Правила</button><a className="btn" href="?legacy=1">Старый MVP</a></div></header>
    <div className="city-event"><strong>📰 {event.title}</strong><span>{event.text}</span><em>Городские проекты: 3◆ → 6 итоговых очков</em></div>
    <section className="city-players">{players.map(p => <article className={`city-player ${p.id === me.id ? "active" : ""}`} key={p.id}><b>{p.name} <em>{scoreOf(p)} оч.</em></b><span>💰{p.money}　◆{p.influence}　⚠{p.scandals}/3　🛡{p.roofs}</span><small>{ROLES.find(r => r.id === p.role)?.title ?? "без роли"} · объектов {p.assets.length}</small></article>)}</section>
    {finished ? <section className="city-finish"><h2>Итоги города</h2>{scores.map((p, i) => <p key={p.id}>{i + 1}. <b>{p.name}</b> — {p.score} очков</p>)}<h3>Полный журнал</h3><p className="dim">Сохранено записей: {log.length}. В файле действия расположены от начала игры к завершению.</p><div className="log-export-actions"><button className="btn" onClick={copyGameLog}>Копировать лог</button><button className="btn" onClick={downloadGameLog}>Скачать .txt</button></div>{logExportStatus && <p className="log-export-status">{logExportStatus}</p>}<button className="btn primary" onClick={() => location.reload()}>Новая партия</button></section> : <main className="city-layout">
      <section className="city-map"><h2>Районы и рынок</h2><div className="district-grid">{DISTRICTS.map(d => <div className={`district ${district === d.id ? "selected" : ""}`} style={{"--district": d.color} as React.CSSProperties} onClick={() => setDistrict(d.id)} key={d.id}><h3>{d.icon} {d.title} <span className="district-level">{districtCount(me, d.id)}/4 · +{districtSynergy(me, d.id)}$</span></h3><p>{d.description}</p><div className="market-cards">{market.filter(a => a.district === d.id).map(a => <button className="market-card" title={me.assets.length >= me.capacity ? "Нет свободного слота: продайте объект или расширьте бизнес" : a.text} disabled={me.money < priceOf(a) || actionsLeft < 1 || me.assets.length >= me.capacity} onClick={() => buy(a)} key={a.uid}><b>{a.title}</b><span>{priceOf(a)}$ · доход {a.income}$ · ◆{a.influence}</span><small>{a.text}</small></button>)}</div></div>)}</div>
        <div className="owned-panel">
          <h2>Ваш бизнес · слоты {me.assets.length}/{me.capacity}</h2>
          <section className="active-bonuses"><h3>Активные бонусы</h3><ul>{activeBonuses.map((bonus, i) => <li key={i}>{bonus}</li>)}</ul></section>
          <p className="dim">Все объекты занимают слоты. При полном составе продайте слабый объект или купите следующий слот.</p>
          {me.assets.length === 0 ? <p className="dim">Купите первый объект на рынке.</p> : <div className="owned-grid">{me.assets.map((a, i) => {
            const managed = isManaged(me.assets, i);
            const districtName = DISTRICTS.find(d => d.id === a.district)?.title;
            return <article className={a.blocked && !a.automated ? "blocked" : ""} key={a.uid}>
              <b>{a.title}</b>
              <span>{districtName} · {managed ? "● управляется" : "○ без управления"}</span>
              <strong className="asset-income">Доход в этом раунде: {assetIncome(a, i)}$</strong>
              <small>База {a.income}$ {a.automated && "· автоматизация +1$"} {a.scaled && "· масштаб +2$"} {districtLevels[a.district] > 0 && `· район +${districtLevels[a.district] * 25}%`} {event.district === a.district && event.incomeMultiplier && `· событие ×${event.incomeMultiplier}`}</small>
              <div className="asset-abilities">{assetAbilities(a).map((ability, abilityIndex) => <small className={`asset-ability ${ability.active ? "active" : "inactive"}`} key={abilityIndex}>{ability.active ? "✓ " : "○ "}{ability.text}</small>)}</div>
              <div>
                <button className={a.automated ? "upgrade-complete" : ""} title="Безопасная ветка: +1$ дохода и иммунитет к блокировке" disabled={a.automated || a.scaled || me.money < 5 || actionsLeft < 1} onClick={() => improve(a.uid,"automate")}>{a.automated ? "✓ Автоматизация: +1$, защита" : a.scaled ? "Недоступно: выбран масштаб" : "Автоматизация 5$ → +1$ и защита"}</button>
                <button className={a.scaled ? "upgrade-complete" : ""} title="Доходная ветка: +2$ дохода" disabled={a.scaled || a.automated || me.money < 4 || actionsLeft < 1} onClick={() => improve(a.uid,"scale")}>{a.scaled ? "✓ Масштабировано +2$" : a.automated ? "Недоступно: выбрана автоматизация" : "Масштаб 4$ → +2$"}</button>
                <button disabled={actionsLeft < 1} onClick={() => sellAsset(a.uid)}>Продать {assetValue(a)}$</button>
              </div>
            </article>;
          })}</div>}
        </div>
      </section>
      <aside className={`city-actions ${me.isBot ? "bot-turn" : ""}`}><h2>Решения <span className="action-counter">{actionsLeft}/3</span></h2>{me.isBot && <p className="bot-action-note">🤖 Бот анализирует рынок и продолжит автоматически.</p>}{actionsLeft === 0 && !me.isBot && <p className="no-actions">Действия потрачены. Завершите ход.</p>}<label className={`target-picker ${target === null ? "required" : ""}`}>Цель<select value={target ?? ""} onChange={e => setTarget(e.target.value === "" ? null : Number(e.target.value))}><option value="">— выберите игрока —</option>{players.filter(p => p.id !== me.id).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <div className="action-group"><b>Город</b><button className="btn" disabled={actionsLeft < 1} onClick={() => basicAction("work")}>Городской заказ: +2$</button><button className="btn" disabled={actionsLeft < 1 || me.money < 2} onClick={() => basicAction("campaign")}>Кампания: 2$ → 2 влияния</button><button className="btn" disabled={actionsLeft < 1 || me.influence < 3} onClick={cityProject}>Городской проект: 3◆ → 6 очков</button><button className="btn" disabled={actionsLeft < 1 || me.capacity >= MAX_CAPACITY || me.money < (CAPACITY_COST[me.capacity] ?? Infinity)} onClick={buyCapacity}>{me.capacity >= MAX_CAPACITY ? "✓ Максимум 6 слотов" : `Купить слот ${me.capacity + 1}: ${CAPACITY_COST[me.capacity]}$`}</button><button className="btn" title="+25% дохода всем объектам выбранного района; +1◆, если у вас там есть объект. Максимум 2 уровня" disabled={actionsLeft < 1 || me.money < 2 || districtLevels[district] >= 2 || districtCount(me, district) < 2} onClick={investDistrict}>Развить район (нужно 2 объекта): 2$ → +25% дохода{me.assets.some(a => a.district === district) ? " +1◆" : ""}</button></div>
        <div className="action-group"><b>Роли · свободная 3◆, переворот 3–6◆</b><div className="role-market">{ROLES.map(r => { const holder=roleHolder(r.id);const cost=roleCost(holder);return <button disabled={holder?.id===me.id || me.influence<cost || actionsLeft<1} onClick={() => claimRole(r.id)} style={{borderColor:r.color}} key={r.id}>{r.title} · {cost}◆<small>{holder ? `занята: ${holder.name}${holder.roofs ? " · защищена Крышей" : ""}` : r.passive}</small></button>})}</div>{me.role && <button className="btn full-width" disabled={rolePowerUsed || actionsLeft<1 || (["mafia","military"].includes(me.role)&&target===null)} onClick={rolePower}>{rolePowerUsed ? "Полномочие использовано" : role?.power}</button>}</div>
        <div className="action-group"><b>Карты · сыграть или конвертировать без действия</b>{me.hand.map(c => { const targeted=directedKinds.has(c.kind);return <div className={`hand-card ${c.tone}`} key={c.uid}><button className="action-card" onClick={() => playCard(c)} disabled={actionsLeft<1||(targeted&&target===null)||(c.kind==="influence"&&me.money<2)}><strong>{c.title}<em>{targeted?`→ ${targetPlayer?.name??"цель"}`:"→ себе"}</em></strong><small>{c.text}</small></button><div><button onClick={() => convertCard(c,"money")}>Продать +1$</button><button onClick={() => convertCard(c,"influence")}>Сбросить +1◆</button></div></div>})}</div>
        <div className="action-group"><b>Серые схемы · нужен активный серый объект</b><button className="btn" disabled={actionsLeft<1||!me.assets.some(a=>a.tags.includes("grey")&&(!a.blocked||a.automated))} onClick={() => greyScheme("safe")}>Осторожная: 75% → +3$</button><button className="btn danger" disabled={actionsLeft<1||!me.assets.some(a=>a.tags.includes("grey")&&(!a.blocked||a.automated))} onClick={() => greyScheme("bold")}>Наглая: 45% → +7$ / 2 скандала</button></div>
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
  <article><h3>🏙️ Комбинации районов</h3><p>Два объекта района дают каждому +1$ дохода, четыре — +2$. Развивать район можно только с двумя своими объектами: уровень стоит 2$ и добавляет ещё +25% дохода.</p></article>
  <article><h3>⚙️ Слоты бизнеса</h3><p>В начале доступны 3 объекта. Новые слоты стоят 6/10/15$. При полном составе нужно продать объект или расшириться; каждый объект требует 1$ содержания за раунд.</p></article>
  <article><h3>🔧 Ветка улучшения</h3><p>Объект выбирает одну ветку: автоматизация за 5$ даёт +1$ и иммунитет к блокировке; масштабирование за 4$ даёт +2$, но оставляет объект уязвимым. Вторая ветка закрывается.</p></article>
  <article><h3>🏷️ Роли</h3><p>Свободная роль стоит 3 влияния. Занятую можно отобрать за 3–5. Три скандала снимают роль; игрок без роли платит кризисный штраф 3$.</p></article>
  <article><h3>🃏 Карты</h3><p>Карту можно сыграть за действие, продать за 1$ или сбросить за 1 влияние. Поэтому разыгрывать всю руку не всегда выгодно.</p></article>
  <article><h3>🌒 Серые схемы</h3><p>Требуют хотя бы один объект Серого сектора. Аферист повышает шанс и награду; провал блокирует бизнес и создаёт скандалы.</p></article>
  <article><h3>🛡️ Крыша</h3><p>Отменяет направленный финансовый, репутационный или силовой эффект. Обычный лимит — одна, у Мафиози — две.</p></article>
  <article><h3>💡 Первый план</h3><p>Купите 1–2 компании → получите влияние → захватите профильную роль → решите, масштабировать экономику или атаковать лидера.</p></article>
</div></section>; }
