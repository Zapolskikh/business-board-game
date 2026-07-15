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

function roleSection(role: RoleMeta): string {
  return `
    <div class="role-card" style="--role:${escapeHtml(role.color)}">
      <h3>${escapeHtml(role.icon)} ${escapeHtml(role.title)}</h3>
      <p class="passive"><b>Пассивно:</b> ${escapeHtml(role.passive)}</p>
      <p class="power"><b>Способность:</b> ${escapeHtml(role.power)}</p>
    </div>`;
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
  .role-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .role-card { padding: 14px; background: var(--panel2); border: 1px solid var(--border); border-left: 4px solid var(--role); border-radius: 10px; }
  .role-card h3 { margin: 0 0 8px; color: var(--role); }
  .role-card p { margin: 0 0 6px; font-size: 13px; }
  .district-desc { color: var(--dim); font-size: 13px; }
  h3[style*="--district"] { color: var(--district); }
  .kpi { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0; }
  .kpi div { padding: 12px; text-align: center; background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; }
  .kpi b { display: block; font-size: 22px; color: var(--accent); }
  .kpi span { font-size: 12px; color: var(--dim); }
  code { padding: 1px 5px; background: #0a0f16; border: 1px solid var(--border); border-radius: 5px; font-size: 13px; }
  footer { max-width: 1180px; margin: 0 auto; padding: 0 24px; color: var(--dim); font-size: 12px; text-align: center; }
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
      <p>Свободная роль стоит <b>${rolePrice}◆</b> и 1 действие; перехват занятой — <b>${rolePrice * 3}◆</b>. Роль даёт постоянный пассивный бонус и активные способности. У игрока одна роль (плюс временный мандат от карты). Роль в финале даёт +3 очка.</p>
      <div class="role-grid">${meta.roles.map(roleSection).join("")}</div>
      <div class="warn"><b>Важно:</b> при 5 скандалах роль <b>теряется</b>, при перехвате роль уходит сопернику. Лоббистское бюро (объект) возвращает бывшему владельцу 2◆ при потере роли.</div>
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
