// A NATS client over one socket: the INFO/CONNECT handshake, publish, subscribe, request/reply
// over one wildcard inbox subscription, PING/PONG keepalive. The socket comes from a factory the
// caller may hand in (`socket`), and every clock from `timers`, so a test needs no network and no
// waiting.
//
// A message is routed by the SUBSCRIPTION it arrives on (its sid), never by its subject: JetStream
// delivers a fetched message under the subject it was published to, on the subscription of the
// inbox that asked for it. Replies to requests share one subscription, `_INBOX.<id>.*`, and are
// told apart by the last token; a collector -- a pull that takes many messages -- gets a
// subscription of its own on a subject that wildcard can never match, so nothing arrives twice.
//
// Every way this ends badly is a NatsError (errors.mjs). Whatever is still owed when the connection
// ends is settled with that end, and nothing is ever resent: a publication that wanted an ack
// becomes AMBIGUOUS one level up (jetstream.mjs), with its message id. A server's permissions
// violation is DENIED: the connection lives on, and what it names is the one refused.
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { NatsError, closedError, protocolError, refusedError, serverError, timeoutError, transportError } from "./errors.mjs";
import { SERVER_OPS, asBytes, checkedSubject, connectOp, createParser, pingOp, pongOp, pubOp, subOp, unsubOp } from "./protocol.mjs";

const DEFAULTS = { host: "127.0.0.1", port: 4222, timeoutMs: 10000, pingIntervalMs: 120000, maxPingsOut: 2, name: "orbit" };

const SYSTEM_TIMERS = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t), now: () => Date.now() };
const netSocket = (o) => createConnection({ host: o.host, port: o.port });

// The inbox subscription is the first one every connection makes.
const INBOX_SID = "1";

export function connect(options = {}) {
  const conn = stateOf({ ...DEFAULTS, ...options });
  return new Promise((resolve, reject) => open(conn, resolve, reject));
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const stateOf = (o) => ({ o, timers: o.timers ?? SYSTEM_TIMERS, socket: null, parser: null, info: null, inbox: `_INBOX.${o.inboxId ?? randomBytes(11).toString("hex")}`, sids: new Map(), nextSid: Number(INBOX_SID) + 1, waiting: new Map(), nextToken: 1, pings: [], pingsOut: 0, pinger: null, closed: false, error: null, handshake: null, done: deferred(), denials: [] });

// The handshake's clock starts only once there is a socket, so a factory that throws leaves no
// timer behind.
function open(conn, resolve, reject) {
  conn.handshake = { resolve, reject, timer: null };
  conn.parser = createParser((op) => received(conn, op), SERVER_OPS);
  conn.socket = (conn.o.socket ?? netSocket)(conn.o);
  conn.handshake.timer = conn.timers.setTimeout(() => fail(conn, timeoutError(`no NATS handshake within ${conn.o.timeoutMs} ms`)), conn.o.timeoutMs);
  listen(conn, conn.socket);
}

function listen(conn, socket) {
  socket.on("data", (chunk) => guarded(conn, () => conn.parser.push(chunk)));
  socket.on("error", (e) => fail(conn, transportError(`socket error: ${e.message}`, e)));
  socket.on("close", () => fail(conn, transportError("the socket to the server closed")));
}

function guarded(conn, fn) {
  try { fn(); } catch (e) { fail(conn, e instanceof NatsError ? e : protocolError(e.message)); }
}

function write(conn, buf) {
  if (!conn.socket || conn.socket.destroyed) return false;
  return conn.socket.write(buf);
}

function received(conn, op) {
  if (conn.closed) return null;
  return ON_OP[op.op](conn, op);
}

const ON_OP = {
  INFO: (conn, op) => informed(conn, op.info),
  MSG: (conn, op) => message(conn, op),
  HMSG: (conn, op) => message(conn, op),
  "+OK": () => null,
  "-ERR": (conn, op) => errored(conn, serverError(op.text)),
  PING: (conn) => write(conn, pongOp()),
  PONG: (conn) => ponged(conn),
};

// ── the handshake ──────────────────────────────────────────────────────────

// The first INFO opens the conversation: CONNECT, the one inbox subscription every request
// answers on, and a PING whose PONG says the server has read both. A later INFO is the cluster
// telling a client about itself, and is only kept.
function informed(conn, info) {
  const first = !conn.info;
  conn.info = info ?? {};
  if (!first) return;
  write(conn, Buffer.concat([connectOp(connectOptions(conn)), subOp(`${conn.inbox}.*`, INBOX_SID), pingOp()]));
}

// Headers on, no-responders on (a request nobody serves answers 503 at once, rather than timing
// out), verbose off. A credential goes only into CONNECT.
const connectOptions = (conn) => ({ verbose: false, pedantic: false, tls_required: false, name: conn.o.name, lang: "node", version: "orbit", protocol: 1, headers: true, no_responders: true, ...credentials(conn.o) });

const CREDENTIALS = [
  { when: (o) => o.token, as: (o) => ({ auth_token: o.token }) },
  { when: (o) => o.user, as: (o) => ({ user: o.user, pass: o.password ?? "" }) },
  { when: () => true, as: () => ({}) },
];

const credentials = (o) => CREDENTIALS.find((r) => r.when(o)).as(o);

function ponged(conn) {
  conn.pingsOut = 0;
  if (conn.handshake) return opened(conn);
  conn.pings.shift()?.resolve?.();
}

function opened(conn) {
  conn.timers.clearTimeout(conn.handshake.timer);
  conn.handshake.resolve(connectionApi(conn));
  conn.handshake = null;
  startPinging(conn);
}

// ── messages ───────────────────────────────────────────────────────────────

const messageOf = (op) => ({ subject: op.subject, sid: op.sid, reply: op.reply, headers: op.headers, status: op.status, description: op.description, data: op.data });

function message(conn, op) {
  if (String(op.sid) === INBOX_SID) return replied(conn, op);
  const sub = conn.sids.get(String(op.sid));
  if (sub) tell(sub, () => sub.onMessage(messageOf(op)));
}

function replied(conn, op) {
  const token = op.subject.startsWith(`${conn.inbox}.`) ? op.subject.slice(conn.inbox.length + 1) : null;
  conn.waiting.get(token)?.onMessage(messageOf(op));
}

// A subscriber's own callback failing is the subscriber's news, never the connection's.
function tell(sub, fn) {
  try { fn(); } catch (e) { sub.onError?.(e); }
}

// ── errors and the end ─────────────────────────────────────────────────────

// A denial names a subject: the request published to it, the subscription on it, or what a
// subscription was opened ABOUT (a pull's API subject), is what it refuses. A denied inbox
// refuses every request, since none of them can be answered.
function errored(conn, error) {
  if (error.fatal) return fail(conn, error);
  conn.denials.push(error);
  [...conn.waiting.values()].filter((w) => w.subject === error.subject || error.subject === `${conn.inbox}.*`).forEach((w) => w.reject(error));
  [...conn.sids.values()].filter((s) => s.subject === error.subject || s.about === error.subject).forEach((s) => s.onError?.(error));
  conn.o.onError?.(error);
}

function fail(conn, error) {
  if (conn.closed) return;
  settle(conn, error);
  conn.socket?.destroy?.();
  conn.done.resolve({ error });
}

// Whatever the connection still owed is settled now: the handshake, every request, every
// subscription that asked to hear of the end, every flush. Nothing is retried.
function settle(conn, error) {
  conn.closed = true;
  conn.error = error;
  stopTimers(conn);
  owed(conn).forEach((end) => end(error));
}

const owed = (conn) => [...[...conn.waiting.values()].map((w) => w.reject), ...[...conn.sids.values()].map((s) => s.onEnd), ...conn.pings.splice(0).map((p) => p.reject)].filter(Boolean);

function stopTimers(conn) {
  conn.timers.clearInterval(conn.pinger);
  conn.timers.clearTimeout(conn.handshake?.timer);
  conn.handshake?.reject(conn.error);
}

// A PING every interval; a server that answered none of the last `maxPingsOut` is gone.
function startPinging(conn) {
  if (!conn.o.pingIntervalMs) return;
  conn.pinger = conn.timers.setInterval(() => pinged(conn), conn.o.pingIntervalMs);
  conn.pinger?.unref?.();
}

function pinged(conn) {
  if (conn.pingsOut >= conn.o.maxPingsOut) return fail(conn, timeoutError(`the server answered none of ${conn.o.maxPingsOut} pings: the connection is stale`));
  conn.pingsOut += 1;
  conn.pings.push({ keepalive: true });
  write(conn, pingOp());
}

function closeConnection(conn) {
  if (conn.closed) return conn.done.promise;
  settle(conn, closedError("the connection was closed by the client"));
  conn.socket?.end?.();
  conn.done.resolve({ error: null });
  return conn.done.promise;
}

// ── what a connection offers ───────────────────────────────────────────────

function openOrThrow(conn) {
  if (conn.closed) throw unsent(conn);
}

// Asked of a connection that had already ended: nothing was written, so nothing is ambiguous.
const unsent = (conn) => new NatsError(conn.error?.kind ?? "closed", `nothing was sent: ${conn.error?.message ?? "the connection is closed"}`, { sent: false, cause: conn.error });

const headersOf = (o) => (o.headers || o.msgId ? { ...(o.headers ?? {}), ...(o.msgId ? { "Nats-Msg-Id": String(o.msgId) } : {}) } : undefined);

// A body past what the server said it takes is refused here, before the server would answer it
// with an -ERR that ends the connection.
function publish(conn, subject, payload, o = {}) {
  openOrThrow(conn);
  const body = asBytes(payload);
  if (conn.info?.max_payload && body.length > conn.info.max_payload) throw refusedError(`a ${body.length}-byte body is past the ${conn.info.max_payload} bytes this server takes`, { subject });
  write(conn, pubOp(subject, body, { reply: o.reply, headers: headersOf(o) }));
}

// One reply on this client's inbox, or the request's own timeout. The published subject is kept
// so a permissions violation naming it refuses exactly this request.
function request(conn, subject, payload, o = {}) {
  if (conn.closed) return Promise.reject(unsent(conn));
  const token = String(conn.nextToken++);
  return new Promise((resolve, reject) => asked(conn, token, { subject: checkedSubject(subject), resolve, reject, timeoutMs: o.timeoutMs ?? conn.o.timeoutMs }, () => publish(conn, subject, payload, { ...o, reply: `${conn.inbox}.${token}` })));
}

function asked(conn, token, w, send) {
  const done = (fn) => (value) => settled(conn, token, () => fn(value));
  conn.waiting.set(token, { subject: w.subject, onMessage: done(w.resolve), reject: done(w.reject), timer: conn.timers.setTimeout(() => conn.waiting.get(token)?.reject(timeoutError(`no reply to ${w.subject} within ${w.timeoutMs} ms`)), w.timeoutMs) });
  guardedSend(conn, token, send);
}

function guardedSend(conn, token, send) {
  try { send(); } catch (e) { conn.waiting.get(token)?.reject(e); }
}

function settled(conn, token, fn) {
  const w = conn.waiting.get(token);
  if (!w) return;
  conn.waiting.delete(token);
  conn.timers.clearTimeout(w.timer);
  fn();
}

// A subscription of its own on a fresh inbox subject, `<inbox>-c<n>`: one token where the
// shared inbox has two, so `<inbox>.*` never matches it. `about` is the subject the collector
// was opened for, so a denial of that subject ends it.
function collect(conn, o = {}) {
  openOrThrow(conn);
  const reply = `${conn.inbox}-c${conn.nextToken++}`;
  const { sid } = subscribe(conn, reply, o);
  return { reply, stop: () => unsubscribe(conn, sid) };
}

// The SUB is written before the subscription is kept, so a subject refused by the encoder leaves
// nothing behind; nothing can arrive on it before this function returns.
function subscribe(conn, subject, o = {}) {
  openOrThrow(conn);
  const sid = String(conn.nextSid++);
  write(conn, subOp(subject, sid, o.queue));
  conn.sids.set(sid, { subject, about: o.about ?? null, onMessage: o.onMessage ?? (() => {}), onError: o.onError, onEnd: o.onEnd });
  return { sid };
}

// Only a subscription this connection holds is ever unsubscribed, so a sid is never text a caller
// wrote into the wire.
function unsubscribe(conn, sid) {
  if (!conn.sids.delete(String(sid)) || conn.closed) return false;
  return write(conn, unsubOp(String(sid)));
}

// A PING whose PONG says the server has read everything written before it.
function flush(conn) {
  if (conn.closed) return Promise.reject(unsent(conn));
  return new Promise((resolve, reject) => void (conn.pings.push({ resolve, reject }), write(conn, pingOp())));
}

const connectionApi = (conn) => ({
  publish: (subject, payload, o) => publish(conn, subject, payload, o),
  request: (subject, payload, o) => request(conn, subject, payload, o),
  collect: (o) => collect(conn, o),
  subscribe: (subject, o) => subscribe(conn, subject, o),
  unsubscribe: (sid) => unsubscribe(conn, sid),
  flush: () => flush(conn),
  close: () => closeConnection(conn),
  closed: () => conn.closed,
  done: conn.done.promise,
  info: () => ({ ...conn.info }),
  inbox: conn.inbox,
  denials: () => [...conn.denials],
  timers: conn.timers,
});
