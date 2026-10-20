// What an investigation REMEMBERS: receipts in its journal, and -- for results
// an accepted oracle backs -- claims in the project's knowledge, through the one
// write door. The knowledge room here is the real one over a fake filesystem
// (test/fakes/knowledge.mjs), so every support count below is reconciliation's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { act, begin, checkData, checkpoint, contextFor, finish, modelOf, planAsInput, step } from "../src/investigation/index.mjs";
import { investigationHtml, investigationJson } from "../src/report/investigation.mjs";
import { projectReceipts, slugOf } from "../src/investigation/memory.mjs";
import { applicabilityOf } from "../src/investigation/receipts.mjs";
import { judge } from "../src/knowledge/record.mjs";
import { findPlan } from "../src/qa/load.mjs";
import { aqaWorld, post, SAVE_CHAIN, scriptedDb, started } from "./autonomous-qa.harness.mjs";
import { UI_TESTS } from "./fakes/context.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";

const PLAN_FILE = "ui-tests/screens/home/things.plan.json";
const COUNT = "SELECT COUNT(*) AS n FROM Things WHERE Name='${TC}'";
const decide = (ctx, id, target, action) => ({ schemaVersion: 1, decisionId: id, expectedRevision: ctx.position, target, action });

function knowledgeRoom() {
  return knowledgeWorld({ files: { [PLAN_FILE]: "plan revision 2", "ui-tests/graph/effects.json": "the map", "src/unrelated.ts": "x" } });
}

function bound(w, k, seen = { host: "laptop-a", session: "claude:0123456789abcdef" }) {
  return { ...w, memory: { knowledge: k, tracked: k.tracked() }, receipting: { scopeOf: (o) => (o.kind === "scenario-layer" ? [PLAN_FILE] : ["ui-tests/graph/effects.json"]), fingerprints: (paths) => k.source.fingerprints(paths), seen } };
}

// A PBI investigation of the fixture's committed plan, its case run once.
function pbi(k, planOver = {}) {
  const plan = { ...findPlan(join(UI_TESTS, "screens"), "things"), screen: undefined, ...planOver };
  const t = aqaWorld({ mode: "explore-write" });
  const { id } = begin(t.make(), { objective: "verify the things plan", scope: "", inputs: [planAsInput(plan, "things")] });
  const w = bound({ ...t.make({ id }), planOf: () => plan, findCase: () => ({ id: "create-thing", steps: [], creates: "a thing" }), digestOf: () => null, runCase: (c) => ({ case: c, status: "PASS", proved: { ui: 1, api: 1, sql: 1 }, cause: null, confidence: null, evidence: "e", case_digest: null }) }, k);
  const ctx = contextFor(w);
  step(w, decide(ctx, "run", ctx.frontier.find((o) => o.subject === "things#S1").id, { kind: "run-case", case: "create-thing" }));
  return { w, id };
}

const claims = (k) => k.know.all();

test("a checkpoint keeps each result as a receipt, and projects what an accepted oracle backs", () => {
  const k = knowledgeRoom();
  const { w, id } = pbi(k);
  const cp = checkpoint(w);
  const m = modelOf(w.store.read(id));
  assert.equal(cp.memory, "synced");
  assert.deepEqual(m.receipts.map((r) => [r.subject, r.layer, r.outcome, r.oracle.authority]).sort(), [["things#S1", "api", "satisfied", "accepted"], ["things#S1", "sql", "satisfied", "accepted"], ["things#S1", "ui", "satisfied", "accepted"]]);
  assert.deepEqual(cp.projected.sort(), m.receipts.map((r) => r.id).sort());
  const stored = claims(k);
  assert.equal(stored.length, 3, "one claim per layer: the same scenario in three contexts");
  assert.ok(stored.every((c) => c.source === "investigation" && c.relation === "satisfies" && c.subject === slugOf("things#S1")));
  assert.ok(stored.every((c) => c.evidence.every((e) => e.startsWith(`investigation:${id}#rct-`))), "each claim cites the receipt it rests on");
  assert.deepEqual(stored.map((c) => c.scope).flat(), [PLAN_FILE, PLAN_FILE, PLAN_FILE], "and watches the files the result rests on");
});

test("checkpointing again writes nothing new, and a replay from another host adds no support", () => {
  const k = knowledgeRoom();
  const { w, id } = pbi(k);
  checkpoint(w);
  const again = checkpoint(w);
  assert.deepEqual([again.receipts, again.projected], [[], []], "nothing new to keep, nothing left to project");
  const before = claims(k).map((c) => c.support.sessions);
  projectReceipts(bound(w, k, { host: "laptop-b", session: "claude:ffffffffffffffff" }), modelOf(w.store.read(id)).receipts);
  assert.deepEqual(claims(k).map((c) => c.support.sessions), before, "the receipt's own session counts once, whoever projects it");
});

test("a violated result counts against the claim a satisfied one made — it never overwrites it", () => {
  const k = knowledgeRoom();
  const good = started({ requests: [post(1)], db: scriptedDb([1]) });
  const gw = bound(good.w, k);
  const saved = SAVE_CHAIN.map((s) => act(gw, s).action).at(-1);
  checkData(gw, { action: saved.id, query: COUNT, expect: 1 });
  checkpoint(gw);
  const [claim] = claims(k).filter((c) => c.subject === slugOf("dlg-thing/Save"));
  assert.ok(claim, "the mapped write held, and knowledge says so");
  const bad = started({ requests: [post(1)], db: scriptedDb([0]) });
  const bw = bound(bad.w, k, { host: "laptop-b", session: "claude:aaaaaaaaaaaaaaaa" });
  const lost = SAVE_CHAIN.map((s) => act(bw, s).action).at(-1);
  checkData(bw, { action: lost.id, query: COUNT, expect: 1 });
  checkpoint(bw);
  const after = claims(k).find((c) => c.id === claim.id);
  assert.equal(after.object, claim.object, "not overwritten");
  assert.equal(after.support.against, 1, "contested");
});

test("a scope that moved reopens a satisfied obligation; a change nobody's result rests on does not", () => {
  const k = knowledgeRoom();
  const { w } = pbi(k);
  checkpoint(w);
  const sql = () => contextFor(w).frontier.find((o) => o.subject === "things#S1" && o.layer === "sql");
  k.source.write("src/unrelated.ts", "moved");
  assert.equal(sql(), undefined, "still satisfied: the plan did not move");
  k.source.write(PLAN_FILE, "plan revision 3");
  assert.match(sql()?.why ?? "", /moved since its receipt/, "owed again, and it says why");
});

test("a result that rests on nothing that can be read is unknown, never fresh", () => {
  assert.equal(applicabilityOf({ scope: [PLAN_FILE], fingerprints: { [PLAN_FILE]: "h" } }, { [PLAN_FILE]: null }), "unknown");
  assert.equal(applicabilityOf({ scope: [], fingerprints: {} }, {}), "unknown");
});

test("a draft plan's results are receipts, and never knowledge", () => {
  const k = knowledgeRoom();
  const { w } = pbi(k, { _draft: true });
  const cp = checkpoint(w);
  assert.equal(cp.receipts.length, 3);
  assert.deepEqual(cp.projected, []);
  assert.equal(claims(k).length, 0, "an agent's reading of a requirement is not the team's knowledge");
});

test("memory switched off, or failing, is said — and the journal keeps every receipt either way", () => {
  const k = knowledgeRoom();
  const off = pbi(k);
  off.w.settings = { ...off.w.settings, memory: { project: false } };
  const quiet = checkpoint(off.w);
  assert.deepEqual([quiet.memory, quiet.receipts.length], ["off", 3]);
  const broken = pbi(k);
  const failing = checkpoint({ ...broken.w, memory: { knowledge: { ...k, know: { ...k.know, transact: () => { throw new Error("the disk is full"); } } }, tracked: k.tracked() } });
  assert.equal(failing.memory, "failed");
  assert.match(failing.why, /disk is full/);
  assert.equal(modelOf(broken.w.store.read(broken.id)).receipts.length, 3);
});

test("the public knowledge door refuses an investigation claim — only the engine's stamped door records one", () => {
  const typed = { subject: "things-s1", relation: "satisfies", object: "things-ac1", evidence: [PLAN_FILE], source: "investigation", strength: "observed" };
  const judged = judge([{ i: 0, raw: typed }], { tracked: new Set([PLAN_FILE]), gates: new Set() });
  assert.equal(judged.refused, true);
  assert.match(judged.rejected[0].why, /stamped door/);
});

test("the report reads the loop's last snapshot: what was owed, why it stopped, what reached memory", () => {
  const k = knowledgeRoom();
  const { w, id } = pbi(k);
  checkpoint(w);
  finish(w, "the smoke is done");
  const model = modelOf(w.store.read(id));
  const html = investigationHtml(model, { project: "fixture" });
  for (const said of [/The loop/, /obligation\(s\) in scope/, /synced/, /rct-1/, /stopped \(paused\)/]) assert.match(html, said);
  const json = investigationJson(model, {});
  assert.deepEqual([json.loop.inputMode, json.loop.lifecycle, json.loop.stop.reason], ["pbi", "paused", "stopped-early"]);
  assert.ok(json.loop.counts.total >= json.loop.counts.rows.reduce((n, r) => n + r.n, 0) && json.loop.counts.total > 0, "every status over the total");
  assert.equal(json.loop.receipts.length, 3);
});
