// The TEST WORKER's entry (cli/sandbox-worker.mjs, ADR 0038): it hands the runner the request it was handed, enforces
// the deadline, and makes sure a worker that did not finish SAYS so where the host looks -- an INTERRUPTED envelope --
// without ever deciding anything about the test. Everything it touches is handed in, so nothing here starts a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEADLINE_MS, KILL_GRACE_MS, WORKER_API, workerMain } from "../cli/sandbox-worker.mjs";

const OUT = "/work/out";
const ENVELOPE = `${OUT}/envelope.json`;
const REQUEST = { v: WORKER_API, runId: "run-0001", nonce: "n-123", out: OUT, limits: { deadlineMs: 60000 } };

function child(text) {
  const listeners = {};
  return { text, killed: [], on: (event, fn) => void (listeners[event] = fn), kill(sig) { this.killed.push(sig); }, emit: (event, ...args) => listeners[event]?.(...args) };
}

function harness() {
  const files = new Map();
  const timers = [];
  const handlers = {};
  const children = [];
  const io = { spawnChild: (text) => children[children.push(child(text)) - 1], exists: (p) => files.has(p), write: (p, t) => void files.set(p, t), on: (sig, fn) => void (handlers[sig] = fn), setTimer: (fn, ms) => timers.push({ fn, ms, cleared: false }) - 1, clearTimer: (h) => void (timers[h].cleared = true) };
  return { io, files, timers, handlers, children };
}

const envelope = (h) => JSON.parse(h.files.get(ENVELOPE));

test("a request that is not one is refused, and says so in its out room when it names one", async () => {
  const h = harness();
  assert.equal(await workerMain("not json", h.io), 2);
  assert.equal(await workerMain(JSON.stringify({ ...REQUEST, out: "relative/out" }), h.io), 2);
  assert.equal(h.files.size, 0, "nowhere absolute to say it");
  assert.equal(await workerMain(JSON.stringify({ ...REQUEST, nonce: "" }), h.io), 2);
  assert.deepEqual(envelope(h), { v: WORKER_API, runId: "run-0001", nonce: "", status: "REFUSED", why: "the request carries no nonce" });
  assert.equal(await workerMain(JSON.stringify({ ...REQUEST, v: "orbit.worker/v0" }), h.io), 2);
  assert.equal(envelope(h).why, `the request is not ${WORKER_API}`);
  assert.equal(h.children.length, 0, "no runner was started for any of them");
});

test("the runner is handed the SAME request, and a runner that wrote its envelope ends with its own exit code", async () => {
  const h = harness();
  const text = JSON.stringify(REQUEST);
  const done = workerMain(text, h.io);
  assert.equal(h.children[0].text, text);
  assert.equal(h.timers[0].ms, 60000);
  h.files.set(ENVELOPE, '{"status":"PASS"}');
  h.children[0].emit("exit", 0);
  assert.equal(await done, 0);
  assert.equal(h.files.get(ENVELOPE), '{"status":"PASS"}', "the runner's envelope is left exactly as it wrote it");
  assert.equal(h.timers[0].cleared, true);
});

test("a runner that ended without an envelope leaves an INTERRUPTED one, and the worker ends BLOCKED", async () => {
  const h = harness();
  const done = workerMain(JSON.stringify(REQUEST), h.io);
  h.children[0].emit("exit", 1);
  assert.equal(await done, 3);
  assert.deepEqual(envelope(h), { v: WORKER_API, runId: "run-0001", nonce: "n-123", status: "INTERRUPTED", why: "the runner ended with exit 1 and wrote no envelope" });
});

test("its deadline stops the runner -- gently, then not -- and what it leaves is INTERRUPTED, whatever the runner had written", async () => {
  const h = harness();
  const done = workerMain(JSON.stringify(REQUEST), h.io);
  h.files.set(ENVELOPE, '{"status":"PASS"}');
  h.timers[0].fn();
  assert.deepEqual([h.children[0].killed, h.timers[1].ms], [["SIGTERM"], KILL_GRACE_MS]);
  h.timers[1].fn();
  assert.deepEqual(h.children[0].killed, ["SIGTERM", "SIGKILL"]);
  h.children[0].emit("exit", null);
  assert.equal(await done, 3);
  assert.deepEqual([envelope(h).status, envelope(h).why], ["INTERRUPTED", "its deadline passed before the runner finished"]);
  assert.equal(h.timers[1].cleared, true, "nothing is left waiting once it ended");
});

test("stopped by its supervisor or its dispatch (SIGTERM), it stops the runner and says so", async () => {
  const h = harness();
  const done = workerMain(JSON.stringify(REQUEST), h.io);
  h.handlers.SIGTERM();
  h.children[0].emit("exit", null);
  assert.equal(await done, 3);
  assert.match(envelope(h).why, /stopped by its supervisor or its dispatch/);
});

test("a runner that could not be started ends the same way, and nothing is signalled", async () => {
  const h = harness();
  const done = workerMain(JSON.stringify({ ...REQUEST, limits: undefined }), h.io);
  assert.equal(h.timers[0].ms, DEFAULT_DEADLINE_MS);
  h.children[0].emit("error", new Error("spawn ENOENT"));
  assert.equal(await done, 3);
  assert.deepEqual([envelope(h).why, h.children[0].killed], ["the runner could not be started", []]);
  h.children[0].emit("exit", 1);
  assert.equal(envelope(h).why, "the runner could not be started", "a late exit changes nothing");
});
