// Orbit Control's read of the session trail and of project knowledge: every
// route is a GET over the engine's own projections, and none of them writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createControlServer, listen } from "../src/server.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { eventOf } from "../../src/trace/events.mjs";
import { traceLog } from "../../src/trace/log.mjs";
import { contextFor, fixture } from "./fixture.mjs";

async function started(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  return { get: (p) => sent(port, "GET", p), post: (p) => sent(port, "POST", p) };
}

function sent(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); resolve({ status: res.statusCode, text, json: text ? JSON.parse(text) : null }); });
    });
    req.on("error", reject);
    req.end();
  });
}

let n = 0;
const at = (s) => `2026-09-23T10:00:${String(s).padStart(2, "0")}.000Z`;
const ev = (type, data, s) => eventOf(type, data, { id: `e-${(n++).toString(36)}-0000000${n % 10}`, at: at(s), session: "claude:s1", project: "p1" });

function seeded(root) {
  const log = traceLog(stateRooms(root.store), realIo());
  const prompt = ev("prompt.submitted", { prompt: { chars: 30, hash: "abcdef012345" }, routing: "on", intent: "development", confidence: "high", selected: [{ kind: "skill", id: "orbit-develop", requirement: "development.implementation" }] }, 1);
  for (const e of [prompt, ev("skill.invoked", { id: "orbit:orbit-develop", ours: true, outcome: "started" }, 2), ev("command.ran", { orbit: "cli/context", ok: true }, 3), ev("command.ran", { class: "test", exe: "npm", ok: false }, 4), ev("turn.ended", {}, 5)]) log.append(e);
  return prompt.id;
}

test("the trace lists one turn per prompt -- the router's decision, the path, and whether the session followed -- and says what it never keeps", async (t) => {
  const { root } = fixture(t);
  const id = seeded(root);
  const api = await started(t, contextFor(root));
  const list = await api.get("/api/v1/trace/turns");
  assert.equal(list.status, 200, list.text);
  assert.deepEqual([list.json.turns.length, list.json.turns[0].id, list.json.turns[0].intent, list.json.turns[0].followed.verdict, list.json.turns[0].outcome], [1, id, "development", "followed", "failed"]);
  assert.ok(list.json.recording.never.includes("a prompt's text"));
  const one = await api.get(`/api/v1/trace/turns/${id}`);
  assert.deepEqual([one.status, one.json.turn.steps.map((s) => s.label)], [200, ["orbit:orbit-develop", "cli/context", "test (npm)"]]);
  assert.equal(list.text.includes(root.store), false, "no path of the machine reaches the page");
});

test("a turn id is validated, an unknown one is a 404, and nothing here can be written", async (t) => {
  const { root } = fixture(t);
  seeded(root);
  const api = await started(t, contextFor(root));
  assert.deepEqual([(await api.get("/api/v1/trace/turns/..%2F..%2Fetc")).json.error.code, (await api.get("/api/v1/trace/turns/e-zz-00000000")).json.error.code], ["INVALID_TURN_ID", "TURN_NOT_FOUND"]);
  assert.equal((await api.post("/api/v1/trace/turns")).status, 405);
  assert.equal((await api.post("/api/v1/analytics/usage")).status, 405);
});

test("usage analytics: counts with denominators over a window, and the window is validated", async (t) => {
  const { root } = fixture(t);
  seeded(root);
  const api = await started(t, contextFor(root));
  const usage = await api.get("/api/v1/analytics/usage?days=30");
  assert.equal(usage.status, 200, usage.text);
  assert.deepEqual([usage.json.days, usage.json.totals.orbit, usage.json.totals.shell, usage.json.totals.failed], [30, 1, 1, { failed: 1, of: 2 }]);
  assert.deepEqual(usage.json.commands.map((c) => c.id), ["cli/context"]);
  assert.equal((await api.get("/api/v1/analytics/usage?days=0")).json.error.code, "INVALID_DAYS");
  assert.equal((await api.get("/api/v1/analytics/usage?days=400")).status, 400);
});

test("project knowledge is shown when a project is there, and 'nothing to show' when none is -- never an error", async (t) => {
  const { root } = fixture(t);
  const without = await started(t, contextFor(root));
  assert.deepEqual((await without.get("/api/v1/knowledge")).json, { version: 1, available: false, why: "this Control was started without a project to read" });
  const summary = { version: 1, available: true, claims: { total: 3 } };
  const withIt = await started(t, { ...contextFor(root), knowledge: async () => summary });
  assert.deepEqual((await withIt.get("/api/v1/knowledge")).json, summary);
});
