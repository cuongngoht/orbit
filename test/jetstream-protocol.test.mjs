// The NATS wire, byte for byte: what this client writes is golden, what it reads is read by COUNT --
// a body holding CRLF is a body, a chunk may end anywhere -- a header block's status line is data,
// and a name that would end its line is refused before it is written. The $JS.ACK subject is the
// delivery's metadata in both of its layouts, and every error is a class by table.
import assert from "node:assert/strict";
import { test } from "node:test";
import { API_ERRORS, ERR_ROWS, NatsError, apiError, helperClassOf, parseAck, serverError } from "../skills/orbit-backend-test/jetstream/index.mjs";
import { ambiguousError, closedError, protocolError, timeoutError, transportError } from "../skills/orbit-backend-test/jetstream/errors.mjs";
import { CLIENT_OPS, SERVER_OPS, checkedSubject, connectOp, createParser, decodeHeaders, encodeHeaders, msgOp, pingOp, pongOp, pubOp, subOp, unsubOp } from "../skills/orbit-backend-test/jetstream/protocol.mjs";

const text = (buf) => buf.toString("utf8");

function reader(ops = SERVER_OPS) {
  const out = [];
  const parser = createParser((op) => out.push(op), ops);
  return { out, push: (bytes) => parser.push(Buffer.from(bytes)) };
}

const isKind = (kind) => (e) => e instanceof NatsError && e.kind === kind;

test("what the client writes is golden: PUB, HPUB with its counted header block, SUB, UNSUB, PING, PONG, CONNECT", () => {
  assert.equal(text(pubOp("orders.new", "hi")), "PUB orders.new 2\r\nhi\r\n");
  assert.equal(text(pubOp("orders.new", "hi", { reply: "_INBOX.x.1" })), "PUB orders.new _INBOX.x.1 2\r\nhi\r\n");
  assert.equal(text(pubOp("orders.new", "hi", { headers: { "Nats-Msg-Id": "m-1" } })), "HPUB orders.new 30 32\r\nNATS/1.0\r\nNats-Msg-Id: m-1\r\n\r\nhi\r\n");
  const body = Buffer.from([0x00, 0x0d, 0x0a, 0xff]);
  assert.deepEqual(pubOp("orders.new", body, { reply: "r.1", headers: { A: ["1", "2"] } }), Buffer.concat([Buffer.from("HPUB orders.new r.1 24 28\r\nNATS/1.0\r\nA: 1\r\nA: 2\r\n\r\n"), body, Buffer.from("\r\n")]));
  assert.equal(text(pubOp("orders.new", { id: 1 })), 'PUB orders.new 8\r\n{"id":1}\r\n');
  assert.equal(text(pubOp("orders.new", undefined)), "PUB orders.new 0\r\n\r\n");
  assert.equal(text(subOp("_INBOX.x.*", "1")), "SUB _INBOX.x.* 1\r\n");
  assert.equal(text(subOp("work.>", "7", "workers")), "SUB work.> workers 7\r\n");
  assert.equal(text(unsubOp("7")), "UNSUB 7\r\n");
  assert.equal(text(unsubOp("7", 3)), "UNSUB 7 3\r\n");
  assert.equal(text(pingOp()), "PING\r\n");
  assert.equal(text(pongOp()), "PONG\r\n");
  assert.equal(text(connectOp({ verbose: false, pedantic: false, headers: true, no_responders: true })), 'CONNECT {"verbose":false,"pedantic":false,"headers":true,"no_responders":true}\r\n');
  assert.equal(text(encodeHeaders({}, { code: 503 })), "NATS/1.0 503\r\n\r\n");
  assert.equal(text(encodeHeaders({}, { code: 404, description: "No Messages" })), "NATS/1.0 404 No Messages\r\n\r\n");
  assert.equal(text(msgOp("orders.new", "5", "hi", { reply: "$JS.ACK.S.c.1.1.1.0.0" })), "MSG orders.new 5 $JS.ACK.S.c.1.1.1.0.0 2\r\nhi\r\n");
});

test("a payload is read by its count: a body holding CRLF and binary arrives whole, fed one byte at a time", () => {
  const body = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x41, 0x0d, 0x0a]);
  const wire = Buffer.concat([Buffer.from("MSG a.b 9 7\r\n"), body, Buffer.from("\r\nPING\r\n")]);
  const r = reader();
  for (const byte of wire) r.push([byte]);
  assert.deepEqual(r.out, [
    { op: "MSG", subject: "a.b", sid: "9", reply: null, headers: null, status: null, description: "", data: body },
    { op: "PING" },
  ]);
});

test("HMSG: the status line's code and description, every header, a reply, and the body after the block", () => {
  const head = "NATS/1.0 408 Request Timeout\r\nNats-Pending-Messages: 2\r\nX: 1\r\nX: 2\r\n\r\n";
  const wire = `HMSG _INBOX.x-c3 4 $JS.ACK.S.c.1.2.3.4.5 ${Buffer.byteLength(head)} ${Buffer.byteLength(head) + 2}\r\n${head}ok\r\n`;
  const r = reader();
  r.push(wire.slice(0, 40));
  r.push(wire.slice(40, 77));
  r.push(wire.slice(77));
  assert.equal(r.out.length, 1);
  const [m] = r.out;
  assert.deepEqual([m.op, m.subject, m.sid, m.reply, m.status, m.description, text(m.data)], ["HMSG", "_INBOX.x-c3", "4", "$JS.ACK.S.c.1.2.3.4.5", 408, "Request Timeout", "ok"]);
  assert.deepEqual(m.headers, { "Nats-Pending-Messages": "2", X: ["1", "2"] });
  assert.deepEqual(decodeHeaders(Buffer.from("NATS/1.0 503\r\n\r\n")), { status: 503, description: "", headers: {} });
  assert.deepEqual(decodeHeaders(Buffer.from("NATS/1.0\r\nNats-Msg-Id: a\r\n\r\n")), { status: null, description: "", headers: { "Nats-Msg-Id": "a" } });
});

test("several operations in one chunk, each as the server's table reads it", () => {
  const r = reader();
  r.push(`PING\r\n+OK\r\npong\r\n-ERR 'Stale Connection'\r\nINFO {"server_id":"N","headers":true,"max_payload":1048576}\r\n`);
  assert.deepEqual(r.out, [{ op: "PING" }, { op: "+OK" }, { op: "PONG" }, { op: "-ERR", text: "Stale Connection" }, { op: "INFO", info: { server_id: "N", headers: true, max_payload: 1048576 } }]);
});

test("the server's side reads what a client writes, through the client's own table", () => {
  const r = reader(CLIENT_OPS);
  r.push(Buffer.concat([Buffer.from('CONNECT {"verbose":false}\r\nSUB a.* q 5\r\nSUB b 6\r\nUNSUB 5 2\r\nUNSUB 6\r\n'), pubOp("a.x", "hi", { reply: "r.1" }), pubOp("a.y", "yo", { headers: { K: "v" } })]));
  assert.deepEqual(r.out.map((op) => [op.op, op.subject ?? op.sid ?? null]), [["CONNECT", null], ["SUB", "a.*"], ["SUB", "b"], ["UNSUB", "5"], ["UNSUB", "6"], ["PUB", "a.x"], ["HPUB", "a.y"]]);
  assert.deepEqual([r.out[1].queue, r.out[1].sid, r.out[2].queue, r.out[3].max, r.out[4].max], ["q", "5", null, 2, null]);
  assert.deepEqual([r.out[5].reply, text(r.out[5].data), r.out[6].headers, text(r.out[6].data)], ["r.1", "hi", { K: "v" }, "yo"]);
  assert.deepEqual(r.out[0].options, { verbose: false });
});

test("what the protocol cannot read is a protocol error, never a guess", () => {
  const broken = [
    ["FOO bar\r\n", /is no operation/],
    ["MSG a 1 x\r\n", /not a byte count/],
    ["MSG a b c d e\r\n", /MSG with 5 arguments/],
    ["MSG a 1 2\r\nhiXX", /not followed by CRLF/],
    ["HMSG a 1 10 5\r\n", /past what this client reads/],
    ["HMSG a 1 6 6\r\nXXXX\r\n\r\n", /does not start with NATS\/1\.0/],
    ["INFO {not json\r\n", /not JSON/],
    ["x".repeat(5000), /control line longer/],
  ];
  for (const [wire, re] of broken) assert.throws(() => reader().push(wire), (e) => isKind("protocol")(e) && re.test(e.message), wire.slice(0, 20));
});

test("a subject, a queue or a header that would end its line or split its tokens is refused before it is written", () => {
  const refused = [
    () => pubOp("a b", "x"),
    () => pubOp("a\r\nPUB evil 1", "x"),
    () => pubOp("a", "x", { reply: "r s" }),
    () => subOp("a", "1", "q\r\nUNSUB 1"),
    () => encodeHeaders({ "Bad Key": "v" }),
    () => encodeHeaders({ K: "v\r\nInjected: 1" }),
    () => checkedSubject("a..b"),
    () => checkedSubject(".a"),
    () => checkedSubject("a."),
    () => checkedSubject(""),
    () => checkedSubject(42),
  ];
  refused.forEach((write, i) => assert.throws(write, isKind("refused"), `row ${i}`));
  assert.equal(checkedSubject("$JS.API.STREAM.INFO.ORDERS"), "$JS.API.STREAM.INFO.ORDERS");
});

test("the $JS.ACK subject is the delivery's metadata, in both layouts; anything else is not an ack subject", () => {
  const ns = String(BigInt(Date.UTC(2026, 0, 1)) * 1_000_000n);
  assert.deepEqual(parseAck(`$JS.ACK.ORDERS.work.2.17.31.${ns}.4`), { domain: null, account: null, stream: "ORDERS", consumer: "work", deliveredCount: 2, streamSeq: 17, consumerSeq: 31, timestampNs: ns, time: "2026-01-01T00:00:00.000Z", pending: 4 });
  assert.deepEqual(parseAck(`$JS.ACK.hub.ACCHASH.ORDERS.work.1.5.5.${ns}.0.r5`), { domain: "hub", account: "ACCHASH", stream: "ORDERS", consumer: "work", deliveredCount: 1, streamSeq: 5, consumerSeq: 5, timestampNs: ns, time: "2026-01-01T00:00:00.000Z", pending: 0 });
  assert.equal(parseAck(`$JS.ACK._.ACCHASH.ORDERS.work.1.5.5.${ns}.0`).domain, null, "a domain of _ is none");
  for (const other of ["$JS.ACK.a.b", "_INBOX.x.1", `$JS.ACK.ORDERS.work.two.17.31.${ns}.4`, `$JS.NAK.ORDERS.work.2.17.31.${ns}.4`, null, undefined]) assert.equal(parseAck(other), null, String(other));
});

test("a server's -ERR is a kind by its words, and says whether the connection survives it", () => {
  const rows = [
    ['Permissions Violation for Publish to "orders.new"', "denied", false, "refused"],
    ['Permissions Violation for Subscription to "_INBOX.x.*"', "denied", false, "refused"],
    ["Maximum Subscriptions Exceeded", "refused", false, "refused"],
    ["Invalid Subject", "protocol", false, "protocol"],
    ["Authorization Violation", "refused", true, "refused"],
    ["User Authentication Expired", "refused", true, "refused"],
    ["Maximum Payload Violation", "refused", true, "refused"],
    ["Stale Connection", "transport", true, "transport"],
    ["Slow Consumer", "transport", true, "transport"],
    ["Unknown Protocol Operation", "protocol", true, "protocol"],
    ["something no row knows", "protocol", true, "protocol"],
  ];
  for (const [said, kind, fatal, helper] of rows) {
    const e = serverError(said);
    assert.deepEqual([e.kind, e.fatal, helperClassOf(e)], [kind, fatal, helper], said);
  }
  assert.equal(serverError('Permissions Violation for Publish to "orders.new"').subject, "orders.new");
  assert.equal(ERR_ROWS.at(-1).re.test("anything"), true, "the last row always matches");
});

test("a JetStream API error is a class by its err_code, then by its status, then protocol", () => {
  const rows = [
    [{ code: 404, err_code: 10059, description: "stream not found" }, "refused"],
    [{ code: 404, err_code: 10014, description: "consumer not found" }, "refused"],
    [{ code: 400, err_code: 10071, description: "wrong last sequence: 1" }, "refused"],
    [{ code: 503, err_code: 10039, description: "JetStream not enabled for account" }, "transport"],
    [{ code: 503, err_code: 10023, description: "insufficient resources" }, "transport"],
    [{ code: 400, err_code: 99999, description: "a code no row knows" }, "refused"],
    [{ code: 409, err_code: 99998 }, "refused"],
    [{ code: 503, err_code: 99997 }, "transport"],
    [{ code: 500, err_code: 99996 }, "protocol"],
  ];
  for (const [error, helper] of rows) {
    const e = apiError(error, "stream info");
    assert.deepEqual([e.kind, e.errCode, helperClassOf(e)], ["api", error.err_code, helper], JSON.stringify(error));
  }
  const CLASSES = ["transport", "protocol", "timeout", "incomplete", "ambiguous", "refused"];
  for (const row of API_ERRORS) assert.ok(CLASSES.includes(row.is) && Number.isInteger(row.errCode) && row.says, JSON.stringify(row));
});

test("every kind maps onto a helper class, and an error this module did not make is protocol", () => {
  assert.equal(helperClassOf(transportError("x")), "transport");
  assert.equal(helperClassOf(protocolError("x")), "protocol");
  assert.equal(helperClassOf(timeoutError("x")), "timeout");
  assert.equal(helperClassOf(closedError("x")), "transport");
  const unacked = ambiguousError({ subject: "orders.new", msgId: "m-1" }, closedError("closed"));
  assert.deepEqual([helperClassOf(unacked), unacked.msgId, unacked.subject], ["ambiguous", "m-1", "orders.new"]);
  assert.match(unacked.message, /m-1/);
  assert.equal(helperClassOf(new Error("not ours")), "protocol");
  assert.equal(helperClassOf(null), "protocol");
});
