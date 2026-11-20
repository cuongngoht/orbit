import type { AnySessionEvent } from "@orbit-web/contracts";
import { describe, expect, test } from "vitest";
import { inventory } from "../../testing/fixtures";
import { chatReducer, childrenOf, emptyChat, type ChatState } from "./chatReducer";

let seq = 0;
// One event as the session stream sends it (a transient one carries no sequence number).
const ev = (type: string, data: unknown, durable = true): AnySessionEvent => ({ id: `e${seq + 1}`, type, stream: "session", sessionId: "s", seq: durable ? ++seq : null, runId: "r", at: "t", data }) as AnySessionEvent;
const apply = (events: AnySessionEvent[], from: ChatState = emptyChat()) => events.reduce(chatReducer, from);

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

  test("each move of the working branch is a line of its own, in order", () => {
    seq = 0;
    const s = apply([
      ev("workspace.ready", { repository: "octo/sum-fixture", branch: "main", workBranch: "orbit-web/0b6c2f5e", baseCommit: "a", orbitSeated: true }),
      ev("workspace.branch", { from: "orbit-web/0b6c2f5e", workBranch: "dev", created: false, baseCommit: "a" }),
      ev("workspace.branch", { from: "dev", workBranch: "docs/approvers", created: true, baseCommit: "a" }),
    ]);
    expect(s.items.filter((i) => i.kind === "branch")).toEqual([
      { kind: "branch", id: "branch-2", from: "orbit-web/0b6c2f5e", workBranch: "dev", created: false },
      { kind: "branch", id: "branch-3", from: "dev", workBranch: "docs/approvers", created: true },
    ]);
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

  test("a plan proposed in Plan mode is one item of its own, in the order it came", () => {
    seq = 0;
    const s = apply([
      ev("message.completed", { messageId: "u1", role: "user", text: "Plan the fix", parentToolUseId: null, partial: false, truncated: false }),
      ev("plan.proposed", { toolUseId: "p1", plan: "1. Read\n2. Fix", truncated: true }),
    ]);
    expect(s.items.map((i) => i.kind)).toEqual(["message", "plan"]);
    expect(s.items[1]).toEqual({ kind: "plan", id: "plan-2", plan: "1. Read\n2. Fix", truncated: true });
  });

  test("what the repository brought is one item, and a plugin's progress updates it in place", () => {
    seq = 0;
    const read = inventory();
    const s = apply([ev("project.inventory", { inventory: read }), ev("project.plugin", { plugin: { ...read.plugins[0], state: "installing" } })]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "project", inventory: { plugins: [{ id: "lint-kit@acme-tools", state: "installing" }] } });
    const done = chatReducer(s, ev("project.plugin", { plugin: { ...read.plugins[0], state: "installed" } }));
    expect(done.items[0]).toMatchObject({ kind: "project", inventory: { plugins: [{ state: "installed" }] } });
  });

  test("a plugin's progress with nothing read yet changes nothing", () => {
    seq = 0;
    const s = apply([ev("project.plugin", { plugin: { ...inventory().plugins[0], state: "failed" } })]);
    expect(s.items).toEqual([]);
  });
});
