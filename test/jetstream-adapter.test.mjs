// The NATS JetStream reference adapter's operations against an in-memory server (ADR 0035), the
// second example broker: what it may touch is what the binding says; a publication carries its
// logical id as Nats-Msg-Id and is confirmed, a DUPLICATE inside the stream's window, rejected or
// unroutable -- and AMBIGUOUS with its message id when the ack never came; an observer reads
// through a durable consumer of its own and never moves the application's; and a fixture removes
// only what the server shows carries its mark. The credential reaches the server and nothing else.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { connect, jetstream } from "../skills/orbit-backend-test/jetstream/index.mjs";
import { FIXTURE_MARK, MAX_MESSAGES, OBSERVER_MARK, OPERATIONS, PAYLOAD_BYTES, run } from "../skills/orbit-backend-test/jetstream/operations.mjs";
import { fakeNatsPeer } from "./fakes/nats-peer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMERS = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t), now: () => Date.now() };
const ENDPOINT = { host: "broker", port: 4222 };
const CREDENTIAL = { userEnv: "ORBIT_BROKER_USER", passwordEnv: "ORBIT_BROKER_PASSWORD" };
const ENV = { ORBIT_BROKER_USER: "orbit", ORBIT_BROKER_PASSWORD: "s3cr3t-broker" };
const AUTH = { user: "orbit", pass: "s3cr3t-broker" };

const channel = { alias: "invoice-events", transport: "nats-jetstream", endpoint: ENDPOINT, credential: CREDENTIAL, subject: "invoice.created", stream: "INVOICES" };
const observer = { alias: "obs-1", transport: "nats-jetstream", adapter: "jetstream.reference", endpoint: ENDPOINT, credential: CREDENTIAL, stream: "INVOICES", consumer: "orbit-ab12-obs-1" };
const fixture = { alias: "fx", transport: "nats-jetstream", endpoint: ENDPOINT, credential: CREDENTIAL, namespace: "orbit-ab12" };

// The application's own stream and its own durable consumer, made by a connection of its own --
// never by the adapter, which is asked only through `ask`.
async function broker(script = {}, { retention = "limits" } = {}) {
  const fake = fakeNatsPeer({ auth: AUTH, ...script });
  const deps = { connect, socket: fake.socket, env: ENV, now: () => performance.now(), wall: () => Date.parse("2026-10-22T02:00:00Z"), timers: TIMERS, pollMs: 5 };
  const app = jetstream(await connect({ socket: fake.socket, user: AUTH.user, password: AUTH.pass, timers: TIMERS, pingIntervalMs: 0 }));
  await app.streamCreate({ name: "INVOICES", subjects: ["invoice.>"], retention });
  await app.consumerCreate("INVOICES", { durable_name: "billing", ack_wait: 30e9 });
  return { fake, app, deps, ask: (op, request = {}, bound = {}, deadlineMs = 2_000) => run({ v: "orbit.helper/v1", op, request, bound, limits: {}, deadlineMs }, deps) };
}

const publication = (over = {}) => ({ messageId: "msg-1", payload: { invoice: "inv-1" }, correlationId: "corr-1", ...over });
const stored = (b, stream = "INVOICES") => b.fake.server.streams.get(stream).messages;
const position = (info) => ({ delivered: info.delivered, ack_floor: info.ack_floor, num_ack_pending: info.num_ack_pending, num_redelivered: info.num_redelivered, num_pending: info.num_pending });

test("it answers exactly the five operations it declares, its row says what this broker does, and anything else is refused", async () => {
  assert.deepEqual(OPERATIONS, ["publish", "observe", "observe.await", "fixture.prepare", "fixture.cleanup"]);
  const row = JSON.parse(readFileSync(join(ROOT, "skills/orbit-backend-test/adapters.json"), "utf8")).adapters.find((a) => a.id === "jetstream.reference");
  assert.deepEqual(Object.keys(row.operations), OPERATIONS);
  const { publishDedupe, observation, cursor, leaseMinSec, unroutable, redeliveryMarker } = row.semantics;
  assert.deepEqual({ publishDedupe, observation, cursor, leaseMinSec, unroutable, redeliveryMarker }, { publishDedupe: "id-window", observation: ["independent-cursor"], cursor: "sequence", leaseMinSec: "unknown", unroutable: "error", redeliveryMarker: "count" });
  assert.equal((await (await broker()).ask("purge")).failure.class, "refused");
});

test("a confirmed publication carries its logical id as Nats-Msg-Id, its correlation and the stream it must reach -- and the secret reaches only CONNECT", async () => {
  const b = await broker();
  const out = await b.ask("publish", publication({ causationId: "cause-1" }), { channelRef: channel });
  assert.deepEqual([out.value.messageId, out.value.outcome], ["msg-1", "confirmed"]);
  assert.ok(Number.isInteger(out.value.elapsedMs));
  const [m] = stored(b);
  assert.deepEqual([m.subject, m.headers["Nats-Msg-Id"], m.headers["Correlation-Id"], m.headers["Causation-Id"], m.headers["Nats-Expected-Stream"], m.headers["Content-Type"]], ["invoice.created", "msg-1", "corr-1", "cause-1", "INVOICES", "application/json"]);
  assert.deepEqual(JSON.parse(m.data), { invoice: "inv-1" });
  const used = b.fake.server.conns.at(-1);
  assert.deepEqual([used.options.user, used.options.pass, used.socket.destroyed], ["orbit", "s3cr3t-broker", true], "one connection per request, closed once it answered");
  assert.equal(JSON.stringify(out).includes("s3cr3t"), false);
});

test("a second publication of one id inside the stream's window is a DUPLICATE it dropped; a case's JetStream control header never travels", async () => {
  const b = await broker();
  await b.ask("publish", publication(), { channelRef: channel });
  const again = await b.ask("publish", publication({ payload: { invoice: "changed" } }), { channelRef: channel });
  assert.equal(again.value.outcome, "duplicate");
  assert.equal(stored(b).length, 1, "the stream kept the first and dropped the second");
  await b.ask("publish", publication({ messageId: "msg-2", headers: { "Nats-Rollup": "all", "nats-expected-last-sequence": "0", "X-Tenant": "a", "Bad Key": "x", "X-Split": "a\r\nInjected: 1", "X-Obj": { a: 1 } } }), { channelRef: channel });
  assert.deepEqual(Object.keys(stored(b).at(-1).headers).sort(), ["Content-Type", "Correlation-Id", "Nats-Expected-Stream", "Nats-Msg-Id", "X-Tenant"], "a rollup is a purge, and only flat single-line headers travel");
});

test("nothing capturing the subject is UNROUTABLE, another stream capturing it is REJECTED -- each an observation, never a failure", async () => {
  const b = await broker();
  assert.equal((await b.ask("publish", publication(), { channelRef: { ...channel, subject: "nobody.listens", stream: undefined } })).value.outcome, "unroutable");
  assert.equal((await b.ask("publish", publication({ messageId: "m-2" }), { channelRef: { ...channel, stream: "PAYMENTS" } })).value.outcome, "rejected");
  assert.equal(stored(b).length, 0);
});

test("a publication with no logical id, no subject, a system subject or one the channel does not cover is refused before any connection is opened", async () => {
  const b = await broker();
  const before = b.fake.server.conns.length;
  assert.match((await b.ask("publish", publication({ messageId: undefined }), { channelRef: channel })).failure.message, /logical message id/);
  assert.match((await b.ask("publish", publication(), { channelRef: { ...channel, subject: undefined } })).failure.message, /no subject/);
  assert.match((await b.ask("publish", publication(), { channelRef: { ...channel, subject: "$JS.API.STREAM.DELETE.INVOICES" } })).failure.message, /system one/);
  assert.match((await b.ask("publish", publication({ subject: "payment.made" }), { channelRef: channel })).failure.message, /not one the bound channel covers/);
  assert.match((await b.ask("publish", publication({ subject: "invoice.*" }), { channelRef: { ...channel, subjects: ["invoice.>"] } })).failure.message, /one literal subject/);
  assert.equal(b.fake.server.conns.length, before, "nothing reached the server");
  assert.equal((await b.ask("publish", publication({ subject: "invoice.paid" }), { channelRef: { ...channel, subjects: ["invoice.>"] } })).value.outcome, "confirmed");
  assert.equal(stored(b).at(-1).subject, "invoice.paid");
});

test("an ack that never comes is AMBIGUOUS, keyed by the message id -- and it is never sent twice", async () => {
  const b = await broker({ dropPubAcks: true });
  const out = await b.ask("publish", publication({ messageId: "msg-lost" }), { channelRef: channel }, 300);
  assert.deepEqual([out.failure.class, out.failure.operationKey], ["ambiguous", "msg-lost"]);
  assert.equal(b.fake.server.conns.at(-1).ops.filter((op) => op.op === "HPUB" && op.subject === "invoice.created").length, 1);
  assert.equal(stored(b).length, 1, "the stream kept it: whether it did is a read-back's to say");
});

test("an observer is armed on a durable consumer of its own, starting just after the stream's last sequence and expiring when idle", async () => {
  const b = await broker();
  for (const id of ["before-1", "before-2"]) await b.app.publishAck("invoice.created", "{}", { msgId: id });
  const out = await b.ask("observe", {}, { channelRef: channel, observerRef: observer, fixtureRef: fixture });
  assert.deepEqual(out.value, { baseline: { sequence: 2, messages: 0, at: "2026-10-22T02:00:00.000Z" }, completeness: "armed" });
  const c = b.fake.server.consumers.get("INVOICES/orbit-ab12-obs-1").config;
  assert.deepEqual([c.deliver_policy, c.opt_start_seq, c.ack_policy, c.filter_subject, c.inactive_threshold], ["by_start_sequence", 3, "explicit", "invoice.created", 30 * 60 * 1000 * 1e6]);
  assert.deepEqual([c.metadata, c.description], [{ [OBSERVER_MARK]: "orbit-ab12-obs-1" }, "orbit observer obs-1"], "marked as the observer's own, for await to prove");
});

test("a wait its call's own deadline cuts short of what it waited for is PARTIAL, saying so -- never a window it did not watch", async () => {
  const b = await broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer, fixtureRef: fixture });
  await b.ask("publish", publication({ messageId: "msg-once" }), { channelRef: channel });
  const cut = await b.ask("observe.await", { count: 2, match: { messageId: "msg-once" }, waitMs: 60_000 }, { observerRef: observer }, 600);
  assert.deepEqual([cut.value.messages.length, cut.value.completeness], [1, "partial"]);
  assert.match(cut.value.gaps.join(), /cut to \d+ ms by the call's own deadline, short of the 60000 ms asked/);
});

// The gate await shares with observe: a binding naming somebody else's consumer -- the
// application's, or one made to look like an observer -- must never be fetched from or acknowledged.
test("await proves the consumer is the observer's own before anything is fetched: anybody else's is refused, and nothing is taken", async () => {
  const b = await broker();
  await b.app.publishAck("invoice.created", "{}", { msgId: "app-1" });
  const before = position(await b.app.consumerInfo("INVOICES", "billing"));
  const stolen = await b.ask("observe.await", { waitMs: 20 }, { observerRef: { ...observer, consumer: "billing" } });
  assert.equal(stolen.failure.class, "refused");
  assert.match(stolen.failure.message, /INVOICES\/billing is not an observer this adapter armed: it lacks the observer mark/);
  await b.app.consumerCreate("INVOICES", { durable_name: "orbit-ab12-lookalike", description: "orbit observer x", deliver_policy: "by_start_sequence", opt_start_seq: 1, ack_policy: "explicit", inactive_threshold: 60e9 });
  assert.match((await b.ask("observe.await", { waitMs: 20 }, { observerRef: { ...observer, consumer: "orbit-ab12-lookalike" } })).failure.message, /lacks the observer mark/, "every stamp but the mark is not the mark");
  await b.app.consumerCreate("INVOICES", { durable_name: "orbit-ab12-marked", metadata: { [OBSERVER_MARK]: "orbit-ab12-marked" }, ack_policy: "explicit" });
  assert.match((await b.ask("observe.await", { waitMs: 20 }, { observerRef: { ...observer, consumer: "orbit-ab12-marked" } })).failure.message, /lacks the observer's description/, "the mark without the rest of what observe stamps is not enough either");
  const conns = b.fake.server.conns.length;
  assert.match((await b.ask("observe.await", { waitMs: 20 }, { observerRef: { ...observer, consumer: "billing", namespace: "orbit-ab12" } })).failure.message, /outside its namespace orbit-ab12/);
  assert.equal(b.fake.server.conns.length, conns, "a name outside the observer's namespace is refused before any connection");
  assert.deepEqual(b.fake.calls().filter((c) => c.verb === "CONSUMER.MSG.NEXT"), [], "nothing was fetched");
  assert.deepEqual(b.fake.acks(), [], "nothing was acknowledged");
  assert.deepEqual(position(await b.app.consumerInfo("INVOICES", "billing")), before, "the application's consumer did not move");
  const wq = await broker({}, { retention: "workqueue" });
  assert.match((await wq.ask("observe.await", { waitMs: 20 }, { observerRef: { ...observer, consumer: "billing" } })).failure.message, /work-queue stream: .* — nothing was fetched/);
  assert.deepEqual([wq.fake.calls().filter((c) => c.verb === "CONSUMER.MSG.NEXT").length, wq.fake.acks().length], [0, 0]);
});

test("an observer is never somebody else's consumer: outside the namespace, a name that exists, another stream, a work queue -- nor one nobody armed", async () => {
  const b = await broker();
  assert.match((await b.ask("observe", {}, { channelRef: channel, observerRef: { ...observer, consumer: "billing-shadow" }, fixtureRef: fixture })).failure.message, /outside the fixture's namespace/);
  const taken = await b.ask("observe", {}, { channelRef: channel, observerRef: { ...observer, consumer: "billing" } });
  assert.deepEqual([taken.failure.class, /already exists/.test(taken.failure.message)], ["refused", true]);
  assert.match((await b.ask("observe", {}, { channelRef: { ...channel, stream: "OTHER" }, observerRef: observer })).failure.message, /not the channel's/);
  assert.equal((await b.ask("observe.await", { waitMs: 10 }, { observerRef: { ...observer, consumer: "orbit-ab12-never" } })).failure.class, "refused");
  const wq = await broker({}, { retention: "workqueue" });
  assert.match((await wq.ask("observe", {}, { channelRef: channel, observerRef: observer })).failure.message, /work-queue stream/);
  assert.equal(wq.fake.server.consumers.has("INVOICES/orbit-ab12-obs-1"), false);
});

test("await reads the observer's own consumer, is complete only once a fetch found it empty -- and the application's consumer did not move", async () => {
  const b = await broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  const before = position(await b.app.consumerInfo("INVOICES", "billing"));
  await b.ask("publish", publication(), { channelRef: channel });
  await b.ask("publish", publication({ messageId: "msg-2", correlationId: "corr-2", causationId: "cause-2" }), { channelRef: channel });
  const seen = await b.ask("observe.await", { waitMs: 30 }, { observerRef: observer });
  assert.equal(seen.value.completeness, "complete");
  assert.deepEqual(seen.value.messages.map((m) => [m.id, m.key, m.correlation.correlationId, m.payload.invoice]), [["msg-1", "invoice.created", "corr-1", "inv-1"], ["msg-2", "invoice.created", "corr-2", "inv-1"]]);
  assert.equal(seen.value.messages[1].correlation.causationId, "cause-2");
  assert.deepEqual(seen.value.through, { messages: 2, sequence: 2, at: "2026-10-22T02:00:00.000Z" });
  assert.deepEqual(b.fake.acks().filter((a) => a.consumer === "orbit-ab12-obs-1").map((a) => [a.body, a.seq]), [["+ACK", 1], ["+ACK", 2]], "what it took from its own consumer it acknowledged");
  const quiet = await b.ask("observe.await", { waitMs: 20 }, { observerRef: observer });
  assert.deepEqual([quiet.value.messages, quiet.value.completeness, quiet.value.through.sequence], [[], "complete", null], "a closed, complete window with nothing in it -- what an absence rests on");
  const after = position(await b.app.consumerInfo("INVOICES", "billing"));
  assert.deepEqual({ ...after, num_pending: before.num_pending }, before, "nothing was delivered to, acknowledged on or redelivered by the application's consumer");
  assert.equal(after.num_pending, before.num_pending + 2, "and it still has both to deliver");
});

test("a count ends the window early, once that many matching messages were read and a fetch found the consumer empty", async () => {
  const b = await broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  await b.ask("publish", publication({ messageId: "other" }), { channelRef: channel });
  await b.ask("publish", publication({ messageId: "wanted" }), { channelRef: channel });
  const started = performance.now();
  const out = await b.ask("observe.await", { count: 1, match: { messageId: "wanted", subject: "invoice.created" }, waitMs: 5_000 }, { observerRef: observer }, 10_000);
  assert.ok(performance.now() - started < 2_000, "it did not wait out the window");
  assert.deepEqual(out.value.messages.map((m) => m.id), ["other", "wanted"], "every message read is reported; the match only ends the wait");
  assert.match((await b.ask("observe.await", { count: 0 }, { observerRef: observer })).failure.message, /request\.count/);
});

test("what one answer cannot hold makes the observation PARTIAL, with the reason -- never a quietly short list", async () => {
  const b = await broker();
  await b.ask("observe", {}, { channelRef: channel, observerRef: observer });
  for (const id of ["a", "b", "c"]) await b.ask("publish", publication({ messageId: id }), { channelRef: channel });
  const capped = await b.ask("observe.await", { waitMs: 50, maxMessages: 2 }, { observerRef: observer });
  assert.deepEqual([capped.value.completeness, capped.value.messages.map((m) => m.id)], ["partial", ["a", "b"]]);
  assert.match(capped.value.gaps.join(), /more than 2 messages were waiting/);
  await b.ask("publish", publication({ messageId: "huge", payload: "x".repeat(PAYLOAD_BYTES + 1) }), { channelRef: channel });
  const big = await b.ask("observe.await", { waitMs: 30 }, { observerRef: observer });
  assert.deepEqual(big.value.messages.map((m) => [m.id, m.payload === null]), [["c", false], ["huge", true]]);
  assert.equal(big.value.completeness, "partial");
  assert.equal(MAX_MESSAGES, 500);
});

test("a fixture creates its own streams and consumers marked with it, and a later process removes them by the mark the server shows", async () => {
  const b = await broker();
  const own = { ...fixture, streams: [{ name: "orbit-ab12-work", subjects: ["orbit-ab12.work.>"], retention: "workqueue", maxMsgs: 100, evil: "dropped" }], consumers: [{ stream: "orbit-ab12-work", name: "orbit-ab12-worker", ackWaitMs: 5_000, maxDeliver: 3 }] };
  assert.deepEqual((await b.ask("fixture.prepare", {}, { fixtureRef: own })).value, { namespace: "orbit-ab12", declared: { streams: 1, consumers: 1 } });
  const s = b.fake.server.streams.get("orbit-ab12-work").config;
  assert.deepEqual([s.storage, s.retention, s.max_msgs, s.metadata, "evil" in s], ["memory", "workqueue", 100, { [FIXTURE_MARK]: "orbit-ab12" }, false]);
  const c = b.fake.server.consumers.get("orbit-ab12-work/orbit-ab12-worker").config;
  assert.deepEqual([c.ack_wait, c.max_deliver, c.ack_policy, c.metadata], [5e9, 3, "explicit", { [FIXTURE_MARK]: "orbit-ab12" }]);
  const out = await b.ask("fixture.cleanup", {}, { fixtureRef: own });
  assert.deepEqual(out.value.cleanup, { removed: ["orbit-ab12-work/orbit-ab12-worker", "orbit-ab12-work"], left: [] });
  assert.equal(b.fake.server.streams.has("orbit-ab12-work"), false);
  assert.equal(b.fake.calls().some((x) => /PURGE/.test(x.verb)), false, "nothing was ever purged");
  const again = await b.ask("fixture.cleanup", {}, { fixtureRef: own });
  assert.deepEqual([again.value.cleanup.removed, again.value.cleanup.left.map((l) => l.name)], [[], ["orbit-ab12-work/orbit-ab12-worker", "orbit-ab12-work"]], "what is gone is left, with the server's own reason");
});

test("a stream in the namespace without the fixture's mark is left, saying why; one outside it is refused before any connection", async () => {
  const b = await broker();
  await b.app.streamCreate({ name: "orbit-ab12-theirs", subjects: ["orbit-ab12.theirs"] });
  const theirs = await b.ask("fixture.cleanup", {}, { fixtureRef: { ...fixture, streams: [{ name: "orbit-ab12-theirs", subjects: ["orbit-ab12.theirs"] }] } });
  assert.deepEqual(theirs.value.cleanup.removed, []);
  assert.match(theirs.value.cleanup.left[0].why, /does not carry its mark/);
  assert.equal(b.fake.server.streams.has("orbit-ab12-theirs"), true);
  const before = b.fake.server.conns.length;
  assert.match((await b.ask("fixture.cleanup", {}, { fixtureRef: { ...fixture, streams: [{ name: "INVOICES", subjects: ["invoice.>"] }] } })).failure.message, /outside the fixture's namespace orbit-ab12: INVOICES, invoice\.>/);
  assert.match((await b.ask("fixture.prepare", {}, { fixtureRef: { ...fixture, streams: [{ name: "orbit-ab12-shadow", subjects: ["invoice.>"] }] } })).failure.message, /outside the fixture's namespace orbit-ab12: invoice\.>/, "a fixture stream never captures an application's subject");
  assert.match((await b.ask("fixture.prepare", {}, { fixtureRef: { ...fixture, streams: [{ name: "orbit-ab12-x" }] } })).failure.message, /declares the subjects/);
  assert.match((await b.ask("fixture.prepare", {}, { fixtureRef: { ...fixture, namespace: "orbit.ab12" } })).failure.message, /one name token/);
  assert.equal(b.fake.server.conns.length, before, "nothing reached the server");
});

test("a server nobody can reach is the transport's failure, a credential it refuses is refused -- never news about the product", async () => {
  const unreachable = { connect: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { kind: "transport" })), env: {}, now: () => 0, wall: () => 0, timers: TIMERS };
  assert.equal((await run({ op: "publish", request: publication(), bound: { channelRef: channel }, deadlineMs: 100 }, unreachable)).failure.class, "transport");
  const b = await broker();
  const wrong = await run({ op: "publish", request: publication(), bound: { channelRef: { ...channel, credential: { ...CREDENTIAL, passwordEnv: "ORBIT_NOT_SET" } } }, deadlineMs: 1_000 }, b.deps);
  assert.equal(wrong.failure.class, "refused");
  assert.match(wrong.failure.message, /Authorization Violation/);
});

test("the helper speaks orbit.helper/v1: one answer line, and a refusal for anything that is not one of its requests", () => {
  const helper = join(ROOT, "skills/orbit-backend-test/jetstream/helper.mjs");
  const said = (input) => spawnSync(process.execPath, [helper], { input, encoding: "utf8", timeout: 10_000 });
  const lines = said("not json").stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const { v, ok, class: cls } = JSON.parse(lines[0]);
  assert.deepEqual({ v, ok, cls }, { v: "orbit.helper/v1", ok: false, cls: "refused" });
  const purge = JSON.parse(said(JSON.stringify({ v: "orbit.helper/v1", op: "purge" })).stdout);
  assert.deepEqual([purge.class, /publish, observe/.test(purge.message)], ["refused", true]);
});
