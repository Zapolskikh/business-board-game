import { AnimatePresence, motion } from "motion/react";
import { forwardRef } from "react";
import { projectPerkText, projectRequirementText, projectRerollMoney } from "../../online/gameUi";
import type { CityMeta, GameState, LegalAction, ProjectMeta } from "../../online/types";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue, Panel } from "../primitives/atoms";
import { resolve, usedThisTurn, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";

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
  const reroll = resolve(context, "reroll_projects");
  const rerolled = usedThisTurn(game, "projects_rerolled");
  const mine = context.me.projects
    .map(id => index.projects.get(id))
    .filter((project): project is ProjectMeta => Boolean(project));
  const minePoints = mine.reduce((sum, project) => sum + project.points, 0);

  return (
    <Panel>
      <div className="flex items-baseline gap-2 px-0.5 pb-[5px]">
        <h2 className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-muted">
          Городские проекты
        </h2>
        <span className="text-[10.5px] text-ink-dim">
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
          className="ml-auto rounded-[10px] border border-line bg-panel-2 px-1.5 py-0.5 text-3xs
            text-ink-muted enabled:hover:border-accent disabled:opacity-45"
        >
          🔄 Пересобрать · {projectRerollMoney(meta)}$ + ⚡
        </button>
        <span className="whitespace-nowrap text-[10.5px] text-ink-dim">
          в колоде {game.project_deck_count}
        </span>
      </div>

      {/* 90% ширины: проектов всегда четыре, и на всю колонку карточки растягивались
        * шире, чем требует их содержимое. */}
      <div className="grid grid-cols-4 gap-[5px]">
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
  }
>(function ProjectCard(
  { project, meta, standing, leaving, ready, pending, shortInfluence, shortMoney, ...rest },
  ref,
) {
  const met = standing?.met ?? false;
  const ratio = standing && standing.needed > 0 ? Math.min(1, standing.have / standing.needed) : met ? 1 : 0;
  const counted = standing && !standing.binary;

  return (
    <button
      ref={ref}
      type="button"
      data-state={pending ? "pending" : ready ? "ready" : met ? "met" : "locked"}
      className="grid w-full gap-[3px] rounded-card border border-line bg-panel-2 px-[7px] py-1.5
        text-left hover:border-accent
        data-[state=ready]:border-[#2f7a4d] data-[state=ready]:bg-[#13291d]
        data-[state=pending]:animate-pulse"
      {...rest}
    >
      <span className="flex items-baseline gap-1.5">
        <b className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold">
          {project.title}
        </b>
        <span className="rounded-[10px] border border-[#6b5518] bg-[#33290e] px-1.5 text-[11px]
          font-extrabold whitespace-nowrap text-gold">
          {project.points} оч
        </span>
        {leaving && (
          <span className="rounded bg-[#3a2d12] px-1 text-3xs text-gold" title="Уходит в конце раунда">
            ⏳
          </span>
        )}
      </span>

      {/* Цена слева, прогресс — отдельной плашкой под очками, в правой колонке.
        * Раньше «0/3» дописывалось хвостом к тексту требования и сливалось с ним:
        * единственное число, которое меняется по ходу партии, читалось хуже всего.
        *
        * Красным горит именно та цифра, которой не хватает, — независимо от условия.
        * «✓ готово» рядом с недоступной кнопкой сбивало с толку: выполнено требование,
        * а не покупка, и второй половины ответа на карточке не было. */}
      <span className="flex items-center gap-1.5">
        <span className="flex-1 text-[11.5px] font-semibold">
          <span className={shortInfluence ? "text-bad" : undefined}>{project.cost_influence}◆</span>
          {" + "}
          <span className={shortMoney ? "text-bad" : undefined}>{project.cost_money}$</span>
        </span>
        {(counted || standing) && (
          <span
            data-met={met || undefined}
            className="rounded-[10px] border border-line bg-panel-3 px-1.5 text-[11px] font-extrabold
              tabular-nums whitespace-nowrap text-ink-muted
              data-[met]:border-[#2f7a4d] data-[met]:bg-[#13291d] data-[met]:text-good"
          >
            {counted ? `${standing.have}/${standing.needed}` : met ? "✓ готово" : "не готово"}
          </span>
        )}
      </span>

      <span
        className={`overflow-hidden text-ellipsis whitespace-nowrap text-2xs ${
          met ? "text-good" : "text-ink-muted"
        }`}
      >
        {met ? "✓ " : ""}
        {projectRequirementText(project, meta)}
      </span>
      <span className="h-[3px] overflow-hidden rounded-sm bg-panel-3">
        <i className={`block h-full ${met ? "bg-good" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
      </span>
    </button>
  );
});

function ProjectDetails({
  project,
  meta,
  standing,
  leaving,
  state,
  onTake,
}: {
  project: ProjectMeta;
  meta: CityMeta;
  standing: Standing;
  leaving: boolean;
  state: ReturnType<typeof resolve>;
  onTake: () => void;
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
        <button
          type="button"
          disabled={state.kind !== "ready"}
          onClick={onTake}
          className="rounded-md border border-good bg-good px-2 py-2 text-center text-xs font-semibold
            text-[#04130b] disabled:border-line disabled:bg-panel-2 disabled:text-ink-muted disabled:opacity-60"
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
