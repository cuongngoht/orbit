import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { AnySessionEvent, SessionSummary } from "@orbit-web/contracts";
import { Database } from "../../infra/storage/database.js";
import { EventStore, SessionStore } from "../../infra/storage/stores.js";
import { EventBus, type AnyStreamEvent } from "./event-bus.js";
import { LiveText } from "./live-text.js";

const dir = mkdtempSync(join(tmpdir(), "ow-bus-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function setup() {
  const database = new Database(join(dir, `bus-${++n}.db`));
  const sessions = new SessionStore(database);
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  sessions.create({ id, title: "t", source: null, repository: null, repositoryId: null, branch: null, model: "sonnet", effort: "medium", mode: "autonomous", workspacePath: "/w", claudeSessionId: "c", status: "preparing", pendingPrompt: null });
  const journal = new EventStore(database);
  return { id, journal, bus: new EventBus(journal) };
}

test("a durable event is journaled first -- its sequence number is its id -- then delivered; a transient one is only delivered", () => {
  const { id, journal, bus } = setup();
  const seen: AnyStreamEvent[] = [];
  bus.subscribe({ stream: "session", sessionId: id }, (e) => {
    seen.push(e);
    if (e.seq !== null) assert.equal(journal.since(id, e.seq - 1)[0]?.id, e.id, "a durable event is in the journal before anyone hears of it");
  });
  const durable = bus.publishSession(id, "session.status", { status: "ready", reason: null });
  const transient = bus.publishSession(id, "message.delta", { messageId: "m", offset: 0, text: "hi" }, "run-1");
  assert.equal(durable.seq, 1);
  assert.equal(durable.id, `${id}:1`);
  assert.equal(durable.stream, "session");
  assert.equal(transient.seq, null);
  assert.match(transient.id, /^[0-9a-f-]{36}$/);
  assert.equal(transient.runId, "run-1");
  assert.deepEqual(seen.map((e) => e.type), ["session.status", "message.delta"]);
  assert.deepEqual(journal.since(id, 0).map((e: AnySessionEvent) => [e.id, e.type]), [[`${id}:1`, "session.status"]], "a replay carries the same id");
});

test("the catalog decides the stream: a type on the wrong stream, or not in the catalog, is refused before anything is kept", () => {
  const { id, journal, bus } = setup();
  assert.throws(() => bus.publishSession(id, "session.summary" as never, {} as never), /travels on the app stream/);
  assert.throws(() => bus.publishApp("session.status" as never, {} as never), /travels on the session stream/);
  assert.throws(() => bus.publishSession(id, "made.up" as never, {} as never), /not in the event catalog/);
  assert.equal(journal.since(id, 0).length, 0);
});

test("subscribers see only what their filter names, and one that throws does not stop the others", () => {
  const { id, bus } = setup();
  const app: string[] = [];
  const statusOnly: string[] = [];
  const other: string[] = [];
  bus.subscribe({ stream: "app" }, (e) => app.push(e.type));
  bus.subscribe({ stream: "session", types: ["session.status"] }, (e) => statusOnly.push(e.type));
  bus.subscribe({ stream: "session", sessionId: "someone-else" }, (e) => other.push(e.type));
  bus.subscribe({}, () => {
    throw new Error("a broken subscriber");
  });
  const summary = { id } as SessionSummary;
  const off = bus.subscribe({ stream: "app" }, (e) => app.push(`second:${e.type}`));
  bus.publishSession(id, "run.notice", { kind: "info", message: "x" });
  bus.publishSession(id, "session.status", { status: "running", reason: null });
  bus.publishApp("session.summary", { session: summary });
  off();
  bus.publishApp("session.removed", { sessionId: id });
  assert.deepEqual(app, ["session.summary", "second:session.summary", "session.removed"]);
  assert.deepEqual(statusOnly, ["session.status"]);
  assert.deepEqual(other, []);
});

test("the live text of a message still being written is kept for a late reader, and dropped when it completes or the run ends", () => {
  const { id, bus } = setup();
  const live = new LiveText(bus);
  live.onModuleInit();
  bus.publishSession(id, "message.started", { messageId: "m1", role: "assistant", parentToolUseId: null }, "r");
  bus.publishSession(id, "message.delta", { messageId: "m1", offset: 0, text: "Hel" }, "r");
  bus.publishSession(id, "message.delta", { messageId: "m1", offset: 3, text: "lo" }, "r");
  bus.publishSession(id, "message.delta", { messageId: "m1", offset: 9, text: "gap" }, "r");
  assert.deepEqual(live.snapshots(id).map((s) => s.data), [{ messageId: "m1", offset: 0, text: "Hello" }]);
  bus.publishSession(id, "message.completed", { messageId: "m1", role: "assistant", text: "Hello", parentToolUseId: null, partial: false, truncated: false }, "r");
  assert.deepEqual(live.snapshots(id), []);
  bus.publishSession(id, "message.started", { messageId: "m2", role: "assistant", parentToolUseId: null }, "r");
  bus.publishSession(id, "session.interrupted", { reason: "user_stop", exitCode: null, signal: "SIGINT" }, "r");
  assert.deepEqual(live.snapshots(id), [], "a run that ended keeps nothing");
  bus.publishSession(id, "message.started", { messageId: "m3", role: "assistant", parentToolUseId: null }, "r");
  bus.publishApp("session.removed", { sessionId: id });
  assert.deepEqual(live.snapshots(id), [], "a deleted chat keeps nothing");
});
