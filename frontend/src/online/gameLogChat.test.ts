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

describe("реплики ботов", () => {
  it("сервер присылает повод, а слова берутся из набора фраз по характеру бота", async () => {
    const { chatText } = await import("./botTalk");
    const base = Object.values(scenarios)[0] as RoomView;
    const game = { ...base.game!, players: base.game!.players.map(player => (player.id === "p-bot2" ? { ...player, difficulty: "raider" as const } : player)) };
    const line = (trigger: string, n: number) =>
      chatText({ seq: 1, player_id: "p-bot2", name: "Bot 2", text: "", at: "", round: 1, after_event: 0, line: { trigger, n } }, game);
    // У Рейдера на перекуп роли свои фразы, на оклеветанного — общие.
    expect(line("took_your_role", 0)).not.toBe("");
    expect(line("took_your_role", 0)).not.toBe(line("took_your_role", 1));
    expect(line("smeared", 0)).toBe(line("smeared", 3));
    // Неизвестный повод не роняет чат.
    expect(line("no_such_trigger", 0)).toBe("…");
    // Реплика человека — как написана.
    expect(chatText({ seq: 2, player_id: "x", name: "A", text: "привет", at: "", round: 1, after_event: 0 }, game)).toBe("привет");
  });
});
