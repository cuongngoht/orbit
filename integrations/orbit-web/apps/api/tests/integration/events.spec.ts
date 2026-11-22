// THE EVENT JOURNAL AND ITS STREAMS against a real PostgreSQL: a durable event is in the journal before anyone hears of
// it, nothing is said about work rolled back, one chat's events arrive in the order of their numbers however many are
// published at once, and a stream that replays the journal while events keep arriving loses none and repeats none.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { AnySessionEvent, SessionSummary } from "@orbit-web/contracts";
import { SEARCH_PATH } from "../../src/core/core.module.js";
import { accountAudience, EventBus, everyone, type Audience, type AnyStreamEvent } from "../../src/core/events/event-bus.js";
import { LiveText } from "../../src/core/events/live-text.js";
import { reaches, replayThenLive, type StreamHolder } from "../../src/core/events/stream-gateway.js";
import { Db } from "../../src/infra/db/db.js";
import { migrate } from "../../src/infra/db/migrate.js";
import type { SseChannel } from "../../src/infra/sse/sse.js";
import { EventStore, SessionStore } from "../../src/infra/storage/stores.js";
import { createTestDatabase, type TestDatabase } from "../../src/testing/database.js";

let t: TestDatabase;
let db: Db;
let accountId: string;

before(async () => {
  t = await createTestDatabase();
  db = new Db({ url: t.url, poolMax: 10, connectTimeoutMs: 5_000, statementTimeoutMs: 30_000, searchPath: SEARCH_PATH });
  await migrate(db);
  accountId = randomUUID();
  await db.query("INSERT INTO accounts (id, display_name, created_at, updated_at) VALUES ($1, '', now(), now())", [accountId]);
});

after(async () => {
  await db.close();
  await t.drop();
});

async function chat(): Promise<{ id: string; journal: EventStore; bus: EventBus }> {
  const id = randomUUID();
  await new SessionStore(db).create({ id, accountId, ownerEmail: "octo@example.com", title: "t", source: null, repository: null, repositoryId: null, branch: null, model: "sonnet", effort: "medium", mode: "autonomous", workspacePath: "/w", runtime: "claude", connectionId: null, claudeSessionId: "c", status: "preparing", pendingPrompt: null });
  const journal = new EventStore(db);
  return { id, journal, bus: new EventBus(db, journal) };
}

// A channel a test reads: what a browser would have received, in order.
function channel(): SseChannel & { got: { payload: AnySessionEvent; id: number | null | undefined }[] } {
  const got: { payload: AnySessionEvent; id: number | null | undefined }[] = [];
  let closed = false;
  return {
    got,
    send: (payload, id) => void got.push({ payload: payload as AnySessionEvent, id }),
    close: () => void (closed = true),
    get closed() {
      return closed;
    },
  };
}

describe("the journal and the bus", () => {
  test("a durable event is journaled first -- its sequence number is its id -- then delivered; a transient one is only delivered", async () => {
    const { id, journal, bus } = await chat();
    const seen: AnyStreamEvent[] = [];
    const checks: Promise<void>[] = [];
    bus.subscribe({ stream: "session", sessionId: id }, (e) => {
      seen.push(e);
      if (e.seq !== null) checks.push(journal.since(id, e.seq - 1).then((rows) => assert.equal(rows[0]?.id, e.id, "a durable event is in the journal before anyone hears of it")));
    });
    const durable = await bus.publishSession(id, "session.status", { status: "ready", reason: null });
    const transient = await bus.publishSession(id, "message.delta", { messageId: "m", offset: 0, text: "hi" }, "run-1");
    await Promise.all(checks);
    assert.equal(durable.seq, 1);
    assert.equal(durable.id, `${id}:1`);
    assert.equal(transient.seq, null);
    assert.equal(transient.runId, "run-1");
    assert.deepEqual(seen.map((e) => e.type), ["session.status", "message.delta"]);
    assert.deepEqual((await journal.since(id, 0)).map((e) => [e.id, e.type]), [[`${id}:1`, "session.status"]], "a replay carries the same id");
  });

  test("an event published inside a transaction is heard only once it commits, and never when it rolls back", async () => {
    const { id, journal, bus } = await chat();
    const seen: string[] = [];
    bus.subscribe({ stream: "session", sessionId: id }, (e) => seen.push(e.type));
    await db.tx(async () => {
      await bus.publishSession(id, "run.notice", { kind: "info", message: "inside" });
      assert.deepEqual(seen, [], "nothing is delivered before the commit");
    });
    assert.deepEqual(seen, ["run.notice"]);
    await assert.rejects(
      db.tx(async () => {
        await bus.publishSession(id, "run.notice", { kind: "info", message: "rolled back" });
        bus.publishApp("session.removed", { sessionId: id }, accountAudience(accountId));
        throw new Error("the change fails");
      }),
    );
    assert.deepEqual(seen, ["run.notice"], "nothing is said about work that was rolled back");
    assert.equal((await journal.since(id, 0)).length, 1, "and nothing of it is in the journal");
    assert.equal(await journal.head(id), 1, "its number was not spent either");
  });

  test("one chat's events arrive in the order of their numbers, however many are published at once", async () => {
    const { id, bus } = await chat();
    const seqs: number[] = [];
    bus.subscribe({ stream: "session", sessionId: id }, (e) => {
      if (e.seq !== null) seqs.push(e.seq);
    });
    await Promise.all(Array.from({ length: 60 }, (_, i) => bus.publishSession(id, "run.notice", { kind: "info", message: String(i) })));
    await bus.settled(id);
    assert.deepEqual(seqs, Array.from({ length: 60 }, (_, i) => i + 1));
  });

  test("concurrent writers of one chat never share a number", async () => {
    const { id, journal } = await chat();
    const events = await Promise.all(Array.from({ length: 40 }, () => journal.append(id, "run.notice", { kind: "info", message: "x" }, null)));
    assert.deepEqual(events.map((e) => e.seq).sort((a, b) => Number(a) - Number(b)), Array.from({ length: 40 }, (_, i) => i + 1));
  });

  test("the catalog decides the stream: a type on the wrong stream, or not in the catalog, is refused before anything is kept", async () => {
    const { id, journal, bus } = await chat();
    await assert.rejects(bus.publishSession(id, "session.summary" as never, {} as never), /travels on the app stream/);
    assert.throws(() => bus.publishApp("session.status" as never, {} as never, everyone), /travels on the session stream/);
    await assert.rejects(bus.publishSession(id, "made.up" as never, {} as never), /not in the event catalog/);
    assert.equal((await journal.since(id, 0)).length, 0);
  });

  test("subscribers see only what their filter names, with the audience an app event was published to; one that throws does not stop the others", async () => {
    const { id, bus } = await chat();
    const app: [string, Audience | null][] = [];
    const statusOnly: string[] = [];
    bus.subscribe({ stream: "app" }, (e, audience) => app.push([e.type, audience]));
    bus.subscribe({ stream: "session", types: ["session.status"] }, (e) => statusOnly.push(e.type));
    bus.subscribe({}, () => {
      throw new Error("a broken subscriber");
    });
    await bus.publishSession(id, "run.notice", { kind: "info", message: "x" });
    await bus.publishSession(id, "session.status", { status: "running", reason: null });
    bus.publishApp("session.summary", { session: { id } as SessionSummary }, accountAudience(accountId, ["friend@example.com"]));
    assert.deepEqual(app, [["session.summary", { kind: "account", accountId, emails: ["friend@example.com"] }]]);
    assert.deepEqual(statusOnly, ["session.status"]);
  });

  test("the live text of a message still being written is kept for a late reader, and dropped when it completes or the run ends", async () => {
    const { id, bus } = await chat();
    const live = new LiveText(bus);
    live.onModuleInit();
    await bus.publishSession(id, "message.started", { messageId: "m1", role: "assistant", parentToolUseId: null }, "r");
    await bus.publishSession(id, "message.delta", { messageId: "m1", offset: 0, text: "Hel" }, "r");
    await bus.publishSession(id, "message.delta", { messageId: "m1", offset: 3, text: "lo" }, "r");
    await bus.publishSession(id, "message.delta", { messageId: "m1", offset: 9, text: "gap" }, "r");
    assert.deepEqual(live.snapshots(id).map((s) => s.data), [{ messageId: "m1", offset: 0, text: "Hello" }]);
    await bus.publishSession(id, "message.completed", { messageId: "m1", role: "assistant", text: "Hello", parentToolUseId: null, partial: false, truncated: false }, "r");
    assert.deepEqual(live.snapshots(id), []);
    await bus.publishSession(id, "message.started", { messageId: "m2", role: "assistant", parentToolUseId: null }, "r");
    await bus.publishSession(id, "session.interrupted", { reason: "user_stop", exitCode: null, signal: "SIGINT" }, "r");
    assert.deepEqual(live.snapshots(id), [], "a run that ended keeps nothing");
  });
});

describe("a stream replays the journal and goes live without losing or repeating an event", () => {
  test("events written while the journal is being read arrive once each, in order", async () => {
    const { id, journal, bus } = await chat();
    for (let i = 0; i < 5; i += 1) await bus.publishSession(id, "run.notice", { kind: "info", message: `before ${i}` });
    const ch = channel();
    let reads = 0;
    const unsubscribe = await replayThenLive({
      channel: ch,
      after: 2,
      head: () => journal.head(id),
      // The journal is slow to read: while its first page is being read, more is written.
      read: async (after, until) => {
        reads += 1;
        if (reads === 1) for (let i = 0; i < 5; i += 1) await bus.publishSession(id, "run.notice", { kind: "info", message: `during ${i}` });
        return journal.since(id, after, 2, until);
      },
      subscribe: (push) => bus.subscribe({ stream: "session", sessionId: id }, (e) => push(e as AnySessionEvent)),
    });
    await bus.publishSession(id, "run.notice", { kind: "info", message: "after" });
    await bus.settled(id);
    unsubscribe();
    const seqs = ch.got.map((g) => g.payload.seq);
    assert.deepEqual(seqs, [3, 4, 5, 6, 7, 8, 9, 10, 11], "everything after Last-Event-ID 2, once, in order");
    assert.deepEqual(
      ch.got.map((g) => g.id),
      seqs,
      "each is sent with its number as the event id",
    );
  });

  test("a stream that resumes at the head gets only what comes next", async () => {
    const { id, journal, bus } = await chat();
    for (let i = 0; i < 3; i += 1) await bus.publishSession(id, "run.notice", { kind: "info", message: String(i) });
    const ch = channel();
    const unsubscribe = await replayThenLive({ channel: ch, after: 3, head: () => journal.head(id), read: (after, until) => journal.since(id, after, 100, until), subscribe: (push) => bus.subscribe({ stream: "session", sessionId: id }, (e) => push(e as AnySessionEvent)) });
    await bus.publishSession(id, "run.notice", { kind: "info", message: "next" });
    await bus.settled(id);
    unsubscribe();
    assert.deepEqual(ch.got.map((g) => g.payload.seq), [4]);
  });
});

describe("an app notification reaches its audience and no one else", () => {
  const a: StreamHolder = { accountId: "account-a", email: "a@example.com", sessionId: "s-a" };
  const b: StreamHolder = { accountId: "account-b", email: "b@example.com", sessionId: "s-b" };

  test("an account's record reaches that account and the emails it was shared with; a deployment fact reaches everyone", () => {
    assert.equal(reaches(accountAudience("account-a"), a), true);
    assert.equal(reaches(accountAudience("account-a"), b), false, "never another account");
    assert.equal(reaches(accountAudience("account-a", ["b@example.com"]), b), true, "the email it is shared with");
    assert.equal(reaches(everyone, b), true);
  });
});
