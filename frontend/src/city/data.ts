export type DistrictId = "residential" | "business" | "industrial" | "tech" | "government" | "shadows";
export type RoleId = "capitalist" | "politician" | "journalist" | "fraudster" | "mafia" | "military";
export type AssetRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const ASSET_RARITY_LABELS: Record<AssetRarity, string> = { common: "Обычный", uncommon: "Необычный", rare: "Редкий", epic: "Эпический", legendary: "Легендарный" };

export interface AssetEffects {
  districtBonus?: { district: DistrictId; value: number; perObject?: boolean; excludeSelf?: boolean; virtualRole?: RoleId };
  roleBonus?: { role: RoleId; value: number };
  // Bonus for two or more different roles (each active when you hold that role).
  roleBonuses?: { role: RoleId; value: number }[];
  // Flat cross-district synergies: +value for each listed district where you own
  // at least one object. Used for multi-synergy cards without role bonuses.
  districtLinks?: { district: DistrictId; value: number }[];
  influenceBonus?: { value: number; role?: RoleId; district?: DistrictId };
  eventBonus?: { eventId: string; value: number };
  journalistScandalIncome?: number;
  purchase?: { money?: number; influence?: number; scandals?: number; roofs?: number; card?: boolean };
  extraActions?: number;
  extraInvestmentActions?: number;
  scandalReduction?: number;
  roofCapacity?: number;
  turnRoof?: number;
  maintenanceReduction?: number;
  greyScandalReduction?: number;
  developmentDiscount?: number;
  takeoverCompensation?: number;
  // Passive: one unused action is banked and carried into your next turn.
  carryAction?: number;
}

export interface District { id: DistrictId; title: string; icon: string; color: string; description: string }
export interface AssetCard { id: string; title: string; district: DistrictId; rarity: AssetRarity; cost: number; income: number; influence: number; text: string; tags: string[]; effects?: AssetEffects }
export interface ActionCard { id: string; title: string; tone: "deal" | "attack" | "defence"; text: string; kind: string; value: number; targeted?: boolean }
export interface EventCard { id: string; title: string; text: string; district?: DistrictId; incomeMultiplier?: number; marketDiscount?: number; globalIncome?: number; globalMarketDiscount?: number }
export interface RoleCard { id: RoleId; title: string; icon: string; color: string; passive: string; power: string; districts: DistrictId[] }

export const DISTRICTS: District[] = [
  { id: "residential", title: "Спальный район", icon: "🏘️", color: "#4fa3d1", description: "Жильё, сервисы и стабильный спрос." },
  { id: "business", title: "Деловой центр", icon: "🏙️", color: "#d7aa3d", description: "Финансы, офисы и публичный капитал." },
  { id: "industrial", title: "Промзона", icon: "🏭", color: "#b56f42", description: "Производство с высоким доходом и риском." },
  { id: "tech", title: "Технокластер", icon: "🧠", color: "#9b6ee7", description: "ИИ, данные, криптоактивы и волатильность." },
  { id: "government", title: "Административный квартал", icon: "🏛️", color: "#5f78c8", description: "Контракты, влияние и контроль правил." },
  { id: "shadows", title: "Серый сектор", icon: "🌒", color: "#8a455e", description: "Фавелы, наличные, контрабанда и Крыша." },
];

export const ROLES: RoleCard[] = [
  { id: "capitalist", title: "Капиталист", icon: "💼", color: "#d4af37", passive: "Новый район −1$; Деловой центр +1$; деловые условия всегда активны.", power: "Ускоренное финансирование: 3◆ → +1 инвестиционное действие.", districts: ["business"] },
  { id: "politician", title: "Политик", icon: "🏛️", color: "#4f7de0", passive: "Жильё +1$; административные объекты дают влияние; базовые +1◆/раунд и +1◆ за каждые 2 жилых объекта.", power: "Налог района: 4◆ → 1$ за каждый городской объект. Скандал: 2◆.", districts: ["residential"] },
  { id: "journalist", title: "Журналист", icon: "📰", color: "#32a86a", passive: "Скандалы превращаются во влияние; может создавать скандалы себе и соперникам.", power: "Публикация: 3◆ → цели +1 скандал.", districts: [] },
  { id: "fraudster", title: "Аферист", icon: "🎭", color: "#aa68ee", passive: "4 действия; Технокластер +1$; камбэк и поддельные роли.", power: "Криптоскам, очистка скандалов и подделка документов.", districts: ["tech"] },
  { id: "mafia", title: "Мафиози", icon: "🔪", color: "#b84343", passive: "Серый сектор +1$; Крыша дешевле; получает дань с районного меньшинства.", power: "Рэкет, сжечь связи или замять дело.", districts: ["shadows"] },
  { id: "military", title: "Силовик", icon: "⚖️", color: "#70848b", passive: "Промзона +1$; использует чужие скандалы.", power: "Санкции: штраф по уровню цели, затем −1 скандал у цели.", districts: ["industrial"] },
];

export const ASSETS: AssetCard[] = [
  // Спальный район: база → межрайонные связи → роли → роль + район → правило партии.
  { id:"housing", title:"Модульный жилой комплекс", district:"residential", rarity:"common", cost:5, income:2, influence:0, text:"Простой стабильный доход без условий.", tags:["legal"] },
  { id:"delivery", title:"Сеть районных доставок", district:"residential", rarity:"common", cost:4, income:2, influence:0, text:"+1$ во время Городского фестиваля.", tags:["service"], effects:{eventBonus:{eventId:"festival",value:1}} },
  { id:"media", title:"Городская медиасеть", district:"residential", rarity:"uncommon", cost:7, income:1, influence:2, text:"+1◆ за раунд, если есть объект Административного квартала.", tags:["media"], effects:{influenceBonus:{value:1,district:"government"}} },
  { id:"retail", title:"Квартальный торговый центр", district:"residential", rarity:"uncommon", cost:7, income:2, influence:0, text:"+2$ при наличии объекта Делового центра.", tags:["service"], effects:{districtBonus:{district:"business",value:2}} },
  { id:"campaign_hq", title:"Районный избирательный штаб", district:"residential", rarity:"rare", cost:9, income:2, influence:2, text:"+2$ к доходу, пока вы Политик.", tags:["politics"], effects:{roleBonus:{role:"politician",value:2}} },
  { id:"diplomatic_quarter", title:"Дипломатический жилой квартал", district:"residential", rarity:"epic", cost:12, income:3, influence:2, text:"+1$ за Политика и +2$ при наличии Административного объекта.", tags:["politics"], effects:{roleBonus:{role:"politician",value:1},districtBonus:{district:"government",value:2}} },
  { id:"urban_ecosystem", title:"Городская экосистема", district:"residential", rarity:"legendary", cost:16, income:2, influence:1, text:"Первые 3 ваших объекта не требуют содержания каждый раунд.", tags:["infrastructure"], effects:{maintenanceReduction:3} },

  // Деловой центр.
  { id:"cowork", title:"Сеть гибких офисов", district:"business", rarity:"common", cost:5, income:2, influence:1, text:"Доступный доход и 1 влияние при покупке.", tags:["office"] },
  { id:"accounting", title:"Облачная бухгалтерия", district:"business", rarity:"common", cost:6, income:3, influence:0, text:"Простой денежный объект без условий.", tags:["finance"] },
  { id:"bank", title:"Цифровой банк", district:"business", rarity:"uncommon", cost:8, income:2, influence:1, text:"+1$ за каждый другой объект Делового центра; Капиталист считается дополнительной связью.", tags:["finance"], effects:{districtBonus:{district:"business",value:1,perObject:true,excludeSelf:true,virtualRole:"capitalist"}} },
  { id:"fund", title:"Венчурный фонд", district:"business", rarity:"uncommon", cost:8, income:2, influence:1, text:"+1$ за каждый ваш объект Технокластера.", tags:["finance"], effects:{districtBonus:{district:"tech",value:1,perObject:true}} },
  { id:"brokerage", title:"Премиальный брокерский дом", district:"business", rarity:"rare", cost:10, income:3, influence:1, text:"+2$ к доходу, пока вы Капиталист.", tags:["finance"], effects:{roleBonus:{role:"capitalist",value:2}} },
  { id:"industrial_holding", title:"Индустриальный холдинг", district:"business", rarity:"epic", cost:13, income:3, influence:1, text:"+1$ за Капиталиста и +2$ при наличии объекта Промзоны.", tags:["finance","production"], effects:{roleBonus:{role:"capitalist",value:1},districtBonus:{district:"industrial",value:2}} },
  { id:"global_exchange", title:"Международная фондовая биржа", district:"business", rarity:"legendary", cost:18, income:1, influence:2, text:"В начале каждого хода даёт 1 дополнительное инвестиционное действие.", tags:["finance"], effects:{extraInvestmentActions:1} },

  // Промзона.
  { id:"robotics", title:"Роботизированный завод", district:"industrial", rarity:"common", cost:7, income:4, influence:0, text:"Высокий базовый доход без условий.", tags:["production"] },
  { id:"warehouse", title:"Автоматизированный склад", district:"industrial", rarity:"common", cost:5, income:2, influence:0, text:"Недорогой промышленный объект.", tags:["logistics"] },
  { id:"battery", title:"Завод накопителей энергии", district:"industrial", rarity:"uncommon", cost:8, income:3, influence:1, text:"+2$ при наличии объекта Спального района.", tags:["energy"], effects:{districtBonus:{district:"residential",value:2}} },
  { id:"logistics", title:"Автономный логистический хаб", district:"industrial", rarity:"uncommon", cost:8, income:3, influence:0, text:"Следующие покупки объектов Промзоны дешевле на 1$.", tags:["logistics"] },
  { id:"defence_bureau", title:"Конструкторское бюро обороны", district:"industrial", rarity:"rare", cost:10, income:3, influence:1, text:"+2$ к доходу, пока вы Силовик.", tags:["production","security"], effects:{roleBonus:{role:"military",value:2}} },
  { id:"state_concern", title:"Государственный промышленный концерн", district:"industrial", rarity:"epic", cost:13, income:4, influence:1, text:"+1$ за Силовика и +2$ при наличии Административного объекта.", tags:["production"], effects:{roleBonus:{role:"military",value:1},districtBonus:{district:"government",value:2}} },
  { id:"fortress_factory", title:"Завод-крепость", district:"industrial", rarity:"legendary", cost:17, income:2, influence:0, text:"Можно иметь на 1 Крышу больше; в начале хода восстанавливает 1 Крышу до лимита.", tags:["production","security"], effects:{roofCapacity:1,turnRoof:1} },

  // Технокластер.
  { id:"web_studio", title:"Студия цифровых продуктов", district:"tech", rarity:"common", cost:5, income:2, influence:1, text:"Базовый технологический объект.", tags:["tech"] },
  { id:"cloud", title:"Облачный вычислительный узел", district:"tech", rarity:"common", cost:6, income:3, influence:0, text:"Стабильная вычислительная аренда.", tags:["tech"] },
  { id:"ai", title:"Лаборатория генеративного ИИ", district:"tech", rarity:"uncommon", cost:8, income:3, influence:1, text:"+2$ при наличии объекта Делового центра; усиливает Инновационный грант.", tags:["ai"], effects:{districtBonus:{district:"business",value:2}} },
  { id:"data", title:"Платформа городских данных", district:"tech", rarity:"uncommon", cost:8, income:2, influence:2, text:"+1◆ за раунд, если есть объект Административного квартала.", tags:["data"], effects:{influenceBonus:{value:1,district:"government"}} },
  { id:"crypto", title:"Городская криптобиржа", district:"tech", rarity:"rare", cost:9, income:2, influence:0, text:"При покупке +2◆ и +1 скандал; +2$ к доходу Афериста; открывает криптоскам.", tags:["crypto","grey"], effects:{purchase:{influence:2,scandals:1},roleBonus:{role:"fraudster",value:2}} },
  { id:"prediction", title:"Платформа предиктивной аналитики", district:"tech", rarity:"epic", cost:13, income:3, influence:2, text:"+1$ за Афериста и +2$ при наличии объекта Делового центра.", tags:["ai","data"], effects:{roleBonus:{role:"fraudster",value:1},districtBonus:{district:"business",value:2}} },
  { id:"quantum", title:"Квантовый вычислительный центр", district:"tech", rarity:"legendary", cost:18, income:0, influence:2, text:"Не приносит базовый доход, но даёт +1 обычное действие в начале каждого хода.", tags:["tech"], effects:{extraActions:1} },

  // Административный квартал.
  { id:"contract", title:"Оператор госуслуг", district:"government", rarity:"common", cost:6, income:2, influence:2, text:"Базовый административный объект с влиянием.", tags:["contract"] },
  { id:"archive", title:"Муниципальный архив", district:"government", rarity:"common", cost:5, income:1, influence:2, text:"Недорогой источник влияния.", tags:["government"] },
  { id:"security", title:"Частная служба безопасности", district:"government", rarity:"uncommon", cost:8, income:2, influence:1, text:"При покупке выдаёт 1 Крышу.", tags:["security"], effects:{purchase:{roofs:1}} },
  { id:"lobby", title:"Лоббистское бюро", district:"government", rarity:"uncommon", cost:7, income:1, influence:2, text:"Если вашу роль отберут, получите 2◆ компенсации.", tags:["lobby"], effects:{takeoverCompensation:2} },
  { id:"press_centre", title:"Национальный пресс-центр", district:"government", rarity:"rare", cost:10, income:2, influence:2, text:"+2$ к доходу, пока вы Журналист.", tags:["media","government"], effects:{roleBonus:{role:"journalist",value:2}} },
  { id:"regulator", title:"Федеральное агентство развития", district:"government", rarity:"epic", cost:12, income:2, influence:3, text:"+1$ за Политика и +2$ при наличии объекта Делового центра.", tags:["government","finance"], effects:{roleBonus:{role:"politician",value:1},districtBonus:{district:"business",value:2}} },
  { id:"anticorruption", title:"Антикоррупционное агентство", district:"government", rarity:"legendary", cost:15, income:0, influence:3, text:"Не приносит базовый доход; в начале каждого хода снимает 1 ваш скандал.", tags:["government"], effects:{scandalReduction:1} },
  { id:"mayor_secretariat", title:"Секретариат мэра", district:"government", rarity:"legendary", cost:16, income:1, influence:2, text:"Пассив: одно неиспользованное действие сохраняется и переносится на следующий ход.", tags:["government"], effects:{carryAction:1} },

  // Серый сектор.
  { id:"cash", title:"Сеть наличных обменников", district:"shadows", rarity:"common", cost:4, income:2, influence:0, text:"При покупке +2$ и +1 скандал; открывает отмывание.", tags:["grey"], effects:{purchase:{money:2,scandals:1}} },
  { id:"market", title:"Ночной рынок", district:"shadows", rarity:"common", cost:5, income:2, influence:1, text:"При покупке карта и +1 скандал; открывает контрабанду.", tags:["grey"], effects:{purchase:{card:true,scandals:1}} },
  { id:"datacenter", title:"Нелегальный дата-центр", district:"shadows", rarity:"uncommon", cost:7, income:3, influence:0, text:"При покупке +2 скандала; +2$ при наличии Технокластера; открывает взлом.", tags:["grey","tech"], effects:{purchase:{scandals:2},districtBonus:{district:"tech",value:2}} },
  { id:"smuggling", title:"Контрабандный терминал", district:"shadows", rarity:"uncommon", cost:7, income:2, influence:0, text:"+2$ при наличии объекта Промзоны.", tags:["grey","logistics"], effects:{districtBonus:{district:"industrial",value:2}} },
  { id:"thieves_guild", title:"Гильдия теневых подрядчиков", district:"shadows", rarity:"rare", cost:9, income:3, influence:0, text:"+2$ к доходу, пока вы Мафиози.", tags:["grey"], effects:{roleBonus:{role:"mafia",value:2}} },
  { id:"corruption_network", title:"Коррупционная сеть", district:"shadows", rarity:"epic", cost:12, income:3, influence:1, text:"+1$ за Мафиози и +2$ при наличии Административного объекта.", tags:["grey","government"], effects:{roleBonus:{role:"mafia",value:1},districtBonus:{district:"government",value:2}} },
  { id:"offshore", title:"Автономная офшорная юрисдикция", district:"shadows", rarity:"legendary", cost:15, income:0, influence:1, text:"Не приносит базовый доход; серые покупки и операции дают на 1 скандал меньше, лимит Крыш увеличен на 1.", tags:["grey"], effects:{greyScandalReduction:1,roofCapacity:1} },

  // --- Расширение колоды: +4 карты на район (двойные роли и мультирайонные синергии). ---

  // Спальный район (доп.).
  { id:"pharmacy_chain", title:"Сеть аптек у дома", district:"residential", rarity:"common", cost:5, income:3, influence:0, text:"Простой стабильный доход без условий.", tags:["service"] },
  { id:"utility_company", title:"Управляющая компания", district:"residential", rarity:"uncommon", cost:7, income:1, influence:1, text:"+1$ за каждый другой ваш объект Спального района.", tags:["service"], effects:{districtBonus:{district:"residential",value:1,perObject:true,excludeSelf:true}} },
  { id:"multifunctional_centre", title:"Многофункциональный центр", district:"residential", rarity:"rare", cost:9, income:2, influence:1, text:"+2$ пока вы Политик и +2$ пока вы Капиталист.", tags:["service","politics"], effects:{roleBonuses:[{role:"politician",value:2},{role:"capitalist",value:2}]} },
  { id:"city_block_complex", title:"Городской квартал-комплекс", district:"residential", rarity:"epic", cost:13, income:2, influence:1, text:"+1$ за каждый район, где у вас есть объект: Деловой центр, Промзона, Административный квартал.", tags:["infrastructure"], effects:{districtLinks:[{district:"business",value:1},{district:"industrial",value:1},{district:"government",value:1}]} },

  // Деловой центр (доп.).
  { id:"insurance_agency", title:"Страховое агентство", district:"business", rarity:"common", cost:5, income:3, influence:0, text:"Надёжный денежный поток без условий.", tags:["finance"] },
  { id:"trading_terminal", title:"Биржевой терминал", district:"business", rarity:"uncommon", cost:8, income:2, influence:1, text:"+2$ при наличии объекта Технокластера.", tags:["finance"], effects:{districtBonus:{district:"tech",value:2}} },
  { id:"board_of_directors", title:"Совет директоров", district:"business", rarity:"uncommon", cost:8, income:1, influence:2, text:"+1◆ за раунд при наличии Административного объекта.", tags:["finance","politics"], effects:{influenceBonus:{value:1,district:"government"}} },
  { id:"business_club", title:"Деловой клуб", district:"business", rarity:"rare", cost:9, income:2, influence:1, text:"+2$ пока вы Капиталист и +2$ пока вы Политик.", tags:["finance","politics"], effects:{roleBonuses:[{role:"capitalist",value:2},{role:"politician",value:2}]} },
  { id:"conglomerate_hq", title:"Штаб-квартира конгломерата", district:"business", rarity:"legendary", cost:17, income:1, influence:2, text:"+1$ за каждый район, где у вас есть объект: Спальный, Промзона, Технокластер, Административный, Серый сектор.", tags:["finance","infrastructure"], effects:{districtLinks:[{district:"residential",value:1},{district:"industrial",value:1},{district:"tech",value:1},{district:"government",value:1},{district:"shadows",value:1}]} },

  // Промзона (доп.).
  { id:"metal_base", title:"Металлобаза", district:"industrial", rarity:"common", cost:5, income:3, influence:0, text:"Недорогой промышленный доход без условий.", tags:["production"] },
  { id:"power_hub", title:"Энергоузел", district:"industrial", rarity:"uncommon", cost:8, income:3, influence:0, text:"+2$ при наличии объекта Технокластера.", tags:["energy"], effects:{districtBonus:{district:"tech",value:2}} },
  { id:"union_council", title:"Профсоюзный центр", district:"industrial", rarity:"uncommon", cost:8, income:2, influence:1, text:"+1◆ за раунд при наличии объекта Спального района.", tags:["production","politics"], effects:{influenceBonus:{value:1,district:"residential"}} },
  { id:"defence_contract", title:"Оборонный подряд", district:"industrial", rarity:"rare", cost:10, income:3, influence:1, text:"+2$ пока вы Силовик и +2$ пока вы Мафиози.", tags:["production","security"], effects:{roleBonuses:[{role:"military",value:2},{role:"mafia",value:2}]} },
  { id:"industrial_cluster", title:"Промышленный кластер", district:"industrial", rarity:"epic", cost:13, income:3, influence:0, text:"+1$ за каждый район, где у вас есть объект: Спальный, Деловой центр, Серый сектор.", tags:["production","infrastructure"], effects:{districtLinks:[{district:"residential",value:1},{district:"business",value:1},{district:"shadows",value:1}]} },

  // Технокластер (доп.).
  { id:"startup_cowork", title:"Коворкинг стартапов", district:"tech", rarity:"common", cost:5, income:2, influence:1, text:"Доступный технологический объект.", tags:["tech"] },
  { id:"data_hub", title:"Дата-хаб", district:"tech", rarity:"uncommon", cost:8, income:2, influence:1, text:"+2$ при наличии объекта Промзоны.", tags:["data"], effects:{districtBonus:{district:"industrial",value:2}} },
  { id:"fintech_accelerator", title:"Финтех-акселератор", district:"tech", rarity:"rare", cost:9, income:2, influence:1, text:"+2$ пока вы Аферист и +2$ пока вы Капиталист.", tags:["tech","finance"], effects:{roleBonuses:[{role:"fraudster",value:2},{role:"capitalist",value:2}]} },
  { id:"smart_city_platform", title:"Умный город-платформа", district:"tech", rarity:"epic", cost:13, income:2, influence:2, text:"+1$ за каждый район, где у вас есть объект: Спальный, Деловой центр, Административный квартал.", tags:["data","infrastructure"], effects:{districtLinks:[{district:"residential",value:1},{district:"business",value:1},{district:"government",value:1}]} },

  // Административный квартал (доп.).
  { id:"passport_office", title:"Паспортный стол", district:"government", rarity:"common", cost:5, income:1, influence:2, text:"Недорогой источник влияния.", tags:["government"] },
  { id:"city_prosecutor", title:"Городская прокуратура", district:"government", rarity:"uncommon", cost:8, income:2, influence:1, text:"+2$ при наличии объекта Серого сектора.", tags:["government"], effects:{districtBonus:{district:"shadows",value:2}} },
  { id:"analytics_bureau", title:"Аналитическое бюро", district:"government", rarity:"uncommon", cost:8, income:1, influence:2, text:"+1◆ за раунд при наличии объекта Технокластера.", tags:["data","government"], effects:{influenceBonus:{value:1,district:"tech"}} },
  { id:"licensing_department", title:"Департамент лицензий", district:"government", rarity:"rare", cost:10, income:2, influence:2, text:"+2$ пока вы Политик и +2$ пока вы Силовик.", tags:["government","security"], effects:{roleBonuses:[{role:"politician",value:2},{role:"military",value:2}]} },
  { id:"city_management_centre", title:"Центр городского управления", district:"government", rarity:"epic", cost:12, income:1, influence:2, text:"+1$ за каждый район, где у вас есть объект: Спальный, Деловой центр, Промзона, Технокластер.", tags:["government","infrastructure"], effects:{districtLinks:[{district:"residential",value:1},{district:"business",value:1},{district:"industrial",value:1},{district:"tech",value:1}]} },

  // Серый сектор (доп.).
  { id:"underground_casino", title:"Подпольное казино", district:"shadows", rarity:"common", cost:5, income:3, influence:0, text:"При покупке +1 скандал; высокий серый доход.", tags:["grey"] },
  { id:"cashout_office", title:"Обнальная контора", district:"shadows", rarity:"uncommon", cost:7, income:2, influence:0, text:"При покупке +1 скандал; +2$ при наличии объекта Делового центра.", tags:["grey","finance"], effects:{districtBonus:{district:"business",value:2}} },
  { id:"influence_broker", title:"Торговец компроматом", district:"shadows", rarity:"rare", cost:9, income:1, influence:2, text:"+1◆ за раунд при наличии Административного объекта; усиленный источник влияния.", tags:["grey","government"], effects:{influenceBonus:{value:1,district:"government"}} },
  { id:"protection_racket", title:"Крышевание бизнеса", district:"shadows", rarity:"rare", cost:9, income:2, influence:1, text:"При покупке +1 скандал; +2$ пока вы Мафиози и +2$ пока вы Силовик.", tags:["grey","security"], effects:{roleBonuses:[{role:"mafia",value:2},{role:"military",value:2}]} },
  { id:"shadow_logistics", title:"Теневая логистическая сеть", district:"shadows", rarity:"epic", cost:12, income:3, influence:0, text:"При покупке +1 скандал; +1$ за каждый район, где у вас есть объект: Промзона, Технокластер, Административный квартал.", tags:["grey","logistics"], effects:{districtLinks:[{district:"industrial",value:1},{district:"tech",value:1},{district:"government",value:1}]} },
];

export const ACTIONS: ActionCard[] = [
  { id:"audit", title:"Внеплановая проверка", tone:"attack", text:"Цель теряет 4$; если денег не хватает — получает скандал.", kind:"fine", value:4, targeted:true },
  { id:"leak", title:"Утечка данных", tone:"attack", text:"Цель получает 1 скандал.", kind:"scandal", value:1, targeted:true },
  { id:"hostile", title:"Враждебное поглощение", tone:"attack", text:"Цель теряет 3$, вы получаете 2$.", kind:"steal", value:3, targeted:true },
  { id:"vote", title:"Вотум недоверия", tone:"attack", text:"Владелец роли теряет 3◆; если влияния не хватает — теряет роль.", kind:"role_pressure", value:3, targeted:true },
  { id:"controlled_leak", title:"Контролируемая утечка", tone:"attack", text:"Вы получаете 1 скандал, цель — 2 скандала.", kind:"double_scandal", value:2, targeted:true },
  { id:"blackmail", title:"Политический шантаж", tone:"attack", text:"Цель теряет 2◆, вы получаете 1◆.", kind:"blackmail", value:2, targeted:true },
  { id:"asset_freeze", title:"Заморозка активов", tone:"attack", text:"Самый доходный объект цели блокируется до выплаты.", kind:"freeze", value:1, targeted:true },
  { id:"leader_expose", title:"Разоблачение лидера", tone:"attack", text:"Цель получает скандал; если это лидер, вы получаете 2◆.", kind:"expose", value:2, targeted:true },
  { id:"antitrust", title:"Антимонопольное предписание", tone:"attack", text:"Цель теряет одно улучшение на самом ценном объекте.", kind:"remove_upgrade", value:1, targeted:true },
  { id:"disinformation", title:"Информационная диверсия", tone:"attack", text:"Цель теряет 2$ и 1◆.", kind:"mixed_fine", value:2, targeted:true },
  { id:"kompromat", title:"Компромат", tone:"attack", text:"Цель получает 2 скандала.", kind:"scandal", value:2, targeted:true },
  { id:"surveillance", title:"Наружное наблюдение", tone:"attack", text:"Цель получает 1 скандал.", kind:"scandal", value:1, targeted:true },
  { id:"smear_campaign", title:"Информационная кампания", tone:"attack", text:"Вы получаете 1 скандал, цель — 2 скандала.", kind:"double_scandal", value:2, targeted:true },
  { id:"antitrust_probe", title:"Антимонопольное расследование", tone:"attack", text:"В этот раунд объекты каждого игрока в районах, где у него 4+ объектов, приносят вдвое меньше.", kind:"antitrust", value:1 },

  { id:"grant", title:"Инновационный грант", tone:"deal", text:"Получите 7$; если есть объект с ИИ — ещё 1◆.", kind:"grant", value:7 },
  { id:"bridge_loan", title:"Мостовой кредит", tone:"deal", text:"Получите 10$ сейчас и выплатите 4$ в конце раунда.", kind:"bridge_loan", value:10 },
  { id:"tender", title:"Городской тендер", tone:"deal", text:"Получите по 2$ за свой объект выбранного района, максимум 10$.", kind:"district_cash", value:2 },
  { id:"campaign", title:"Медийная кампания", tone:"deal", text:"Потратьте 2$ и получите 4◆.", kind:"influence", value:4 },
  { id:"market_subsidy", title:"Инвестиционная субсидия", tone:"deal", text:"Следующая покупка объекта в этом ходу дешевле на 4$.", kind:"market_discount", value:4 },
  { id:"upgrade_subsidy", title:"Срочная модернизация", tone:"deal", text:"Следующее улучшение объекта в этом ходу дешевле на 4$.", kind:"upgrade_discount", value:4 },
  { id:"zoning", title:"Изменение зонирования", tone:"deal", text:"Выбранный район считается имеющим на один ваш объект больше до выплаты.", kind:"zoning", value:1 },
  { id:"infrastructure", title:"Инфраструктурный грант", tone:"deal", text:"Бесплатно развейте выбранный район и получите 2◆, если у вас там есть 2 объекта.", kind:"develop", value:2 },
  { id:"temporary_mandate", title:"Временный мандат", tone:"deal", text:"Получите пассив выбранной роли до конца текущего хода.", kind:"copy_role", value:1 },
  { id:"mobilization", title:"Мобилизация ресурсов", tone:"deal", text:"Получите +2 обычных действия прямо сейчас.", kind:"extra_action", value:2 },
  { id:"investor_call", title:"Закрытый раунд инвесторов", tone:"deal", text:"Получите +2 инвестиционных действия прямо сейчас.", kind:"investment_action", value:2 },
  { id:"bailout", title:"Антикризисная помощь", tone:"deal", text:"Получите 9$, если вы последний; иначе получите 3$.", kind:"comeback", value:9 },
  { id:"tax_manoeuvre", title:"Налоговый манёвр", tone:"deal", text:"Обменяйте 2◆ на 8$.", kind:"influence_to_cash", value:8 },
  { id:"urban_project", title:"Общественная инициатива", tone:"deal", text:"Получите 1 городской проект без дополнительной оплаты.", kind:"project", value:1 },

  { id:"lawyers", title:"Корпоративные юристы", tone:"defence", text:"Снимите 2 скандала.", kind:"clean", value:2 },
  { id:"insurance", title:"Страховой контур", tone:"defence", text:"Получите 1 Крышу в пределах своего лимита.", kind:"roof", value:1 },
  { id:"injunction", title:"Судебный запрет", tone:"defence", text:"Следующая попытка отобрать вашу роль автоматически отменяется.", kind:"role_shield", value:1 },
  { id:"reputation_reserve", title:"Репутационный резерв", tone:"defence", text:"Следующее получение скандалов полностью отменяется.", kind:"scandal_shield", value:1 },
  { id:"evidence", title:"Уничтожение доказательств", tone:"defence", text:"Снимите 3 скандала и потеряйте 2◆.", kind:"deep_clean", value:3 },
  { id:"emergency_management", title:"Аварийное управление", tone:"defence", text:"Разблокируйте свой самый доходный заблокированный объект.", kind:"unblock", value:1 },
];

// Событие выбирается один раз на всю партию: это фоновый режим города, а не
// случайный ход-за-ходом хаос. Все эффекты глобальны и не привязаны к роли —
// каждый игрок затронут одинаково, что бы он ни строил.
export const EVENTS: EventCard[] = [
  { id:"boom", title:"Экономический бум", text:"Город на подъёме: каждый управляемый объект приносит +1$ в раунд.", globalIncome:1 },
  { id:"land_reform", title:"Земельная реформа", text:"Земля подешевела: все объекты на рынке стоят на 2$ дешевле.", globalMarketDiscount:2 },
  { id:"digital_shift", title:"Цифровой переход", text:"Модернизация ускоряется: каждый объект приносит +1$, но стоит на 1$ дороже.", globalIncome:1, globalMarketDiscount:-1 },
  { id:"cheap_credit", title:"Дешёвый кредит", text:"Банки раздают деньги: все объекты стоят на 1$ дешевле.", globalMarketDiscount:1 },
  { id:"tight_money", title:"Дорогие деньги", text:"Ставки высоки: объекты дороже на 1$, но конкуренция ниже — каждый объект приносит +1$.", globalIncome:1, globalMarketDiscount:-1 },
  { id:"stable_year", title:"Год стабильности", text:"Спокойный деловой климат без потрясений: город работает в обычном режиме." },
];
