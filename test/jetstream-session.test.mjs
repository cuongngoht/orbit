// A NATS connection and JetStream over it, against an in-memory server (fakes/nats-peer.mjs) and a
// clock the test turns: the handshake, request/reply over one inbox, keepalive, -ERR as a class;
// a publication the stream acknowledges, deduplicated inside its window; a pull, a nak and the
// redelivery that says deliveredCount 2; a term that ends redelivery; an observation that never
// moves the application's consumer; and a publication whose ack never came, which is AMBIGUOUS
// with its message id and is never resent.
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect, helperClassOf, jetstream } from "../skills/orbit-backend-test/jetstream/index.mjs";
import { fakeTimers } from "./fakes/amqp-peer.mjs";
import { fakeNatsPeer } from "./fakes/nats-peer.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function settle(n = 10) {
  for (let i = 0; i < n; i += 1) await tick();
}

async function opened(script = {}, options = {}) {
  const peer = fakeNatsPeer(script);
  const timers = fakeTimers();
  const conn = await connect({ socket: peer.socket, timers, inboxId: "T", ...options });
  return { peer, timers, conn, js: jetstream(conn) };
}

const classed = (helper, more = () => true) => (e) => helperClassOf(e) === helper && more(e);
const subjects = (conn) => [...conn.subs.values()].map((s) => s.subject);
const position = (info) => ({ delivered: info.delivered, ack_floor: info.ack_floor, num_ack_pending: info.num_ack_pending, num_pending: info.num_pending, num_redelivered: info.num_redelivered });

async function ordersWithWorker(js, consumer = {}) {
  await js.streamCreate({ name: "ORDERS", subjects: ["orders.>"], storage: "memory" });
  return js.consumerCreate("ORDERS", { durable_name: "work", ack_wait: 30e9, max_deliver: 5, ...consumer });
}

// ── the connection ─────────────────────────────────────────────────────────

test("the handshake asks for headers and no-responders, carries the credential, and subscribes one wildcard inbox", async () => {
  const { peer, conn } = await opened({ auth: { user: "orbit", pass: "s3cret" } }, { user: "orbit", password: "s3cret" });
  const server = peer.server.conns[0];
  const { verbose, pedantic, headers, no_responders, user, pass, protocol } = server.options;
  assert.deepEqual({ verbose, pedantic, headers, no_responders, user, pass, protocol }, { verbose: false, pedantic: false, headers: true, no_responders: true, user: "orbit", pass: "s3cret", protocol: 1 });
  assert.deepEqual(subjects(server), ["_INBOX.T.*"]);
  assert.deepEqual(server.ops.map((op) => op.op), ["CONNECT", "SUB", "PING"]);
  assert.equal(conn.info().server_id, "NFAKE");
  assert.deepEqual(await conn.close(), { error: null });
  assert.equal(conn.closed(), true);
});

test("a wrong credential is refused at the handshake; a token rides as auth_token", async () => {
  const peer = fakeNatsPeer({ auth: { token: "t-1" } });
  await assert.rejects(connect({ socket: peer.socket, timers: fakeTimers(), token: "wrong" }), classed("refused", (e) => e.kind === "refused" && /Authorization Violation/.test(e.message)));
  const conn = await connect({ socket: peer.socket, timers: fakeTimers(), token: "t-1" });
  assert.equal(peer.server.conns[1].options.auth_token, "t-1");
  assert.equal(peer.server.conns[1].options.user, undefined);
  await conn.close();
});

test("no handshake within the timeout is a timeout, and the socket is let go", async () => {
  const peer = fakeNatsPeer();
  peer.silence();
  const timers = fakeTimers();
  const pending = connect({ socket: peer.socket, timers, timeoutMs: 2000 });
  await settle();
  timers.advance(2000);
  await assert.rejects(pending, classed("timeout", (e) => /handshake/.test(e.message)));
  assert.equal(peer.server.conns[0].socket.destroyed, true);
});

test("request/reply over the one inbox; nobody serving answers 503 at once; a silent responder times out", async () => {
  const { peer, timers, conn } = await opened();
  peer.respond("svc.echo", (m) => m.data);
  const echoed = await conn.request("svc.echo", "ping");
  assert.equal(echoed.data.toString(), "ping");
  assert.match(echoed.subject, /^_INBOX\.T\.\d+$/);
  assert.equal((await conn.request("svc.nobody", "x")).status, 503);
  peer.respond("svc.slow", () => undefined);
  const slow = conn.request("svc.slow", "x", { timeoutMs: 500 });
  await settle();
  timers.advance(500);
  await assert.rejects(slow, classed("timeout", (e) => /svc\.slow/.test(e.message)));
  await conn.close();
});

test("a subscription is routed by its sid; unsubscribe stops it; a queue group gets one copy", async () => {
  const { peer, conn } = await opened();
  const seen = { a: [], q1: [], q2: [] };
  const { sid } = conn.subscribe("events.*", { onMessage: (m) => seen.a.push(m.subject) });
  conn.subscribe("jobs.>", { queue: "workers", onMessage: (m) => seen.q1.push(m.subject) });
  conn.subscribe("jobs.>", { queue: "workers", onMessage: (m) => seen.q2.push(m.subject) });
  peer.publish("events.created", "1");
  peer.publish("jobs.one", "j");
  await settle();
  assert.equal(conn.unsubscribe(sid), true);
  assert.equal(conn.unsubscribe("999"), false, "a sid this connection does not hold is never written");
  peer.publish("events.deleted", "2");
  await settle();
  assert.deepEqual(seen, { a: ["events.created"], q1: ["jobs.one"], q2: [] });
  assert.deepEqual(peer.server.conns[0].ops.filter((op) => op.op === "UNSUB").map((op) => op.sid), [sid]);
  await conn.close();
});

test("a name that would end its line, or a body past the server's max_payload, is refused and nothing is written", async () => {
  const { peer, conn } = await opened({ maxPayload: 16 });
  const socket = peer.server.conns[0].socket;
  const before = socket.written.length;
  assert.throws(() => conn.publish("a b", "x"), classed("refused"));
  assert.throws(() => conn.publish("a", "x".repeat(17)), classed("refused", (e) => /16 bytes/.test(e.message)));
  assert.throws(() => conn.subscribe("a\r\nPUB evil 1"), classed("refused"));
  await assert.rejects(conn.request("a\r\nb", "x"), classed("refused"));
  await assert.rejects(conn.request("a", "x".repeat(17)), classed("refused"));
  assert.equal(socket.written.length, before);
  assert.equal(conn.closed(), false);
  await conn.close();
});

test("keepalive: a server that answers no PING is stale, and the end settles everything still owed", async () => {
  const { peer, timers, conn } = await opened({}, { pingIntervalMs: 1000, maxPingsOut: 2 });
  peer.silence();
  const owed = conn.request("svc.any", "x", { timeoutMs: 60_000 });
  const flushed = conn.flush();
  timers.advance(3000);
  const { error } = await conn.done;
  assert.deepEqual([helperClassOf(error), /stale/.test(error.message)], ["timeout", true]);
  await assert.rejects(owed, (e) => e === error);
  await assert.rejects(flushed, (e) => e === error);
  assert.equal(timers.pending(), 0, "no timer outlives the connection");
});

test("-ERR: a permissions violation refuses what it names and the connection lives; a fatal one ends it", async () => {
  const { peer, conn, js } = await opened({ deny: ["$JS.API.STREAM.CREATE.>"] });
  await assert.rejects(js.streamCreate({ name: "S1", subjects: ["s1.>"] }), classed("refused", (e) => e.kind === "denied" && e.subject === "$JS.API.STREAM.CREATE.S1"));
  assert.equal(conn.closed(), false);
  assert.equal(conn.denials().length, 1);
  await assert.rejects(js.streamInfo("S1"), classed("refused", (e) => e.errCode === 10059), "the connection still answers");
  peer.err("Stale Connection");
  const { error } = await conn.done;
  assert.deepEqual([error.kind, error.fatal, helperClassOf(error)], ["transport", true, "transport"]);
  await assert.rejects(js.streamInfo("S1"), classed("transport", (e) => e.sent === false));
});

test("a broken frame from the server is a protocol error that ends the connection", async () => {
  const { peer, conn } = await opened();
  peer.raw("MSG a 1 nope\r\n");
  const { error } = await conn.done;
  assert.deepEqual([error.kind, helperClassOf(error)], ["protocol", "protocol"]);
});

// ── JetStream ──────────────────────────────────────────────────────────────

test("publishAck: the stream's answer, a duplicate inside the window answered with the first sequence, a new one after it", async () => {
  const { peer, js, conn } = await opened();
  await js.streamCreate({ name: "ORDERS", subjects: ["orders.>"], storage: "memory", duplicateWindowMs: 60_000, maxMsgs: 100 });
  assert.deepEqual(peer.calls().find((c) => c.verb === "STREAM.CREATE").body, { name: "ORDERS", subjects: ["orders.>"], storage: "memory", max_msgs: 100, duplicate_window: 60_000_000_000 });
  assert.deepEqual(await js.publishAck("orders.new", "{}", { msgId: "m-1" }), { stream: "ORDERS", seq: 1, duplicate: false });
  assert.deepEqual(await js.publishAck("orders.new", "{}", { msgId: "m-1" }), { stream: "ORDERS", seq: 1, duplicate: true });
  peer.advance(60_001);
  assert.deepEqual(await js.publishAck("orders.new", "{}", { msgId: "m-1" }), { stream: "ORDERS", seq: 2, duplicate: false });
  assert.deepEqual(await js.publishAck("orders.paid", "{}"), { stream: "ORDERS", seq: 3, duplicate: false });
  await assert.rejects(js.publishAck("nowhere.x", "{}"), classed("refused", (e) => e.status === 503));
  await assert.rejects(js.publishAck("orders.new", "{}", { headers: { "Nats-Expected-Last-Sequence": "1" } }), classed("refused", (e) => e.kind === "api" && e.errCode === 10071));
  await conn.close();
});

test("only a new stream or consumer is made, only an own one is deleted, an unknown field is refused, and nothing purges", async () => {
  const { peer, js, conn } = await opened();
  await js.streamCreate({ name: "ORDERS", subjects: ["orders.>"] });
  await assert.rejects(js.streamCreate({ name: "ORDERS", subjects: ["orders.>"] }), classed("refused", (e) => /already exists/.test(e.message)));
  await assert.rejects(js.streamCreate({ name: "OTHER", subjects: ["other"], retain: "forever" }), classed("refused", (e) => /does not know retain/.test(e.message)));
  await assert.rejects(js.streamCreate({ name: "a.b", subjects: ["x"] }), classed("refused"));
  await assert.rejects(js.consumerCreate("ORDERS", { durable_name: "work", ack_wait: 30_000 }), classed("refused", (e) => /NANOSECONDS/.test(e.message)));
  await js.consumerCreate("ORDERS", { durable_name: "work", ack_wait: 30e9, max_deliver: 3, filter_subject: "orders.new" });
  assert.deepEqual(peer.calls().filter((c) => c.verb === "CONSUMER.CREATE").map((c) => [c.args, c.body.config.ack_policy, c.body.config.ack_wait, c.body.action]), [[["ORDERS", "work"], "explicit", 30e9, "create"]]);
  await assert.rejects(js.consumerCreate("ORDERS", { durable_name: "work" }), classed("refused", (e) => /already exists/.test(e.message)));
  const ephemeral = await js.consumerCreate("ORDERS", {});
  assert.deepEqual(js.owned(), { streams: ["ORDERS"], consumers: ["ORDERS/work", `ORDERS/${ephemeral.name}`] });
  await assert.rejects(js.streamDelete("APP"), classed("refused", (e) => /not created by this client/.test(e.message)));
  await assert.rejects(js.consumerDelete("ORDERS", "someone-elses"), classed("refused"));
  assert.deepEqual(await js.consumerDelete("ORDERS", "work"), { deleted: true });
  assert.deepEqual(await js.streamDelete("ORDERS"), { deleted: true });
  assert.deepEqual(js.owned(), { streams: [], consumers: [] }, "a stream's consumers go with it");
  assert.deepEqual(peer.calls().filter((c) => /DELETE/.test(c.verb)).map((c) => c.args.join("/")), ["ORDERS/work", "ORDERS"]);
  assert.equal(peer.calls().some((c) => /PURGE/.test(c.verb)), false);
  assert.deepEqual(Object.keys(js).filter((k) => /purge|api|request/i.test(k)), [], "no door to purge or to any raw API");
  await conn.close();
});

test("fetch, nak and redelivery: the second delivery says deliveredCount 2, and an ack ends it", async () => {
  const { peer, js, conn } = await opened();
  await ordersWithWorker(js);
  await js.publishAck("orders.new", '{"id":1}', { msgId: "a" });
  const first = await js.fetch("ORDERS", "work", { batch: 1, expiresMs: 1000 });
  assert.equal(first.ended, "batch");
  const [m1] = first.messages;
  assert.equal(m1.subject, "orders.new", "a fetched message keeps the subject it was published to");
  assert.deepEqual([m1.info.stream, m1.info.consumer, m1.info.deliveredCount, m1.info.streamSeq, m1.info.consumerSeq, m1.info.pending], ["ORDERS", "work", 1, 1, 1, 0]);
  assert.deepEqual([m1.headers["Nats-Msg-Id"], JSON.parse(m1.data).id], ["a", 1]);
  assert.deepEqual(peer.calls().find((c) => c.verb === "CONSUMER.MSG.NEXT").body, { batch: 1, expires: 1_000_000_000 });
  assert.deepEqual(await js.nak(m1, { confirm: true }), { nak: 1, confirmed: true });
  const [m2] = (await js.fetch("ORDERS", "work", { batch: 1 })).messages;
  assert.deepEqual([m2.info.deliveredCount, m2.info.streamSeq, m2.info.consumerSeq], [2, 1, 2]);
  await js.ack(m2, { confirm: true });
  const none = await js.fetch("ORDERS", "work", { batch: 1, noWait: true });
  assert.deepEqual([none.messages.length, none.ended], [0, "no-messages"]);
  assert.deepEqual(peer.acks().map((a) => [a.body, a.seq]), [["-NAK", 1], ["+ACK", 1]]);
  assert.deepEqual(position(await js.consumerInfo("ORDERS", "work")).num_ack_pending, 0);
  assert.deepEqual(subjects(peer.server.conns[0]), ["_INBOX.T.*"], "every pull let its own inbox go");
  await conn.close();
});

test("a delayed nak says its delay in nanoseconds and is not redelivered at once; term ends redelivery; inProgress is +WPI", async () => {
  const { peer, js, conn } = await opened();
  await ordersWithWorker(js);
  for (const id of [1, 2, 3]) await js.publishAck("orders.new", JSON.stringify({ id }));
  const { messages: [a, b, c] } = await js.fetch("ORDERS", "work", { batch: 3 });
  assert.deepEqual([a.info.pending, b.info.pending, c.info.pending], [2, 1, 0]);
  await js.nak(a, { delayMs: 5000, confirm: true });
  await js.term(b, { confirm: true });
  await js.inProgress(c, { confirm: true });
  const after = await js.fetch("ORDERS", "work", { batch: 3, noWait: true });
  assert.deepEqual([after.messages.length, after.ended], [0, "no-messages"]);
  assert.deepEqual(peer.acks().map((x) => x.body), ['-NAK {"delay":5000000000}', "+TERM", "+WPI"]);
  await js.ack(c);
  await conn.flush();
  assert.equal(peer.acks().at(-1).body, "+ACK", "an unconfirmed ack is only written");
  await assert.rejects(js.ack({ subject: "x", reply: "_INBOX.x.1" }), classed("refused", (e) => /no \$JS\.ACK/.test(e.message)));
  await conn.close();
});

test("a pull that waits: a later message fills it, the server's 408 ends it with what came, and this client's clock ends one the server forgot", async () => {
  const { peer, timers, js, conn } = await opened();
  await ordersWithWorker(js);
  const waiting = js.fetch("ORDERS", "work", { batch: 3, expiresMs: 2000 });
  await settle();
  peer.publish("orders.new", "late");
  await settle();
  peer.expirePulls();
  const got = await waiting;
  assert.deepEqual([got.messages.map((m) => m.data.toString()), got.ended], [["late"], "expired"]);
  const forgotten = js.fetch("ORDERS", "work", { batch: 1, expiresMs: 2000 });
  await settle();
  timers.advance(3000);
  assert.deepEqual(await forgotten, { messages: [], ended: "clock" });
  await assert.rejects(js.fetch("ORDERS", "nobody", { batch: 1 }), classed("refused", (e) => e.status === 503 && Array.isArray(e.messages)));
  await assert.rejects(js.fetch("ORDERS", "work", { batch: 0 }), classed("refused"));
  await conn.close();
});

test("readRange observes a stream and never moves the application's consumer", async () => {
  const peer = fakeNatsPeer();
  const app = jetstream(await connect({ socket: peer.socket, timers: fakeTimers(), inboxId: "APP" }));
  const testConn = await connect({ socket: peer.socket, timers: fakeTimers(), inboxId: "T" });
  const js = jetstream(testConn);
  await app.streamCreate({ name: "ORDERS", subjects: ["orders.>"] });
  await app.consumerCreate("ORDERS", { durable_name: "app", ack_wait: 30e9 });
  for (const id of [1, 2, 3]) await app.publishAck(`orders.${id === 2 ? "paid" : "new"}`, JSON.stringify({ id }), { msgId: `o-${id}` });
  const { messages: [first] } = await app.fetch("ORDERS", "app", { batch: 1 });
  await app.ack(first, { confirm: true });
  const before = position(await js.consumerInfo("ORDERS", "app"));
  const range = await js.readRange("ORDERS", { fromSeq: 1 });
  assert.deepEqual(range.messages.map((m) => [m.seq, m.subject, JSON.parse(m.data).id, m.headers["Nats-Msg-Id"]]), [[1, "orders.new", 1, "o-1"], [2, "orders.paid", 2, "o-2"], [3, "orders.new", 3, "o-3"]]);
  assert.deepEqual([range.complete, range.truncated, range.through, range.next], [true, false, 3, 4]);
  const news = await js.readRange("ORDERS", { fromSeq: 1, filter: "orders.new", max: 1 });
  assert.deepEqual([news.messages.map((m) => m.seq), news.complete, news.truncated, news.next], [[1], false, true, 2]);
  assert.deepEqual((await js.readRange("ORDERS", { fromSeq: news.next, filter: "orders.new" })).messages.map((m) => m.seq), [3]);
  assert.deepEqual(position(await js.consumerInfo("ORDERS", "app")), before, "the application's consumer did not move");
  const testId = peer.server.conns[1].id;
  assert.deepEqual(peer.calls().filter((c) => c.conn === testId).map((c) => c.verb).filter((v) => v !== "STREAM.MSG.GET" && v !== "CONSUMER.INFO"), [], "the observation made nothing and pulled nothing");
  await assert.rejects(js.consumerDelete("ORDERS", "app"), classed("refused"));
  await assert.rejects(js.streamDelete("ORDERS"), classed("refused"));
  const { messages: [next] } = await app.fetch("ORDERS", "app", { batch: 1 });
  assert.equal(next.info.streamSeq, 2, "the application's consumer goes on where it was");
  await testConn.close();
});

test("readRange skips a gap instead of reading it as the end, and an empty stream is complete with nothing", async () => {
  const { js, conn } = await opened();
  await js.streamCreate({ name: "KEPT", subjects: ["kept.>"], maxMsgs: 2 });
  assert.deepEqual(await js.readRange("KEPT"), { stream: "KEPT", messages: [], through: null, next: 1, complete: true, truncated: false });
  for (const n of [1, 2, 3]) await js.publishAck("kept.x", String(n));
  const range = await js.readRange("KEPT", { fromSeq: 1 });
  assert.deepEqual(range.messages.map((m) => [m.seq, m.data.toString(), m.headers]), [[2, "2", null], [3, "3", null]]);
  await assert.rejects(js.readRange("MISSING"), classed("refused", (e) => e.errCode === 10059));
  await assert.rejects(js.readRange("KEPT", { max: 0 }), classed("refused"));
  await conn.close();
});

test("a publication whose ack never came is AMBIGUOUS with its message id; one never sent is not", async () => {
  const { js, conn } = await opened({ dropPubAcks: true });
  await js.streamCreate({ name: "ORDERS", subjects: ["orders.>"] });
  const unanswered = js.publishAck("orders.new", "x", { msgId: "m-9" });
  await settle();
  await conn.close();
  await assert.rejects(unanswered, classed("ambiguous", (e) => e.kind === "ambiguous" && e.msgId === "m-9" && e.subject === "orders.new" && e.cause.kind === "closed"));
  await assert.rejects(js.publishAck("orders.new", "y", { msgId: "m-10" }), classed("transport", (e) => e.sent === false && e.kind !== "ambiguous"));
});

test("an ack lost to a broken connection or to the clock is ambiguous too, and the stream kept what a read-back finds", async () => {
  const peer = fakeNatsPeer({ dropPubAcks: true });
  const timers = fakeTimers();
  const js = jetstream(await connect({ socket: peer.socket, timers, inboxId: "T" }));
  await js.streamCreate({ name: "ORDERS", subjects: ["orders.>"] });
  const timedOut = js.publishAck("orders.new", "x", { msgId: "m-1", timeoutMs: 500 });
  await settle();
  timers.advance(500);
  await assert.rejects(timedOut, classed("ambiguous", (e) => e.msgId === "m-1" && e.cause.kind === "timeout"));
  const broken = js.publishAck("orders.new", "y", { msgId: "m-2" });
  await settle();
  peer.closeConnection();
  await assert.rejects(broken, classed("ambiguous", (e) => e.msgId === "m-2" && e.cause.kind === "transport"));
  const reader = jetstream(await connect({ socket: peer.socket, timers: fakeTimers(), inboxId: "R" }));
  const kept = await reader.readRange("ORDERS");
  assert.deepEqual(kept.messages.map((m) => m.headers["Nats-Msg-Id"]), ["m-1", "m-2"], "whether it was kept is a read-back's to say");
});

test("JetStream errors are data: a missing stream or consumer is refused by err_code; no JetStream at all is the machine's", async () => {
  const { js, conn } = await opened();
  await assert.rejects(js.streamInfo("MISSING"), classed("refused", (e) => e.kind === "api" && e.errCode === 10059 && e.code === 404));
  await js.streamCreate({ name: "ORDERS", subjects: ["orders.>"] });
  await assert.rejects(js.consumerInfo("ORDERS", "missing"), classed("refused", (e) => e.errCode === 10014));
  await conn.close();
  const off = await opened({ jetstream: false });
  await assert.rejects(off.js.streamCreate({ name: "S", subjects: ["s"] }), classed("transport", (e) => /503 no responders/.test(e.message)));
  await off.conn.close();
});

test("the $JS.ACK subject's domain layout is read the same way off a real delivery", async () => {
  const { js, conn } = await opened({ ackDomain: "hub" });
  await ordersWithWorker(js);
  await js.publishAck("orders.new", "x");
  const [m] = (await js.fetch("ORDERS", "work", { batch: 1 })).messages;
  assert.deepEqual([m.info.domain, m.info.account, m.info.stream, m.info.consumer, m.info.deliveredCount, m.info.streamSeq], ["hub", "ACCHASH", "ORDERS", "work", 1, 1]);
  assert.deepEqual(await js.ack(m, { confirm: true }), { ack: 1, confirmed: true });
  await conn.close();
});
