import type { AnyAppEvent } from "@orbit-web/contracts";
import { describe, expect, test } from "vitest";
import { chatReducer, childrenOf, emptyChat, type ChatState } from "./chatReducer";

let seq = 0;
const ev = (type: string, data: unknown, durable = true): AnyAppEvent => ({ type, sessionId: "s", seq: durable ? ++seq : null, runId: "r", at: "t", data }) as AnyAppEvent;
const apply = (events: AnyAppEvent[], from: ChatState = emptyChat()) => events.reduce(chatReducer, from);

describe("the chat timeline", () => {
  test("streams a message from deltas, then takes the completed text", () => {
    seq = 0;
    const s = apply([
      ev("message.started", { messageId: "m1", role: "assistant", parentToolUseId: null }),
      ev("message.delta", { messageId: "m1", offset: 0, text: "Hello " }, false),
      ev("message.delta", { messageId: "m1", offset: 6, text: "wor" }, false),
    ]);
    expect(s.items).toEqual([{ kind: "message", id: "m1", role: "assistant", text: "Hello wor", streaming: true, partial: false, parentToolUseId: null }]);
    const done = chatReducer(s, ev("message.completed", { messageId: "m1", role: "assistant", text: "Hello world", parentToolUseId: null, partial: false, truncated: false }));
    expect(done.items[0]).toMatchObject({ text: "Hello world", streaming: false });
  });

  test("a durable event replayed after a reconnect changes nothing", () => {
    seq = 0;
    const first = ev("message.completed", { messageId: "u1", role: "user", text: "Fix it", parentToolUseId: null, partial: false, truncated: false });
    const s = apply([first, ev("session.status", { status: "running", reason: null })]);
    expect(chatReducer(s, first)).toBe(s);
    expect(s.lastSeq).toBe(2);
    expect(s.status).toBe("running");
  });

  test("a reconnect's snapshot of a message being written does not double its text", () => {
    seq = 0;
    const s = apply([ev("message.started", { messageId: "m", role: "assistant", parentToolUseId: null }), ev("message.delta", { messageId: "m", offset: 0, text: "abc " }, false)]);
    const again = chatReducer(s, ev("message.delta", { messageId: "m", offset: 0, text: "abc def " }, false));
    expect(again.items[0]).toMatchObject({ text: "abc def " });
  });

  test("tools start, finish or fail with their output; a subagent's tools sit under its Agent call", () => {
    seq = 0;
    const s = apply([
      ev("tool.started", { toolUseId: "a", name: "Agent", title: "Agent Explore: look", input: "{}", inputTruncated: false, parentToolUseId: null, agent: { subagentType: "Explore", description: "look" } }),
      ev("tool.started", { toolUseId: "b", name: "Grep", title: "Search sum", input: "{}", inputTruncated: false, parentToolUseId: "a", agent: null }),
      ev("tool.completed", { toolUseId: "b", output: "sum.mjs", truncated: false, isError: false, interrupted: false, parentToolUseId: "a" }),
      ev("tool.failed", { toolUseId: "a", output: "boom", truncated: false, isError: true, interrupted: false, parentToolUseId: null }),
    ]);
    expect(childrenOf(s.items, null).map((i) => i.id)).toEqual(["a"]);
    expect(childrenOf(s.items, "a").map((i) => i.id)).toEqual(["b"]);
    expect(s.items.find((i) => i.id === "b")).toMatchObject({ state: "done", output: "sum.mjs" });
    expect(s.items.find((i) => i.id === "a")).toMatchObject({ state: "failed", output: "boom" });
  });

  test("a run's end is recorded as the CLI reported it, and stops any streaming", () => {
    seq = 0;
    const s = apply([
      ev("message.started", { messageId: "m", role: "assistant", parentToolUseId: null }),
      ev("session.interrupted", { reason: "user_stop", exitCode: null, signal: "SIGINT" }),
    ]);
    expect(s.items[0]).toMatchObject({ streaming: false });
    expect(s.items[1]).toMatchObject({ kind: "run-end", end: { type: "session.interrupted" } });
  });

  test("Orbit's panel and verdict are kept as Orbit sent them", () => {
    seq = 0;
    const s = apply([ev("verification.updated", { word: "unknown", label: "Unknown", source: "no task" })]);
    expect(s.verification).toEqual({ word: "unknown", label: "Unknown", source: "no task" });
  });
});
