// The NATS client protocol, as DATA: the operations each side may send, how each one's
// arguments are read, and a streaming parser that turns bytes into operations.
//
// NATS is a text protocol of CRLF-terminated control lines, and four operations carry a
// payload of an exact byte count after their line: MSG and HMSG from the server, PUB and HPUB
// from a client. A payload is read by its COUNT, never by looking for a CRLF inside it, so a
// binary body holding "\r\n" is a body. HMSG and HPUB carry a header block first -- a
// `NATS/1.0` line, optionally with a status code (503 no responders, 404 no messages, 408
// request timeout, 409, 100 idle heartbeat) and a description, then `Key: Value` lines and a
// blank line -- counted inside the total.
//
// The operation tables are keyed by name: SERVER_OPS is what a client reads, CLIENT_OPS what
// a server reads (the test peer uses it). A line naming no operation of the table, a count
// that is not a number, or a line or payload past its bound is a protocol error, never a guess.
import { protocolError, refusedError } from "./errors.mjs";

export const CRLF = "\r\n";
export const HEADER_VERSION = "NATS/1.0";
export const MAX_CONTROL_LINE = 4096;
export const MAX_PAYLOAD = 64 * 1024 * 1024;

const CRLF_BYTES = Buffer.from(CRLF);

// A subject, a queue group or a header is never allowed to carry what would end its line or
// split its tokens: that would be a second operation written by whoever chose the name.
const UNSAFE = /[\s\u0000-\u001f\u007f]/;

export function checkedSubject(subject) {
  if (typeof subject !== "string" || !subject || UNSAFE.test(subject)) throw refusedError(`"${String(subject).slice(0, 60)}" is not a subject: a subject is one token string with no whitespace or control character`);
  return subject;
}

// ── encoding ───────────────────────────────────────────────────────────────

const BODIES = [
  { when: (b) => Buffer.isBuffer(b), as: (b) => b },
  { when: (b) => b instanceof Uint8Array, as: (b) => Buffer.from(b) },
  { when: (b) => b === undefined || b === null, as: () => Buffer.alloc(0) },
  { when: (b) => typeof b === "string", as: (b) => Buffer.from(b, "utf8") },
  { when: () => true, as: (b) => Buffer.from(JSON.stringify(b), "utf8") },
];

export const asBytes = (b) => BODIES.find((r) => r.when(b)).as(b);

const line = (text) => Buffer.from(`${text}${CRLF}`);

export const connectOp = (options) => line(`CONNECT ${JSON.stringify(options)}`);
export const infoOp = (info) => line(`INFO ${JSON.stringify(info)}`);
export const pingOp = () => line("PING");
export const pongOp = () => line("PONG");
export const okOp = () => line("+OK");
export const errOp = (text) => line(`-ERR '${text}'`);
export const subOp = (subject, sid, queue) => line(`SUB ${checkedSubject(subject)}${queue ? ` ${checkedSubject(queue)}` : ""} ${sid}`);
export const unsubOp = (sid, max) => line(`UNSUB ${sid}${max ? ` ${max}` : ""}`);

// PUB, or HPUB when there are headers: one buffer, so a message's line, headers and body never
// interleave with another's on the socket.
export function pubOp(subject, payload, o = {}) {
  const body = asBytes(payload);
  const head = o.headers || o.status ? encodeHeaders(o.headers ?? {}, o.status) : null;
  const reply = o.reply ? ` ${checkedSubject(o.reply)}` : "";
  const control = head ? `HPUB ${checkedSubject(subject)}${reply} ${head.length} ${head.length + body.length}` : `PUB ${checkedSubject(subject)}${reply} ${body.length}`;
  return Buffer.concat([line(control), ...(head ? [head] : []), body, CRLF_BYTES]);
}

// What a server sends a subscriber: MSG, or HMSG when there are headers or a status.
export function msgOp(subject, sid, payload, o = {}) {
  const body = asBytes(payload);
  const head = o.headers || o.status ? encodeHeaders(o.headers ?? {}, o.status) : null;
  const reply = o.reply ? ` ${o.reply}` : "";
  const control = head ? `HMSG ${subject} ${sid}${reply} ${head.length} ${head.length + body.length}` : `MSG ${subject} ${sid}${reply} ${body.length}`;
  return Buffer.concat([line(control), ...(head ? [head] : []), body, CRLF_BYTES]);
}

// ── headers ────────────────────────────────────────────────────────────────

const HEADER_KEY = /^[!#-9;-~]+$/;

export function encodeHeaders(headers, status) {
  const first = status ? `${HEADER_VERSION} ${status.code}${status.description ? ` ${status.description}` : ""}` : HEADER_VERSION;
  const lines = Object.entries(headers ?? {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((one) => headerLine(k, one)));
  return Buffer.from(`${[first, ...lines].join(CRLF)}${CRLF}${CRLF}`);
}

function headerLine(key, value) {
  if (!HEADER_KEY.test(key) || /[\r\n\u0000]/.test(String(value))) throw refusedError(`header ${String(key).slice(0, 40)} cannot be sent: a key is one token and a value holds no line break`);
  return `${key}: ${value}`;
}

// A header block, read back: the status line's code and description, and every header -- a
// key that repeats keeps all its values, in order.
export function decodeHeaders(buf) {
  const lines = buf.toString("utf8").split(CRLF);
  if (!lines[0].startsWith(HEADER_VERSION)) throw protocolError(`a header block that does not start with ${HEADER_VERSION}`);
  const status = statusOf(lines[0].slice(HEADER_VERSION.length).trim());
  return { ...status, headers: lines.slice(1).filter(Boolean).reduce(added, {}) };
}

function statusOf(rest) {
  const m = /^(\d{3})(?:\s+(.*))?$/.exec(rest);
  return m ? { status: Number(m[1]), description: m[2] ?? "" } : { status: null, description: "" };
}

function added(headers, text) {
  const at = text.indexOf(":");
  if (at <= 0) return headers;
  const key = text.slice(0, at).trim();
  const value = text.slice(at + 1).trim();
  return { ...headers, [key]: headers[key] === undefined ? value : [...[headers[key]].flat(), value] };
}

// ── parsing ────────────────────────────────────────────────────────────────

const size = (token) => {
  if (!/^\d+$/.test(String(token ?? ""))) throw protocolError(`"${String(token).slice(0, 20)}" is not a byte count`);
  return Number(token);
};

// The tokens of each payload operation, by how many there are: the reply subject is the one
// optional token, so its presence is read off the count.
const PAYLOAD_LAYOUTS = {
  MSG: { 3: ["subject", "sid", null, "total"], 4: ["subject", "sid", "reply", "total"] },
  HMSG: { 4: ["subject", "sid", null, "headerBytes", "total"], 5: ["subject", "sid", "reply", "headerBytes", "total"] },
  PUB: { 2: ["subject", null, "total"], 3: ["subject", "reply", "total"] },
  HPUB: { 3: ["subject", null, "headerBytes", "total"], 4: ["subject", "reply", "headerBytes", "total"] },
};

function payloadArgs(name, tokens) {
  const layout = PAYLOAD_LAYOUTS[name][tokens.length];
  if (!layout) throw protocolError(`${name} with ${tokens.length} arguments`);
  const args = Object.fromEntries(layout.map((k, i) => [k, tokens[i]]).filter(([k]) => k));
  return { ...args, sid: args.sid, reply: args.reply ?? null, headerBytes: args.headerBytes === undefined ? 0 : size(args.headerBytes), total: size(args.total) };
}

const jsonArgs = (field) => (tokens, rest) => {
  try { return { [field]: JSON.parse(rest) }; }
  catch { throw protocolError(`a ${field} that is not JSON`); }
};

const errText = (tokens, rest) => ({ text: rest.replace(/^'(.*)'$/s, "$1") });
const none = () => ({});

const subArgs = (tokens) => (tokens.length === 3 ? { subject: tokens[0], queue: tokens[1], sid: tokens[2] } : { subject: tokens[0], queue: null, sid: tokens[1] });

export const SERVER_OPS = {
  INFO: { args: jsonArgs("info") },
  MSG: { payload: true, args: (t) => payloadArgs("MSG", t) },
  HMSG: { payload: true, args: (t) => payloadArgs("HMSG", t) },
  "+OK": { args: none },
  "-ERR": { args: errText },
  PING: { args: none },
  PONG: { args: none },
};

export const CLIENT_OPS = {
  CONNECT: { args: jsonArgs("options") },
  PUB: { payload: true, args: (t) => payloadArgs("PUB", t) },
  HPUB: { payload: true, args: (t) => payloadArgs("HPUB", t) },
  SUB: { args: subArgs },
  UNSUB: { args: (t) => ({ sid: t[0], max: t[1] === undefined ? null : size(t[1]) }) },
  PING: { args: none },
  PONG: { args: none },
};

// Bytes in, operations out, as they complete: a chunk may hold half a line, three operations,
// or a payload that ends two chunks later. `onOp` gets `{op, ...args}`, and a payload operation
// also gets `data` (the body) and, for HMSG/HPUB, the decoded `headers`, `status` and
// `description`.
export function createParser(onOp, ops = SERVER_OPS) {
  const st = { buffer: Buffer.alloc(0), need: null, onOp, ops };
  return { push: (chunk) => drained(st, chunk) };
}

function drained(st, chunk) {
  st.buffer = st.buffer.length ? Buffer.concat([st.buffer, chunk]) : Buffer.from(chunk);
  while (stepped(st));
}

const stepped = (st) => (st.need ? payloadStep(st) : lineStep(st));

function lineStep(st) {
  const at = st.buffer.indexOf(CRLF_BYTES);
  if (at < 0) return guardLine(st.buffer.length);
  const text = st.buffer.subarray(0, at).toString("utf8");
  st.buffer = st.buffer.subarray(at + 2);
  return lined(st, text);
}

function guardLine(length) {
  if (length > MAX_CONTROL_LINE) throw protocolError(`a control line longer than ${MAX_CONTROL_LINE} bytes`);
  return false;
}

function lined(st, text) {
  const name = (/^\S+/.exec(text)?.[0] ?? "").toUpperCase();
  const row = st.ops[name];
  if (!row) throw protocolError(`"${text.slice(0, 40)}" is no operation this side reads`);
  const rest = text.slice(name.length).trim();
  return row.payload ? awaitPayload(st, name, row.args(rest.split(/\s+/).filter(Boolean), rest)) : emitted(st, { op: name, ...row.args(rest.split(/\s+/).filter(Boolean), rest) });
}

function awaitPayload(st, name, args) {
  if (args.total > MAX_PAYLOAD || args.headerBytes > args.total) throw protocolError(`${name} announces ${args.total} bytes with ${args.headerBytes} of headers, past what this client reads`);
  st.need = { op: name, ...args };
  return true;
}

function payloadStep(st) {
  const n = st.need;
  if (st.buffer.length < n.total + 2) return false;
  if (st.buffer[n.total] !== 13 || st.buffer[n.total + 1] !== 10) throw protocolError(`${n.op} payload not followed by CRLF at byte ${n.total}`);
  const bytes = Buffer.from(st.buffer.subarray(0, n.total));
  st.buffer = st.buffer.subarray(n.total + 2);
  return emittedPayload(st, n, bytes);
}

function emittedPayload(st, n, bytes) {
  st.need = null;
  const head = n.headerBytes ? decodeHeaders(bytes.subarray(0, n.headerBytes)) : { status: null, description: "", headers: null };
  return emitted(st, { op: n.op, subject: n.subject, sid: n.sid, reply: n.reply, headers: head.headers, status: head.status, description: head.description, data: bytes.subarray(n.headerBytes) });
}

function emitted(st, op) {
  st.onOp(op);
  return true;
}
