import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";
import { actionCardCost, actionLabel, cardDiscardValue } from "../../online/gameUi";
import type { ActionMeta, CityMeta, GameState, HeldCard, LegalAction } from "../../online/types";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { ListItem, Panel, SectionHead } from "../primitives/atoms";
import { findActions, resolve, usedThisTurn, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";

const toneColor: Record<string, string> = {
  attack: "#ff6b6b",
  defence: "#55b5ff",
  resource: "#39c47a",
  score: "#f2c14e",
};

/* Рука. Розыгрыш и сброс бесплатны и действия не тратят, но и того и другого —
 * по одному за ход, поэтому состояние «уже разыграна» показано явно.
 */
export function Hand({
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
  const me = context.me;
  const hand = me.hand ?? [];
  const draw = resolve(context, "buy_action_card");
  const played = usedThisTurn(game, "card_played");
  const converted = usedThisTurn(game, "card_converted");

  return (
    <Panel rows>
      <SectionHead title="Рука" meta={`${hand.length} / 3 · колода ${game.action_deck_count}`} />
      <div className="grid min-h-0 grid-rows-[auto_repeat(3,minmax(0,1fr))] gap-1">
        <button
          type="button"
          disabled={draw.kind !== "ready"}
          onClick={() => draw.kind === "ready" && onAction(draw.action)}
          title={draw.kind === "blocked" ? draw.reason : "Тянет две случайные карты из колоды"}
          className="grid gap-px rounded-md border border-[#2f7a4d] bg-[#152a1e] px-[7px] py-[5px]
            enabled:hover:border-good disabled:border-line disabled:bg-panel-2 disabled:opacity-45"
        >
          <b className="text-[11.5px] text-[#8ee0ae]">+ Вытянуть 2 карты</b>
          <small className="text-3xs text-ink-muted">
            {draw.kind === "blocked" ? draw.reason : `${actionCardCost(meta)}$ + 1◆ + ⚡`}
          </small>
        </button>

        <AnimatePresence mode="popLayout" initial={false}>
          {hand.map(held => {
            const card = index.cards.get(held.card_id);
            if (!card) return null;
            return (
              <motion.div
                key={held.uid}
                layout
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="min-w-0"
              >
                <CardPopover
                  side="left"
                  label={`${card.title} — варианты`}
                  content={
                    <HandCardDetails
                      held={held}
                      card={card}
                      game={game}
                      meta={meta}
                      index={index}
                      context={context}
                      played={played}
                      converted={converted}
                      onAction={onAction}
                    />
                  }
                >
                  <button
                    type="button"
                    style={{ "--tone": toneColor[card.tone] ?? "#2d3d50" } as CSSProperties}
                    className="grid h-full w-full content-center gap-px rounded-md border border-line
                      border-l-[3px] border-l-[var(--tone)] bg-panel-2 px-[7px] py-[5px] text-left
                      hover:border-accent hover:border-l-[var(--tone)]"
                  >
                    <b className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-semibold">
                      {card.title}
                    </b>
                    <small className="overflow-hidden text-ellipsis whitespace-nowrap text-3xs text-ink-muted">
                      {card.text}
                    </small>
                  </button>
                </CardPopover>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {Array.from({ length: Math.max(0, 3 - hand.length) }).map((_, position) => (
          <div
            key={`empty-${position}`}
            className="grid place-content-center rounded-md border border-dashed border-line
              bg-[#0e1720] text-2xs text-ink-dim"
          >
            пусто
          </div>
        ))}
      </div>
    </Panel>
  );
}

function HandCardDetails({
  held,
  card,
  game,
  meta,
  index,
  context,
  played,
  converted,
  onAction,
}: {
  held: HeldCard;
  card: ActionMeta;
  game: GameState;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  played: boolean;
  converted: boolean;
  onAction: (action: LegalAction) => void;
}) {
  const labelContext = {
    game,
    meta,
    player: context.me,
    assets: index.assets,
    cards: index.cards,
    roles: index.roles,
    districts: index.districts,
    projects: index.projects,
  };
  const variants = findActions(context, "play_action_card", { card_uid: held.uid });
  const toMoney = findActions(context, "convert_action_card", { card_uid: held.uid, into: "money" })[0];
  const toInfluence = findActions(context, "convert_action_card", {
    card_uid: held.uid,
    into: "influence",
  })[0];
  const discardValue = cardDiscardValue(meta);

  return (
    <>
      <PopoverHeader title={card.title} subtitle={card.tone} />
      <PopoverBody>
        <p className="mb-2 text-ink">{card.text}</p>
        <p className="mb-2">
          Розыгрыш бесплатный и не тратит действие, но <strong>одна карта за ход</strong>. Сброс тоже
          бесплатный и тоже один за ход.
        </p>

        {variants.length > 0 ? (
          <>
            <p className="mb-1 font-medium text-ink">
              {variants.length > 1 ? "Выберите вариант" : "Разыграть"}
            </p>
            <div className="grid gap-1">
              {variants.map((action, position) => (
                <ListItem
                  key={position}
                  icon="▶"
                  title={actionLabel(action, labelContext)}
                  onClick={() => onAction(action)}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="mb-2 text-gold">
            {played ? "Карта в этом ходу уже разыграна." : "Разыграть сейчас нельзя."}
          </p>
        )}
      </PopoverBody>
      <PopoverFooter>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={!toMoney}
            onClick={() => toMoney && onAction(toMoney)}
            className="rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              enabled:hover:border-accent disabled:opacity-45"
          >
            {converted ? "Сброс уже был" : `Сбросить за ${discardValue}$`}
          </button>
          <button
            type="button"
            disabled={!toInfluence}
            onClick={() => toInfluence && onAction(toInfluence)}
            className="rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              enabled:hover:border-accent disabled:opacity-45"
          >
            {converted ? "—" : `Сбросить за ${discardValue}◆`}
          </button>
        </div>
      </PopoverFooter>
    </>
  );
}
