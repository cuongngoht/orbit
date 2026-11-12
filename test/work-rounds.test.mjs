// A BOUNDED DISCOVERY LOOP on the task's own work (0.6.0, U2; src/work/rounds.mjs): the work journal is the record --
// done criteria are proof needs, gaps knowledge needs, a round a checkpoint that keeps what it asked and what it settled
// anew. Rounds stop when the budget is spent or two in a row settle nothing new; a target is never offered again while
// what answered it is settled and unmoved; and a later session re-reads only what went stale.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { addNeeds, checkpointWork, settleNeed, startWork } from "../src/work/actions.mjs";
import { modelOf } from "../src/work/model.mjs";
import { resume } from "../src/work/resume.mjs";
import { MAX_ASKED, MAX_ROUNDS, NO_GAIN_ROUNDS, ROUND_STOP, gainedSince, offered, roundsOf, targetKey } from "../src/work/rounds.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { KINDS } from "../src/work/vocab.mjs";
import { realIo } from "../src/store/io.mjs";
import { settle as settleOpportunities } from "../src/knowledge/opportunities.mjs";
import { knowledgeWorld, registryOf } from "./fakes/knowledge.mjs";

const NOW = "2026-11-12T10:00:00.000Z";
const ROOT = "req-3f9a1c0b7e21";
const WID = workOf(ROOT);
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A work over a source whose files hash to what `hashes` says; `session` is which session is looking.
function world(hashes = {}) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-work-rounds-"));
  dirs.push(dir);
  const works = createWorks(dir, realIo({ host: "laptop-a", now: () => NOW }));
  const source = { fingerprints: (paths) => Object.fromEntries(paths.map((p) => [p, hashes[p] ? { hash: hashes[p], dirty: 0, files: 1 } : null])) };
  const k = knowledgeWorld();
  const w = { works, now: () => NOW, session: "s1", source, snapshot: () => null, latestSnapshot: () => null, effective: () => registryOf([]), opportunities: { docs: () => k.know.opportunities(), settle: (docs) => settleOpportunities(k, docs) } };
  startWork(w, { objective: "fix the login bug", root: ROOT, identity: { provider: "github", organization: "o", project: "p", id: "7" } });
  return { w, hashes };
}

const model = (m) => modelOf(m.w.works.read(WID));

const needs = (m, rows) => addNeeds(m.w, WID, rows).added.map((a) => a.need);

const gap = (subject, scope = []) => ({ type: "knowledge", capability: "code.read", subject, asks: `what does ${subject} do`, scope });

const proof = (subject, scope = []) => ({ type: "proof", capability: "verification.test", subject, asks: `${subject} holds`, scope });

const settle = (m, need, state = "satisfied") => settleNeed(m.w, WID, state === "satisfied" ? { need, state, evidence: ["read it"] } : { need, state, why: "cannot be found out here" });

const round = (m, asked = []) => checkpointWork(m.w, WID, "a round", asked);

const T = (source, target) => ({ source, target, run: null });

test("a checkpoint keeps what the round asked and what it settled anew -- both in the journal's allow-list", () => {
  assert.ok(KINDS.checkpoint.includes("asked") && KINDS.checkpoint.includes("gained"));
  const m = world();
  const [a, b] = needs(m, [gap("login-page"), proof("login-works")]);
  settle(m, a);
  const first = round(m, ["host · references"]);
  assert.deepEqual([first.gained, model(m).checkpoints[0].asked, model(m).checkpoints[0].gained], [[a], ["host · references"], [a]]);
  settle(m, a);
  assert.deepEqual(round(m).gained, [], "settled again as it was: no gain");
  settle(m, b, "blocked");
  assert.deepEqual(gainedSince(model(m)), [b], "a gap that cannot be filled here, settled blocked, is still something the round found out");
});

test("ROUND_STOP: the budget is MAX_ROUNDS checkpoints, whatever they gained", () => {
  const m = world();
  const ids = needs(m, Array.from({ length: MAX_ROUNDS }, (_, i) => gap(`gap-${i}`)));
  for (const id of ids.slice(0, MAX_ROUNDS - 1)) (settle(m, id), round(m));
  assert.deepEqual([roundsOf(model(m)).stop, roundsOf(model(m)).row], [false, "go-on"]);
  settle(m, ids.at(-1));
  const last = round(m);
  assert.deepEqual([last.round.rounds, last.round.stop, last.round.row], [MAX_ROUNDS, true, "budget"]);
  assert.match(last.round.because, new RegExp(`${MAX_ROUNDS} of ${MAX_ROUNDS} rounds are spent`));
});

test("ROUND_STOP: two rounds in a row that settle nothing new stop the loop; a round that gains goes on", () => {
  const m = world();
  const [a] = needs(m, [gap("session-module")]);
  round(m);
  assert.equal(roundsOf(model(m)).row, "go-on", "one empty round is not two");
  settle(m, a);
  round(m);
  assert.equal(roundsOf(model(m)).row, "go-on", "the last round gained");
  round(m);
  assert.equal(roundsOf(model(m)).row, "go-on");
  round(m);
  assert.deepEqual([roundsOf(model(m)).stop, roundsOf(model(m)).row], [true, "no-gain"]);
  assert.equal(NO_GAIN_ROUNDS, 2);
  assert.deepEqual(ROUND_STOP.map((r) => r.row), ["budget", "no-gain", "go-on"]);
  assert.equal(ROUND_STOP.at(-1).when(model(m)), true, "the last row always holds");
});

test("a target is never offered again while the need it answered is settled and its files unmoved", () => {
  const m = world({ "web/src/api/sessionClient.js": "h1" });
  const [a] = needs(m, [gap("session-client", ["web/src/api/sessionClient.js"])]);
  const target = T("host", "references");
  assert.equal(offered(target, { model: model(m) }), true, "never asked");
  round(m, [targetKey(target)]);
  assert.equal(offered(target, { model: model(m) }), true, "asked, and nothing answered it: offered again (NO_GAIN bounds that)");
  settle(m, a);
  round(m, [targetKey(target)]);
  assert.equal(offered(target, { model: model(m) }), false, "answered by a settled, unmoved need");
  assert.equal(offered(T("runtime", "component graph"), { model: model(m) }), true, "another target is another question");
  assert.equal(offered(target, { model: model(m), moved: new Set([a]) }), true, "its file moved since: read again");
  m.hashes["web/src/api/sessionClient.js"] = "h2";
  round(m);
  assert.equal(offered(target, { model: model(m) }), true, "once a checkpoint records the move, the need is stale and the target offered");
});

// The next session reads the journal: what is still settled and fresh is reused, and only what went stale is read again.
test("a second session reuses the fresh needs and re-reads only the stale one", () => {
  const m = world({ "web/src/pages/LoginPage.jsx": "p1", "server/app/auth/session.py": "s1" });
  const [page, session] = needs(m, [gap("login-page", ["web/src/pages/LoginPage.jsx"]), gap("session-module", ["server/app/auth/session.py"])]);
  settle(m, page);
  settle(m, session);
  const pageTarget = T("host", "web/src/pages/LoginPage.jsx");
  const sessionTarget = T("host", "server/app/auth/session.py");
  round(m, [targetKey(pageTarget), targetKey(sessionTarget)]);
  m.hashes["server/app/auth/session.py"] = "s2";
  m.w.session = "s2";
  const resumed = resume(m.w, WID);
  assert.deepEqual(resumed.stale.map((s) => s.need), [session], "only the need whose file moved");
  assert.deepEqual(resumed.needs.map((n) => [n.need, n.state]), [[page, "satisfied"], [session, "stale"]]);
  assert.deepEqual([offered(pageTarget, { model: model(m) }), offered(sessionTarget, { model: model(m) })], [false, true], "the fresh one is not offered again; the stale one is");
  assert.equal(resume(m.w, WID).stale.length, 0, "resuming again finds nothing new to re-read");
});

test("what a host says it asked is bounded and refused whole when it is not a target line", () => {
  const m = world();
  assert.throws(() => round(m, Array.from({ length: MAX_ASKED + 1 }, (_, i) => `host · t${i}`)), (e) => e instanceof Refused && /at most/.test(e.message));
  assert.throws(() => round(m, ["x".repeat(500)]), /one line of at most/);
  assert.throws(() => round(m, ["a\nb"]), /one line/);
  assert.equal(model(m).checkpoints.length, 0, "a refusal writes no round");
  assert.deepEqual(round(m, ["host · references", "host · references"]).gained, []);
  assert.deepEqual(model(m).checkpoints[0].asked, ["host · references"], "kept once");
});
