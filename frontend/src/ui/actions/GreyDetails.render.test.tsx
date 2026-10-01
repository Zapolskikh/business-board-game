import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameState, PlayerState } from "../../online/types";
import { ME, meta, scenarios } from "../dev/fixtures";
import type { ActionContext } from "../lib/actions";
import { indexMaps } from "../lib/board";
import { GreyDetails } from "./GreyDetails";

// SSR разделяет соседние текстовые узлы комментариями `<!-- -->`; для проверок по тексту их надо убрать.
const text = (html: string) => html.split("<!-- -->").join("");

function render(overrides: Partial<GameState> = {}) {
  const room = scenarios["Слоты заняты"];
  const game = { ...(room.game as GameState), ...overrides };
  const me = game.players.find(player => player.id === ME) as PlayerState;
  const context: ActionContext = {
    game,
    me,
    legal: [
      { type: "grey_operation", payload: { asset_id: "smear" } },
      { type: "grey_operation", payload: { asset_id: "crypto" } },
    ],
  };
  return text(
    renderToString(<GreyDetails game={game} meta={meta} index={indexMaps(meta)} context={context} onAction={() => {}} />),
  );
}

describe("grey operations window", () => {
  it("draws one die table per operation, straight from the engine's rows", () => {
    const html = render();
    // Пять операций, у каждой шесть граней кубика.
    expect(html.match(/<svg/g)?.length).toBe(5 * 6);
    // Эффект грани — готовое число из движка, а не формула. Символы $ и ◆ рисуются иконками,
    // поэтому проверяем число и слова вокруг них.
    expect(html).toMatch(/>6<img[^>]*>[^<]*с каждого/);
    expect(html).toContain("снять роль, вам +3");
    // Модификатор аферист +1 показан и сдвигает грани.
    expect(html).toContain("+1");
    expect(html).toContain("Считается как");
    // Клетка без скандала выделена словом, а не числом.
    expect(html).toContain("чисто");
  });

  it("explains why an operation cannot run instead of hiding it", () => {
    const html = render();
    // «Слив компромата» в фикстуре закрыт: нужен объект района.
    expect(html).toContain("нужен объект района");
  });

  it("renders without engine tables at all", () => {
    expect(() => render({ grey_tables: undefined })).not.toThrow();
  });
});
