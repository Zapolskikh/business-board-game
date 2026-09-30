/* Графика карточек: рынок, проекты, игроки.
 *
 * Файлы нарезаются из /presets скриптом frontend/scripts/build-card-art.py — руками их
 * не правят. Сюда они попадают через Vite: каждый получает хэш в имени и кэшируется навсегда.
 */
const files = import.meta.glob<string>("./*.webp", { eager: true, import: "default" });

function art(name: string): string | undefined {
  return files[`./${name}.webp`];
}

/** Акварельная улица района — фон карточки рынка. */
export const districtArt = (district: string | undefined): string | undefined =>
  district ? art(`district-${district}`) : undefined;

export const districtIcon = (district: string | undefined): string | undefined =>
  district ? art(`district-icon-${district}`) : undefined;

export const rarityIcon = (rarity: string): string | undefined =>
  art(`rarity-${rarity}`) ?? art("rarity-common");

/* Категория проекта — по тому, что он даёт каждый раунд. Редкостей у проектов нет:
 * золотой фон значит «особый постоянный бонус», а не «ценнее остальных». */
export type ProjectKind = "money" | "influence" | "unique" | "points";

export function projectKind(perk: Record<string, number> | undefined): ProjectKind {
  const keys = Object.keys(perk ?? {});
  if (keys.length === 0) return "points";
  if (keys.length === 1 && keys[0] === "passiveMoney") return "money";
  if (keys.length === 1 && keys[0] === "passiveInfluence") return "influence";
  return "unique";
}

export const projectArt = (kind: ProjectKind): string | undefined => art(`project-${kind}`);
export const projectIcon = (kind: ProjectKind | "score"): string | undefined => art(`project-icon-${kind}`);

/** Значок роли; без роли — нейтральный силуэт. */
export const roleIcon = (role: string | undefined): string | undefined =>
  art(`role-${role ?? "none"}`) ?? art("role-none");

export type ResourceIcon = "money" | "influence" | "actions" | "scandal" | "roof" | "score";

/* Очки везде рисуются лавровым венком с карточек проектов: медаль из листа игроков
 * читалась как ещё одна монета рядом с деньгами. */
export const statIcon = (stat: ResourceIcon): string | undefined =>
  stat === "score" ? art("project-icon-points") : art(`stat-${stat}`);

export const playerFrame = art("player-frame");

/** Лента редкости в правом верхнем углу карточки объекта. */
export const rarityRibbon = (rarity: string): string | undefined =>
  art(`ribbon-${rarity}`) ?? art("ribbon-common");

export const pricePlaque = art("price-plaque");
