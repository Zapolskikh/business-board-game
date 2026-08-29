import type { AssetMeta, CityMeta, RoleMeta } from "./types";
import { campaignTiers, patronage, lobbying, crisisPrInfluence, influencePerPoint, moneyPerPoint, marketRotationSize, projectPerkText, projectRequirementText, projectRerollMoney, rarityLabels } from "./gameUi";

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
  if (num(effects.extraActions)) parts.push(`+1 действие каждый ход`);
  if (num(effects.turnRoof)) parts.push(`+1 Крыша в начале хода`);
  if (num(effects.roofCapacity)) parts.push(`+${num(effects.roofCapacity)} к пределу Крыш`);
  if (num(effects.scandalReduction)) parts.push(`−${num(effects.scandalReduction)} скандал в начале хода`);
  if (num(effects.greyScandalReduction)) parts.push(`−${num(effects.greyScandalReduction)} скандала от серых операций`);
  if (num(effects.carryAction)) parts.push(`переносит 1 действие на следующий ход`);
  if (num(effects.takeoverCompensation)) parts.push(`+${num(effects.takeoverCompensation)}◆ при перехвате роли`);
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
      "<b>Каждый ваш объект приносит +1$.</b> Не только деловые — любой активный объект вашего планшета.",
      "<b>Профильный район — Деловой центр.</b> Объекты этого района получают ещё +1$ к доходу.",
      "<b>Деловой центр по уставу.</b> Любое условие, где назван Деловой центр, считается выполненным — и в условиях объектов, и <b>в условиях городских проектов</b>. Это два проекта доски («Деловой квартал» и «Финансовый район»), которые Капиталист может взять, не занимая ими слоты. На условия вида «объекты в N разных районах» и «N объектов в одном районе» это не распространяется.",
      "<b>Влияние с Промзоны.</b> +1◆ в конце раунда за каждый ваш активный объект Промзоны. Это единственный источник влияния роли: денег у неё больше всех, а покупаются проекты влиянием.",
    ],
    powers: [],
    advice: "Роль без активных способностей и целиком про темп: покупайте дорогое (объект стоит половину цены в очках), держите пару объектов Промзоны ради влияния и забирайте деловые проекты, которых у вас нет на планшете.",
  },
  politician: {
    style: "Роль контроля города: стабильно производит влияние, зарабатывает на общей застройке и безопасно снимает скандалы.",
    perks: [
      "<b>Профильный район — Спальный район.</b> Каждый ваш активный жилой объект получает +1$ к доходу.",
      "<b>Административные связи.</b> Условия объектов, требующие связь с Административным кварталом, всегда считаются выполненными.",
      "<b>Налог с жителей.</b> В конце раунда вы получаете +1$ за <b>каждый</b> активный жилой объект на столе, включая объекты соперников: чем плотнее застроен город, тем больше он платит.",
      "<b>Административный ресурс.</b> +2◆ в конце раунда за каждый ваш активный объект Административного квартала — и больше ниоткуда. Плоского влияния «за факт роли» и влияния с жилых объектов у Политика нет: жильё платит деньгами через налог.",
    ],
    powers: [
      {
        name: "Урегулировать скандал",
        cost: "1 действие и 2◆",
        limit: "по числу действий",
        effect: "Снимите 1 свой скандал.",
        use: "Обе способности Политика можно применить в одном ходу, если хватает влияния. Очистку выгодно использовать до действия, способного довести вас до 5 скандалов.",
      },
    ],
    advice: "Политик особенно силён в длинной партии: каждый административный объект это +2◆ за раунд, то есть проект каждые два-три раунда. Жильё при этом кормит вас деньгами со всего стола. Слабое место — первые раунды, где вы беднее всех: планируйте первый административный объект как можно раньше. Влияние затем превращается в налоги, роли и городские проекты.",
  },
  journalist: {
    style: "Роль управления скандалами: чужая репутационная война приносит Журналисту деньги и влияние.",
    perks: [
      "<b>Доход от повестки.</b> В конце раунда Журналист получает <b>1$ за каждый скандал</b>, который на этот момент числится у соперников, и <b>по 2$ за скандал</b>, если у вас есть хотя бы один активный объект Делового центра. Считается остаток, а не полученное за раунд: снятые до расчёта скандалы не приносят ничего.",
      "<b>Собственный рейтинг.</b> В конце раунда каждый собственный скандал даёт <b>+1◆, потолка нет</b> — но линия включается только при <b>хотя бы одном своём объекте Спального района</b>: без читателей тираж не продаётся, и рейтинг не платит вовсе. Один жилой объект открывает всю линию, второй ничего не добавляет.",
      "<b>Предел скандалов 6.</b> Роль теряется на шестом скандале, а не на пятом; тюрьма по-прежнему на следующем.",
      "У Журналиста <b>нет профильного района</b> — вместо него две связи с чужими: Деловой центр удваивает деньги, Спальный включает рейтинг. Обе связи — это по одному объекту, дальше они не масштабируются.",
    ],
    powers: [
      {
        name: "Раздуть скандал",
        cost: "без ресурсов и без действия",
        limit: "1 раз за ход",
        effect: "Вы и выбранный соперник получаете по 1 скандалу. <b>Крыша цели гасит всё целиком</b> и тратится — тогда ни соперник, ни вы скандала не получаете.",
        use: "Это быстрый способ поднять будущий рейтинг и одновременно приблизить соперника к потере роли, но по цели с Крышей он не работает совсем: рейтинг растёт только от скандалов, которые действительно легли. Проверяйте свой предел: у Журналиста роль теряется на 6 скандалах, арест наступает на 7 — у соперников на 5 и 6.",
      },
      {
        name: "Публикация",
        cost: "1 действие и 3◆",
        limit: "1 раз за ход, отдельно от Раздуть скандал",
        effect: "Выбранный соперник получает <b>2 скандала</b>, отдачи по вашей репутации нет. <b>Крыша цели гасит публикацию целиком</b> и тратится — влияние и действие при этом всё равно потрачены.",
        use: "Обе способности разрешено применить в одном ходу и выбрать одну или разные цели. Публикация безопаснее для собственной репутации, но требует влияния.",
      },
    ],
    advice: "Поддерживайте у соперников несколько скандалов, не обязательно сразу доводя их до тюрьмы: накопленные скандалы каждый раунд продолжают приносить вам деньги.",
    warning: "Крыша соперника полностью поглощает и раздутую историю, и публикацию. При 6 собственных скандалах Журналист теряет роль и перестаёт получать её бонусы в конце раунда, при 7 — попадает под арест; вместе с ролью уходит и её потолок, счётчик сжимается до общих 5.",
  },
  fraudster: {
    style: "Высокорисковая роль камбэка: получает больше действий, усиливает серые операции и превращает скандальный риск в темп.",
    perks: [
      "<b>Четыре действия.</b> В начале обычного хода владелец роли получает 4 базовых действия вместо 3.",
      "<b>Профильный район — Технокластер.</b> Каждый активный объект Технокластера получает +1$ к доходу.",
      "<b>Мастер серых операций.</b> Шанс успеха любой серой операции выше на <b>30 п.п.</b> — без условий, объект Технокластера не нужен. Итоговый шанс не выше 90%.",
      "<b>Камбэк.</b> При успешной серой операции вы получаете <b>+1◆ за каждую позицию отставания</b> в рейтинге: 1◆ на втором месте, 3◆ на четвёртом. Влиянием, а не деньгами — денежных рычагов у роли и без того три.",
    ],
    powers: [
      {
        name: "Очистка следов",
        cost: "1 действие",
        limit: "можно повторять, пока есть действия и скандалы",
        effect: "Снимите 1 свой скандал.",
        use: "В отличие от большинства ролевых способностей, очистка не ограничена одним применением за ход.",
      },
      {
        name: "Криптоскам",
        cost: "1 действие; нужна активная «Городская криптобиржа»",
        limit: "1 раз за ход",
        effect: "Забирает <b>25% денег каждого соперника</b> (Крыша цели отменяет изъятие у неё) и даёт вам <b>5 скандалов</b> — весь скандальный бюджет роли. Все собранные эффекты снижения скандалов складываются: два эффекта оставят 3 скандала, три — 2.",
        use: "Это один фиксированный риск, а не выбор суммы. Чем богаче соперники, тем сильнее эффект; применение против пустых кошельков всё равно создаёт все скандалы.",
      },
          ],
    advice: "Готовьте криптоскам заранее: обнулите свои скандалы и соберите несколько эффектов снижения, затем выбирайте момент, когда кошельки соперников действительно велики.",
  },
  mafia: {
    style: "Роль территориального контроля: усиливает Серый сектор, экономит Крыши и забирает часть дохода районных меньшинств.",
    perks: [
      "<b>Профильный район — Серый сектор.</b> Каждый активный объект Серого сектора получает +1$ к доходу.",
      "<b>Крыша.</b> Мафиози платит за Крышу на 1$ меньше остальных (цена растёт с раундом), а предел хранения равен 3 вместо 2.",
    ],
    powers: [
      {
        name: "Рэкет",
        cost: "1 действие; нужен активный объект Серого сектора",
        limit: "1 раз за ход",
        effect: "Выбранный соперник передаёт деньги и влияние. Деньги: <b>2$ + 2$ за каждый ваш объект Серого сектора</b> + ⌊раунд/3⌋, и <b>+5$, если цель лидирует</b>. Влияние: <b>1◆ за каждый ваш объект Административного квартала</b>. Оба требования ограничены тем, что у цели есть. Старая формула считала ещё жилые объекты и росла от одного номера раунда, ещё +3 против лидера и +1 после успешной серой операции в этом ходу. Влияние: до 1◆ за каждый ваш административный объект.",
        use: "Если у цели есть Крыша, она расходуется и полностью отменяет рэкет. Если у Мафиози нет административного объекта, после успешного взыскания он получает +1 скандал.",
      },
      {
        name: "Замять дело",
        cost: "1 действие, 3$; нужен активный административный объект",
        limit: "по числу действий",
        effect: "Снимите до 2 собственных скандалов.",
        use: "При одном скандале снимается один. Крышей платить больше нельзя — она нужнее как защита; денежный вариант недоступен без административного объекта.",
      },
    ],
    advice: "Рэкет — главный денежный источник роли, поэтому выгоднее расставить по 1–2 объекта в нескольких застроенных районах, чем копить всё в одном: каждый район, где вы обгоняете соперника, добавляет к взысканию. Дальше лишайте соперников Крыш и давите лидера усиленным рэкетом.",
  },
  military: {
    style: "Роль точечного наказания: читает счётчик скандалов соперника и наказывает по его уровню.",
    perks: [
      "<b>Профильный район — Промзона.</b> Каждый активный промышленный объект получает +1$ к доходу.",
      "Силовик не создаёт скандалы сам — он использует уже накопленные скандалы цели как основание для санкций.",
    ],
    powers: [
      {
        name: "Санкции",
        cost: "1 действие",
        limit: "1 раз за ход; цель должна иметь минимум 2 скандала",
        effect: "Сначала проверяется защита. При наличии Крыши цель теряет её и больше ничего не отдаёт. Без Крыши на 2 скандалах цель передаёт до (3 + номер раунда)$; на 3 — ещё 2 + ⌊раунд/4⌋ влияния; на 4 — также теряет роль. Санкция не очищает скандалы цели.",
        use: "Санкция — единственный ролевой способ снять чужую роль без компромата, и он не требует влияния. Держите цель под наблюдением: игрок, который сам себе вешает скандалы серыми операциями, на уровнях 3–4 отдаёт вам деньги, влияние и роль.",
      },
      {
        name: "Массовая зачистка крыш",
        cost: "1 действие",
        limit: "по числу действий; нужна хотя бы одна Крыша у соперников",
        effect: "Каждый соперник теряет по 1 Крыше. Силовик получает по 1 победному очку за каждую фактически снятую Крышу.",
        use: "Открывает сразу несколько целей для последующих санкций и атак. Собственная Крыша Силовика не снимается и очков не приносит.",
      },
    ],
    advice: "Следите за хроникой и атакуйте сразу после того, как цель набрала нужный уровень: разница между 2 и 4 скандалами — это разница между штрафом и потерей роли. Ждать выгодно, но цель чистится, так что окно короткое.",
    warning: "Крыша цели съедает санкцию целиком: сначала снимите её чем-нибудь дешёвым. И помните, что на своём ходу соперник может почиститься — уровень, который вы видели, к вашему ходу может быть ниже.",
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
        <thead><tr><th>Объект</th><th>Цена</th><th>Доход/раунд</th><th>◆ разово</th><th>Условия и бонусы</th></tr></thead>
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

function projectRows(meta: CityMeta): string {
  return [...meta.projects].sort((a, b) => b.points - a.points || a.title.localeCompare(b.title)).map(project => `
    <tr>
      <td class="name"><b>${escapeHtml(project.title)}</b></td>
      <td>${project.cost_influence}◆ + ${project.cost_money}$</td>
      <td><b>${project.points}</b></td>
      <td>${escapeHtml(projectRequirementText(project, meta))}</td>
      <td class="effect">${escapeHtml(projectPerkText(project))}</td>
    </tr>`).join("");
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
    <a href="#projects">2b. Городские проекты</a>
    <a href="#resources">3. Ресурсы</a>
    <a href="#economy">4. Экономика объектов</a>
    <a href="#districts">5. Районы и синергии</a>
    <a href="#roles">6. Роли</a>
    <a href="#grey">7. Серые операции</a>
    <a href="#scandals">8. Скандалы и тюрьма</a>
    <a href="#roofs">9. Крыша и защита</a>
    <a href="#cards">10. Карты действий</a>
    <a href="#project-catalog">11b. Все проекты</a>
    <a href="#catalog">12. Каталог объектов</a>
    <a href="#strategy">13. Стратегия</a>
  </nav>
  <main>
    <section id="goal">
      <h2>1. Цель и подсчёт очков</h2>
      <p><b>Деньги — это топливо, а не очки.</b> Побеждает не тот, кто больше накопил, а тот, кто больше построил. Счёт считается так:</p>
      <ul>
        <li><b>Городские проекты</b> — 4–8 очков каждый, по цифре на карточке проекта. Главный источник очков.</li>
        <li><b>Объекты</b> — половина цены объекта, округление вниз; это число написано прямо на карточке (<b>N очк</b>). Через объект деньги превращаются в очки по <b>2$ за очко</b> против <b>${moneyPerPoint(meta)}$ за очко</b> у денег в кошельке — в пять раз выгоднее, и потому объекты и есть главный сток денег.</li>
        <li><b>Роль</b> — +3 очка, если в финале у вас есть роль.</li>
        <li><b>Прочие очки</b> — патронаж (<b>${patronage(meta).money}$ → ${patronage(meta).points}</b>) и лоббирование (<b>${lobbying(meta).influence}◆ → ${lobbying(meta).points}</b>), по одному нажатию каждого за ход, плюс карты, покупающие очки напрямую.</li>
        <li><b>Деньги</b> — 1 очко за каждые полные <b>${moneyPerPoint(meta)}$</b>.</li>
        <li><b>Влияние ◆</b> — 1 очко за каждые полные <b>${influencePerPoint(meta)}◆</b>.</li>
        <li><b>Оба стока платят ровно вдвое больше, чем хранение</b> — в этом весь их смысл: достаточно, чтобы стоить действия, когда доска ничего не предлагает, и мало, чтобы соперничать с объектом (2$ за очко) или проектом (около очка за 1◆).</li>
        <li><b>Скандалы ⚠</b> — минус 1 очко за каждый.</li>
      </ul>
      <div class="tip"><b>Практика:</b> городской заказ (+2$) даёт всего 0.2 очка за действие — это худший ход в игре, годный лишь чтобы добрать монеты до покупки. Кампания (${campaignTiers(meta).map(tier => `${tier.spend}$ → ${tier.gain}◆`).join(", ")}) выгоднее, потому что влияние идёт в проекты. Ваш текущий счёт с разбивкой всегда виден в панели «Мой счёт», а панель «Доход за раунд» показывает, сколько денег и влияния принесёт ближайшая выплата и откуда.</div>
    </section>

    <section id="flow">
      <h2>2. Структура хода и раунда</h2>
      <p><b>Порядок хода определяется рейтингом:</b> раунд начинает тот, кто идёт последним по очкам, а лидер ходит последним и выбирает с рынка после всех. Порядок пересчитывается каждый раунд и виден номерами на панели игроков. За свой ход вы тратите <b>действия</b>:</p>
      <div class="kpi">
        <div><b>3</b><span>действия у большинства ролей</span></div>
        <div><b>4</b><span>действия у Афериста</span></div>
        <div><b>1</b><span>действие в ход после тюрьмы</span></div>
      </div>
      <p><b>Действия</b> тратятся на что угодно: город, роли, карты, серые операции, защиту, покупки. Есть и бесплатные команды, которые действий не расходуют вовсе: продажа объекта, розыгрыш и сброс карты.</p>
      <p>Когда все сходили, наступает <b>выплата раунда</b>: объекты приносят доход, начисляется пассивное влияние, срабатывают роли (налог Политика с жителей, доход Журналиста), гасится мостовой кредит. Затем пересчитывается порядок хода, обновляется рынок карт, часть рынка объектов и <b>одна позиция на доске проектов</b>.</p>
      <p><b>После последнего раунда выплаты нет.</b> Выплата — это то, с чем вы входите в следующий раунд, а следующего нет: доход и влияние за пятнадцатый раунд не начисляются, и потратить их всё равно было бы негде. Мостовой кредит при этом гасится: то, что раунд должен, он отдаёт. Панель «Доход за раунд» весь последний раунд показывает нули — это значит, что деньги и влияние надо тратить сейчас, а не копить к подсчёту.</p>
      <div class="tip"><b>Рынок объектов меняется только между раундами.</b> В начале каждого раунда уходят <b>${marketRotationSize(meta)} самые старые позиции</b> из шести — они помечены значком ⏳ — и на их место приходят новые; ушедшие возвращаются в низ колоды, из игры ничего не пропадает. Внутри раунда рынок не двигается: доска, которую вы видите на своём ходу, останется той же, когда очередь вернётся к вам. Поэтому «увидел дорогой объект → накопил → купил» — рабочий план, а не лотерея, а половина рынка всегда переживает ротацию.</div>
      <div class="tip"><b>Практика:</b> не «сжигайте» ход базовым заказом на +2$, если можно вложиться в объект или в проект — экономический двигатель окупается каждый раунд, а деньги сами по себе почти ничего не стоят.</div>
    </section>

    <section id="projects">
      <h2>2b. Городские проекты — общая доска</h2>
      <p>На столе всегда лежат <b>4 проекта</b>, одни и те же для всех игроков. Проект <b>уникален</b>: кто взял первым — тот и забрал очки, остальным этот проект больше недоступен до конца партии.</p>
      <ul>
        <li><b>Цена</b> — влияние и деньги, указанные на карточке, плюс 1 действие.</li>
        <li><b>Условие</b> — то, что уже должно быть у вас на столе: объекты в определённом районе, объекты с нужным тегом, число объектов, отсутствие скандалов, наличие роли. Никаких скрытых расчётов: всё это просто считается по вашим карточкам.</li>
        <li><b>Награда</b> — очки в финале и постоянный бонус (например, +2$ или +2◆ в каждый раунд). Бонус проекта нельзя заблокировать или конфисковать.</li>
        <li><b>Ротация</b> — в начале каждого раунда <b>первый слева</b> проект уходит <b>под низ колоды</b> (не из игры — он вернётся позже) и заменяется новым; уходящий помечен значком ⏳.</li>
        <li><b>Пересборка доски</b> — за ${projectRerollMoney(meta)}$ <b>и 1 действие</b>, раз в ход: все четыре проекта возвращаются в колоду, колода перемешивается и раздаётся заново. Это выход, когда на доске нет ничего под ваш бизнес. Цена в деньгах, а не в влиянии: влиянием сами проекты и покупаются. Действие в цене тоже не случайно — доска общая, и без него игрок с полным кошельком пересобирал бы её каждый ход, превращая планирование в раздачу.</li>
      </ul>
      <p>Набор проектов в партии случаен, поэтому «правильный» бизнес каждый раз разный: в одной партии город просит логистику и жильё, в другой — данные и производство.</p>
      <div class="tip"><b>Практика:</b> смотрите на доску проектов <i>до</i> того, как покупать объекты. Соперник, которому нужен тот же проект, — ваш главный конкурент, и обогнать его можно как темпом, так и тем, чтобы забрать проект первым, пусть и подороже.</div>
    </section>

    <section id="resources">
      <h2>3. Ресурсы</h2>
      <div class="cols">
        <div class="box"><h4>💵 Деньги ($)</h4><p>Топливо: покупки, слоты, оба реролла, деньги в цене проектов, кампания и карты, покупающие очки напрямую. В финале лишь ${moneyPerPoint(meta)}$ = 1 очко, поэтому копить невыгодно — тратьте. Аварийный сток: патронаж, ${patronage(meta).money}$ → ${patronage(meta).points} очков, раз за ход.</p></div>
        <div class="box"><h4>💎 Влияние (◆)</h4><p>Нужно для ролей, городских проектов и многих способностей. В финале ${influencePerPoint(meta)}◆ = 1 очко. Аварийный сток: лоббирование, ${lobbying(meta).influence}◆ → ${lobbying(meta).points} очков, раз за ход — но проект платит примерно очко за 1◆, так что лоббирование это floor, а не план. Само по себе почти не растёт: его дают объекты с «+◆ за раунд», постоянные бонусы проектов, роль Политика и Журналиста. Остальное приходится покупать за действия — кампанией или отмыванием.</p></div>
        <div class="box"><h4>🎖️ Патронаж</h4><p>1 действие и <b>${patronage(meta).money}$ → ${patronage(meta).points} очков</b> в «Прочие очки». Слот не нужен, карта не нужна, <b>один раз за ход</b>. Те же ${patronage(meta).money}$ в кошельке дадут в финале только ${Math.floor(patronage(meta).money / moneyPerPoint(meta))} очка, так что действие покупает ровно ${patronage(meta).points - Math.floor(patronage(meta).money / moneyPerPoint(meta))} очка сверх пассивного курса. Это сток для денег, которые уже некуда девать, и страховка от партии, где доход вырос, а доска проектов пуста. Объект и проект всё равно выгоднее.</p></div>
        <div class="box"><h4>📣 Кампания</h4><p>1 действие и одна из ступеней: ${campaignTiers(meta).map(tier => `<b>${tier.spend}$ → ${tier.gain}◆</b>`).join(", ")}. Курс с ростом ступени ухудшается, зато одно действие приносит больше влияния — так лишние деньги превращаются в дефицитный ресурс.</p></div>
        <div class="box"><h4>⚠ Скандалы</h4><p>Минус очко каждый и путь в тюрьму: 5 — потеря роли, 6 — арест. <b>У Журналиста порог сдвинут на единицу</b> (роль теряется на 6, арест на 7): его экономика построена на собственных скандалах. Снять скандал стоит <b>3◆ и действие</b> (антикризисный PR). Цена в влиянии, а не в деньгах: доллар стоит слишком мало очков, чтобы чистка что-то значила. Без роли 1 скандал снимается автоматически в начале хода.</p></div>
        <div class="box"><h4>🛡️ Крыша</h4><p>Заряд защиты <b>от чужих действий</b>: гасит направленную на вас карту, рэкет, санкции, взлом и попытку отобрать роль. Последствия ваших собственных решений, включая провал серой операции, Крыша не отменяет.</p></div>
        <div class="box"><h4>🏢 Слоты бизнеса</h4><p>Стартовых слотов 3, максимум 6. Расширение стоит <code>6$ → 10$ → 15$</code> за 4-й, 5-й и 6-й слот.</p></div>
        <div class="box"><h4>🏗️ Проекты</h4><p>Общая доска из 4 уникальных проектов: 1 действие + влияние и деньги по карточке → 4–9 очков и постоянный бонус. После взятия доска сразу пополняется; если хватает действий и ресурсов, можно продолжить цепочку проектов в тот же ход.</p></div>
        <div class="box"><h4>🃏 Карты действий</h4><p>Покупка — <b>1 действие, 3$ и 1◆</b>, и вы тянете <b>две случайные</b> карты, <b>один раз за ход</b> (в руке максимум 3). Розыгрыш и сброс бесплатны и не ограничены. Сброс возвращает 2$ или 2◆.</p></div>
        <div class="box"><h4>🔄 Пересборка доски</h4><p>Все четыре проекта уходят в колоду, колода перемешивается и раздаётся заново: ${projectRerollMoney(meta)}$ <b>и 1 действие</b>, один раз за ход. Кнопки для рынка объектов нет — он и так меняет три позиции из шести в начале каждого раунда.</p></div>
        <div class="box"><h4>🏷️ Продажа объекта</h4><p><b>Без действия</b>: возврат <code>⌊цена/2⌋</code> — ровно столько же очков объект и снимает с вашего счёта. Слот сразу свободен, поэтому «продать слабый и купить дорогой» стоит одно действие покупки и приносит разницу в очках.</p></div>
      </div>
    </section>

    <section id="economy">
      <h2>4. Экономика объектов</h2>
      <p>Влияние ◆ на карточке объекта — <b>разовый</b> бонус в момент покупки, а не доход за раунд. Каждый объект в конце раунда приносит доход по формуле:</p>
      <p><code>доход = база + синергии</code>.</p>
      <ul>
        <li><b>База</b> — доход, напечатанный на карточке объекта. Он не растёт: единственный способ зарабатывать больше — купить объект посильнее или собрать район.</li>
        <li><b>Синергии</b> — районная (+1$ за объект от 2 штук в районе, +2$ от 4), ролевая (+1$ профильной роли) и собственные бонусы карточки.</li>
        <li><b>Синергия влияния</b> — если район собран полностью (<b>4 ваших объекта</b>), каждый <b>эпический и легендарный</b> объект этого района приносит вам ещё и <b>+1◆ каждый раунд</b>. Это награда за глубину вместо ширины, и она написана на самой карточке.</li>
        <li><b>Теги</b> объекта (<code>finance</code>, <code>data</code>, <code>logistics</code>, <code>production</code>, <code>security</code>, <code>government</code>…) написаны на каждой карточке и в каталоге: половина условий городских проектов сформулирована через них.</li>
      </ul>
      <h3>🏷️ Продажа и обмен объекта</h3>
      <p><b>Продажа не расходует действие.</b> Вы получаете <code>⌊цена/2⌋</code> и сразу освобождаете слот. Отдельной команды «заменить объект» больше нет: продайте слабый и купите на рынке сильный — весь обмен стоит ровно одно действие покупки, столько же, сколько стоила замена, но без лишнего интерфейса.</p>
      <div class="tip"><b>Практика:</b> дешёвые объекты первых раундов не приговор. Объект стоит <b>половину своей цены</b> в очках, и это число написано на карточке, так что менять слабый на дорогой — прямой способ превратить лишние деньги в очки: 2$ за очко против 10$ за очко у денег в кошельке.</div>
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
      <div class="tip"><b>Практика:</b> ранняя специализация на 1–2 районах быстрее раскручивает синергии и профильную роль, а полный район из 4 объектов включает синергию влияния на эпиках и легендарках. Плата за глубину — точечные блокировки: одна заблокированная карточка в моно-районе стоит дороже, чем в размазанном бизнесе.</div>
    </section>

    <section id="roles">
      <h2>6. Роли</h2>
      <p>Роль определяет экономический стиль игрока, открывает постоянные бонусы и специальные команды. У игрока может быть одна основная роль и одна временная копия. Сохранённая к финалу основная роль даёт <b>+3 очка</b>.</p>
      <div class="cols">
        <div class="box"><h4>Получение роли</h4><p>Свободная роль стоит <b>${rolePrice}◆</b> и 1 действие. Занятая роль стоит <b>${rolePrice * 3}◆</b> и 1 действие. При успешном перехвате прежний владелец теряет её, а ваша предыдущая роль освобождается.</p></div>
        <div class="box"><h4>Защита от перехвата</h4><p>Крыша прежнего владельца блокирует перехват и расходуется. Потраченные атакующим действие и влияние не возвращаются. Некоторые объекты выплачивают прежнему владельцу компенсацию за успешную потерю роли.</p></div>
        <div class="box"><h4>Активные способности</h4><p>Цена каждой способности указана отдельно. Если написано «без действия», команда не уменьшает счётчик действий. Разные способности одной роли обычно имеют собственные лимиты и могут применяться в одном ходу.</p></div>
      </div>
      <div class="role-grid">${meta.roles.map(roleSection).join("")}</div>
      <div class="warn"><b>Потеря роли:</b> игрок с 5 скандалами не может получать роли. Достижение 5 скандалов немедленно снимает основную и временную роли; достижение 6 дополнительно отправляет игрока в тюрьму. Лоббистское бюро возвращает бывшему владельцу 2◆ при успешном перехвате его роли.</div>
    </section>

    <section id="grey">
      <h2>7. Серые операции</h2>
      <p>Серые операции открывает <b>район</b>, а не отдельная карточка: достаточно любого активного объекта нужного района, роль не требуется. Каждая стоит 1 действие, и <b>за ход можно провести только одну любую операцию</b>. Серый сектор открывает все пять; Технокластер — «Памп и дамп» и «Взлом»; Административный квартал — «Слив компромата».</p>
      <table>
        <thead><tr><th>Операция</th><th>Район-ключ</th><th>Шанс</th><th>Эффект при успехе</th><th>Очки</th></tr></thead>
        <tbody>
          <tr><td class="name"><b>Вброс</b></td><td>Серый сектор</td><td class="num">60%</td><td>по <b>1 скандалу каждому сопернику</b></td><td class="num">+2</td></tr>
          <tr><td class="name"><b>Памп и дамп</b></td><td>Технокластер, Серый сектор</td><td class="num">45%</td><td>забрать себе до (${meta.scoring?.pump_drain_base ?? 2} + ⌊раунд/2⌋)$ <b>у каждого соперника</b></td><td class="num">+2</td></tr>
          <tr><td class="name"><b>Пробить крышу</b></td><td>Серый сектор</td><td class="num">60%</td><td>снять с цели <b>все Крыши</b>, ещё +${meta.scoring?.roof_break_point_per_roof ?? 1} очко за каждую снятую</td><td class="num">+2</td></tr>
          <tr><td class="name"><b>Взлом</b></td><td>Технокластер, Серый сектор</td><td class="num">40%</td><td>украсть у цели до (${meta.scoring?.hack_influence_base ?? 2} + ⌊раунд/3⌋)◆</td><td class="num">+3</td></tr>
          <tr><td class="name"><b>Слив компромата</b></td><td>Серый сектор, Административный квартал</td><td class="num">60%</td><td>цель <b>теряет роль</b></td><td class="num">+3</td></tr>
        </tbody>
      </table>
      <p><b>Одно правило исхода на все пять операций.</b> Успех: эффект применяется, вы получаете очки и <b>+${meta.scoring?.grey_success_scandals ?? 1} скандал</b>. Провал: <b>не происходит ничего</b> — ни эффекта, ни очков, — а вы получаете <b>+${meta.scoring?.grey_failure_scandals ?? 2} скандала</b>. Действие тратится в обоих случаях, попытка за ход одна, так что переброс до успеха невозможен.</p>
      <p><b>Скандал — главная цена серого слоя.</b> В среднем операция стоит около 1,4 скандала, а роль теряется на 5 — значит без очистки хватает на три-четыре операции за партию. Не шанс и не цена, а именно репутация задаёт темп: планируйте очистку заранее.</p>
      <p><b>Каждая операция делает то, чего не делают остальные</b>, поэтому выбирать нужно по положению на доске, а не по величине числа: отстаёте по темпу — «Вброс», по деньгам — «Памп», цель спряталась за Крышами — «Пробить крышу», соперник копит влияние на роль — «Взлом», соперник держит роль — «Слив компромата».</p>
      <p>Аферист повышает шанс успеха на 30 п.п. без всяких условий (потолок 90%) и получает влияние за отставание в рейтинге. Некоторые объекты и проекты снижают начисляемые скандалы на 1 при успехе и провале; несколько таких эффектов складываются и награждают специализированную сборку.</p>
      <div class="box"><h4>Крыша цели гасит операцию</h4><p>Операция против другого игрока — направленный эффект, поэтому <b>Крыша цели тратится и полностью отменяет удар</b>, даже при успешном броске. При этом вы не получаете ни очков, ни скандала: награда платится только за реальный урон. «Вброс» и «Памп» бьют по всем троим, и Крыша каждого считается отдельно — одна операция может снять сразу три Крыши. Исключение — <b>«Пробить крышу»: её Крыша не гасит</b>, потому что удар нанесён именно по ней.</p></div>
      <div class="box"><h4>Свои скандалы Крыша не отменяет</h4><p>Крыша защищает только от чужих эффектов. Скандал, который вы навлекли сами — серой операцией, криптоскамом или собственной публикацией, — начисляется всегда, даже если у вас есть Крыша.</p></div>
      <div class="warn"><b>Внимание:</b> скандалы от операций реальны. Два провала подряд — это уже 4 скандала, шаг до потери роли и два до тюрьмы. Считайте риск заранее.</div>
    </section>

    <section id="scandals">
      <h2>8. Скандалы и тюрьма</h2>
      <div class="kpi">
        <div><b>≤4</b><span>штраф к очкам, но играете свободно</span></div>
        <div><b>5</b><span>роль немедленно теряется</span></div>
        <div><b>6</b><span>тюрьма: скандалы сбрасываются до 3, теряется роль и 1 Крыша</span></div>
      </div>
      <p>Тюрьма: следующий ход — только <b>1 действие</b>. Если скандалы достигают 6 в свой собственный ход, ход <b>немедленно прерывается</b> и переходит к следующему игроку: все неиспользованные действия сгорают, включая то, которое обычно сохраняет «Секретариат мэра». Без роли в начале каждого хода автоматически снимается 1 скандал.</p>
      <p>Чистка скандалов — <b>одна кнопка</b> в панели решений, и она подставляет цену вашей роли. Каждый вариант стоит 1 действие, лимита по числу применений нет:</p>
      <div class="grid">
        <div><b>${crisisPrInfluence(meta)}◆</b><span>−1⚠ · базовый антикризисный PR, доступен всем</span></div>
        <div><b>2◆</b><span>−1⚠ · Политик</span></div>
        <div><b>—</b><span>−1⚠ · Аферист, только действие</span></div>
        <div><b>3$</b><span>−2⚠ · Мафиози, нужен активный административный объект</span></div>
      </div>
      <p>Сверх этого скандалы гасят карты защиты: Крыша поглощает <b>всё</b> начисление целиком, сколько бы скандалов ни начислялось за раз.</p>
      <div class="tip"><b>Практика:</b> Журналист превращает скандалы в ресурс, поэтому ему пороги менее страшны — но и он может сесть. Всем остальным держите 1–2 средства чистки перед рискованными действиями.</div>
    </section>

    <section id="roofs">
      <h2>9. Крыша и защита</h2>
      <ul>
        <li>Крыша <b>автоматически</b> поглощает любой направленный на вас негативный эффект — карту, рэкет, санкцию, серую операцию соперника, перехват роли, скандал. Тратится 1 заряд, эффект отменяется полностью. Решение не запрашивается.</li>
        <li>Крыша не защищает от того, что вы делаете <b>сами с собой</b>: скандал за свою серую операцию, за «Криптоскам» или за «Контролируемую утечку» начисляется всегда, заряд на него не тратится.</li>
        <li>Так как заряд снимается любым направленным эффектом, соперника можно «распечатать» дешёвой атакой, а следующим действием ударить всерьёз. Учтите, что цена такой размены — ваши собственные скандалы: у «Контролируемой утечки» и «Кампании по дискредитации» вы получаете свой скандал даже тогда, когда Крыша погасила удар по цели.</li>
        <li>Покупка Крыши стоит 1 действие и <code>3$ + ⌊(раунд − 1) / 2⌋</code>, то есть 3$ в 1–2 раунде, 4$ в 3–4 и далее +1$ каждые два раунда. Мафиози платит на 1$ меньше. Лимит — <b>2 заряда</b>, у Мафиози 3 (объекты и проекты повышают лимит).</li>
        <li>Собственная Крыша не страхует провал серой операции: провал не наносит ресурсного штрафа, но всегда начисляет скандалы.</li>
        <li><b>Одна Крыша — вся защита.</b> Отдельных щитов роли и репутации в игре нет: все три карты защиты выдают ту же Крышу, и она гасит любую <b>чужую</b> атаку: попытку перехвата вашей роли (влияние возвращается атакующему), слив компромата, карту, рэкет, санкцию, взлом и <b>начисление скандалов от соперника</b> целиком, сколько бы их ни начислялось за раз. Свои собственные скандалы — за свою серую операцию, за самоскандал Журналиста — Крыша не гасит никогда.</li>
      </ul>
    </section>

    <section id="cards">
      <h2>10. Карты действий</h2>
      <p>Покупка: <b>1 действие</b>, 3$ и 1◆ — за них вы вслепую тянете <b>две</b> карты из перемешанной колоды, и <b>только один раз за ход</b>. В колоде <b>по две копии каждой карты</b>, так что одна и та же может прийти дважды за партию; иначе колода заканчивалась к 9-му раунду и весь слой карт исчезал ровно тогда, когда на действия и так почти нечего тратить. Открытого рынка карт нет. В руке максимум 3 карты.</p>
      <p><b>Розыгрывать и сбрасывать можно сколько угодно раз за ход</b>, и то и другое не стоит действия; сброс возвращает <code>+2$</code> или <code>+2◆</code>. Ограничение стоит на <b>покупке</b>, а не на руке: без него можно было купить карты дважды и сразу отправить всё в шредер, и это было выгоднее Кампании как источник влияния. А то, что уже куплено, вы тратите в любом темпе.</p>
      <p><b>Скандальные карты можно направить на себя.</b> «Контролируемая утечка», «Компромат» и «Слежка» разрешают выбрать целью собственного игрока — это ход прежде всего для Журналиста, чья экономика построена на своих скандалах. Удар по себе идёт мимо всех защит: <b>ваша Крыша его не гасит</b> (она защищает от чужих решений, а не от ваших) и бонусы «атакующего» на нём не начисляются. В окне выбора цели ваша карточка стоит рядом с чужими и активна только тогда, когда карта это допускает.</p>
      <table>
        <thead><tr><th>Карта</th><th>Тип</th><th>Направление</th><th>Эффект</th></tr></thead>
        <tbody>${cardRows(meta)}</tbody>
      </table>
      <div class="tip"><b>Практика:</b> атакующие карты бьют по лидеру — придерживайте их до момента, когда сможете обгонать. Против игрока с Крышей сначала «снимите» её дешёвой атакой, затем бейте дорогой.</div>
    </section>

    <section id="project-catalog">
      <h2>11b. Все городские проекты</h2>
      <p>В партии участвует вся колода, но на доске одновременно лежат только четыре, а порядок случайный — поэтому набор доступных целей каждый раз разный.</p>
      <table>
        <thead><tr><th>Проект</th><th>Цена</th><th>Очки</th><th>Условие</th><th>Постоянный бонус</th></tr></thead>
        <tbody>${projectRows(meta)}</tbody>
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
        <li><b>Стройте под доску проектов.</b> Проекты — большинство очков в партии, а их условия задают, какой бизнес сейчас «правильный». Сначала посмотрите, что просит город, потом покупайте объекты.</li>
        <li><b>Экономический двигатель важнее кэша.</b> Каждый вложенный доллар в правильный объект возвращается каждый раунд. Ранние покупки — самые ценные, а неистраченные деньги в финале почти ничего не стоят.</li>
        <li><b>Специализируйтесь, но не в моно.</b> 2–3 объекта в районе включают синергию и оправдывают профильную роль; полные 4 уязвимы к блокировкам.</li>
        <li><b>Роль — это темп и защита.</b> Возьмите роль, которая усиливает вашу основную стратегию, а не «самую сильную» абстрактно.</li>
        <li><b>Скандалы — расходный ресурс, а не катастрофа.</b> Планируйте чистку заранее и не переступайте порог 5 без нужды.</li>
        <li><b>Атакуйте лидера, защищайте лид.</b> Карты и способности эффективнее всего сбивают вырвавшегося вперёд; в лиде держите Крышу и запас чистки.</li>
        <li><b>Отставание — не приговор.</b> Последний по очкам начинает раунд и первым выбирает и с рынка, и с доски проектов. Разрыв закрывается доступом, а не деньгами.</li>
        <li><b>Считайте финал.</b> В последних раундах конвертируйте кэш и влияние в очки: проекты, объекты подороже, удержание роли. Кэш, доживший до финала, — потерянные очки.</li>
      </ol>
    </section>
  </main>
</div>
<footer>Каталог: ${escapeHtml(meta.content_version)} · документ сгенерирован из актуальных данных игры.</footer>
</body>
</html>`;
}
