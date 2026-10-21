// The values AMQP 0-9-1 carries, encoded and decoded as tables keyed on the
// type: the specification's method-argument types (ARGS) and the field-table
// value types of RabbitMQ's errata, which every broker of the protocol accepts
// (t b B s u I i l f d D S A T F V x). A new type is a row, never a branch.
import { protocolError } from "./errors.mjs";

const TYPED = Symbol("amqp.typed");

function sized(n, write) {
  const b = Buffer.alloc(n);
  write(b);
  return b;
}

export const u8 = (v) => sized(1, (b) => b.writeUInt8(v));
export const i8 = (v) => sized(1, (b) => b.writeInt8(v));
export const u16 = (v) => sized(2, (b) => b.writeUInt16BE(v));
export const i16 = (v) => sized(2, (b) => b.writeInt16BE(v));
export const u32 = (v) => sized(4, (b) => b.writeUInt32BE(v));
export const i32 = (v) => sized(4, (b) => b.writeInt32BE(v));
export const u64 = (v) => sized(8, (b) => b.writeBigUInt64BE(BigInt(v)));
export const i64 = (v) => sized(8, (b) => b.writeBigInt64BE(BigInt(v)));
export const f32 = (v) => sized(4, (b) => b.writeFloatBE(v));
export const f64 = (v) => sized(8, (b) => b.writeDoubleBE(v));

const bytesOf = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(String(v ?? ""), "utf8"));
export const withLength = (b) => Buffer.concat([u32(b.length), b]);
export const longstr = (v) => withLength(bytesOf(v));

export function shortstr(v) {
  const b = bytesOf(v);
  if (b.length > 255) throw new RangeError(`an AMQP short string holds 255 bytes, not ${b.length}`);
  return Buffer.concat([u8(b.length), b]);
}

// A cursor over one buffer. Reading past its end is a PROTOCOL error: the
// broker sent less than the frame said it would.
export const reader = (buf) => ({ buf, at: 0 });
const exhausted = (r) => r.at >= r.buf.length;

function take(r, n, read) {
  if (r.at + n > r.buf.length) throw protocolError(`truncated: ${n} more bytes needed at offset ${r.at} of ${r.buf.length}`);
  const v = read(r.buf, r.at);
  r.at += n;
  return v;
}

export const READ = {
  u8: (r) => take(r, 1, (b, at) => b.readUInt8(at)),
  i8: (r) => take(r, 1, (b, at) => b.readInt8(at)),
  u16: (r) => take(r, 2, (b, at) => b.readUInt16BE(at)),
  i16: (r) => take(r, 2, (b, at) => b.readInt16BE(at)),
  u32: (r) => take(r, 4, (b, at) => b.readUInt32BE(at)),
  i32: (r) => take(r, 4, (b, at) => b.readInt32BE(at)),
  u64: (r) => take(r, 8, (b, at) => b.readBigUInt64BE(at)),
  i64: (r) => take(r, 8, (b, at) => b.readBigInt64BE(at)),
  f32: (r) => take(r, 4, (b, at) => b.readFloatBE(at)),
  f64: (r) => take(r, 8, (b, at) => b.readDoubleBE(at)),
};

export const readBytes = (r, n) => take(r, n, (b, at) => Buffer.from(b.subarray(at, at + n)));
export const readShortstr = (r) => readBytes(r, READ.u8(r)).toString("utf8");
export const readLongbytes = (r) => readBytes(r, READ.u32(r));

// 64-bit integers come back as numbers while they are exact, as BigInt after.
const asNumber = (big) => (Number.isSafeInteger(Number(big)) ? Number(big) : big);
const secondsOf = (v) => (v instanceof Date ? Math.floor(v.getTime() / 1000) : v);
const dateOf = (r) => new Date(Number(READ.u64(r)) * 1000);

const VALUES = {
  t: { enc: (v) => u8(v ? 1 : 0), dec: (r) => READ.u8(r) !== 0 },
  b: { enc: i8, dec: READ.i8 },
  B: { enc: u8, dec: READ.u8 },
  s: { enc: i16, dec: READ.i16 },
  u: { enc: u16, dec: READ.u16 },
  I: { enc: i32, dec: READ.i32 },
  i: { enc: u32, dec: READ.u32 },
  l: { enc: i64, dec: (r) => asNumber(READ.i64(r)) },
  f: { enc: f32, dec: READ.f32 },
  d: { enc: f64, dec: READ.f64 },
  D: { enc: (v) => Buffer.concat([u8(v.scale), u32(v.value)]), dec: (r) => ({ scale: READ.u8(r), value: READ.u32(r) }) },
  S: { enc: longstr, dec: (r) => readLongbytes(r).toString("utf8") },
  A: { enc: (v) => withLength(Buffer.concat(v.map((item) => fieldValue(item)))), dec: (r) => readArray(r) },
  T: { enc: (v) => u64(secondsOf(v)), dec: dateOf },
  F: { enc: (v) => encodeTable(v), dec: (r) => decodeTable(r) },
  V: { enc: () => Buffer.alloc(0), dec: () => null },
  x: { enc: longstr, dec: readLongbytes },
};

// Which type a plain JS value travels as, first match wins. `typed(type, v)`
// says it explicitly, for the types no JS value implies (b B s u i f D).
const isInt32 = (v) => v >= -2147483648 && v <= 2147483647;
const TYPE_OF = [
  { when: (v) => v === null || v === undefined, type: () => "V" },
  { when: (v) => typeof v === "object" && TYPED in v, type: (v) => v[TYPED] },
  { when: (v) => typeof v === "boolean", type: () => "t" },
  { when: (v) => Buffer.isBuffer(v), type: () => "x" },
  { when: (v) => Array.isArray(v), type: () => "A" },
  { when: (v) => v instanceof Date, type: () => "T" },
  { when: (v) => typeof v === "bigint", type: () => "l" },
  { when: (v) => Number.isInteger(v) && isInt32(v), type: () => "I" },
  { when: (v) => Number.isInteger(v), type: () => "l" },
  { when: (v) => typeof v === "number", type: () => "d" },
  { when: (v) => typeof v === "string", type: () => "S" },
  { when: (v) => typeof v === "object", type: () => "F" },
];

export const typed = (type, value) => ({ [TYPED]: type, value });
const valueOf = (v) => (v !== null && typeof v === "object" && TYPED in v ? v.value : v);

export function fieldValue(v) {
  const type = TYPE_OF.find((rule) => rule.when(v))?.type(v);
  if (!VALUES[type]) throw new TypeError(`no AMQP field type carries a ${typeof v}${type ? ` (asked for '${type}')` : ""}`);
  return Buffer.concat([u8(type.charCodeAt(0)), VALUES[type].enc(valueOf(v))]);
}

export const encodeTable = (t) => withLength(Buffer.concat(Object.entries(t ?? {}).map(([k, v]) => Buffer.concat([shortstr(k), fieldValue(v)]))));

// Entries are collected and then made an object, so a broker's `__proto__`
// key is an own property and never a prototype.
export function decodeTable(r) {
  const body = reader(readLongbytes(r));
  const entries = [];
  while (!exhausted(body)) entries.push([readShortstr(body), readField(body)]);
  return Object.fromEntries(entries);
}

function readArray(r) {
  const body = reader(readLongbytes(r));
  const items = [];
  while (!exhausted(body)) items.push(readField(body));
  return items;
}

export function readField(r) {
  const type = String.fromCharCode(READ.u8(r));
  if (!VALUES[type]) throw protocolError(`unknown field-table value type '${type}'`);
  return VALUES[type].dec(r);
}

export const FIELD_TYPES = Object.keys(VALUES);

// The method-argument types. `zero` is what an argument nobody gave is sent as.
export const ARGS = {
  octet: { enc: u8, dec: READ.u8, zero: 0 },
  short: { enc: u16, dec: READ.u16, zero: 0 },
  long: { enc: u32, dec: READ.u32, zero: 0 },
  longlong: { enc: u64, dec: (r) => asNumber(READ.u64(r)), zero: 0 },
  shortstr: { enc: shortstr, dec: readShortstr, zero: "" },
  longstr: { enc: longstr, dec: (r) => readLongbytes(r).toString("utf8"), zero: "" },
  table: { enc: encodeTable, dec: decodeTable, zero: {} },
  timestamp: { enc: (v) => u64(secondsOf(v)), dec: dateOf, zero: 0 },
};
