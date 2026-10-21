// The NATS JetStream REFERENCE adapter's operations (ADR 0035), over an injected client: one
// orbit.helper/v1 request in, one answer out. `deps` is everything that touches the world --
// `connect` (session.mjs), `env`, a monotonic `now`, a wall clock `wall`, `timers`, and a `socket`
// factory a test hands in -- so the suite runs against an in-memory server and nothing waits on a
// network.
//
// What it may touch is what the BINDING says, never the request: the subject and stream a channel
// is bound to, the consumer an observer owns, the namespace a fixture owns. The request carries the
// operation's own parameters -- a message, how long to watch -- and a name outside the fixture's
// namespace is refused before a connection is opened. It never purges, never sends a JetStream
// control header a case wrote (Nats-*: a rollup is a purge), and deletes only what carries its
// fixture's mark.
//
//   publish          a publication the stream acknowledges, its logical id sent as Nats-Msg-Id:
//                    confirmed, duplicate (the stream dropped it inside its duplicate window),
//                    rejected by the stream, or unroutable (no stream captures the subject) -- or
//                    AMBIGUOUS with its message id when the ack never came, never sent twice
//   observe          arm an observer: a durable consumer of its OWN on the stream, starting just
//                    after the last sequence and expiring when idle -- an independent cursor that
//                    moves nobody else's. A name that exists is somebody's and is refused, and so
//                    is a work-queue stream, where a second consumer would take the messages
//   observe.await    fetch from the observer's consumer for a bounded window, acknowledging what
//                    it took; complete only when a fetch found it empty
//   fixture.prepare  create the fixture's own streams and consumers, each marked with it
//   fixture.cleanup  delete the fixture's own consumers and streams, and say what it left and why
//
// On an interest-retention stream an armed observer is one more interest: the stream keeps what it
// has not acknowledged until it does, or until the observer expires. The credential is read from
// the environment under the names the binding gave (`credential.userEnv`, `credential.passwordEnv`):
// an identity's, when one is bound, else the resource's. It is never in the request, never in an
// answer and never in a message.
import { helperClassOf } from "./errors.mjs";
import { jetstream } from "./jetstream.mjs";

export const PAYLOAD_BYTES = 64 * 1024;
export const MAX_MESSAGES = 500;
const DEFAULT_MESSAGES = 100;
const DEFAULT_EXPIRES_MS = 30 * 60 * 1000;
const CONNECT_MS = 10_000;
const API_MS = 5_000;
const MARGIN_MS = 250;
const POLL_MS = 100;
const FETCH_BATCH = 100;
const ACK_WAIT_MS = 30_000;
const NS_PER_MS = 1_000_000;
export const FIXTURE_MARK = "orbit.fixture";

// A stream or consumer name, and so a JetStream fixture namespace: one token, no dot or wildcard.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const ID = /^[\x21-\x7e]{1,128}$/;
const HEADER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FLAT = ["string", "number", "boolean"];
const MATCH_KEYS = ["messageId", "correlationId", "subject"];
const STREAM_KEYS = ["subjects", "storage", "retention", "maxMsgs", "maxBytes", "maxAgeMs", "duplicateWindowMs", "discard"];

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
  const key = cls === "ambiguous" ? { operationKey: String(e.msgId ?? asked.request.messageId ?? "unknown") } : {};
  return { failure: { class: cls, message: String(e?.message ?? e).slice(0, 300), ...key } };
}

// ── one connection per request ─────────────────────────────────────────────

async function withJetStream(asked, value, deps, use, mark) {
  const conn = await deps.connect(connectionOf(asked, value, deps));
  try { return await use(jetstream(conn, { timeoutMs: Math.min(API_MS, remaining(asked, deps)), ...(mark ? { mark } : {}) })); }
  finally { await conn.close().catch(() => null); }
}

function connectionOf(asked, value, deps) {
  const endpoint = value.endpoint ?? {};
  const credential = asked.bound.identityRef?.credential ?? value.credential ?? {};
  const options = { host: endpoint.host, port: endpoint.port, user: deps.env[credential.userEnv], password: deps.env[credential.passwordEnv], pingIntervalMs: 0, timeoutMs: Math.min(CONNECT_MS, remaining(asked, deps)), timers: deps.timers, socket: deps.socket };
  return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
}

const remaining = (asked, deps) => Math.max(1, (asked.deadlineMs ?? 30_000) - (deps.now() - asked.startedAt));

const sleep = (deps, ms) => new Promise((resolve) => deps.timers.setTimeout(resolve, ms));

// Names carry the namespace and a `-` or `_` after it; subjects carry it as their first token.
const insideName = (namespace, name) => typeof name === "string" && (name === namespace || name.startsWith(`${namespace}-`) || name.startsWith(`${namespace}_`));
const insideSubject = (namespace, subject) => typeof subject === "string" && (subject === namespace || subject.startsWith(`${namespace}.`));

const isoAt = (deps) => new Date(deps.wall()).toISOString();

const nanos = (ms) => Math.round(ms * NS_PER_MS);

// ── publish ────────────────────────────────────────────────────────────────

async function publish(asked, deps) {
  const channel = asked.bound.channelRef ?? {};
  const message = messageOf(asked.request, channel);
  if (message.refused) return refusal(message.refused);
  return withJetStream(asked, channel, deps, (js) => published(js, message, asked, deps));
}

function messageOf(r, channel) {
  if (typeof r.messageId !== "string" || !ID.test(r.messageId)) return { refused: "every publication carries a logical message id: request.messageId, 1-128 printable characters" };
  const subject = r.subject ?? channel.subject;
  const problem = subject === undefined ? "the bound channel names no subject to publish to" : (subjectProblem(subject) ?? allowedProblem(r, channel, subject));
  if (problem) return { refused: problem };
  return { subject, id: r.messageId, body: r.payload, headers: headersOf(r, channel) };
}

const SUBJECT_RULES = [
  { bad: (s) => typeof s !== "string" || !s || s.length > 255, why: "a subject is a non-empty string of at most 255 characters" },
  { bad: (s) => /[\s*>\u0000-\u001f\u007f]/.test(s) || /(^\.|\.\.|\.$)/.test(s), why: "a publication goes to one literal subject: dot-separated tokens, none empty, no wildcard or whitespace" },
  { bad: (s) => /^(\$|_INBOX\.)/.test(s), why: "a publication goes to an application subject, never a system one ($… or _INBOX.…)" },
];

const subjectProblem = (s) => SUBJECT_RULES.find((rule) => rule.bad(s))?.why ?? null;

// A request may name its own subject only inside what the bound channel covers: its subject and
// the patterns it lists as `subjects`.
function allowedProblem(r, channel, subject) {
  const covered = [channel.subject, ...(channel.subjects ?? [])].filter((p) => typeof p === "string");
  if (r.subject === undefined || covered.some((p) => covers(p, subject))) return null;
  return `request.subject ${subject} is not one the bound channel covers (${covered.join(", ") || "none"})`;
}

function covers(pattern, subject) {
  const p = pattern.split(".");
  const s = subject.split(".");
  const tail = p.indexOf(">");
  return (tail < 0 ? p.length === s.length : s.length > tail) && p.slice(0, tail < 0 ? p.length : tail).every((t, i) => t === "*" || t === s[i]);
}

const lineSafe = (v) => !/[\r\n\0]/.test(String(v));

// A case's own flat, single-line headers travel; a JetStream control header (Nats-*) never does.
// Correlation and causation ride as headers of their own, and the stream the channel names is
// held to by Nats-Expected-Stream, so a publication another stream captures is rejected.
function headersOf(r, channel) {
  const own = Object.entries(r.headers ?? {}).filter(([k, v]) => HEADER.test(k) && !/^nats-/i.test(k) && FLAT.includes(typeof v) && lineSafe(v)).map(([k, v]) => [k, String(v)]);
  const correlation = [["Correlation-Id", r.correlationId], ["Causation-Id", r.causationId]].filter(([, v]) => typeof v === "string" && lineSafe(v));
  const stream = typeof channel.stream === "string" ? [["Nats-Expected-Stream", channel.stream]] : [];
  return Object.fromEntries([...own, ...correlation, ["Content-Type", contentTypeOf(r)], ...stream]);
}

const contentTypeOf = (r) => (typeof r.contentType === "string" && lineSafe(r.contentType) ? r.contentType : typeof r.payload === "string" ? "text/plain" : "application/json");

// Once the message is written the outcome is the stream's: an ack that does not come within the
// deadline is AMBIGUOUS, with the message id it is read back by.
async function published(js, message, asked, deps) {
  const started = deps.now();
  const outcome = await js.publishAck(message.subject, message.body, { msgId: message.id, headers: message.headers, timeoutMs: remaining(asked, deps) }).then(ackedAs, settledAs);
  return { value: { messageId: message.id, outcome, elapsedMs: Math.round(deps.now() - started) } };
}

const ackedAs = (ack) => (ack.duplicate ? "duplicate" : "confirmed");

// What the stream SAID is an observation, never a failure: nothing captured the subject, or the
// stream refused the publication. Anything else is the operation's own failure.
const SETTLED = [
  { when: (e) => e?.kind === "refused" && e.status === 503, is: "unroutable" },
  { when: (e) => e?.kind === "api", is: "rejected" },
];

function settledAs(e) {
  const row = SETTLED.find((r) => r.when(e));
  if (!row) throw e;
  return row.is;
}

// ── observe: arm ───────────────────────────────────────────────────────────

async function observe(asked, deps) {
  const channel = asked.bound.channelRef ?? {};
  const observer = asked.bound.observerRef ?? {};
  const problem = observerProblem(observer, channel, asked.bound.fixtureRef);
  if (problem) return refusal(problem);
  return withJetStream(asked, channel, deps, (js) => armed(js, observer, channel, deps));
}

const OBSERVER_RULES = [
  { bad: (o) => !NAME.test(String(o.consumer ?? "")), why: () => "the bound observer names no consumer of its own" },
  { bad: (o) => !NAME.test(String(o.stream ?? "")), why: () => "the bound observer names no stream to observe" },
  { bad: (o, c) => typeof c.stream === "string" && c.stream !== o.stream, why: (o, c) => `the observer's stream ${o.stream} is not the channel's ${c.stream}` },
  { bad: (o, c, f) => Boolean(f?.namespace) && !insideName(f.namespace, o.consumer), why: (o, c, f) => `the observer's consumer ${o.consumer} is outside the fixture's namespace ${f.namespace}` },
];

const observerProblem = (o, c, f) => OBSERVER_RULES.find((rule) => rule.bad(o, c, f))?.why(o, c, f) ?? null;

// The stream's last sequence is the baseline, and the observer's cursor starts just after it, so
// whatever is published from here on -- and nothing before -- is what it will read.
async function armed(js, observer, channel, deps) {
  const info = await js.streamInfo(observer.stream);
  if (info.config?.retention === "workqueue") return refusal(`${observer.stream} is a work-queue stream: each message goes to one consumer, so an observer's own would take it from the application — not armed`);
  const last = info.state?.last_seq ?? 0;
  const created = await js.consumerCreate(observer.stream, observerConfig(observer, channel, last));
  return { value: { baseline: { sequence: last, messages: created.num_pending ?? 0, at: isoAt(deps) }, completeness: "armed" } };
}

const observerConfig = (o, c, last) => ({ durable_name: o.consumer, description: `orbit observer ${String(o.alias ?? o.consumer).slice(0, 60)}`, deliver_policy: "by_start_sequence", opt_start_seq: last + 1, ack_policy: "explicit", ack_wait: nanos(ACK_WAIT_MS), inactive_threshold: nanos(o.expiresMs ?? DEFAULT_EXPIRES_MS), ...filterOf(o, c) });

function filterOf(o, c) {
  const subject = o.filterSubject ?? c.subject;
  return typeof subject === "string" ? { filter_subject: subject } : {};
}

// ── observe.await ──────────────────────────────────────────────────────────

async function awaitObserver(asked, deps) {
  const observer = asked.bound.observerRef ?? {};
  if (!NAME.test(String(observer.stream ?? "")) || !NAME.test(String(observer.consumer ?? ""))) return refusal("the bound observer names no stream and consumer to await");
  const until = untilOf(asked.request);
  if (until.refused) return refusal(until.refused);
  return withJetStream(asked, observer, deps, (js) => watched(js, observer, until, asked, deps));
}

// `count` ends the window early once that many matching messages were read AND a fetch found the
// consumer empty; without it the whole window is watched -- what an absence needs.
function untilOf(r) {
  const count = r.count ?? Infinity;
  if (count !== Infinity && !(Number.isInteger(count) && count >= 1)) return { refused: "request.count is a whole number, 1 or more" };
  if (r.waitMs !== undefined && !(Number.isInteger(r.waitMs) && r.waitMs >= 0)) return { refused: "request.waitMs is a whole number of milliseconds" };
  return { count, waitMs: r.waitMs, match: matchOf(r.match), max: Math.min(Number.isInteger(r.maxMessages) && r.maxMessages > 0 ? r.maxMessages : DEFAULT_MESSAGES, MAX_MESSAGES) };
}

const matchOf = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([k, v]) => MATCH_KEYS.includes(k) && typeof v === "string"));

async function watched(js, observer, until, asked, deps) {
  const state = { seen: [], matched: 0, gaps: [], drained: false, last: null, endsAt: deps.now() + Math.max(0, Math.min(until.waitMs ?? Infinity, remaining(asked, deps) - MARGIN_MS)) };
  while (!finished(state, until, deps)) await polled(js, observer, until, state, deps);
  if (!state.drained) state.gaps.push(`more than ${until.max} messages were waiting — one answer holds at most that many, so the rest were left unread`);
  return { value: { messages: state.seen, through: { messages: state.seen.length, sequence: state.last, at: isoAt(deps) }, completeness: state.gaps.length ? "partial" : "complete", gaps: state.gaps } };
}

const finished = (state, until, deps) => state.seen.length >= until.max || (state.drained && (state.matched >= until.count || deps.now() >= state.endsAt));

// A no-wait fetch that returns less than it asked for found the consumer empty. Its `expiresMs` is
// only the client's fallback clock for a server that never answers one.
async function polled(js, observer, until, state, deps) {
  const batch = Math.min(FETCH_BATCH, until.max - state.seen.length);
  const got = await js.fetch(observer.stream, observer.consumer, { batch, noWait: true, expiresMs: Math.max(1, Math.min(API_MS, state.endsAt - deps.now())) });
  for (const m of got.messages) await took(js, m, until, state);
  if (got.messages.length < batch) await idle(state, deps);
}

async function took(js, m, until, state) {
  kept(state, m, until);
  await js.ack(m, { confirm: true });
}

async function idle(state, deps) {
  state.drained = true;
  const wait = Math.min(deps.pollMs ?? POLL_MS, state.endsAt - deps.now());
  if (wait > 0) await sleep(deps, wait);
}

function kept(state, m, until) {
  const seen = seenOf(m, state.gaps);
  state.drained = false;
  state.seen.push(seen);
  state.last = m.info?.streamSeq ?? state.last;
  if (matches(seen, until.match)) state.matched += 1;
}

const matches = (seen, match) => Object.entries(match).every(([k, v]) => ({ messageId: seen.id, correlationId: seen.correlation.correlationId, subject: seen.key })[k] === v);

const one = (v) => (Array.isArray(v) ? v[0] : v) ?? null;

function seenOf(m, gaps) {
  const h = m.headers ?? {};
  const id = one(h["Nats-Msg-Id"]);
  return { id, key: m.subject, correlation: { correlationId: one(h["Correlation-Id"]), causationId: one(h["Causation-Id"]) }, payload: payloadOf(m.data, one(h["Content-Type"]), gaps, id) };
}

function payloadOf(body, contentType, gaps, id) {
  if (body.length > PAYLOAD_BYTES) return tooLarge(gaps, id, body.length);
  const text = body.toString("utf8");
  return /json/i.test(String(contentType ?? "")) ? jsonOr(text) : text;
}

function tooLarge(gaps, id, bytes) {
  gaps.push(`the payload of ${id ?? "a message"} is ${bytes} bytes, more than the ${PAYLOAD_BYTES} this adapter keeps — it was counted, not kept`);
  return null;
}

function jsonOr(text) {
  try { return JSON.parse(text); }
  catch { return text; }
}

// ── fixture ────────────────────────────────────────────────────────────────

const markOf = (fixture) => ({ [FIXTURE_MARK]: fixture.namespace });

async function prepare(asked, deps) {
  const fixture = asked.bound.fixtureRef ?? {};
  const problem = fixtureProblem(fixture);
  if (problem) return refusal(problem);
  return withJetStream(asked, fixture, deps, (js) => prepared(js, fixture), markOf(fixture));
}

// Every stream and consumer name carries the namespace, and every subject a fixture stream
// captures is inside it: a fixture stream can never capture -- and so never take or shadow -- a
// subject of the application's.
function fixtureProblem(f) {
  if (!NAME.test(String(f.namespace ?? ""))) return "the bound fixture names no namespace — a JetStream fixture's is one name token (no dot or wildcard), since its streams and consumers carry it in their names";
  if ((f.streams ?? []).some((s) => ![s?.subjects ?? []].flat().length)) return "every fixture stream declares the subjects it captures, inside its namespace";
  const outside = [...namesOf(f).filter((n) => !insideName(f.namespace, n)), ...subjectsOf(f).filter((s) => !insideSubject(f.namespace, s))];
  return outside.length ? `outside the fixture's namespace ${f.namespace}: ${outside.slice(0, 5).map(String).join(", ")} — a fixture creates and removes only its own resources` : null;
}

const namesOf = (f) => [...(f.streams ?? []).map((s) => s?.name), ...(f.consumers ?? []).flatMap((c) => [c?.name, c?.stream])];
const subjectsOf = (f) => (f.streams ?? []).flatMap((s) => [s?.subjects ?? []].flat());

async function prepared(js, f) {
  for (const s of f.streams ?? []) await js.streamCreate(streamSpecOf(s));
  for (const c of f.consumers ?? []) await js.consumerCreate(c.stream, consumerSpecOf(c));
  return { value: { namespace: f.namespace, declared: { streams: (f.streams ?? []).length, consumers: (f.consumers ?? []).length } } };
}

// A fixture stream lives in memory unless it says otherwise: it is the run's, and goes with it.
const streamSpecOf = (s) => ({ storage: "memory", ...Object.fromEntries(Object.entries(s).filter(([k, v]) => STREAM_KEYS.includes(k) && v !== undefined)), name: s.name, subjects: [s.subjects].flat() });

const consumerSpecOf = (c) => ({ durable_name: c.name, ack_policy: "explicit", ...(typeof c.filterSubject === "string" ? { filter_subject: c.filterSubject } : {}), ...(Number.isFinite(c.ackWaitMs) ? { ack_wait: nanos(c.ackWaitMs) } : {}), ...(Number.isInteger(c.maxDeliver) ? { max_deliver: c.maxDeliver } : {}) });

async function cleanup(asked, deps) {
  const fixture = asked.bound.fixtureRef ?? {};
  const problem = fixtureProblem(fixture);
  if (problem) return refusal(problem);
  return withJetStream(asked, fixture, deps, (js) => cleaned(js, fixture), markOf(fixture));
}

// Consumers first, then streams; each removed only when the server shows the fixture's mark on it.
async function cleaned(js, f) {
  const results = [];
  for (const c of f.consumers ?? []) results.push(await removed(() => js.consumerDelete(c.stream, c.name), `${c.stream}/${c.name}`));
  for (const s of f.streams ?? []) results.push(await removed(() => js.streamDelete(s.name), s.name));
  return { value: { cleanup: { removed: results.filter((r) => r.removed).map((r) => r.name), left: results.filter((r) => !r.removed).map(({ name, why }) => ({ name, why })) } } };
}

async function removed(remove, name) {
  try { return deletedAs(name, await remove()); }
  catch (e) { return { name, removed: false, why: String(e?.message ?? e).slice(0, 200) }; }
}

const deletedAs = (name, done) => (done.deleted ? { name, removed: true } : { name, removed: false, why: "the server did not say it was deleted" });
