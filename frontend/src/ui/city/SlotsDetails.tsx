import type { CityMeta, LegalAction } from "../../online/types";
import { PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { KeyValue } from "../primitives/atoms";
import { resolve, type ActionContext } from "../lib/actions";
import { maxCapacity, nextSlotPrice, slotLadder } from "../lib/board";

/* Лестница расширения города. Цены приходят из /meta (scoring.capacity_costs) —
 * клиент больше не держит свою копию таблицы, которая устаревала молча.
 */
export function SlotsDetails({
  meta,
  context,
  onAction,
}: {
  meta: CityMeta;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
}) {
  const me = context.me;
  const ladder = slotLadder(meta);
  const price = nextSlotPrice(meta, me);
  const expand = resolve(context, "buy_capacity");
  const full = me.assets.length >= me.capacity;

  return (
    <>
      <PopoverHeader title="Слоты города" subtitle={`${me.assets.length} из ${me.capacity}`} />
      <PopoverBody>
        <p className="mb-2">
          Город начинается с трёх слотов и расширяется до {maxCapacity(meta)}. Каждое расширение стоит
          одно действие и деньги:
        </p>
        <KeyValue
          rows={ladder.map(step => [
            `Слот ${step.capacity + 1}`,
            <span className={me.capacity === step.capacity ? "text-gold" : me.capacity > step.capacity ? "text-ink-dim" : ""}>
              {step.cost}${me.capacity > step.capacity ? " — открыт" : me.capacity === step.capacity ? " — следующий" : ""}
            </span>,
          ])}
        />
        {full ? (
          <p className="mb-2 text-gold">
            Город полон. Пока слот не открыт, купить объект нельзя — либо расширяйтесь, либо продавайте.
          </p>
        ) : (
          <p className="mb-2 text-good">
            Свободно слотов: {me.capacity - me.assets.length}.
          </p>
        )}
        <p>
          Продажа объекта бесплатна, не тратит действие и освобождает слот сразу. Возврат равен очкам,
          которые объект давал, — смысл продажи только в том, что покупается вместо.
        </p>
      </PopoverBody>
      {price !== undefined && (
        <PopoverFooter>
          <button
            type="button"
            disabled={expand.kind !== "ready"}
            onClick={() => expand.kind === "ready" && onAction(expand.action)}
            className="rounded-md border border-good bg-good px-2 py-2 text-center text-xs font-semibold
              text-[#04130b] disabled:border-line disabled:bg-panel-2 disabled:text-ink-muted disabled:opacity-60"
          >
            {expand.kind === "ready"
              ? `Открыть слот ${me.capacity + 1} · ${price}$ + ⚡`
              : expand.kind === "pending"
                ? "Открываем…"
                : expand.reason}
          </button>
        </PopoverFooter>
      )}
      {price === undefined && (
        <PopoverFooter>
          <p className="text-center text-2xs text-ink-dim">Город расширен до максимума.</p>
        </PopoverFooter>
      )}
    </>
  );
}
