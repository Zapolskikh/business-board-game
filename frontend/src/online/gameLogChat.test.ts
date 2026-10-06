import { describe, expect, it } from "vitest";
import { buildGameLogMarkdown } from "./gameUi";
import type { RoomView } from "./types";
import { meta, scenarios } from "../ui/dev/fixtures";

describe("журнал партии .md и чат", () => {
  it("ставит реплики между событиями, на которых они прозвучали", () => {
    const base = Object.values(scenarios)[0] as RoomView;
    const events = base.game!.event_log;
    const anchor = events[0].seq;
    const room: RoomView = {
      ...base,
      chat: [
        { seq: 1, player_id: "p-bot2", name: "Bot 2", text: "до начала", at: "", round: null, after_event: 0 },
        { seq: 2, player_id: "p-bot2", name: "Bot 2", text: "по ходу", at: "", round: 6, after_event: anchor },
      ],
    };
    const lines = buildGameLogMarkdown(room, meta, "test").split("\n");
    const early = lines.indexOf("> 💬 **Bot 2:** до начала");
    const first = lines.findIndex(line => line.startsWith(`${anchor}. `));
    const late = lines.indexOf("> 💬 **Bot 2:** по ходу");
    expect(early).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(early);
    expect(late).toBe(first + 1);
  });

  it("без чата журнал остаётся прежним", () => {
    const base = Object.values(scenarios)[0] as RoomView;
    expect(buildGameLogMarkdown(base, meta, "test")).not.toContain("💬");
  });
});
