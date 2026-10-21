// A content header: the class, the body size and the basic class's
// properties, present when their flag is set. The flags run from bit 15 down
// in the order of PROPERTIES (AMQP 0-9-1 §4.2.6.1), so the order IS the codec.
import { ARGS, READ, reader, u16, u64 } from "./table.mjs";

export const PROPERTIES = [
  ["contentType", "shortstr"],
  ["contentEncoding", "shortstr"],
  ["headers", "table"],
  ["deliveryMode", "octet"],
  ["priority", "octet"],
  ["correlationId", "shortstr"],
  ["replyTo", "shortstr"],
  ["expiration", "shortstr"],
  ["messageId", "shortstr"],
  ["timestamp", "timestamp"],
  ["type", "shortstr"],
  ["userId", "shortstr"],
  ["appId", "shortstr"],
  ["clusterId", "shortstr"],
].map(([name, type], i) => ({ name, type, flag: 1 << (15 - i) }));

const present = (properties) => PROPERTIES.filter((p) => properties[p.name] !== undefined && properties[p.name] !== null);

export function encodeHeader(classId, bodySize, properties = {}) {
  const set = present(properties);
  const flags = set.reduce((f, p) => f | p.flag, 0);
  return Buffer.concat([u16(classId), u16(0), u64(bodySize), u16(flags), ...set.map((p) => ARGS[p.type].enc(properties[p.name]))]);
}

export function decodeHeader(payload) {
  const r = reader(payload);
  const head = { classId: READ.u16(r), weight: READ.u16(r), bodySize: Number(READ.u64(r)), flags: READ.u16(r) };
  const properties = Object.fromEntries(PROPERTIES.filter((p) => head.flags & p.flag).map((p) => [p.name, ARGS[p.type].dec(r)]));
  return { classId: head.classId, bodySize: head.bodySize, properties };
}
