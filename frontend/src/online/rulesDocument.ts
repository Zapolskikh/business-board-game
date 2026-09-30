import type { CityMeta, RoleMeta } from "./types";
import i18next from "../i18n";
import {
  campaignTiers,
  crisisPrInfluence,
  influencePerPoint,
  lobbying,
  marketRotationSize,
  moneyPerPoint,
  patronage,
  projectPerkText,
  projectRequirementText,
  projectRerollMoney,
  rarityLabels,
  tagLabel,
} from "./gameUi";
import { projectArt, projectIcon, projectKind, statIcon } from "../ui/assets/cards";
import { resourceIconsInHtml } from "../ui/primitives/ResourceIcon";
import { bookRu } from "./rules/ru";
import { bookEn } from "./rules/en";
import { bookCs } from "./rules/cs";

/* Книга правил «Города влияния».
 *
 * Текст глав — отдельный на каждом языке (rules/ru.ts, en.ts, cs.ts): это связная проза, и резать
 * её на сотни ключей значит потерять смысл при переводе. Общее здесь — числа, которые берутся из
 * движка и каталога, и таблицы каталога: так книга не расходится с игрой ни на одном языке.
 * Каталог приходит уже переведённым (см. i18n/catalog.ts), поэтому названия и тексты карт в
 * таблицах — на языке игрока.
 */

/** Глава книги правил: окно рисует оглавление по `title` и листает главы по одной. */
export interface RulesChapter {
  id: string;
  icon: string;
  title: string;
  /** Разметка главы. Стили — `.rules-book` в theme.css, своих `<style>` в тексте нет. */
  html: string;
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

const rarityOrder: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

/* Район → роль, которая получает с него +1$ за объект. Зеркало ROLE_DISTRICTS в движке. */
const districtRole: Record<string, string> = {
  business: "capitalist",
  government: "politician",
  tech: "fraudster",
  shadows: "mafia",
  industrial: "military",
};

/** Описание роли для книги: коротко, по делу, с ценой и лимитом каждой способности. */
export interface RoleGuide {
  style: string;
  perks: string[];
  powers: { name: string; cost: string; limit: string; effect: string }[];
  tip?: string;
  warning?: string;
}

export interface TableLabels {
  asset: string;
  price: string;
  income: string;
  influence: string;
  effect: string;
  roleNote: (role: string) => string;
  card: string;
  type: string;
  target: string;
  onTarget: string;
  onSelf: string;
  tone: Record<string, string>;
  project: string;
  points: string;
  condition: string;
  perk: string;
  roleHeads: { perks: string; powers: string; cost: string; limit: string; effect: string; tip: string; warning: string };
  onMarketFrom: (round: number) => string;
  and: string;
}

/** Всё, что главам нужно из движка и каталога. Главы только расставляют это по тексту. */
export interface RulesContext {
  meta: CityMeta;
  rolePrice: number;
  e: typeof escapeHtml;
  n: {
    moneyPerPoint: number;
    influencePerPoint: number;
    patronage: { money: number; points: number };
    lobbying: { influence: number; points: number };
    campaign: { spend: number; gain: number }[];
    crisisPr: number;
    reroll: number;
    rotation: number;
    projectBoardSize: number;
    cardCost: number;
    discard: number;
    capacityCosts: number[];
    pumpBase: number;
    hackBase: number;
    roofBreakPoint: number;
    greySuccess: number;
    greyFailure: number;
    greyChance: (id: string, fallback: number) => number;
    greyPoints: (id: string, fallback: number) => number;
  };
  roleTitle: (id: string) => string;
  districtTitle: (id: string) => string;
  /** Название тега на языке игрока. */
  tag: (id: string) => string;
  /** «X и Y» / «X, Y and Z» по правилам языка. */
  list: (items: string[], and: string) => string;
  selfTargetCards: string[];
  html: {
    rarityLadder: (labels: TableLabels) => string;
    districtRoles: () => string;
    assetTables: (labels: TableLabels) => string;
    projectTable: (labels: TableLabels) => string;
    projectExample: (labels: {
      heading: string;
      caption: string;
      title: string;
      points: string;
      condition: string;
      price: string;
      reward: string;
      action: string;
    }) => string;
    cardTable: (labels: TableLabels) => string;
    roleCards: (guides: Record<string, RoleGuide>, labels: TableLabels) => string;
  };
}

function listJoin(items: string[], and: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}${and}${items[items.length - 1]}`;
}

function context(meta: CityMeta, rolePrice: number): RulesContext {
  const e = escapeHtml;
  const roleTitle = (id: string) => meta.roles.find(role => role.id === id)?.title ?? id;
  const districtTitle = (id: string) => meta.districts.find(district => district.id === id)?.title ?? id;
  const scoring = meta.scoring;

  const roleCard = (role: RoleMeta, guide: RoleGuide | undefined, labels: TableLabels): string => {
    if (!guide) {
      return `<article class="role-card" style="--role:${e(role.color)}">
        <header class="role-card-head"><h3>${e(role.icon)} ${e(role.title)}</h3></header>
        <p>${e(role.passive)}</p><p>${e(role.power)}</p></article>`;
    }
    const heads = labels.roleHeads;
    return `
    <article class="role-card" style="--role:${e(role.color)}">
      <header class="role-card-head"><h3>${e(role.icon)} ${e(role.title)}</h3><p>${guide.style}</p></header>
      <div class="role-details">
        <div class="role-perks"><h4>${heads.perks}</h4><ul>${guide.perks.map(perk => `<li>${perk}</li>`).join("")}</ul></div>
        <div class="role-powers-guide"><h4>${heads.powers}</h4>${guide.powers.map(power => `
          <div class="role-power-guide">
            <h5>${power.name}</h5>
            <p class="role-power-meta"><span><b>${heads.cost}:</b> ${power.cost}</span><span><b>${heads.limit}:</b> ${power.limit}</span></p>
            <p>${power.effect}</p>
          </div>`).join("")}</div>
      </div>
      ${guide.tip ? `<p class="role-advice"><b>${heads.tip}:</b> ${guide.tip}</p>` : ""}
      ${guide.warning ? `<p class="role-warning"><b>${heads.warning}:</b> ${guide.warning}</p>` : ""}
    </article>`;
  };

  return {
    meta,
    rolePrice,
    e,
    n: {
      moneyPerPoint: moneyPerPoint(meta),
      influencePerPoint: influencePerPoint(meta),
      patronage: patronage(meta),
      lobbying: lobbying(meta),
      campaign: campaignTiers(meta),
      crisisPr: crisisPrInfluence(meta),
      reroll: projectRerollMoney(meta),
      rotation: marketRotationSize(meta),
      projectBoardSize: scoring?.project_board_size ?? 4,
      cardCost: scoring?.action_card_cost ?? 3,
      discard: scoring?.card_discard_value ?? 2,
      capacityCosts: Object.values(scoring?.capacity_costs ?? { 3: 6, 4: 10, 5: 15 }),
      pumpBase: scoring?.pump_drain_base ?? 2,
      hackBase: scoring?.hack_influence_base ?? 2,
      roofBreakPoint: scoring?.roof_break_point_per_roof ?? 1,
      greySuccess: scoring?.grey_success_scandals ?? 1,
      greyFailure: scoring?.grey_failure_scandals ?? 2,
      greyChance: (id, fallback) => Math.round((scoring?.grey_operation_chance?.[id] ?? fallback / 100) * 100),
      greyPoints: (id, fallback) => scoring?.grey_operation_points?.[id] ?? fallback,
    },
    roleTitle,
    districtTitle,
    tag: tagLabel,
    list: listJoin,
    selfTargetCards: meta.action_cards.filter(card => card.self_target).map(card => `«${e(card.title)}»`),
    html: {
      rarityLadder: labels =>
        `<ul class="rarity-ladder">${Object.keys(rarityOrder)
          .map(rarity => {
            const costs = meta.assets.filter(asset => asset.rarity === rarity).map(asset => asset.cost);
            if (!costs.length) return "";
            const low = Math.min(...costs);
            const high = Math.max(...costs);
            const round = meta.rarity_min_round?.[rarity];
            return `<li><b>${e(rarityLabels[rarity] ?? rarity)}</b> — ${low === high ? low : `${low}–${high}`}$${round ? `, ${labels.onMarketFrom(round)}` : ""}</li>`;
          })
          .join("")}</ul>`,
      districtRoles: () =>
        `<ul>${meta.districts
          .filter(district => districtRole[district.id])
          .map(district => `<li><b>${e(district.icon)} ${e(district.title)}</b> → ${e(roleTitle(districtRole[district.id]))}</li>`)
          .join("")}</ul>`,
      assetTables: labels =>
        meta.districts
          .map(district => {
            const assets = meta.assets
              .filter(asset => asset.district === district.id)
              .sort((a, b) => (rarityOrder[a.rarity] ?? 0) - (rarityOrder[b.rarity] ?? 0) || a.cost - b.cost);
            if (!assets.length) return "";
            const role = districtRole[district.id];
            const note = role ? ` ${labels.roleNote(e(roleTitle(role)))}` : "";
            return `
      <h3 style="--district:${e(district.color)}">${e(district.icon)} ${e(district.title)}</h3>
      <p class="district-desc">${e(district.description)}${note}</p>
      <table class="assets">
        <thead><tr><th>${labels.asset}</th><th>${labels.price}</th><th>${labels.income}</th><th>${labels.influence}</th><th>${labels.effect}</th></tr></thead>
        <tbody>${assets
          .map(asset => `
          <tr class="rarity-${e(asset.rarity)}">
            <td class="name"><b>${e(asset.title)}</b><span class="badge">${e(rarityLabels[asset.rarity] ?? asset.rarity)}</span>${
              asset.tags.length ? `<small class="tags">${asset.tags.map(tag => e(tagLabel(tag))).join(" · ")}</small>` : ""
            }</td>
            <td class="num">${asset.cost}$</td>
            <td class="num">${asset.income}$</td>
            <td class="num">${asset.influence}◆</td>
            <td class="effect">${e(asset.text)}</td>
          </tr>`)
          .join("")}</tbody>
      </table>`;
          })
          .join(""),
      projectTable: labels => `
      <table>
        <thead><tr><th>${labels.project}</th><th>${labels.price}</th><th>${labels.points}</th><th>${labels.condition}</th><th>${labels.perk}</th></tr></thead>
        <tbody>${[...meta.projects]
          .sort((a, b) => b.points - a.points || a.title.localeCompare(b.title))
          .map(project => `
          <tr>
            <td class="name"><b>${e(project.title)}</b></td>
            <td>${project.cost_influence}◆ + ${project.cost_money}$</td>
            <td><b>${project.points}</b></td>
            <td>${e(projectRequirementText(project, meta))}</td>
            <td class="effect">${e(projectPerkText(project))}</td>
          </tr>`)
          .join("")}</tbody>
      </table>`,
      projectExample: labels => {
        const project = meta.projects.find(item => Object.keys(item.perk ?? {}).length) ?? meta.projects[0];
        if (!project) return "";
        const kind = projectKind(project.perk);
        const art = projectArt(kind);
        const icon = projectIcon(kind);
        const scoreIcon = statIcon("score");
        const artStyle = art ? ` style="--rules-project-art: url('${e(art)}')"` : "";
        return `
        <figure class="rules-project-figure">
          <figcaption><b>${e(labels.heading)}</b><span>${e(labels.caption)}</span></figcaption>
          <div class="rules-project-layout">
            <article class="rules-project-card" data-kind="${e(kind)}"${artStyle}>
              <header><b>${e(project.title)}</b><span>${scoreIcon ? `<img src="${e(scoreIcon)}" alt="">` : "★"}<strong>${project.points}</strong></span></header>
              <div class="rules-project-card-condition"><small>${e(labels.condition)}</small><b>${e(projectRequirementText(project, meta))}</b></div>
              <footer>
                <span><small>${e(labels.price)}</small><b>${project.cost_influence}◆ + ${project.cost_money}$</b></span>
                <span><small>${e(labels.reward)}</small><b>${icon ? `<img src="${e(icon)}" alt="">` : "🎁"}${e(projectPerkText(project))}</b></span>
              </footer>
            </article>
            <ol class="rules-project-annotations">
              <li><b>1 · ${e(labels.title)}</b><span>${e(project.title)}</span></li>
              <li><b>2 · ${e(labels.points)}</b><span>${project.points}</span></li>
              <li><b>3 · ${e(labels.condition)}</b><span>${e(projectRequirementText(project, meta))}</span></li>
              <li><b>4 · ${e(labels.price)}</b><span>${project.cost_influence}◆ + ${project.cost_money}$ + ${e(labels.action)}</span></li>
              <li><b>5 · ${e(labels.reward)}</b><span>${e(projectPerkText(project))}</span></li>
            </ol>
          </div>
        </figure>`;
      },
      cardTable: labels => `
      <table>
        <thead><tr><th>${labels.card}</th><th>${labels.type}</th><th>${labels.target}</th><th>${labels.effect}</th></tr></thead>
        <tbody>${meta.action_cards
          .map(card => `
          <tr class="tone-${e(card.tone)}">
            <td class="name"><b>${e(card.title)}</b></td>
            <td>${e(labels.tone[card.tone] ?? card.tone)}</td>
            <td>${card.targeted ? labels.onTarget : labels.onSelf}</td>
            <td class="effect">${e(card.text)}</td>
          </tr>`)
          .join("")}</tbody>
      </table>`,
      roleCards: (guides, labels) =>
        `<div class="role-grid">${meta.roles.map(role => roleCard(role, guides[role.id], labels)).join("")}</div>`,
    },
  };
}

const books: Record<string, (ctx: RulesContext) => RulesChapter[]> = { ru: bookRu, en: bookEn, cs: bookCs };

/** Книга на текущем языке игры. */
export function buildRulesBook(meta: CityMeta, rolePrice: number): RulesChapter[] {
  const build = books[i18next.language] ?? books.en;
  return build(context(meta, rolePrice)).map(chapter => ({
    ...chapter,
    html: resourceIconsInHtml(chapter.html),
  }));
}
