// An AMQP 0-9-1 client over one socket: the PLAIN handshake, channels, one
// synchronous method at a time per channel, publisher confirms, content
// assembly, heartbeats. The socket comes from a factory the caller may hand in
// (`socket`), and every clock from `timers`, so a test needs no network and no
// waiting. It never purges a queue and never deletes an exchange: methods.mjs
// cannot even encode them.
//
// Every way this ends badly is an AmqpError (errors.mjs). A publish sent on a
// confirm channel whose confirm never arrived before the channel or the
// connection ended is AMBIGUOUS, with its delivery tag and message id: whether
// the broker took it is a read-back's question, and this client never resends.
import { createConnection } from "node:net";
import { AmqpError, ambiguousError, closedError, protocolError, timeoutError, transportError } from "./errors.mjs";
import { BY_NAME } from "./methods.mjs";
import { PROTOCOL_HEADER, contentFrames, createParser, decodeFrame, heartbeatFrame, methodFrame } from "./wire.mjs";

const DEFAULTS = { host: "127.0.0.1", port: 5672, vhost: "/", user: "guest", password: "guest", heartbeatSec: 60, frameMax: 131072, channelMax: 2047, timeoutMs: 10000, locale: "en_US" };

// What the client says it understands. The capabilities are RabbitMQ's
// extensions; a broker that does not know a capability ignores it.
export const CLIENT_PROPERTIES = { product: "orbit", platform: "node", capabilities: { publisher_confirms: true, consumer_cancel_notify: true, "basic.nack": true, "connection.blocked": true, authentication_failure_close: true } };

const SYSTEM_TIMERS = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t), now: () => Date.now() };
const CLIENT_CLOSE = { replyCode: 200, replyText: "closed by the client", classId: 0, methodId: 0 };
const netSocket = (o) => createConnection({ host: o.host, port: o.port });

export function connect(options = {}) {
  const conn = stateOf({ ...DEFAULTS, ...options });
  return new Promise((resolve, reject) => open(conn, resolve, reject));
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const stateOf = (o) => ({ o, timers: o.timers ?? SYSTEM_TIMERS, channels: new Map(), nextChannel: 1, tune: null, lastReceived: 0, closed: false, error: null, blocked: null, done: deferred(), handshake: null, closing: null, socket: null, parser: null, beat: null });

function open(conn, resolve, reject) {
  conn.handshake = { resolve, reject, timer: conn.timers.setTimeout(() => fail(conn, timeoutError(`no AMQP handshake within ${conn.o.timeoutMs} ms`)), conn.o.timeoutMs) };
  conn.parser = createParser((f) => received(conn, f));
  conn.socket = (conn.o.socket ?? netSocket)(conn.o);
  listen(conn, conn.socket);
}

function listen(conn, socket) {
  socket.on("connect", () => write(conn, PROTOCOL_HEADER));
  socket.on("data", (chunk) => guarded(conn, () => conn.parser.push(chunk)));
  socket.on("error", (e) => fail(conn, transportError(`socket error: ${e.message}`, e)));
  socket.on("close", () => fail(conn, transportError("the socket to the broker closed")));
}

function guarded(conn, fn) {
  try { fn(); } catch (e) { fail(conn, e instanceof AmqpError ? e : protocolError(e.message)); }
}

function write(conn, buf) {
  if (!conn.socket || conn.socket.destroyed) return false;
  return conn.socket.write(buf);
}

function received(conn, frame) {
  if (conn.closed) return null;
  conn.lastReceived = conn.timers.now();
  return ON_FRAME[frame.kind](conn, frame.channel, decodeFrame(frame));
}

const ON_FRAME = {
  heartbeat: () => null,
  method: (conn, id, m) => (id === 0 ? onConnectionMethod(conn, m) : onChannelMethod(channelOf(conn, id), m)),
  header: (conn, id, h) => onHeader(channelOf(conn, id), h),
  body: (conn, id, b) => onBody(channelOf(conn, id), b),
};

function channelOf(conn, id) {
  const ch = conn.channels.get(id);
  if (!ch) throw protocolError(`a frame for channel ${id}, which is not open`);
  return ch;
}

// ── The connection ─────────────────────────────────────────────────────────

const CONNECTION = {
  "connection.start": (conn, a) => startOk(conn, a),
  "connection.tune": (conn, a) => tuneOk(conn, a),
  "connection.open-ok": (conn) => opened(conn),
  "connection.close": (conn, a) => closedByBroker(conn, a),
  "connection.close-ok": (conn) => finish(conn, null),
  "connection.blocked": (conn, a) => void (conn.blocked = a.reason || "blocked"),
  "connection.unblocked": (conn) => void (conn.blocked = null),
};

function onConnectionMethod(conn, m) {
  const handle = CONNECTION[m.name];
  if (!handle) throw protocolError(`unexpected ${m.name} on channel 0`);
  return handle(conn, m.args);
}

function startOk(conn, a) {
  if (!String(a.mechanisms).split(" ").includes("PLAIN")) throw protocolError(`the broker offers ${a.mechanisms}; this client speaks PLAIN only`);
  write(conn, methodFrame(0, "connection.start-ok", { clientProperties: conn.o.clientProperties ?? CLIENT_PROPERTIES, mechanism: "PLAIN", response: plain(conn.o), locale: conn.o.locale }));
}

const plain = (o) => Buffer.concat([Buffer.from([0]), Buffer.from(String(o.user)), Buffer.from([0]), Buffer.from(String(o.password))]);

// 0 means "no limit" for channel-max and frame-max, so the other side's word
// stands; a client that asks for no heartbeat gets none.
const negotiate = (server, client) => (server === 0 || client === 0 ? Math.max(server, client) : Math.min(server, client));
const heartbeatOf = (server, client) => (client === 0 ? 0 : negotiate(server, client));

function tuneOk(conn, a) {
  conn.tune = { channelMax: negotiate(a.channelMax, conn.o.channelMax), frameMax: negotiate(a.frameMax, conn.o.frameMax), heartbeat: heartbeatOf(a.heartbeat, conn.o.heartbeatSec) };
  write(conn, methodFrame(0, "connection.tune-ok", conn.tune));
  write(conn, methodFrame(0, "connection.open", { virtualHost: conn.o.vhost }));
  startHeartbeat(conn);
}

function opened(conn) {
  conn.timers.clearTimeout(conn.handshake.timer);
  conn.handshake.resolve(connectionApi(conn));
  conn.handshake = null;
}

function closedByBroker(conn, a) {
  write(conn, methodFrame(0, "connection.close-ok", {}));
  finish(conn, closedError("connection", a));
}

// A close both sides agreed on ends the socket; anything else destroys it.
function finish(conn, error) {
  if (conn.closed) return;
  settle(conn, error ?? closedError("connection", CLIENT_CLOSE));
  conn.socket.end?.();
  conn.done.resolve({ error });
}

function fail(conn, error) {
  if (conn.closed) return;
  settle(conn, error);
  conn.socket?.destroy?.();
  conn.done.resolve({ error });
}

function settle(conn, error) {
  conn.closed = true;
  conn.error = error;
  stopTimers(conn);
  conn.channels.forEach((ch) => failChannel(ch, error));
  conn.handshake?.reject(error);
}

function stopTimers(conn) {
  conn.timers.clearInterval(conn.beat);
  conn.timers.clearTimeout(conn.handshake?.timer);
  conn.timers.clearTimeout(conn.closing);
}

// A heartbeat goes out every half interval; a broker silent for two whole
// intervals is gone (AMQP 0-9-1 §4.2.7).
function startHeartbeat(conn) {
  if (!conn.tune.heartbeat) return;
  conn.lastReceived = conn.timers.now();
  conn.beat = conn.timers.setInterval(() => beat(conn), conn.tune.heartbeat * 500);
  conn.beat?.unref?.();
}

function beat(conn) {
  if (conn.timers.now() - conn.lastReceived > conn.tune.heartbeat * 2000) return fail(conn, timeoutError(`no frame from the broker for ${conn.tune.heartbeat * 2} s: the heartbeat stopped`));
  write(conn, heartbeatFrame());
}

function closeConnection(conn) {
  if (conn.closed) return conn.done.promise;
  write(conn, methodFrame(0, "connection.close", CLIENT_CLOSE));
  conn.closing = conn.timers.setTimeout(() => fail(conn, timeoutError("the broker never confirmed the close")), conn.o.timeoutMs);
  return conn.done.promise;
}

const connectionApi = (conn) => ({
  channel: () => openChannel(conn),
  close: () => closeConnection(conn),
  done: conn.done.promise,
  blocked: () => conn.blocked,
  tune: () => ({ ...conn.tune }),
});

// ── Channels ───────────────────────────────────────────────────────────────

const channelState = (conn, id) => ({ id, conn, waiting: null, chain: Promise.resolve(), confirm: false, nextSeq: 1, pending: new Map(), content: null, consumers: new Map(), closed: null, tags: 0 });
const closedOf = (ch) => ch.closed ?? (ch.conn.closed ? ch.conn.error : null);

function openChannel(conn) {
  if (conn.closed) return Promise.reject(conn.error);
  if (conn.nextChannel > conn.tune.channelMax) return Promise.reject(protocolError(`all ${conn.tune.channelMax} channels this connection may open are taken`));
  const ch = channelState(conn, conn.nextChannel++);
  conn.channels.set(ch.id, ch);
  return call(ch, "channel.open", {}).then(() => channelApi(ch));
}

const channelApi = (ch) => ({ id: ch.id, ...Object.fromEntries(Object.entries(OPS).map(([name, op]) => [name, (...a) => op(ch, ...a)])) });

// A synchronous method waits for its reply before the next one is sent, so a
// channel's calls run one after another whatever order the caller awaits them.
function call(ch, name, args) {
  const run = () => ask(ch, name, args);
  ch.chain = ch.chain.then(run, run);
  return ch.chain;
}

function ask(ch, name, args) {
  const closed = closedOf(ch);
  if (closed) return Promise.reject(closed);
  return new Promise((resolve, reject) => wait(ch, name, args, { resolve, reject }));
}

function wait(ch, name, args, settled) {
  ch.waiting = { ...settled, expect: BY_NAME.get(name).replies, timer: ch.conn.timers.setTimeout(() => fail(ch.conn, timeoutError(`${name} on channel ${ch.id} had no answer within ${ch.conn.o.timeoutMs} ms`)), ch.conn.o.timeoutMs) };
  write(ch.conn, methodFrame(ch.id, name, args));
}

function settleWaiting(ch, how) {
  const w = ch.waiting;
  ch.waiting = null;
  ch.conn.timers.clearTimeout(w.timer);
  how(w);
}

function reply(ch, m) {
  if (!ch.waiting?.expect?.includes(m.name)) throw protocolError(`unexpected ${m.name} on channel ${ch.id}`);
  settleWaiting(ch, (w) => w.resolve(m));
}

const CHANNEL = {
  "channel.close": (ch, m) => closedChannelByBroker(ch, m.args),
  "basic.ack": (ch, m) => confirmed(ch, m.args, "ack"),
  "basic.nack": (ch, m) => confirmed(ch, m.args, "nack"),
  "basic.cancel": (ch, m) => cancelledByBroker(ch, m.args),
};

function onChannelMethod(ch, m) {
  if (m.method.content) return startContent(ch, m);
  return (CHANNEL[m.name] ?? reply)(ch, m);
}

function closedChannelByBroker(ch, a) {
  write(ch.conn, methodFrame(ch.id, "channel.close-ok", {}));
  failChannel(ch, closedError("channel", a));
  ch.conn.channels.delete(ch.id);
}

// Whatever a closed channel still owed is settled now: the waiting call is
// rejected, every unconfirmed publish is AMBIGUOUS, every consumer is told.
function failChannel(ch, error) {
  ch.closed = error;
  if (ch.waiting) settleWaiting(ch, (w) => w.reject(error));
  ch.pending.forEach((e, tag) => e.reject(ambiguousError({ ...e, deliveryTag: tag }, error)));
  ch.pending.clear();
  ch.consumers.forEach((c) => tell(c, () => c.onCancel?.(error)));
}

function cancelledByBroker(ch, a) {
  const consumer = ch.consumers.get(a.consumerTag);
  ch.consumers.delete(a.consumerTag);
  if (consumer) tell(consumer, () => consumer.onCancel?.(null));
}

// A consumer's own callback failing is the consumer's news, never the connection's.
function tell(consumer, fn) {
  try { fn(); } catch (e) { consumer.onError?.(e); }
}

function retire(ch) {
  failChannel(ch, closedError("channel", CLIENT_CLOSE));
  ch.conn.channels.delete(ch.id);
}

// ── Content: a method, then its header, then its body frames ───────────────

function startContent(ch, m) {
  if (ch.content) throw protocolError(`${m.name} on channel ${ch.id} before the previous content was complete`);
  ch.content = { method: m, header: null, chunks: [], received: 0 };
}

function onHeader(ch, h) {
  if (!ch.content || ch.content.header) throw protocolError(`a content header on channel ${ch.id} that no method announced`);
  ch.content.header = h;
  if (h.bodySize === 0) completeContent(ch);
}

function onBody(ch, b) {
  if (!ch.content?.header) throw protocolError(`a body frame on channel ${ch.id} with no header before it`);
  ch.content.chunks.push(b);
  ch.content.received += b.length;
  if (ch.content.received >= ch.content.header.bodySize) completeContent(ch);
}

function completeContent(ch) {
  const c = ch.content;
  ch.content = null;
  const message = { ...c.method.args, properties: c.header.properties, body: Buffer.concat(c.chunks) };
  return (ON_CONTENT[c.method.name] ?? unexpectedContent)(ch, message, c.method);
}

const ON_CONTENT = {
  "basic.deliver": (ch, msg) => delivered(ch, msg),
  "basic.get-ok": (ch, msg, m) => reply(ch, { ...m, message: msg }),
  "basic.return": (ch, msg) => returned(ch, msg),
};

const unexpectedContent = (ch, msg, m) => {
  throw protocolError(`content for ${m.name} on channel ${ch.id}, which a broker never sends`);
};

const delivery = (msg) => ({ message: msg.body, deliveryTag: msg.deliveryTag, redelivered: msg.redelivered, exchange: msg.exchange, routingKey: msg.routingKey, consumerTag: msg.consumerTag, messageCount: msg.messageCount, properties: msg.properties, headers: msg.properties.headers ?? {} });

function delivered(ch, msg) {
  const consumer = ch.consumers.get(msg.consumerTag);
  if (!consumer) throw protocolError(`a delivery for consumer ${msg.consumerTag}, which channel ${ch.id} does not have`);
  tell(consumer, () => consumer.onMessage(delivery(msg)));
}

// A mandatory message nothing routed comes back BEFORE its confirm (RabbitMQ
// sends basic.return, then basic.ack), so it is marked on the pending publish
// and the ack that follows resolves it as `returned`. The message id finds it;
// without one, the oldest unreturned publish to the same exchange and key.
function returned(ch, msg) {
  const entry = [...ch.pending.values()].find((e) => !e.returned && matchesReturn(e, msg));
  if (entry) entry.returned = { replyCode: msg.replyCode, replyText: msg.replyText };
}

const matchesReturn = (e, msg) => (msg.properties.messageId ? e.messageId === msg.properties.messageId : e.exchange === msg.exchange && e.routingKey === msg.routingKey);

function confirmed(ch, a, outcome) {
  const tags = [...ch.pending.keys()].filter((t) => (a.multiple ? t <= a.deliveryTag : t === a.deliveryTag));
  tags.forEach((t) => settleConfirm(ch, t, outcome));
}

function settleConfirm(ch, tag, outcome) {
  const e = ch.pending.get(tag);
  ch.pending.delete(tag);
  e.resolve({ outcome: e.returned && outcome === "ack" ? "returned" : outcome, deliveryTag: tag, ...(e.returned ?? {}) });
}

// ── What a channel offers ──────────────────────────────────────────────────

function publish(ch, msg = {}) {
  const closed = closedOf(ch);
  if (closed) return Promise.reject(closed);
  const settled = ch.confirm ? awaitConfirm(ch, ch.nextSeq++, msg) : Promise.resolve({ outcome: "unconfirmed", deliveryTag: null });
  write(ch.conn, publishFrames(ch, msg));
  return settled;
}

const awaitConfirm = (ch, tag, msg) => new Promise((resolve, reject) => void ch.pending.set(tag, { resolve, reject, exchange: msg.exchange ?? "", routingKey: msg.routingKey ?? "", messageId: msg.properties?.messageId ?? null, returned: null }));

const BODIES = [
  { when: (b) => Buffer.isBuffer(b), as: (b) => b },
  { when: (b) => b === undefined || b === null, as: () => Buffer.alloc(0) },
  { when: (b) => typeof b === "string", as: (b) => Buffer.from(b, "utf8") },
  { when: () => true, as: (b) => Buffer.from(JSON.stringify(b), "utf8") },
];

const bodyOf = (b) => BODIES.find((r) => r.when(b)).as(b);

// One write for the method, the header and every body frame: the frames of one
// message must never interleave with another's on the same channel.
const publishFrames = (ch, msg) => Buffer.concat([methodFrame(ch.id, "basic.publish", { exchange: msg.exchange ?? "", routingKey: msg.routingKey ?? "", mandatory: Boolean(msg.mandatory), immediate: false }), ...contentFrames(ch.id, bodyOf(msg.body), msg.properties ?? {}, ch.conn.tune.frameMax)]);

const gotten = (m) => (m.name === "basic.get-empty" ? { message: null } : delivery(m.message));

function send(ch, name, args) {
  const closed = closedOf(ch);
  if (closed) throw closed;
  write(ch.conn, methodFrame(ch.id, name, args));
}

// The consumer is registered BEFORE basic.consume is sent, under a tag this
// client chose: a delivery can arrive in the same chunk as consume-ok.
function consume(ch, c = {}) {
  const consumerTag = c.consumerTag ?? `orbit.${ch.id}.${(ch.tags += 1)}`;
  ch.consumers.set(consumerTag, { onMessage: c.onMessage ?? (() => {}), onCancel: c.onCancel, onError: c.onError });
  return call(ch, "basic.consume", { queue: c.queue, consumerTag, noAck: Boolean(c.noAck), exclusive: Boolean(c.exclusive), arguments: c.arguments }).then(() => ({ consumerTag }));
}

const closeChannel = (ch) => call(ch, "channel.close", CLIENT_CLOSE).then(() => retire(ch));
const exchangeArgs = (e) => ({ exchange: e.exchange ?? e.name, type: e.type ?? (e.passive ? "" : "topic"), passive: Boolean(e.passive), durable: Boolean(e.durable), autoDelete: Boolean(e.autoDelete), internal: Boolean(e.internal), arguments: e.arguments });
const queueArgs = (q) => ({ queue: q.queue ?? q.name ?? "", passive: Boolean(q.passive), durable: Boolean(q.durable), exclusive: Boolean(q.exclusive), autoDelete: Boolean(q.autoDelete), arguments: q.arguments });
const bindArgs = (b) => ({ queue: b.queue, exchange: b.exchange, routingKey: b.routingKey ?? "", arguments: b.arguments });
const nothing = () => undefined;

const OPS = {
  confirmSelect: (ch) => call(ch, "confirm.select", {}).then(() => void Object.assign(ch, { confirm: true, nextSeq: 1 })),
  publish: (ch, msg) => publish(ch, msg),
  get: (ch, g = {}) => call(ch, "basic.get", { queue: g.queue, noAck: Boolean(g.noAck) }).then(gotten),
  ack: (ch, deliveryTag, multiple = false) => send(ch, "basic.ack", { deliveryTag, multiple }),
  nack: (ch, deliveryTag, o = {}) => send(ch, "basic.nack", { deliveryTag, multiple: Boolean(o.multiple), requeue: o.requeue !== false }),
  reject: (ch, deliveryTag, requeue = true) => send(ch, "basic.reject", { deliveryTag, requeue }),
  qos: (ch, q = {}) => call(ch, "basic.qos", { prefetchSize: q.prefetchSize ?? 0, prefetchCount: q.prefetchCount ?? 0, global: Boolean(q.global) }).then(nothing),
  declareExchange: (ch, e = {}) => call(ch, "exchange.declare", exchangeArgs(e)).then(nothing),
  declareQueue: (ch, q = {}) => call(ch, "queue.declare", queueArgs(q)).then((m) => m.args),
  bindQueue: (ch, b = {}) => call(ch, "queue.bind", bindArgs(b)).then(nothing),
  unbindQueue: (ch, b = {}) => call(ch, "queue.unbind", bindArgs(b)).then(nothing),
  deleteQueue: (ch, d = {}) => call(ch, "queue.delete", { queue: d.queue ?? d.name, ifUnused: Boolean(d.ifUnused), ifEmpty: Boolean(d.ifEmpty) }).then((m) => m.args),
  consume: (ch, c) => consume(ch, c),
  cancel: (ch, consumerTag) => call(ch, "basic.cancel", { consumerTag }).then(() => void ch.consumers.delete(consumerTag)),
  close: (ch) => closeChannel(ch),
};
