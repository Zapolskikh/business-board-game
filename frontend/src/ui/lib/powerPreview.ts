import { tr } from "../../i18n";
import type { GameState, PlayerState, PowerPreview } from "../../online/types";

/* Без этого выбор цели — гадание: список показывает очки соперника, но не то, сколько
 * с него снимут. Движок считает добычу заранее (`power_previews`) тем же кодом,
 * который способность исполняет, — здесь мы только печатаем его числа.
 */
export function findPreview(
  game: GameState,
  power: string,
  targetId: string | undefined,
): PowerPreview | undefined {
  if (!targetId) return undefined;
  return (game.power_previews ?? []).find(item => item.power === power && item.target_id === targetId);
}

/** Что способность снимет с цели — короткой строкой. Пусто, если движок ничего не обещает. */
export function previewGain(preview: PowerPreview | undefined): string {
  if (!preview) return "";
  const parts: string[] = [];
  if (preview.money) parts.push(`${preview.money}$`);
  if (preview.influence) parts.push(`${preview.influence}◆`);
  if (preview.scandals) parts.push(`⚠+${preview.scandals}`);
  if (preview.roofs) parts.push(`🛡−${preview.roofs}`);
  if (preview.strips_role) parts.push(tr("game", "ui.preview.stripsRole"));
  return parts.join(" · ");
}

/** Побочная цена для самого игрока — её легко не заметить, поэтому она отдельной строкой. */
export function previewCost(preview: PowerPreview | undefined): string {
  if (!preview) return "";
  const parts: string[] = [];
  if (preview.self_scandals) parts.push(tr("game", "ui.preview.selfScandals", { count: preview.self_scandals }));
  if (preview.leader_bonus) parts.push(tr("game", "ui.preview.leader"));
  return parts.join(" · ");
}

/* Таблица выбора цели: что потеряет цель и что достанется игроку — двумя колонками, а не одной
 * строкой «7$ · 2◆», в которой не видно, чьё это. Если Защита цели гасит удар, обе колонки
 * говорят об этом прямо: цель теряет только Защиту, игрок не получает ничего. */
export function previewTargetLoss(preview: PowerPreview | undefined): string {
  if (!preview) return "";
  if (preview.blocked_by_roof) return tr("game", "ui.preview.roofEats");
  const parts: string[] = [];
  if (preview.money) parts.push(`−${preview.money}$`);
  if (preview.influence) parts.push(`−${preview.influence}◆`);
  if (preview.scandals) parts.push(`⚠+${preview.scandals}`);
  if (preview.roofs) parts.push(`🛡−${preview.roofs}`);
  if (preview.strips_role) parts.push(tr("game", "ui.preview.losesRole"));
  return parts.join(" · ");
}

export function previewYouGet(preview: PowerPreview | undefined): string {
  if (!preview) return "";
  const parts: string[] = [];
  if (!preview.blocked_by_roof) {
    // Деньги и влияние в превью — это добыча рэкета и санкций: они переходят к игроку.
    if (preview.money) parts.push(`+${preview.money}$`);
    if (preview.influence) parts.push(`+${preview.influence}◆`);
    if (preview.roofs) parts.push(`+${preview.roofs}🛡`);
    if (preview.leader_bonus) parts.push(tr("game", "ui.preview.leader"));
  }
  if (preview.self_scandals) parts.push(tr("game", "ui.preview.selfScandals", { count: preview.self_scandals }));
  return parts.join(" · ") || tr("game", "ui.preview.nothing");
}

/* Ресурсы цели: сперва тот, за которым идёт способность, чтобы было видно,
 * есть ли там вообще что брать. Крыша и скандалы — как в остальных списках. */
export function targetStats(
  target: PlayerState,
  preview: PowerPreview | undefined,
  blockedByRoof: boolean,
): string {
  const wantsInfluence = Boolean(preview?.influence) && !preview?.money;
  const parts = wantsInfluence
    ? [`${target.influence}◆`, `${target.money}$`]
    : [`${target.money}$`, `${target.influence}◆`];
  parts.push(`⚠${target.scandals}/${target.scandal_limit}`);
  parts.push(`🛡${target.roofs}${target.roofs > 0 && blockedByRoof ? tr("game", "ui.preview.roofBlocks") : ""}`);
  return parts.join(" · ");
}

export function scoreOf(game: GameState, targetId: string | undefined): number {
  return game.score_breakdown?.[targetId ?? ""]?.total ?? 0;
}
