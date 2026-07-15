import type { AssetMeta, CityMeta, EventMeta, RoleMeta } from "./types";
import { rarityLabels } from "./gameUi";

// ---------------------------------------------------------------------------
// Полный свод правил «Города влияния».
//
// Документ полностью управляется данными из каталога (meta) плюс жёсткими
// числами движка, собранными в одном месте. Открывается в отдельной вкладке,
// чтобы игрок мог держать правила рядом с партией.
// ---------------------------------------------------------------------------

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));

const rarityOrder: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

const rarityIncome: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 4, legendary: 6 };

// Соответствие «район → роль», получающая синергию сектора (+1$).
const districtRole: Record<string, string> = {
  business: "capitalist",
  residential: "politician",
  tech: "fraudster",
  shadows: "mafia",
  industrial: "military",
};

function money(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value)}$`;
}

function assetEffectSummary(asset: AssetMeta, meta: CityMeta): string {
  const effects = (asset.effects ?? {}) as Record<string, unknown>;
  const districtTitle = (id: string): string => meta.districts.find(item => item.id === id)?.title ?? id;
  const roleTitle = (id: string): string => meta.roles.find(item => item.id === id)?.title ?? id;
  const parts: string[] = [];
  const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));

  const eventBonus = effects.eventBonus as { eventId: string; value: number } | undefined;
  if (eventBonus) {
    const title = meta.events.find(item => item.id === eventBonus.eventId)?.title ?? eventBonus.eventId;
    parts.push(`${money(eventBonus.value)} во время события «${title}»`);
  }
  const influenceBonus = effects.influenceBonus as { value: number; district?: string; role?: string } | undefined;
  if (influenceBonus) {
    const cond = [
      influenceBonus.district ? `объект «${districtTitle(influenceBonus.district)}»` : "",
      influenceBonus.role ? `роль «${roleTitle(influenceBonus.role)}»` : "",
    ].filter(Boolean).join(" и ");
    parts.push(`+${influenceBonus.value}◆/раунд${cond ? ` при наличии ${cond}` : ""}`);
  }
  const districtBonus = effects.districtBonus as
    | { district: string; value: number; perObject?: boolean; excludeSelf?: boolean; virtualRole?: string }
    | undefined;
  if (districtBonus) {
    parts.push(districtBonus.perObject
      ? `${money(districtBonus.value)} за каждый объект «${districtTitle(districtBonus.district)}»`
      : `${money(districtBonus.value)} при наличии объекта «${districtTitle(districtBonus.district)}»`);
  }
  const roleBonus = effects.roleBonus as { role: string; value: number } | undefined;
  if (roleBonus) parts.push(`${money(roleBonus.value)} пока вы «${roleTitle(roleBonus.role)}»`);
  for (const bonus of (effects.roleBonuses as { role: string; value: number }[] | undefined) ?? []) {
    parts.push(`${money(bonus.value)} пока вы «${roleTitle(bonus.role)}»`);
  }
  for (const link of (effects.districtLinks as { district: string; value: number }[] | undefined) ?? []) {
    parts.push(`${money(link.value)} при наличии «${districtTitle(link.district)}»`);
  }
  if (num(effects.maintenanceReduction)) parts.push(`первые ${num(effects.maintenanceReduction)} объектов без содержания`);
  if (num(effects.extraActions)) parts.push(`+1 обычное действие каждый ход`);
  if (num(effects.extraInvestmentActions)) parts.push(`+1 инвестиционное действие каждый ход`);
  if (num(effects.turnRoof)) parts.push(`+1 Крыша в начале хода`);
  if (num(effects.roofCapacity)) parts.push(`+${num(effects.roofCapacity)} к пределу Крыш`);
  if (num(effects.scandalReduction)) parts.push(`−${num(effects.scandalReduction)} скандал в начале хода`);
  if (num(effects.greyScandalReduction)) parts.push(`−${num(effects.greyScandalReduction)} скандала от серых операций`);
  if (num(effects.carryAction)) parts.push(`переносит 1 действие на следующий ход`);
  if (num(effects.takeoverCompensation)) parts.push(`+${num(effects.takeoverCompensation)}◆ при перехвате роли`);
  if (num(effects.developmentDiscount)) parts.push(`−${num(effects.developmentDiscount)}$ к развитию района`);
  const purchase = effects.purchase as
    | { money?: number; influence?: number; roofs?: number; card?: boolean; scandals?: number }
    | undefined;
  if (purchase) {
    const bits: string[] = [];
    if (purchase.money) bits.push(money(purchase.money));
    if (purchase.influence) bits.push(`+${purchase.influence}◆`);
    if (purchase.roofs) bits.push(`+${purchase.roofs} Крыша`);
    if (purchase.card) bits.push(`карта действия`);
    if (purchase.scandals) bits.push(`+${purchase.scandals} скандал`);
    if (bits.length) parts.push(`при покупке: ${bits.join(", ")}`);
  }
  return parts.length ? parts.join("; ") : "Стабильный доход без дополнительных условий.";
}

interface RolePowerGuide {
  name: string;
  cost: string;
  limit: string;
  effect: string;
  use: string;
}

interface RoleGuide {
  style: string;
  perks: string[];
  powers: RolePowerGuide[];
  advice: string;
  warning?: string;
}

const roleGuides: Record<string, RoleGuide> = {
  capitalist: {
    style: "Экономическая роль для быстрого расширения бизнеса и превращения влияния в темп покупок.",
    perks: [
      "<b>Профильный район — Деловой центр.</b> Каждый ваш активный объект этого района получает +1$ к доходу. У автоматизированного объекта этот ролевой бонус удваивается.",
      "<b>Освоение нового района.</b> Первый фактический объект в каждом ещё пустом для вас районе стоит на 1$ дешевле, но итоговая цена не может стать ниже 1$.",
      "<b>Деловые связи.</b> Для условий объектов считается, что связь с Деловым центром у вас есть всегда — даже пока вы не купили там объект.",
    ],
    powers: [{
      name: "Ускоренное финансирование",
      cost: "3◆, без обычного действия",
      limit: "1 раз за ход",
      effect: "Вы получаете +1 инвестиционное действие.",
      use: "Инвестиционное действие можно потратить на покупку объекта, дополнительного слота или улучшение объекта. Оно не подходит для продажи, развития района, покупки карты или другого обычного действия.",
    }],
    advice: "Берите роль перед серией покупок: скидка помогает открыть новые районы, а финансирование позволяет вложить влияние в ещё одну инвестицию в том же ходу.",
  },
  politician: {
    style: "Роль контроля города: стабильно производит влияние, зарабатывает на общей застройке и безопасно снимает скандалы.",
    perks: [
      "<b>Профильный район — Спальный район.</b> Каждый ваш активный жилой объект получает +1$ к доходу; автоматизация удваивает этот ролевой бонус.",
      "<b>Административные связи.</b> Условия объектов, требующие связь с Административным кварталом, всегда считаются выполненными.",
      "<b>Пассивное влияние в конце раунда.</b> Политик получает базовые +1◆, ещё +1◆ за каждые 2 активных жилых объекта и +1◆ за каждый активный административный объект. Автоматизированный административный объект считается за два для этого бонуса.",
    ],
    powers: [
      {
        name: "Налог района",
        cost: "4◆, без обычного действия",
        limit: "1 раз за ход",
        effect: "Выберите район и получите по 1$ за каждый объект всех игроков в этом районе.",
        use: "Сначала сравните заполненность районов на поле. Деньги начисляются сразу; способность недоступна, если в выбранном районе нет ни одного объекта.",
      },
      {
        name: "Политическая очистка",
        cost: "2◆, без обычного действия",
        limit: "1 раз за ход, отдельно от Налога",
        effect: "Снимите 1 свой скандал.",
        use: "Обе способности Политика можно применить в одном ходу, если хватает влияния. Очистку выгодно использовать до действия, способного довести вас до 5 скандалов.",
      },
    ],
    advice: "Политик особенно силён в длинной партии: административные объекты и жилые пары создают постоянный поток влияния, которое затем превращается в налоги, роли и городские проекты.",
  },
  journalist: {
    style: "Роль управления скандалами: чужая репутационная война приносит Журналисту деньги и влияние.",
    perks: [
      "<b>Доход от повестки.</b> В конце раунда Журналист получает столько долларов, сколько скандалов суммарно находится у всех соперников.",
      "<b>Собственный рейтинг.</b> В конце раунда каждый собственный скандал даёт +1◆, максимум +4◆.",
      "<b>Новости раунда.</b> Журналист получает +1◆ за каждый скандал, полученный соперниками в текущем раунде, максимум +2◆. При наличии объекта «Платформа городских данных» предел повышается до +3◆.",
      "У Журналиста нет профильного района: его экономика строится вокруг состояния игроков, а не конкретного сектора.",
    ],
    powers: [
      {
        name: "Раздуть скандал",
        cost: "без ресурсов и без обычного действия",
        limit: "1 раз за ход",
        effect: "Вы и выбранный соперник получаете по 1 скандалу.",
        use: "Это быстрый способ поднять будущий рейтинг и одновременно приблизить соперника к потере роли. Проверяйте свой предел: при 5 скандалах роль немедленно теряется.",
      },
      {
        name: "Публикация",
        cost: "3◆, без обычного действия",
        limit: "1 раз за ход, отдельно от Раздуть скандал",
        effect: "Выбранный соперник получает 1 скандал.",
        use: "Обе способности разрешено применить в одном ходу и выбрать одну или разные цели. Публикация безопаснее для собственной репутации, но требует влияния.",
      },
    ],
    advice: "Поддерживайте у соперников несколько скандалов, не обязательно сразу доводя их до тюрьмы: накопленные скандалы каждый раунд продолжают приносить вам деньги.",
    warning: "Щит от скандала может полностью поглотить начисление. При 5 собственных скандалах Журналист теряет роль и перестаёт получать её бонусы в конце раунда.",
  },
  fraudster: {
    style: "Высокорисковая роль камбэка: получает больше действий, усиливает серые операции и временно копирует другие роли.",
    perks: [
      "<b>Четыре действия.</b> В начале обычного хода владелец роли получает 4 базовых действия вместо 3.",
      "<b>Профильный район — Технокластер.</b> Каждый активный объект Технокластера получает +1$ к доходу; автоматизация удваивает этот ролевой бонус.",
      "<b>Мастер серых операций.</b> За 2-е место в рейтинге шанс успеха повышается на 5 п.п., за 3-е — на 10 п.п., за 4-е и ниже — на 20 п.п. Каждый объект Технокластера добавляет ещё 5 п.п., максимум +10 п.п.; итоговый шанс не выше 90%.",
      "<b>Камбэк.</b> При успешной серой операции отстающий Аферист получает дополнительную прибыль: ⌊(место − 1) × раунд / 3⌋$. При провале любой серой операции роль снижает базовое начисление до 1 скандала до бонусов объектов.",
    ],
    powers: [
      {
        name: "Очистка следов",
        cost: "1 обычное действие",
        limit: "можно повторять, пока есть действия и скандалы",
        effect: "Снимите 1 свой скандал.",
        use: "В отличие от большинства ролевых способностей, очистка не ограничена одним применением за ход.",
      },
      {
        name: "Криптоскам",
        cost: "1 обычное действие; нужна активная «Городская криптобиржа»",
        limit: "1 раз за ход",
        effect: "Выберите число от 1 до 6. У каждого соперника крадётся до указанной суммы, а вы получаете всю собранную сумму и столько же скандалов за вычетом эффектов снижения скандалов.",
        use: "Сумма применяется к каждому сопернику отдельно: выбор 3 может принести до 9$ в партии на четверых. До подтверждения проверьте итоговые скандалы — большое значение способно сразу лишить роли или отправить в тюрьму.",
      },
      {
        name: "Подделка документов",
        cost: "1 обычное действие, 5◆ и +2 скандала",
        limit: "1 раз за ход",
        effect: "Выберите любую роль. В начале следующего своего хода вы получите её временную копию дополнительно к Аферисту; копия действует один ход и открывает пассивы и способности выбранной роли.",
        use: "Подделка не отбирает роль у владельца. Если добавленные скандалы доведут вас до 5 или 6, текущая роль и подготовленная копия будут потеряны.",
      },
    ],
    advice: "Выбирайте размер риска до команды: Аферист силён не максимальной ставкой, а серией выгодных операций с заранее подготовленной защитой и очисткой.",
  },
  mafia: {
    style: "Роль территориального контроля: усиливает Серый сектор, экономит Крыши и забирает часть дохода районных меньшинств.",
    perks: [
      "<b>Профильный район — Серый сектор.</b> Каждый активный объект Серого сектора получает +1$ к доходу; автоматизация удваивает этот ролевой бонус.",
      "<b>Крыша.</b> Для Мафиози Крыша стоит 2$ вместо 3$, а базовый предел хранения равен 2 вместо 1.",
      "<b>Дань в конце раунда.</b> Если у Мафиози строго больше объектов в районе, чем у каждого соперника, он контролирует район. С каждого соперника с меньшим присутствием удерживается до 2$ за каждый его активный объект этого района — но не больше положительного дохода жертвы за раунд. Вся удержанная сумма переходит Мафиози.",
    ],
    powers: [
      {
        name: "Рэкет",
        cost: "1 обычное действие; нужен активный объект Серого сектора",
        limit: "1 раз за ход",
        effect: "Выбранный соперник передаёт деньги и иногда влияние. Денежное требование: 2 + ваши объекты Серого сектора + жилые объекты + ⌊раунд/2⌋, ещё +3 против лидера и +1 после успешной серой операции в этом ходу. Влияние: до 1◆ за каждый ваш административный объект.",
        use: "Если у цели есть Крыша, она расходуется и полностью отменяет рэкет. Если у Мафиози нет административного объекта, после успешного взыскания он получает +1 скандал.",
      },
      {
        name: "Сжечь связи",
        cost: "1 обычное действие и 1 собственная Крыша",
        limit: "1 раз за ход",
        effect: "Все игроки, включая Мафиози, теряют по 1 Крыше.",
        use: "Применяйте перед рэкетом или атаками союзников, когда у соперников накоплена защита. Для запуска у вас должна быть хотя бы одна Крыша.",
      },
      {
        name: "Замять дело",
        cost: "1 Крыша либо 3$ при наличии административного объекта; обычное действие не тратится",
        limit: "1 раз за ход",
        effect: "Снимите до 2 собственных скандалов.",
        use: "При одном скандале снимается один. Способ оплаты выбирается при применении; денежный вариант недоступен без административного объекта.",
      },
    ],
    advice: "Сначала закрепляйте численное преимущество в одном-двух районах, затем лишайте соперников Крыш и давите лидера усиленным рэкетом.",
  },
  military: {
    style: "Роль точечного наказания: превращает скандалы соперников в деньги или конфискованные объекты.",
    perks: [
      "<b>Профильный район — Промзона.</b> Каждый активный промышленный объект получает +1$ к доходу; автоматизация удваивает этот ролевой бонус.",
      "Силовик не создаёт скандалы сам — он использует уже накопленные скандалы цели как основание для санкций.",
    ],
    powers: [{
      name: "Санкции",
      cost: "1 обычное действие",
      limit: "1 раз за ход; цель должна иметь минимум 2 скандала",
      effect: "Сначала проверяется защита. При наличии Крыши цель теряет её и больше ничего не отдаёт. Без Крыши цель с 2–3 скандалами передаёт до (3 + номер раунда)$; при 4–5 скандалах и наличии более одного объекта конфискуется её самый ценный объект. После любого исхода цель теряет 1 скандал.",
      use: "Если конфискованный объект помещается в ваши слоты, он переходит к вам. При заполненных слотах движок сравнит его с вашим самым слабым объектом: более ценный останется, второй будет обращён в деньги по игровой стоимости.",
    }],
    advice: "Следите за хроникой и атакуйте сразу после того, как цель набрала нужный уровень скандалов. На 4+ скандалах санкция потенциально намного сильнее денежного взыскания.",
    warning: "Если у цели 4+ скандала, но всего один объект, конфискации не будет: способность всё равно потратит действие и снимет цели 1 скандал.",
  },
};

function roleSection(role: RoleMeta): string {
  const guide = roleGuides[role.id];
  if (!guide) return `
    <article class="role-card" style="--role:${escapeHtml(role.color)}">
      <h3>${escapeHtml(role.icon)} ${escapeHtml(role.title)}</h3>
      <p><b>Пассивно:</b> ${escapeHtml(role.passive)}</p>
      <p><b>Способность:</b> ${escapeHtml(role.power)}</p>
    </article>`;
  return `
    <article class="role-card" style="--role:${escapeHtml(role.color)}">
      <header class="role-card-head"><h3>${escapeHtml(role.icon)} ${escapeHtml(role.title)}</h3><p>${guide.style}</p></header>
      <div class="role-details">
        <div class="role-perks"><h4>Постоянные бонусы</h4><ul>${guide.perks.map(perk => `<li>${perk}</li>`).join("")}</ul></div>
        <div class="role-powers-guide"><h4>Активные способности</h4>${guide.powers.map(power => `
          <div class="role-power-guide">
            <h5>${power.name}</h5>
            <p class="role-power-meta"><span><b>Цена:</b> ${power.cost}</span><span><b>Лимит:</b> ${power.limit}</span></p>
            <p><b>Эффект:</b> ${power.effect}</p>
            <p><b>Как применять:</b> ${power.use}</p>
          </div>`).join("")}</div>
      </div>
      <p class="role-advice"><b>Стратегия:</b> ${guide.advice}</p>
      ${guide.warning ? `<p class="role-warning"><b>Важно:</b> ${guide.warning}</p>` : ""}
    </article>`;
}

function assetRow(asset: AssetMeta, meta: CityMeta): string {
  return `
    <tr class="rarity-${escapeHtml(asset.rarity)}">
      <td class="name"><b>${escapeHtml(asset.title)}</b><span class="badge">${escapeHtml(rarityLabels[asset.rarity] ?? asset.rarity)}</span></td>
      <td class="num">${asset.cost}$</td>
      <td class="num">${asset.income}$</td>
      <td class="num">${asset.influence}◆</td>
      <td class="effect">${escapeHtml(assetEffectSummary(asset, meta))}</td>
    </tr>`;
}

function districtAssetTables(meta: CityMeta): string {
  return meta.districts.map(district => {
    const assets = meta.assets
      .filter(asset => asset.district === district.id)
      .sort((a, b) => (rarityOrder[a.rarity] ?? 0) - (rarityOrder[b.rarity] ?? 0) || a.cost - b.cost);
    if (!assets.length) return "";
    const role = meta.roles.find(item => item.id === districtRole[district.id]);
    const roleNote = role ? ` Профильная роль: <b>${escapeHtml(role.title)}</b> (+1$ к каждому объекту сектора).` : "";
    return `
      <h3 style="--district:${escapeHtml(district.color)}">${escapeHtml(district.icon)} ${escapeHtml(district.title)}</h3>
      <p class="district-desc">${escapeHtml(district.description)}${roleNote}</p>
      <table class="assets">
        <thead><tr><th>Объект</th><th>Цена</th><th>Доход</th><th>◆</th><th>Условия и бонусы</th></tr></thead>
        <tbody>${assets.map(asset => assetRow(asset, meta)).join("")}</tbody>
      </table>`;
  }).join("");
}

function cardRows(meta: CityMeta): string {
  const toneLabels: Record<string, string> = { deal: "Сделка", attack: "Атака", defence: "Защита" };
  return meta.action_cards.map(card => `
    <tr class="tone-${escapeHtml(card.tone)}">
      <td class="name"><b>${escapeHtml(card.title)}</b></td>
      <td>${escapeHtml(toneLabels[card.tone] ?? card.tone)}</td>
      <td>${card.targeted ? "по цели" : "на себя"}</td>
      <td class="effect">${escapeHtml(card.text)}</td>
    </tr>`).join("");
}

function eventRows(events: EventMeta[]): string {
  return events.map(event => {
    const effects: string[] = [];
    if (event.globalIncome) effects.push(`каждый объект ${money(event.globalIncome)}/раунд`);
    if (event.globalMarketDiscount) effects.push(event.globalMarketDiscount > 0
      ? `объекты дешевле на ${event.globalMarketDiscount}$`
      : `объекты дороже на ${Math.abs(event.globalMarketDiscount)}$`);
    return `
      <tr>
        <td class="name"><b>${escapeHtml(event.title)}</b></td>
        <td>${escapeHtml(event.text)}</td>
        <td class="effect">${effects.length ? escapeHtml(effects.join("; ")) : "—"}</td>
      </tr>`;
  }).join("");
}

export function buildRulesHtml(meta: CityMeta, rolePrice: number): string {
  const rarityLegend = Object.entries(rarityIncome)
    .map(([rarity, value]) => `${rarityLabels[rarity] ?? rarity} +${value}`)
    .join(" · ");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Город влияния — Правила</title>
<style>
  :root { color-scheme: dark; --bg:#0b111a; --panel:#131c28; --panel2:#0f1722; --border:#243040; --text:#e6edf5; --dim:#93a2b6; --accent:#58a6ff; --good:#4dd58a; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 80px; background: radial-gradient(circle at 50% -10%, #17293e, var(--bg) 45%); color: var(--text); font: 15px/1.6 "Segoe UI", system-ui, sans-serif; }
  header.hero { padding: 40px 24px 28px; text-align: center; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, rgba(88,166,255,.08), transparent); }
  header.hero h1 { margin: 0 0 8px; font-size: 34px; }
  header.hero p { margin: 0 auto; max-width: 760px; color: var(--dim); }
  .layout { display: grid; grid-template-columns: 240px 1fr; gap: 28px; max-width: 1180px; margin: 0 auto; padding: 26px 24px; }
  nav.toc { position: sticky; top: 18px; align-self: start; padding: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; font-size: 14px; }
  nav.toc h2 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
  nav.toc a { display: block; padding: 5px 8px; color: var(--text); text-decoration: none; border-radius: 6px; }
  nav.toc a:hover { background: var(--panel2); color: var(--accent); }
  main { min-width: 0; }
  section { margin: 0 0 34px; padding: 22px 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; scroll-margin-top: 18px; }
  section > h2 { margin: 0 0 14px; padding-bottom: 10px; font-size: 22px; border-bottom: 1px solid var(--border); }
  h3 { margin: 18px 0 8px; font-size: 16px; }
  p { margin: 0 0 10px; }
  ul, ol { margin: 0 0 12px; padding-left: 22px; }
  li { margin: 4px 0; }
  b, strong { color: #fff; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .box { padding: 14px; background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; }
  .box h4 { margin: 0 0 6px; font-size: 14px; }
  .tip { margin-top: 10px; padding: 12px 14px; background: rgba(77,213,138,.08); border-left: 3px solid var(--good); border-radius: 8px; color: #c6ecd5; font-size: 14px; }
  .tip b { color: var(--good); }
  .warn { margin-top: 10px; padding: 12px 14px; background: rgba(248,81,73,.08); border-left: 3px solid #f85149; border-radius: 8px; color: #ffc7c3; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 13px; }
  th, td { padding: 7px 9px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--dim); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.name { white-space: nowrap; }
  td.name .badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 10px; color: #05070c; background: var(--rarity, #8b949e); vertical-align: middle; }
  td.effect { color: var(--dim); }
  tr.rarity-common { --rarity:#adb6c2; } tr.rarity-uncommon { --rarity:#3fb950; } tr.rarity-rare { --rarity:#4c9dff; } tr.rarity-epic { --rarity:#c07cff; } tr.rarity-legendary { --rarity:#ffa23e; }
  tr[class*="rarity-"] td.name b { color: color-mix(in srgb, var(--rarity), #fff 25%); }
  tr.tone-deal td.name b { color: #6be29a; } tr.tone-attack td.name b { color: #ff8f88; } tr.tone-defence td.name b { color: #79b8ff; }
  .role-grid { display: grid; grid-template-columns: 1fr; gap: 18px; }
  .role-card { padding: 18px; background: var(--panel2); border: 1px solid var(--border); border-left: 5px solid var(--role); border-radius: 12px; }
  .role-card-head { margin: -18px -18px 16px; padding: 16px 18px 14px; background: color-mix(in srgb, var(--role), transparent 91%); border-bottom: 1px solid color-mix(in srgb, var(--role), transparent 62%); border-radius: 8px 11px 0 0; }
  .role-card-head h3 { margin: 0 0 5px; color: var(--role); font-size: 21px; }
  .role-card-head p { margin: 0; color: var(--dim); font-size: 14px; }
  .role-details { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 18px; }
  .role-card h4 { margin: 0 0 9px; color: var(--role); font-size: 14px; text-transform: uppercase; letter-spacing: .04em; }
  .role-card h5 { margin: 0 0 7px; color: #fff; font-size: 15px; }
  .role-card p, .role-card li { font-size: 13px; line-height: 1.5; }
  .role-perks ul { margin: 0; padding-left: 19px; }
  .role-perks li { margin-bottom: 9px; }
  .role-power-guide { margin-bottom: 9px; padding: 11px 12px; background: #0b131e; border: 1px solid color-mix(in srgb, var(--role), transparent 68%); border-radius: 8px; }
  .role-power-guide p { margin: 5px 0 0; }
  .role-power-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; color: var(--dim); }
  .role-power-meta span { padding: 5px 7px; background: rgba(255,255,255,.025); border-radius: 5px; }
  .role-advice, .role-warning { margin: 12px 0 0 !important; padding: 10px 12px; border-radius: 7px; }
  .role-advice { color: #c6ecd5; background: rgba(77,213,138,.07); border-left: 3px solid var(--good); }
  .role-warning { color: #ffc7c3; background: rgba(248,81,73,.07); border-left: 3px solid #f85149; }
  .district-desc { color: var(--dim); font-size: 13px; }
  h3[style*="--district"] { color: var(--district); }
  .kpi { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0; }
  .kpi div { padding: 12px; text-align: center; background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; }
  .kpi b { display: block; font-size: 22px; color: var(--accent); }
  .kpi span { font-size: 12px; color: var(--dim); }
  code { padding: 1px 5px; background: #0a0f16; border: 1px solid var(--border); border-radius: 5px; font-size: 13px; }
  footer { max-width: 1180px; margin: 0 auto; padding: 0 24px; color: var(--dim); font-size: 12px; text-align: center; }
  @media (max-width: 700px) {
    body { padding-bottom: 40px; font-size: 14px; line-height: 1.55; }
    header.hero { padding: 72px 16px 20px; }
    header.hero h1 { font-size: 26px; }
    header.hero p { font-size: 13px; }
    .layout { display: block; padding: 12px 10px; }
    nav.toc { position: static; margin-bottom: 12px; padding: 12px; }
    nav.toc a { padding: 6px 4px; }
    section { margin-bottom: 14px; padding: 14px 12px; border-radius: 10px; }
    section > h2 { font-size: 19px; }
    .cols, .role-grid, .kpi, .role-details, .role-power-meta { grid-template-columns: 1fr; }
    .box, .role-card { padding: 11px; }
    .role-card-head { margin: -11px -11px 12px; padding: 12px 11px; }
    .role-card-head h3 { font-size: 19px; }
    .role-power-guide { padding: 10px; }
    table { display: block; max-width: 100%; overflow-x: auto; font-size: 12px; -webkit-overflow-scrolling: touch; }
    th, td { padding: 6px 7px; }
    td.name { white-space: normal; min-width: 150px; }
    td.effect { min-width: 220px; }
    footer { padding: 0 12px; }
  }
</style>
</head>
<body>
<header class="hero">
  <h1>🏙️ Город влияния</h1>
  <p>Полный свод правил, механик и цифр. Соберите больше очков, чем соперники: стройте бизнес-империю, боритесь за роли, манипулируйте скандалами и рынком. Держите эту вкладку рядом с игрой.</p>
</header>
<div class="layout">
  <nav class="toc">
    <h2>Содержание</h2>
    <a href="#goal">1. Цель и очки</a>
    <a href="#flow">2. Ход и раунд</a>
    <a href="#resources">3. Ресурсы</a>
    <a href="#economy">4. Экономика объектов</a>
    <a href="#districts">5. Районы и синергии</a>
    <a href="#roles">6. Роли</a>
    <a href="#grey">7. Серые операции</a>
    <a href="#scandals">8. Скандалы и тюрьма</a>
    <a href="#roofs">9. Крыша и защита</a>
    <a href="#cards">10. Карты действий</a>
    <a href="#events">11. События</a>
    <a href="#catalog">12. Каталог объектов</a>
    <a href="#strategy">13. Стратегия</a>
  </nav>
  <main>
    <section id="goal">
      <h2>1. Цель и подсчёт очков</h2>
      <p>Партия длится фиксированное число раундов. Побеждает игрок с наибольшим счётом на момент финала. Счёт считается так:</p>
      <ul>
        <li><b>Деньги</b> — 1 очко за 1$.</li>
        <li><b>Влияние ◆</b> — 1 очко за 1◆.</li>
        <li><b>Объекты</b> — половина цены объекта (округление вниз) + по 2 очка за автоматизацию и за модернизацию.</li>
        <li><b>Городские проекты</b> — по 6 очков каждый.</li>
        <li><b>Роль</b> — +3 очка, если в финале у вас есть роль.</li>
        <li><b>Скандалы ⚠</b> — минус 1 очко за каждый.</li>
      </ul>
      <div class="tip"><b>Практика:</b> очки «спрятаны» в объектах и проектах. Деньги на руках — самый ликвидный, но и самый уязвимый ресурс (их отбирают рэкет, санкции и карты). Ближе к финалу конвертируйте кэш в объекты, проекты и улучшения.</div>
    </section>

    <section id="flow">
      <h2>2. Структура хода и раунда</h2>
      <p>Игроки ходят по кругу в фиксированном порядке; стартовый игрок раунда выбирается случайно в начале партии. За свой ход вы тратите <b>действия</b>:</p>
      <div class="kpi">
        <div><b>3</b><span>обычных действия у большинства ролей</span></div>
        <div><b>4</b><span>действия у Афериста</span></div>
        <div><b>+1</b><span>инвестиционное действие (от объектов/способностей)</span></div>
        <div><b>1</b><span>действие в ход после тюрьмы</span></div>
      </div>
      <p><b>Обычные действия</b> тратятся на что угодно: город, роли, карты, серые операции, защиту, покупки. <b>Инвестиционные действия</b> — только на покупку объектов, слотов и улучшений (автоматизация/модернизация).</p>
      <p>Когда все сходили, наступает <b>выплата раунда</b>: объекты приносят доход, списывается содержание, начисляется пассивное влияние, срабатывают роли (дань Мафии, доход Журналиста), гасится мостовой кредит. Затем открывается новый раунд, обновляется рынок карт и часть рынка объектов.</p>
      <div class="tip"><b>Практика:</b> не «сжигайте» ход базовым заказом на +2$, если можно вложиться в объект — экономический двигатель окупается каждый раунд. Базовый заказ хорош лишь чтобы добрать монеты до нужной покупки.</div>
    </section>

    <section id="resources">
      <h2>3. Ресурсы</h2>
      <div class="cols">
        <div class="box"><h4>💵 Деньги ($)</h4><p>Универсальная валюта покупок и улучшений. Легко отбираются. Базовый заказ даёт +2$, кампания превращает 2$ в 2◆.</p></div>
        <div class="box"><h4>💎 Влияние (◆)</h4><p>Нужно для ролей, городских проектов и многих способностей. Копится медленно, зато его сложнее отнять.</p></div>
        <div class="box"><h4>⚠ Скандалы</h4><p>Штраф к очкам и путь в тюрьму. 5 — потеря роли, 6 — арест. Без роли 1 скандал снимается автоматически в начале хода.</p></div>
        <div class="box"><h4>🛡️ Крыша</h4><p>Заряд защиты. Гасит направленную карту, поглощает рэкет и санкции, страхует провал серой операции.</p></div>
        <div class="box"><h4>🏢 Слоты бизнеса</h4><p>Стартовых слотов 3, максимум 6. Расширение стоит <code>6$ → 10$ → 15$</code> за 4-й, 5-й и 6-й слот.</p></div>
        <div class="box"><h4>🏗️ Проекты</h4><p>Городской проект: 1 действие + 3◆ → +6 очков в финале. Чистая конвертация влияния в очки.</p></div>
      </div>
    </section>

    <section id="economy">
      <h2>4. Экономика объектов</h2>
      <p>Каждый объект в конце раунда приносит доход по формуле:</p>
      <p><code>доход = ⌊(база + масштаб) × (1 + 0.25 × уровень района) × множитель события⌋ + синергии + глобальный доход события</code></p>
      <ul>
        <li><b>База</b> — доход объекта; <b>масштаб</b> добавляет +2$ к базе навсегда (модернизация).</li>
        <li><b>Развитие района</b> даёт +25% и +50% к базовому доходу <i>всех</i> объектов района (у всех игроков) — 2 уровня.</li>
        <li><b>Синергии</b> — районная (+1$/+2$), ролевая (+1$ профильной роли) и специальные бонусы карточки.</li>
        <li><b>Содержание</b>: −1$ за каждый объект в конце раунда (некоторые объекты снижают его).</li>
      </ul>
      <h3>Улучшения объекта (одно на объект)</h3>
      <div class="cols">
        <div class="box"><h4>⚙ Автоматизация · 5$</h4><p>Удваивает все синергии и специальные бонусы объекта, а также его бонус влияния. <b>Базовый доход не удваивается.</b></p></div>
        <div class="box"><h4>🔧 Модернизация · 4$</h4><p>Навсегда +2$ к базовому доходу. Считается в масштабе формулы и повышается развитием района.</p></div>
      </div>
      <p>Продажа объекта возвращает <code>⌊цена/2⌋ + 2 за автоматизацию + 2 за модернизацию</code> и освобождает слот.</p>
      <div class="tip"><b>Практика:</b> автоматизация окупается на объектах с жирными синергиями (много бонусов), а модернизация — на «голых» высокодоходных объектах без условий. Не улучшайте объект, который скоро продадите.</div>
    </section>

    <section id="districts">
      <h2>5. Районы и синергии</h2>
      <p>Шесть районов. Чем больше ваших объектов в одном районе, тем сильнее синергия — <b>каждому</b> объекту района:</p>
      <div class="kpi">
        <div><b>2 объекта</b><span>+1$ каждому объекту района</span></div>
        <div><b>4 объекта</b><span>+2$ каждому объекту района</span></div>
        <div><b>Профильная роль</b><span>+1$ каждому объекту «своего» сектора</span></div>
      </div>
      <p>Каждый район привязан к профильной роли, которая получает синергию сектора:</p>
      <ul>
        ${meta.districts.filter(d => districtRole[d.id]).map(d => {
          const role = meta.roles.find(r => r.id === districtRole[d.id]);
          return `<li><b>${escapeHtml(d.icon)} ${escapeHtml(d.title)}</b> → ${escapeHtml(role?.title ?? "")}</li>`;
        }).join("")}
      </ul>
      <div class="tip"><b>Практика:</b> ранняя специализация на 1–2 районах быстрее раскручивает синергии и профильную роль. Но полный «моно-район» (4 объекта) уязвим к событию «антимонополии» и точечным блокировкам — держите запасной доход.</div>
    </section>

    <section id="roles">
      <h2>6. Роли</h2>
      <p>Роль определяет экономический стиль игрока, открывает постоянные бонусы и специальные команды. У игрока может быть одна основная роль и одна временная копия. Сохранённая к финалу основная роль даёт <b>+3 очка</b>.</p>
      <div class="cols">
        <div class="box"><h4>Получение роли</h4><p>Свободная роль стоит <b>${rolePrice}◆</b> и 1 обычное действие. Занятая роль стоит <b>${rolePrice * 3}◆</b> и 1 действие. При успешном перехвате прежний владелец теряет её, а ваша предыдущая роль освобождается.</p></div>
        <div class="box"><h4>Защита от перехвата</h4><p>Щит роли или Крыша прежнего владельца блокирует перехват и расходуется. Потраченные атакующим действие и влияние не возвращаются. Некоторые объекты выплачивают прежнему владельцу компенсацию за успешную потерю роли.</p></div>
        <div class="box"><h4>Активные способности</h4><p>Цена каждой способности указана отдельно. Если написано «без обычного действия», команда не уменьшает счётчик действий. Разные способности одной роли обычно имеют собственные лимиты и могут применяться в одном ходу.</p></div>
        <div class="box"><h4>Временная копия</h4><p>Копия действует один ход и обычно даёт пассивы и команды выбранной роли, не отбирая её у владельца. Исключение: копия Афериста не увеличивает базовое число действий до четырёх, потому что действия выдаются за основную роль.</p></div>
      </div>
      <div class="role-grid">${meta.roles.map(roleSection).join("")}</div>
      <div class="warn"><b>Потеря роли:</b> игрок с 5 скандалами не может получать роли. Достижение 5 скандалов немедленно снимает основную и временную роли; достижение 6 дополнительно отправляет игрока в тюрьму. Лоббистское бюро возвращает бывшему владельцу 2◆ при успешном перехвате его роли.</div>
    </section>

    <section id="grey">
      <h2>7. Серые операции</h2>
      <p>Серые объекты (Серый сектор и др.) открывают уникальные операции. Каждая требует активный объект и 1 действие, имеет базовый шанс успеха и может быть застрахована Крышей на случай провала.</p>
      <table>
        <thead><tr><th>Операция</th><th>Объект</th><th>Шанс</th><th>Эффект при успехе</th><th>Скандалы</th></tr></thead>
        <tbody>
          <tr><td class="name"><b>Отмывание</b></td><td>Сеть наличных обменников</td><td class="num">85%</td><td>2◆ → (5 + номер раунда)$</td><td>+1 (провал: остальные +2)</td></tr>
          <tr><td class="name"><b>Контрабанда</b></td><td>Ночной рынок</td><td class="num">75%</td><td>украсть до (3 + ⌊раунд/2⌋)$ у цели</td><td>+1 (провал: остальные +2)</td></tr>
          <tr><td class="name"><b>Памп и дамп</b></td><td>Городская криптобиржа</td><td class="num">60%</td><td>+(6 + раунд)$, лидер −(2 + ⌊раунд/2⌋)$</td><td>+1 (провал: остальные +3)</td></tr>
          <tr><td class="name"><b>Взлом</b></td><td>Нелегальный дата-центр</td><td class="num">55%</td><td>заблокировать доходнейший объект цели на раунд</td><td>+2 (провал: остальные +3)</td></tr>
        </tbody>
      </table>
      <p>Аферист повышает шанс успеха (позиция в рейтинге + объекты Технокластера) и получает на 1 скандал меньше. Некоторые серые объекты («офшор») дополнительно снижают скандалы.</p>
      <div class="warn"><b>Внимание:</b> скандалы от операций реальны. Большой «памп» может добить вас до 5–6 скандалов и отправить в тюрьму — считайте риск заранее.</div>
    </section>

    <section id="scandals">
      <h2>8. Скандалы и тюрьма</h2>
      <div class="kpi">
        <div><b>≤4</b><span>штраф к очкам, но играете свободно</span></div>
        <div><b>5</b><span>роль немедленно теряется</span></div>
        <div><b>6</b><span>тюрьма: скандалы сбрасываются до 3, теряется роль и 1 Крыша</span></div>
      </div>
      <p>Тюрьма: следующий ход — только <b>1 действие</b>. Если скандалы достигают 6 в свой собственный ход, остаток хода сгорает. Без роли в начале каждого хода автоматически снимается 1 скандал.</p>
      <p>Способы чистки: антикризисный PR (4$ → −1⚠), способности Политика (2◆ → −1), Мафии (Крыша/деньги → −2), Афериста (действие → −1), карты защиты, репутационный резерв (отменяет следующее получение скандалов).</p>
      <div class="tip"><b>Практика:</b> Журналист превращает скандалы в ресурс, поэтому ему пороги менее страшны — но и он может сесть. Всем остальным держите 1–2 средства чистки перед рискованными действиями.</div>
    </section>

    <section id="roofs">
      <h2>9. Крыша и защита</h2>
      <ul>
        <li>Крыша <b>автоматически</b> поглощает направленный эффект (карту, рэкет, санкцию) — тратится 1 заряд, эффект отменяется. Решение не запрашивается.</li>
        <li>Покупка Крыши стоит 3$ (у Мафиози — 2$) и 1 действие. Обычный лимит — 1 заряд (объекты повышают лимит).</li>
        <li>Крышей можно застраховать провал серой операции (отменяет денежный/объектный штраф, но не скандалы).</li>
        <li><b>Судебный запрет</b> отменяет попытку перехвата вашей роли; <b>репутационный резерв</b> отменяет следующее получение скандалов.</li>
      </ul>
    </section>

    <section id="cards">
      <h2>10. Карты действий</h2>
      <p>Покупка карты: 3$ + 1◆ + 1 действие. В руке максимум 3 карты. Розыгрыш бесплатный, но <b>только одна карта за ход</b>. Ненужную карту можно конвертировать без затраты действия: <code>+1$</code> (продать) или <code>+1◆</code> (сбросить). Рынок карт полностью обновляется каждый раунд.</p>
      <table>
        <thead><tr><th>Карта</th><th>Тип</th><th>Направление</th><th>Эффект</th></tr></thead>
        <tbody>${cardRows(meta)}</tbody>
      </table>
      <div class="tip"><b>Практика:</b> атакующие карты бьют по лидеру — придерживайте их до момента, когда сможете обгонать. Против игрока с Крышей сначала «снимите» её дешёвой атакой, затем бейте дорогой.</div>
    </section>

    <section id="events">
      <h2>11. Городские события</h2>
      <p>В партии действует одно глобальное событие, влияющее на экономику всех игроков.</p>
      <table>
        <thead><tr><th>Событие</th><th>Описание</th><th>Эффект в цифрах</th></tr></thead>
        <tbody>${eventRows(meta.events)}</tbody>
      </table>
    </section>

    <section id="catalog">
      <h2>12. Полный каталог объектов</h2>
      <p>Редкость влияет на «вес» объекта (примерная ценность: ${escapeHtml(rarityLegend)}). Ниже — все объекты по районам, отсортированные по редкости и цене.</p>
      ${districtAssetTables(meta)}
    </section>

    <section id="strategy">
      <h2>13. Стратегические принципы</h2>
      <ol>
        <li><b>Экономический двигатель важнее кэша.</b> Каждый вложенный доллар в правильный объект возвращается каждый раунд. Ранние покупки — самые ценные.</li>
        <li><b>Специализируйтесь, но не в моно.</b> 2–3 объекта в районе включают синергию и оправдывают профильную роль; полные 4 уязвимы к блокировкам.</li>
        <li><b>Роль — это темп и защита.</b> Возьмите роль, которая усиливает вашу основную стратегию, а не «самую сильную» абстрактно.</li>
        <li><b>Скандалы — расходный ресурс, а не катастрофа.</b> Планируйте чистку заранее и не переступайте порог 5 без нужды.</li>
        <li><b>Атакуйте лидера, защищайте лид.</b> Карты и способности эффективнее всего сбивают вырвавшегося вперёд; в лиде держите Крышу и запас чистки.</li>
        <li><b>Считайте финал.</b> В последних раундах конвертируйте кэш и влияние в очки: объекты, улучшения, проекты, удержание роли.</li>
      </ol>
    </section>
  </main>
</div>
<footer>Каталог: ${escapeHtml(meta.content_version)} · документ сгенерирован из актуальных данных игры.</footer>
</body>
</html>`;
}
