// The AMQP 0-9-1 methods this client speaks, as DATA: one row per method with
// its class and method ids, its arguments in wire order, whether content
// frames follow it, and -- for a method the client sends and must wait on --
// the replies that end the wait. Encoding and decoding are generic over the
// rows, bits packed as the specification packs them. Two methods are absent ON
// PURPOSE: queue.purge and exchange.delete. A test owns only what it created,
// and a client that cannot send those cannot be talked into either.
import { protocolError } from "./errors.mjs";
import { ARGS, READ, reader, u16, u8 } from "./table.mjs";

const CLOSE = [["replyCode", "short"], ["replyText", "shortstr"], ["classId", "short"], ["methodId", "short"]];
const row = (classId, methodId, name, args = [], extra = {}) => ({ classId, methodId, name, args, ...extra });

export const METHODS = [
  row(10, 10, "connection.start", [["versionMajor", "octet"], ["versionMinor", "octet"], ["serverProperties", "table"], ["mechanisms", "longstr"], ["locales", "longstr"]]),
  row(10, 11, "connection.start-ok", [["clientProperties", "table"], ["mechanism", "shortstr"], ["response", "longstr"], ["locale", "shortstr"]]),
  row(10, 30, "connection.tune", [["channelMax", "short"], ["frameMax", "long"], ["heartbeat", "short"]]),
  row(10, 31, "connection.tune-ok", [["channelMax", "short"], ["frameMax", "long"], ["heartbeat", "short"]]),
  row(10, 40, "connection.open", [["virtualHost", "shortstr"], ["capabilities", "shortstr"], ["insist", "bit"]], { replies: ["connection.open-ok"] }),
  row(10, 41, "connection.open-ok", [["knownHosts", "shortstr"]]),
  row(10, 50, "connection.close", CLOSE, { replies: ["connection.close-ok"] }),
  row(10, 51, "connection.close-ok"),
  row(10, 60, "connection.blocked", [["reason", "shortstr"]]),
  row(10, 61, "connection.unblocked"),
  row(20, 10, "channel.open", [["outOfBand", "shortstr"]], { replies: ["channel.open-ok"] }),
  row(20, 11, "channel.open-ok", [["channelId", "longstr"]]),
  row(20, 40, "channel.close", CLOSE, { replies: ["channel.close-ok"] }),
  row(20, 41, "channel.close-ok"),
  row(40, 10, "exchange.declare", [["ticket", "short"], ["exchange", "shortstr"], ["type", "shortstr"], ["passive", "bit"], ["durable", "bit"], ["autoDelete", "bit"], ["internal", "bit"], ["noWait", "bit"], ["arguments", "table"]], { replies: ["exchange.declare-ok"] }),
  row(40, 11, "exchange.declare-ok"),
  row(50, 10, "queue.declare", [["ticket", "short"], ["queue", "shortstr"], ["passive", "bit"], ["durable", "bit"], ["exclusive", "bit"], ["autoDelete", "bit"], ["noWait", "bit"], ["arguments", "table"]], { replies: ["queue.declare-ok"] }),
  row(50, 11, "queue.declare-ok", [["queue", "shortstr"], ["messageCount", "long"], ["consumerCount", "long"]]),
  row(50, 20, "queue.bind", [["ticket", "short"], ["queue", "shortstr"], ["exchange", "shortstr"], ["routingKey", "shortstr"], ["noWait", "bit"], ["arguments", "table"]], { replies: ["queue.bind-ok"] }),
  row(50, 21, "queue.bind-ok"),
  row(50, 40, "queue.delete", [["ticket", "short"], ["queue", "shortstr"], ["ifUnused", "bit"], ["ifEmpty", "bit"], ["noWait", "bit"]], { replies: ["queue.delete-ok"] }),
  row(50, 41, "queue.delete-ok", [["messageCount", "long"]]),
  row(50, 50, "queue.unbind", [["ticket", "short"], ["queue", "shortstr"], ["exchange", "shortstr"], ["routingKey", "shortstr"], ["arguments", "table"]], { replies: ["queue.unbind-ok"] }),
  row(50, 51, "queue.unbind-ok"),
  row(60, 10, "basic.qos", [["prefetchSize", "long"], ["prefetchCount", "short"], ["global", "bit"]], { replies: ["basic.qos-ok"] }),
  row(60, 11, "basic.qos-ok"),
  row(60, 20, "basic.consume", [["ticket", "short"], ["queue", "shortstr"], ["consumerTag", "shortstr"], ["noLocal", "bit"], ["noAck", "bit"], ["exclusive", "bit"], ["noWait", "bit"], ["arguments", "table"]], { replies: ["basic.consume-ok"] }),
  row(60, 21, "basic.consume-ok", [["consumerTag", "shortstr"]]),
  row(60, 30, "basic.cancel", [["consumerTag", "shortstr"], ["noWait", "bit"]], { replies: ["basic.cancel-ok"] }),
  row(60, 31, "basic.cancel-ok", [["consumerTag", "shortstr"]]),
  row(60, 40, "basic.publish", [["ticket", "short"], ["exchange", "shortstr"], ["routingKey", "shortstr"], ["mandatory", "bit"], ["immediate", "bit"]], { content: true }),
  row(60, 50, "basic.return", [["replyCode", "short"], ["replyText", "shortstr"], ["exchange", "shortstr"], ["routingKey", "shortstr"]], { content: true }),
  row(60, 60, "basic.deliver", [["consumerTag", "shortstr"], ["deliveryTag", "longlong"], ["redelivered", "bit"], ["exchange", "shortstr"], ["routingKey", "shortstr"]], { content: true }),
  row(60, 70, "basic.get", [["ticket", "short"], ["queue", "shortstr"], ["noAck", "bit"]], { replies: ["basic.get-ok", "basic.get-empty"] }),
  row(60, 71, "basic.get-ok", [["deliveryTag", "longlong"], ["redelivered", "bit"], ["exchange", "shortstr"], ["routingKey", "shortstr"], ["messageCount", "long"]], { content: true }),
  row(60, 72, "basic.get-empty", [["clusterId", "shortstr"]]),
  row(60, 80, "basic.ack", [["deliveryTag", "longlong"], ["multiple", "bit"]]),
  row(60, 90, "basic.reject", [["deliveryTag", "longlong"], ["requeue", "bit"]]),
  row(60, 120, "basic.nack", [["deliveryTag", "longlong"], ["multiple", "bit"], ["requeue", "bit"]]),
  row(85, 10, "confirm.select", [["noWait", "bit"]], { replies: ["confirm.select-ok"] }),
  row(85, 11, "confirm.select-ok"),
];

// Consecutive bit arguments share one octet, up to eight (spec §4.2.5.2).
function grouped(groups, name, type) {
  const last = groups[groups.length - 1];
  if (type === "bit" && last?.bits && last.bits.length < 8) return [...groups.slice(0, -1), { bits: [...last.bits, name] }];
  return [...groups, type === "bit" ? { bits: [name] } : { name, type }];
}

const layoutOf = (args) => args.reduce((groups, [name, type]) => grouped(groups, name, type), []);

function idOf(classId, methodId) {
  return classId * 65536 + methodId;
}

const TABLE = METHODS.map((m) => ({ ...m, layout: layoutOf(m.args) }));
export const BY_NAME = new Map(TABLE.map((m) => [m.name, m]));
const BY_ID = new Map(TABLE.map((m) => [idOf(m.classId, m.methodId), m]));

const packBits = (names, args) => names.reduce((byte, n, i) => byte | (args[n] ? 1 << i : 0), 0);
const encodeGroup = (g, args) => (g.bits ? u8(packBits(g.bits, args)) : ARGS[g.type].enc(args[g.name] ?? ARGS[g.type].zero));

export function encodeMethod(name, args = {}) {
  const m = BY_NAME.get(name);
  if (!m) throw new RangeError(`no AMQP 0-9-1 method is named ${name}`);
  return Buffer.concat([u16(m.classId), u16(m.methodId), ...m.layout.map((g) => encodeGroup(g, args))]);
}

function decodeGroup(g, r) {
  if (!g.bits) return [[g.name, ARGS[g.type].dec(r)]];
  const byte = READ.u8(r);
  return g.bits.map((n, i) => [n, (byte & (1 << i)) !== 0]);
}

export function decodeMethod(payload) {
  const r = reader(payload);
  const ids = [READ.u16(r), READ.u16(r)];
  const m = BY_ID.get(idOf(ids[0], ids[1]));
  if (!m) throw protocolError(`unknown AMQP method ${ids[0]}.${ids[1]}`);
  return { name: m.name, method: m, args: Object.fromEntries(m.layout.flatMap((g) => decodeGroup(g, r))) };
}
