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
  if (preview.strips_role) parts.push("снимет роль");
  return parts.join(" · ");
}

/** Побочная цена для самого игрока — её легко не заметить, поэтому она отдельной строкой. */
export function previewCost(preview: PowerPreview | undefined): string {
  if (!preview) return "";
  const parts: string[] = [];
  if (preview.self_scandals) parts.push(`вам ⚠+${preview.self_scandals}`);
  if (preview.leader_bonus) parts.push("лидер — удвоено");
  return parts.join(" · ");
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
  parts.push(`🛡${target.roofs}${target.roofs > 0 && blockedByRoof ? " — погасит" : ""}`);
  return parts.join(" · ");
}

export function scoreOf(game: GameState, targetId: string | undefined): number {
  return game.score_breakdown?.[targetId ?? ""]?.total ?? 0;
}
