import assert from "node:assert/strict";
import { test } from "node:test";
import { PROPERTIES, decodeHeader, encodeHeader } from "../skills/orbit-backend-test/amqp/content.mjs";
import { METHODS, decodeMethod, encodeMethod } from "../skills/orbit-backend-test/amqp/methods.mjs";
import { FIELD_TYPES, decodeTable, encodeTable, reader, typed } from "../skills/orbit-backend-test/amqp/table.mjs";
import { PROTOCOL_HEADER, bodyFrames, contentFrames, createParser, decodeFrame, frame, heartbeatFrame, methodFrame } from "../skills/orbit-backend-test/amqp/wire.mjs";

const hex = (b) => Buffer.from(b).toString("hex");
const bytes = (s) => Buffer.from(s.replace(/\s+/g, ""), "hex");

test("the protocol header names AMQP 0-9-1", () => {
  assert.equal(hex(PROTOCOL_HEADER), "414d515000000901");
});

test("connection.start-ok is the bytes the specification lays out", () => {
  const got = methodFrame(0, "connection.start-ok", { clientProperties: { product: "orbit" }, mechanism: "PLAIN", response: Buffer.from("\0guest\0guest"), locale: "en_US" });
  const payload = bytes(`
    000a 000b
    00000012 07 70726f64756374 53 00000005 6f72626974
    05 504c41494e
    0000000c 00 6775657374 00 6775657374
    05 656e5f5553`);
  assert.equal(hex(got), hex(Buffer.concat([bytes("01 0000 00000036"), payload, bytes("ce")])));
});

test("a basic.publish with its content header and body is three frames of known bytes", () => {
  const method = methodFrame(1, "basic.publish", { exchange: "ex", routingKey: "rk", mandatory: true });
  assert.equal(hex(method), hex(bytes("01 0001 0000000d 003c 0028 0000 02 6578 02 726b 01 ce")));
  const [header, body] = contentFrames(1, Buffer.from("hello"), { contentType: "text/plain", deliveryMode: 2 }, 131072);
  assert.equal(hex(header), hex(bytes("02 0001 0000001a 003c 0000 0000000000000005 9000 0a 746578742f706c61696e 02 ce")));
  assert.equal(hex(body), hex(bytes("03 0001 00000005 68656c6c6f ce")));
});

test("a heartbeat is an empty frame on channel 0", () => {
  assert.equal(hex(heartbeatFrame()), hex(bytes("08 0000 00000000 ce")));
});

test("bits share one octet in argument order", () => {
  const payload = encodeMethod("queue.declare", { queue: "q", durable: true, autoDelete: true });
  assert.equal(hex(payload.subarray(-7)), hex(bytes("01 71 0a 00000000")), "queue 'q', then passive=0 durable=1 exclusive=0 autoDelete=1 noWait=0 → 0b01010, then an empty table");
  assert.deepEqual(decodeMethod(payload).args, { ticket: 0, queue: "q", passive: false, durable: true, exclusive: false, autoDelete: true, noWait: false, arguments: {} });
});

test("every field-table value type round-trips", () => {
  const when = new Date(Math.floor(Date.now() / 1000) * 1000);
  const table = {
    t: true, f0: false, b: typed("b", -5), B: typed("B", 200), s: typed("s", -300), u: typed("u", 60000), I: -70000, i: typed("i", 4000000000),
    l: 2 ** 40, big: 2n ** 60n, f: typed("f", 1.5), d: 3.14159, D: typed("D", { scale: 2, value: 12345 }), S: "héllo", A: [1, "a", true, [2]],
    T: when, F: { nested: { x: 1 } }, V: null, x: Buffer.from([1, 2, 3]),
  };
  const back = decodeTable(reader(encodeTable(table)));
  assert.deepEqual(back, { t: true, f0: false, b: -5, B: 200, s: -300, u: 60000, I: -70000, i: 4000000000, l: 2 ** 40, big: 2n ** 60n, f: 1.5, d: 3.14159, D: { scale: 2, value: 12345 }, S: "héllo", A: [1, "a", true, [2]], T: when, F: { nested: { x: 1 } }, V: null, x: Buffer.from([1, 2, 3]) });
  assert.deepEqual([...FIELD_TYPES].sort(), [..."tbBsuIilfdDSATFVx"].sort(), "the table covers exactly the errata's types");
});

test("a broker's __proto__ key is a field, never a prototype", () => {
  const encoded = encodeTable(JSON.parse('{"__proto__": {"polluted": true}}'));
  const back = decodeTable(reader(encoded));
  assert.equal(Object.getPrototypeOf(back), Object.prototype);
  assert.deepEqual(Object.keys(back), ["__proto__"]);
  assert.equal({}.polluted, undefined);
});

test("every method in the table encodes and decodes to itself", () => {
  const sample = { octet: 7, short: 513, long: 70000, longlong: 2 ** 33, shortstr: "s", longstr: "long", bit: true, table: { k: "v" }, timestamp: new Date(1700000000000) };
  for (const m of METHODS) {
    const args = Object.fromEntries(m.args.map(([name, type]) => [name, sample[type]]));
    const back = decodeMethod(encodeMethod(m.name, args));
    assert.equal(back.name, m.name);
    assert.deepEqual(back.args, args, m.name);
  }
});

test("a content header carries every basic property it was given, and no other", () => {
  const props = { contentType: "application/json", contentEncoding: "utf-8", headers: { tenant: "t-1" }, deliveryMode: 2, priority: 3, correlationId: "c-1", replyTo: "r", expiration: "60000", messageId: "m-1", timestamp: new Date(1700000000000), type: "invoice.due", userId: "u", appId: "a", clusterId: "x" };
  assert.equal(PROPERTIES.length, 14);
  assert.deepEqual(decodeHeader(encodeHeader(60, 42, props)), { classId: 60, bodySize: 42, properties: props });
  assert.deepEqual(decodeHeader(encodeHeader(60, 0, { messageId: "only" })).properties, { messageId: "only" });
});

test("a body is split at frame-max minus the frame's own eight bytes", () => {
  const frames = bodyFrames(3, Buffer.alloc(20, 7), 16);
  assert.deepEqual(frames.map((f) => f.readUInt32BE(3)), [8, 8, 4]);
  assert.equal(bodyFrames(3, Buffer.alloc(0), 16).length, 0, "an empty body travels as no body frame");
  assert.equal(bodyFrames(3, Buffer.alloc(500), 0).length, 1, "frame-max 0 is no limit");
});

test("the parser takes a stream cut anywhere and hands over whole frames", () => {
  const stream = Buffer.concat([methodFrame(0, "connection.tune", { channelMax: 2047, frameMax: 131072, heartbeat: 60 }), heartbeatFrame(), ...contentFrames(1, Buffer.from("partial chunks"), { messageId: "m" }, 16)]);
  const whole = [];
  createParser((f) => whole.push(f)).push(stream);
  const cut = [];
  const parser = createParser((f) => cut.push(f));
  for (let i = 0; i < stream.length; i += 1) parser.push(stream.subarray(i, i + 1));
  assert.equal(parser.buffered(), 0);
  assert.deepEqual(cut, whole);
  assert.deepEqual(whole.map((f) => f.kind), ["method", "heartbeat", "header", "body", "body"]);
  assert.deepEqual(decodeFrame(whole[0]).args, { channelMax: 2047, frameMax: 131072, heartbeat: 60 });
});

test("a frame that does not end with the frame-end octet, an unknown method or type, and a refused version are protocol errors", () => {
  const bad = Buffer.from(methodFrame(0, "connection.close-ok", {}));
  bad[bad.length - 1] = 0;
  assert.throws(() => createParser(() => {}).push(bad), (e) => e.kind === "protocol" && /frame-end/.test(e.message));
  assert.throws(() => decodeMethod(bytes("0063 0063")), (e) => e.kind === "protocol" && /unknown AMQP method 99\.99/.test(e.message));
  assert.throws(() => createParser(() => {}).push(frame(9, 0, Buffer.alloc(0))), (e) => e.kind === "protocol" && /frame type 9/.test(e.message));
  assert.throws(() => createParser(() => {}).push(bytes("414d515000000901")), (e) => e.kind === "protocol" && /does not speak AMQP 0-9-1/.test(e.message));
  assert.throws(() => decodeTable(reader(bytes("00000010 01 6b"))), (e) => e.kind === "protocol" && /truncated/.test(e.message));
});

test("the client cannot even encode a purge or an exchange delete", () => {
  assert.throws(() => encodeMethod("queue.purge", { queue: "q" }), /no AMQP 0-9-1 method is named queue.purge/);
  assert.throws(() => encodeMethod("exchange.delete", { exchange: "e" }), /no AMQP 0-9-1 method is named exchange.delete/);
});
