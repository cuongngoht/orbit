// The AMQP 0-9-1 reference adapter's operations against a scripted broker (ADR 0035): what it may
// touch is what the binding says, a publication is confirmed, rejected or returned -- and
// AMBIGUOUS with its message id when the confirm never came -- an observer reads a queue of its
// own and is complete only when it read that queue empty, and a fixture creates and removes only
// what its namespace holds. The credential reaches the broker and nothing else.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_MESSAGES, OPERATIONS, PAYLOAD_BYTES, run } from "../skills/orbit-backend-test/amqp/operations.mjs";
import { connect } from "../skills/orbit-backend-test/amqp/session.mjs";
import { answered as scheduleAnswered } from "../skills/orbit-backend-test/schedule/helper.mjs";
import { fakeAmqpPeer } from "./fakes/amqp-peer.mjs";

const TIMERS = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t), now: () => Date.now() };
const ENDPOINT = { host: "broker", port: 5672, vhost: "/task" };
const CREDENTIAL = { userEnv: "ORBIT_BROKER_USER", passwordEnv: "ORBIT_BROKER_PASSWORD" };
const ENV = { ORBIT_BROKER_USER: "orbit", ORBIT_BROKER_PASSWORD: "s3cr3t-broker" };

const channel = { alias: "invoice-events", transport: "amqp-0-9-1", endpoint: ENDPOINT, credential: CREDENTIAL, exchange: "amq.topic", routingKey: "invoice.created" };
const observer = { alias: "obs-1", transport: "amqp-0-9-1", adapter: "amqp.reference", endpoint: ENDPOINT, credential: CREDENTIAL, queue: "orbit-ab12.obs-1", namespace: "orbit-ab12" };
const fixture = { alias: "fx", transport: "amqp-0-9-1", endpoint: ENDPOINT, credential: CREDENTIAL, namespace: "orbit-ab12" };

function broker(script = {}) {
  const fake = fakeAmqpPeer(script);
  const deps = { connect, socket: fake.socket, env: ENV, now: () => performance.now(), wall: () => Date.parse("2026-10-22T02:00:00Z"), timers: TIMERS, pollMs: 5 };
  return { fake, ask: (op, request = {}, bound = {}, deadlineMs = 2_000) => run({ v: "orbit.helper/v1", op, request, bound, limits: {}, deadlineMs }, deps) };
}

const publication = (over = {}) => ({ messageId: "msg-1", payload: { invoice: "inv-1" }, correlationId: "corr-1", ...over });

test("it answers exactly the five operations it declares, and refuses anything else", async () => {
  assert.deepEqual(OPERATIONS, ["publish", "observe", "observe.await", "fixture.prepare", "fixture.cleanup"]);
  const out = await broker().ask("purge");
  assert.equal(out.failure.class, "refused");
});

test("a confirmed publication carries its logical id, persistently, as the bound identity -- and the secret reaches only the broker", async () => {
  const b = broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  const out = await b.ask("publish", publication(), { channelRef: channel });
  assert.equal(out.value.messageId, "msg-1");
  assert.equal(out.value.outcome, "confirmed");
  assert.ok(Number.isInteger(out.value.elapsedMs));
  const sent = b.fake.peer.published.at(-1);
  assert.deepEqual([sent.exchange, sent.routingKey, sent.mandatory, sent.properties.messageId, sent.properties.deliveryMode, sent.properties.correlationId], ["amq.topic", "invoice.created", true, "msg-1", 2, "corr-1"]);
  assert.equal(b.fake.peer.credentials, "\u0000orbit\u0000s3cr3t-broker");
  assert.equal(b.fake.peer.vhost, "/task");
  assert.equal(JSON.stringify(out).includes("s3cr3t"), false);
});

test("a publication nothing routes is RETURNED, one the broker refuses is REJECTED -- each an observation, never a failure", async () => {
  const b = broker();
  assert.equal((await b.ask("publish", publication(), { channelRef: channel })).value.outcome, "returned");
  const nacking = broker({ onPublish: () => "nack" });
  assert.equal((await nacking.ask("publish", publication(), { channelRef: { ...channel, routingKey: "x" } })).value.outcome, "rejected");
});

test("a publication with no logical id, or a channel with no exchange, is refused before any connection is opened", async () => {
  const b = broker();
  assert.match((await b.ask("publish", publication({ messageId: undefined }), { channelRef: channel })).failure.message, /logical message id/);
  assert.match((await b.ask("publish", publication(), { channelRef: { ...channel, exchange: undefined } })).failure.message, /no exchange/);
  assert.equal(b.fake.peer.greeted, null, "nothing reached the broker");
});

test("a confirm that never comes is AMBIGUOUS, keyed by the message id -- and it is never sent twice", async () => {
  const b = broker({ onPublish: () => "drop" });
  const out = await b.ask("publish", publication({ messageId: "msg-lost" }), { channelRef: channel }, 300);
  assert.equal(out.failure.class, "ambiguous");
  assert.equal(out.failure.operationKey, "msg-lost");
  assert.equal(b.fake.peer.published.length, 1);
});

test("an observer is armed on a queue of its own, bound beside the application's, with where it stood", async () => {
  const b = broker();
  const out = await b.ask("observe", {}, { channelRef: channel, observerRef: observer, fixtureRef: fixture });
  assert.deepEqual(out.value, { baseline: { messages: 0, at: "2026-10-22T02:00:00.000Z" }, completeness: "armed" });
  assert.equal(b.fake.peer.queues.get("orbit-ab12.obs-1").args.arguments["x-expires"], 30 * 60 * 1000, "it expires if nobody reads it");
  assert.deepEqual(b.fake.peer.bindings, [{ queue: "orbit-ab12.obs-1", exchange: "amq.topic", routingKey: "invoice.created" }]);
});

test("an observer is never somebody else's queue: outside the namespace, or consumed by another, it is not armed", async () => {
  assert.match((await broker().ask("observe", {}, { channelRef: channel, observerRef: { ...observer, queue: "billing.work" }, fixtureRef: fixture })).failure.message, /outside its namespace orbit-ab12/);
  const taken = await broker({ consumers: { "orbit-ab12.obs-1": 1 } }).ask("observe", {}, { channelRef: channel, observerRef: observer });
  assert.match(taken.failure.message, /already has a consumer/);
});

test("await reads the observer's queue for its window and is complete only once it read the queue empty", async () => {
  const b = broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  await b.ask("publish", publication(), { channelRef: channel });
  await b.ask("publish", publication({ messageId: "msg-2", correlationId: "corr-2", causationId: "cause-2" }), { channelRef: channel });
  const seen = await b.ask("observe.await", { waitMs: 30 }, { observerRef: observer });
  assert.equal(seen.value.completeness, "complete");
  assert.deepEqual(seen.value.messages.map((m) => [m.id, m.key, m.correlation.correlationId, m.payload.invoice]), [["msg-1", "invoice.created", "corr-1", "inv-1"], ["msg-2", "invoice.created", "corr-2", "inv-1"]]);
  assert.equal(seen.value.messages[1].correlation.causationId, "cause-2");
  assert.deepEqual(seen.value.through, { messages: 2, at: "2026-10-22T02:00:00.000Z" });
  assert.equal(b.fake.peer.acks.length, 2, "what it took from its own queue it acknowledged");
  const quiet = await b.ask("observe.await", { waitMs: 20 }, { observerRef: observer });
  assert.deepEqual([quiet.value.messages, quiet.value.completeness], [[], "complete"], "a closed, complete window with nothing in it -- what an absence rests on");
});

test("a count ends the window early, once that many matching messages were read and the queue is empty", async () => {
  const b = broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  await b.ask("publish", publication({ messageId: "other" }), { channelRef: channel });
  await b.ask("publish", publication({ messageId: "wanted" }), { channelRef: channel });
  const started = performance.now();
  const out = await b.ask("observe.await", { count: 1, match: { messageId: "wanted" }, waitMs: 5_000 }, { observerRef: observer }, 10_000);
  assert.ok(performance.now() - started < 2_000, "it did not wait out the window");
  assert.deepEqual(out.value.messages.map((m) => m.id), ["other", "wanted"], "every message read is reported; the match only ends the wait");
});

test("what one answer cannot hold makes the observation PARTIAL, with the reason -- never a quietly short list", async () => {
  const b = broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  for (const id of ["a", "b", "c"]) await b.ask("publish", publication({ messageId: id }), { channelRef: channel });
  const capped = await b.ask("observe.await", { waitMs: 50, maxMessages: 2 }, { observerRef: observer });
  assert.equal(capped.value.completeness, "partial");
  assert.match(capped.value.gaps.join(), /more than 2 messages were waiting/);
  await b.ask("publish", publication({ messageId: "huge", payload: "x".repeat(PAYLOAD_BYTES + 1) }), { channelRef: channel });
  const big = await b.ask("observe.await", { waitMs: 30 }, { observerRef: observer });
  assert.equal(big.value.messages.find((m) => m.id === "huge").payload, null);
  assert.equal(big.value.completeness, "partial");
  assert.equal(MAX_MESSAGES, 500);
});

// The x-death record is the BROKER's: a case cannot put one on a publication (only flat headers
// travel), so the scripted broker dead-letters the message itself, as a dead-letter exchange does.
test("a dead-lettered message says where it ended and why, from the broker's own record -- which a case can never forge", async () => {
  const b = broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  b.fake.peer.queues.get("orbit-ab12.obs-1").messages.push({ exchange: "orbit-ab12.dlx", routingKey: "invoice.created", properties: { messageId: "msg-poison", contentType: "application/json", headers: { "x-death": [{ reason: "rejected", queue: "billing.work", count: 3 }] } }, body: Buffer.from("{}"), redelivered: false });
  const out = await b.ask("observe.await", { waitMs: 20 }, { observerRef: observer });
  assert.deepEqual(out.value.messages[0].terminal, { reason: "rejected", queue: "billing.work", count: 3 });
  await b.ask("publish", publication({ messageId: "forged", headers: { "x-death": [{ reason: "expired" }], "x-tenant": "a" } }), { channelRef: channel });
  assert.deepEqual(b.fake.peer.published.at(-1).properties.headers, { "x-tenant": "a" }, "only flat headers travel on a publication");
});

test("a fixture declares and removes only its own resources, and says what it left and why", async () => {
  const b = broker();
  const own = { ...fixture, exchanges: [{ name: "orbit-ab12.events" }], queues: [{ name: "orbit-ab12.work", arguments: { "x-dead-letter-exchange": "orbit-ab12.dlx", "x-evil": "dropped" } }], bindings: [{ queue: "orbit-ab12.work", exchange: "orbit-ab12.events", routingKey: "invoice.#" }] };
  assert.deepEqual((await b.ask("fixture.prepare", {}, { fixtureRef: own })).value, { namespace: "orbit-ab12", declared: { exchanges: 1, queues: 1, bindings: 1 } });
  assert.deepEqual(b.fake.peer.queues.get("orbit-ab12.work").args.arguments, { "x-expires": 30 * 60 * 1000, "x-dead-letter-exchange": "orbit-ab12.dlx" });
  const out = await b.ask("fixture.cleanup", {}, { fixtureRef: own });
  assert.deepEqual(out.value.cleanup.removed, ["orbit-ab12.work"]);
  assert.match(out.value.cleanup.left[0].why, /never deletes an exchange/);
  assert.equal(b.fake.peer.queues.has("orbit-ab12.work"), false);
  const theirs = await b.ask("fixture.cleanup", {}, { fixtureRef: { ...fixture, queues: [{ name: "billing.work" }] } });
  assert.match(theirs.failure.message, /outside the fixture's namespace orbit-ab12: billing.work/);
});

test("a broker nobody can reach is the transport's failure -- never news about the product", async () => {
  const deps = { connect: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { kind: "transport" })), env: {}, now: () => 0, wall: () => 0, timers: TIMERS };
  const out = await run({ op: "publish", request: publication(), bound: { channelRef: channel }, deadlineMs: 100 }, deps);
  assert.equal(out.failure.class, "transport");
});

const schedule = { id: "billing-daily", dialect: "cron5", expression: "0 9 * * *", timezone: "Asia/Ho_Chi_Minh", revision: "r1" };

test("orbit.schedule.expect computes the accepted contract's occurrences from the bound schedule, asking no scheduler", () => {
  const out = scheduleAnswered({ op: "expect", request: { ask: "occurrences", from: "2026-10-22T00:00:00+07:00", to: "2026-10-24T00:00:00+07:00" }, bound: { scheduleRef: schedule } });
  assert.deepEqual(out.value.occurrences.map((o) => o.occurrenceId), ["billing-daily:2026-10-22T09:00:00+07:00", "billing-daily:2026-10-23T09:00:00+07:00"]);
  assert.match(scheduleAnswered({ op: "expect", request: { ask: "occurrences", from: "2026-10-22T00:00:00", to: "2026-10-24T00:00:00+07:00" }, bound: { scheduleRef: schedule } }).failure.message, /needs from/, "an instant without an offset is never read in this machine's zone");
  assert.match(scheduleAnswered({ op: "expect", request: { ask: "occurrences", from: 0, to: 1 } }).failure.message, /no schedule contract is bound/);
  const gap = scheduleAnswered({ op: "expect", request: { ask: "occurrences", from: 0, to: 86_400_000 }, bound: { scheduleRef: { ...schedule, dialect: "quartz-like" } } });
  assert.equal(gap.failure.class, "incomplete");
  assert.equal(gap.failure.gap.capability, "orbit.schedule.expect");
});

// The gate arming asks is asked again before the first read: await never reads a queue that is
// not the observer's own, so it can never take an application's messages.
test("await reads only the observer's own queue: outside its namespace, never armed, or consumed by another, nothing is read or acknowledged", async () => {
  const b = broker();
  const app = await b.ask("observe.await", { waitMs: 10 }, { observerRef: { ...observer, queue: "billing.work" } });
  assert.match(app.failure.message, /outside its namespace orbit-ab12/);
  assert.match((await b.ask("observe.await", { waitMs: 10 }, { observerRef: { ...observer, namespace: undefined } })).failure.message, /names no namespace/);
  const never = await b.ask("observe.await", { waitMs: 10 }, { observerRef: observer });
  assert.equal(never.failure.class, "refused", "a queue nobody armed is NOT_FOUND, a refusal");
  const shared = broker({ consumers: { "orbit-ab12.obs-1": 1 } });
  shared.fake.peer.queues.set("orbit-ab12.obs-1", { name: "orbit-ab12.obs-1", args: {}, messages: [{ exchange: "amq.topic", routingKey: "invoice.created", properties: { messageId: "app-msg" }, body: Buffer.from("{}"), redelivered: false }] });
  const taken = await shared.ask("observe.await", { waitMs: 10 }, { observerRef: observer });
  assert.match(taken.failure.message, /has 1 consumer\(s\)/);
  assert.equal(shared.fake.peer.acks.length, 0, "nothing of the application's was acknowledged");
  assert.equal(shared.fake.peer.queues.get("orbit-ab12.obs-1").messages.length, 1, "nothing was taken");
});
