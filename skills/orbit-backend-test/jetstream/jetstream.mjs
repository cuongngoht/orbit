// JetStream over a NATS connection (session.mjs): the streams and consumers a test makes for
// itself, a publication the stream ACKNOWLEDGES, a pull fetch and its acks, and an observation of
// a stream's range that steals nothing.
//
// Units are the API's own: JetStream speaks NANOSECONDS (`ack_wait`, `duplicate_window`,
// `max_age`, a pull's `expires`, a nak's `delay`). This module takes milliseconds wherever its own
// names say `Ms` and converts once; a consumer's fields are the API's and pass through in the
// API's nanoseconds -- and an `ack_wait` under a millisecond is refused, because it is always a
// millisecond count typed where nanoseconds belong.
//
// What it will not do is the argument: it creates only what does not exist yet, deletes only what
// is its own -- what THIS client created, or, for a client given a MARK, what carries that mark in
// the metadata it was created with -- never purges, and has no raw API door through which either
// could be asked.
import { NatsError, ambiguousError, apiError, protocolError, refusedError, transportError } from "./errors.mjs";
import { checkedSubject, decodeHeaders } from "./protocol.mjs";

const NS_PER_MS = 1_000_000;
const DEFAULTS = { timeoutMs: 5000, prefix: "$JS.API", graceMs: 1000 };
const MAX_BATCH = 10000;
const MAX_RANGE = 10000;

export function jetstream(conn, options = {}) {
  const js = { conn, o: { ...DEFAULTS, ...options, mark: markOf(options.mark) }, streams: new Set(), consumers: new Set() };
  return Object.freeze(Object.fromEntries(Object.entries(OPS).map(([name, op]) => [name, (...args) => op(js, ...args)])));
}

// A mark is written into the metadata of every stream and consumer this client creates, and is
// what a LATER client -- another process of the same fixture -- proves ownership by.
function markOf(mark) {
  if (mark === undefined || mark === null) return null;
  if (typeof mark !== "object" || !Object.keys(mark).length || !Object.values(mark).every((v) => typeof v === "string" && v)) throw refusedError("a mark is an object of one or more non-empty string values");
  return { ...mark };
}

const withMark = (js, config) => (js.o.mark ? { ...config, metadata: { ...(config.metadata ?? {}), ...js.o.mark } } : config);

// ── names and values ───────────────────────────────────────────────────────

// A stream or consumer name is one token: no dot, wildcard, whitespace or path separator.
const NAME = /^[^\s.*>/\\\u0000-\u001f\u007f]{1,255}$/;

export function checkedName(name, what = "name") {
  if (typeof name !== "string" || !NAME.test(name)) throw refusedError(`"${String(name).slice(0, 60)}" is not a ${what}: one token with no dot, wildcard, whitespace or path separator`);
  return name;
}

const said = (v) => String(v).slice(0, 30);

const oneOf = (field, values) => (v) => {
  if (!values.includes(v)) throw refusedError(`${field} is one of ${values.join(", ")}, not ${said(v)}`);
  return v;
};

const whole = (field) => (v) => {
  if (!Number.isSafeInteger(v) || v < -1) throw refusedError(`${field} is a whole number (-1 for no limit), not ${said(v)}`);
  return v;
};

const nanos = (field) => (v) => {
  if (!Number.isFinite(v) || v < 0) throw refusedError(`${field} is milliseconds, a number of at least 0, not ${said(v)}`);
  return Math.round(v * NS_PER_MS);
};

const counted = (field, ceiling) => (v) => {
  if (!Number.isSafeInteger(v) || v < 1 || v > ceiling) throw refusedError(`${field} is a whole number from 1 to ${ceiling}, not ${said(v)}`);
  return v;
};

function refuseUnknown(verb, spec, known) {
  const unknown = Object.keys(spec ?? {}).filter((k) => !known.includes(k));
  if (unknown.length) throw refusedError(`${verb} does not know ${unknown.join(", ")}: it takes ${known.join(", ")}`);
}

// ── the API ────────────────────────────────────────────────────────────────

// One JSON request on `$JS.API.<path>`. A 503 is nobody serving the API at all: JetStream is not
// enabled here, which is the machine's, never the case's.
async function api(js, verb, path, body) {
  const reply = await js.conn.request(`${js.o.prefix}.${path}`, body === undefined ? "" : JSON.stringify(body), { timeoutMs: js.o.timeoutMs });
  if (reply.status === 503) throw transportError(`${verb}: nothing answered ${js.o.prefix}.${path} (503 no responders): JetStream is not enabled here`);
  return judged(parsed(reply.data, verb), verb);
}

function parsed(data, verb) {
  try { return JSON.parse(Buffer.from(data ?? []).toString("utf8") || "{}"); } catch { throw protocolError(`${verb} answered something that is not JSON`); }
}

function judged(doc, verb) {
  if (doc?.error) throw apiError(doc.error, verb);
  return doc;
}

const missing = (errCode) => (e) => {
  if (e?.kind === "api" && e.errCode === errCode) return null;
  throw e;
};

// What this client creates must be NEW: an existing one with an identical configuration would be
// answered as if created, and this client would then believe it may delete somebody else's.
async function absent(js, what, path, notFound) {
  const found = await api(js, `${what} info`, path).catch(missing(notFound));
  if (found) throw refusedError(`${what} ${path.split(".").slice(2).join("/")} already exists: this client makes only one of its own, and never adopts one somebody else may own`);
}

// Its own: created here, or carrying this client's mark as the server reads it back now. Nothing
// unmarked is ever adopted, and a server that kept no metadata leaves the thing where it is.
async function owned(js, set, key, what, read) {
  if (set.has(key)) return;
  const metadata = js.o.mark ? (await read())?.config?.metadata : undefined;
  if (!js.o.mark || !Object.entries(js.o.mark).every(([k, v]) => metadata?.[k] === v)) throw refusedError(`${what} ${key} was not created by this client${js.o.mark ? " and does not carry its mark" : ""}, and this client deletes only what is its own`, { [what]: key });
}

// ── streams ────────────────────────────────────────────────────────────────

const STREAM_SPEC = [
  { key: "name", to: "name", as: (v) => checkedName(v, "stream name") },
  { key: "subjects", to: "subjects", as: (v) => [v].flat().map(checkedSubject) },
  { key: "storage", to: "storage", as: oneOf("storage", ["file", "memory"]) },
  { key: "retention", to: "retention", as: oneOf("retention", ["limits", "interest", "workqueue"]) },
  { key: "maxMsgs", to: "max_msgs", as: whole("maxMsgs") },
  { key: "maxBytes", to: "max_bytes", as: whole("maxBytes") },
  { key: "maxAgeMs", to: "max_age", as: nanos("maxAgeMs") },
  { key: "duplicateWindowMs", to: "duplicate_window", as: nanos("duplicateWindowMs") },
  { key: "discard", to: "discard", as: oneOf("discard", ["old", "new"]) },
  { key: "replicas", to: "num_replicas", as: whole("replicas") },
];

function streamConfig(spec = {}) {
  refuseUnknown("streamCreate", spec, STREAM_SPEC.map((r) => r.key));
  if (spec.name === undefined || spec.subjects === undefined) throw refusedError("streamCreate needs a name and the subjects it captures");
  return Object.fromEntries(STREAM_SPEC.filter((r) => spec[r.key] !== undefined).map((r) => [r.to, r.as(spec[r.key])]));
}

async function streamCreate(js, spec) {
  const config = withMark(js, streamConfig(spec));
  await absent(js, "stream", `STREAM.INFO.${config.name}`, 10059);
  const info = await api(js, "stream create", `STREAM.CREATE.${config.name}`, config);
  js.streams.add(config.name);
  return info;
}

const streamInfo = async (js, name) => api(js, "stream info", `STREAM.INFO.${checkedName(name, "stream name")}`);

// Deleting a stream deletes its consumers with it, so this client forgets those too.
async function streamDelete(js, name) {
  await owned(js, js.streams, checkedName(name, "stream name"), "stream", () => api(js, "stream info", `STREAM.INFO.${name}`));
  const done = await api(js, "stream delete", `STREAM.DELETE.${name}`);
  js.streams.delete(name);
  [...js.consumers].filter((key) => key.startsWith(`${name}/`)).forEach((key) => js.consumers.delete(key));
  return { deleted: done.success === true };
}

// ── consumers ──────────────────────────────────────────────────────────────

const CONSUMER_FIELDS = ["durable_name", "name", "description", "ack_policy", "ack_wait", "max_deliver", "backoff", "filter_subject", "filter_subjects", "deliver_policy", "opt_start_seq", "opt_start_time", "replay_policy", "max_ack_pending", "max_waiting", "max_batch", "max_expires", "inactive_threshold", "headers_only", "num_replicas", "mem_storage", "metadata"];

function nanosecondsAsSaid(field, v) {
  if (v === undefined) return;
  if (!Number.isSafeInteger(v) || v < NS_PER_MS) throw refusedError(`${field} is NANOSECONDS, and ${said(v)} is under a millisecond: 30 seconds is 30000000000`);
}

// The API's own fields, allow-listed; an explicit ack is the default, since what a test asks of a
// consumer is what each message's acknowledgement did.
function consumerConfig(spec = {}) {
  refuseUnknown("consumerCreate", spec, CONSUMER_FIELDS);
  [spec.durable_name, spec.name].filter((v) => v !== undefined).forEach((v) => checkedName(v, "consumer name"));
  [spec.filter_subject, ...(spec.filter_subjects ?? [])].filter((v) => v !== undefined).forEach((v) => checkedSubject(v));
  nanosecondsAsSaid("ack_wait", spec.ack_wait);
  return { ack_policy: "explicit", ...spec };
}

// Named: `$JS.API.CONSUMER.CREATE.<stream>.<name>`, once nothing by that name exists. Unnamed:
// `$JS.API.CONSUMER.CREATE.<stream>`, and the server names an ephemeral one.
async function consumerCreate(js, stream, spec) {
  const config = withMark(js, consumerConfig(spec));
  const name = config.name ?? config.durable_name;
  if (name) await absent(js, "consumer", `CONSUMER.INFO.${checkedName(stream, "stream name")}.${name}`, 10014);
  const info = await api(js, "consumer create", `CONSUMER.CREATE.${checkedName(stream, "stream name")}${name ? `.${name}` : ""}`, { stream_name: stream, config, action: "create" });
  return ownedConsumer(js, stream, info);
}

function ownedConsumer(js, stream, info) {
  js.consumers.add(`${stream}/${info.name}`);
  return info;
}

const consumerInfo = async (js, stream, name) => api(js, "consumer info", `CONSUMER.INFO.${checkedName(stream, "stream name")}.${checkedName(name, "consumer name")}`);

async function consumerDelete(js, stream, name) {
  const key = `${checkedName(stream, "stream name")}/${checkedName(name, "consumer name")}`;
  await owned(js, js.consumers, key, "consumer", () => api(js, "consumer info", `CONSUMER.INFO.${stream}.${name}`));
  const done = await api(js, "consumer delete", `CONSUMER.DELETE.${stream}.${name}`);
  js.consumers.delete(key);
  return { deleted: done.success === true };
}

// ── publishing ─────────────────────────────────────────────────────────────

// A publication the stream answers: {stream, seq, duplicate}. A `msgId` rides as Nats-Msg-Id, and
// inside the stream's duplicate window a second one is dropped and answered with the FIRST one's
// sequence and duplicate: true. A 503 is no stream capturing the subject: nothing kept it.
async function publishAck(js, subject, payload, o = {}) {
  const reply = await js.conn.request(subject, payload, { headers: o.headers, msgId: o.msgId, timeoutMs: o.timeoutMs ?? js.o.timeoutMs }).catch(unacked({ subject, msgId: o.msgId }));
  if (reply.status === 503) throw refusedError(`no stream captures ${subject}: the publish was answered 503 no responders, so nothing kept it`, { subject, status: 503 });
  const doc = judged(parsed(reply.data, "publish"), "publish");
  return { stream: doc.stream, seq: doc.seq, duplicate: doc.duplicate === true };
}

// Only an end that came AFTER the bytes may have left is ambiguous -- the stream may have kept it,
// and only a read-back (readRange) can say. A refusal, a denial, or a connection already gone
// sent nothing.
const AMBIGUOUS = ["timeout", "closed", "transport"];

const unacked = (sent) => (e) => {
  throw AMBIGUOUS.includes(e?.kind) && e.sent !== false ? ambiguousError(sent, e) : e;
};

// ── pulling ────────────────────────────────────────────────────────────────

// A pull: `$JS.API.CONSUMER.MSG.NEXT.<stream>.<consumer>` with {batch, expires (ns)} -- or
// no_wait -- answered on a collector's own inbox. It ends when the batch is full, on a 404
// (nothing to deliver) or 408 (the pull expired), or on this client's own clock `graceMs` after
// `expiresMs`. A 503 (no such consumer) or any other status is refused, carrying what had
// arrived. A status 100 is a heartbeat and ends nothing.
async function fetch(js, stream, consumer, o = {}) {
  const pull = pullOf(js, stream, consumer, o);
  return new Promise((resolve, reject) => pulling(js, { ...pull, resolve, reject }));
}

const pullOf = (js, stream, consumer, o) => ({ subject: `${js.o.prefix}.CONSUMER.MSG.NEXT.${checkedName(stream, "stream name")}.${checkedName(consumer, "consumer name")}`, batch: counted("batch", MAX_BATCH)(o.batch ?? 1), expiresMs: o.expiresMs ?? 5000, noWait: o.noWait === true, messages: [], done: false });

const pullRequest = (p) => (p.noWait ? { batch: p.batch, no_wait: true } : { batch: p.batch, expires: Math.round(p.expiresMs * NS_PER_MS) });

function pulling(js, p) {
  p.collector = js.conn.collect({ about: p.subject, onMessage: (m) => pulledOne(js, p, m), onEnd: (e) => pullEnded(js, p, e), onError: (e) => pullEnded(js, p, e) });
  p.timer = js.conn.timers.setTimeout(() => pullEnded(js, p, "clock"), p.expiresMs + js.o.graceMs);
  js.conn.publish(p.subject, JSON.stringify(pullRequest(p)), { reply: p.collector.reply });
}

function pulledOne(js, p, m) {
  if (m.status) return pullStatus(js, p, m);
  p.messages.push(fetched(m));
  if (p.messages.length >= p.batch) pullEnded(js, p, "batch");
}

const PULL_STATUS = [
  { when: (s) => s === 100, then: () => undefined },
  { when: (s) => s === 404, then: () => "no-messages" },
  { when: (s) => s === 408, then: () => "expired" },
  { when: (s) => s === 503, then: (m, p) => refusedError(`nothing answered ${p.subject} (503 no responders): there is no such consumer, or JetStream is not enabled`, { status: 503 }) },
  { when: () => true, then: (m) => refusedError(`the server ended the pull: ${m.status} ${m.description}`.trim(), { status: m.status, description: m.description }) },
];

function pullStatus(js, p, m) {
  const outcome = PULL_STATUS.find((r) => r.when(m.status)).then(m, p);
  if (outcome !== undefined) pullEnded(js, p, outcome);
}

function pullEnded(js, p, outcome) {
  if (p.done) return;
  p.done = true;
  js.conn.timers.clearTimeout(p.timer);
  p.collector.stop();
  concluded(p, outcome);
}

// An error a pull ends on is its own copy: the connection's end is one object every pull shares.
const concluded = (p, outcome) => (outcome instanceof Error ? p.reject(Object.assign(new NatsError(outcome.kind ?? "protocol", outcome.message, { ...outcome, cause: outcome }), { messages: p.messages })) : p.resolve({ messages: p.messages, ended: outcome }));

const fetched = (m) => ({ subject: m.subject, reply: m.reply, headers: m.headers, data: m.data, info: parseAck(m.reply) });

// ── acknowledging ──────────────────────────────────────────────────────────

// What each acknowledgement says, as the body published to the message's $JS.ACK subject. A nak's
// delay is milliseconds here and nanoseconds on the wire.
const ACKS = {
  ack: () => "+ACK",
  nak: (o) => (o.delayMs ? `-NAK ${JSON.stringify({ delay: Math.round(o.delayMs * NS_PER_MS) })}` : "-NAK"),
  term: (o) => (o.reason ? `+TERM ${o.reason}` : "+TERM"),
  inProgress: () => "+WPI",
};

// `confirm` asks the server to answer once it has APPLIED the acknowledgement (a double ack);
// without it the body is only written, and a fetch straight after may race it.
const ACK_SEND = {
  written: (js, reply, body) => js.conn.publish(reply, body),
  confirmed: (js, reply, body, o) => js.conn.request(reply, body, { timeoutMs: o.timeoutMs ?? js.o.timeoutMs }),
};

async function acknowledged(js, kind, msg, o = {}) {
  const info = parseAck(msg?.reply);
  if (!info) throw refusedError(`${kind}: this message has no $JS.ACK reply subject to answer`);
  await ACK_SEND[o.confirm ? "confirmed" : "written"](js, msg.reply, ACKS[kind](o), o);
  return { [kind]: info.streamSeq, confirmed: o.confirm === true };
}

// The $JS.ACK reply subject IS the delivery's metadata, in one of two layouts:
//   $JS.ACK.<stream>.<consumer>.<delivered>.<stream seq>.<consumer seq>.<timestamp ns>.<pending>
//   $JS.ACK.<domain>.<account hash>.<stream>.<consumer>.<delivered>.<stream seq>.<consumer seq>.<timestamp ns>.<pending>[.<token>]
// the first nine tokens, the second eleven or more, where a domain of "_" is none. `deliveredCount`
// is 1 on the first delivery and 2 on the first redelivery; `pending` is what the consumer still
// has to deliver after this one.
const ACK_LAYOUTS = [
  { when: (t) => t.length === 9, at: 2, domain: null },
  { when: (t) => t.length >= 11, at: 4, domain: 2 },
];

const NUMERIC = [2, 3, 4, 5, 6];
const DIGITS = /^\d+$/;

export function parseAck(reply) {
  const t = String(reply ?? "").split(".");
  const row = t[0] === "$JS" && t[1] === "ACK" ? ACK_LAYOUTS.find((r) => r.when(t)) : undefined;
  return row && NUMERIC.every((i) => DIGITS.test(t[row.at + i] ?? "")) ? ackInfo(t, row) : null;
}

function ackInfo(t, row) {
  const n = (i) => Number(t[row.at + i]);
  return { domain: row.domain === null || t[row.domain] === "_" ? null : t[row.domain], account: row.domain === null ? null : t[row.domain + 1], stream: t[row.at], consumer: t[row.at + 1], deliveredCount: n(2), streamSeq: n(3), consumerSeq: n(4), timestampNs: t[row.at + 5], time: timeOf(t[row.at + 5]), pending: n(6) };
}

function timeOf(ns) {
  const ms = Number(BigInt(ns) / 1_000_000n);
  return ms <= 8.64e15 ? new Date(ms).toISOString() : null;
}

// ── observing ──────────────────────────────────────────────────────────────

// A stream's messages from `fromSeq`, read with $JS.API.STREAM.MSG.GET and `next_by_subj`, so a gap
// is skipped rather than read as the end. Nothing is created on the server and no consumer moves:
// no delivery, no redelivery count, no ack floor -- on any retention, a work queue's too.
// `complete` says the end was reached; `truncated` that `max` stopped it first.
async function readRange(js, stream, o = {}) {
  const r = { stream: checkedName(stream, "stream name"), seq: counted("fromSeq", Number.MAX_SAFE_INTEGER)(o.fromSeq ?? 1), max: counted("max", MAX_RANGE)(o.max ?? 100), filter: o.filter === undefined ? ">" : checkedSubject(o.filter), messages: [] };
  return readOn(js, r);
}

async function readOn(js, r) {
  const got = await api(js, "stream message get", `STREAM.MSG.GET.${r.stream}`, { seq: r.seq, next_by_subj: r.filter }).catch(missing(10037));
  if (!got) return rangeOf(r, true);
  r.messages.push(stored(got.message));
  r.seq = got.message.seq + 1;
  return r.messages.length >= r.max ? rangeOf(r, false) : readOn(js, r);
}

const rangeOf = (r, complete) => ({ stream: r.stream, messages: r.messages, through: r.messages.at(-1)?.seq ?? null, next: r.seq, complete, truncated: !complete });

const stored = (m) => ({ subject: m.subject, seq: m.seq, time: m.time ?? null, headers: m.hdrs ? decodeHeaders(Buffer.from(m.hdrs, "base64")).headers : null, data: Buffer.from(m.data ?? "", "base64") });

// ── what a JetStream context offers ────────────────────────────────────────

const OPS = {
  streamCreate,
  streamInfo,
  streamDelete,
  consumerCreate,
  consumerInfo,
  consumerDelete,
  publishAck,
  fetch,
  readRange,
  ack: (js, msg, o) => acknowledged(js, "ack", msg, o),
  nak: (js, msg, o) => acknowledged(js, "nak", msg, o),
  term: (js, msg, o) => acknowledged(js, "term", msg, o),
  inProgress: (js, msg, o) => acknowledged(js, "inProgress", msg, o),
  owned: (js) => ({ streams: [...js.streams], consumers: [...js.consumers] }),
};
