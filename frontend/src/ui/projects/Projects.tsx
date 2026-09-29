import { AnimatePresence, motion } from "motion/react";
import { forwardRef, type CSSProperties } from "react";
import { projectPerkText, projectRequirementText, projectRerollMoney } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, ProjectMeta } from "../../online/types";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue, Panel, zoneRule } from "../primitives/atoms";
import { resolve, usedThisTurn, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";
import { useIsPortrait } from "../lib/layout";
import { projectArt, projectIcon, projectKind } from "../assets/cards";

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
  const portrait = useIsPortrait();
  const reroll = resolve(context, "reroll_projects");
  const rerolled = usedThisTurn(game, "projects_rerolled");
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
      {/* Вертикально в строку помещается заголовок, счётчик своих проектов и кнопка. Всё
        * остальное — размер колоды, длинная подпись кнопки — уходит: это справка, а не решение. */}
      <div className={`flex items-baseline gap-2 overflow-hidden px-0.5 pb-[2px] ${zoneRule}`}>
        <h2 className="whitespace-nowrap text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-muted">
          {portrait ? "Проекты" : "Городские проекты"}
        </h2>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-ink-dim">
          {mine.length ? `ваши: ${mine.length} · ${minePoints} очков` : "у вас пока ни одного"}
        </span>
        <button
          type="button"
          disabled={reroll.kind !== "ready"}
          onClick={() => reroll.kind === "ready" && onAction(reroll.action)}
          title={
            rerolled
              ? "Пересборка уже была в этом ходу"
              : reroll.kind === "blocked"
                ? reroll.reason
                : "Все четыре проекта уходят в колоду и раздаются заново. Доска общая — меняется у всех."
          }
          className="ml-auto shrink-0 rounded-[10px] border border-line bg-panel-2 px-1.5 py-0.5
            text-3xs whitespace-nowrap text-ink-muted enabled:hover:border-accent disabled:opacity-45"
        >
          🔄 {portrait ? "" : "Пересобрать · "}
          {projectRerollMoney(meta)}$ + ⚡
        </button>
        {!portrait && (
          <span className="whitespace-nowrap text-[10.5px] text-ink-dim">
            в колоде {game.project_deck_count}
          </span>
        )}
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
                  label={`${project.title} — подробности`}
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
            Проекты в городе закончились.
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
  const star = projectIcon("score");
  /* Вертикально на карточке остаются только те две строки, по которым выбирают: название с
   * очками и цена с прогрессом. Текст условия и постоянный бонус уезжают в поповер — иначе
   * четыре проекта съедают треть экрана, которой не хватает рынку. */
  const portrait = useIsPortrait();

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
                ? "Ваше вето: проект закрыт для всех остальных"
                : "Вето политика: этот проект можете взять не вы"
            }
          >
            ⛔
          </span>
        )}
        {leaving && (
          <span
            className="rounded bg-[#ead5ae] px-1 text-3xs text-[var(--color-warning)]"
            title="Уходит в конце раунда"
          >
            ⏳
          </span>
        )}
        <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap" title={`${project.points} очков`}>
          {star && <img src={star} alt="" className="size-[15px]" />}
          <b className="project-card-title text-[15px] leading-none">{project.points}</b>
          {!portrait && <small className="text-3xs text-ink-dim">оч</small>}
        </span>
      </span>

      {/* Постоянный бонус — ради него половину проектов и берут, поэтому он крупно и с
        * иконкой категории. Единица начисления — ровно та, что в правилах. */}
      {!portrait && (
        <span className="project-card-plate flex min-w-0 items-center gap-1.5 overflow-hidden" title={perk}>
          {icon && <img src={icon} alt="" className="size-[20px] shrink-0 object-contain" />}
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-semibold
            text-[var(--project-ink)]">
            {kind === "points" ? "Только победные очки" : perk}
          </span>
        </span>
      )}

      {!portrait && (
        <span
          className={`project-card-plate overflow-hidden text-ellipsis whitespace-nowrap !pl-1 text-2xs leading-tight ${
            met ? "font-semibold text-good" : "text-ink-muted"
          }`}
        >
          {met ? "✓ " : "Условие: "}
          {projectRequirementText(project, meta)}
        </span>
      )}

      {/* Цена справа, прогресс слева. Красным горит именно та цифра, которой не хватает, —
        * «✓» у прогресса значит «условие выполнено», а не «можно купить». */}
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {standing && <ProjectProgress standing={standing} compact={portrait} />}
        <span className="project-card-plate ml-auto shrink-0 whitespace-nowrap !pl-1.5 text-[11.5px] font-bold"
          title="Цена проекта">
          <span className={shortInfluence ? "text-bad" : "text-influence"}>{project.cost_influence}◆</span>
          {" + "}
          <span className={shortMoney ? "text-bad" : "text-money"}>{project.cost_money}$</span>
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
  const label = standing.binary ? (standing.met ? "готово" : "нет") : `${standing.have}/${standing.needed}`;
  return (
    <span
      role="progressbar"
      aria-label="Выполнение условия"
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
  return (
    <>
      <PopoverHeader title={project.title} subtitle={`${project.points} очков`} />
      <PopoverBody>
        <KeyValue
          rows={[
            ["Цена", `${project.cost_influence}◆ + ${project.cost_money}$ + ⚡`],
            ["Требование", projectRequirementText(project, meta)],
            [
              "Ваш прогресс",
              standing ? (
                <span className={standing.met ? "text-good" : "text-gold"}>
                  {standing.binary
                    ? standing.met
                      ? "выполнено"
                      : "не выполнено"
                    : `${standing.have} из ${standing.needed}`}
                </span>
              ) : (
                "—"
              ),
            ],
          ]}
        />
        <p className="mb-2">{project.text}</p>
        <p className="mb-2">
          <strong>🎁 Постоянный перк:</strong> {projectPerkText(project)}
        </p>
        <p className="mb-2">
          Проект уникален: кто взял — тот и забрал очки, остальным он больше недоступен. Доска общая
          и меняется у всех сразу.
        </p>
        {leaving && <p className="text-gold">⏳ Уходит в конце раунда — уйдёт в низ колоды.</p>}
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
            ⛔ Право вето — закрыть проект всем остальным (действие + 3◆)
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
            ? `Взять · ${project.cost_influence}◆ + ${project.cost_money}$`
            : state.kind === "pending"
              ? "Берём…"
              : state.reason}
        </button>
      </PopoverFooter>
    </>
  );
}
