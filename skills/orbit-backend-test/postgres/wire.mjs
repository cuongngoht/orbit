// The PostgreSQL frontend/backend protocol 3.0, as bytes: the messages this client sends, and a
// STREAMING reader of what the server sends -- a socket hands over whatever bytes arrived, half a
// message included, and the reader keeps the rest for the next chunk.
//
// Only what a read below the interface needs: startup, a SASL message, a simple
// query, and one parameterized statement (Parse, Bind, Describe, Execute, Sync). Every parameter
// travels as a parameter, in text format: a value is never text in a query.
export const PROTOCOL_VERSION = 196608;
const MAX_MESSAGE = 1 << 26;

export const int32 = (n) => ((b) => (b.writeInt32BE(n), b))(Buffer.alloc(4));
export const int16 = (n) => ((b) => (b.writeInt16BE(n), b))(Buffer.alloc(2));
export const cstr = (s) => Buffer.concat([Buffer.from(String(s), "utf8"), Buffer.from([0])]);

// One typed message: its type byte, its length (which counts itself) and its body.
export const message = (type, body = Buffer.alloc(0)) => Buffer.concat([Buffer.from(type, "latin1"), int32(body.length + 4), body]);

// The startup message has no type byte: its length, the protocol version, and name/value pairs.
export function startupMessage(params) {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null).flatMap(([k, v]) => [cstr(k), cstr(v)]);
  const body = Buffer.concat([int32(PROTOCOL_VERSION), ...pairs, Buffer.from([0])]);
  return Buffer.concat([int32(body.length + 4), body]);
}

export const saslInitial = (mechanism, first) => ((data) => message("p", Buffer.concat([cstr(mechanism), int32(data.length), data])))(Buffer.from(first, "utf8"));
export const saslResponse = (text) => message("p", Buffer.from(text, "utf8"));
export const simpleQuery = (sql) => message("Q", cstr(sql));
export const terminate = () => message("X");

// One statement, unnamed, its parameters as text (a null is length -1), every column as text.
export function statement(sql, params = []) {
  const values = params.flatMap((p) => (p === null || p === undefined ? [int32(-1)] : ((b) => [int32(b.length), b])(Buffer.from(String(p), "utf8"))));
  const bind = message("B", Buffer.concat([cstr(""), cstr(""), int16(0), int16(params.length), ...values, int16(0)]));
  return Buffer.concat([message("P", Buffer.concat([cstr(""), cstr(sql), int16(0)])), bind, message("D", Buffer.concat([Buffer.from("P", "latin1"), cstr("")])), message("E", Buffer.concat([cstr(""), int32(0)])), message("S")]);
}

// ── reading ────────────────────────────────────────────────────────────────

export function createReader(onMessage, maxMessage = MAX_MESSAGE) {
  const state = { buf: Buffer.alloc(0), maxMessage };
  return { push: (chunk) => drained(state, Buffer.concat([state.buf, chunk]), onMessage) };
}

// What remains is saved BEFORE a message is handed on, so a handler that throws never leaves a
// message it already consumed to be read a second time.
function drained(state, buf, onMessage) {
  state.buf = buf;
  for (let m = nextOf(state); m; m = nextOf(state)) {
    state.buf = state.buf.subarray(m.size);
    onMessage(m.message);
  }
}

function nextOf(state) {
  if (state.buf.length < 5) return null;
  const length = state.buf.readInt32BE(1);
  if (length < 4 || length > state.maxMessage) throw Object.assign(new Error(`a ${length}-byte message is not one this client reads`), { kind: "protocol" });
  return state.buf.length < length + 1 ? null : { size: length + 1, message: { type: String.fromCharCode(state.buf[0]), body: state.buf.subarray(5, length + 1) } };
}

// ErrorResponse and NoticeResponse: one-letter field codes, each a C string.
export function fieldsOf(body) {
  const out = {};
  for (let at = 0; at < body.length && body[at] !== 0; at = body.indexOf(0, at + 1) + 1) out[String.fromCharCode(body[at])] = body.subarray(at + 1, body.indexOf(0, at + 1)).toString("utf8");
  return out;
}

// RowDescription: how many columns, then each one's name and six fixed fields.
export function columnsOf(body) {
  const names = [];
  for (let at = 2, n = 0; n < body.readInt16BE(0); n++, at = body.indexOf(0, at) + 19) names.push(body.subarray(at, body.indexOf(0, at)).toString("utf8"));
  return names;
}

// DataRow: how many values, then each one's length (-1 for null) and its text.
export function valuesOf(body) {
  const values = [];
  for (let at = 2, n = 0; n < body.readInt16BE(0); n++) at = valueAt(body, at, values);
  return values;
}

function valueAt(body, at, values) {
  const length = body.readInt32BE(at);
  values.push(length < 0 ? null : body.subarray(at + 4, at + 4 + length).toString("utf8"));
  return at + 4 + Math.max(length, 0);
}

export const authCodeOf = (body) => body.readInt32BE(0);

// The mechanisms a server offers for SASL: C strings, ended by an empty one.
export const mechanismsOf = (body) => body.subarray(4).toString("utf8").split("\0").filter(Boolean);
