// The probe port: loopback only, never throws, keeps nothing a server says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { createProbe, isLoopback } from "../src/probe/index.mjs";
import { createReach } from "../src/probe/reach.mjs";

const listening = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

test("tcp answers ok for a listening port and a sentence for one that is not", async (t) => {
  const server = netServer(() => {});
  t.after(() => server.close());
  const port = await listening(server);
  const probe = createProbe();
  assert.deepEqual(await probe.tcp(port), { ok: true });
  server.close();
  await new Promise((resolve) => server.on("close", resolve));
  const closed = await probe.tcp(port);
  assert.equal(closed.ok, false);
  assert.match(closed.error, /refused the connection/);
});

test("a connection ACCEPTED and closed before a word -- a container's published port with nothing behind it -- is not an answer; one that greets first is", async (t) => {
  const forwarder = netServer((socket) => socket.end());
  const greeter = netServer((socket) => socket.end("220 ready\r\n"));
  t.after(() => (forwarder.close(), greeter.close()));
  const [empty, speaking] = [await listening(forwarder), await listening(greeter)];
  const probe = createProbe();
  const nobody = await probe.tcp(empty, { host: "127.0.0.1" });
  assert.equal(nobody.ok, false);
  assert.match(nobody.error, /127\.0\.0\.1:\d+ accepted the connection and closed it before answering — a forwarded port with nothing listening behind it/);
  assert.deepEqual(await probe.tcp(speaking, { host: "127.0.0.1" }), { ok: true });
});

test("http answers the STATUS and nothing of the body, whatever the status is", async (t) => {
  const server = createServer((req, res) => {
    res.statusCode = req.url === "/health" ? 200 : 503;
    res.end("secret body that is never kept");
  });
  t.after(() => server.close());
  const port = await listening(server);
  const probe = createProbe();
  assert.deepEqual(await probe.http(`http://localhost:${port}/health`), { ok: true, status: 200 });
  assert.deepEqual(await probe.http(`http://127.0.0.1:${port}/other?x=1`), { ok: true, status: 503 });
});

test("a host that is not this machine is REFUSED, for both kinds of probe, before any socket exists", async () => {
  const probe = createProbe({ connect: () => assert.fail("no socket"), http: () => assert.fail("no request") });
  const tcp = await probe.tcp(80, { host: "example.com" });
  const http = await probe.http("http://example.com/health");
  assert.deepEqual([tcp.ok, tcp.refused, http.ok, http.refused], [false, true, false, true]);
  assert.match(http.error, /only looks at localhost/);
  assert.deepEqual([isLoopback("127.0.0.1"), isLoopback("LOCALHOST"), isLoopback("[::1]"), isLoopback("10.0.0.5")], [true, true, true, false]);
});

test("a malformed target is an answer, not a throw", async () => {
  const probe = createProbe();
  assert.match((await probe.http("not a url")).error, /not an http\(s\) URL/);
  assert.match((await probe.http("ftp://localhost/x")).error, /not an http\(s\) URL/);
  assert.match((await probe.tcp(0)).error, /not a port/);
  assert.match((await probe.tcp(70000)).error, /not a port/);
});

test("a spent deadline is said, and the late socket error does not answer twice", async () => {
  const events = {};
  const socket = { destroy() {}, setTimeout() {}, on: (name, fn) => void (events[name] = fn) };
  const probe = createProbe({ connect: () => socket, timeoutMs: 50 });
  const pending = probe.tcp(8080, { host: "127.0.0.1" });
  events.timeout();
  events.error(Object.assign(new Error("late"), { code: "ECONNRESET" }));
  const answer = await pending;
  assert.equal(answer.ok, false);
  assert.match(answer.error, /within 0.05s/);
});

test("a probe that was not told a host asks BOTH loopbacks: a server on ::1 alone is up, and one nobody holds is not", async () => {
  const asked = [];
  const sockets = (open) => ({ connect: ({ host }) => {
    asked.push(host);
    const events = {};
    queueMicrotask(() => (open.includes(host) ? events.connect?.() : events.error?.(Object.assign(new Error("no"), { code: "ECONNREFUSED" }))));
    return { destroy() {}, setTimeout() {}, on: (name, fn) => void (events[name] = fn) };
  }, holdMs: 0 });
  const v6 = createProbe(sockets(["::1"]));
  assert.deepEqual(await v6.tcp(5173), { ok: true });
  assert.deepEqual(asked, ["127.0.0.1", "::1"], "the first refused, the second answered");
  asked.length = 0;
  const v4 = createProbe(sockets(["127.0.0.1"]));
  assert.deepEqual(await v4.tcp(5173), { ok: true });
  assert.deepEqual(asked, ["127.0.0.1"], "no need to ask the second once the first answers");
  asked.length = 0;
  const none = await createProbe(sockets([])).tcp(5173);
  assert.equal(none.ok, false);
  assert.match(none.error, /127\.0\.0\.1:5173 refused the connection .*; ::1:5173 refused the connection/);
  asked.length = 0;
  const told = await createProbe(sockets(["::1"])).tcp(5173, { host: "127.0.0.1" });
  assert.equal(told.ok, false, "a server on ::1 alone does not answer a probe that was told to ask 127.0.0.1");
  assert.deepEqual([...new Set(asked)], ["127.0.0.1"], "told a host, it asks that one and no other");
  assert.equal((await createProbe(sockets(["::1"])).tcp(5173, { host: "[::1]" })).ok, true, "a bracketed address is the same address");
});

// ---- the REACH port: a host a person configured, never this probe's loopback rule ---------------

test("reach.tcp: an accepted connection is the answer, nothing is written or read, a closed port says so, and nothing throws", async (t) => {
  const seen = [];
  let hungUp;
  const over = new Promise((resolve) => (hungUp = resolve));
  const server = netServer((socket) => {
    seen.push("connected");
    socket.on("data", () => seen.push("data"));
    socket.on("error", () => {});
    socket.on("close", () => (seen.push("closed"), hungUp()));
  });
  t.after(() => server.close());
  const port = await listening(server);
  const reach = createReach();
  assert.deepEqual(await reach.tcp("127.0.0.1", port), { ok: true });
  await over;
  assert.deepEqual(seen, ["connected", "closed"], "connected and closed by the asker, and not a byte sent");
  server.close();
  await new Promise((resolve) => server.on("close", resolve));
  const closed = await reach.tcp("127.0.0.1", port);
  assert.equal(closed.ok, false);
  assert.match(closed.error, /127\.0\.0\.1:\d+ could not be reached \(ECONNREFUSED\)/);
  assert.match((await reach.tcp("127.0.0.1", 0)).error, /0 is not a port/);
  assert.deepEqual(await createReach({ connect: () => { throw new Error("boom"); } }).tcp("db.internal.example", 5432), { ok: false, error: "db.internal.example:5432 could not be asked (boom)" });
});

test("reach.tcp: a connection nothing answers is a spent deadline, said as one", async () => {
  const events = {};
  const socket = { destroy() {}, setTimeout() {}, on: (name, fn) => void (events[name] = fn) };
  const pending = createReach({ connect: () => socket }).tcp("10.255.255.1", 1433, { timeoutMs: 250 });
  events.timeout();
  assert.deepEqual(await pending, { ok: false, timedOut: true, error: "nothing answered on 10.255.255.1:1433 within 0.25s" });
});

test("reach.resolve counts the addresses, says when a name does not resolve, and gives up at the deadline instead of hanging", async () => {
  assert.deepEqual(await createReach({ lookup: async () => [{ address: "10.0.0.5" }, { address: "10.0.0.6" }] }).resolve("sql.internal.example"), { ok: true, addresses: 2, address: "10.0.0.5" });
  assert.equal((await createReach({ lookup: async () => [{ address: "2001:db8::5", family: 6 }, { address: "10.0.0.5", family: 4 }] }).resolve("sql.internal.example")).address, "10.0.0.5", "the address a connection is tried at is IPv4 when the name has one");
  assert.deepEqual(await createReach({ lookup: async () => { throw Object.assign(new Error("nope"), { code: "ENOTFOUND" }); } }).resolve("sql.internal.example"), { ok: false, error: "sql.internal.example did not resolve (ENOTFOUND)" });
  assert.deepEqual(await createReach({ lookup: () => new Promise(() => {}) }).resolve("sql.internal.example", { timeoutMs: 20 }), { ok: false, timedOut: true, error: "sql.internal.example did not resolve within 0.02s" });
});

test("the readiness probe is still loopback-only: the reach port did not widen it", async () => {
  const probe = createProbe({ connect: () => assert.fail("no socket"), http: () => assert.fail("no request") });
  assert.deepEqual([(await probe.tcp(1433, { host: "sql.internal.example" })).refused, (await probe.http("http://sql.internal.example/health")).refused], [true, true]);
});
