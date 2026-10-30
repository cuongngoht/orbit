// Autonomous improvement in Orbit Control (0.3.0, ADR 0045), over HTTP -- a real socket, a real store. The promises:
// reading writes nothing and every metric says what it divides by; a person's promote, revert and reject go only
// through the token, on the campaign revision the page read, and a promotion still passes every gate and goes through
// the skill factory's own door; a decision the campaign's phase does not take is a 409; an unknown campaign is a 404;
// and the bounds a person sets are written into the project's document and only narrow.
import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { createControlServer, listen } from "../src/server.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { contextFor, fixture, TOKEN } from "./fixture.mjs";
import { createImprovement, digestOfOracle, effectiveOf, factoryPort, oracleOf, projectStoreRoot, realIo, record, start } from "./improvement.helpers.mjs";
import { bind, SHOP, snapshot } from "./machine.mjs";
import { GOOD } from "../../test/fakes/playbook.mjs";

async function started(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const mutation = { origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, "content-type": "application/json" };
  return { get: (p) => sent(port, "GET", p), put: (p, b) => sent(port, "PUT", p, b, mutation), post: (p, b = {}) => sent(port, "POST", p, b, mutation), bare: (m, p, b) => sent(port, m, p, b, { "content-type": "application/json" }) };
}

function sent(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }); });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const PROVIDES = "release.checklist.verification";
const ID = "release-checklist-verification";
const values = () => effectiveOf([]).values;
const resolve = (cap) => ({ capability: cap, outcome: "provided", provider: { kind: "skill", id: "x", key: "x", ownership: "plugin" } });

// A project where a campaign qualified a candidate in two independent sessions and waits for a person: the playbook
// and its candidate are the skill factory's own, and every line of the campaign is the engine's.
async function qualified(t) {
  const { root } = fixture(t);
  bind(root, SHOP);
  const storeRoot = projectStoreRoot(root.store, SHOP.key);
  const io = realIo();
  const f = factoryPort({ paths: { storeRoot }, io }, values, resolve);
  const d = await f.scaffold({ provides: PROVIDES, task: "tsk-0123456789ab" });
  f.put({ id: d.id, name: "SKILL.md", text: GOOD });
  const parent = await f.register(d.id);
  f.scaffoldSuccessor({ id: ID, of: parent.pin, campaign: "imp-000000000000" });
  f.put({ id: ID, name: "SKILL.md", text: GOOD.replace("Never mark a row checked without its output.", "Never mark a row checked without its output, and name the record.") });
  const cand = f.stage(ID);
  const store = createImprovement(storeRoot, io);
  const ctx = { store, door: "improvement", session: "s", host: "laptop-a", pid: 1, now: () => "2026-10-30T00:00:00.000Z" };
  const { campaign } = start(ctx, { id: "opp-0123456789abcdef", fingerprint: "f".repeat(64), subject: { kind: "skill", id: ID }, pin: parent.pin, signal: "contract-violation", category: "definition", signature: ["notes"], runs: 4, sessions: 2, against: 0, evidence: [], tasks: [], attribution: { bound: 4, of: 4, words: ["RUNTIME_BOUND"] } });
  const oracleDigest = digestOfOracle(oracleOf("workflow", null));
  const lines = [["diagnosed", { cause: "definition", confidence: "high" }], ["proposed", { strategy: "successor" }], ["generating", { of: parent.pin }], ["generated", { candidate: "cand-000000000001", pin: cand.pin, digest: cand.digest, successorOf: parent.pin }], ["validated", { oracleDigest }]];
  // Two machines: independence is one machine on one UTC day (src/memory/session.mjs), never a session mark.
  for (const [n, session, host] of [[1, "a", "laptop-a"], [2, "b", "laptop-b"]]) lines.push(["evaluation-started", { evaluation: `ev${n}`, baseline: parent.pin, candidate: cand.pin, oracleDigest, session, host, inputs: [], eid: `ev${n}` }], ["evaluation-run", { evaluation: `ev${n}`, side: "baseline", n: 1, met: false, failing: ["notes"], blocked: false, attribution: "RUNTIME_BOUND", eid: `ev${n}b` }], ["evaluation-run", { evaluation: `ev${n}`, side: "candidate", n: 1, met: true, failing: [], blocked: false, attribution: "RUNTIME_BOUND", eid: `ev${n}c` }], ["evaluation-settled", { evaluation: `ev${n}`, verdict: "BETTER", regressions: [], eid: `ev${n}s` }]);
  lines.push(["qualified", { verdict: "BETTER", sessions: 2 }], ["awaiting-authority", { because: "automatic promotion is off" }]);
  for (const [kind, fields] of lines) record(ctx, campaign, kind, fields);
  return { root, ctx: contextFor(root), campaign, parent, cand, f, store };
}

const base = `/api/v1/projects/${SHOP.key}/improvement`;

test("reading improvement writes nothing: the campaigns, the opportunities, nine metrics with their denominators, and the bounds with who set each", async (t) => {
  const w = await qualified(t);
  const before = snapshot(w.root.store);
  const c = await started(t, w.ctx);
  const r = await c.get(base);
  assert.equal(r.status, 200);
  assert.equal(r.json.campaigns[0].phase, "AWAITING_AUTHORITY");
  assert.equal(r.json.metrics.length, 9);
  assert.ok(r.json.metrics.every((m) => "numerator" in m && "denominator" in m));
  assert.equal(r.json.settings.by.promote, "default");
  assert.ok(r.json.settings.fields.some((f) => f.key === "minSessions" && f.narrow === "max"));
  const one = await c.get(`${base}/campaigns/${w.campaign}`);
  assert.equal(one.status, 200);
  assert.deepEqual([one.json.campaign.candidate.pin, one.json.campaign.aggregate.verdict, one.json.campaign.evaluations.length], [w.cand.pin, "BETTER", 2]);
  assert.ok(one.json.campaign.events.some((e) => e.event === "candidate.awaiting_authority"));
  assert.equal((await c.get(`${base}/campaigns/imp-ffffffffffff`)).status, 404);
  assert.equal((await c.get(`${base}/opportunities`)).status, 200);
  assert.deepEqual(snapshot(w.root.store), before);
});

test("a person promotes in Control: only with the token, only on the revision the page read, through every gate and the factory's own door", async (t) => {
  const w = await qualified(t);
  const c = await started(t, w.ctx);
  const one = await c.get(`${base}/campaigns/${w.campaign}`);
  const at = one.json.campaign.revision;
  assert.equal((await c.bare("POST", `${base}/campaigns/${w.campaign}/promote`, { expectedRevision: at })).status, 403, "no token, no decision");
  assert.equal((await c.post(`${base}/campaigns/${w.campaign}/promote`, {})).status, 400);
  const stale = await c.post(`${base}/campaigns/${w.campaign}/promote`, { expectedRevision: at - 3 });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "STALE_REVISION"]);
  const done = await c.post(`${base}/campaigns/${w.campaign}/promote`, { expectedRevision: at });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.result.did, "PROMOTED");
  assert.deepEqual([done.json.campaign.promotion.by, done.json.campaign.promotion.door], ["person", "control"]);
  assert.equal(w.f.current(ID).pin, w.cand.pin, "the factory chose it, through its own door");
  const late = await c.post(`${base}/campaigns/${w.campaign}/reject`, { expectedRevision: done.json.campaign.revision });
  assert.deepEqual([late.status, late.json.error.code], [409, "IMP_PHASE"], "a promoted candidate is reverted, never rejected");
  const back = await c.post(`${base}/campaigns/${w.campaign}/revert`, { expectedRevision: done.json.campaign.revision });
  assert.equal(back.status, 200);
  assert.equal(w.f.current(ID).pin, w.parent.pin, "a person put the replaced version back");
  assert.equal(back.json.campaign.ended.outcome, "candidate-rejected");
});

test("a person rejects a qualified candidate; it never runs", async (t) => {
  const w = await qualified(t);
  const c = await started(t, w.ctx);
  const at = (await c.get(`${base}/campaigns/${w.campaign}`)).json.campaign.revision;
  const r = await c.post(`${base}/campaigns/${w.campaign}/reject`, { expectedRevision: at, because: "not what this project wants" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.campaign.rejected.reason, r.json.campaign.rejected.by, r.json.campaign.ended.outcome], ["PERSON_REJECTED", "person", "candidate-rejected"]);
  assert.equal(w.f.current(ID).pin, w.parent.pin);
});

test("the bounds a person sets go into the project's document, on the revision read, and only improvement's own fields", async (t) => {
  const w = await qualified(t);
  const c = await started(t, w.ctx);
  const saved = await c.put(`${base}/settings`, { settings: { promote: false, minSessions: 3 }, revision: null });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual([saved.json.saved.values.promote, saved.json.saved.values.minSessions, saved.json.saved.by.minSessions], [false, 3, "project"]);
  assert.equal((await c.put(`${base}/settings`, { settings: { minSessions: 4 }, revision: "0000000000000000" })).status, 409);
  assert.equal((await c.put(`${base}/settings`, { settings: { minSessions: 1 }, revision: saved.json.saved.revision })).status, 400, "one session is never enough");
  assert.equal((await c.put(`${base}/settings`, { settings: { allowExecutableCandidates: true }, revision: saved.json.saved.revision })).status, 400, "fixed");
  assert.equal((await c.bare("PUT", `${base}/settings`, { settings: { promote: true }, revision: saved.json.saved.revision })).status, 403);
});
