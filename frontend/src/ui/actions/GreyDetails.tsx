import { useTranslation } from "react-i18next";
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
import type { Indexes } from "../lib/board";

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

  // One block, not a fragment: the modal is a grid whose first row shrinks to fit, and a header
  // standing on its own collapsed under a tall body.
  return (
    <div>
      <PopoverHeader title={t("ui.grey.title")} subtitle={spent ? t("ui.grey.spent") : t("ui.grey.once")} />
      <PopoverBody>
        <p className="mb-2 text-[13px] text-ink-muted">{t("ui.grey.intro")}</p>
        <p className="mb-3 text-[13px] text-ink-muted">
          <ResourceText>{t("ui.grey.defence")}</ResourceText>
        </p>
        {first && <ModifierLine table={first} cap={meta.scoring?.grey_roll_cap ?? 3} />}

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

function ModifierLine({ table, cap }: { table: GreyTable; cap: number }) {
  const { t } = useTranslation("game");
  if (!table.modifier) {
    return <p className="mb-3 text-[13px] text-ink-dim">{t("ui.grey.modifierNone")}</p>;
  }
  const parts = table.sources.map(item => t(`ui.grey.source.${item.source}`, { value: item.value, defaultValue: item.source }));
  const capped = table.sources.reduce((sum, item) => sum + item.value, 0) > table.modifier;
  return (
    <p className="mb-3 text-[13px] text-ink">
      {t("ui.grey.modifier", { value: table.modifier })} <span className="text-ink-muted">({parts.join(", ")})</span>
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

      <div className="mt-2 flex flex-wrap gap-2">
        {!available && <span className="text-[12px] text-ink-dim">{reason}</span>}
        {options.map((action, position) => {
          const targetId = action.payload.target_id as string | undefined;
          const target = targetId ? game.players.find(player => player.id === targetId) : undefined;
          const defended = Boolean(target && (target.roofs ?? 0) > 0);
          return (
            <button
              key={`${operationId}-${position}`}
              type="button"
              onClick={() => onAction(action)}
              title={defended ? t("ui.grey.defended") : undefined}
              className={`rounded-[7px] border px-3 py-1.5 text-[13px] ${
                defended ? "border-line-2 text-ink-dim" : "border-primary text-ink hover:bg-panel-3"
              }`}
            >
              {target ? t("ui.grey.runAt", { name: target.name }) : t("ui.grey.run")}
              {defended && " 🛡"}
            </button>
          );
        })}
      </div>
    </section>
  );
}
