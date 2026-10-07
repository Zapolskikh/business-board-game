import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  greyEffectText,
  greyOperationDistricts,
  greyOperationLabels,
  greyOperationNeedsAll,
} from "../../online/gameUi";
import type { CityMeta, GameState, GreyTable, GreyTier, LegalAction } from "../../online/types";
import { PopoverBody, PopoverHeader } from "../primitives/CardPopover";
import { ResourceText } from "../primitives/ResourceIcon";
import { findActions, usedThisTurn, type ActionContext } from "../lib/actions";
import { scoreOf, targetStats } from "../lib/powerPreview";
import type { Indexes } from "../lib/board";
import { useIsMobile } from "../lib/layout";

/* Серые операции — бросок кубика. Таблица граней приходит от движка уже посчитанной под игрока
 * (game.grey_tables): модификаторы роли и карт, треть партии — клиент ничего не пересчитывает,
 * а только рисует. Так окно не может пообещать то, чего движок не заплатит. */

const ORDER = ["smear", "crypto", "datacenter", "influence_broker", "roof_break"] as const;

// Точки на грани, как на настоящем кубике: координаты в сетке 3×3.
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export function Die({ face, size = 34, dim = false }: { face: number; size?: number; dim?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 30 30"
      role="img"
      aria-label={String(face)}
      className={dim ? "opacity-50" : undefined}
    >
      <rect x="1" y="1" width="28" height="28" rx="6" fill="#f2f0ea" stroke="#7f8790" strokeWidth="1" />
      {(PIPS[face] ?? []).map(([column, row], position) => (
        <circle key={position} cx={7.5 + column * 7.5} cy={7.5 + row * 7.5} r="2.6" fill="#15191f" />
      ))}
    </svg>
  );
}

const TIER_CELL: Record<GreyTier, string> = {
  fail: "bg-[#df8e9812] text-bad",
  weak: "bg-[#dda36d14] text-warning",
  full: "bg-[#8fc9aa18] text-good",
};

export function GreyDetails({
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
  const spent = usedThisTurn(game, "grey_operation_used");
  const tables = game.grey_tables ?? [];
  const byId = new Map(tables.map(table => [table.asset_id, table]));
  const first = tables[0];
  const mobile = useIsMobile();
  const cap = meta.scoring?.grey_roll_cap ?? 3;
  const present = ORDER.filter(operationId => byId.has(operationId));
  /* Открытой встаёт первая операция, которую можно запустить прямо сейчас, иначе — первая
   * открытая районом: игрок открывает окно, чтобы что-то сделать, а не листать запертые. */
  const preferred =
    present.find(operationId => findActions(context, "grey_operation", { asset_id: operationId }).length > 0) ??
    present.find(operationId => byId.get(operationId)?.unlocked) ??
    present[0];
  const [tab, setTab] = useState<string | undefined>(preferred);
  const shown = tab && byId.has(tab) ? tab : preferred;

  /* Вводных абзацев над операциями нет: правила открытия, кубика и Защиты — в книге правил, а здесь
   * окно должно показывать операцию целиком, с кнопкой «Запустить», без прокрутки.
   *
   * Телефон: пять операций подряд — несколько экранов прокрутки. Там каждая операция — вкладка с
   * полной карточкой, а модификатор броска поднят в шапку окна: он общий для всех пяти. */
  if (mobile) {
    return (
      <div>
        <div className="border-b border-line px-3 py-2.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <b className="min-w-0 flex-1 text-[15px] font-bold">{t("ui.grey.title")}</b>
            <span className="shrink-0 text-2xs text-ink-dim">{spent ? t("ui.grey.spent") : t("ui.grey.once")}</span>
          </div>
          {first && <ModifierLine table={first} cap={cap} headline />}
        </div>
        <PopoverBody>
          <div role="tablist" aria-label={t("ui.grey.title")} className="mb-2.5 flex flex-wrap gap-1.5">
            {present.map(operationId => {
              const table = byId.get(operationId)!;
              const ready = findActions(context, "grey_operation", { asset_id: operationId }).length > 0;
              return (
                <button
                  key={operationId}
                  type="button"
                  role="tab"
                  data-ui={`grey-tab-${operationId}`}
                  aria-selected={operationId === shown}
                  data-active={operationId === shown || undefined}
                  onClick={() => setTab(operationId)}
                  className="mobile-tab flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-[13.5px] font-semibold"
                >
                  {!table.unlocked && <span aria-hidden="true">🔒</span>}
                  {greyOperationLabels[operationId] ?? operationId}
                  {ready && !spent && <span aria-hidden="true" className="size-2 rounded-full bg-good" />}
                </button>
              );
            })}
          </div>
          {shown && (
            <OperationBlock
              key={shown}
              operationId={shown}
              table={byId.get(shown)!}
              game={game}
              index={index}
              context={context}
              spent={spent}
              onAction={onAction}
            />
          )}
        </PopoverBody>
      </div>
    );
  }

  // One block, not a fragment: the modal is a grid whose first row shrinks to fit, and a header
  // standing on its own collapsed under a tall body.
  return (
    <div>
      <PopoverHeader title={t("ui.grey.title")} subtitle={spent ? t("ui.grey.spent") : t("ui.grey.once")} />
      <PopoverBody>
        {first && <ModifierLine table={first} cap={cap} />}

        <div className="grid gap-3">
          {ORDER.map(operationId => {
            const table = byId.get(operationId);
            if (!table) return null;
            return (
              <OperationBlock
                key={operationId}
                operationId={operationId}
                table={table}
                game={game}
                index={index}
                context={context}
                spent={spent}
                onAction={onAction}
              />
            );
          })}
        </div>
      </PopoverBody>
    </div>
  );
}

/** Модификатор броска. `headline` — в шапке окна на телефоне: крупно, зелёным и жирным. */
function ModifierLine({ table, cap, headline = false }: { table: GreyTable; cap: number; headline?: boolean }) {
  const { t } = useTranslation("game");
  if (!table.modifier) {
    return (
      <p className={headline ? "mt-1 text-[14px] font-semibold text-ink-muted" : "mb-3 text-[13px] text-ink-dim"}>
        {t("ui.grey.modifierNone")}
      </p>
    );
  }
  const parts = table.sources.map(item => t(`ui.grey.source.${item.source}`, { value: item.value, defaultValue: item.source }));
  const capped = table.sources.reduce((sum, item) => sum + item.value, 0) > table.modifier;
  return (
    <p data-ui="grey-modifier" className={headline ? "mt-1 text-[13px] text-ink" : "mb-3 text-[13px] text-ink"}>
      <b className={headline ? "text-[16px] font-extrabold text-good" : undefined}>
        {t("ui.grey.modifier", { value: table.modifier })}
      </b>{" "}
      <span className="text-ink-muted">({parts.join(", ")})</span>
      {capped && <span className="text-warning"> · {t("ui.grey.modifierCap", { cap })}</span>}
      <span className="text-ink-dim"> · {t("ui.grey.modifierShift")}</span>
    </p>
  );
}

function OperationBlock({
  operationId,
  table,
  game,
  index,
  context,
  spent,
  onAction,
}: {
  operationId: string;
  table: GreyTable;
  game: GameState;
  index: Indexes;
  context: ActionContext;
  spent: boolean;
  onAction: (action: LegalAction) => void;
}) {
  const { t } = useTranslation("game");
  const options = findActions(context, "grey_operation", { asset_id: operationId });
  const gates = (greyOperationDistricts[operationId] ?? [])
    .map(id => index.districts.get(id)?.title ?? id)
    .join(greyOperationNeedsAll.has(operationId) ? " + " : " / ");
  const shifted = table.modifier > 0;
  const available = options.length > 0;
  const reason = spent
    ? t("ui.grey.spentHint")
    : !table.unlocked
      ? t("ui.grey.needHint", { districts: gates })
      : operationId === "roof_break"
        ? t("ui.grey.noRoofs")
        : table.targeted
          ? t("ui.grey.noTarget")
          : t("ui.grey.unavailable");

  return (
    <section className={`rounded-[10px] border border-line-2 bg-panel-2 p-3 ${available ? "" : "opacity-70"}`}>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="card-serif text-[17px] text-ink">🌒 {greyOperationLabels[operationId] ?? operationId}</h3>
        <span className="text-[12px] text-ink-dim">
          {t("ui.grey.unlock", { districts: gates })}
          {` · ${table.targeted ? t("ui.grey.targeted") : operationId === "roof_break" ? t("ui.grey.massRoofs") : t("ui.grey.mass")}`}
        </span>
      </header>

      <table className="w-full table-fixed border-separate border-spacing-[3px] text-center text-[13px]">
        <thead>
          <tr>
            <th className="w-[118px] text-left text-[12px] font-normal text-ink-dim">{t("ui.grey.row.roll")}</th>
            {table.rows.map(row => (
              <th key={row.roll} className="py-1">
                <span className="inline-flex justify-center">
                  <Die face={row.roll} />
                </span>
              </th>
            ))}
          </tr>
          {shifted && (
            <tr>
              <th className="text-left text-[12px] font-normal text-ink-dim">{t("ui.grey.row.countsAs")}</th>
              {table.rows.map(row => (
                <td key={row.roll} className="text-[12px] text-ink-muted">
                  {row.face === row.roll ? row.face : <b className="text-ink">{row.face}</b>}
                </td>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          <tr>
            <th className="text-left text-[12px] font-normal text-ink-dim">{t("ui.grey.row.effect")}</th>
            {table.rows.map(row => (
              <td key={row.roll} className={`rounded-[6px] px-1 py-2 font-semibold leading-snug ${TIER_CELL[row.tier]}`}>
                <div className="text-[10px] font-normal uppercase tracking-wide opacity-80">{t(`ui.grey.tier.${row.tier}`)}</div>
                <ResourceText>{greyEffectText(operationId, row.effect, row.tier)}</ResourceText>
              </td>
            ))}
          </tr>
          <tr>
            <th className="text-left text-[12px] font-normal text-ink-dim">{t("ui.grey.row.scandals")}</th>
            {table.rows.map(row => (
              <td
                key={row.roll}
                className={`rounded-[6px] py-1.5 font-semibold ${
                  row.scandals === 0 ? "border border-good text-good" : "bg-panel-3 text-warning"
                }`}
              >
                {row.scandals === 0 ? t("ui.grey.clean") : `${row.scandals}⚠`}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {(operationId === "crypto" || operationId === "datacenter") && (
        <p className="mt-1 text-[11px] text-ink-dim">{t("ui.grey.capNote", { third: t(`ui.grey.third.${table.third as 0 | 1 | 2}`) })}</p>
      )}

      {/* Запуск — сразу под таблицей эффектов, до списка соперников: иначе у массовой операции
        * кнопка уходила под список и окно приходилось прокручивать. У адресной кнопки — в строках целей. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!available && <span className="text-[12px] text-ink-dim">{reason}</span>}
        {!table.targeted &&
          options.map((action, position) => (
            <button
              key={`${operationId}-${position}`}
              type="button"
              onClick={() => onAction(action)}
              className="primary-button rounded-[7px] px-4 py-2 text-[14px] font-semibold"
            >
              {t("ui.grey.run")}
            </button>
          ))}
      </div>
      {/* Цели — таблицей с деньгами, влиянием, скандалами, Защитой и очками, как у Рэкета:
        * без неё состояние соперников приходилось держать в голове или закрывать окно. Эффект по
        * граням — в таблице выше; что выпадет, решает кубик. */}
      <GreyTargets
        game={game}
        context={context}
        operationId={operationId}
        options={options}
        onAction={onAction}
      />
    </section>
  );
}

/** Соперники с их состоянием. У адресной операции в строке — кнопка запуска по этой цели,
 * у массовой — просто список тех, кого она заденет. */
function GreyTargets({
  game,
  context,
  operationId,
  options,
  onAction,
}: {
  game: GameState;
  context: ActionContext;
  operationId: string;
  options: LegalAction[];
  onAction: (action: LegalAction) => void;
}) {
  const { t } = useTranslation("game");
  const byTarget = new Map(
    options
      .filter(action => action.payload.target_id !== undefined)
      .map(action => [String(action.payload.target_id), action]),
  );
  const rivals = game.players.filter(player => player.id !== context.me.id);
  // «Пробить защиту» как раз снимает Защиту — у неё Защита ничего не гасит.
  const roofBlocks = operationId !== "roof_break";
  return (
    <table data-ui="grey-targets" className="mt-2 w-full border-collapse text-left text-xs">
      <thead>
        <tr className="text-3xs uppercase tracking-[0.06em] text-ink-dim">
          <th className="px-1.5 pb-1 font-semibold">{t("ui.grey.targetsTitle")}</th>
          <th className="px-1.5 pb-1 font-semibold">{t("ui.grey.targetsState")}</th>
          <th className="px-1.5 pb-1 text-right font-semibold">{t("ui.grey.targetsScore")}</th>
          {byTarget.size > 0 && <th className="pb-1" />}
        </tr>
      </thead>
      <tbody>
        {rivals.map(target => {
          const action = byTarget.get(target.id);
          const defended = roofBlocks && (target.roofs ?? 0) > 0;
          return (
            <tr key={target.id} className="border-t border-line align-middle">
              <td className="px-1.5 py-1.5 font-semibold text-ink">{target.name}</td>
              <td className="px-1.5 py-1.5 text-ink-muted">
                <ResourceText>{targetStats(target, undefined, roofBlocks)}</ResourceText>
              </td>
              <td className="px-1.5 py-1.5 text-right tabular-nums text-points">
                {t("ui.actions.pts", { count: scoreOf(game, target.id) })}
              </td>
              {byTarget.size > 0 && (
                <td className="py-1.5 pl-1 text-right">
                  {action && (
                    <button
                      type="button"
                      onClick={() => onAction(action)}
                      title={defended ? t("ui.grey.defended") : undefined}
                      className={`rounded-md border px-2 py-1 font-semibold ${
                        defended ? "border-line-2 text-ink-dim" : "border-primary text-ink hover:bg-panel-3"
                      }`}
                    >
                      {t("ui.grey.runAt", { name: target.name })}
                      {defended && " 🛡"}
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
