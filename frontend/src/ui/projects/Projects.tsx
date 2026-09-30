import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useState, type CSSProperties } from "react";
import { projectPerkText, projectRequirementText, projectRerollMoney } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, ProjectMeta } from "../../online/types";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue, Panel, sectionTitle, zoneRule } from "../primitives/atoms";
import { resolve, usedThisTurn, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";
import { useIsPortrait } from "../lib/layout";
import { projectArt, projectIcon, projectKind, statIcon } from "../assets/cards";
import { ResourceText } from "../primitives/ResourceIcon";
import { ConfirmModal } from "../primitives/Modal";

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
  const portrait = useIsPortrait();
  const reroll = resolve(context, "reroll_projects");
  const rerolled = usedThisTurn(game, "projects_rerolled");
  const [confirmReroll, setConfirmReroll] = useState(false);
  const mine = context.me.projects
    .map(id => index.projects.get(id))
    .filter((project): project is ProjectMeta => Boolean(project));
  const minePoints = mine.reduce((sum, project) => sum + project.points, 0);

  /* Чьё вето стоит на проекте с точки зрения зрителя. Правило считает движок — вето просто
   * не появится в legal_actions, — но карточка обязана сказать почему, иначе проект выглядит
   * недоступным без причины. */
  function vetoOf(state: GameState, viewerId: string, projectId: string): "mine" | "theirs" | undefined {
    const owner = state.project_veto?.[projectId];
    if (!owner) return undefined;
    return owner === viewerId ? "mine" : "theirs";
  }

  return (
    <Panel zone="projects">
      {/* В строке остаются счётчик своих проектов и действие. Размер колоды — справочная
        * информация, она живёт в книге правил, а не на игровом столе. */}
      <div className={`flex items-baseline gap-2 overflow-hidden px-0.5 pb-[2px] ${zoneRule}`}>
        <h2 className={sectionTitle}>
          {portrait ? t("ui.projects.titleShort") : t("ui.projects.title")}
        </h2>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-ink-dim">
          {mine.length ? t("ui.projects.mine", { count: mine.length, points: minePoints }) : t("ui.projects.none")}
        </span>
        {/* Та же рамка, что у кнопок действий справа: пересборка — такое же действие хода.
          * Нажатие только открывает подтверждение: доска общая и меняется у всех сразу. */}
        <button
          type="button"
          disabled={reroll.kind !== "ready"}
          onClick={() => reroll.kind === "ready" && setConfirmReroll(true)}
          title={
            rerolled
              ? t("ui.projects.rerolled")
              : reroll.kind === "blocked"
                ? reroll.reason
                : t("ui.projects.rerollHint")
          }
          className="ml-auto flex shrink-0 items-center gap-1 self-center rounded-md border border-line-2 bg-panel-2
            px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap text-ink enabled:hover:border-accent
            enabled:hover:bg-panel-3 disabled:opacity-45"
        >
          <span aria-hidden="true">🔄</span>
          {portrait ? "" : t("ui.projects.reroll")}
          <span className="text-money"><ResourceText>{`${projectRerollMoney(meta)}$`}</ResourceText></span>
          <span className="text-ink-muted">+ <ResourceText>⚡</ResourceText></span>
        </button>
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
      </div>

      {/* 90% ширины: проектов всегда четыре, и на всю колонку карточки растягивались
        * шире, чем требует их содержимое. Вертикально — два на два: вчетверо уже экрана
        * телефона от карточки остаётся одна цена. */}
      <div className={`grid gap-[5px] ${portrait ? "grid-cols-2" : "grid-cols-4"}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          {game.project_board.map((projectId, position) => {
            const project = index.projects.get(projectId);
            if (!project) return null;
            const take = resolve(context, "city_project", { project_id: projectId });
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
                className="min-w-0"
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
                      veto={context.legal.find(
                        action =>
                          action.type === "use_role_power" &&
                          action.payload.power === "politician_veto" &&
                          action.payload.project_id === project.id,
                      )}
                      onVeto={onAction}
                    />
                  }
                >
                  <ProjectCard
                    project={project}
                    meta={meta}
                    standing={standing}
                    leaving={leaving}
                    ready={take.kind === "ready"}
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
    pending: boolean;
    shortInfluence: boolean;
    shortMoney: boolean;
    /** Вето политика: "mine" — наложено вами, "theirs" — чужое, проект недоступен. */
    veto?: "mine" | "theirs";
  }
>(function ProjectCard(
  { project, meta, standing, leaving, ready, pending, shortInfluence, shortMoney, veto, ...rest },
  ref,
) {
  const met = standing?.met ?? false;
  const perk = projectPerkText(project);
  const kind = projectKind(project.perk);
  const art = projectArt(kind);
  const icon = projectIcon(kind);
  const star = statIcon("score");
  /* Вертикально на карточке остаются только те две строки, по которым выбирают: название с
   * очками и цена с прогрессом. Текст условия и постоянный бонус уезжают в поповер — иначе
   * четыре проекта съедают треть экрана, которой не хватает рынку. */
  const portrait = useIsPortrait();
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
        data-[state=pending]:animate-pulse ${portrait ? "gap-[2px] px-2 py-1.5" : "gap-[3px] px-3 py-[7px]"}`}
      {...rest}
    >
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <b
          className={`project-card-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
            portrait ? "text-[11.5px]" : "text-[14px]"
          }`}
        >
          {project.title}
        </b>
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
        {leaving && (
          <span
            className="rounded bg-[#ead5ae] px-1 text-3xs text-[var(--color-warning)]"
            title={t("ui.projects.leaving")}
          >
            ⏳
          </span>
        )}
        <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap" title={t("ui.projects.points", { count: project.points })}>
          {star && <img src={star} alt="" className="size-[15px]" />}
          <b className="project-card-title text-[15px] leading-none">{project.points}</b>
          {!portrait && <small className="text-3xs text-ink-dim">{t("ui.projects.ptsShort")}</small>}
        </span>
      </span>

      {/* Постоянный бонус — ради него половину проектов и берут, поэтому он крупно и с
        * иконкой категории. Единица начисления — ровно та, что в правилах. */}
      {!portrait && (
        <span className="project-card-plate flex min-w-0 items-center gap-1.5 overflow-hidden" title={perk}>
          {icon && <img src={icon} alt="" className="size-[20px] shrink-0 object-contain" />}
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-semibold
            text-[var(--project-ink)]">
            <ResourceText>{kind === "points" ? t("ui.projects.onlyPoints") : perk}</ResourceText>
          </span>
        </span>
      )}

      {!portrait && (
        <span
          className={`project-card-plate overflow-hidden text-ellipsis whitespace-nowrap !pl-1 text-2xs leading-tight ${
            met ? "font-semibold text-good" : "text-ink-muted"
          }`}
        >
          {met ? "✓ " : t("ui.projects.condition")}
          <ResourceText>{projectRequirementText(project, meta)}</ResourceText>
        </span>
      )}

      {/* Цена справа, прогресс слева. Красным горит именно та цифра, которой не хватает, —
        * «✓» у прогресса значит «условие выполнено», а не «можно купить». */}
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {standing && <ProjectProgress standing={standing} compact={portrait} />}
        <span className="project-card-price ml-auto shrink-0 whitespace-nowrap !pl-1.5 text-[11.5px] font-bold"
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
function ProjectProgress({ standing, compact }: { standing: NonNullable<Standing>; compact: boolean }) {
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
              className={`project-segment ${compact ? "w-2.5" : total > 4 ? "w-3" : "w-[18px]"}`}
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
  veto,
  onVeto,
}: {
  project: ProjectMeta;
  meta: CityMeta;
  standing: Standing;
  leaving: boolean;
  state: ReturnType<typeof resolve>;
  onTake: () => void;
  /** Вето политика на этот проект, если движок его сейчас разрешает. */
  veto?: LegalAction;
  onVeto: (action: LegalAction) => void;
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
