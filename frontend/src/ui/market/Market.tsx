import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import type { AssetMeta, CityMeta, GameState, LegalAction, PlayerState } from "../../online/types";
import { Panel, SectionHead } from "../primitives/atoms";
import { useCommand, useGame, useLegalActions, useMe, useMeta } from "../lib/session";
import { MarketCard } from "./MarketCard";
import { marketCardState } from "./marketCardState";

/* Секция рынка.
 *
 * Разделена надвое сознательно: MarketGrid ничего не знает про Query и рендерится
 * из голых данных — на нём стоит /dev-галерея и на нём же будут скриншот-тесты.
 * Market — тонкая обвязка, которая достаёт то же самое из живой партии.
 */

export function MarketGrid({
  game,
  me,
  meta,
  legal,
  pending,
  onBuy,
}: {
  game: GameState;
  me: PlayerState;
  meta: CityMeta;
  legal: LegalAction[];
  pending?: LegalAction;
  onBuy: (action: LegalAction) => void;
}) {
  const assets = useMemo(
    () => new Map<string, AssetMeta>(meta.assets.map(asset => [asset.id, asset])),
    [meta.assets],
  );
  const districts = useMemo(
    () => new Map(meta.districts.map(district => [district.id, district])),
    [meta.districts],
  );
  const rotation = meta.scoring?.market_rotation_size ?? 3;

  return (
    <Panel rows zone="market">
      <SectionHead
        title="Рынок"
        meta={`${rotation} из ${game.market.length} слотов уйдут в конце раунда · в колоде ${game.market_deck_count}`}
      />

      {/* Шесть равных долей: слотов на рынке ровно столько. Два ряда делят высоту секции
        * поровну, и такая же разбивка у города — карточка одинакова до и после покупки. */}
      <div className="grid min-h-0 grid-cols-3 grid-rows-2 gap-[5px] [perspective:1200px]">
        <AnimatePresence mode="popLayout" initial={false}>
          {game.market.map(item => {
            const asset = assets.get(item.card_id);
            if (!asset) return null;
            const state = marketCardState({ item, asset, game, me, legal, pending });
            return (
              <motion.div
                key={item.uid}
                // Переворот: карта уходит с рынка гранью, новая приходит с другой стороны.
                // Ключ — uid из движка, поэтому Motion сам понимает, какой слот сменился.
                initial={{ rotateY: -90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 90, opacity: 0, transition: { duration: 0.22, delay: 0.5 } }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="min-h-0 min-w-0 [transform-style:preserve-3d]"
              >
                <MarketCard
                  item={item}
                  asset={asset}
                  district={districts.get(asset.district)}
                  me={me}
                  meta={meta}
                  assets={assets}
                  state={state}
                  onBuy={() => state.kind === "buyable" && onBuy(state.action)}
                  mark={legal.find(
                    action => action.type === "use_role_power" && action.payload.market_uid === item.uid,
                  )}
                  onMark={onBuy}
                  refresh={legal.find(
                    action => action.type === "market_refresh" && action.payload.market_uid === item.uid,
                  )}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Panel>
  );
}

export function Market() {
  const game = useGame();
  const me = useMe();
  const meta = useMeta();
  const legal = useLegalActions();
  const { send, pending } = useCommand();

  return <MarketGrid game={game} me={me} meta={meta} legal={legal} pending={pending} onBuy={send} />;
}
