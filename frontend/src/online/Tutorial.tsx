import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cityApi } from "./api";
import type { CityMeta, DomainEvent, LegalAction } from "./types";
import { useRoom } from "../ui/lib/session";
import { ResourceText } from "../ui/primitives/ResourceIcon";
import { pageZoom, useDeviceLayout } from "../ui/lib/layout";
import type { MobileView } from "../ui/board/MobileBoard";

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
  /* Мобильный стол: проекты, рынок и город там — вкладки, а карты — в «Руке» снизу.
   * `tab` — вкладка, которую проводник откроет сам перед шагом; `fallback` — что подсветить, пока
   * цель спрятана (рука закрыта); `text` — у шага своя реплика для телефона (`steps.<id>Mobile`). */
  mobile?: { tab?: MobileView; fallback?: string[]; text?: boolean; anchors?: string[] };
  /** Шаг только для телефона: на ПК его нет, и счётчик шагов там короче. */
  mobileOnly?: boolean;
  /** Условие на экране, а не в хронике (вкладка открыта): проверяется, пока шаг ждёт. */
  check?: () => boolean;
  /** Угол окна проводника, если он задан шагом: после хода слева открываются окна, проводник — справа. */
  corner?: Corner;
}

const tabOpen = (view: MobileView) => () =>
  document.querySelector(`[data-ui="mobile-tab-${view}"]`)?.getAttribute("aria-selected") === "true";

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
  { id: "buyObject", anchors: ["market-pharmacy_chain"], mobile: { tab: "market" }, allow: is("buy_asset", { market_uid: "asset:pharmacy_chain" }), done: event("asset_bought", { asset_id: "pharmacy_chain" }) },
  /* Телефон: купленное лежит во вкладке «Мой город» — заодно показываем, как переключать вкладки. */
  { id: "city", mobileOnly: true, anchors: ["tab-city"], check: tabOpen("city"), after: "cityDone" },
  { id: "role", anchors: ["roles"], allow: is("claim_role", { role_id: "journalist" }), done: event("role_claimed", { role_id: "journalist" }) },
  { id: "power", anchors: ["power-journalist_inflate", `player-${VICTOR}`], allow: is("use_role_power", { power: "journalist_inflate", target_id: VICTOR }), done: event("role_power_used", { power: "journalist_inflate" }) },
  { id: "scandals", anchors: [`player-${VICTOR}`], info: true },
  { id: "cards", anchors: ["draw-card"], mobile: { fallback: ["hand-button"], text: true }, allow: is("buy_action_card"), done: event("action_card_bought") },
  {
    id: "playCard",
   
    anchors: ["hand-mobilization"],
    mobile: { fallback: ["hand-button"], text: true },
    allow: action => action.type === "play_action_card" && String(action.payload.card_uid).startsWith("card:mobilization:"),
    done: event("action_card_played", { card_id: "mobilization" }),
  },
  { id: "charity", anchors: ["project-charity_fund"], mobile: { tab: "projects" }, allow: is("city_project", { project_id: "charity_fund" }), done: event("city_project_taken", { project_id: "charity_fund" }) },
  /* На телефоне остаёмся на «Проектах», чтобы «Речной порт» был перед глазами; на «Рынок» игрок
   * переходит сам — подсвечена вкладка, а там и сам терминал. */
  {
    id: "terminal",
    anchors: ["market-smuggling", "project-river_port"],
    mobile: { tab: "projects", anchors: ["project-river_port", "tab-market", "market-smuggling"], text: true },
    allow: is("buy_asset", { market_uid: "asset:smuggling" }), done: event("asset_bought", { asset_id: "smuggling" }) },
  { id: "port", anchors: ["project-river_port"], mobile: { tab: "projects" }, allow: is("city_project", { project_id: "river_port" }), done: event("city_project_taken", { project_id: "river_port" }) },
  { id: "grey", anchors: ["grey"], allow: is("grey_operation", { asset_id: "smear" }), done: event("grey_operation_resolved"), after: "greyDone" },
  { id: "roof", anchors: ["roof"], allow: is("buy_roof"), done: event("roof_bought") },
  { id: "roofInfo", anchors: [], info: true },
  { id: "lobbying", anchors: ["lobbying"], allow: is("basic_action", { kind: "lobbying" }), done: event("basic_action", { kind: "lobbying" }) },
  { id: "endTurn", anchors: ["end-turn"], allow: is("end_turn"), done: item => item.type === "turn_started" && item.actor_id === ME && item.data.round_number === 2 },
  // После хода слева появляются окно «Ваш ход — что изменилось» и хроника — проводник уходит вправо.
  { id: "roundEnd", anchors: [], corner: "bottom-right" },
  { id: "revenge", anchors: [], corner: "bottom-right" },
  { id: "finale", anchors: [], corner: "bottom-right" },
];

/** Сценарий для листа печати (`ui/dev/PrintBook`): шаги ПК — те же, что проходит игрок за столом на компьютере. */
export const TUTORIAL_STEPS: readonly Step[] = STEPS.filter(step => !step.mobileOnly);

const NOTHING = () => false;

export function TutorialScreen({ meta, onExit }: { meta: CityMeta; onExit: () => void }) {
  const { t, i18n } = useTranslation("tutorial");
  const [session, setSession] = useState<{ roomId: string; password: string; playerId: string } | null>(null);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  // Шаги, которые есть на этом столе: у телефона свои, про вкладки.
  const mobile = useDeviceLayout().mobile;
  const steps = useMemo(() => STEPS.filter(step => !step.mobileOnly || mobile), [mobile]);

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

  const step = steps[Math.min(position, steps.length - 1)];
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
            total={steps.length}
            onNext={() => setPosition(current => Math.min(current + 1, steps.length - 1))}
            onExit={onExit}
          />
        }
      />
    </Suspense>
  );
}

/** Проводник одного шага: следит за хроникой, показывает реплику и подсвечивает цель. */
function Guide({ step, position, total, onNext, onExit }: { step: Step; position: number; total: number; onNext: () => void; onExit: () => void }) {
  const { t, i18n } = useTranslation("tutorial");
  const { data } = useRoom();
  const mobile = useDeviceLayout().mobile;
  const [collapsed, setCollapsed] = useState(false);
  const events = data?.game?.event_log ?? [];
  // Хроника на момент начала шага: засчитывается только то, что случилось после.
  const since = useRef<number | null>(null);
  if (since.current === null && data?.game) since.current = events.length ? events[events.length - 1].seq : 0;
  const [phase, setPhase] = useState<"doing" | "after">("doing");

  // Условие на экране (вкладка открыта) проверяется по таймеру: в хронике его нет.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!step.check) return;
    const test = () => { if (step.check?.()) setChecked(true); };
    test();
    const timer = window.setInterval(test, 300);
    return () => window.clearInterval(timer);
  }, [step]);
  const done = checked || Boolean(step.done && since.current !== null && events.some(item => item.seq > (since.current ?? 0) && step.done?.(item)));
  useEffect(() => {
    if (!done || phase !== "doing") return;
    if (step.after) setPhase("after");
    else onNext();
  }, [done, phase, step.after, onNext]);

  const waiting = Boolean(step.done || step.check) && phase === "doing";
  const key = phase === "after" && step.after ? step.after : step.id;
  // На телефоне у шага может быть своя реплика: «откройте Руку» вместо «над завершением хода».
  const mobileKey = `steps.${key}Mobile`;
  const useMobileText = mobile && step.mobile?.text && i18n.exists(`tutorial:${mobileKey}`);
  const text = t((useMobileText ? mobileKey : `steps.${key}`) as never) as string;
  const last = position === total - 1;

  /* Мобильный стол: вкладку, где лежит цель шага, проводник открывает сам — новичок не должен
   * искать рынок за соседней вкладкой. Открытая «Рука» закрывается: она загородила бы вкладку. */
  /* Окно, оставшееся от сделанного действия (роль взята, а «Роли» открыты; «Вброс» сработал, а
   * «Серые операции» открыты), закрывается — и при новом шаге, и когда шаг засчитан и у него есть
   * реплика «после». Иначе на телефоне проводник так и сидел бы свёрнутым, и новую реплику было бы
   * не увидеть. Если цель шага внутри этого окна — оно нужно, его не трогаем. */
  useEffect(() => {
    if (!mobile) return;
    const open = document.querySelector('[data-ui="details-modal"]');
    const needed = phase === "doing" && [...step.anchors, ...(step.mobile?.anchors ?? [])].some(name => open?.querySelector(`[data-tutorial="${name}"]`));
    if (open && !needed) open.querySelector<HTMLButtonElement>('[data-ui="details-close"]')?.click();
  }, [mobile, step, phase]);

  useEffect(() => {
    if (!mobile || !step.mobile?.tab) return;
    document.querySelector<HTMLButtonElement>('[data-ui="hand-close"]')?.click();
    const tab = document.querySelector<HTMLButtonElement>(`[data-ui="mobile-tab-${step.mobile.tab}"]`);
    if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
  }, [mobile, step]);

  // Цели меряются и у шага-справки: подсветки там нет, но окно не должно закрыть то, о чём говорит.
  const anchors = (mobile && step.mobile?.anchors) || step.anchors;
  const { boxes, modal } = useAnchorBoxes(anchors, mobile ? step.mobile?.fallback : undefined);
  // На телефоне окно встаёт в угол, где меньше всего закрывает цель; на ПК — как было, слева снизу.
  const corner = step.corner ?? (mobile ? freeCorner(boxes) : null);
  // Развернуть поверх открытого окна можно и вручную; окно закрылось — снова решает автоматика.
  const [overModal, setOverModal] = useState(false);
  useEffect(() => { if (!modal) setOverModal(false); }, [modal]);

  /* На телефоне открытое окно (роли, карточка, серые операции) занимает почти весь экран, и пока
   * игрок в нём что-то делает, проводник уходит в плашку: реплику он уже прочёл, а нажимать мешал
   * бы проводник. Шаг-объяснение («Ваш ход — что изменилось») говорит как раз об окне — там
   * проводник остаётся на виду. */
  if (collapsed || (mobile && modal && waiting && !overModal)) {
    return (
      <>
        {waiting && <Spotlight boxes={boxes} />}
        <button type="button" className={`ui-v2 tutorial-pill corner-${corner ?? "bottom-left"}`} onClick={() => { setCollapsed(false); setOverModal(true); }}>
          <strong>{t("narrator.name")}</strong>
          <span>{t("ui.step", { current: position + 1, total })}</span>
          <span aria-hidden="true">▴</span>
        </button>
      </>
    );
  }

  return (
    <>
      {waiting && <Spotlight boxes={boxes} />}
      <aside className={`ui-v2 tutorial-guide${corner ? ` is-placed corner-${corner}` : ""}`} role="dialog" aria-labelledby="tutorial-narrator" aria-live="polite">
        <header className="tutorial-guide-head">
          <div className="tutorial-narrator">
            <strong id="tutorial-narrator">{t("narrator.name")}</strong>
          </div>
          <span className="tutorial-counter">{t("ui.step", { current: position + 1, total })}</span>
          {/* Свернуть — посмотреть на стол под окном. Новый шаг окно разворачивает снова: Guide
            * пересоздаётся на каждый шаг (key={step.id}), и реплику нельзя пропустить, не увидев. */}
          {mobile && (
            <button type="button" className="tutorial-collapse" aria-label={t("ui.collapse")} title={t("ui.collapse")} onClick={() => setCollapsed(true)}>
              <span aria-hidden="true">▾</span>
            </button>
          )}
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

type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

/* Рамки подсвеченных элементов в точках экрана. Меряются по таймеру: доска перестраивается от
 * ответов сервера и анимаций. Если ни одной цели не видно (на телефоне она в закрытой «Руке»),
 * подсвечивается запасная — то, что надо нажать, чтобы цель появилась. */
function useAnchorBoxes(anchors: string[], fallback?: string[]): { boxes: DOMRect[]; modal: boolean } {
  const [boxes, setBoxes] = useState<DOMRect[]>([]);
  const [modal, setModal] = useState(false);
  const key = `${anchors.join(",")}|${(fallback ?? []).join(",")}`;
  useEffect(() => {
    /* Цель видна, только если её середина не закрыта другим окном: рамка поверх открытого окна
     * «Роли» подсвечивала бы карточки ролей, а не строку под окном. Проводник и сами рамки в
     * проверке не участвуют — у рамок нет указателя, проводник пропускаем явно. */
    const visible = (element: Element, box: DOMRect) => {
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !top || element.contains(top) || Boolean(top.closest(".tutorial-guide, .tutorial-pill"));
    };
    const find = (names: string[]) =>
      names.flatMap(name => {
        const element = document.querySelector(`[data-tutorial="${name}"]`);
        const box = element?.getBoundingClientRect();
        return element && box && box.width > 0 && box.height > 0 && visible(element, box) ? [box] : [];
      });
    const measure = () => {
      setModal(Boolean(document.querySelector('[data-ui="details-modal"], [data-ui="card-details"], [data-ui="modal"]')));
      if (!anchors.length) {
        setBoxes([]);
        return;
      }
      const found = find(anchors);
      setBoxes(found.length || !fallback ? found : find(fallback));
    };
    measure();
    const timer = setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { boxes, modal };
}

/* Угол для окна проводника на телефоне: тот, где оно меньше всего закрывает подсвеченное. Окно
 * занимает около трети ширины и половины высоты экрана; при равенстве — левый нижний, как на ПК. */
function freeCorner(boxes: DOMRect[]): Corner {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const overlap = (corner: Corner) => {
    const w = width * 0.36;
    const h = height * 0.55;
    const left = corner.endsWith("left") ? 0 : width - w;
    const top = corner.startsWith("top") ? 0 : height - h;
    return boxes.reduce((sum, box) => {
      const x = Math.max(0, Math.min(left + w, box.right) - Math.max(left, box.left));
      const y = Math.max(0, Math.min(top + h, box.bottom) - Math.max(top, box.top));
      return sum + x * y;
    }, 0);
  };
  const corners: Corner[] = ["bottom-left", "bottom-right", "top-left", "top-right"];
  return corners.reduce((best, corner) => (overlap(corner) < overlap(best) ? corner : best), corners[0]);
}

/** Рамки вокруг подсвеченных элементов. Не перехватывает клики — доска под ней живая. */
function Spotlight({ boxes }: { boxes: DOMRect[] }) {
  const zoom = pageZoom();
  return (
    <>
      {boxes.map((box, index) => (
        <div
          key={index}
          className="tutorial-spotlight"
          /* Рамка меряется в точках экрана, а рисуется в точках страницы — под `zoom` корня
            * (мобильный стол на Android) их надо перевести обратно. */
          style={{
            left: box.left / zoom - 6,
            top: box.top / zoom - 6,
            width: box.width / zoom + 12,
            height: box.height / zoom + 12,
          }}
        />
      ))}
    </>
  );
}
