import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cityApi } from "./api";
import type { CityMeta, DomainEvent, LegalAction } from "./types";
import { useRoom } from "../ui/lib/session";
import { ResourceText } from "../ui/primitives/ResourceIcon";

const GameScreen = lazy(() => import("../ui/GameScreen").then(module => ({ default: module.GameScreen })));

/* Обучение: настоящий стол с заготовленной позицией (backend city_rooms/tutorial.py) и
 * проводник поверх доски.
 *
 * Сценарий живёт здесь, позиция — на сервере. Каждый шаг пропускает на доску только своё
 * действие (`allow`): остальные кнопки гаснут сами, потому что доска строится из списка
 * разрешённых действий. Шаг засчитывается по событию в хронике (`done`) — тому же, что
 * видит игрок, так что проводник не может «увидеть» то, чего не было.
 *
 * Тест backend/tests/test_tutorial.py проходит этот же сценарий через движок: если правило
 * поменяется и шаг станет невозможен, он упадёт раньше, чем новичок упрётся в серую кнопку.
 */

interface Step {
  id: string;
  /** Метки data-tutorial, которые подсвечиваются на доске. */
  anchors: string[];
  /** Действие, которое шаг пропускает на доску. Без него шаг — просто текст с кнопкой «Дальше». */
  allow?: (action: LegalAction) => boolean;
  /** Событие хроники, по которому шаг засчитан. */
  done?: (event: DomainEvent) => boolean;
  /** Реплика после выполнения — с кнопкой «Дальше», доска пока молчит. */
  after?: string;
  /** Окно-справка: кнопка «Понятно» вместо «Дальше». */
  info?: boolean;
}

const VICTOR = "seat-2";
const ME = "seat-1";

const is = (type: string, payload: Record<string, unknown> = {}) => (action: LegalAction) =>
  action.type === type && Object.entries(payload).every(([key, value]) => action.payload[key] === value);
const event = (type: string, data: Record<string, unknown> = {}) => (item: DomainEvent) =>
  item.type === type && item.actor_id === ME && Object.entries(data).every(([key, value]) => item.data[key] === value);

const STEPS: Step[] = [
  { id: "intro", anchors: [] },
  { id: "work", anchors: ["work"], allow: is("basic_action", { kind: "work" }), done: event("basic_action", { kind: "work" }), after: "workDone" },
  { id: "campaign", anchors: ["campaign"], allow: is("basic_action", { kind: "campaign" }), done: event("basic_action", { kind: "campaign" }) },
  { id: "buyObject", anchors: ["market-pharmacy_chain"], allow: is("buy_asset", { market_uid: "asset:pharmacy_chain" }), done: event("asset_bought", { asset_id: "pharmacy_chain" }) },
  { id: "role", anchors: ["roles"], allow: is("claim_role", { role_id: "journalist" }), done: event("role_claimed", { role_id: "journalist" }) },
  { id: "power", anchors: ["power-journalist_inflate", `player-${VICTOR}`], allow: is("use_role_power", { power: "journalist_inflate", target_id: VICTOR }), done: event("role_power_used", { power: "journalist_inflate" }) },
  { id: "scandals", anchors: [`player-${VICTOR}`], info: true },
  { id: "cards", anchors: ["draw-card"], allow: is("buy_action_card"), done: event("action_card_bought") },
  {
    id: "playCard",
   
    anchors: ["hand-mobilization"],
    allow: action => action.type === "play_action_card" && String(action.payload.card_uid).startsWith("card:mobilization:"),
    done: event("action_card_played", { card_id: "mobilization" }),
  },
  { id: "charity", anchors: ["project-charity_fund"], allow: is("city_project", { project_id: "charity_fund" }), done: event("city_project_taken", { project_id: "charity_fund" }) },
  { id: "terminal", anchors: ["market-smuggling", "project-river_port"], allow: is("buy_asset", { market_uid: "asset:smuggling" }), done: event("asset_bought", { asset_id: "smuggling" }) },
  { id: "port", anchors: ["project-river_port"], allow: is("city_project", { project_id: "river_port" }), done: event("city_project_taken", { project_id: "river_port" }) },
  { id: "grey", anchors: ["grey"], allow: is("grey_operation", { asset_id: "smear" }), done: event("grey_operation_resolved"), after: "greyDone" },
  { id: "roof", anchors: ["roof"], allow: is("buy_roof"), done: event("roof_bought") },
  { id: "roofInfo", anchors: [], info: true },
  { id: "lobbying", anchors: ["lobbying"], allow: is("basic_action", { kind: "lobbying" }), done: event("basic_action", { kind: "lobbying" }) },
  { id: "endTurn", anchors: ["end-turn"], allow: is("end_turn"), done: item => item.type === "turn_started" && item.actor_id === ME && item.data.round_number === 2 },
  { id: "roundEnd", anchors: [] },
  { id: "revenge", anchors: [] },
  { id: "finale", anchors: [] },
];

/** Сценарий целиком — для листа печати (`ui/dev/PrintBook`): те же шаги, что проходит игрок. */
export const TUTORIAL_STEPS: readonly Step[] = STEPS;

const NOTHING = () => false;

export function TutorialScreen({ meta, onExit }: { meta: CityMeta; onExit: () => void }) {
  const { t, i18n } = useTranslation("tutorial");
  const [session, setSession] = useState<{ roomId: string; password: string; playerId: string } | null>(null);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);

  const start = useCallback(() => {
    setError("");
    let name = t("defaultName");
    try {
      name = localStorage.getItem("city-player-name")?.trim() || name;
    } catch {
      // Хранилище недоступно — играем под именем по умолчанию.
    }
    cityApi
      .tutorial(name, i18n.language)
      .then(created => setSession({ roomId: created.room.id, password: created.password, playerId: created.player_id }))
      .catch(() => setError(t("ui.error")));
  }, [i18n.language, t]);

  useEffect(start, []); // eslint-disable-line react-hooks/exhaustive-deps

  const step = STEPS[position];
  const allowAction = useMemo(() => step.allow ?? NOTHING, [step]);

  if (error) {
    return (
      <main className="rooms-app app-state">
        <section className="rooms-panel">
          <p className="rooms-alert">{error}</p>
          <button className="rooms-button primary" onClick={start}>{t("ui.retry")}</button>
          <button className="rooms-button subtle" onClick={onExit}>{t("ui.menu")}</button>
        </section>
      </main>
    );
  }
  if (!session) {
    return <div className="rooms-app app-state"><span className="loading-ring" /><p>{t("ui.loading")}</p></div>;
  }

  return (
    <Suspense fallback={<div className="rooms-app app-state"><span className="loading-ring" /><p>{t("ui.loading")}</p></div>}>
      <GameScreen
        roomId={session.roomId}
        password={session.password}
        playerId={session.playerId}
        meta={meta}
        onExit={onExit}
        allowAction={allowAction}
        overlay={
          <Guide
            key={step.id}
            step={step}
            position={position}
            onNext={() => setPosition(current => Math.min(current + 1, STEPS.length - 1))}
            onExit={onExit}
          />
        }
      />
    </Suspense>
  );
}

/** Проводник одного шага: следит за хроникой, показывает реплику и подсвечивает цель. */
function Guide({ step, position, onNext, onExit }: { step: Step; position: number; onNext: () => void; onExit: () => void }) {
  const { t } = useTranslation("tutorial");
  const { data } = useRoom();
  const events = data?.game?.event_log ?? [];
  // Хроника на момент начала шага: засчитывается только то, что случилось после.
  const since = useRef<number | null>(null);
  if (since.current === null && data?.game) since.current = events.length ? events[events.length - 1].seq : 0;
  const [phase, setPhase] = useState<"doing" | "after">("doing");

  const done = Boolean(step.done && since.current !== null && events.some(item => item.seq > (since.current ?? 0) && step.done?.(item)));
  useEffect(() => {
    if (!done || phase !== "doing") return;
    if (step.after) setPhase("after");
    else onNext();
  }, [done, phase, step.after, onNext]);

  const waiting = Boolean(step.done) && phase === "doing";
  const text = t(`steps.${phase === "after" && step.after ? step.after : step.id}` as never) as string;
  const last = position === STEPS.length - 1;

  return (
    <>
      {waiting && <Spotlight anchors={step.anchors} />}
      <aside className="ui-v2 tutorial-guide" role="dialog" aria-labelledby="tutorial-narrator" aria-live="polite">
        <header className="tutorial-guide-head">
          <div className="tutorial-narrator">
            <strong id="tutorial-narrator">{t("narrator.name")}</strong>
          </div>
          <span className="tutorial-counter">{t("ui.step", { current: position + 1, total: STEPS.length })}</span>
        </header>
        <div className="tutorial-guide-body">
          {text.split("\n\n").map((paragraph, index) => {
            const lines = paragraph.split("\n").filter(Boolean);
            const firstBullet = lines.findIndex(line => line.startsWith("•"));
            if (firstBullet < 0) return <p key={index}><ResourceText>{paragraph}</ResourceText></p>;
            return (
              <Fragment key={index}>
                {firstBullet > 0 && <p><ResourceText>{lines.slice(0, firstBullet).join("\n")}</ResourceText></p>}
                <ul>
                  {lines.slice(firstBullet).map((line, row) => (
                    <li key={row}><ResourceText>{line.slice(1).trim()}</ResourceText></li>
                  ))}
                </ul>
              </Fragment>
            );
          })}
        </div>
        <footer className="tutorial-guide-foot">
          {last ? (
            <>
              <button type="button" className="tutorial-button primary" onClick={onExit}>{t("ui.play")}</button>
              <button type="button" className="tutorial-button" onClick={onExit}>{t("ui.menu")}</button>
            </>
          ) : waiting ? (
            <span className="tutorial-hint">{t("ui.doThis")}</span>
          ) : (
            <button type="button" className="tutorial-button primary" onClick={onNext}>
              {step.info ? t("ui.understood") : t("ui.next")}
            </button>
          )}
          {!last && (
            <button type="button" className="tutorial-skip" onClick={onExit}>{t("ui.skip")}</button>
          )}
        </footer>
      </aside>
    </>
  );
}

/** Рамки вокруг подсвеченных элементов. Не перехватывает клики — доска под ней живая. */
function Spotlight({ anchors }: { anchors: string[] }) {
  const [boxes, setBoxes] = useState<DOMRect[]>([]);
  useEffect(() => {
    if (!anchors.length) return;
    const measure = () =>
      setBoxes(
        anchors
          .map(anchor => document.querySelector(`[data-tutorial="${anchor}"]`)?.getBoundingClientRect())
          .filter((box): box is DOMRect => Boolean(box && box.width > 0 && box.height > 0)),
      );
    measure();
    // Доска перестраивается от ответов сервера и анимаций, поэтому меряем по таймеру, а не один раз.
    const timer = setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [anchors]);
  return (
    <>
      {boxes.map((box, index) => (
        <div
          key={index}
          className="tutorial-spotlight"
          style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }}
        />
      ))}
    </>
  );
}
