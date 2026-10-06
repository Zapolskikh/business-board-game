import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";
import { actionCardCost, actionLabel, cardDiscardValue } from "../../online/gameUi";
import type { ActionMeta, CardEffect, CityMeta, GameState, HeldCard, LegalAction } from "../../online/types";
import { tr } from "../../i18n";
import { CardPopover, PopoverBody, PopoverFooter, PopoverHeader } from "../primitives/CardPopover";
import { ResourceText } from "../primitives/ResourceIcon";
import { ListItem, Panel, SectionHead } from "../primitives/atoms";
import { findActions, resolve, turnBlock, usedThisTurn, type ActionContext } from "../lib/actions";
import type { Indexes } from "../lib/board";
import { useBlockedHint } from "../primitives/BlockedHint";

const toneColor: Record<string, string> = {
  attack: "#d4939a",
  defence: "#9fc4d1",
  resource: "#91c5a5",
  score: "#d4b3df",
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
  row = false,
}: {
  game: GameState;
  meta: CityMeta;
  index: Indexes;
  context: ActionContext;
  onAction: (action: LegalAction) => void;
  /** Одной строкой: на телефоне рука открывается панелью снизу во всю ширину экрана. */
  row?: boolean;
}) {
  const { t } = useTranslation("game");
  const me = context.me;
  const hand = me.hand ?? [];
  const draw = resolve(context, "buy_action_card");
  const played = usedThisTurn(game, "card_played");
  const converted = usedThisTurn(game, "card_converted");
  const blocked = useBlockedHint();

  return (
    <Panel rows>
      <SectionHead title={t("ui.hand.title")} meta={t("ui.hand.meta", { count: hand.length, deck: game.action_deck_count })} />
      <div
        className={`grid min-h-0 gap-1 ${
          row ? "h-[104px] grid-cols-[minmax(0,0.8fr)_repeat(3,minmax(0,1fr))] gap-1.5" : "grid-rows-[auto_repeat(3,minmax(0,1fr))]"
        }`}
      >
        <button
          type="button"
          data-ui="draw-card-button"
          data-tutorial="draw-card"
          aria-disabled={draw.kind !== "ready" || undefined}
          onClick={event =>
            draw.kind === "ready"
              ? onAction(draw.action)
              : blocked.show(draw.kind === "blocked" ? draw.reason : undefined, event.currentTarget)
          }
          title={draw.kind === "blocked" ? draw.reason : t("ui.hand.drawHint")}
          className="grid gap-1 rounded-md border border-good/60 bg-panel-2 px-2.5 py-2
            not-aria-disabled:hover:bg-panel-3 aria-disabled:border-line aria-disabled:opacity-45"
        >
          <b className="text-[15px] text-good">{t("ui.hand.draw")}</b>
          {/* Цена всегда на кнопке, а не вместо неё причина отказа: без цены нельзя
            * решить, копить ли на карты или на объект. Красным — тот ресурс, которого не хватает. */}
          <span className="flex items-center gap-1.5 text-[14.5px] text-ink-muted">
            <b className={me.money < actionCardCost(meta) ? "font-bold text-bad" : "font-bold text-money"}>
              <ResourceText>{`${actionCardCost(meta)}$`}</ResourceText>
            </b>
            +
            <b className={me.influence < 1 ? "font-bold text-bad" : "font-bold text-influence"}><ResourceText>1◆</ResourceText></b>
            +
            <b className={game.actions_left < 1 ? "font-bold text-bad" : "font-bold text-ink"}><ResourceText>1⚡</ResourceText></b>
          </span>
        </button>
        {blocked.hint}

        <AnimatePresence mode="popLayout" initial={false}>
          {hand.map(held => {
            const card = index.cards.get(held.card_id);
            if (!card) return null;
            /* Карты, где выбор был формальным, движок решает сам и присылает итог.
             * Сумма на лице карты — чтобы её было видно без открытия поповера. */
            const preview = game.card_previews?.[card.id];
            const effect = cardEffectText(game.card_effects?.[card.id]);
            return (
              <motion.div
                key={held.uid}
                data-tutorial={`hand-${held.card_id}`}
                layout
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="min-w-0"
              >
                <CardPopover
                  side="left"
                  label={t("ui.hand.variants", { title: card.title })}
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
                    data-ui="hand-card"
                    style={{ "--tone": toneColor[card.tone] ?? "#2d3d50" } as CSSProperties}
                    className="grid h-full w-full content-center gap-px rounded-md border border-line
                      border-l-[3px] border-l-[var(--tone)] bg-panel-2 px-2 py-1.5 text-left
                      hover:border-accent hover:border-l-[var(--tone)]"
                  >
                    <b className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold">
                      {card.title}
                    </b>
                    <small className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-ink-muted">
                      {preview ? (
                        <b className="font-semibold text-money">{t("ui.hand.now", { money: preview.money })}</b>
                      ) : effect ? (
                        <b className="font-semibold text-good"><ResourceText>{t("ui.hand.effectNow", { effect })}</ResourceText></b>
                      ) : (
                        <ResourceText>{card.text}</ResourceText>
                      )}
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
            className="empty-slot grid place-content-center rounded-md text-[12px] text-ink-dim"
          >
            {t("ui.hand.empty")}
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
  const { t } = useTranslation("game");
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
  const blocked = useBlockedHint();
  /* Сброс — раз за ход; если он уже был, причина ровно эта, иначе — общая причина хода. */
  const discardBlock = converted ? t("ui.hand.discardedReason") : turnBlock(context) ?? t("ui.actions.unavailable");

  return (
    <>
      <PopoverHeader title={card.title} subtitle={t(`ui.hand.tone.${card.tone as "deal" | "attack" | "defence"}`, { defaultValue: card.tone })} />
      <PopoverBody>
        <p className="mb-2 text-ink"><ResourceText>{card.text}</ResourceText></p>
        {game.card_previews?.[card.id] && (
          <p className="mb-2 text-money">
            {game.card_previews[card.id].district
              ? t("ui.hand.previewDistrict", {
                  money: game.card_previews[card.id].money,
                  district: index.districts.get(game.card_previews[card.id].district!)?.title ?? "",
                })
              : t("ui.hand.previewNone", { money: game.card_previews[card.id].money })}
          </p>
        )}
        {cardEffectText(game.card_effects?.[card.id]) && (
          <p data-ui="hand-card-effect" className="mb-2 font-semibold text-good">
            <ResourceText>{t("ui.hand.effectNow", { effect: cardEffectText(game.card_effects?.[card.id]) })}</ResourceText>
          </p>
        )}
        <p className="mb-2">
          {t("ui.hand.freeStart")}
          <strong>{t("ui.hand.freeStrong")}</strong>
          {t("ui.hand.freeEnd")}
        </p>

        {variants.length > 0 ? (
          <>
            <p className="mb-1 font-medium text-ink">
              {variants.length > 1 ? t("ui.hand.pick") : t("ui.hand.play")}
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
            {played ? t("ui.hand.played") : t("ui.hand.cantPlay")}
          </p>
        )}
      </PopoverBody>
      <PopoverFooter>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            aria-disabled={!toMoney || undefined}
            onClick={event => (toMoney ? onAction(toMoney) : blocked.show(discardBlock, event.currentTarget))}
            className="rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              not-aria-disabled:hover:border-accent aria-disabled:opacity-45"
          >
            {converted ? t("ui.hand.discarded") : t("ui.hand.discard", { value: discardValue.money })}
          </button>
          <button
            type="button"
            aria-disabled={!toInfluence || undefined}
            onClick={event => (toInfluence ? onAction(toInfluence) : blocked.show(discardBlock, event.currentTarget))}
            className="rounded-md border border-line bg-panel-2 px-2 py-2 text-center text-xs
              not-aria-disabled:hover:border-accent aria-disabled:opacity-45"
          >
            {converted ? "—" : t("ui.hand.discardInfluence", { value: discardValue.influence })}
          </button>
        </div>
        {blocked.hint}
      </PopoverFooter>
    </>
  );
}

/** «+1◆», «+14$», «цель −11$ · вам +10$» — одна строка из превью движка. Пусто, если карта
 * ничего не изменит (например, «Теневая касса» без объектов Серого сектора: «сейчас даст 0»
 * тоже ответ, его и печатаем). */
function cardEffectText(effect: CardEffect | undefined): string {
  if (!effect) return "";
  const own: string[] = [];
  if (effect.money) own.push(`${effect.money > 0 ? "+" : "−"}${Math.abs(effect.money)}$`);
  if (effect.influence) own.push(`${effect.influence > 0 ? "+" : "−"}${Math.abs(effect.influence)}◆`);
  if (effect.points) own.push(tr("game", "ui.hand.effectPoints", { count: effect.points }));
  const targetLoss: string[] = [];
  if (effect.target_money) targetLoss.push(`−${effect.target_money}$`);
  if (effect.target_influence) targetLoss.push(`−${effect.target_influence}◆`);
  if (targetLoss.length > 0) {
    const target = tr("game", "ui.hand.effectTarget", { loss: targetLoss.join(" ") });
    return own.length > 0 ? `${target} · ${tr("game", "ui.hand.effectYou", { gain: own.join(" ") })}` : target;
  }
  return own.length > 0 ? own.join(" ") : "0";
}
