import { useTranslation } from "react-i18next";
import type { LogSegment } from "../../online/gameUi";
import { Modal } from "../primitives/Modal";
import { ResourceIcon } from "../primitives/ResourceIcon";
import { ResourceText } from "../primitives/ResourceIcon";
import type { Briefing, BriefingTone } from "./briefing";

/* Окно «что произошло, пока вы не ходили».
 *
 * Открывается само в начале своего хода и только если есть о чём говорить. Зелёным —
 * то, что игроку выгодно, красным — то, чем его задели, обычным цветом — нейтральные
 * движения вроде выплат за раунд.
 */

const toneClass: Record<BriefingTone, string> = {
  good: "text-good",
  bad: "text-bad",
  neutral: "text-ink",
};

const toneBorder: Record<BriefingTone, string> = {
  good: "border-good/40",
  bad: "border-bad/40",
  neutral: "border-line",
};

function Segments({ segments }: { segments: LogSegment[] }) {
  return (
    <>
      {segments.map((segment, position) => {
        if (segment.kind === "player") {
          return (
            <b key={position} style={{ color: segment.color }} className="font-semibold">
              <ResourceText>{segment.text}</ResourceText>
            </b>
          );
        }
        if (segment.kind === "num") {
          return (
            <b
              key={position}
              className={`font-semibold ${
                segment.tone === "good" ? "text-good" : segment.tone === "bad" ? "text-bad" : "text-ink"
              }`}
            >
              <ResourceText>{segment.text}</ResourceText>
            </b>
          );
        }
        return <span key={position}><ResourceText>{segment.text}</ResourceText></span>;
      })}
    </>
  );
}

export function TurnBriefingModal({
  briefing,
  onClose,
  onOpenLog,
}: {
  briefing: Briefing | null;
  onClose: () => void;
  /** Сводка показывает только то, что задело игрока; всё остальное — в полной хронике. */
  onOpenLog: () => void;
}) {
  // The hook before the early return: the briefing appears after the first render, and a hook that
  // only runs once it does changes the hook order between renders.
  const { t } = useTranslation("game");
  if (!briefing) return null;

  const arrow = "→";

  return (
    <Modal
      open
      onClose={onClose}
      title={t("ui.briefing.title")}
      subtitle={
        briefing.fromRound === briefing.round
          ? t("ui.briefing.round", { round: briefing.round })
          : t("ui.briefing.rounds", { from: briefing.fromRound, to: briefing.round })
      }
      width={860}
      headerAction={
        <button
          type="button"
          data-ui="briefing-open-log"
          onClick={() => {
            onClose();
            onOpenLog();
          }}
          className="primary-button shrink-0 rounded-md px-3 py-1.5 text-[13px] font-bold"
        >
          📜 {t("ui.briefing.openLog")}
        </button>
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
            font-semibold hover:border-accent"
        >
          {t("ui.briefing.go")}
        </button>
      }
    >
      <div className="grid gap-3">
        {briefing.flags.length > 0 && (
          <section className="grid gap-1">
            <h3 className="text-2xs font-bold uppercase tracking-wide text-ink-dim">{t("ui.briefing.important")}</h3>
            <ul className="grid gap-1">
              {briefing.flags.map(flag => (
                <li
                  key={flag.key}
                  className={`rounded-md border-l-2 bg-panel-2 px-2.5 py-2 text-xs font-semibold
                    ${toneBorder[flag.tone]} ${toneClass[flag.tone]}`}
                >
                  {flag.tone === "bad" ? "▼ " : flag.tone === "good" ? "▲ " : "• "}
                  {flag.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {briefing.stats.length > 0 && (
          <section className="grid gap-1">
            <h3 className="text-2xs font-bold uppercase tracking-wide text-ink-dim">
              {t("ui.briefing.stats", { arrow })}
            </h3>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-1">
              {briefing.stats.map(stat => {
                const delta = stat.to - stat.from;
                return (
                  <li
                    key={stat.key}
                    className="flex items-baseline gap-1.5 rounded-md bg-panel-2 px-2.5 py-2 text-xs"
                  >
                    <span className="flex w-4 shrink-0 justify-center text-ink-dim">
                      {typeof stat.icon === "string" && ["money", "influence", "actions", "scandal", "roof", "score"].includes(stat.icon)
                        ? <ResourceIcon name={stat.icon as "money" | "influence" | "actions" | "scandal" | "roof" | "score"} size="1em" />
                        : stat.icon}
                    </span>
                    <span className="flex-1 truncate text-ink-muted">{stat.label}</span>
                    <span className="text-ink-dim">{stat.from}</span>
                    <span className="text-ink-dim">{arrow}</span>
                    <b className="text-ink">{stat.to}</b>
                    <b className={toneClass[stat.tone]}>
                      ({delta > 0 ? "+" : "−"}
                      {Math.abs(delta)})
                    </b>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="grid gap-1">
          <h3 className="text-2xs font-bold uppercase tracking-wide text-ink-dim">
            {t("ui.briefing.done", { count: briefing.lines.length })}
          </h3>
          {briefing.lines.length === 0 ? (
            <p className="rounded-md bg-panel-2 px-2.5 py-2 text-xs text-ink-dim">
              {t("ui.briefing.nothing")}
            </p>
          ) : (
            <ol className="grid gap-1">
              {briefing.lines.map(line => (
                <li
                  key={line.seq}
                  className={`flex flex-wrap items-baseline gap-x-1 rounded-md border-l-2 bg-panel-2
                    px-2.5 py-2 text-xs ${toneBorder[line.tone]} ${toneClass[line.tone]}`}
                >
                  <span className="mr-1 text-3xs text-ink-dim">#{line.seq}</span>
                  <Segments segments={line.segments} />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}
