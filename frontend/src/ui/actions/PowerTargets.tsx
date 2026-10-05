import { useTranslation } from "react-i18next";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { GameState, LegalAction, PlayerState } from "../../online/types";
import { ResourceText } from "../primitives/ResourceIcon";
import { findPreview, previewTargetLoss, previewYouGet, scoreOf, targetStats } from "../lib/powerPreview";

/* Кнопка, которая открывает окно способности.
 *
 * Отдельная от `ActionButton`, потому что окно (Radix Trigger с `asChild`) передаёт кнопке свой
 * обработчик клика и ref, а `ActionButton` принимает только свои свойства и молча их теряет: так
 * кнопка способности нажималась и ничего не открывала. Здесь всё лишнее уходит прямо в <button>. */
export const PowerTrigger = forwardRef<
  HTMLButtonElement,
  { label: string; hint: string; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>
>(function PowerTrigger({ label, hint, danger, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`grid min-w-0 gap-0.5 rounded-md border bg-panel-2 px-2 py-1.5 hover:bg-panel-3
        ${danger ? "border-bad/50 hover:border-bad" : "border-line hover:border-line-2"} ${className ?? ""}`}
    >
      <b className={`overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold ${danger ? "text-bad" : "text-ink"}`}>
        {label}
      </b>
      <small className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-ink-muted">{hint}</small>
    </button>
  );
});

export interface TargetRow {
  target: PlayerState;
  /** Команда для этой цели. Без неё строка только показывает результат — для способностей, где
   * цели выбирает не игрок, а правило (проверка Силовика бьёт по всем в Сером секторе). */
  action?: LegalAction;
}

/** Цель слева, результат для игрока справа — таблицей с подписанными колонками. */
export function PowerResultTable({
  game,
  power,
  rows,
  blockedByRoof,
  onPick,
}: {
  game: GameState;
  power: string;
  rows: TargetRow[];
  blockedByRoof: boolean;
  onPick?: (action: LegalAction) => void;
}) {
  const { t } = useTranslation("game");
  const picking = Boolean(onPick) && rows.some(row => row.action);
  return (
    <table data-ui="power-targets" className="w-full border-collapse text-left text-xs">
      <thead>
        <tr className="text-3xs uppercase tracking-[0.06em] text-ink-dim">
          <th className="px-1.5 pb-1 font-semibold">{t("ui.preview.colTarget")}</th>
          <th className="px-1.5 pb-1 font-semibold">{t("ui.preview.colLoses")}</th>
          <th className="px-1.5 pb-1 font-semibold">{t("ui.preview.colYou")}</th>
          {picking && <th className="pb-1" />}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ target, action }) => {
          const preview = findPreview(game, power, target.id);
          const blocked = Boolean(preview?.blocked_by_roof);
          return (
            <tr key={target.id} className="border-t border-line align-top">
              <td className="px-1.5 py-1.5">
                <b className="block text-ink">{target.name}</b>
                <small className="block text-3xs text-ink-muted">
                  <ResourceText>{targetStats(target, preview, blockedByRoof)}</ResourceText>
                </small>
                <small className="block text-3xs text-ink-dim">{t("ui.actions.pts", { count: scoreOf(game, target.id) })}</small>
              </td>
              <td className={`px-1.5 py-1.5 font-semibold ${blocked ? "text-ink-muted" : "text-bad"}`}>
                <ResourceText>{previewTargetLoss(preview) || "—"}</ResourceText>
              </td>
              <td className={`px-1.5 py-1.5 font-semibold ${blocked ? "text-ink-muted" : "text-good"}`}>
                <ResourceText>{previewYouGet(preview)}</ResourceText>
              </td>
              {picking && (
                <td className="py-1.5 pl-1 text-right">
                  {action && (
                    <button
                      type="button"
                      onClick={() => onPick?.(action)}
                      className="rounded-md border border-line-2 bg-panel-2 px-2 py-1 font-semibold text-ink
                        hover:border-accent hover:bg-panel-3"
                    >
                      {t("ui.preview.pick")}
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
