// An in-memory NATS server with enough JetStream to hold the client to the protocol. It reads the
// client's bytes with the same parser tables the client ships (CLIENT_OPS), routes by subject with
// `*` and `>`, keeps streams with a duplicate window, and keeps pull consumers with acks, naks,
// terms and redelivery -- and it builds and reads its own $JS.ACK subjects, so the client's
// parsing of them is checked against something it did not write.
//
//   const peer = fakeNatsPeer({ auth, deny, jetstream, dropPubAcks, maxPayload, ackDomain });
//   const conn = await connect({ socket: peer.socket, timers });
//
// Several clients may attach to one peer -- an "application" and a test, each its own connection
// -- and every JetStream API call is recorded with the connection that asked, so a test can say
// what was NEVER asked: no purge, no consumer made for an observation. A client's writes are read
// at once; what the server says reaches the client on a later turn (setImmediate), as from a
// socket.
import { EventEmitter } from "node:events";
import { CLIENT_OPS, createParser, encodeHeaders, errOp, infoOp, msgOp, pongOp } from "../../skills/orbit-backend-test/jetstream/protocol.mjs";

const EPOCH_MS = Date.UTC(2026, 0, 1);
const DEFAULT_DUPLICATE_WINDOW_NS = 120e9;

export function fakeNatsPeer(script = {}) {
  const server = { script, conns: [], streams: new Map(), consumers: new Map(), calls: [], acks: [], ackSubjects: new Map(), responders: new Map(), parseErrors: [], silent: false, nowMs: EPOCH_MS, nextClient: 1, nextEphemeral: 1 };
  return {
    server,
    socket: () => attach(server),
    calls: () => server.calls,
    acks: () => server.acks,
    // A responder answers a core request: what it returns is the reply's body (undefined: none).
    respond: (subject, fn) => void server.responders.set(subject, fn),
    // As if the application published: kept by a stream that captures it, seen by subscribers.
    publish: (subject, data, headers) => published(server, null, { subject, reply: null, headers: headers ?? null, data: Buffer.from(data ?? "") }),
    err: (text, at = -1) => toClient(server, server.conns.at(at), errOp(text)),
    raw: (bytes, at = -1) => toClient(server, server.conns.at(at), Buffer.from(bytes)),
    closeConnection: (at = -1) => hangUp(server.conns.at(at)),
    silence: () => void (server.silent = true),
    advance: (ms) => void (server.nowMs += ms),
    expirePulls: () => expirePulls(server),
  };
}

// ── the socket ─────────────────────────────────────────────────────────────

function attach(server) {
  const socket = new EventEmitter();
  const conn = { id: server.nextClient++, socket, subs: new Map(), options: null, refused: false, ops: [] };
  conn.parser = createParser((op) => onOp(server, conn, op), CLIENT_OPS);
  Object.assign(socket, { destroyed: false, written: [], write: (buf) => wrote(server, conn, buf), end: () => ended(conn), destroy: () => ended(conn) });
  server.conns.push(conn);
  setImmediate(() => toClient(server, conn, infoOp(infoOf(server, conn))));
  return socket;
}

function wrote(server, conn, buf) {
  conn.socket.written.push(Buffer.from(buf));
  if (!conn.refused && !conn.socket.destroyed) parsedOrHungUp(server, conn, buf);
  return true;
}

// What the client wrote that the protocol cannot read is answered the way a server does: an -ERR
// and a closed connection. A fault of the fake's own is thrown, never dressed up as the client's.
function parsedOrHungUp(server, conn, buf) {
  try {
    conn.parser.push(Buffer.from(buf));
  } catch (e) {
    if (e?.name !== "NatsError") throw e;
    server.parseErrors.push(e);
    toClient(server, conn, errOp("Unknown Protocol Operation"));
    hangUp(conn);
  }
}

function toClient(server, conn, buf) {
  if (!conn || server.silent || conn.socket.destroyed) return;
  setImmediate(() => {
    if (!conn.socket.destroyed) conn.socket.emit("data", buf);
  });
}

// The client's end is at once; the server's comes after what it had already said.
function ended(conn) {
  if (conn.socket.destroyed) return;
  conn.socket.destroyed = true;
  setImmediate(() => conn.socket.emit("close"));
}

const hangUp = (conn) => conn && setImmediate(() => ended(conn));

const infoOf = (server, conn) => ({ server_id: "NFAKE", server_name: "fake", version: "2.10.0", proto: 1, go: "fake", host: "127.0.0.1", port: 4222, headers: true, max_payload: server.script.maxPayload ?? 1048576, jetstream: server.script.jetstream !== false, client_id: conn.id, auth_required: Boolean(server.script.auth) });

// ── what a client says ─────────────────────────────────────────────────────

const CLIENT = {
  CONNECT: (server, conn, op) => connected(server, conn, op.options),
  PING: (server, conn) => toClient(server, conn, pongOp()),
  PONG: () => {},
  SUB: (server, conn, op) => void conn.subs.set(op.sid, { subject: op.subject, queue: op.queue, sid: op.sid }),
  UNSUB: (server, conn, op) => void conn.subs.delete(op.sid),
  PUB: (server, conn, op) => published(server, conn, op),
  HPUB: (server, conn, op) => published(server, conn, op),
};

function onOp(server, conn, op) {
  conn.ops.push(op);
  if (!conn.refused) CLIENT[op.op](server, conn, op);
}

function connected(server, conn, options) {
  conn.options = options;
  if (authorized(server.script.auth, options)) return;
  conn.refused = true;
  toClient(server, conn, errOp("Authorization Violation"));
  hangUp(conn);
}

const authorized = (auth, o) => !auth || (auth.token ? o.auth_token === auth.token : o.user === auth.user && o.pass === auth.pass);

function published(server, conn, m) {
  if ((server.script.deny ?? []).some((p) => matches(p, m.subject))) return toClient(server, conn, errOp(`Permissions Violation for Publish to "${m.subject}"`));
  if (m.subject.startsWith("$JS.API.") && server.script.jetstream !== false) return jsApi(server, conn, m);
  if (m.subject.startsWith("$JS.ACK.")) return jsAck(server, m);
  const kept = intoStream(server, m);
  deliverCore(server, conn, m, kept);
}

// Core delivery: every matching subscription, one member of each queue group, then a scripted
// responder. Nothing at all -- no subscriber, no stream, no responder -- is a 503 to a requester
// that asked for no-responders.
function deliverCore(server, conn, m, kept) {
  const targets = subscribersOf(server, m.subject);
  targets.forEach(([c, sub]) => toClient(server, c, msgOp(m.subject, sub.sid, m.data, { reply: m.reply ?? undefined, headers: m.headers ?? undefined })));
  const fn = server.responders.get(m.subject);
  const answer = fn ? fn(m) : undefined;
  if (answer !== undefined && m.reply) replyTo(server, m.reply, answer);
  if (!targets.length && !kept && !fn && m.reply && conn?.options?.no_responders) statusTo(server, m.reply, 503, "");
}

function subscribersOf(server, subject) {
  const all = server.conns.filter((c) => !c.socket.destroyed && !c.refused).flatMap((c) => [...c.subs.values()].filter((s) => matches(s.subject, subject)).map((s) => [c, s]));
  const groups = new Set();
  return all.filter(([, s]) => !s.queue || (!groups.has(s.queue) && groups.add(s.queue)));
}

const replyTo = (server, reply, body, headers) => subscribersOf(server, reply).forEach(([c, s]) => toClient(server, c, msgOp(reply, s.sid, body, { headers })));
const statusTo = (server, reply, code, description) => subscribersOf(server, reply).forEach(([c, s]) => toClient(server, c, msgOp(reply, s.sid, "", { status: { code, description } })));

export function matches(pattern, subject) {
  const p = pattern.split(".");
  const s = subject.split(".");
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === ">") return s.length > i;
    if (i >= s.length || (p[i] !== "*" && p[i] !== s[i])) return false;
  }
  return p.length === s.length;
}

// ── streams ────────────────────────────────────────────────────────────────

const header = (headers, key) => [headers?.[key]].flat()[0];
const windowMs = (stream) => (stream.config.duplicate_window || DEFAULT_DUPLICATE_WINDOW_NS) / 1e6;
const streamFor = (server, subject) => [...server.streams.values()].find((s) => s.config.subjects.some((p) => matches(p, subject)));

function intoStream(server, m) {
  const stream = streamFor(server, m.subject);
  if (!stream) return false;
  const answer = kept(server, stream, m);
  if (m.reply && !server.script.dropPubAcks) replyTo(server, m.reply, JSON.stringify(answer));
  return true;
}

function kept(server, stream, m) {
  const msgId = header(m.headers, "Nats-Msg-Id");
  const expected = header(m.headers, "Nats-Expected-Last-Sequence");
  if (expected !== undefined && Number(expected) !== stream.lastSeq) return apiErr(400, 10071, `wrong last sequence: ${stream.lastSeq}`);
  const expectedStream = header(m.headers, "Nats-Expected-Stream");
  if (expectedStream !== undefined && expectedStream !== stream.config.name) return apiErr(400, 10060, "expected stream does not match");
  const prior = msgId ? stream.dedupe.get(msgId) : null;
  if (prior && server.nowMs - prior.atMs < windowMs(stream)) return { stream: stream.config.name, seq: prior.seq, duplicate: true };
  stream.lastSeq += 1;
  stream.messages.push({ seq: stream.lastSeq, subject: m.subject, headers: m.headers ?? null, data: Buffer.from(m.data), time: new Date(server.nowMs).toISOString() });
  if (msgId) stream.dedupe.set(msgId, { seq: stream.lastSeq, atMs: server.nowMs });
  while (stream.config.max_msgs > 0 && stream.messages.length > stream.config.max_msgs) stream.messages.shift();
  [...server.consumers.values()].filter((c) => c.stream === stream.config.name).forEach((c) => serveWaiting(server, c));
  return { stream: stream.config.name, seq: stream.lastSeq };
}

// ── the JetStream API ──────────────────────────────────────────────────────

const apiErr = (code, err_code, description) => ({ error: { code, err_code, description } });

const API = [
  { verb: ["STREAM", "MSG", "GET"], go: msgGet },
  { verb: ["STREAM", "CREATE"], go: streamCreate },
  { verb: ["STREAM", "INFO"], go: streamInfo },
  { verb: ["STREAM", "DELETE"], go: streamDelete },
  { verb: ["CONSUMER", "MSG", "NEXT"], go: msgNext },
  { verb: ["CONSUMER", "CREATE"], go: consumerCreate },
  { verb: ["CONSUMER", "INFO"], go: consumerInfo },
  { verb: ["CONSUMER", "DELETE"], go: consumerDelete },
];

function jsApi(server, conn, m) {
  const tokens = m.subject.split(".").slice(2);
  const row = API.find((r) => r.verb.every((t, i) => tokens[i] === t));
  const at = row ? row.verb.length : 2;
  const body = bodyOf(m.data);
  server.calls.push({ conn: conn?.id ?? null, verb: tokens.slice(0, at).join("."), args: tokens.slice(at), body });
  const answer = body === undefined ? apiErr(400, 10025, "invalid JSON") : row ? row.go(server, tokens.slice(at), body, m) : apiErr(400, 10003, `the fake does not emulate ${tokens.join(".")}`);
  if (answer !== undefined && m.reply) replyTo(server, m.reply, JSON.stringify(answer));
}

function bodyOf(data) {
  try {
    return data.length ? JSON.parse(data.toString("utf8")) : {};
  } catch {
    return undefined;
  }
}

const streamState = (server, stream) => ({ messages: stream.messages.length, bytes: stream.messages.reduce((n, x) => n + x.data.length, 0), first_seq: stream.messages[0]?.seq ?? stream.lastSeq + 1, last_seq: stream.lastSeq, consumer_count: [...server.consumers.values()].filter((c) => c.stream === stream.config.name).length });
const streamInfoOf = (server, stream) => ({ type: "io.nats.jetstream.api.v1.stream_info_response", config: stream.config, created: stream.created, state: streamState(server, stream) });

function streamCreate(server, [name], body) {
  const existing = server.streams.get(name);
  if (existing) return existing.asked === JSON.stringify(body) ? streamInfoOf(server, existing) : apiErr(400, 10058, "stream name already in use with a different configuration");
  const stream = { asked: JSON.stringify(body), config: { retention: "limits", storage: "file", duplicate_window: DEFAULT_DUPLICATE_WINDOW_NS, max_msgs: -1, ...body, name, subjects: body.subjects?.length ? body.subjects : [name] }, created: new Date(server.nowMs).toISOString(), messages: [], lastSeq: 0, dedupe: new Map() };
  server.streams.set(name, stream);
  return { ...streamInfoOf(server, stream), type: "io.nats.jetstream.api.v1.stream_create_response" };
}

function streamInfo(server, [name]) {
  const stream = server.streams.get(name);
  return stream ? streamInfoOf(server, stream) : apiErr(404, 10059, "stream not found");
}

function streamDelete(server, [name]) {
  if (!server.streams.delete(name)) return apiErr(404, 10059, "stream not found");
  [...server.consumers.keys()].filter((key) => key.startsWith(`${name}/`)).forEach((key) => server.consumers.delete(key));
  return { type: "io.nats.jetstream.api.v1.stream_delete_response", success: true };
}

function msgGet(server, [name], body) {
  const stream = server.streams.get(name);
  if (!stream) return apiErr(404, 10059, "stream not found");
  const found = body.next_by_subj ? stream.messages.find((x) => x.seq >= (body.seq ?? 0) && matches(body.next_by_subj, x.subject)) : stream.messages.find((x) => x.seq === body.seq);
  if (!found) return apiErr(404, 10037, "no message found");
  return { type: "io.nats.jetstream.api.v1.stream_msg_get_response", message: { subject: found.subject, seq: found.seq, ...(found.headers ? { hdrs: encodeHeaders(found.headers).toString("base64") } : {}), ...(found.data.length ? { data: found.data.toString("base64") } : {}), time: found.time } };
}

// ── consumers ──────────────────────────────────────────────────────────────

const STARTS = {
  all: (stream) => stream.messages[0]?.seq ?? stream.lastSeq + 1,
  by_start_sequence: (stream, config) => config.opt_start_seq,
  new: (stream) => stream.lastSeq + 1,
  last: (stream) => Math.max(stream.lastSeq, 1),
};

function consumerCreate(server, [streamName, named], body) {
  const stream = server.streams.get(streamName);
  if (!stream) return apiErr(404, 10059, "stream not found");
  const asked = body.config ?? {};
  const name = asked.name ?? asked.durable_name ?? named ?? `eph${server.nextEphemeral++}`;
  const existing = server.consumers.get(`${streamName}/${name}`);
  if (existing) return existing.asked === JSON.stringify(asked) ? consumerInfoOf(server, existing) : apiErr(400, 10148, "consumer already exists");
  const config = { deliver_policy: "all", ack_policy: "explicit", ack_wait: 30e9, max_deliver: -1, ...asked, name };
  if (!STARTS[config.deliver_policy]) return apiErr(400, 10003, `the fake does not emulate deliver_policy ${config.deliver_policy}`);
  const c = { stream: streamName, name, config, asked: JSON.stringify(asked), created: new Date(server.nowMs).toISOString(), next: STARTS[config.deliver_policy](stream, config), cseq: 0, counts: new Map(), cseqOf: new Map(), pending: new Map(), redeliver: [], delayed: [], acked: new Set(), terminated: new Set(), waiting: [], delivered: { consumer_seq: 0, stream_seq: 0 } };
  server.consumers.set(`${streamName}/${name}`, c);
  return { ...consumerInfoOf(server, c), type: "io.nats.jetstream.api.v1.consumer_create_response" };
}

function consumerInfo(server, [streamName, name]) {
  const c = server.consumers.get(`${streamName}/${name}`);
  return c ? consumerInfoOf(server, c) : apiErr(404, 10014, "consumer not found");
}

function consumerDelete(server, [streamName, name]) {
  if (!server.consumers.delete(`${streamName}/${name}`)) return apiErr(404, 10014, "consumer not found");
  return { type: "io.nats.jetstream.api.v1.consumer_delete_response", success: true };
}

function filtered(c, subject) {
  const filters = [c.config.filter_subject, ...(c.config.filter_subjects ?? [])].filter(Boolean);
  return !filters.length || filters.some((p) => matches(p, subject));
}
const pendingOf = (server, c) => (server.streams.get(c.stream)?.messages ?? []).filter((x) => x.seq >= c.next && filtered(c, x.subject)).length;

function ackFloorOf(c) {
  const done = (seq) => c.acked.has(seq) || c.terminated.has(seq);
  const delivered = [...c.counts.keys()].sort((a, b) => a - b);
  const open = delivered.find((seq) => !done(seq));
  const floor = open === undefined ? (delivered.at(-1) ?? 0) : Math.max(0, ...delivered.filter((seq) => seq < open));
  return { consumer_seq: c.cseqOf.get(floor) ?? 0, stream_seq: floor };
}

const consumerInfoOf = (server, c) => ({ type: "io.nats.jetstream.api.v1.consumer_info_response", stream_name: c.stream, name: c.name, config: c.config, created: c.created, delivered: { ...c.delivered }, ack_floor: ackFloorOf(c), num_ack_pending: c.pending.size, num_redelivered: [...c.pending.values()].filter((p) => p.count > 1).length, num_waiting: c.waiting.length, num_pending: pendingOf(server, c) });

// A pull is answered with what there is; a no_wait pull short of its batch then ends with a 404,
// as nats-server 2.15 answers one (some older servers said 408 after a partial batch; the client
// ends on either). Any other pull WAITS, for a later message or for expirePulls(). A pull on a
// consumer that does not exist has nobody to answer it: 503.
function msgNext(server, [streamName, name], body, m) {
  const c = server.consumers.get(`${streamName}/${name}`);
  if (!c) return void statusTo(server, m.reply, 503, "");
  const req = { reply: m.reply, batch: body.batch ?? 1, noWait: body.no_wait === true, delivered: 0 };
  serve(server, c, req);
  if (req.delivered >= req.batch) return undefined;
  if (req.noWait) return void statusTo(server, req.reply, 404, "No Messages");
  c.waiting.push(req);
  return undefined;
}

function serve(server, c, req) {
  while (req.delivered < req.batch) {
    const msg = nextFor(server, c);
    if (!msg) return;
    deliverTo(server, c, req, msg);
  }
}

// Redeliveries first, then what the consumer has not delivered yet.
function nextFor(server, c) {
  const stream = server.streams.get(c.stream);
  while (c.redeliver.length) {
    const seq = c.redeliver.shift();
    const msg = stream.messages.find((x) => x.seq === seq);
    if (msg && !c.acked.has(seq) && !c.terminated.has(seq)) return msg;
  }
  const msg = stream.messages.find((x) => x.seq >= c.next && filtered(c, x.subject));
  if (msg) c.next = msg.seq + 1;
  return msg ?? null;
}

// A delivery goes to the subscription of the pull's reply subject, under the subject the message
// was PUBLISHED to, with the $JS.ACK subject as its reply.
function deliverTo(server, c, req, msg) {
  const count = (c.counts.get(msg.seq) ?? 0) + 1;
  c.counts.set(msg.seq, count);
  c.cseq += 1;
  c.cseqOf.set(msg.seq, c.cseq);
  c.pending.set(msg.seq, { cseq: c.cseq, count });
  c.delivered = { consumer_seq: c.cseq, stream_seq: Math.max(c.delivered.stream_seq, msg.seq) };
  req.delivered += 1;
  const ack = ackSubject(server, c, count, msg);
  server.ackSubjects.set(ack, { stream: c.stream, consumer: c.name, seq: msg.seq });
  subscribersOf(server, req.reply).forEach(([conn, sub]) => toClient(server, conn, msgOp(msg.subject, sub.sid, msg.data, { reply: ack, headers: msg.headers ?? undefined })));
}

function ackSubject(server, c, count, msg) {
  const tail = `${c.stream}.${c.name}.${count}.${msg.seq}.${c.cseq}.${BigInt(server.nowMs) * 1_000_000n}.${pendingOf(server, c)}`;
  return server.script.ackDomain ? `$JS.ACK.${server.script.ackDomain}.ACCHASH.${tail}.r${c.cseq}` : `$JS.ACK.${tail}`;
}

function serveWaiting(server, c) {
  while (c.waiting.length) {
    const req = c.waiting[0];
    if (subscribersOf(server, req.reply).length) serve(server, c, req);
    if (subscribersOf(server, req.reply).length && req.delivered < req.batch) return;
    c.waiting.shift();
  }
}

function expirePulls(server) {
  for (const c of server.consumers.values()) c.waiting.splice(0).forEach((req) => statusTo(server, req.reply, 408, "Request Timeout"));
}

// ── acknowledgements ───────────────────────────────────────────────────────

const ACK_KINDS = [
  { when: (b) => b === "" || b === "+ACK", go: (server, c, seq) => void (c.pending.delete(seq), c.acked.add(seq)) },
  { when: (b) => b.startsWith("-NAK"), go: nakked },
  { when: (b) => b.startsWith("+TERM"), go: (server, c, seq) => void (c.pending.delete(seq), c.terminated.add(seq)) },
  { when: () => true, go: () => {} },
];

function jsAck(server, m) {
  const ref = server.ackSubjects.get(m.subject);
  const body = m.data.toString("utf8");
  server.acks.push({ subject: m.subject, body, stream: ref?.stream ?? null, consumer: ref?.consumer ?? null, seq: ref?.seq ?? null });
  const c = ref ? server.consumers.get(`${ref.stream}/${ref.consumer}`) : null;
  if (c) ACK_KINDS.find((r) => r.when(body)).go(server, c, ref.seq, body);
  if (m.reply) replyTo(server, m.reply, "");
}

// A nak puts the message back, after its delay if it named one (the fake never lets a delay pass),
// unless it has been delivered max_deliver times already.
function nakked(server, c, seq, body) {
  c.pending.delete(seq);
  const delay = body.length > 4 ? JSON.parse(body.slice(4)).delay : 0;
  if (c.config.max_deliver > 0 && (c.counts.get(seq) ?? 0) >= c.config.max_deliver) return;
  (delay > 0 ? c.delayed : c.redeliver).push(seq);
  serveWaiting(server, c);
}
