import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useState, type CSSProperties } from "react";
import { projectPerkText, projectRequirementText, projectRerollMoney } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, ProjectMeta } from "../../online/types";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue, Panel, sectionTitle, zoneRule } from "../primitives/atoms";
import { matches, turnBlock, usedThisTurn, resolve, type ActionContext, type Availability } from "../lib/actions";
import { tr } from "../../i18n";
import type { Indexes } from "../lib/board";
import { useIsMobile } from "../lib/layout";
import { projectArt, projectIcon, projectKind, statIcon } from "../assets/cards";
import { ResourceText, resourceTooltip } from "../primitives/ResourceIcon";
import { ConfirmModal } from "../primitives/Modal";
import { useBlockedHint } from "../primitives/BlockedHint";

/* Доска проектов. Общая для всех: кто взял — тот и забрал, остальным проект недоступен.
 * Поэтому карточка на доске показывает только цену и прогресс, а «почему» — в поповере.
 */
export function Projects({
  game,
  meta,
  index,
  context,
  onAction,
}: {
  game: GameState;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
}) {
  const { t } = useTranslation("game");
  const mobile = useIsMobile();
  const reroll = resolve(context, "reroll_projects");
  const rerolled = usedThisTurn(game, "projects_rerolled");
  const [confirmReroll, setConfirmReroll] = useState(false);
  const blocked = useBlockedHint();
  const [charterFor, setCharterFor] = useState<{ action: LegalAction; project: ProjectMeta } | null>(null);
  const mine = context.me.projects
    .map(id => index.projects.get(id))
    .filter((project): project is ProjectMeta => Boolean(project));
  const minePoints = mine.reduce((sum, project) => sum + project.points, 0);

  /* Чьё вето стоит на проекте с точки зрения зрителя. Правило считает движок — вето просто
   * не появится в legal_actions, — но карточка обязана сказать почему, иначе проект выглядит
   * недоступным без причины. */
  /** Кто держит вето на проекте — для пояснения в окне карточки. */
  function vetoHolder(state: GameState, viewerId: string, projectId: string): { name: string; mine: boolean } | undefined {
    const owner = state.project_veto?.[projectId];
    if (!owner) return undefined;
    return { name: state.players.find(player => player.id === owner)?.name ?? owner, mine: owner === viewerId };
  }

  function vetoOf(state: GameState, viewerId: string, projectId: string): "mine" | "theirs" | undefined {
    const owner = state.project_veto?.[projectId];
    if (!owner) return undefined;
    return owner === viewerId ? "mine" : "theirs";
  }

  return (
    /* На телефоне проекты — отдельная вкладка на всю высоту центра, поэтому панель растягивается,
     * а карточки встают два на два и делят её поровну. */
    <Panel zone="projects" rows={mobile}>
      {/* В строке остаются счётчик своих проектов и действие. Размер колоды — справочная
        * информация, она живёт в книге правил, а не на игровом столе. */}
      <div className={`flex items-baseline gap-2 overflow-hidden px-0.5 pb-[2px] ${zoneRule}`}>
        <h2 className={sectionTitle}>
          {t("ui.projects.title")}
        </h2>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-ink-dim">
          {mine.length ? t("ui.projects.mine", { count: mine.length, points: minePoints }) : t("ui.projects.none")}
        </span>
        {/* Та же рамка, что у кнопок действий справа: пересборка — такое же действие хода.
          * Нажатие только открывает подтверждение: доска общая и меняется у всех сразу. */}
        <button
          type="button"
          aria-disabled={reroll.kind !== "ready" || undefined}
          onClick={event =>
            reroll.kind === "ready"
              ? setConfirmReroll(true)
              : blocked.show(
                  rerolled ? t("ui.projects.rerolled") : reroll.kind === "blocked" ? reroll.reason : undefined,
                  event.currentTarget,
                )
          }
          title={
            rerolled
              ? t("ui.projects.rerolled")
              : reroll.kind === "blocked"
                ? reroll.reason
                : t("ui.projects.rerollHint")
          }
          className="ml-auto flex shrink-0 items-center gap-1 self-center rounded-md border border-line-2 bg-panel-2
            px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap text-ink not-aria-disabled:hover:border-accent
            not-aria-disabled:hover:bg-panel-3 aria-disabled:opacity-45"
        >
          <span aria-hidden="true">🔄</span>
          {t("ui.projects.reroll")}
          <span className="text-money"><ResourceText>{`${projectRerollMoney(meta)}$`}</ResourceText></span>
          <span className="text-ink-muted">+ <ResourceText>⚡</ResourceText></span>
        </button>
        {blocked.hint}
        <ConfirmModal
          open={confirmReroll}
          onClose={() => setConfirmReroll(false)}
          onConfirm={() => reroll.kind === "ready" && onAction(reroll.action)}
          title={t("ui.projects.rerollTitle")}
          price={t("ui.projects.rerollPrice", { money: projectRerollMoney(meta) })}
          confirmLabel={t("ui.projects.rerollConfirm")}
        >
          {t("ui.projects.rerollHint")}
        </ConfirmModal>
        {/* Хартия — право на один проект за всю партию, и обратно его не вернуть. Поэтому
          * отдельная кнопка и подтверждение, а не тихая подмена обычного «Взять». */}
        <ConfirmModal
          open={charterFor !== null}
          onClose={() => setCharterFor(null)}
          onConfirm={() => charterFor && onAction(charterFor.action)}
          title={t("ui.projects.charterTitle")}
          price={charterFor
            ? t("ui.projects.charterPrice", { influence: charterFor.project.cost_influence, money: charterFor.project.cost_money })
            : ""}
          confirmLabel={t("ui.projects.charterConfirm")}
        >
          {t("ui.projects.charterHint")}
        </ConfirmModal>
      </div>

      {/* Широкий стол — четыре в ряд. На телефоне вчетверо уже от карточки осталась бы одна
        * цена, поэтому два на два: вкладка проектов всё равно занимает весь центр. */}
      <div className={`grid gap-[5px] ${mobile ? "min-h-0 grid-cols-2 grid-rows-2 gap-1.5" : "grid-cols-4"}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          {game.project_board.map((projectId, position) => {
            const project = index.projects.get(projectId);
            if (!project) return null;
            const take = takeProject(context, projectId);
            const charter = charterTake(context, projectId);
            const standing = game.project_progress?.[projectId];
            // Ровно один проект уходит за раунд, всегда самый давний. Это правило движка,
            // и его стоит в будущем присылать флагом рядом с проектом, как это уже
            // сделано для слотов рынка.
            const leaving = position === 0;

            return (
              /* Стол общий, и проект чаще забирает чужой ход, чем твой. Без ухода
               * карточка просто подменялась другой, и событие проходило незамеченным.
               * Полсекунды подсветки — чтобы глаз успел вернуться к доске, потом вылет вверх.
               * popLayout вынимает уходящую из потока, поэтому новая карта встаёт сразу,
               * не дожидаясь конца анимации. */
              <motion.div
                key={projectId}
                data-tutorial={`project-${projectId}`}
                layout
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{
                  opacity: [1, 1, 1, 0],
                  y: [0, -3, -3, -70],
                  scale: [1, 1.04, 1.04, 0.92],
                  filter: [
                    "brightness(1)",
                    "brightness(1.5)",
                    "brightness(1.5)",
                    "brightness(1.5)",
                  ],
                  transition: { duration: 0.78, times: [0, 0.1, 0.64, 1], ease: "easeIn" },
                }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="min-h-0 min-w-0"
              >
                <CardPopover
                  side="bottom"
                  label={t("ui.projects.details", { title: project.title })}
                  content={
                    <ProjectDetails
                      project={project}
                      meta={meta}
                      standing={standing}
                      leaving={leaving}
                      state={take}
                      onTake={() => take.kind === "ready" && onAction(take.action)}
                      charter={charter}
                      onCharter={action => setCharterFor({ action, project })}
                      veto={context.legal.find(
                        action =>
                          action.type === "use_role_power" &&
                          action.payload.power === "politician_veto" &&
                          action.payload.project_id === project.id,
                      )}
                      onVeto={onAction}
                      vetoBy={vetoHolder(game, context.me.id, project.id)}
                    />
                  }
                >
                  <ProjectCard
                    project={project}
                    meta={meta}
                    standing={standing}
                    leaving={leaving}
                    ready={take.kind === "ready"}
                    charter={Boolean(charter)}
                    pending={take.kind === "pending"}
                    shortInfluence={context.me.influence < project.cost_influence}
                    shortMoney={context.me.money < project.cost_money}
                    veto={vetoOf(game, context.me.id, project.id)}
                  />
                </CardPopover>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {game.project_board.length === 0 && (
          <p className="col-span-full py-3 text-center text-2xs text-ink-dim">
            {t("ui.projects.empty")}
          </p>
        )}
      </div>
    </Panel>
  );
}

type Standing = { binary: boolean; met: boolean; have: number; needed: number } | undefined;

/* forwardRef обязателен: Popover.Trigger рендерится через asChild и вешает на потомка
 * не только обработчики, но и ref — им он держит якорь и управляет открытием. Обычная
 * функция ref не принимает, и карточка просто переставала откликаться на клик.
 * Соседи (MarketCard, PlayerRow) не ломались лишь потому, что там motion.button,
 * а он forwardRef изнутри.
 */
const ProjectCard = forwardRef<
  HTMLButtonElement,
  {
    project: ProjectMeta;
    meta: CityMeta;
    standing: Standing;
    leaving: boolean;
    ready: boolean;
    /** Условие не выполнено, но движок предлагает взять проект по Хартии. */
    charter: boolean;
    pending: boolean;
    shortInfluence: boolean;
    shortMoney: boolean;
    /** Вето политика: "mine" — наложено вами, "theirs" — чужое, проект недоступен. */
    veto?: "mine" | "theirs";
  }
>(function ProjectCard(
  { project, meta, standing, leaving, ready, charter, pending, shortInfluence, shortMoney, veto, ...rest },
  ref,
) {
  const met = standing?.met ?? false;
  const perk = projectPerkText(project);
  const kind = projectKind(project.perk);
  const art = projectArt(kind);
  const icon = projectIcon(kind);
  const star = statIcon("score");
  /* На телефоне карточка вчетверо больше по площади, чем полоска на широком столе, — тот же
   * состав строк, но крупнее и с воздухом между ними. */
  const mobile = useIsMobile();
  const { t } = useTranslation("game");

  /* Слои по комплекту из presets: фон категории с рамкой, отдельная иконка награды, текст
   * и сегментированный прогресс. Надписи в фон не запечены, поэтому данные — только из движка. */
  return (
    <button
      ref={ref}
      type="button"
      data-ui="project-card"
      data-kind={kind}
      data-state={pending ? "pending" : ready ? "ready" : met ? "met" : "locked"}
      style={art ? ({ "--project-art": `url(${art})` } as CSSProperties) : undefined}
      className={`game-card project-card grid w-full min-w-0 overflow-hidden text-left
        data-[state=pending]:animate-pulse ${mobile ? "h-full content-evenly gap-2 px-4 py-3" : "gap-[3px] px-3 py-[7px]"}`}
      {...rest}
    >
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <b
          className={`project-card-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
            mobile ? "text-[19px]" : "text-[14px]"
          }`}
        >
          {project.title}
        </b>
        {/* Та же плашка, что «уходит», но золотом: проект можно взять только по Хартии. */}
        {charter && (
          <span
            data-ui="project-charter-badge"
            className="flex items-center gap-0.5 rounded-full border border-black/40 bg-[#c99a2e] px-1.5 text-[11px]
              font-bold leading-tight whitespace-nowrap text-[#2a1d05] shadow-[0_0_6px_rgb(240_200_90/0.8)]"
            title={t("ui.projects.charterBadge")}
          >
            <span className="text-[13px] leading-none">📜</span>
            {t("ui.projects.charterShort")}
          </span>
        )}
        {veto && (
          <span
            className={`rounded px-1 text-3xs ${
              veto === "mine" ? "bg-[#1d3b2a] text-[#7fdaa6]" : "bg-[#4a2530] text-[#ffb0bd]"
            }`}
            title={
              veto === "mine"
                ? t("ui.projects.vetoMine")
                : t("ui.projects.vetoTheirs")
            }
          >
            ⛔
          </span>
        )}
        {/* Та же плашка, что у уходящего слота рынка: крупно и цветом, а не бледной иконкой. */}
        {leaving && (
          <span
            className="flex items-center gap-0.5 rounded-full border border-black/40 bg-[#b5651d] px-1.5 text-[11px]
              font-bold leading-tight whitespace-nowrap text-white shadow-[0_1px_3px_rgb(0_0_0/0.6)]"
            title={t("ui.projects.leaving")}
          >
            <span className="text-[13px] leading-none">⏳</span>
            {t("ui.market.leaving")}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap" title={t("ui.projects.points", { count: project.points })}>
          {star && <img src={star} alt="" className={mobile ? "size-[20px]" : "size-[15px]"} />}
          <b className={`project-card-title leading-none ${mobile ? "text-[20px]" : "text-[15px]"}`}>{project.points}</b>
          <small className={mobile ? "text-[12px] text-ink-dim" : "text-3xs text-ink-dim"}>{t("ui.projects.ptsShort")}</small>
        </span>
      </span>

      {/* Постоянный бонус — ради него половину проектов и берут, поэтому он крупно и с
        * иконкой категории. Единица начисления — ровно та, что в правилах. */}
      <span className="project-card-plate flex min-w-0 items-center gap-1.5 overflow-hidden" title={perk ? resourceTooltip(perk) : undefined}>
        {icon && <img src={icon} alt="" className={`shrink-0 object-contain ${mobile ? "size-[26px]" : "size-[20px]"}`} />}
        <span className={`font-semibold text-[var(--project-ink)] ${
          mobile ? "line-clamp-2 text-[14px] leading-snug" : "overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px]"
        }`}>
          <ResourceText>{kind === "points" ? t("ui.projects.onlyPoints") : perk}</ResourceText>
        </span>
      </span>

      <span
        className={`project-card-plate !pl-1 leading-tight ${
          mobile ? "line-clamp-2 text-[13px]" : "overflow-hidden text-ellipsis whitespace-nowrap text-2xs"
        } ${met ? "font-semibold text-good" : "text-ink-muted"}`}
      >
        {met ? "✓ " : t("ui.projects.condition")}
        <ResourceText>{projectRequirementText(project, meta)}</ResourceText>
      </span>

      {/* Цена справа, прогресс слева. Красным горит именно та цифра, которой не хватает, —
        * «✓» у прогресса значит «условие выполнено», а не «можно купить». */}
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {standing && <ProjectProgress standing={standing} />}
        <span className={`project-card-price ml-auto shrink-0 whitespace-nowrap !pl-1.5 font-bold ${
          mobile ? "text-[15px]" : "text-[11.5px]"
        }`}
          title={t("ui.projects.price")}>
          <span className={shortInfluence ? "text-bad" : "text-influence"}><ResourceText>{`${project.cost_influence}◆`}</ResourceText></span>
          {" + "}
          <span className={shortMoney ? "text-bad" : "text-money"}><ResourceText>{`${project.cost_money}$`}</ResourceText></span>
        </span>
      </span>
    </button>
  );
});

/* Сегменты по одному на единицу условия; при больших требованиях — сплошная шкала,
 * иначе десяток сегментов превращается в пунктир. Бинарное условие — один сегмент. */
function ProjectProgress({ standing }: { standing: NonNullable<Standing> }) {
  const total = standing.binary ? 1 : Math.max(1, standing.needed);
  const done = standing.binary ? (standing.met ? 1 : 0) : Math.min(standing.have, total);
  const { t } = useTranslation("game");
  const label = standing.binary
    ? standing.met
      ? t("ui.projects.ready")
      : t("ui.projects.notReady")
    : `${standing.have}/${standing.needed}`;
  return (
    <span
      role="progressbar"
      aria-label={t("ui.projects.progress")}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      data-met={standing.met || undefined}
      className="project-card-plate flex min-w-0 items-center gap-1.5"
    >
      {total <= 6 ? (
        <span className="flex gap-[3px]">
          {Array.from({ length: total }, (_, position) => (
            <span
              key={position}
              data-filled={position < done || undefined}
              className={`project-segment ${total > 4 ? "w-3" : "w-[18px]"}`}
            />
          ))}
        </span>
      ) : (
        <span className="project-segment relative w-12 overflow-hidden">
          <span className="project-segment absolute inset-y-0 left-0" data-filled style={{ width: `${(done / total) * 100}%` }} />
        </span>
      )}
      <b className={`text-[11.5px] tabular-nums ${standing.met ? "text-good" : "text-ink-muted"}`}>{label}</b>
    </span>
  );
}

function ProjectDetails({
  project,
  meta,
  standing,
  leaving,
  state,
  onTake,
  charter,
  onCharter,
  veto,
  onVeto,
  vetoBy,
}: {
  project: ProjectMeta;
  meta: CityMeta;
  standing: Standing;
  leaving: boolean;
  state: Availability;
  onTake: () => void;
  /** Взятие по Хартии, если движок его предлагает: отдельная кнопка с подтверждением. */
  charter?: LegalAction;
  onCharter: (action: LegalAction) => void;
  /** Вето политика на этот проект, если движок его сейчас разрешает. */
  veto?: LegalAction;
  onVeto: (action: LegalAction) => void;
  /** Чьё вето уже стоит на проекте. Плашка на лице говорит «вето», окно объясняет, что оно значит. */
  vetoBy?: { name: string; mine: boolean };
}) {
  const { t } = useTranslation("game");
  return (
    <>
      <PopoverHeader title={project.title} subtitle={t("ui.projects.points", { count: project.points })} />
      <PopoverBody>
        <KeyValue
          rows={[
            [t("ui.projects.priceRow"), <ResourceText>{`${project.cost_influence}◆ + ${project.cost_money}$ + ⚡`}</ResourceText>],
            [t("ui.projects.requirement"), <ResourceText>{projectRequirementText(project, meta)}</ResourceText>],
            [
              t("ui.projects.yourProgress"),
              standing ? (
                <span className={standing.met ? "text-good" : "text-gold"}>
                  {standing.binary
                    ? standing.met
                      ? t("ui.projects.met")
                      : t("ui.projects.notMet")
                    : t("ui.projects.ofNeeded", { have: standing.have, needed: standing.needed })}
                </span>
              ) : (
                "—"
              ),
            ],
          ]}
        />
        <p className="mb-2">
          <strong>{t("ui.projects.perk")}</strong> <ResourceText>{projectPerkText(project)}</ResourceText>
        </p>
        {vetoBy && (
          <section
            data-ui="project-veto-info"
            className={`mb-2 rounded-md border px-2 py-1.5 ${
              vetoBy.mine ? "border-[#2f6b4a] bg-[#1d3b2a] text-[#a8e8c2]" : "border-[#6b3a41] bg-[#2a171b] text-[#ffc2cc]"
            }`}
          >
            <p className="mb-0.5 font-semibold">{t("ui.projects.vetoInfoTitle")}</p>
            <p>{vetoBy.mine ? t("ui.projects.vetoInfoMine") : t("ui.projects.vetoInfo", { name: vetoBy.name })}</p>
          </section>
        )}
        {leaving && <p className="text-gold">{t("ui.projects.leavingNote")}</p>}
        <hr className="my-3 border-line" />
        <p className="mb-2 italic text-ink-muted">
          «<ResourceText>{project.text}</ResourceText>»
        </p>
      </PopoverBody>
      <PopoverFooter>
        {/* Вето жмут на самом проекте: список из четырёх строк «Цель» в правой панели не сказал
          * бы, на какой именно проект оно ложится. */}
        {veto && (
          <button
            type="button"
            onClick={() => onVeto(veto)}
            className="mb-1 rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              font-semibold hover:border-accent"
          >
            {t("ui.projects.veto")}
          </button>
        )}
        {charter && (
          <button
            type="button"
            data-ui="project-charter"
            onClick={() => onCharter(charter)}
            className="mb-1 rounded-md border border-gold bg-[#2a2412] px-2 py-2 text-center text-xs
              font-semibold text-gold hover:bg-[#3a3218]"
          >
            <ResourceText>{t("ui.projects.charter", { influence: project.cost_influence, money: project.cost_money })}</ResourceText>
          </button>
        )}
        <button
          type="button"
          disabled={state.kind !== "ready"}
          onClick={onTake}
          className="rounded-md border border-good bg-[#1a2a21] px-2 py-2 text-center text-xs
            font-semibold text-good disabled:border-line disabled:bg-panel-2 disabled:text-ink-muted disabled:opacity-60"
        >
          {state.kind === "ready"
            ? t("ui.projects.take", { influence: project.cost_influence, money: project.cost_money })
            : state.kind === "pending"
              ? t("ui.projects.taking")
              : state.reason}
        </button>
      </PopoverFooter>
    </>
  );
}

/* Обычное «Взять» ищет только вариант без Хартии. Раньше поиск по одному project_id
 * находил и вариант `use_waiver`, когда условие не выполнено, — и кнопка «Взять»
 * молча тратила Хартию, право на один проект за всю партию. */
function takeProject(context: ActionContext, projectId: string): Availability {
  if (context.pending && matches(context.pending, "city_project", { project_id: projectId })) {
    return { kind: "pending", action: context.pending };
  }
  const action = context.legal.find(
    item => matches(item, "city_project", { project_id: projectId }) && item.payload.use_waiver !== true,
  );
  if (action) return { kind: "ready", action };
  return { kind: "blocked", reason: turnBlock(context) ?? tr("game", "ui.block.unavailable") };
}

function charterTake(context: ActionContext, projectId: string): LegalAction | undefined {
  return context.legal.find(item => matches(item, "city_project", { project_id: projectId, use_waiver: true }));
}
