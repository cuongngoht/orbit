import assert from "node:assert/strict";
import { test } from "node:test";
import { connect, helperClassOf } from "../skills/orbit-backend-test/amqp/index.mjs";
import { methodFrame } from "../skills/orbit-backend-test/amqp/wire.mjs";
import { fakeAmqpPeer, fakeTimers } from "./fakes/amqp-peer.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async (n = 5) => {
  for (let i = 0; i < n; i += 1) await tick();
};

async function opened(script = {}, options = {}) {
  const fake = fakeAmqpPeer(script);
  const timers = fakeTimers();
  const conn = await connect({ socket: fake.socket, user: "orbit", password: "s3cret", vhost: "/test", heartbeatSec: 0, timers, ...options });
  return { fake, conn, timers };
}

test("the handshake answers PLAIN, agrees the tune and opens the vhost", async () => {
  const { fake, conn } = await opened({ heartbeat: 30, frameMax: 65536 }, { heartbeatSec: 60 });
  assert.equal(fake.peer.credentials, "\u0000orbit\u0000s3cret");
  assert.equal(fake.peer.start.mechanism, "PLAIN");
  assert.equal(fake.peer.start.clientProperties.capabilities.publisher_confirms, true);
  assert.deepEqual(fake.peer.tuneOk, { channelMax: 2047, frameMax: 65536, heartbeat: 30 });
  assert.equal(fake.peer.vhost, "/test");
  assert.deepEqual(conn.tune(), { channelMax: 2047, frameMax: 65536, heartbeat: 30 });
  assert.deepEqual(await conn.close(), { error: null });
  assert.ok(fake.peer.received.some((m) => m.name === "connection.close"));
});

test("a confirmed publish resolves ack, nack or returned, by delivery tag", async () => {
  const { conn } = await opened({ onPublish: (msg, seq) => (seq === 2 ? "nack" : undefined) });
  const ch = await conn.channel();
  await ch.confirmSelect();
  await ch.declareQueue({ name: "billing" });
  await ch.bindQueue({ queue: "billing", exchange: "amq.topic", routingKey: "invoice.due" });
  assert.deepEqual(await ch.publish({ exchange: "amq.topic", routingKey: "invoice.due", body: "one", properties: { messageId: "m-1" } }), { outcome: "ack", deliveryTag: 1 });
  assert.deepEqual(await ch.publish({ exchange: "amq.topic", routingKey: "invoice.due", body: "two" }), { outcome: "nack", deliveryTag: 2 });
  const back = await ch.publish({ exchange: "amq.topic", routingKey: "nowhere", mandatory: true, body: "three", properties: { messageId: "m-3" } });
  assert.deepEqual(back, { outcome: "returned", deliveryTag: 3, replyCode: 312, replyText: "NO_ROUTE" });
  await conn.close();
});

test("publishes in flight together settle each on its own tag", async () => {
  const { conn } = await opened();
  const ch = await conn.channel();
  await ch.confirmSelect();
  await ch.declareQueue({ name: "q" });
  const outcomes = await Promise.all([1, 2, 3].map((n) => ch.publish({ exchange: "", routingKey: "q", body: `m${n}` })));
  assert.deepEqual(outcomes.map((o) => o.deliveryTag), [1, 2, 3]);
  assert.ok(outcomes.every((o) => o.outcome === "ack"));
  await conn.close();
});

test("get answers empty, then the message, then the same message redelivered after a requeue", async () => {
  const { fake, conn } = await opened();
  const ch = await conn.channel();
  await ch.declareQueue({ name: "inbox" });
  assert.deepEqual(await ch.get({ queue: "inbox" }), { message: null });
  assert.deepEqual(await ch.publish({ exchange: "", routingKey: "inbox", body: "hello", properties: { contentType: "text/plain", headers: { tenant: "tenant-a" }, messageId: "m-9" } }), { outcome: "unconfirmed", deliveryTag: null }, "a channel without confirms promises nothing");
  const first = await ch.get({ queue: "inbox" });
  assert.equal(first.message.toString(), "hello");
  assert.equal(first.redelivered, false);
  assert.equal(first.headers.tenant, "tenant-a");
  assert.equal(first.properties.messageId, "m-9");
  ch.nack(first.deliveryTag, { requeue: true });
  const again = await ch.get({ queue: "inbox" });
  assert.equal(again.redelivered, true);
  assert.equal(again.message.toString(), "hello");
  ch.ack(again.deliveryTag);
  assert.deepEqual(fake.peer.acks.map((a) => a.deliveryTag), [again.deliveryTag]);
  assert.equal(fake.peer.queues.get("inbox").messages.length, 0);
  await conn.close();
});

test("a large body travels in frames no bigger than the agreed frame-max and arrives whole", async () => {
  const { fake, conn } = await opened({ frameMax: 4096 });
  const ch = await conn.channel();
  await ch.declareQueue({ name: "big" });
  const body = Buffer.alloc(10000, 0x61);
  await ch.publish({ exchange: "", routingKey: "big", body });
  assert.equal(fake.peer.published[0].body.length, 10000);
  const got = await ch.get({ queue: "big" });
  assert.equal(Buffer.compare(got.message, body), 0);
  await conn.close();
});

test("a consumer is told of every delivery, and a cancel stops it", async () => {
  const { conn } = await opened();
  const ch = await conn.channel();
  await ch.declareQueue({ name: "work" });
  const seen = [];
  const { consumerTag } = await ch.consume({ queue: "work", onMessage: (d) => seen.push(d) });
  await ch.publish({ exchange: "", routingKey: "work", body: "job-1" });
  await settle();
  assert.deepEqual(seen.map((d) => [d.consumerTag, d.message.toString(), d.redelivered]), [[consumerTag, "job-1", false]]);
  ch.ack(seen[0].deliveryTag);
  await ch.cancel(consumerTag);
  await conn.close();
});

test("calls on one channel go out one at a time, whatever order they are awaited", async () => {
  const { fake, conn } = await opened();
  const ch = await conn.channel();
  const both = Promise.all([ch.declareQueue({ name: "a" }), ch.declareQueue({ name: "b" })]);
  for (let i = 0; i < 5; i += 1) await null;
  assert.equal(fake.peer.received.filter((m) => m.name === "queue.declare").length, 1, "the second waits for the first's reply, which has not arrived yet");
  const [a, b] = await both;
  assert.deepEqual([a.queue, b.queue], ["a", "b"]);
  await conn.close();
});

test("a broker that closes the connection fails every pending call with its reply code", async () => {
  const { fake, conn } = await opened({ hold: ["queue.declare"] });
  const ch = await conn.channel();
  const pending = ch.declareQueue({ name: "never" });
  await tick();
  fake.closeConnection(320, "CONNECTION_FORCED - shutdown");
  await assert.rejects(pending, (e) => e.kind === "closed" && e.scope === "connection" && e.replyCode === 320);
  const { error } = await conn.done;
  assert.equal(error.kind, "closed");
  assert.equal(helperClassOf(error), "transport");
  assert.ok(fake.peer.received.some((m) => m.name === "connection.close-ok"), "the client agreed to the close");
  await assert.rejects(conn.channel(), (e) => e.kind === "closed");
});

test("a passive declare of a missing exchange closes only that channel, as a refusal", async () => {
  const { fake, conn } = await opened();
  const ch = await conn.channel();
  await assert.rejects(ch.declareExchange({ exchange: "missing", passive: true }), (e) => e.kind === "closed" && e.scope === "channel" && e.replyCode === 404 && helperClassOf(e) === "refused");
  assert.ok(fake.peer.received.some((m) => m.name === "channel.close-ok"));
  await assert.rejects(ch.get({ queue: "x" }), (e) => e.replyCode === 404, "a closed channel refuses what is asked of it next");
  const next = await conn.channel();
  assert.ok(next.id > ch.id);
  await next.declareExchange({ exchange: "amq.topic", passive: true });
  await conn.close();
});

test("a confirm that never arrives before the connection ends is AMBIGUOUS, with its message id", async () => {
  const { fake, conn } = await opened({ onPublish: () => "drop" });
  const ch = await conn.channel();
  await ch.confirmSelect();
  const lost = ch.publish({ exchange: "amq.topic", routingKey: "invoice.due", body: "lost", properties: { messageId: "m-lost" } });
  await tick();
  fake.closeConnection();
  await assert.rejects(lost, (e) => e.kind === "ambiguous" && e.messageId === "m-lost" && e.deliveryTag === 1 && helperClassOf(e) === "ambiguous");
  assert.equal((await conn.done).error.replyCode, 320);
});

test("a socket that drops with confirms outstanding leaves them AMBIGUOUS too", async () => {
  const { fake, conn } = await opened({ onPublish: () => "drop" });
  const ch = await conn.channel();
  await ch.confirmSelect();
  const lost = ch.publish({ exchange: "", routingKey: "q", body: "x" });
  fake.peer.socket.destroy();
  await assert.rejects(lost, (e) => e.kind === "ambiguous" && e.deliveryTag === 1 && e.cause.kind === "transport");
  assert.equal(helperClassOf((await conn.done).error), "transport");
});

test("a broker that stops talking is a heartbeat timeout", async () => {
  const { fake, conn, timers } = await opened({ heartbeat: 1 }, { heartbeatSec: 1 });
  timers.advance(500);
  await settle();
  assert.equal(fake.peer.heartbeats, 1, "a heartbeat went out at half the interval");
  fake.silence();
  timers.advance(3000);
  const { error } = await conn.done;
  assert.equal(error.kind, "timeout");
  assert.match(error.message, /heartbeat/);
  assert.equal(helperClassOf(error), "timeout");
});

test("a broker that never answers the protocol header is a connect timeout", async () => {
  const fake = fakeAmqpPeer({ mute: true });
  const timers = fakeTimers();
  const pending = connect({ socket: fake.socket, timers, timeoutMs: 2000 });
  await settle();
  timers.advance(2001);
  await assert.rejects(pending, (e) => e.kind === "timeout" && /handshake/.test(e.message));
});

test("a frame for a channel that is not open is a protocol error that ends the connection", async () => {
  const { fake, conn } = await opened();
  fake.raw(methodFrame(9, "channel.open-ok", { channelId: "" }));
  const { error } = await conn.done;
  assert.equal(error.kind, "protocol");
  assert.match(error.message, /channel 9/);
  assert.equal(helperClassOf(error), "protocol");
});

test("a broker without PLAIN is refused before any credential is sent", async () => {
  const fake = fakeAmqpPeer({ mute: true });
  const timers = fakeTimers();
  const pending = connect({ socket: fake.socket, timers });
  await settle();
  fake.peer.script.mute = false;
  fake.raw(methodFrame(0, "connection.start", { versionMajor: 0, versionMinor: 9, serverProperties: {}, mechanisms: "EXTERNAL", locales: "en_US" }));
  await assert.rejects(pending, (e) => e.kind === "protocol" && /PLAIN only/.test(e.message));
  assert.equal(fake.peer.start, null);
});
