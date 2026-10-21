// A scripted AMQP 0-9-1 broker in memory: the server side of the handshake,
// channels, exchanges, queues with bindings, publisher confirms, get, ack,
// nack/reject with requeue, consume. No network -- `socket` is the factory the
// client takes, and every byte the peer answers arrives a tick later, as a
// socket's would.
//
// The script decides what a real broker would have decided:
//   heartbeat, frameMax     what connection.tune proposes
//   onPublish(msg, seq)     "ack" | "nack" | "return" | "drop" (no confirm, ever)
//                           | "close" (the broker forces the connection shut);
//                           undefined means route it: "return" for a mandatory
//                           message nothing took, "ack" otherwise
//   hold                    method names the peer never answers
//   mute                    never answer the protocol header at all
// and the test can act as the broker mid-conversation: closeConnection,
// closeChannel, silence (stop sending, heartbeats included), raw (any bytes).
import { EventEmitter } from "node:events";
import { decodeHeader } from "../../skills/orbit-backend-test/amqp/content.mjs";
import { decodeMethod } from "../../skills/orbit-backend-test/amqp/methods.mjs";
import { contentFrames, createParser, heartbeatFrame, methodFrame } from "../../skills/orbit-backend-test/amqp/wire.mjs";

export function fakeAmqpPeer(script = {}) {
  const peer = { script, socket: null, parser: null, greeted: null, start: null, credentials: null, tuneOk: null, vhost: null, heartbeats: 0, silent: false, exchanges: new Set(script.exchanges ?? ["", "amq.topic", "amq.direct"]), queues: new Map(), bindings: [], channels: new Map(), received: [], published: [], acks: [], nacks: [], rejects: [], generated: 0 };
  return {
    peer,
    socket: () => attach(peer),
    closeConnection: (replyCode = 320, replyText = "CONNECTION_FORCED - broker forced connection closure with reason 'shutdown'") => toClient(peer, methodFrame(0, "connection.close", { replyCode, replyText, classId: 0, methodId: 0 })),
    closeChannel: (id, replyCode = 406, replyText = "PRECONDITION_FAILED") => toClient(peer, methodFrame(id, "channel.close", { replyCode, replyText, classId: 0, methodId: 0 })),
    silence: () => void (peer.silent = true),
    raw: (bytes) => toClient(peer, bytes),
  };
}

function attach(peer) {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.write = (buf) => (socket.destroyed ? false : fromClient(peer, buf));
  socket.end = () => shut(socket);
  socket.destroy = () => shut(socket);
  peer.socket = socket;
  setImmediate(() => socket.emit("connect"));
  return socket;
}

function shut(socket) {
  if (socket.destroyed) return;
  socket.destroyed = true;
  setImmediate(() => socket.emit("close"));
}

function toClient(peer, bytes) {
  if (peer.silent || peer.socket.destroyed) return;
  setImmediate(() => peer.socket.destroyed || peer.socket.emit("data", bytes));
}

function fromClient(peer, buf) {
  if (peer.greeted) return peer.parser.push(buf) ?? true;
  peer.greeted = Buffer.from(buf.subarray(0, 8));
  peer.parser = createParser((f) => onFrame(peer, f));
  if (!peer.script.mute) toClient(peer, methodFrame(0, "connection.start", { versionMajor: 0, versionMinor: 9, serverProperties: { product: "fake-broker", capabilities: { publisher_confirms: true, "basic.nack": true, consumer_cancel_notify: true } }, mechanisms: "PLAIN AMQPLAIN", locales: "en_US" }));
  if (buf.length > 8) peer.parser.push(buf.subarray(8));
  return true;
}

function onFrame(peer, f) {
  if (f.kind === "heartbeat") return heartbeat(peer);
  if (f.kind === "method") return onMethod(peer, f.channel, decodeMethod(f.payload));
  const ch = peer.channels.get(f.channel);
  if (f.kind === "header") ch.publishing.header = decodeHeader(f.payload);
  if (f.kind === "body") ch.publishing.chunks.push(f.payload);
  if (ch.publishing.header && Buffer.concat(ch.publishing.chunks).length >= ch.publishing.header.bodySize) published(peer, f.channel, ch);
}

function heartbeat(peer) {
  peer.heartbeats += 1;
  toClient(peer, heartbeatFrame());
}

function onMethod(peer, id, m) {
  peer.received.push({ channel: id, name: m.name, args: m.args });
  if ((peer.script.hold ?? []).includes(m.name)) return;
  const handle = HANDLERS[m.name];
  if (handle) handle(peer, id, m.args);
}

const ok = (peer, id, name, args = {}) => toClient(peer, methodFrame(id, name, args));
const closeChannelFor = (peer, id, replyCode, replyText, classId, methodId) => ok(peer, id, "channel.close", { replyCode, replyText, classId, methodId });

const HANDLERS = {
  "connection.start-ok": (peer, id, a) => {
    peer.start = a;
    peer.credentials = a.response;
    ok(peer, 0, "connection.tune", { channelMax: 2047, frameMax: peer.script.frameMax ?? 131072, heartbeat: peer.script.heartbeat ?? 0 });
  },
  "connection.tune-ok": (peer, id, a) => void (peer.tuneOk = a),
  "connection.open": (peer, id, a) => {
    peer.vhost = a.virtualHost;
    ok(peer, 0, "connection.open-ok", { knownHosts: "" });
  },
  "connection.close": (peer) => {
    ok(peer, 0, "connection.close-ok");
    setImmediate(() => shut(peer.socket));
  },
  "connection.close-ok": (peer) => setImmediate(() => shut(peer.socket)),
  "channel.open": (peer, id) => {
    peer.channels.set(id, { confirm: false, seq: 0, deliveryTag: 0, unacked: new Map(), publishing: null, consumers: new Map() });
    ok(peer, id, "channel.open-ok", { channelId: "" });
  },
  "channel.close": (peer, id) => {
    peer.channels.delete(id);
    ok(peer, id, "channel.close-ok");
  },
  "channel.close-ok": (peer, id) => peer.channels.delete(id),
  "confirm.select": (peer, id) => {
    peer.channels.get(id).confirm = true;
    ok(peer, id, "confirm.select-ok");
  },
  "exchange.declare": (peer, id, a) => {
    if (a.passive && !peer.exchanges.has(a.exchange)) return closeChannelFor(peer, id, 404, `NOT_FOUND - no exchange '${a.exchange}' in vhost '${peer.vhost}'`, 40, 10);
    peer.exchanges.add(a.exchange);
    ok(peer, id, "exchange.declare-ok");
  },
  "queue.declare": (peer, id, a) => {
    if (a.passive && !peer.queues.has(a.queue)) return closeChannelFor(peer, id, 404, `NOT_FOUND - no queue '${a.queue}' in vhost '${peer.vhost}'`, 50, 10);
    const name = a.queue || `amq.gen-${(peer.generated += 1)}`;
    if (!peer.queues.has(name)) peer.queues.set(name, { name, args: a, messages: [] });
    ok(peer, id, "queue.declare-ok", { queue: name, messageCount: peer.queues.get(name).messages.length, consumerCount: 0 });
  },
  "queue.bind": (peer, id, a) => {
    peer.bindings.push({ queue: a.queue, exchange: a.exchange, routingKey: a.routingKey });
    ok(peer, id, "queue.bind-ok");
  },
  "queue.unbind": (peer, id, a) => {
    peer.bindings = peer.bindings.filter((b) => !(b.queue === a.queue && b.exchange === a.exchange && b.routingKey === a.routingKey));
    ok(peer, id, "queue.unbind-ok");
  },
  "queue.delete": (peer, id, a) => {
    const q = peer.queues.get(a.queue);
    peer.queues.delete(a.queue);
    ok(peer, id, "queue.delete-ok", { messageCount: q?.messages.length ?? 0 });
  },
  "basic.qos": (peer, id) => ok(peer, id, "basic.qos-ok"),
  "basic.publish": (peer, id, a) => void (peer.channels.get(id).publishing = { args: a, header: null, chunks: [] }),
  "basic.get": (peer, id, a) => get(peer, id, a),
  "basic.ack": (peer, id, a) => settleFromClient(peer, id, a, "acks", false),
  "basic.nack": (peer, id, a) => settleFromClient(peer, id, a, "nacks", a.requeue),
  "basic.reject": (peer, id, a) => settleFromClient(peer, id, a, "rejects", a.requeue),
  "basic.consume": (peer, id, a) => consume(peer, id, a),
  "basic.cancel": (peer, id, a) => {
    peer.channels.get(id).consumers.delete(a.consumerTag);
    ok(peer, id, "basic.cancel-ok", { consumerTag: a.consumerTag });
  },
};

// The default exchange routes by queue name; any other routes by its bindings,
// a binding key of "#" taking everything.
function routes(peer, exchange, routingKey) {
  if (exchange === "") return peer.queues.has(routingKey) ? [routingKey] : [];
  return peer.bindings.filter((b) => b.exchange === exchange && (b.routingKey === routingKey || b.routingKey === "#")).map((b) => b.queue);
}

function published(peer, id, ch) {
  const p = ch.publishing;
  ch.publishing = null;
  const msg = { exchange: p.args.exchange, routingKey: p.args.routingKey, mandatory: p.args.mandatory, properties: p.header.properties, body: Buffer.concat(p.chunks), redelivered: false };
  peer.published.push(msg);
  const queues = routes(peer, msg.exchange, msg.routingKey);
  const seq = ch.confirm ? (ch.seq += 1) : null;
  const outcome = peer.script.onPublish?.(msg, seq) ?? (msg.mandatory && !queues.length ? "return" : "ack");
  if (outcome === "ack" || outcome === "return") queues.forEach((q) => peer.queues.get(q).messages.push({ ...msg }));
  OUTCOMES[outcome](peer, id, ch, msg, seq);
  deliverWaiting(peer, id, ch);
}

const OUTCOMES = {
  ack: (peer, id, ch, msg, seq) => seq && ok(peer, id, "basic.ack", { deliveryTag: seq, multiple: false }),
  nack: (peer, id, ch, msg, seq) => seq && ok(peer, id, "basic.nack", { deliveryTag: seq, multiple: false, requeue: false }),
  return: (peer, id, ch, msg, seq) => {
    toClient(peer, Buffer.concat([methodFrame(id, "basic.return", { replyCode: 312, replyText: "NO_ROUTE", exchange: msg.exchange, routingKey: msg.routingKey }), ...contentFrames(id, msg.body, msg.properties, 131072)]));
    if (seq) ok(peer, id, "basic.ack", { deliveryTag: seq, multiple: false });
  },
  drop: () => undefined,
  close: (peer) => toClient(peer, methodFrame(0, "connection.close", { replyCode: 320, replyText: "CONNECTION_FORCED - broker forced connection closure with reason 'shutdown'", classId: 0, methodId: 0 })),
};

function get(peer, id, a) {
  const q = peer.queues.get(a.queue);
  if (!q) return closeChannelFor(peer, id, 404, `NOT_FOUND - no queue '${a.queue}' in vhost '${peer.vhost}'`, 60, 70);
  if (!q.messages.length) return ok(peer, id, "basic.get-empty", { clusterId: "" });
  const msg = q.messages.shift();
  const ch = peer.channels.get(id);
  const deliveryTag = (ch.deliveryTag += 1);
  if (!a.noAck) ch.unacked.set(deliveryTag, { queue: a.queue, msg });
  toClient(peer, Buffer.concat([methodFrame(id, "basic.get-ok", { deliveryTag, redelivered: msg.redelivered, exchange: msg.exchange, routingKey: msg.routingKey, messageCount: q.messages.length }), ...contentFrames(id, msg.body, msg.properties, 131072)]));
}

// A nack or reject that asks for a requeue puts the message back at the head
// of its queue, marked redelivered -- what a broker does.
function settleFromClient(peer, id, a, list, requeue) {
  peer[list].push({ channel: id, ...a });
  const ch = peer.channels.get(id);
  const tags = [...ch.unacked.keys()].filter((t) => (a.multiple ? t <= a.deliveryTag : t === a.deliveryTag));
  tags.forEach((t) => requeued(peer, ch, t, requeue));
}

function requeued(peer, ch, tag, requeue) {
  const held = ch.unacked.get(tag);
  ch.unacked.delete(tag);
  if (requeue && peer.queues.has(held.queue)) peer.queues.get(held.queue).messages.unshift({ ...held.msg, redelivered: true });
}

function consume(peer, id, a) {
  peer.channels.get(id).consumers.set(a.consumerTag, { queue: a.queue, noAck: a.noAck });
  ok(peer, id, "basic.consume-ok", { consumerTag: a.consumerTag });
  deliverWaiting(peer, id, peer.channels.get(id));
}

function deliverWaiting(peer, id, ch) {
  ch.consumers.forEach((c, consumerTag) => {
    const q = peer.queues.get(c.queue);
    while (q?.messages.length) deliver(peer, id, ch, consumerTag, c, q);
  });
}

function deliver(peer, id, ch, consumerTag, c, q) {
  const msg = q.messages.shift();
  const deliveryTag = (ch.deliveryTag += 1);
  if (!c.noAck) ch.unacked.set(deliveryTag, { queue: q.name, msg });
  toClient(peer, Buffer.concat([methodFrame(id, "basic.deliver", { consumerTag, deliveryTag, redelivered: msg.redelivered, exchange: msg.exchange, routingKey: msg.routingKey }), ...contentFrames(id, msg.body, msg.properties, 131072)]));
}

// A clock a test moves by hand: timers fire in order of when they are due,
// intervals again and again, and nothing fires that the test did not reach.
export function fakeTimers() {
  const state = { now: 0, id: 0, timers: new Map() };
  const add = (fn, ms, every) => {
    state.id += 1;
    state.timers.set(state.id, { id: state.id, at: state.now + ms, fn, every });
    return state.id;
  };
  return {
    now: () => state.now,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearTimeout: (id) => void state.timers.delete(id),
    clearInterval: (id) => void state.timers.delete(id),
    pending: () => state.timers.size,
    advance: (ms) => advance(state, state.now + ms),
  };
}

function advance(state, end) {
  for (let due = firstDue(state, end); due; due = firstDue(state, end)) {
    state.now = due.at;
    if (due.every) due.at += due.every;
    if (!due.every) state.timers.delete(due.id);
    due.fn();
  }
  state.now = end;
}

const firstDue = (state, end) => [...state.timers.values()].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0] ?? null;
