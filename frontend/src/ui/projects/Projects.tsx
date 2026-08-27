import { AnimatePresence, motion } from "motion/react";
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
              <motion.div
                key={projectId}
                layout
                initial={{ rotateY: -90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 90, opacity: 0, transition: { duration: 0.22, delay: 0.4 } }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="min-w-0 [transform-style:preserve-3d]"
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

function ProjectCard({
  project,
  meta,
  standing,
  leaving,
  ready,
  pending,
  ...rest
}: {
  project: ProjectMeta;
  meta: CityMeta;
  standing: Standing;
  leaving: boolean;
  ready: boolean;
  pending: boolean;
}) {
  const met = standing?.met ?? false;
  const ratio = standing && standing.needed > 0 ? Math.min(1, standing.have / standing.needed) : met ? 1 : 0;

  return (
    <button
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
      <span className="text-[11.5px] font-semibold">
        {project.cost_influence}◆ + {project.cost_money}$
      </span>
      <span
        className={`overflow-hidden text-ellipsis whitespace-nowrap text-2xs ${
          met ? "text-good" : "text-ink-muted"
        }`}
      >
        {met ? "✓ " : ""}
        {projectRequirementText(project, meta)}
        {standing && !standing.binary && ` ${standing.have}/${standing.needed}`}
      </span>
      <span className="h-[3px] overflow-hidden rounded-sm bg-panel-3">
        <i className={`block h-full ${met ? "bg-good" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
      </span>
    </button>
  );
}

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
