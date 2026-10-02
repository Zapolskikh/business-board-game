import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { describeEventSegments, greyOperationLabels } from "../../online/gameUi";
import type { CityMeta, DomainEvent, GameState } from "../../online/types";
import { Modal } from "../primitives/Modal";
import { LogSegments } from "./LogSegments";

const DIE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

/* Результат своей серой операции — отдельным окном поверх доски, с кнопкой «ОК».
 *
 * Кубик бросает сервер, и раньше игрок видел только, что ресурсы как-то изменились: что выпало
 * и чем кончилось, читалось в хронике. Окно ловит своё событие `grey_operation_resolved` среди
 * новых событий партии и показывает бросок, модификатор, итоговую грань, исход и всё, что
 * операция задела — те же строки, что и в хронике, следом за самим броском.
 *
 * События, которые были до монтирования, не показываются: перезагрузка страницы не должна
 * заново выкидывать окно о броске, который игрок уже видел.
 */
export function GreyResult({ game, meta, meId }: { game: GameState; meta: CityMeta; meId: string }) {
  const { t } = useTranslation("game");
  const seen = useRef<number | null>(null);
  const [result, setResult] = useState<{ roll: DomainEvent; after: DomainEvent[] } | null>(null);

  useEffect(() => {
    const last = game.event_log.length > 0 ? game.event_log[game.event_log.length - 1].seq : 0;
    if (seen.current === null) {
      seen.current = last;
      return;
    }
    const fresh = game.event_log.filter(event => event.seq > (seen.current ?? 0));
    seen.current = last;
    const position = fresh.findIndex(event => event.type === "grey_operation_resolved" && event.actor_id === meId);
    if (position < 0) return;
    // Что операция задела следом: сломанные Защиты, отражённые удары, потерянные роли.
    setResult({ roll: fresh[position], after: fresh.slice(position + 1) });
  }, [game.event_log, meId]);

  if (!result) return null;
  const data = result.roll.data;
  const roll = Number(data.roll ?? 0);
  const modifier = Number(data.modifier ?? 0);
  const face = Number(data.face ?? roll);
  const tier = String(data.tier ?? "fail");
  const blocked = Boolean(data.blocked);
  const sources = (Array.isArray(data.modifier_sources) ? data.modifier_sources : []).map(source => {
    const role = meta.roles.find(item => item.id === source);
    return role ? role.title : t("ui.greyResult.sourceCard");
  });
  const outcome = blocked
    ? { text: t("event.greyBlocked"), className: "border-[#6b3a41] bg-[#2a171b] text-bad" }
    : tier === "full"
      ? { text: t("event.greyFull"), className: "border-good bg-[#1a2a21] text-good" }
      : tier === "weak"
        ? { text: t("event.greyWeak"), className: "border-[#7a6a3a] bg-[#2a2516] text-gold" }
        : { text: t("event.greyFailure"), className: "border-[#6b3a41] bg-[#2a171b] text-bad" };
  const title = greyOperationLabels[String(data.asset_id)] ?? String(data.asset_id);
  const target = game.players.find(player => player.id === data.target_id);
  const effects = [result.roll, ...result.after]
    .map(event => ({ seq: event.seq, segments: describeEventSegments(event, game, meta) }))
    .filter(line => line.segments.length > 0);
  const close = () => setResult(null);

  return (
    <Modal
      open
      onClose={close}
      title={t("ui.greyResult.title", { operation: title })}
      subtitle={target ? t("ui.greyResult.target", { name: target.name }) : undefined}
      width={460}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            data-ui="grey-result-ok"
            onClick={close}
            autoFocus
            className="primary-button rounded-md px-5 py-1.5 text-[13px] font-semibold"
          >
            {t("ui.greyResult.ok")}
          </button>
        </div>
      }
    >
      <div data-ui="grey-result" className="grid gap-3 text-[13px]">
        <div className="flex items-center justify-center gap-4">
          <div className="grid justify-items-center">
            <span aria-hidden="true" className="text-[64px] leading-none text-ink">{DIE_FACES[roll - 1] ?? "🎲"}</span>
            <small className="text-ink-dim">{t("ui.greyResult.roll", { roll })}</small>
          </div>
          {modifier !== 0 && (
            <>
              <span className="text-2xl font-bold text-good">+{modifier}</span>
              <span className="text-2xl text-ink-dim">→</span>
              <div className="grid justify-items-center">
                <b className="text-[44px] leading-none text-ink">{face}</b>
                <small className="text-ink-dim">{t("ui.greyResult.face")}</small>
              </div>
            </>
          )}
        </div>
        {modifier !== 0 && sources.length > 0 && (
          <p className="text-center text-ink-muted">{t("ui.greyResult.sources", { sources: sources.join(", ") })}</p>
        )}
        <p className={`rounded-md border px-3 py-2 text-center text-[15px] font-bold ${outcome.className}`}>{outcome.text}</p>
        <p className="text-center text-2xs text-ink-dim">{t("ui.greyResult.scale")}</p>
        {effects.length > 0 && (
          <ol className="grid gap-1">
            {effects.map(line => (
              <li key={line.seq} className="flex flex-wrap items-baseline gap-x-1 rounded-md bg-panel-2 px-2 py-1.5">
                <LogSegments segments={line.segments} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
