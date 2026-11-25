// THE OUTBOX AND ITS CONSUMERS, on PostgreSQL (A12): an event is written in the transaction of the change that raised it,
// so a rolled-back change raises nothing; a consumer applies each event ONCE, however many dispatchers deliver it (the
// inbox row is written in the transaction of the effect); a handler that fails is retried and, once it succeeds, has
// applied the event once; and an event of a type the catalog does not hold is refused before anything is kept.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { IntegrationEvent } from "@orbit-web/contracts";
import { systemActor } from "../../src/contexts/shared/application/commands.js";
import { EventDispatcher } from "../../src/contexts/shared/infrastructure/consumers.js";
import { Outbox } from "../../src/contexts/shared/infrastructure/outbox.js";
import { Db } from "../../src/infra/db/db.js";
import { eventually, startHarness, type Harness } from "../../src/testing/harness.js";

// DepartmentCreated: an event no consumer of the application handles, so the ones registered here are its only readers.
// A consumer registered later also receives what is still in the window, so each test counts its own event alone.
const department = () => ({ type: "DepartmentCreated" as const, aggregateType: "department" as const, aggregateId: randomUUID(), aggregateVersion: 1, payload: { name: "Outbox test" } });

describe("the outbox and its consumers", () => {
  let h: Harness;
  let db: Db;
  let outbox: Outbox;
  let dispatcher: EventDispatcher;
  const seen: { consumer: string; event: string }[] = [];

  before(async () => {
    h = await startHarness({});
    db = h.app.get(Db);
    outbox = h.app.get(Outbox);
    dispatcher = h.app.get(EventDispatcher);
  });

  after(async () => {
    await h?.close();
  });

  const actor = () => systemActor(h.accountId as string, "outbox-test", randomUUID());
  const eventsOf = async (aggregateId: string) => h.sql("SELECT id FROM workforce.events WHERE account_id = $1 AND aggregate_id = $2", [h.accountId as string, aggregateId]);

  test("an event raised by a change that rolls back is never written, and never delivered", async () => {
    let calls = 0;
    const e = department();
    dispatcher.register({ id: "test.rollback", types: ["DepartmentCreated"], handle: async (event) => void (event.aggregateId === e.aggregateId && (calls += 1)) });
    await assert.rejects(
      db.tx(async () => {
        await outbox.append(actor().command, [e]);
        throw new Error("the change fails after raising its event");
      }),
      /the change fails/,
    );
    assert.equal((await eventsOf(e.aggregateId)).length, 0, "nothing of it is kept");
    await dispatcher.drained();
    assert.equal(calls, 0, "no consumer did anything for it");
  });

  test("two dispatchers deliver one event: the consumer applies it once, and its inbox says so once", async () => {
    // A second dispatcher on the same database: what a second replica of Orbit Web would be.
    const second = new EventDispatcher(db, outbox);
    const handle = (consumer: string) => async (event: IntegrationEvent) => {
      seen.push({ consumer, event: event.id });
      await new Promise((r) => setTimeout(r, 50));
    };
    dispatcher.register({ id: "test.once", types: ["DepartmentCreated"], handle: handle("first") });
    second.register({ id: "test.once", types: ["DepartmentCreated"], handle: handle("second") });
    const e = department();
    const [id] = await db.tx(() => outbox.append(actor().command, [e]));
    dispatcher.wake();
    second.wake();
    await dispatcher.drained();
    await second.drained();
    const applied = seen.filter((s) => s.event === id);
    assert.equal(applied.length, 1, `applied once: ${JSON.stringify(applied)}`);
    const inbox = await h.sql("SELECT count(*) AS n FROM workforce.consumer_inbox WHERE consumer_id = 'test.once' AND event_id = $1", [id as string]);
    assert.equal(Number(inbox[0]?.n), 1);
    await second.onApplicationShutdown();
  });

  test("a handler that fails is retried; its failed attempt leaves no inbox row, and the event is applied once in the end", async () => {
    let attempts = 0;
    let applied = 0;
    const e = department();
    dispatcher.register({
      id: "test.retry",
      types: ["DepartmentCreated"],
      handle: async (event) => {
        if (event.aggregateId !== e.aggregateId) return;
        attempts += 1;
        if (attempts === 1) throw new Error("the first attempt fails");
        applied += 1;
      },
    });
    const [id] = await db.tx(() => outbox.append(actor().command, [e]));
    dispatcher.wake();
    await eventually(async () => attempts, (n) => n >= 1);
    const afterFailure = await h.sql("SELECT count(*) AS n FROM workforce.consumer_inbox WHERE consumer_id = 'test.retry' AND event_id = $1", [id as string]);
    assert.equal(Number(afterFailure[0]?.n), 0, "a rolled-back handling leaves no row");
    await eventually(async () => applied, (n) => n === 1, 10_000);
    await dispatcher.drained();
    assert.equal(applied, 1);
    assert.equal(attempts, 2);
  });

  test("an event of a type the catalog does not hold is refused before anything is kept", async () => {
    const id = randomUUID();
    await assert.rejects(db.tx(() => outbox.append(actor().command, [{ type: "NoSuchEvent" as never, aggregateType: "department", aggregateId: id, aggregateVersion: 1, payload: {} }])));
    assert.equal((await eventsOf(id)).length, 0);
  });
});
