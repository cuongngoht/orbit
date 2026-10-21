// The AMQP 0-9-1 REFERENCE adapter's operations (ADR 0035), over an injected client: one
// orbit.helper/v1 request in, one answer out. `deps` is everything that touches the world --
// `connect` (session.mjs), `env`, a monotonic `now`, a wall clock `wall`, `timers`, and a
// `socket` factory a test hands in -- so the suite runs against a scripted broker and nothing
// waits on a network.
//
// What it may touch is what the BINDING says, never the request: the exchange a channel is
// bound to, the queue an observer owns, the namespace a fixture owns. The request carries the
// operation's own parameters -- a message, how long to watch -- and a name outside the
// fixture's namespace is refused before a connection is opened. It never purges a queue and
// never deletes an exchange; a queue it deletes is one its fixture owns, and only while unused.
//
//   publish          a confirmed publication: confirmed, rejected or returned -- or AMBIGUOUS
//                    with its message id when the confirm never came, never sent twice
//   observe          arm an observer: its own queue, bound beside the application's, with the
//                    count it stood at -- a queue somebody else consumes is refused
//   observe.await    read the observer's queue for a bounded window, acknowledging what it
//                    took from its own queue; complete only when it read the queue empty. The
//                    same gate as arming, asked again before the first read: a queue outside the
//                    observer's namespace, or one anybody else consumes, is never read -- reading
//                    it would take the application's messages
//   fixture.prepare  declare the fixture's own exchanges, queues and bindings
//   fixture.cleanup  delete the fixture's own queues, and say what it left and why
//
// The credential is read from the environment under the names the binding gave
// (`credential.userEnv`, `credential.passwordEnv`): an identity's, when one is bound, else the
// resource's. It is never in the request, never in an answer and never in a message.
import { AmqpError, helperClassOf } from "./errors.mjs";

export const PAYLOAD_BYTES = 64 * 1024;
export const MAX_MESSAGES = 500;
const DEFAULT_MESSAGES = 100;
const DEFAULT_EXPIRES_MS = 30 * 60 * 1000;
const CONNECT_MS = 10_000;
const MARGIN_MS = 250;
const POLL_MS = 100;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ID = /^[\x21-\x7e]{1,128}$/;
const MATCH_KEYS = ["messageId", "correlationId", "routingKey"];
const QUEUE_ARGUMENTS = ["x-expires", "x-message-ttl", "x-dead-letter-exchange", "x-dead-letter-routing-key", "x-max-length", "x-queue-type", "x-delivery-limit"];
const OUTCOMES = { ack: "confirmed", nack: "rejected", returned: "returned", unconfirmed: "unconfirmed" };

const OPS = {
  publish: (asked, deps) => publish(asked, deps),
  observe: (asked, deps) => observe(asked, deps),
  "observe.await": (asked, deps) => awaitObserver(asked, deps),
  "fixture.prepare": (asked, deps) => prepare(asked, deps),
  "fixture.cleanup": (asked, deps) => cleanup(asked, deps),
};

export const OPERATIONS = Object.keys(OPS);

export async function run(asked, deps) {
  const op = OPS[asked?.op];
  if (!op) return refusal(`this adapter answers ${OPERATIONS.join(", ")} — not ${String(asked?.op).slice(0, 40)}`);
  const timed = { ...asked, request: asked.request ?? {}, bound: asked.bound ?? {}, startedAt: deps.now() };
  return op(timed, deps).catch((e) => failureOf(e, timed));
}

const refusal = (message) => ({ failure: { class: "refused", message } });

function failureOf(e, asked) {
  const cls = helperClassOf(e);
  const key = cls === "ambiguous" ? { operationKey: String(e.messageId ?? asked.request.messageId ?? "unknown") } : {};
  return { failure: { class: cls, message: String(e?.message ?? e).slice(0, 300), ...key } };
}

// ── one connection per request ─────────────────────────────────────────────

async function withConnection(asked, value, deps, use) {
  const conn = await deps.connect(connectionOf(asked, value, deps));
  try { return await use(conn); }
  finally { await conn.close().catch(() => null); }
}

function connectionOf(asked, value, deps) {
  const endpoint = value.endpoint ?? {};
  const credential = asked.bound.identityRef?.credential ?? value.credential ?? {};
  const options = { host: endpoint.host, port: endpoint.port, vhost: endpoint.vhost, user: deps.env[credential.userEnv], password: deps.env[credential.passwordEnv], heartbeatSec: 0, timeoutMs: Math.min(CONNECT_MS, remaining(asked, deps)), timers: deps.timers, socket: deps.socket };
  return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
}

const remaining = (asked, deps) => Math.max(1, (asked.deadlineMs ?? 30_000) - (deps.now() - asked.startedAt));

function within(deps, ms, work, late) {
  return new Promise((resolve, reject) => {
    const timer = deps.timers.setTimeout(() => reject(late()), ms);
    work.then((v) => (deps.timers.clearTimeout(timer), resolve(v)), (e) => (deps.timers.clearTimeout(timer), reject(e)));
  });
}

const sleep = (deps, ms) => new Promise((resolve) => deps.timers.setTimeout(resolve, ms));

const inside = (namespace, name) => typeof namespace === "string" && (name === namespace || String(name).startsWith(`${namespace}.`));

const isoAt = (deps) => new Date(deps.wall()).toISOString();

// ── publish ────────────────────────────────────────────────────────────────

async function publish(asked, deps) {
  const channel = asked.bound.channelRef ?? {};
  const message = messageOf(asked.request, channel);
  if (message.refused) return refusal(message.refused);
  return withConnection(asked, channel, deps, (conn) => published(conn, message, asked, deps));
}

function messageOf(r, channel) {
  if (typeof r.messageId !== "string" || !ID.test(r.messageId)) return { refused: "every publication carries a logical message id: request.messageId, 1-128 printable characters" };
  if (typeof channel.exchange !== "string") return { refused: "the bound channel names no exchange to publish to" };
  return { exchange: channel.exchange, routingKey: String(r.routingKey ?? channel.routingKey ?? ""), mandatory: r.mandatory !== false, body: r.payload, properties: propertiesOf(r) };
}

const propertiesOf = (r) => ({ messageId: r.messageId, correlationId: typeof r.correlationId === "string" ? r.correlationId : undefined, contentType: r.contentType ?? (typeof r.payload === "string" ? "text/plain" : "application/json"), deliveryMode: 2, headers: headersOf(r) });

const headersOf = (r) => Object.fromEntries([...Object.entries(r.headers ?? {}).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)), ...(typeof r.causationId === "string" ? [["x-causation-id", r.causationId]] : [])]);

// Once the frames are written the outcome is the broker's: a deadline that passes before the
// confirm is AMBIGUOUS, with the message id it is read back by.
async function published(conn, message, asked, deps) {
  const ch = await conn.channel();
  await ch.confirmSelect();
  const started = deps.now();
  const settled = await within(deps, remaining(asked, deps), ch.publish(message), () => new AmqpError("ambiguous", `the confirm for ${message.properties.messageId} did not come within the deadline`, { messageId: message.properties.messageId }));
  return { value: { messageId: message.properties.messageId, outcome: OUTCOMES[settled.outcome] ?? "unconfirmed", elapsedMs: Math.round(deps.now() - started) } };
}

// ── observe: arm ───────────────────────────────────────────────────────────

async function observe(asked, deps) {
  const channel = asked.bound.channelRef ?? {};
  const observer = asked.bound.observerRef ?? {};
  const problem = ownedProblem(observer, asked.bound.fixtureRef) ?? (typeof channel.exchange === "string" ? null : "the bound channel names no exchange to observe");
  if (problem) return refusal(problem);
  return withConnection(asked, channel, deps, (conn) => armed(conn, observer, channel, deps));
}

// An observer's queue is its OWN: named, and inside the namespace its binding gives (or the
// fixture's, when only that is bound) -- an observer with no namespace to be inside is refused.
function ownedProblem(observer, fixture) {
  const namespace = observer.namespace ?? fixture?.namespace;
  if (!NAME.test(String(observer.queue ?? ""))) return "the bound observer names no queue of its own";
  if (!NAME.test(String(namespace ?? ""))) return "the bound observer names no namespace its queue belongs to — an observer is only ever a fixture's own";
  return inside(namespace, observer.queue) ? null : `the observer's queue ${observer.queue} is outside its namespace ${namespace}`;
}

async function armed(conn, observer, channel, deps) {
  const ch = await conn.channel();
  const declared = await ch.declareQueue({ name: observer.queue, durable: true, arguments: { "x-expires": observer.expiresMs ?? DEFAULT_EXPIRES_MS } });
  if (declared.consumerCount > 0) return refusal(`${observer.queue} already has a consumer — an observer reads a queue nobody else does, so it was not armed`);
  await ch.bindQueue({ queue: observer.queue, exchange: channel.exchange, routingKey: observer.bindingKey ?? channel.routingKey ?? "#" });
  return { value: { baseline: { messages: declared.messageCount, at: isoAt(deps) }, completeness: "armed" } };
}

// ── observe.await ──────────────────────────────────────────────────────────

async function awaitObserver(asked, deps) {
  const observer = asked.bound.observerRef ?? {};
  const until = untilOf(asked.request);
  const problem = ownedProblem(observer) ?? until.refused;
  if (problem) return refusal(problem);
  return withConnection(asked, observer, deps, (conn) => ownedThenWatched(conn, observer.queue, until, asked, deps));
}

// Asked of the broker before the first read: the queue exists, and nobody else consumes it. A
// queue the observer never armed closes its channel as NOT_FOUND, which is a refusal.
async function ownedThenWatched(conn, queue, until, asked, deps) {
  const held = await (await conn.channel()).declareQueue({ name: queue, passive: true });
  if (held.consumerCount > 0) return refusal(`${queue} has ${held.consumerCount} consumer(s) — an observer reads a queue nobody else does, so it was not read`);
  return watched(conn, queue, until, asked, deps);
}

// `count` ends the window early once that many matching messages were read AND the queue was
// read empty; without it the whole window is watched -- what an absence needs.
function untilOf(r) {
  const count = r.count ?? Infinity;
  if (count !== Infinity && !(Number.isInteger(count) && count >= 1)) return { refused: "request.count is a whole number, 1 or more" };
  if (r.waitMs !== undefined && !(Number.isInteger(r.waitMs) && r.waitMs >= 0)) return { refused: "request.waitMs is a whole number of milliseconds" };
  return { count, waitMs: r.waitMs, match: matchOf(r.match), max: Math.min(Number.isInteger(r.maxMessages) && r.maxMessages > 0 ? r.maxMessages : DEFAULT_MESSAGES, MAX_MESSAGES) };
}

const matchOf = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([k, v]) => MATCH_KEYS.includes(k) && typeof v === "string"));

async function watched(conn, queue, until, asked, deps) {
  const ch = await conn.channel();
  const state = { seen: [], matched: 0, gaps: [], drained: false, endsAt: deps.now() + Math.max(0, Math.min(until.waitMs ?? Infinity, remaining(asked, deps) - MARGIN_MS)) };
  while (!finished(state, until, deps)) await polled(ch, queue, until, state, deps);
  if (!state.drained) state.gaps.push(`more than ${until.max} messages were waiting — one answer holds at most that many, so the rest were left unread`);
  return { value: { messages: state.seen, through: { messages: state.seen.length, at: isoAt(deps) }, completeness: state.gaps.length ? "partial" : "complete", gaps: state.gaps } };
}

const finished = (state, until, deps) => state.seen.length >= until.max || (state.drained && (state.matched >= until.count || deps.now() >= state.endsAt));

async function polled(ch, queue, until, state, deps) {
  const got = await ch.get({ queue });
  if (!got.message) return idle(state, deps);
  kept(state, got, until);
  ch.ack(got.deliveryTag);
}

async function idle(state, deps) {
  state.drained = true;
  const wait = Math.min(deps.pollMs ?? POLL_MS, state.endsAt - deps.now());
  if (wait > 0) await sleep(deps, wait);
}

function kept(state, got, until) {
  const seen = seenOf(got, state.gaps);
  state.drained = false;
  state.seen.push(seen);
  if (matches(seen, until.match)) state.matched += 1;
}

const matches = (seen, match) => Object.entries(match).every(([k, v]) => ({ messageId: seen.id, correlationId: seen.correlation.correlationId, routingKey: seen.key })[k] === v);

function seenOf(got, gaps) {
  const p = got.properties ?? {};
  const headers = got.headers ?? {};
  return { id: p.messageId ?? null, key: got.routingKey, correlation: { correlationId: p.correlationId ?? null, causationId: typeof headers["x-causation-id"] === "string" ? headers["x-causation-id"] : null }, payload: payloadOf(got.message, p, gaps), terminal: deathOf(headers) };
}

function payloadOf(body, p, gaps) {
  if (body.length > PAYLOAD_BYTES) return tooLarge(gaps, p.messageId, body.length);
  const text = body.toString("utf8");
  return /json/i.test(String(p.contentType ?? "")) ? jsonOr(text) : text;
}

function tooLarge(gaps, id, bytes) {
  gaps.push(`the payload of ${id ?? "a message"} is ${bytes} bytes, more than the ${PAYLOAD_BYTES} this adapter keeps — it was counted, not kept`);
  return null;
}

function jsonOr(text) {
  try { return JSON.parse(text); }
  catch { return text; }
}

// Where a dead-lettered message ended and why, from the broker's own x-death record.
function deathOf(headers) {
  const d = Array.isArray(headers["x-death"]) ? headers["x-death"][0] : null;
  return d && typeof d === "object" ? { reason: String(d.reason ?? "unknown"), queue: typeof d.queue === "string" ? d.queue : null, count: Number(d.count ?? 0) } : null;
}

// ── fixture ────────────────────────────────────────────────────────────────

async function prepare(asked, deps) {
  const fixture = asked.bound.fixtureRef ?? {};
  const problem = fixtureProblem(fixture);
  if (problem) return refusal(problem);
  return withConnection(asked, fixture, deps, (conn) => prepared(conn, fixture));
}

function fixtureProblem(f) {
  if (!NAME.test(String(f.namespace ?? ""))) return "the bound fixture names no namespace";
  const names = [...(f.exchanges ?? []).map((e) => e?.name), ...(f.queues ?? []).map((q) => q?.name), ...(f.bindings ?? []).map((b) => b?.queue)];
  const outside = names.filter((n) => !NAME.test(String(n ?? "")) || !inside(f.namespace, n));
  return outside.length ? `outside the fixture's namespace ${f.namespace}: ${outside.slice(0, 5).map(String).join(", ")} — a fixture creates and removes only its own resources` : null;
}

async function prepared(conn, f) {
  const ch = await conn.channel();
  for (const e of f.exchanges ?? []) await ch.declareExchange({ name: e.name, type: e.type ?? "topic", durable: true, autoDelete: e.autoDelete === true });
  for (const q of f.queues ?? []) await ch.declareQueue({ name: q.name, durable: true, arguments: queueArgumentsOf(q) });
  for (const b of f.bindings ?? []) await ch.bindQueue({ queue: b.queue, exchange: b.exchange, routingKey: b.routingKey ?? "#" });
  return { value: { namespace: f.namespace, declared: { exchanges: (f.exchanges ?? []).length, queues: (f.queues ?? []).length, bindings: (f.bindings ?? []).length } } };
}

const queueArgumentsOf = (q) => ({ "x-expires": DEFAULT_EXPIRES_MS, ...Object.fromEntries(Object.entries(q.arguments ?? {}).filter(([k, v]) => QUEUE_ARGUMENTS.includes(k) && ["string", "number"].includes(typeof v))) });

async function cleanup(asked, deps) {
  const fixture = asked.bound.fixtureRef ?? {};
  const problem = fixtureProblem(fixture);
  if (problem) return refusal(problem);
  return withConnection(asked, fixture, deps, (conn) => cleaned(conn, fixture));
}

async function cleaned(conn, f) {
  const results = [];
  for (const q of f.queues ?? []) results.push(await deleted(conn, q.name));
  const exchanges = (f.exchanges ?? []).map((e) => ({ name: e.name, why: "this adapter never deletes an exchange — it goes with the task's broker, or when its last binding does if it was declared auto-delete" }));
  return { value: { cleanup: { removed: results.filter((r) => r.removed).map((r) => r.name), left: [...results.filter((r) => !r.removed).map(({ name, why }) => ({ name, why })), ...exchanges] } } };
}

// One channel per queue: a delete the broker refuses (in use) closes only its own channel.
async function deleted(conn, name) {
  const ch = await conn.channel();
  try { return { name, removed: true, messages: (await ch.deleteQueue({ name, ifUnused: true })).messageCount }; }
  catch (e) { return { name, removed: false, why: String(e?.message ?? e).slice(0, 200) }; }
}
