import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS, ASSETS, ASSET_RARITY_LABELS, DISTRICTS, EVENTS, ROLES,
  type ActionCard, type AssetCard, type DistrictId, type EventCard, type RoleId,
} from "./data";

type OwnedAsset = AssetCard & { uid: string; automated: boolean; scaled: boolean; blocked: boolean };
type MarketAsset = AssetCard & { uid: string };
type HeldActionCard = ActionCard & { uid: string };
interface Player {
  id: number; name: string; isBot: boolean; money: number; influence: number; scandals: number; roofs: number;
  role: RoleId | null; copiedRole: RoleId | null; pendingRole: RoleId | null; jailTurns: number;
  assets: OwnedAsset[]; hand: HeldActionCard[]; projects: number; capacity: number; scandalGainedThisRound: number;
  debt: number; roleShields: number; scandalShields: number; zoningDistrict: DistrictId | null;
}
type DistrictLevels = Record<DistrictId, number>;
interface GameSettings { humanPlayers: number; botPlayers: number; maxRounds: number; rolePrice: number }

const DEFAULT_SETTINGS: GameSettings = { humanPlayers: 1, botPlayers: 3, maxRounds: 15, rolePrice: 5 };
const MAX_CAPACITY = 6;
const CAPACITY_COST: Record<number, number> = { 3: 6, 4: 10, 5: 15 };
const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - .5);
const freshMarket = (): MarketAsset[] => shuffle(ASSETS).map((a, i) => ({ ...a, uid: `${a.id}:${i}` }));
let cardSequence = 0;
const actionCard = (card: ActionCard): HeldActionCard => ({ ...card, uid: `${card.id}:${++cardSequence}` });
const initialPlayers = (settings: GameSettings): Player[] => Array.from({ length: settings.humanPlayers + settings.botPlayers }, (_, id) => ({
  id, name: id < settings.humanPlayers ? `Игрок ${id + 1}` : `Бот ${id - settings.humanPlayers + 1}`,
  isBot: id >= settings.humanPlayers, money: 10, influence: 2, scandals: 0, roofs: 0, role: null,
  copiedRole: null, pendingRole: null, jailTurns: 0, scandalGainedThisRound: 0,
  assets: [], hand: [], projects: 0, capacity: 3, debt: 0, roleShields: 0, scandalShields: 0, zoningDistrict: null,
}));
const initialDistricts = (): DistrictLevels => ({ residential: 0, business: 0, industrial: 0, tech: 0, government: 0, shadows: 0 });
const hasRole = (player: Player, role: RoleId) => player.role === role || player.copiedRole === role;
const withScandals = (player: Player, amount: number): Player => {
  if (amount > 0 && player.scandalShields > 0) return { ...player, scandalShields: player.scandalShields - 1 };
  const scandals = Math.max(0, player.scandals + amount);
  if (amount <= 0) return { ...player, scandals };
  if (scandals >= 6) return { ...player, scandals: 3, role: null, copiedRole: null, pendingRole: null, roofs: Math.max(0, player.roofs - 1), jailTurns: 1, scandalGainedThisRound: player.scandalGainedThisRound + amount };
  if (scandals >= 5) return { ...player, scandals: 5, role: null, copiedRole: null, pendingRole: null, scandalGainedThisRound: player.scandalGainedThisRound + amount };
  return { ...player, scandals, scandalGainedThisRound: player.scandalGainedThisRound + amount };
};
const districtCount = (player: Player, district: DistrictId) => player.assets.filter(a => a.district === district).length + (player.zoningDistrict === district ? 1 : 0);
const districtSynergy = (player: Player, district: DistrictId) => districtCount(player, district) >= 4 ? 2 : districtCount(player, district) >= 2 ? 1 : 0;
const roleSupports = (player: Player, district: DistrictId) =>
  (hasRole(player, "capitalist") && district === "business")
  || (hasRole(player, "politician") && district === "residential")
  || (hasRole(player, "mafia") && district === "shadows")
  || (hasRole(player, "fraudster") && district === "tech")
  || (hasRole(player, "military") && district === "industrial");
const hasDistrictLink = (player: Player, district: DistrictId) => districtCount(player, district) > 0
  || (district === "business" && hasRole(player, "capitalist"))
  || (district === "government" && hasRole(player, "politician"));
const specialIncome = (player: Player, asset: OwnedAsset, currentEvent: EventCard) => {
  const effects = asset.effects; let value = 0;
  if (effects?.eventBonus?.eventId === currentEvent.id) value += effects.eventBonus.value;
  if (effects?.journalistScandalIncome && hasRole(player, "journalist")) value += Math.min(effects.journalistScandalIncome, player.scandals);
  if (effects?.districtBonus) {
    const link = effects.districtBonus;
    if (link.perObject) {
      const ownAdjustment = link.excludeSelf && asset.district === link.district ? 1 : 0;
      const virtual = link.virtualRole && hasRole(player, link.virtualRole) ? 1 : 0;
      value += Math.max(0, districtCount(player, link.district) - ownAdjustment + virtual) * link.value;
    } else if (hasDistrictLink(player, link.district)) value += link.value;
  }
  if (effects?.roleBonus && hasRole(player, effects.roleBonus.role)) value += effects.roleBonus.value;
  return value;
};
const objectSynergyIncome = (player: Player, asset: OwnedAsset, currentEvent: EventCard) => {
  const district = districtSynergy(player, asset.district);
  const role = roleSupports(player, asset.district) ? 1 : 0;
  return (district + role + specialIncome(player, asset, currentEvent)) * (asset.automated ? 2 : 1);
};
const passiveInfluenceFor = (player: Player) => {
  const value = (asset: OwnedAsset) => asset.automated ? 2 : 1;
  const active = player.assets.filter(a => !a.blocked);
  const administrative = hasRole(player, "politician")
    ? active.filter(a => a.district === "government").reduce((sum, a) => sum + value(a), 0)
    : 0;
  const objectEffects = active.reduce((sum, asset) => {
    const bonus = asset.effects?.influenceBonus;
    if (!bonus) return sum;
    const activeRole = !bonus.role || hasRole(player, bonus.role);
    const activeDistrict = !bonus.district || hasDistrictLink(player, bonus.district);
    return sum + (activeRole && activeDistrict ? bonus.value * value(asset) : 0);
  }, 0);
  return administrative + objectEffects;
};
const effectTotal = (player: Player, key: "extraActions" | "extraInvestmentActions" | "scandalReduction" | "roofCapacity" | "turnRoof" | "maintenanceReduction" | "greyScandalReduction" | "developmentDiscount") =>
  player.assets.filter(a => !a.blocked).reduce((sum, a) => sum + (a.effects?.[key] ?? 0), 0);
const actionBonusFor = (player: Player) => Math.min(1, effectTotal(player, "extraActions"));
const investmentBonusFor = (player: Player) => Math.min(1, effectTotal(player, "extraInvestmentActions"));
const roofLimitFor = (player: Player) => (hasRole(player, "mafia") ? 2 : 1) + effectTotal(player, "roofCapacity");
const greyScandalReductionFor = (player: Player) => effectTotal(player, "greyScandalReduction");

export default function CityPrototype() {
  const firstDeck = useMemo(() => freshMarket(), []);
  const firstEvents = useMemo(() => shuffle(EVENTS), []);
  const firstActions = useMemo(() => shuffle(ACTIONS), []);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [gameStarted, setGameStarted] = useState(false);
  const [players, setPlayers] = useState(() => initialPlayers(DEFAULT_SETTINGS));
  const [round, setRound] = useState(1);
  const [turn, setTurn] = useState(0);
  const [gameStartingTurn, setGameStartingTurn] = useState(0);
  const [turnsTakenInRound, setTurnsTakenInRound] = useState(0);
  const [actionsLeft, setActionsLeft] = useState(3);
  const [turnActionLimit, setTurnActionLimit] = useState(3);
  const [investmentActions, setInvestmentActions] = useState(0);
  const [rolePowerUsed, setRolePowerUsed] = useState(false);
  const [politicianTaxUsed, setPoliticianTaxUsed] = useState(false);
  const [politicianCleanupUsed, setPoliticianCleanupUsed] = useState(false);
  const [journalistInflateUsed, setJournalistInflateUsed] = useState(false);
  const [journalistPublishUsed, setJournalistPublishUsed] = useState(false);
  const [mafiaCleanupUsed, setMafiaCleanupUsed] = useState(false);
  const [mafiaRoofSweepUsed, setMafiaRoofSweepUsed] = useState(false);
  const [mafiaRacketUsed, setMafiaRacketUsed] = useState(false);
  const [mafiaOperationBonus, setMafiaOperationBonus] = useState(0);
  const [sanctionedPlayers, setSanctionedPlayers] = useState<number[]>([]);
  const [fraudCryptoUsed, setFraudCryptoUsed] = useState(false);
  const [fraudDocsUsed, setFraudDocsUsed] = useState(false);
  const [fraudScamAmount, setFraudScamAmount] = useState(1);
  const [forgedRoleChoice, setForgedRoleChoice] = useState<RoleId>("capitalist");
  const [fraudTurnPlace, setFraudTurnPlace] = useState(1);
  const [marketDeck, setMarketDeck] = useState<MarketAsset[]>(firstDeck.slice(6));
  const [market, setMarket] = useState<MarketAsset[]>(firstDeck.slice(0, 6));
  const [actionDeck, setActionDeck] = useState<ActionCard[]>(firstActions.slice(3));
  const [actionMarket, setActionMarket] = useState<ActionCard[]>(firstActions.slice(0, 3));
  const [eventDeck, setEventDeck] = useState(firstEvents.slice(1));
  const [event, setEvent] = useState<EventCard>(firstEvents[0]);
  const [districtLevels, setDistrictLevels] = useState<DistrictLevels>(initialDistricts);
  const [target, setTarget] = useState<number | null>(null);
  const [district, setDistrict] = useState<DistrictId>("business");
  const [log, setLog] = useState<string[]>(["Город открыт для инвестиций. Постройте экономику и захватите влияние."]);
  const [finished, setFinished] = useState(false);
  const [showRules, setShowRules] = useState(true);
  const [logExportStatus, setLogExportStatus] = useState("");
  const [cardPlayedThisTurn, setCardPlayedThisTurn] = useState(false);
  const [cardMarketDiscount, setCardMarketDiscount] = useState(0);
  const [cardUpgradeDiscount, setCardUpgradeDiscount] = useState(0);
  const processingCards = useRef(new Set<string>());

  const me = players[turn];
  const role = ROLES.find(r => r.id === me.role);
  const targetPlayer = target === null ? null : players.find(p => p.id === target) ?? null;
  const roleHolder = (id: RoleId) => players.find(p => p.role === id);
  const objectsInDistrict = (districtId: DistrictId) => players.reduce((total, player) => total + districtCount(player, districtId), 0);
  const selectedDistrictObjects = objectsInDistrict(district);
  const selectedDistrictOwnObjects = districtCount(me, district);
  const roleCost = (holder?: Player) => holder ? settings.rolePrice * 2 : settings.rolePrice;
  const sanctionOutcome = (player: Player | null) => !player ? "выберите цель"
    : player.scandals < 1 ? "нет оснований"
    : player.scandals === 1 ? "забрать 1◆"
    : player.scandals === 2 ? "забрать до 3$"
    : player.scandals === 3 ? "снять Крышу или блокировать объект"
    : "снять Крышу, улучшение или конфисковать объект";
  const scandalStatus = (player: Player) => player.jailTurns > 0 ? "ТЮРЬМА"
    : player.scandals >= 5 ? "роль потеряна; следующий скандал — тюрьма"
    : player.scandals === 4 ? "ещё один скандал снимет роль"
    : player.scandals === 3 ? "доступна блокировка Силовика"
    : player.scandals === 2 ? "доступен денежный штраф"
    : player.scandals === 1 ? "доступно взыскание влияния" : "репутация чистая";
  const mafiaTributePotential = players.filter(p => p.id !== me.id).reduce((total, p) => total + DISTRICTS.reduce((sum, d) => {
    const maximum = Math.max(...players.map(x => districtCount(x, d.id)));
    return sum + (districtCount(p, d.id) < maximum ? p.assets.filter(a => a.district === d.id && !a.blocked).length : 0);
  }, 0), 0);

  const assetValue = (a: OwnedAsset) => Math.floor(a.cost / 2) + (a.automated ? 2 : 0) + (a.scaled ? 2 : 0);
  const isManaged = (_assets: OwnedAsset[], index: number) => index < me.capacity;
  const assetAbilities = (asset: OwnedAsset): { text: string; active: boolean }[] => {
    const effects = asset.effects; const multiplier = asset.automated ? 2 : 1;
    const automated = asset.automated ? " · автоматизация ×2" : "";
    const result: { text: string; active: boolean }[] = [];
    if (effects?.eventBonus) result.push({ text: `+${effects.eventBonus.value * multiplier}$ во время подходящего события${automated}.`, active: event.id === effects.eventBonus.eventId });
    if (effects?.districtBonus) {
      const link = effects.districtBonus; const title = DISTRICTS.find(d => d.id === link.district)?.title;
      const linkedCount = districtCount(me, link.district) - (link.excludeSelf && asset.district === link.district ? 1 : 0) + (link.virtualRole && hasRole(me, link.virtualRole) ? 1 : 0);
      const active = link.perObject ? linkedCount > 0 : hasDistrictLink(me, link.district);
      result.push({ text: link.perObject ? `+${link.value * multiplier}$ за каждый связанный объект района «${title}»${automated}.` : `+${link.value * multiplier}$ при наличии объекта района «${title}»${automated}.`, active });
    }
    if (effects?.roleBonus) result.push({ text: `+${effects.roleBonus.value * multiplier}$ с ролью «${ROLES.find(r => r.id === effects.roleBonus?.role)?.title}»${automated}.`, active: hasRole(me, effects.roleBonus.role) });
    if (effects?.influenceBonus) {
      const activeRole = !effects.influenceBonus.role || hasRole(me, effects.influenceBonus.role);
      const activeDistrict = !effects.influenceBonus.district || hasDistrictLink(me, effects.influenceBonus.district);
      result.push({ text: `+${effects.influenceBonus.value * multiplier}◆ за раунд при выполнении условия${automated}.`, active: activeRole && activeDistrict });
    }
    if (effects?.purchase) result.push({ text: `Эффект покупки выполнен: ${asset.text}`, active: true });
    if (effects?.extraActions) result.push({ text: `+${effects.extraActions} обычное действие в начале каждого хода.`, active: !asset.blocked });
    if (effects?.extraInvestmentActions) result.push({ text: `+${effects.extraInvestmentActions} инвестиционное действие в начале каждого хода.`, active: !asset.blocked });
    if (effects?.scandalReduction) result.push({ text: `−${effects.scandalReduction} скандал в начале каждого хода.`, active: !asset.blocked });
    if (effects?.roofCapacity) result.push({ text: `Лимит Крыш увеличен на ${effects.roofCapacity}.`, active: !asset.blocked });
    if (effects?.turnRoof) result.push({ text: `В начале хода восстанавливает ${effects.turnRoof} Крышу до лимита.`, active: !asset.blocked });
    if (effects?.maintenanceReduction) result.push({ text: `Не платите содержание за ${effects.maintenanceReduction} объекта каждый раунд.`, active: !asset.blocked });
    if (effects?.greyScandalReduction) result.push({ text: `Серые покупки и операции дают на ${effects.greyScandalReduction} скандал меньше.`, active: !asset.blocked });
    if (effects?.takeoverCompensation) result.push({ text: `При потере роли получите ${effects.takeoverCompensation}◆.`, active: me.role !== null });
    if (asset.id === "logistics") result.push({ text: "Покупки объектов Промзоны дешевле на 1$.", active: !asset.blocked });
    if (["cash","market","crypto","datacenter"].includes(asset.id)) result.push({ text: "Открывает уникальную серую операцию.", active: !asset.blocked });
    if (!result.length) result.push({ text: asset.text, active: true });
    if (asset.district === "government") result.push({ text: `Политик: +${multiplier}◆ за раунд${automated}.`, active: hasRole(me, "politician") });
    if (asset.district === "residential") result.push({ text: `Политик: +${multiplier}$ дохода${automated}.`, active: hasRole(me, "politician") });
    if (asset.district === "business") result.push({ text: `Капиталист: +${multiplier}$ дохода${automated}.`, active: hasRole(me, "capitalist") });
    if (asset.district === "shadows") result.push({ text: `Мафиози: +${multiplier}$ дохода${automated}.`, active: hasRole(me, "mafia") });
    if (asset.district === "tech") result.push({ text: `Аферист: +${multiplier}$ дохода${automated}.`, active: hasRole(me, "fraudster") });
    if (asset.district === "industrial") result.push({ text: `Силовик: +${multiplier}$ дохода${automated}.`, active: hasRole(me, "military") });
    return result;
  };
  const assetIncome = (asset: OwnedAsset, index: number) => {
    if (!isManaged(me.assets, index) || asset.blocked) return 0;
    const base = asset.income + (asset.scaled ? 2 : 0);
    const districtBonus = 1 + districtLevels[asset.district] * .25;
    const eventBonus = event.district === asset.district ? event.incomeMultiplier ?? 1 : 1;
    return Math.floor(base * districtBonus * eventBonus) + objectSynergyIncome(me, asset, event);
  };
  const roleBonuses: Record<RoleId, string> = {
    capitalist: "Первый объект нового района дешевле на 1$; Деловой центр получает +1$; деловые условия всегда активны; 3◆ дают инвестиционное действие.",
    politician: "Жильё получает +1$; административные объекты дают влияние; 5◆ собирают налог района, 2◆ снимают скандал.",
    journalist: "Собственные скандалы дают влияние; может создать скандал себе и цели либо опубликовать скандал за 3◆.",
    fraudster: "4 действия; Технокластер +1$; криптоскам, очистка действием и подделка роли.",
    mafia: "Серый сектор +1$; дешёвая Крыша, рэкет, дань с меньшинства и управление скандалами.",
    military: "Промзона +1$; санкции конвертируют чужие скандалы в ресурсы и объекты.",
  };
  const activeBonuses = [
    role ? `Роль «${role.title}»: ${roleBonuses[role.id]}` : "Роль: отсутствует.",
    `Событие «${event.title}»: ${event.text}`,
    ...DISTRICTS.filter(d => districtLevels[d.id] > 0)
      .map(d => `${d.title}: +${districtLevels[d.id] * 25}% к доходу объектов.`),
    ...DISTRICTS.filter(d => districtCount(me, d.id) >= 2)
      .map(d => `${d.title} ${districtCount(me, d.id)}/4: синергия +${districtSynergy(me, d.id)}$ каждому объекту района; автоматизированному — вдвое больше.`),
    ...(me.assets.some(a => a.tags.includes("grey") && !a.blocked) ? ["Серые объекты: доступны уникальные операции с риском скандалов."] : []),
    ...(me.assets.some(a => a.tags.includes("ai")) ? ["ИИ: «Инновационный грант» даёт дополнительно +1 влияние."] : []),
    ...me.assets.filter(a => a.rarity === "legendary" && !a.blocked).map(a => `Легендарный объект «${a.title}»: ${a.text}`),
    ...(me.roofs > 0 ? [`Крыша: ${me.roofs} заряд(а) защиты от направленных эффектов.`] : []),
    ...(investmentActions > 0 ? [`Инвестиционных действий: ${investmentActions}. Можно купить объект, слот или улучшение.`] : []),
    ...(me.debt > 0 ? [`Мостовой кредит: −${me.debt}$ при ближайшей выплате.`] : []),
    ...(me.roleShields > 0 ? [`Судебный запрет: отменит ${me.roleShields} попытку отобрать роль.`] : []),
    ...(me.scandalShields > 0 ? [`Репутационный резерв: отменит следующее получение скандалов.`] : []),
    ...(me.zoningDistrict ? [`Изменение зонирования: район «${DISTRICTS.find(d=>d.id===me.zoningDistrict)?.title}» считается на 1 объект больше до выплаты.`] : []),
    ...(cardMarketDiscount > 0 ? [`Инвестиционная субсидия: следующая покупка объекта дешевле на ${cardMarketDiscount}$.`] : []),
    ...(cardUpgradeDiscount > 0 ? [`Срочная модернизация: следующее улучшение дешевле на ${cardUpgradeDiscount}$.`] : []),
    ...(hasRole(me, "politician") ? [`Прогноз влияния за раунд: +${passiveInfluenceFor(me)}◆.`] : []),
    ...(hasRole(me, "journalist") ? [`Рейтинг: ${Math.min(4, me.scandals)} скандала → +${Math.min(4, me.scandals)}◆ за раунд.`] : []),
    `Содержание бизнеса: −${Math.max(0, me.assets.length - effectTotal(me, "maintenanceReduction"))}$ в конце раунда.`,
  ];
  const scoreOf = (p: Player) => p.money + p.influence + p.assets.reduce((s, a) => s + assetValue(a), 0)
    + p.projects * 6 + (p.role ? 3 : 0) - p.scandals;
  const scores = useMemo(() => players.map(p => ({ ...p, score: scoreOf(p) })).sort((a, b) => b.score - a.score), [players]);

  const gameLogText = () => [
    "Город влияния — полный журнал игры",
    `Версия: v${__GAME_VERSION__}`,
    `Дата экспорта: ${new Date().toLocaleString("ru-RU")}`,
    `Настройки: игроков ${settings.humanPlayers}; ботов ${settings.botPlayers}; раундов ${settings.maxRounds}; роль ${settings.rolePrice} влияния; переворот ${settings.rolePrice * 2} влияния.`,
    `Раунд: ${round}/${settings.maxRounds}`,
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
  const canInvest = actionsLeft > 0 || investmentActions > 0;
  const spendInvestmentAction = () => {
    if (investmentActions > 0) setInvestmentActions(x => Math.max(0, x - 1));
    else spendAction();
  };
  const newDistrictDiscount = (asset: AssetCard) => hasRole(me, "capitalist")
    && !me.assets.some(a => a.district === asset.district) ? 1 : 0;
  const priceOf = (asset: AssetCard) => {
    const eventDiscount = event.district === asset.district ? (event.marketDiscount ?? 0) : 0;
    const roleDiscount = newDistrictDiscount(asset);
    const logisticsDiscount = asset.district === "industrial" && me.assets.some(a => a.id === "logistics") ? 1 : 0;
    return Math.max(1, asset.cost - eventDiscount - roleDiscount - logisticsDiscount - cardMarketDiscount);
  };
  const improvementCost = (kind: "automate" | "scale") => Math.max(1, (kind === "automate" ? 5 : 4) - cardUpgradeDiscount);

  const buy = (asset: MarketAsset) => {
    const cost = priceOf(asset);
    if (!canInvest || me.money < cost || me.assets.length >= me.capacity) return;
    const owned: OwnedAsset = { ...asset, automated: false, scaled: false, blocked: false };
    const purchase = asset.effects?.purchase;
    const marketCard = purchase?.card && me.hand.length < 3 ? (actionDeck[0] ?? actionMarket[0]) : null;
    update(me.id, p => {
      let next: Player = {
        ...p, money: p.money - cost + (purchase?.money ?? 0),
        influence: p.influence + asset.influence + (purchase?.influence ?? 0) + (event.id === "election" && asset.district === "government" ? asset.influence : 0),
        assets: [...p.assets, owned],
      };
      if (purchase?.roofs) next = { ...next, roofs: Math.min(roofLimitFor(next), next.roofs + purchase.roofs) };
      if (marketCard && next.hand.length < 3) next = { ...next, hand: [...next.hand, actionCard(marketCard)] };
      const rawScandals = purchase?.scandals ?? (asset.tags.includes("grey") ? 1 : 0);
      const greyScandals = Math.max(0, rawScandals - (asset.tags.includes("grey") ? greyScandalReductionFor(next) : 0));
      return greyScandals ? withScandals(next, greyScandals) : next;
    });
    if (marketCard) {
      if (actionDeck.some(c => c.id === marketCard.id)) setActionDeck(deck => deck.slice(1));
      else setActionMarket(cards => cards.filter(c => c.id !== marketCard.id));
    }
    setMarket(xs => xs.filter(a => a.uid !== asset.uid));
    setCardMarketDiscount(0);
    say(`${me.name} инвестирует ${cost}$ в «${asset.title}»${newDistrictDiscount(asset) ? " со скидкой Капиталиста" : ""}.`); spendInvestmentAction();
  };

  const improve = (uid: string, kind: "automate" | "scale") => {
    const asset = me.assets.find(a => a.uid === uid);
    const cost = improvementCost(kind);
    if (!asset || !canInvest || me.money < cost || asset.automated || asset.scaled) return;
    update(me.id, p => ({ ...p, money: p.money - cost, assets: p.assets.map(a => a.uid === uid ? { ...a, automated: kind === "automate" || a.automated, scaled: kind === "scale" || a.scaled } : a) }));
    setCardUpgradeDiscount(0);
    say(`${me.name} ${kind === "automate" ? "автоматизирует" : "модернизирует"} «${asset.title}».`); spendInvestmentAction();
  };

  const buyCapacity = () => {
    const cost = CAPACITY_COST[me.capacity];
    if (!cost || !canInvest || me.money < cost || me.capacity >= MAX_CAPACITY) return;
    update(me.id, p => ({ ...p, money: p.money - cost, capacity: p.capacity + 1 }));
    say(`${me.name} расширяет бизнес до ${me.capacity + 1} активных слотов за ${cost}$.`); spendInvestmentAction();
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
    if (actionsLeft < 1 || me.influence < cost || me.scandals >= 5 || holder?.id === me.id) return;
    if (holder && holder.roleShields > 0) {
      setPlayers(ps => ps.map(p => p.id === me.id ? { ...p, influence: p.influence - cost }
        : p.id === holder.id ? { ...p, roleShields: p.roleShields - 1 } : p));
      say(`${me.name} пытается отобрать роль «${ROLES.find(r => r.id === roleId)?.title}», но судебный запрет ${holder.name} отменяет переворот.`);
      spendAction(); return;
    }
    if (holder && holder.roofs > 0) {
      setPlayers(ps => ps.map(p => p.id === me.id ? { ...p, influence: p.influence - cost }
        : p.id === holder.id ? { ...p, roofs: p.roofs - 1 } : p));
      say(`${me.name} пытается отобрать роль «${ROLES.find(r => r.id === roleId)?.title}», но ${holder.name} тратит Крышу.`);
      spendAction(); return;
    }
    const lobbyCompensation = holder?.assets.reduce((sum, a) => sum + (a.effects?.takeoverCompensation ?? 0), 0) ?? 0;
    setPlayers(ps => ps.map(p => p.id === me.id ? { ...p, influence: p.influence - cost, role: roleId }
      : p.id === holder?.id ? { ...p, role: null, influence: p.influence + lobbyCompensation } : p));
    say(holder ? `${me.name} проводит переворот и отбирает роль «${ROLES.find(r => r.id === roleId)?.title}» у ${holder.name} за ${cost} влияния${lobbyCompensation ? `; Лоббистское бюро возвращает ${holder.name} 2 влияния` : ""}.`
      : `${me.name} получает роль «${ROLES.find(r => r.id === roleId)?.title}» за ${cost} влияния.`);
    if (roleId === "fraudster") setFraudTurnPlace(Math.max(1, scores.findIndex(p => p.id === me.id) + 1));
    spendAction();
  };

  const protectOr = (p: Player, effect: (p: Player) => Player) => {
    if (p.roofs > 0 && (p.isBot || window.confirm(`${p.name}: потратить Крышу и отменить направленный эффект?`))) return { ...p, roofs: p.roofs - 1 };
    return effect(p);
  };

  const collectDistrictTax = (districtId: DistrictId) => {
    const revenue = objectsInDistrict(districtId);
    if (!hasRole(me, "politician") || politicianTaxUsed || me.influence < 5 || revenue < 1) return;
    update(me.id, p => ({ ...p, influence: p.influence - 5, money: p.money + revenue }));
    setPoliticianTaxUsed(true);
    say(`${me.name} собирает налог с района «${DISTRICTS.find(d => d.id === districtId)?.title}»: −5 влияния, +${revenue}$.`);
  };

  const cleanPoliticianScandal = () => {
    if (!hasRole(me, "politician") || politicianCleanupUsed || me.influence < 2 || me.scandals < 1) return;
    update(me.id, p => ({ ...p, influence: p.influence - 2, scandals: p.scandals - 1 }));
    setPoliticianCleanupUsed(true);
    say(`${me.name} урегулирует политический скандал за 2 влияния.`);
  };

  const journalistInflate = () => {
    if (!hasRole(me, "journalist") || journalistInflateUsed || target === null) return;
    setPlayers(ps => ps.map(p => p.id === me.id || p.id === target ? withScandals(p, 1) : p));
    setJournalistInflateUsed(true);
    say(`${me.name} раздувает историю: получает скандал и даёт скандал игроку ${targetPlayer?.name}.`);
  };

  const journalistPublish = () => {
    if (!hasRole(me, "journalist") || journalistPublishUsed || target === null || me.influence < 3) return;
    setPlayers(ps => ps.map(p => p.id === me.id ? { ...p, influence: p.influence - 3 }
      : p.id === target ? withScandals(p, 1) : p));
    setJournalistPublishUsed(true);
    say(`${me.name} публикует расследование против ${targetPlayer?.name}: −3 влияния, цели +1 скандал.`);
  };

  const mafiaRacket = () => {
    if (!hasRole(me, "mafia") || mafiaRacketUsed || actionsLeft < 1 || target === null || !me.assets.some(a => a.district === "shadows" && !a.blocked)) return;
    const victim = targetPlayer!;
    const leaderId = scores[0]?.id;
    const demand = Math.min(5, 2 + (victim.id === leaderId ? 1 : 0) + Math.min(2, districtCount(me, "government")) + mafiaOperationBonus);
    const protectedByRoof = victim.roofs > 0;
    const stolen = protectedByRoof ? 0 : Math.min(demand, victim.money);
    const blocked = !protectedByRoof && stolen < demand;
    setPlayers(ps => ps.map(p => {
      if (p.id === victim.id) {
        if (protectedByRoof) return { ...p, roofs: p.roofs - 1 };
        const blockUid = blocked ? [...p.assets].sort((a, b) => b.income - a.income)[0]?.uid : undefined;
        return { ...p, money: p.money - stolen, assets: p.assets.map(a => a.uid === blockUid ? { ...a, blocked: true } : a) };
      }
      if (p.id === me.id) {
        const paid = { ...p, money: p.money + stolen };
        return districtCount(p, "government") > 0 ? paid : withScandals(paid, 1);
      }
      return p;
    }));
    setMafiaRacketUsed(true); spendAction();
    say(protectedByRoof ? `${victim.name} тратит Крышу и отменяет рэкет ${me.name}.` : `${me.name} получает с ${victim.name} ${stolen}$ рэкета${blocked ? " и блокирует объект" : ""}.`);
  };

  const mafiaSweepRoofs = () => {
    if (!hasRole(me, "mafia") || mafiaRoofSweepUsed || actionsLeft < 1 || me.roofs < 1) return;
    setPlayers(ps => ps.map(p => ({ ...p, roofs: Math.max(0, p.roofs - 1) })));
    setMafiaRoofSweepUsed(true); spendAction(); say(`${me.name} сжигает связи: все игроки теряют по одной Крыше.`);
  };

  const mafiaCleanup = (method: "roof" | "money") => {
    if (!hasRole(me, "mafia") || mafiaCleanupUsed || me.scandals < 1) return;
    if (method === "roof" && me.roofs < 1) return;
    if (method === "money" && (me.money < 3 || districtCount(me, "government") < 1)) return;
    update(me.id, p => ({ ...p, roofs: method === "roof" ? p.roofs - 1 : p.roofs, money: method === "money" ? p.money - 3 : p.money, scandals: Math.max(0, p.scandals - 2) }));
    setMafiaCleanupUsed(true); say(`${me.name} заминает дело и снимает до двух скандалов.`);
  };

  const enforcerSanction = () => {
    if (!hasRole(me, "military") || actionsLeft < 1 || target === null || sanctionedPlayers.includes(target)) return;
    const victim = targetPlayer!; if (victim.scandals < 1) return;
    setPlayers(ps => {
      let gainMoney = 0; let gainInfluence = 0; let confiscated: OwnedAsset | null = null;
      const targetState = ps.find(p => p.id === victim.id)!;
      let changedTarget = targetState;
      if (targetState.scandals === 1) { gainInfluence = Math.min(1, targetState.influence); changedTarget = { ...targetState, influence: targetState.influence - gainInfluence }; }
      else if (targetState.scandals === 2) { gainMoney = Math.min(3, targetState.money); changedTarget = { ...targetState, money: targetState.money - gainMoney }; }
      else if (targetState.scandals === 3) {
        if (targetState.roofs > 0) changedTarget = { ...targetState, roofs: targetState.roofs - 1 };
        else { const uid = [...targetState.assets].sort((a,b) => b.income-a.income)[0]?.uid; changedTarget = { ...targetState, assets: targetState.assets.map(a => a.uid === uid ? { ...a, blocked: true } : a) }; }
      } else {
        if (targetState.roofs > 0) changedTarget = { ...targetState, roofs: targetState.roofs - 1 };
        else {
          const chosen = [...targetState.assets].sort((a,b) => assetValue(b)-assetValue(a))[0];
          if (chosen?.automated || chosen?.scaled) changedTarget = { ...targetState, assets: targetState.assets.map(a => a.uid === chosen.uid ? { ...a, automated: false, scaled: false } : a) };
          else if (chosen && targetState.assets.length > 1) { confiscated = { ...chosen, automated: false, scaled: false }; changedTarget = { ...targetState, assets: targetState.assets.filter(a => a.uid !== chosen.uid) }; }
        }
      }
      changedTarget = { ...changedTarget, scandals: Math.max(0, changedTarget.scandals - 1) };
      return ps.map(p => {
        if (p.id === victim.id) return changedTarget;
        if (p.id === me.id) {
          if (!confiscated) return { ...p, money: p.money + gainMoney, influence: p.influence + gainInfluence };
          if (p.assets.length < p.capacity) return { ...p, assets: [...p.assets, confiscated] };
          const weakest = [...p.assets].sort((a,b) => assetValue(a)-assetValue(b))[0];
          return assetValue(confiscated) > assetValue(weakest)
            ? { ...p, money: p.money + assetValue(weakest), assets: [...p.assets.filter(a => a.uid !== weakest.uid), confiscated] }
            : { ...p, money: p.money + assetValue(confiscated) };
        }
        return p;
      });
    });
    setSanctionedPlayers(xs => [...xs, target]); spendAction(); say(`${me.name} применяет санкцию к ${victim.name} при ${victim.scandals} скандалах; после взыскания у цели −1 скандал.`);
  };

  const fraudCleanScandal = () => {
    if (!hasRole(me, "fraudster") || actionsLeft < 1 || me.scandals < 1) return;
    update(me.id, p => ({ ...p, scandals: p.scandals - 1 })); spendAction(); say(`${me.name} тратит действие и снимает один скандал.`);
  };
  const crisisPR = () => {
    if (actionsLeft < 1 || me.money < 4 || me.scandals < 1) return;
    update(me.id, p => ({ ...p, money: p.money - 4, scandals: p.scandals - 1 })); spendAction(); say(`${me.name} проводит антикризисный PR: −4$, −1 скандал.`);
  };

  const fraudCryptoScam = () => {
    if (!hasRole(me, "fraudster") || fraudCryptoUsed || actionsLeft < 1 || !me.assets.some(a => a.id === "crypto" && !a.blocked)) return;
    const amount = Math.max(1, Math.min(6, fraudScamAmount));
    const gainedScandals = Math.max(0, amount - greyScandalReductionFor(me));
    const expectedGained = players.filter(p => p.id !== me.id).reduce((sum, p) => sum + Math.min(amount, p.money), 0);
    setPlayers(ps => {
      const gained = ps.filter(p => p.id !== me.id).reduce((sum, p) => sum + Math.min(amount, p.money), 0);
      return ps.map(p => p.id === me.id ? withScandals({ ...p, money: p.money + gained }, Math.max(0, amount - greyScandalReductionFor(p)))
        : { ...p, money: p.money - Math.min(amount, p.money) });
    });
    setFraudCryptoUsed(true); spendAction(); say(`${me.name} скамит на крипте: получает ${expectedGained}$ и ${gainedScandals} скандал(а).`);
  };

  const fraudForgeDocuments = () => {
    if (!hasRole(me, "fraudster") || fraudDocsUsed || actionsLeft < 4 || me.influence < 5) return;
    const chance = Math.min(.9, .5 + districtCount(me, "tech") * .1); const success = Math.random() < chance;
    update(me.id, p => success ? { ...p, influence: p.influence - 5, pendingRole: forgedRoleChoice }
      : { ...p, influence: p.influence - 5, role: null, copiedRole: null, pendingRole: null, roofs: Math.max(0, p.roofs - 1), scandals: 3, jailTurns: 1 });
    setActionsLeft(x => Math.max(0, x - 4)); setFraudDocsUsed(true);
    say(success ? `${me.name} подделывает документы: роль «${ROLES.find(r => r.id === forgedRoleChoice)?.title}» активируется в следующий ход.` : `${me.name} проваливает подделку документов и попадает в тюрьму.`);
  };

  const rolePower = () => {
    if (!hasRole(me, "capitalist") || rolePowerUsed) return;
    if (hasRole(me, "capitalist")) {
      if (me.influence < 3) return;
      update(me.id, p => ({ ...p, influence: p.influence - 3 }));
      setInvestmentActions(x => x + 1); setRolePowerUsed(true);
      say(`${me.name} применяет «Ускоренное финансирование»: −3 влияния, +1 инвестиционное действие.`);
      return;
    }
  };

  const canPlayCard = (card: HeldActionCard) => {
    if (processingCards.current.has(card.uid) || cardPlayedThisTurn || !me.hand.some(c => c.uid === card.uid) || (card.targeted && target === null)) return false;
    if (card.kind === "clean" || card.kind === "deep_clean" || card.kind === "transfer_scandal") return me.scandals > 0 && (card.kind !== "deep_clean" || me.influence >= 2);
    if (card.kind === "roof") return me.roofs < roofLimitFor(me);
    if (card.kind === "influence") return me.money >= 2;
    if (card.kind === "influence_to_cash") return me.influence >= 2;
    if (card.kind === "role_pressure") return targetPlayer?.role !== null;
    if (card.kind === "freeze") return (targetPlayer?.assets.length ?? 0) > 0;
    if (card.kind === "remove_upgrade") return targetPlayer?.assets.some(a => a.automated || a.scaled) ?? false;
    if (card.kind === "district_cash" || card.kind === "zoning") return districtCount(me, district) > 0;
    if (card.kind === "develop") return districtCount(me, district) >= 2 && districtLevels[district] < 2;
    if (card.kind === "copy_role") return forgedRoleChoice !== me.role;
    if (card.kind === "market_discount") return me.assets.length < me.capacity && market.length > 0;
    if (card.kind === "upgrade_discount") return me.assets.some(a => !a.automated && !a.scaled);
    if (card.kind === "unblock") return me.assets.some(a => a.blocked);
    return true;
  };

  const playCard = (card: HeldActionCard) => {
    const targeted = card.targeted === true;
    if (!canPlayCard(card)) return;
    processingCards.current.add(card.uid);
    if (card.kind === "clean") update(me.id, p => ({ ...p, scandals: Math.max(0, p.scandals - card.value) }));
    if (card.kind === "deep_clean") update(me.id, p => ({ ...p, scandals: Math.max(0, p.scandals - card.value), influence: p.influence - 2 }));
    if (card.kind === "roof") update(me.id, p => ({ ...p, roofs: Math.min(roofLimitFor(p), p.roofs + 1) }));
    if (card.kind === "grant") update(me.id, p => ({ ...p, money: p.money + card.value, influence: p.influence + (p.assets.some(a => a.tags.includes("ai")) ? 1 : 0) }));
    if (card.kind === "bridge_loan") update(me.id, p => ({ ...p, money: p.money + card.value, debt: p.debt + 4 }));
    if (card.kind === "district_cash") update(me.id, p => ({ ...p, money: p.money + Math.min(10, districtCount(p, district) * card.value) }));
    if (card.kind === "influence") update(me.id, p => ({ ...p, money: p.money - 2, influence: p.influence + card.value }));
    if (card.kind === "market_discount") setCardMarketDiscount(card.value);
    if (card.kind === "upgrade_discount") setCardUpgradeDiscount(card.value);
    if (card.kind === "zoning") update(me.id, p => ({ ...p, zoningDistrict: district }));
    if (card.kind === "develop") { setDistrictLevels(ds => ({ ...ds, [district]: Math.min(2, ds[district] + 1) })); update(me.id, p => ({ ...p, influence: p.influence + card.value })); }
    if (card.kind === "copy_role") update(me.id, p => ({ ...p, copiedRole: forgedRoleChoice }));
    if (card.kind === "extra_action") { setActionsLeft(x => x + card.value); setTurnActionLimit(x => x + card.value); }
    if (card.kind === "investment_action") setInvestmentActions(x => x + card.value);
    if (card.kind === "comeback") update(me.id, p => ({ ...p, money: p.money + (scores.findIndex(x => x.id === p.id) === players.length - 1 ? card.value : 3) }));
    if (card.kind === "influence_to_cash") update(me.id, p => ({ ...p, influence: p.influence - 2, money: p.money + card.value }));
    if (card.kind === "project") update(me.id, p => ({ ...p, projects: p.projects + 1 }));
    if (card.kind === "role_shield") update(me.id, p => ({ ...p, roleShields: p.roleShields + 1 }));
    if (card.kind === "scandal_shield") update(me.id, p => ({ ...p, scandalShields: p.scandalShields + 1 }));
    if (card.kind === "unblock") update(me.id, p => { const uid = [...p.assets].filter(a => a.blocked).sort((a,b) => b.income-a.income)[0]?.uid; return { ...p, assets: p.assets.map(a => a.uid === uid ? { ...a, blocked: false } : a) }; });
    if (card.kind === "scandal" && target !== null) update(target, p => protectOr(p, q => withScandals(q, 1)));
    if (card.kind === "fine" && target !== null) update(target, p => protectOr(p, q => q.money >= card.value ? { ...q, money: q.money - card.value } : withScandals({ ...q, money: 0 }, 1)));
    if (card.kind === "steal" && target !== null) { update(me.id, p => ({ ...p, money: p.money + 2 })); update(target, p => protectOr(p, q => ({ ...q, money: Math.max(0, q.money - card.value) }))); }
    if (card.kind === "role_pressure" && target !== null) update(target, p => protectOr(p, q => q.influence >= card.value ? { ...q, influence: q.influence - card.value } : { ...q, influence: 0, role: null }));
    if (card.kind === "double_scandal" && target !== null) { update(me.id, p => withScandals(p, 1)); update(target, p => protectOr(p, q => withScandals(q, card.value))); }
    if (card.kind === "blackmail" && target !== null) { update(me.id, p => ({ ...p, influence: p.influence + 1 })); update(target, p => protectOr(p, q => ({ ...q, influence: Math.max(0, q.influence - card.value) }))); }
    if (card.kind === "freeze" && target !== null) update(target, p => protectOr(p, q => { const uid=[...q.assets].sort((a,b)=>b.income-a.income)[0]?.uid;return {...q,assets:q.assets.map(a=>a.uid===uid?{...a,blocked:true}:a)}; }));
    if (card.kind === "expose" && target !== null) { update(target, p => protectOr(p, q => withScandals(q, 1))); if (target === scores[0]?.id) update(me.id, p => ({ ...p, influence: p.influence + card.value })); }
    if (card.kind === "remove_upgrade" && target !== null) update(target, p => protectOr(p, q => { const uid=[...q.assets].filter(a=>a.automated||a.scaled).sort((a,b)=>assetValue(b)-assetValue(a))[0]?.uid;return {...q,assets:q.assets.map(a=>a.uid===uid?{...a,automated:false,scaled:false}:a)}; }));
    if (card.kind === "mixed_fine" && target !== null) update(target, p => protectOr(p, q => ({ ...q, money: Math.max(0, q.money - 2), influence: Math.max(0, q.influence - 1) })));
    update(me.id, p => ({ ...p, hand: p.hand.filter(c => c.uid !== card.uid) }));
    setCardPlayedThisTurn(true); say(`${me.name} бесплатно разыгрывает «${card.title}»${targeted ? ` против ${targetPlayer?.name}` : ""}.`);
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

  const buyCard = (selected: ActionCard) => {
    if (actionsLeft < 1 || me.money < 3 || me.influence < 1 || me.hand.length >= 3 || !actionMarket.some(c => c.id === selected.id)) return;
    const card = actionCard(selected); const replacement = actionDeck[0];
    update(me.id, p => ({ ...p, money: p.money - 3, influence: p.influence - 1, hand: [...p.hand, card] }));
    setActionMarket(cards => [...cards.filter(c => c.id !== selected.id), ...(replacement ? [replacement] : [])]);
    if (replacement) setActionDeck(deck => deck.slice(1));
    spendAction(); say(`${me.name} покупает карту «${card.title}» за 3$ и 1 влияние.`);
  };

  const runGreyOperation = (assetId: "cash" | "market" | "crypto" | "datacenter") => {
    if (actionsLeft < 1 || !me.assets.some(a => a.id === assetId && !a.blocked)) return;
    if ((assetId === "market" || assetId === "datacenter") && target === null) return;
    if (assetId === "cash" && me.influence < 2) return;
    const place = hasRole(me,"fraudster") ? fraudTurnPlace : scores.findIndex(p => p.id === me.id) + 1;
    const fraudChance = hasRole(me, "fraudster") ? [0, .05, .1, .2][Math.max(0, place - 1)] : 0;
    const techChance = hasRole(me, "fraudster") ? Math.min(.1, districtCount(me, "tech") * .05) : 0;
    const base = { cash: .85, market: .75, crypto: .60, datacenter: .55 }[assetId];
    const chance = Math.min(.9, base + fraudChance + techChance); const success = Math.random() < chance;
    const protectFailure = !success && me.roofs > 0 && (me.isBot ? (assetId === "crypto" || assetId === "datacenter") : window.confirm("Потратить Крышу и отменить материальное последствие провала? Скандалы останутся."));
    const comeback = hasRole(me, "fraudster") ? [0, 1, 2, 3][Math.max(0, place - 1)] : 0;
    const failureScandals = hasRole(me, "fraudster") ? 1 : assetId === "crypto" || assetId === "datacenter" ? 3 : 2;
    const operationTarget = target === null ? null : players.find(p => p.id === target) ?? null;
    const marketStolen = success && assetId === "market" && operationTarget && operationTarget.roofs < 1 ? Math.min(3, operationTarget.money) : 0;
    setPlayers(ps => ps.map(p => {
      if (p.id === me.id) {
        if (success) {
          let next = { ...p };
          if (assetId === "cash") next = { ...next, influence: next.influence - 2, money: next.money + 5 + comeback };
          if (assetId === "crypto") next = { ...next, money: next.money + 6 + comeback };
          if (assetId === "market") next = { ...next, money: next.money + marketStolen + comeback };
          if (assetId === "datacenter") next = { ...next, money: next.money + comeback };
          const operationScandals = Math.max(0, (assetId === "datacenter" ? 2 : 1) - greyScandalReductionFor(next));
          return withScandals(next, operationScandals);
        }
        let next = { ...p };
        if (protectFailure) next = { ...next, roofs: next.roofs - 1 };
        else {
          if (assetId === "cash") next = { ...next, influence: Math.max(0, next.influence - 3), money: Math.max(0, next.money - 3) };
          if (assetId === "market") next = next.roofs > 0 ? { ...next, roofs: next.roofs - 1 } : next;
          if (assetId === "crypto") next = { ...next, money: Math.max(0, next.money - 5), assets: next.assets.map(a => a.id === "crypto" ? { ...a, automated: false, scaled: false } : a) };
          if (assetId === "datacenter") next = { ...next, assets: next.assets.map(a => a.id === "datacenter" ? { ...a, blocked: true, automated: false, scaled: false } : a) };
        }
        return withScandals(next, Math.max(0, failureScandals - greyScandalReductionFor(next)));
      }
      if (!success) return p;
      if (assetId === "market" && p.id === target) {
        if (p.roofs > 0) return { ...p, roofs: p.roofs - 1 };
        const paid = Math.min(3, p.money); return { ...p, money: p.money - paid };
      }
      if (assetId === "crypto" && p.id === scores[0]?.id && p.id !== me.id) {
        if (p.roofs > 0) return { ...p, roofs: p.roofs - 1 };
        return { ...p, money: Math.max(0, p.money - 2) };
      }
      if (assetId === "datacenter" && p.id === target) {
        const uid = [...p.assets].sort((a,b) => b.income-a.income)[0]?.uid;
        return { ...p, assets: p.assets.map(a => a.uid === uid ? { ...a, blocked: true } : a) };
      }
      return p;
    }));
    if (success && hasRole(me,"mafia")) setMafiaOperationBonus(1);
    spendAction(); say(`${me.name}: операция «${{cash:"Отмывание",market:"Контрабанда",crypto:"Памп и дамп",datacenter:"Взлом"}[assetId]}» — ${success ? "успех" : "провал"} (${Math.round(chance*100)}%).`);
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
    const cost = hasRole(me, "mafia") ? 2 : 3; const cap = roofLimitFor(me);
    if (actionsLeft < 1 || me.money < cost || me.roofs >= cap) return;
    update(me.id, p => ({ ...p, money: p.money - cost, roofs: p.roofs + 1 })); say(`${me.name} покупает Крышу.`); spendAction();
  };

  const refillMarket = () => {
    const needed = Math.max(0, 6 - market.length); const additions = marketDeck.slice(0, needed);
    setMarket(xs => [...xs, ...additions]); setMarketDeck(deck => deck.slice(additions.length));
  };
  const resetTurnFlags = (startingInvestmentActions = 0) => {
    setInvestmentActions(startingInvestmentActions); setRolePowerUsed(false); setPoliticianTaxUsed(false); setPoliticianCleanupUsed(false);
    setJournalistInflateUsed(false); setJournalistPublishUsed(false); setMafiaCleanupUsed(false); setMafiaRoofSweepUsed(false);
    setMafiaRacketUsed(false); setMafiaOperationBonus(0); setSanctionedPlayers([]); setFraudCryptoUsed(false); setFraudDocsUsed(false);
    setCardPlayedThisTurn(false); setCardMarketDiscount(0); setCardUpgradeDiscount(0);
  };
  const startGame = () => {
    const normalized: GameSettings = {
      humanPlayers: Math.max(1, Math.min(4, settings.humanPlayers)),
      botPlayers: Math.max(0, Math.min(5, settings.botPlayers)),
      maxRounds: Math.max(5, Math.min(30, settings.maxRounds)),
      rolePrice: Math.max(2, Math.min(10, settings.rolePrice)),
    };
    if (normalized.humanPlayers + normalized.botPlayers < 2 || normalized.humanPlayers + normalized.botPlayers > 6) return;
    const deck = freshMarket(); const events = shuffle(EVENTS); const cards = shuffle(ACTIONS); const startingTurn = Math.floor(Math.random() * (normalized.humanPlayers + normalized.botPlayers));
    cardSequence = 0; setSettings(normalized); setPlayers(initialPlayers(normalized)); setRound(1); setTurn(startingTurn); setGameStartingTurn(startingTurn); setTurnsTakenInRound(0); setActionsLeft(3); setTurnActionLimit(3);
    setMarket(deck.slice(0, 6)); setMarketDeck(deck.slice(6)); setEvent(events[0]); setEventDeck(events.slice(1));
    setActionMarket(cards.slice(0, 3)); setActionDeck(cards.slice(3)); processingCards.current.clear();
    setDistrictLevels(initialDistricts()); setDistrict("business"); setTarget(null); setFinished(false); setLogExportStatus("");
    setLog([`Раунд 1: «${events[0].title}». Первым ходит ${startingTurn < normalized.humanPlayers ? `Игрок ${startingTurn + 1}` : `Бот ${startingTurn - normalized.humanPlayers + 1}`}.`, `Игра началась: игроков ${normalized.humanPlayers}, ботов ${normalized.botPlayers}, раундов ${normalized.maxRounds}, роль ${normalized.rolePrice}◆, переворот ${normalized.rolePrice * 2}◆.`]);
    resetTurnFlags(); setGameStarted(true);
  };
  const preparePlayerTurn = (player: Player) => {
    let changed = { ...player, copiedRole: player.pendingRole, pendingRole: null, jailTurns: Math.max(0, player.jailTurns - 1) };
    if (!changed.role && changed.scandals > 0) changed.scandals -= 1;
    changed.scandals = Math.max(0, changed.scandals - effectTotal(changed, "scandalReduction"));
    changed.roofs = Math.min(roofLimitFor(changed), changed.roofs + effectTotal(changed, "turnRoof"));
    return changed;
  };
  const startPlayerTurn = (nextTurn: number) => {
    const next = players[nextTurn]; const prepared = preparePlayerTurn(next);
    setPlayers(ps => ps.map(p => p.id === next.id ? prepared : p));
    const actionLimit = next.jailTurns > 0 ? 1 : (prepared.role === "fraudster" ? 4 : 3) + actionBonusFor(prepared);
    setTurn(nextTurn); setTarget(null); setActionsLeft(actionLimit); setTurnActionLimit(actionLimit); setFraudTurnPlace(Math.max(1,scores.findIndex(p=>p.id===next.id)+1)); resetTurnFlags(investmentBonusFor(prepared));
  };
  const settleRound = (ps: Player[], nextStarterId: number | null) => {
    const incomes = new Map<number, number>();
    ps.forEach(p => {
      let income = -Math.max(0, p.assets.length - effectTotal(p, "maintenanceReduction"));
      p.assets.forEach(a => { if (!a.blocked) income += Math.floor((a.income + (a.scaled ? 2 : 0)) * (1 + districtLevels[a.district] * .25) * (event.district === a.district ? event.incomeMultiplier ?? 1 : 1)) + objectSynergyIncome(p, a, event); });
      incomes.set(p.id, income);
    });
    ps.filter(p => hasRole(p, "mafia")).forEach(mafia => {
      let tribute = 0;
      ps.forEach(p => {
        if (p.id === mafia.id) return;
        let levy = 0;
        DISTRICTS.forEach(d => {
          const maximum = Math.max(...ps.map(x => districtCount(x, d.id)));
          if (districtCount(p, d.id) < maximum) levy += p.assets.filter(a => a.district === d.id && !a.blocked).length;
        });
        const paid = Math.min(Math.max(0, incomes.get(p.id) ?? 0), levy); incomes.set(p.id, (incomes.get(p.id) ?? 0) - paid); tribute += paid;
      });
      incomes.set(mafia.id, (incomes.get(mafia.id) ?? 0) + tribute);
    });
    const settled = ps.map(p => {
      const newsLimit = p.assets.some(a => a.id === "data") ? 3 : 2;
      const news = hasRole(p, "journalist") ? Math.min(newsLimit, ps.filter(x => x.id !== p.id).reduce((s,x) => s + x.scandalGainedThisRound, 0)) : 0;
      const rating = hasRole(p, "journalist") ? Math.min(4, p.scandals) : 0;
      let next: Player = { ...p, copiedRole: null, assets: p.assets.map(a => ({ ...a, blocked: false })), money: Math.max(0, p.money + (incomes.get(p.id) ?? 0) - p.debt), influence: p.influence + passiveInfluenceFor(p) + news + rating, scandalGainedThisRound: 0, debt: 0, zoningDistrict: null };
      if (nextStarterId !== null && p.id === nextStarterId) {
        next = preparePlayerTurn(next);
      }
      return next;
    });
    const summaries = settled.map((p, index) => {
      const before = ps[index];
      return `${p.name} завершает раунд: ${p.money - before.money >= 0 ? "+" : ""}${p.money - before.money}$, ${p.influence - before.influence >= 0 ? "+" : ""}${p.influence - before.influence} влияния; теперь ${p.money}$ и ${p.influence}◆.`;
    });
    return { settled, summaries };
  };
  const endTurn = () => {
    if (turnsTakenInRound < players.length - 1) {
      update(me.id, p => ({ ...p, copiedRole: null })); setTurnsTakenInRound(x => x + 1); startPlayerTurn((turn + 1) % players.length); return;
    }
    if (round >= settings.maxRounds) {
      const { settled, summaries } = settleRound(players, null);
      const finalScores = settled.map(p => ({ ...p, score: scoreOf(p) })).sort((a, b) => b.score - a.score);
      const finishMessage = `Игра окончена после финальной выплаты. Побеждает ${finalScores[0].name}: ${finalScores[0].score} очков.`;
      setPlayers(settled); setFinished(true); setLog(xs => [finishMessage, ...[...summaries].reverse(), ...xs]); return;
    }
    const nextEventDeck = eventDeck.length > 1 ? eventDeck.slice(1) : shuffle(EVENTS); const nextEvent = nextEventDeck[0];
    const nextStart = (gameStartingTurn + round) % players.length; const { settled, summaries } = settleRound(players, players[nextStart].id); setPlayers(settled);
    const actionLimit = players[nextStart].jailTurns > 0 ? 1 : (settled[nextStart].role === "fraudster" ? 4 : 3) + actionBonusFor(settled[nextStart]);
    refillMarket(); setEventDeck(nextEventDeck); setEvent(nextEvent); setRound(round + 1); setTurn(nextStart); setTurnsTakenInRound(0); setTarget(null); setActionsLeft(actionLimit); setTurnActionLimit(actionLimit); setFraudTurnPlace(Math.max(1,scores.findIndex(p=>p.id===players[nextStart].id)+1)); resetTurnFlags(investmentBonusFor(settled[nextStart]));
    setLog(xs => [`Раунд ${round + 1}: «${nextEvent.title}».`, ...[...summaries].reverse(), ...xs]);
  };

  useEffect(() => {
    if (gameStarted && me.role === "fraudster") setFraudTurnPlace(Math.max(1, scores.findIndex(p => p.id === me.id) + 1));
  }, [turn, round, gameStarted]);

  useEffect(() => {
    if (!gameStarted || !me.isBot || finished) return;
    const timer = window.setTimeout(() => {
      const myPlace = scores.findIndex(p => p.id === me.id) + 1;
      const leader = scores.find(p => p.id !== me.id) ?? null;
      const gap = Math.max(0, (scores[0]?.score ?? 0) - scoreOf(me));
      const distinctDistricts = new Set(me.assets.map(a => a.district)).size;
      const maxEnemyScandals = Math.max(0, ...players.filter(p => p.id !== me.id).map(p => p.scandals));
      const isComebackPosition = myPlace === players.length || (myPlace >= 3 && gap >= 10);

      // The same evaluator is used by every bot. Buildings, position and opponents
      // determine the role; bot ids no longer encode an archetype.
      const roleUtility = (roleId: RoleId) => {
        const counts = (districtId: DistrictId) => districtCount(me, districtId);
        if (roleId === "capitalist") return counts("business") * 4 + distinctDistricts * 1.2 + Math.min(3, me.money / 6);
        if (roleId === "politician") return counts("residential") * 3 + counts("government") * 4 + passiveInfluenceFor(me) * 1.5;
        if (roleId === "fraudster") return counts("tech") * 4 + counts("shadows") * 1.5 + (isComebackPosition ? 7 : 0);
        if (roleId === "mafia") return counts("shadows") * 4 + counts("government") * 2 + (gap >= 8 ? 2 : 0);
        if (roleId === "military") return counts("industrial") * 4 + maxEnemyScandals * 2.5 + (isComebackPosition ? 4 : 0);
        return maxEnemyScandals * 2 + players.filter(p => p.id !== me.id && p.role).length;
      };
      const strategicRoles: RoleId[] = ["capitalist", "politician", "fraudster", "mafia", "military"];
      let strategicRole = [...strategicRoles].sort((a, b) => roleUtility(b) - roleUtility(a))[0];
      if (isComebackPosition) {
        strategicRole = maxEnemyScandals > 0 && roleUtility("military") >= roleUtility("fraudster")
          ? "military" : "fraudster";
      }
      const strategicHolder = roleHolder(strategicRole);
      const scandalTarget = players
        .filter(p => p.id !== me.id)
        .sort((a, b) => b.scandals - a.scandals || scoreOf(b) - scoreOf(a))[0] ?? null;
      const journalistTarget = strategicHolder && strategicHolder.id !== me.id ? strategicHolder : leader;
      const pendingTargetCard = me.hand.find(c => c.targeted && !processingCards.current.has(c.uid));
      const cardTarget = pendingTargetCard?.kind === "role_pressure" ? scores.find(p => p.id !== me.id && p.role)
        : pendingTargetCard?.kind === "remove_upgrade" ? scores.find(p => p.id !== me.id && p.assets.some(a => a.automated || a.scaled))
        : pendingTargetCard?.kind === "freeze" ? scores.find(p => p.id !== me.id && p.assets.length > 0)
        : leader;
      const desiredTarget = pendingTargetCard && !cardPlayedThisTurn ? cardTarget
        : hasRole(me, "journalist") ? journalistTarget
        : hasRole(me, "military") ? scandalTarget
        : hasRole(me, "mafia") || me.assets.some(a => (a.id === "market" || a.id === "datacenter") && !a.blocked) ? leader
        : null;
      if (desiredTarget && target !== desiredTarget.id) { setTarget(desiredTarget.id); return; }

      const cardUtility = (card: ActionCard) => {
        const utilityTarget = targetPlayer ?? (card.kind === "role_pressure" ? scores.find(p=>p.id!==me.id&&p.role) : card.kind === "remove_upgrade" ? scores.find(p=>p.id!==me.id&&p.assets.some(a=>a.automated||a.scaled)) : leader);
        const leaderBonus = utilityTarget?.id === scores[0]?.id ? 2 : 0;
        if (card.kind === "clean") return Math.min(card.value, me.scandals) * 3;
        if (card.kind === "deep_clean") return me.influence >= 2 ? Math.min(card.value, me.scandals) * 3 - 2 : -10;
        if (card.kind === "roof") return me.roofs < roofLimitFor(me) ? 5 : -10;
        if (card.kind === "grant") return card.value + (me.assets.some(a=>a.tags.includes("ai")) ? 2 : 0);
        if (card.kind === "bridge_loan") return card.value - 4 + (isComebackPosition ? 2 : 0);
        if (card.kind === "district_cash") return Math.min(10, districtCount(me, district) * card.value);
        if (card.kind === "influence") return me.money >= 2 ? 4 : -10;
        if (card.kind === "market_discount") return me.assets.length < me.capacity && market.some(a=>priceOf(a)<=me.money+card.value) ? 5 : -5;
        if (card.kind === "upgrade_discount") return me.assets.some(a=>!a.automated&&!a.scaled) ? 5 : -5;
        if (card.kind === "zoning") return [1,3].includes(districtCount(me,district)) ? 6 : 2;
        if (card.kind === "develop") return districtCount(me,district)>=2&&districtLevels[district]<2 ? 7 : -10;
        if (card.kind === "copy_role") return 6;
        if (card.kind === "extra_action") return card.value * 4;
        if (card.kind === "investment_action") return card.value * 3;
        if (card.kind === "comeback") return isComebackPosition ? 8 : 3;
        if (card.kind === "influence_to_cash") return me.influence>=2 ? 5 : -10;
        if (card.kind === "project") return 6;
        if (card.kind === "role_shield") return me.role ? 5 : 2;
        if (card.kind === "scandal_shield") return me.scandals>=3 ? 6 : 4;
        if (card.kind === "unblock") return me.assets.some(a=>a.blocked) ? 7 : -10;
        if (card.kind === "role_pressure") return utilityTarget?.role ? 6 + leaderBonus : -10;
        if (card.kind === "double_scandal") return utilityTarget ? 5 + utilityTarget.scandals * 2 + leaderBonus : -10;
        if (card.kind === "freeze" || card.kind === "remove_upgrade") return 5 + leaderBonus;
        if (card.targeted) return card.value + 2 + leaderBonus;
        return card.value;
      };
      if (!cardPlayedThisTurn) {
        const playable = me.hand.filter(canPlayCard).sort((a,b)=>cardUtility(b)-cardUtility(a))[0];
        if (playable) {
          const districtCard = ["district_cash","zoning","develop"].includes(playable.kind);
          if (districtCard) {
            const bestCardDistrict = [...DISTRICTS].sort((a,b)=>districtCount(me,b.id)-districtCount(me,a.id))[0];
            if (district !== bestCardDistrict.id) { setDistrict(bestCardDistrict.id); return; }
          }
          if (playable.kind === "copy_role") {
            const desiredCopy = me.role === strategicRole ? strategicRoles.filter(r=>r!==me.role).sort((a,b)=>roleUtility(b)-roleUtility(a))[0] : strategicRole;
            if (forgedRoleChoice !== desiredCopy) { setForgedRoleChoice(desiredCopy); return; }
          }
          playCard(playable); return;
        }
      }

      // Free and role-specific powers are resolved before spending normal actions.
      if (hasRole(me, "politician") && !politicianCleanupUsed && me.scandals > 0 && me.influence >= 2) { cleanPoliticianScandal(); return; }
      if (hasRole(me, "politician") && !politicianTaxUsed && me.influence >= 5) {
        const bestTaxDistrict = [...DISTRICTS].sort((a, b) => objectsInDistrict(b.id) - objectsInDistrict(a.id))[0];
        if (objectsInDistrict(bestTaxDistrict.id) >= 5) { collectDistrictTax(bestTaxDistrict.id); return; }
      }
      if (hasRole(me, "capitalist") && !rolePowerUsed && me.influence >= 3 && me.money >= 4) { rolePower(); return; }
      if (hasRole(me, "journalist") && target !== null && !journalistInflateUsed && me.scandals < 4) { journalistInflate(); return; }
      if (hasRole(me, "journalist") && target !== null && !journalistPublishUsed && me.influence >= 3) { journalistPublish(); return; }
      if (hasRole(me, "mafia") && !mafiaCleanupUsed && me.scandals >= 2 && (me.roofs > 0 || (me.money >= 3 && districtCount(me, "government") > 0))) {
        mafiaCleanup(me.roofs > 0 ? "roof" : "money"); return;
      }
      if (actionsLeft > 0 && hasRole(me, "mafia") && !mafiaRacketUsed && target !== null && me.assets.some(a => a.district === "shadows" && !a.blocked)) { mafiaRacket(); return; }
      if (actionsLeft > 0 && hasRole(me, "mafia") && !mafiaRoofSweepUsed && me.roofs > 0 && players.filter(p => p.id !== me.id && p.roofs > 0).length >= 2) { mafiaSweepRoofs(); return; }
      if (actionsLeft > 0 && hasRole(me, "military") && target !== null && targetPlayer && targetPlayer.scandals > 0 && !sanctionedPlayers.includes(target)) { enforcerSanction(); return; }
      if (actionsLeft > 0 && hasRole(me, "fraudster") && me.scandals >= 4) { fraudCleanScandal(); return; }

      // A role is changed only when the situational choice is materially better.
      // If the best role is occupied and a takeover is unaffordable, Journalist is
      // a counter-pick that can push its holder over the scandal threshold.
      if (actionsLeft > 0 && me.scandals < 5) {
        const currentUtility = me.role ? roleUtility(me.role) : -2;
        const shouldChangeRole = me.role !== strategicRole && (me.role === null || roleUtility(strategicRole) >= currentUtility + 3 || isComebackPosition);
        if (shouldChangeRole) {
          const holder = roleHolder(strategicRole);
          const cost = roleCost(holder);
          if ((!holder || me.influence >= cost) && me.influence >= cost) { claimRole(strategicRole); return; }
          const journalistHolder = roleHolder("journalist");
          if (holder && holder.id !== me.id && me.role !== "journalist" && !journalistHolder && me.influence >= settings.rolePrice) { claimRole("journalist"); return; }
        }
      }

      if (actionsLeft > 0 && hasRole(me, "fraudster") && !fraudCryptoUsed && me.assets.some(a => a.id === "crypto" && !a.blocked) && me.scandals <= 3) {
        const safeAmount = Math.max(1, Math.min(isComebackPosition ? 2 : 1, 4 - me.scandals));
        if (fraudScamAmount !== safeAmount) { setFraudScamAmount(safeAmount); return; }
        fraudCryptoScam(); return;
      }
      if (actionsLeft >= 4 && hasRole(me, "fraudster") && !fraudDocsUsed && !me.pendingRole && me.influence >= 5 && districtCount(me, "tech") >= 2) {
        const copied = strategicRoles.filter(r => r !== "fraudster").sort((a, b) => roleUtility(b) - roleUtility(a))[0];
        if (forgedRoleChoice !== copied) { setForgedRoleChoice(copied); return; }
        fraudForgeDocuments(); return;
      }
      if (actionsLeft > 0 && me.money >= 3 && me.influence >= 1 && me.hand.length < 3) {
        const purchaseUtility = (card: ActionCard) => {
          if ((card.kind === "deep_clean" || card.kind === "influence_to_cash") && me.influence < 3) return -10;
          if (card.kind === "influence" && me.money < 5) return -10;
          return cardUtility(card);
        };
        const bestActionCard = [...actionMarket].sort((a,b)=>purchaseUtility(b)-purchaseUtility(a))[0];
        if (bestActionCard && purchaseUtility(bestActionCard) >= 6) { buyCard(bestActionCard); return; }
      }

      // Score market cards by immediate economy, completing 2/4-object synergies
      // and compatibility with the role currently being pursued.
      const marketValue = (asset: MarketAsset) => {
        const count = districtCount(me, asset.district);
        const completion = count === 1 ? 5 : count === 3 ? 7 : count === 2 ? 2 : 0;
        const roleMatch = ROLES.find(r => r.id === strategicRole)?.districts.includes(asset.district) ? 3 : 0;
        const districtEffect = asset.effects?.districtBonus;
        const conditionMatch = districtEffect && hasDistrictLink(me, districtEffect.district) ? districtEffect.value * 2 : 0;
        const linkedRole = asset.effects?.roleBonus;
        const exactRoleMatch = linkedRole?.role === strategicRole ? linkedRole.value * 3 : 0;
        const rarityValue = { common: 0, uncommon: 1, rare: 2, epic: 4, legendary: 6 }[asset.rarity];
        const strategicEffect = (asset.effects?.extraActions ?? 0) * 16 + (asset.effects?.extraInvestmentActions ?? 0) * 10
          + (asset.effects?.scandalReduction ?? 0) * 7 + (asset.effects?.maintenanceReduction ?? 0) * 3
          + (asset.effects?.roofCapacity ?? 0) * 3 + (asset.effects?.turnRoof ?? 0) * 4 + (asset.effects?.greyScandalReduction ?? 0) * 5;
        const greyPenalty = asset.tags.includes("grey") && !hasRole(me, "fraudster") && !hasRole(me, "mafia") ? me.scandals * 2 + 2 : 0;
        return asset.income * 2.5 - priceOf(asset) + asset.influence + completion + roleMatch + exactRoleMatch + conditionMatch + rarityValue + strategicEffect - greyPenalty;
      };
      const affordable = market.filter(a => priceOf(a) <= me.money).sort((a, b) => marketValue(b) - marketValue(a));
      const bestMarket = affordable[0];
      if (canInvest && bestMarket && me.assets.length < me.capacity) { buy(bestMarket); return; }
      const capacityCost = CAPACITY_COST[me.capacity];
      if (canInvest && bestMarket && me.assets.length >= me.capacity && capacityCost && me.money >= capacityCost && marketValue(bestMarket) >= 4) { buyCapacity(); return; }
      if (actionsLeft > 0 && bestMarket && me.assets.length >= me.capacity) {
        const weakest = [...me.assets].sort((a, b) => (marketValue(a) + (a.automated || a.scaled ? 4 : 0)) - (marketValue(b) + (b.automated || b.scaled ? 4 : 0)))[0];
        const replacementGain = marketValue(bestMarket) - marketValue(weakest) - (weakest.automated || weakest.scaled ? 4 : 0);
        if (replacementGain >= 5 && me.money + assetValue(weakest) >= priceOf(bestMarket)) { sellAsset(weakest.uid); return; }
      }

      const developable = DISTRICTS
        .filter(d => districtCount(me, d.id) >= 2 && districtLevels[d.id] < 2)
        .sort((a, b) => districtCount(me, b.id) - districtCount(me, a.id))[0];
      if (actionsLeft > 0 && me.money >= 2 && developable) {
        if (district !== developable.id) { setDistrict(developable.id); return; }
        investDistrict(); return;
      }

      const upgradeable = me.assets.filter(a => !a.scaled && !a.automated && !a.blocked);
      const automation = [...upgradeable].sort((a, b) => objectSynergyIncome(me, b, event) - objectSynergyIncome(me, a, event))[0];
      if (canInvest && me.money >= improvementCost("automate") && automation && objectSynergyIncome(me, automation, event) > 0) { improve(automation.uid, "automate"); return; }
      const modernization = [...upgradeable].sort((a, b) => b.income - a.income)[0];
      if (canInvest && me.money >= improvementCost("scale") && modernization) { improve(modernization.uid, "scale"); return; }

      if (me.hand.length >= 3) {
        const unusable = me.hand.filter(c => !processingCards.current.has(c.uid) && !canPlayCard(c)).sort((a,b)=>cardUtility(a)-cardUtility(b))[0];
        if (unusable && cardUtility(unusable) < 1) { convertCard(unusable, me.influence < settings.rolePrice ? "influence" : "money"); return; }
      }
      if (actionsLeft > 0 && me.influence < (roleHolder(strategicRole) ? settings.rolePrice * 2 : settings.rolePrice) && me.money >= 2) { basicAction("campaign"); return; }
      if (actionsLeft > 0) { basicAction("work"); return; }

      // Absolute fallback: every path above either changes state or reaches here.
      // This prevents a rejected action from being retried forever.
      endTurn();
    }, 550);
    return () => window.clearTimeout(timer);
  }, [turn, actionsLeft, investmentActions, round, finished, gameStarted, settings.rolePrice, players, market, actionMarket, target, district, cardPlayedThisTurn, cardMarketDiscount, cardUpgradeDiscount, politicianTaxUsed, politicianCleanupUsed, journalistInflateUsed, journalistPublishUsed, mafiaCleanupUsed, mafiaRoofSweepUsed, mafiaRacketUsed, sanctionedPlayers, fraudCryptoUsed, fraudDocsUsed, fraudScamAmount, forgedRoleChoice]);

  const totalConfiguredPlayers = settings.humanPlayers + settings.botPlayers;
  if (!gameStarted) return <div className="city-game city-setup-page">
    <section className="city-setup">
      <h1>Город влияния <small>strategy prototype v2</small></h1>
      <p className="dim">Настройте партию. Несколько обычных игроков играют по очереди за одним экраном.</p>
      <div className="city-setup-grid">
        <label><span>Игроков</span><input type="number" min="1" max="4" value={settings.humanPlayers} onChange={e => setSettings(s => ({ ...s, humanPlayers: Number(e.target.value) }))}/><small>От 1 до 4</small></label>
        <label><span>Ботов</span><input type="number" min="0" max="5" value={settings.botPlayers} onChange={e => setSettings(s => ({ ...s, botPlayers: Number(e.target.value) }))}/><small>От 0 до 5</small></label>
        <label><span>Количество раундов</span><input type="number" min="5" max="30" value={settings.maxRounds} onChange={e => setSettings(s => ({ ...s, maxRounds: Number(e.target.value) }))}/><small>Рекомендуется 15</small></label>
        <label><span>Цена свободной роли</span><input type="number" min="2" max="10" value={settings.rolePrice} onChange={e => setSettings(s => ({ ...s, rolePrice: Number(e.target.value) }))}/><small>Переворот: {Math.max(2, settings.rolePrice) * 2}◆</small></label>
      </div>
      <p className={totalConfiguredPlayers < 2 || totalConfiguredPlayers > 6 ? "setup-error" : "setup-summary"}>Всего участников: {totalConfiguredPlayers}. Допустимо от 2 до 6.</p>
      <button className="btn primary setup-start" disabled={totalConfiguredPlayers < 2 || totalConfiguredPlayers > 6} onClick={startGame}>Начать игру</button>
      <a className="btn setup-legacy" href="?legacy=1">Старый MVP</a>
    </section>
  </div>;

  return <div className="city-game">
    <header className="city-head"><div><h1>Город влияния <small>strategy prototype v2</small> <span className="game-version" title="Версия сборки">v{__GAME_VERSION__}</span></h1><p>Раунд {round}/{settings.maxRounds} · Ход: <b>{me.name}</b> · Действий: <b>{actionsLeft}</b>{investmentActions > 0 && <> · Инвестиционных: <b className="investment-actions">{investmentActions}</b></>}{me.isBot && <span className="bot-thinking"> · принимает решение…</span>}</p></div><div className="city-head-buttons"><button className="btn" onClick={() => setShowRules(x => !x)}>📖 Правила</button><a className="btn" href="?legacy=1">Старый MVP</a></div></header>
    <div className="city-event"><strong>📰 {event.title}</strong><span>{event.text}</span><em>Городские проекты: 3◆ → 6 итоговых очков</em></div>
    <section className="city-players">{players.map(p => <article className={`city-player scandal-${Math.min(6,p.scandals)} ${p.id === me.id ? "active" : ""}`} key={p.id}><b>{p.name} <em>{scoreOf(p)} оч.</em></b><span>💰{p.money}　◆{p.influence}　⚠{p.scandals}/6　🛡{p.roofs}</span><small>{ROLES.find(r => r.id === p.role)?.title ?? "без роли"} · объектов {p.assets.length}</small><small className="scandal-status">{scandalStatus(p)}</small></article>)}</section>
    {finished ? <section className="city-finish"><h2>Итоги города</h2>{scores.map((p, i) => <p key={p.id}>{i + 1}. <b>{p.name}</b> — {p.score} очков</p>)}<h3>Полный журнал</h3><p className="dim">Сохранено записей: {log.length}. В файле действия расположены от начала игры к завершению.</p><div className="log-export-actions"><button className="btn" onClick={copyGameLog}>Копировать лог</button><button className="btn" onClick={downloadGameLog}>Скачать .txt</button></div>{logExportStatus && <p className="log-export-status">{logExportStatus}</p>}<button className="btn primary" onClick={() => setGameStarted(false)}>Новая партия</button></section> : <main className="city-layout">
      <section className="city-map"><h2>Районы и рынок <small className="market-remaining">уникальных объектов в колоде: {marketDeck.length}</small></h2><div className="district-grid">{DISTRICTS.map(d => <div className={`district ${district === d.id ? "selected" : ""}`} style={{"--district": d.color} as React.CSSProperties} onClick={() => setDistrict(d.id)} key={d.id}><h3>{d.icon} {d.title} <span className="district-level">{districtCount(me, d.id)}/4 · +{districtSynergy(me, d.id)}$</span></h3><p>{d.description}</p><div className="market-cards">{market.filter(a => a.district === d.id).map(a => <button className={`market-card rarity-${a.rarity}`} title={me.assets.length >= me.capacity ? "Нет свободного слота: продайте объект или расширьте бизнес" : a.text} disabled={me.money < priceOf(a) || !canInvest || me.assets.length >= me.capacity} onClick={() => buy(a)} key={a.uid}><span className="rarity-badge">{ASSET_RARITY_LABELS[a.rarity]}</span><b>{a.title}</b><span>{priceOf(a)}$ · доход {a.income}$ · ◆{a.influence}</span><small>{a.text}</small>{newDistrictDiscount(a) > 0 && <small className="capitalist-discount">Капиталист: новый район −1$</small>}</button>)}</div></div>)}</div>
        <div className="owned-panel">
          <h2>Ваш бизнес · слоты {me.assets.length}/{me.capacity}</h2>
          <section className="active-bonuses"><h3>Активные бонусы</h3><ul>{activeBonuses.map((bonus, i) => <li key={i}>{bonus}</li>)}</ul></section>
          <p className="dim">Все объекты занимают слоты. При полном составе продайте слабый объект или купите следующий слот.</p>
          {me.assets.length === 0 ? <p className="dim">Купите первый объект на рынке.</p> : <div className="owned-grid">{me.assets.map((a, i) => {
            const managed = isManaged(me.assets, i);
            const districtName = DISTRICTS.find(d => d.id === a.district)?.title;
            return <article className={`${a.blocked ? "blocked " : ""}rarity-${a.rarity}`} key={a.uid}>
              <span className="rarity-badge">{ASSET_RARITY_LABELS[a.rarity]}</span><b>{a.title}</b>
              <span>{districtName} · {managed ? "● управляется" : "○ без управления"}</span>
              <strong className="asset-income">Доход в этом раунде: {assetIncome(a, i)}$</strong>
              <small>База {a.income}$ {a.scaled && "· модернизация +2$"} {a.automated && `· синергии ×2 (+${objectSynergyIncome(me, a, event)}$)`} {districtLevels[a.district] > 0 && `· район +${districtLevels[a.district] * 25}%`} {event.district === a.district && event.incomeMultiplier && `· событие ×${event.incomeMultiplier}`}</small>
              <div className="asset-abilities">{assetAbilities(a).map((ability, abilityIndex) => <small className={`asset-ability ${ability.active ? "active" : "inactive"}`} key={abilityIndex}>{ability.active ? "✓ " : "○ "}{ability.text}</small>)}</div>
              <div>
                <button className={a.automated ? "upgrade-complete" : ""} title="Удваивает районные, ролевые и условные бонусы этого объекта" disabled={a.automated || a.scaled || me.money < improvementCost("automate") || !canInvest} onClick={() => improve(a.uid,"automate")}>{a.automated ? "✓ Автоматизация: синергии ×2" : a.scaled ? "Недоступно: выбрана модернизация" : `Автоматизация ${improvementCost("automate")}$ → синергии ×2`}</button>
                <button className={a.scaled ? "upgrade-complete" : ""} title="Всегда добавляет объекту +2$ базового дохода" disabled={a.scaled || a.automated || me.money < improvementCost("scale") || !canInvest} onClick={() => improve(a.uid,"scale")}>{a.scaled ? "✓ Модернизировано +2$" : a.automated ? "Недоступно: выбрана автоматизация" : `Модернизация ${improvementCost("scale")}$ → +2$`}</button>
                <button disabled={actionsLeft < 1} onClick={() => sellAsset(a.uid)}>Продать {assetValue(a)}$</button>
              </div>
            </article>;
          })}</div>}
        </div>
      </section>
      <aside className={`city-actions ${me.isBot ? "bot-turn" : ""}`}><h2>Решения <span className="action-counter">{actionsLeft}/{turnActionLimit}{investmentActions > 0 ? ` + ${investmentActions} инвестиционное` : ""}</span></h2>{me.isBot && <p className="bot-action-note">🤖 Бот анализирует рынок и продолжит автоматически.</p>}{actionsLeft === 0 && investmentActions === 0 && !me.isBot && <p className="no-actions">Действия потрачены. Завершите ход.</p>}{investmentActions > 0 && !me.isBot && <p className="investment-note">Доступно дополнительное действие: покупка объекта, слота, автоматизация или модернизация.</p>}{turnActionLimit===1&&<p className="no-actions">Тюрьма: в этом ходу доступно только одно действие.</p>}<label className={`target-picker ${target === null ? "required" : ""}`}>Цель<select value={target ?? ""} onChange={e => setTarget(e.target.value === "" ? null : Number(e.target.value))}><option value="">— выберите игрока —</option>{players.filter(p => p.id !== me.id).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <div className="action-group"><b>Город</b><button className="btn" disabled={actionsLeft < 1} onClick={() => basicAction("work")}>Городской заказ: +2$</button><button className="btn" disabled={actionsLeft < 1 || me.money < 2} onClick={() => basicAction("campaign")}>Кампания: 2$ → 2 влияния</button><button className="btn" disabled={actionsLeft < 1 || me.influence < 3} onClick={cityProject}>Городской проект: 3◆ → 6 очков</button><button className="btn" disabled={!canInvest || me.capacity >= MAX_CAPACITY || me.money < (CAPACITY_COST[me.capacity] ?? Infinity)} onClick={buyCapacity}>{me.capacity >= MAX_CAPACITY ? "✓ Максимум 6 слотов" : `Купить слот ${me.capacity + 1}: ${CAPACITY_COST[me.capacity]}$`}</button><button className="btn" title="+25% дохода всем объектам выбранного района; +1◆, если у вас там есть объект. Максимум 2 уровня" disabled={actionsLeft < 1 || me.money < 2 || districtLevels[district] >= 2 || districtCount(me, district) < 2} onClick={investDistrict}>Развить район (нужно 2 объекта): 2$ → +25% дохода{me.assets.some(a => a.district === district) ? " +1◆" : ""}</button></div>
        <div className="action-group"><b>Роли · свободная {settings.rolePrice}◆, переворот {settings.rolePrice * 2}◆</b><div className="role-market">{ROLES.map(r => { const holder=roleHolder(r.id);const cost=roleCost(holder);return <button disabled={holder?.id===me.id || me.influence<cost || actionsLeft<1 || me.scandals>=5} onClick={() => claimRole(r.id)} style={{borderColor:r.color}} key={r.id}>{r.title} · {cost}◆<small>{holder ? `занята: ${holder.name}${holder.roofs ? " · защищена Крышей" : ""}` : r.passive}</small></button>})}</div>
          {me.copiedRole && <p className="copied-role">Поддельная роль: {ROLES.find(r=>r.id===me.copiedRole)?.title} — до конца хода</p>}
          {hasRole(me,"capitalist") && <button className="btn full-width" disabled={rolePowerUsed||me.influence<3} onClick={rolePower}>{rolePowerUsed?"✓ Финансирование использовано":"Ускоренное финансирование: 3◆"}</button>}
          {hasRole(me,"politician") && <div className="politician-powers"><small>Прогноз влияния: +{passiveInfluenceFor(me)}◆ за раунд</small><button className="btn full-width" disabled={politicianTaxUsed||me.influence<5||selectedDistrictObjects<1} onClick={()=>collectDistrictTax(district)}>{politicianTaxUsed?"✓ Налог собран":`Налог: 5◆ → ${selectedDistrictObjects}$ (${selectedDistrictOwnObjects} своих + ${selectedDistrictObjects-selectedDistrictOwnObjects} чужих)`}</button><button className="btn full-width" disabled={politicianCleanupUsed||me.influence<2||me.scandals<1} onClick={cleanPoliticianScandal}>{politicianCleanupUsed?"✓ Скандал урегулирован":"Урегулировать скандал: 2◆"}</button></div>}
          {hasRole(me,"journalist") && <div className="role-powers journalist"><button className="btn" disabled={journalistInflateUsed||target===null} onClick={journalistInflate}>{journalistInflateUsed?"✓ История раздута":"Раздуть историю: себе +1, цели +1"}</button><button className="btn" disabled={journalistPublishUsed||target===null||me.influence<3} onClick={journalistPublish}>{journalistPublishUsed?"✓ Публикация сделана":"Публикация: 3◆ → цели +1 скандал"}</button></div>}
          {hasRole(me,"military") && <button className="btn" disabled={actionsLeft<1||target===null||targetPlayer!.scandals<1||sanctionedPlayers.includes(target)} onClick={enforcerSanction}>Санкция: {sanctionOutcome(targetPlayer)}</button>}
          {hasRole(me,"mafia") && <div className="role-powers mafia"><small>Прогноз дани: до {mafiaTributePotential}$ за раунд</small><button className="btn danger" disabled={mafiaRacketUsed||actionsLeft<1||target===null||!me.assets.some(a=>a.district==="shadows"&&!a.blocked)} onClick={mafiaRacket}>{mafiaRacketUsed?"✓ Рэкет проведён":"Рэкет выбранной цели"}</button><button className="btn danger" disabled={mafiaRoofSweepUsed||actionsLeft<1||me.roofs<1} onClick={mafiaSweepRoofs}>{mafiaRoofSweepUsed?"✓ Связи сожжены":"Сжечь связи: все теряют Крышу"}</button><button className="btn" disabled={mafiaCleanupUsed||me.roofs<1||me.scandals<1} onClick={()=>mafiaCleanup("roof")}>Крыша → −2 скандала</button><button className="btn" disabled={mafiaCleanupUsed||me.money<3||districtCount(me,"government")<1||me.scandals<1} onClick={()=>mafiaCleanup("money")}>Коррупция: 3$ → −2 скандала</button></div>}
          {hasRole(me,"fraudster") && <div className="role-powers fraud"><button className="btn" disabled={actionsLeft<1||me.scandals<1} onClick={fraudCleanScandal}>Действие → −1 скандал</button><label>Скандалов за криптоскам <input type="number" min="1" max="6" value={fraudScamAmount} onChange={e=>setFraudScamAmount(Number(e.target.value))}/></label><button className="btn danger" disabled={fraudCryptoUsed||actionsLeft<1||!me.assets.some(a=>a.id==="crypto"&&!a.blocked)} onClick={fraudCryptoScam}>{fraudCryptoUsed?"✓ Криптоскам проведён":`Криптоскам: до ${(players.length-1)*fraudScamAmount}$, +${fraudScamAmount} сканд.`}</button><label>Поддельная роль <select value={forgedRoleChoice} onChange={e=>setForgedRoleChoice(e.target.value as RoleId)}>{ROLES.filter(r=>r.id!=="fraudster").map(r=><option value={r.id} key={r.id}>{r.title}</option>)}</select></label><button className="btn danger" disabled={fraudDocsUsed||actionsLeft<4||me.influence<5} onClick={fraudForgeDocuments}>Подделка: 4 действия + 5◆ · шанс {Math.min(90,50+districtCount(me,"tech")*10)}%</button></div>}
        </div>
        <div className="action-group card-section"><b>Рынок карт · 3$ + 1◆ + действие <small>в колоде {actionDeck.length}</small></b><p className="dim card-rule">Розыгрыш бесплатный, но только одна карта за ход. Рука {me.hand.length}/3.</p><div className="action-market">{actionMarket.map(c=><button className={`action-card market-action ${c.tone}`} disabled={actionsLeft<1||me.money<3||me.influence<1||me.hand.length>=3} onClick={()=>buyCard(c)} key={c.id}><strong>{c.title}<em>купить</em></strong><small>{c.text}</small></button>)}</div>{me.hand.some(c=>c.kind==="copy_role")&&<label>Роль для мандата <select value={forgedRoleChoice} onChange={e=>setForgedRoleChoice(e.target.value as RoleId)}>{ROLES.map(r=><option value={r.id} key={r.id}>{r.title}</option>)}</select></label>}{me.hand.map(c => { const targeted=c.targeted===true;return <div className={`hand-card ${c.tone}`} key={c.uid}><button className="action-card" onClick={() => playCard(c)} disabled={!canPlayCard(c)}><strong>{c.title}<em>{targeted?`→ ${targetPlayer?.name??"цель"}`:"→ себе"}</em></strong><small>{c.text}</small></button><div><button onClick={() => convertCard(c,"money")}>Продать +1$</button><button onClick={() => convertCard(c,"influence")}>Сбросить +1◆</button></div></div>})}{cardPlayedThisTurn&&<small className="card-played-note">✓ Карта в этом ходу уже разыграна</small>}</div>
        <div className="action-group"><b>Серые операции</b><button className="btn" disabled={actionsLeft<1||me.influence<2||!me.assets.some(a=>a.id==="cash"&&!a.blocked)} onClick={()=>runGreyOperation("cash")}>Отмывание: 2◆ → 5$</button><button className="btn" disabled={actionsLeft<1||target===null||!me.assets.some(a=>a.id==="market"&&!a.blocked)} onClick={()=>runGreyOperation("market")}>Контрабанда: украсть до 3$</button><button className="btn danger" disabled={actionsLeft<1||!me.assets.some(a=>a.id==="crypto"&&!a.blocked)} onClick={()=>runGreyOperation("crypto")}>Памп и дамп: +6$, лидер −2$</button><button className="btn danger" disabled={actionsLeft<1||target===null||!me.assets.some(a=>a.id==="datacenter"&&!a.blocked)} onClick={()=>runGreyOperation("datacenter")}>Взлом: блокировать объект цели</button></div>
        <button className="btn" disabled={actionsLeft<1||me.money<4||me.scandals<1} onClick={crisisPR}>Антикризисный PR: 4$ → −1 скандал</button>
        <button className="btn" disabled={actionsLeft<1||me.money<(hasRole(me,"mafia")?2:3)||me.roofs>=roofLimitFor(me)} onClick={buyRoof}>Купить Крышу ({hasRole(me,"mafia")?2:3}$) · лимит {roofLimitFor(me)}</button><button className="btn primary full-width" onClick={endTurn}>Завершить ход</button>
      </aside>
      <aside className="city-log"><h2>Хроника</h2>{log.map((x,i)=><p key={i}>{x}</p>)}</aside>
    </main>}
    {showRules && <Rules rolePrice={settings.rolePrice} />}
  </div>;
}

function Rules({ rolePrice }: { rolePrice: number }) { return <section className="city-help"><h2>Как играть</h2><div className="help-grid">
  <article><h3>🎯 Победа</h3><p>Деньги + влияние + половина стоимости бизнеса + проекты + роль − скандалы. Текущий прогноз виден у каждого игрока.</p></article>
  <article><h3>⏱️ Действия</h3><p>Обычно доступны три действия, у Афериста — четыре. После тюрьмы следующий ход проходит с одним действием.</p></article>
  <article><h3>🏙️ Комбинации районов</h3><p>Два объекта района дают каждому +1$ дохода, четыре — +2$. Развивать район можно только с двумя своими объектами: уровень стоит 2$ и добавляет ещё +25% дохода.</p></article>
  <article><h3>⚙️ Слоты бизнеса</h3><p>В начале доступны 3 объекта. Новые слоты стоят 6/10/15$. При полном составе нужно продать объект или расшириться; каждый объект требует 1$ содержания за раунд.</p></article>
  <article><h3>💎 Редкость объектов</h3><p>Серые обычные объекты дают базовый доход; зелёные необычные связывают районы; синие редкие усиливают роли; фиолетовые эпические объединяют роль и район; оранжевые легендарные меняют правила хода. Все 42 объекта уникальны и не возвращаются в рынок после покупки.</p></article>
  <article><h3>🔧 Ветка улучшения</h3><p>Объект выбирает одну ветку: автоматизация за 5$ удваивает его районные, ролевые и условные синергии; модернизация за 4$ всегда добавляет +2$ базового дохода. Вторая ветка закрывается.</p></article>
  <article><h3>🏷️ Роли и скандалы</h3><p>Свободная роль стоит {rolePrice}◆, переворот всегда ровно вдвое дороже — {rolePrice * 2}◆. Лоббистское бюро возвращает владельцу 2◆, если его роль отобрали. Пять скандалов немедленно снимают роль, шесть отправляют в тюрьму. Без роли в начале хода снимается один скандал.</p></article>
  <article><h3>💼 Капиталист</h3><p>Первый объект нового района дешевле на 1$. Деловые объекты получают +1$ синергии, а условия связи с Деловым центром всегда активны. Раз в раунд 3◆ дают дополнительное действие только на покупку объекта, слота или улучшение.</p></article>
  <article><h3>🏛️ Политик</h3><p>Условия Административного квартала всегда активны. Жильё получает +1$ дохода, административные объекты — +1◆ за раунд; автоматизация удваивает бонус. Раз в раунд 5◆ можно обменять на 1$ за каждый объект выбранного района во всём городе, а 2◆ — на снятие скандала.</p></article>
  <article><h3>🃏 Карты</h3><p>На рынке открыты 3 уникальные карты. Выбранная карта стоит 3$ + 1◆ и действие; её розыгрыш бесплатный, но разрешён только один раз за ход. Лимит руки — три, сыгранные и сброшенные карты не возвращаются.</p></article>
  <article><h3>🌒 Серые операции</h3><p>Обменники открывают отмывание, Ночной рынок — контрабанду, Криптобиржа — памп, дата-центр — взлом. Покупки и операции дают скандалы и могут лишить денег, улучшений, роли или свободы.</p></article>
  <article><h3>📰 Журналист</h3><p>Получает влияние за собственные и чужие скандалы, может одновременно дать скандал себе и цели, а за 3◆ провести публикацию.</p></article>
  <article><h3>⚖️ Силовик</h3><p>Промзона получает +1$. Санкции по уровню скандалов отнимают влияние, деньги, Крышу, улучшения или конфискуют объект. После каждой санкции цель теряет 1 скандал.</p></article>
  <article><h3>🔪 Мафиози</h3><p>Серый сектор получает +1$. Рэкет давит на лидера, Крыша и коррупция чистят скандалы, а дань перенаправляет доход районного меньшинства.</p></article>
  <article><h3>🎭 Аферист</h3><p>Имеет четыре действия и бонус Технокластера. Может снять скандал действием, провести криптоскам или рискнуть всем ходом ради временной копии другой роли.</p></article>
  <article><h3>🛡️ Крыша</h3><p>Отменяет направленный финансовый, репутационный или силовой эффект. Обычный лимит — одна, у Мафиози — две.</p></article>
  <article><h3>💡 Первый план</h3><p>Купите 1–2 компании → получите влияние → захватите профильную роль → соберите районные связи или подготовьте давление на лидера.</p></article>
</div></section>; }
