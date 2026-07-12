export type DistrictId = "residential" | "business" | "industrial" | "tech" | "government" | "shadows";
export type RoleId = "capitalist" | "politician" | "journalist" | "fraudster" | "mafia" | "military";

export interface District { id: DistrictId; title: string; icon: string; color: string; description: string }
export interface AssetCard { id: string; title: string; district: DistrictId; cost: number; income: number; influence: number; text: string; tags: string[] }
export interface ActionCard { id: string; title: string; tone: "deal" | "attack" | "defence"; text: string; kind: string; value: number }
export interface EventCard { id: string; title: string; text: string; district?: DistrictId; incomeMultiplier?: number; marketDiscount?: number }
export interface RoleCard { id: RoleId; title: string; color: string; passive: string; power: string; districts: DistrictId[] }

export const DISTRICTS: District[] = [
  { id: "residential", title: "Спальный район", icon: "🏘️", color: "#4fa3d1", description: "Жильё, сервисы и стабильный спрос." },
  { id: "business", title: "Деловой центр", icon: "🏙️", color: "#d7aa3d", description: "Финансы, офисы и публичный капитал." },
  { id: "industrial", title: "Промзона", icon: "🏭", color: "#b56f42", description: "Производство с высоким доходом и риском." },
  { id: "tech", title: "Технокластер", icon: "🧠", color: "#9b6ee7", description: "ИИ, данные, криптоактивы и волатильность." },
  { id: "government", title: "Административный квартал", icon: "🏛️", color: "#5f78c8", description: "Контракты, влияние и контроль правил." },
  { id: "shadows", title: "Серый сектор", icon: "🌒", color: "#8a455e", description: "Фавелы, наличные, контрабанда и Крыша." },
];

export const ROLES: RoleCard[] = [
  { id: "capitalist", title: "Капиталист", color: "#d4af37", passive: "Покупки −1$; профильные районы дают +1$ с объекта.", power: "Получить 2$ капитала.", districts: ["business", "tech"] },
  { id: "politician", title: "Политик", color: "#4f7de0", passive: "Профильные районы +1$; госуслуги дают +1 влияние.", power: "Снять скандал или получить 2$ субсидии.", districts: ["government", "residential"] },
  { id: "journalist", title: "Журналист", color: "#32a86a", passive: "Видит силу серых схем соперников.", power: "Дать скандал лидеру по капиталу.", districts: ["residential", "government"] },
  { id: "fraudster", title: "Аферист", color: "#aa68ee", passive: "+20% шанса и +1$ серым схемам; профиль +1$.", power: "Получить 1$ и 1 влияние.", districts: ["tech", "shadows"] },
  { id: "mafia", title: "Мафиози", color: "#b84343", passive: "Крыша стоит на 1$ дешевле.", power: "Получить 2$ с выбранного игрока или скандал.", districts: ["industrial", "shadows"] },
  { id: "military", title: "Военный", color: "#70848b", passive: "Первый объект нельзя заблокировать.", power: "Закрыть чужой объект на один раунд.", districts: ["industrial", "government"] },
];

export const ASSETS: AssetCard[] = [
  { id:"housing", title:"Модульный жилой комплекс", district:"residential", cost:6, income:2, influence:0, text:"Надёжный базовый доход.", tags:["legal"] },
  { id:"delivery", title:"Сеть тёмных кухонь", district:"residential", cost:5, income:2, influence:0, text:"+1$ во время Городского фестиваля.", tags:["service"] },
  { id:"media", title:"Городская медиасеть", district:"residential", cost:7, income:1, influence:2, text:"+1 влияние за раунд вместе с Административным кварталом.", tags:["media"] },
  { id:"fund", title:"Венчурный фонд", district:"business", cost:8, income:3, influence:1, text:"+1$ за каждый ваш объект Технокластера.", tags:["finance"] },
  { id:"bank", title:"Цифровой банк", district:"business", cost:9, income:3, influence:1, text:"+1$ за каждый другой объект Делового центра.", tags:["finance"] },
  { id:"cowork", title:"Сеть гибких офисов", district:"business", cost:6, income:2, influence:1, text:"+1$ вместе с объектом Спального района.", tags:["office"] },
  { id:"robotics", title:"Роботизированный завод", district:"industrial", cost:9, income:4, influence:0, text:"Высокая производительность.", tags:["production"] },
  { id:"battery", title:"Завод накопителей энергии", district:"industrial", cost:8, income:3, influence:1, text:"+1$ вместе с объектом Спального района.", tags:["energy"] },
  { id:"logistics", title:"Автономный логистический хаб", district:"industrial", cost:7, income:3, influence:0, text:"Ваши следующие промышленные покупки дешевле на 1$.", tags:["logistics"] },
  { id:"ai", title:"Лаборатория генеративного ИИ", district:"tech", cost:8, income:3, influence:1, text:"+1$ с Деловым центром; усиливает Инновационный грант.", tags:["ai"] },
  { id:"crypto", title:"Городская криптобиржа", district:"tech", cost:6, income:2, influence:0, text:"+1$ с Серым сектором; открывает серые схемы.", tags:["crypto","grey"] },
  { id:"data", title:"Платформа городских данных", district:"tech", cost:7, income:2, influence:2, text:"+1 влияние за раунд вместе с Административным кварталом.", tags:["data"] },
  { id:"contract", title:"Оператор госуслуг", district:"government", cost:8, income:2, influence:2, text:"Даёт Политику +1 влияние за раунд.", tags:["contract"] },
  { id:"security", title:"Частная служба безопасности", district:"government", cost:7, income:2, influence:1, text:"При покупке выдаёт Крышу.", tags:["security"] },
  { id:"lobby", title:"Лоббистское бюро", district:"government", cost:6, income:1, influence:2, text:"Переворот против вашей роли стоит на 1 влияние дороже.", tags:["lobby"] },
  { id:"cash", title:"Сеть наличных обменников", district:"shadows", cost:4, income:2, influence:0, text:"Дешёвый вход в серую экономику.", tags:["grey"] },
  { id:"market", title:"Ночной рынок", district:"shadows", cost:5, income:2, influence:1, text:"+1$ со Спальным районом или Деловым центром; открывает схемы.", tags:["grey"] },
  { id:"datacenter", title:"Нелегальный дата-центр", district:"shadows", cost:6, income:3, influence:0, text:"+1$ с Технокластером; открывает серые схемы.", tags:["grey","tech"] },
];

export const ACTIONS: ActionCard[] = [
  { id:"audit", title:"Внеплановая проверка", tone:"attack", text:"Цель платит 3$ или получает скандал.", kind:"fine", value:3 },
  { id:"leak", title:"Утечка данных", tone:"attack", text:"Дайте скандал владельцу Технокластера.", kind:"scandal", value:1 },
  { id:"partnership", title:"Стратегическое партнёрство", tone:"deal", text:"Вы и цель получаете по 2$.", kind:"deal", value:2 },
  { id:"grant", title:"Инновационный грант", tone:"deal", text:"Получите 3$; если есть ИИ — ещё 1 влияние.", kind:"grant", value:3 },
  { id:"lawyers", title:"Корпоративные юристы", tone:"defence", text:"Снимите один скандал.", kind:"clean", value:1 },
  { id:"insurance", title:"Страховой контур", tone:"defence", text:"Получите Крышу.", kind:"roof", value:1 },
  { id:"hostile", title:"Враждебное поглощение", tone:"attack", text:"Цель теряет 2$, вы получаете 1$.", kind:"steal", value:2 },
  { id:"campaign", title:"Городская кампания", tone:"deal", text:"Потратьте 2$ и получите 2 влияния.", kind:"influence", value:2 },
];

export const EVENTS: EventCard[] = [
  { id:"ai_boom", title:"Бум искусственного интеллекта", text:"Технокластер приносит двойной доход.", district:"tech", incomeMultiplier:2 },
  { id:"housing", title:"Жилищный кризис", text:"Объекты Спального района приносят двойной доход.", district:"residential", incomeMultiplier:2 },
  { id:"orders", title:"Оборонный заказ", text:"Промзона приносит двойной доход.", district:"industrial", incomeMultiplier:2 },
  { id:"election", title:"Предвыборный год", text:"Административные объекты дают двойное влияние при покупке.", district:"government" },
  { id:"crypto_winter", title:"Криптозима", text:"Технологические объекты продаются на 2$ дешевле.", district:"tech", marketDiscount:2 },
  { id:"festival", title:"Городской фестиваль", text:"Спальный район продаётся на 1$ дешевле.", district:"residential", marketDiscount:1 },
  { id:"amnesty", title:"Амнистия капитала", text:"Серый сектор приносит двойной доход.", district:"shadows", incomeMultiplier:2 },
  { id:"rates", title:"Высокая ключевая ставка", text:"Деловые активы стоят на 1$ дороже.", district:"business", marketDiscount:-1 },
];
