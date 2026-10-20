// The moments a person or a host causes in a work's life, and what says a need may be
// proposed, settled or checkpointed -- exercised directly, over a fake filesystem, where the
// CLI test can only see them through a process.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { settle } from "../src/knowledge/opportunities.mjs";
import { MAX_NEEDS, NEED_FIELDS, SPECS, judgeNeeds, needFindings, needOf, safePath } from "../src/work/needs.mjs";
import { addNeeds, checkpointWork, findWork, settleNeed, startWork } from "../src/work/actions.mjs";
import { modelOf, needId, stateOf } from "../src/work/model.mjs";
import { aboutTask, recallWork } from "../src/work/views/recall.mjs";
import { showWork } from "../src/work/views/show.mjs";
import { listed, workSummary } from "../src/work/summary.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { knowledgeWorld, registryOf } from "./fakes/knowledge.mjs";

const NOW = "2026-09-30T10:00:00.000Z";
const ROOT = "req-3f9a1c0b7e21";
const WID = workOf(ROOT);
const IDENTITY = { provider: "azure-devops", organization: "acme", project: "web", id: "4312" };

const snap = (id, clarity, facts = []) => ({ id, root: ROOT, digest: `d-${id}`, clarity, authority: "draft", facts: facts.map(([fid, status = "stated"]) => ({ id: fid, revision: 1, status, digest: "x" })) });

// A real directory, because listing the works kept is listing directories, which the in-memory
// filesystem does not do; everything a test writes is removed after.
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function world(over = {}) {
  const k = knowledgeWorld();
  const dir = mkdtempSync(join(tmpdir(), "orbit-work-actions-"));
  dirs.push(dir);
  const works = createWorks(dir, realIo({ host: "laptop-a", now: () => NOW }));
  const state = { docs: over.docs ?? { "rs-aaaaaaaaaaaa": snap("rs-aaaaaaaaaaaa", "complete", [["rf-aaaaaaaaaaaa"], ["rf-bbbbbbbbbbbb", "unknown"]]) }, hashes: over.hashes ?? {} };
  const source = { fingerprints: (paths) => Object.fromEntries(paths.map((p) => [p, { hash: state.hashes[p] ?? null, dirty: over.dirty ? 1 : 0, files: 1 }])) };
  const w = { works, now: () => NOW, session: "s1", source, snapshot: (id) => state.docs[id] ?? null, latestSnapshot: () => Object.values(state.docs).at(-1) ?? null, effective: () => registryOf([]), opportunities: { docs: () => k.know.opportunities(), settle: (docs) => settle(k, docs) } };
  return { w, works, state };
}

const started = (m, snapshot = "rs-aaaaaaaaaaaa") => startWork(m.w, { objective: "Implement the refund limit", root: ROOT, identity: IDENTITY, snapshot });
const model = (m) => modelOf(m.works.read(WID));
const row = (over = {}) => ({ type: "action", subject: "form", asks: "Add the check to the form", ...over });

test("a work is started once per requirement, with its objective and the item it is about, and adopts a snapshot", () => {
  const m = world();
  const first = started(m);
  assert.deepEqual([first.created, first.work, first.adopted], [true, WID, "rs-aaaaaaaaaaaa"]);
  assert.deepEqual([model(m).meta.objective, model(m).meta.root.id, model(m).snapshot.snapshot], ["Implement the refund limit", "4312", "rs-aaaaaaaaaaaa"]);
  const again = startWork(m.w, { objective: "a different sentence", root: ROOT, identity: IDENTITY, snapshot: "rs-aaaaaaaaaaaa" });
  assert.deepEqual([again.created, again.adopted, model(m).meta.objective], [false, null, "Implement the refund limit"]);
});

test("a work needs an objective to begin, and a snapshot it can read, and a refusal leaves no room behind", () => {
  const m = world();
  assert.throws(() => startWork(m.w, { objective: "  ", root: ROOT, identity: IDENTITY }), /a work has an objective/);
  assert.throws(() => startWork(m.w, { objective: "x", root: ROOT, identity: IDENTITY, snapshot: "rs-ffffffffffff" }), (e) => e instanceof Refused && /no snapshot rs-ffffffffffff/.test(e.message));
  assert.equal(m.works.exists(WID), false);
  assert.equal(startWork(m.w, { objective: "x", root: ROOT, identity: IDENTITY }).adopted, null, "a work may begin before any snapshot is adopted");
});

test("adopting a newer snapshot is written once, and adopting the same one again writes nothing", () => {
  const m = world();
  started(m);
  m.state.docs["rs-bbbbbbbbbbbb"] = snap("rs-bbbbbbbbbbbb", "partial");
  assert.equal(startWork(m.w, { root: ROOT, identity: IDENTITY, snapshot: "rs-bbbbbbbbbbbb" }).adopted, "rs-bbbbbbbbbbbb");
  assert.equal(startWork(m.w, { root: ROOT, identity: IDENTITY, snapshot: "rs-bbbbbbbbbbbb" }).adopted, null);
  assert.deepEqual(model(m).snapshots.map((s) => s.snapshot), ["rs-aaaaaaaaaaaa", "rs-bbbbbbbbbbbb"]);
});

test("a work is found by its id, its requirement's id or its item's id, and never guessed between two", () => {
  const m = world();
  started(m);
  for (const ref of [WID, ROOT, "4312"]) assert.equal(findWork(m.works, ref), WID);
  assert.throws(() => findWork(m.works, "9999"), /no work is kept for 9999/);
  const otherRoot = "req-aaaaaaaaaaaa";
  m.works.create({ id: workOf(otherRoot), objective: "another", root: { ...IDENTITY, provider: "github" } });
  assert.throws(() => findWork(m.works, "4312"), (e) => e instanceof Refused && /more than one work/.test(e.message));
  assert.equal(findWork(m.works, WID), WID);
});

test("what a need may say is one table of rows, each a sentence", () => {
  assert.ok(SPECS.length >= 5 && SPECS.every((s) => typeof s.name === "string" && typeof s.say === "function"));
  assert.deepEqual(Object.keys(NEED_FIELDS).sort(), ["asks", "because", "capability", "dependsOn", "scope", "subject", "type"]);
  const world$ = { facts: null, needs: new Set() };
  const why = (raw) => needFindings(raw, "n", world$).join("\n");
  assert.equal(why(row()), "");
  assert.match(why(row({ type: "knowledge" })), /names the capability/);
  assert.match(why(row({ subject: "Not A Slug" })), /subject/);
  assert.match(why(row({ subject: "0123456789abcdef0123456789abcdef01234567" })), /looks like a secret/);
  assert.match(why(row({ dependsOn: ["rf-aaaaaaaaaaaa"] })), /has adopted none/);
  assert.match(why(row({ asks: "x".repeat(300) })), /at most 240/);
  assert.match(why(row({ dependsOn: Array.from({ length: 9 }, (_, i) => `nd-${String(i).padStart(10, "0")}`) })), /at most 8/);
  assert.match(why("nope"), /must be a JSON object/);
});

test("a path in a scope stays inside the project", () => {
  for (const ok of ["src/app/refunds.ts", "docs", "a/b.c"]) assert.equal(safePath(ok), true, ok);
  for (const bad of ["/etc/passwd", "../x", "a/../b", "C:\\x", "a\\b", "file:///x", "", "x".repeat(201), "a/*.ts"]) assert.equal(safePath(bad), false, bad);
});

test("a need's id is what it is: the same need twice is one, and dependencies are sorted and unique", () => {
  const a = needOf(WID, row({ dependsOn: ["rf-bbbbbbbbbbbb", "rf-aaaaaaaaaaaa", "rf-aaaaaaaaaaaa"] }));
  const b = needOf(WID, row({ asks: "reworded" }));
  assert.equal(a.id, b.id);
  assert.deepEqual(a.dependsOn, ["rf-aaaaaaaaaaaa", "rf-bbbbbbbbbbbb"]);
  assert.equal(a.id, needId(WID, "action", null, "form"));
});

test("dependencies point backwards only: a need may wait on one before it in the same batch, not after", () => {
  const first = needOf(WID, row());
  const forward = judgeNeeds(WID, [row({ subject: "later", dependsOn: [first.id] }), row()], { facts: null, needs: new Set() });
  assert.match(forward.rejected[0], /not a need proposed before this one/);
  const backward = judgeNeeds(WID, [row(), row({ subject: "later", dependsOn: [first.id] })], { facts: null, needs: new Set() });
  assert.deepEqual([backward.rejected, backward.accepted.length], [[], 2]);
});

test("needs may depend on the facts the adopted snapshot lists, and on no others", () => {
  const m = world();
  started(m);
  const done = addNeeds(m.w, WID, [row({ dependsOn: ["rf-aaaaaaaaaaaa"] })]);
  assert.equal(done.added.length, 1);
  assert.throws(() => addNeeds(m.w, WID, [row({ subject: "other", dependsOn: ["rf-cccccccccccc"] })]), /not a fact of the snapshot this work adopted/);
  assert.equal(model(m).needs.size, 1);
});

test("a work holds a bounded number of needs, and a batch that would pass the bound writes none of them", () => {
  const m = world();
  started(m);
  const many = Array.from({ length: MAX_NEEDS + 1 }, (_, i) => row({ subject: `s${i}` }));
  assert.throws(() => addNeeds(m.w, WID, many), (e) => e instanceof Refused && new RegExp(`at most ${MAX_NEEDS}`).test(e.message));
  assert.equal(model(m).needs.size, 0);
  assert.equal(addNeeds(m.w, WID, many.slice(0, MAX_NEEDS)).added.length, MAX_NEEDS);
});

test("a need's words are scrubbed on the way in, and what is kept is what the journal allows", () => {
  const m = world();
  started(m);
  addNeeds(m.w, WID, [row({ asks: "call it with Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD" })]);
  assert.doesNotMatch(JSON.stringify(m.works.read(WID)), /abcdefghijklmnopqrstuvwxyz0123456789ABCD/);
});

test("a need is settled as satisfied only on evidence, blocked or not applicable only with a reason", () => {
  const m = world();
  started(m);
  const [{ need }] = addNeeds(m.w, WID, [row()]).added;
  const settled = (spec) => settleNeed(m.w, WID, { need, evidence: [], ...spec });
  assert.throws(() => settled({ state: "satisfied" }), /takes evidence/);
  assert.throws(() => settled({ state: "blocked" }), /say why it is blocked/);
  assert.throws(() => settled({ state: "not-applicable" }), /say why it is not needed/);
  assert.throws(() => settled({ state: "finished" }), /--state is one of/);
  assert.throws(() => settleNeed(m.w, WID, { need: "nd-ffffffffff", state: "blocked", why: "x" }), /there is no need/);
  assert.equal(settled({ state: "satisfied", evidence: ["the unit test passes"] }).state, "satisfied");
  assert.equal(stateOf(model(m).needs.get(need), model(m)), "satisfied");
});

test("evidence is bounded, and a receipt named must be an answered one of this need", () => {
  const m = world();
  started(m);
  const [{ need }] = addNeeds(m.w, WID, [row()]).added;
  const [{ need: other }] = addNeeds(m.w, WID, [row({ subject: "other" })]).added;
  m.works.append(WID, "receipt", { id: "rct-1", need: other, outcome: "ok", provider: "p" });
  assert.throws(() => settleNeed(m.w, WID, { need, state: "satisfied", receipt: "rct-1" }), /not an answered receipt of/);
  settleNeed(m.w, WID, { need, state: "satisfied", evidence: Array.from({ length: 20 }, (_, i) => `e${i}`) });
  assert.equal(model(m).settled.get(need).evidence.length, 8);
  settleNeed(m.w, WID, { need: other, state: "satisfied", receipt: "rct-1" });
  assert.equal(model(m).settled.get(other).receipt, "rct-1");
});

test("settling a need about files records what they hash to now, but only the clean ones", () => {
  const m = world({ hashes: { "src/a.ts": "h1", "src/b.ts": null } });
  started(m);
  const [{ need }] = addNeeds(m.w, WID, [row({ scope: ["src/a.ts", "src/b.ts"] })]).added;
  settleNeed(m.w, WID, { need, state: "satisfied", evidence: ["e"] });
  assert.deepEqual(model(m).settled.get(need).scopes, { "src/a.ts": "h1" });
  const dirty = world({ hashes: { "src/a.ts": "h1" }, dirty: true });
  started(dirty);
  const [{ need: n2 }] = addNeeds(dirty.w, WID, [row({ scope: ["src/a.ts"] })]).added;
  settleNeed(dirty.w, WID, { need: n2, state: "satisfied", evidence: ["e"] });
  assert.deepEqual(modelOf(dirty.works.read(WID)).settled.get(n2).scopes, {}, "an edit the index cannot see is no baseline");
});

test("blocked and not-applicable record no baseline", () => {
  const m = world({ hashes: { "src/a.ts": "h1" } });
  started(m);
  const [{ need }] = addNeeds(m.w, WID, [row({ scope: ["src/a.ts"] })]).added;
  settleNeed(m.w, WID, { need, state: "blocked", why: "waiting" });
  assert.equal(model(m).settled.get(need).scopes, undefined);
});

test("a checkpoint writes the frontier it found after looking again, and where the journal stood", () => {
  const m = world();
  started(m);
  addNeeds(m.w, WID, [row(), row({ subject: "waits", dependsOn: ["rf-bbbbbbbbbbbb"] })]);
  const cp = checkpointWork(m.w, WID, "end of day");
  assert.deepEqual([cp.checkpoint, cp.frontier.map((f) => f.subject)], ["ckp-1", ["form"]], "the need waiting on an unknown fact is not ready");
  const line = model(m).checkpoints.at(-1);
  assert.deepEqual([line.frontier.length, line.snapshot, line.why, line.upto], [1, "rs-aaaaaaaaaaaa", "end of day", model(m).position - 1]);
});

test("the view of a work lists every need with its state, binding and receipts", () => {
  const m = world();
  started(m);
  const [{ need }] = addNeeds(m.w, WID, [row()]).added;
  m.works.append(WID, "receipt", { id: "rct-1", need, outcome: "ok", provider: "p" });
  const shown = showWork(m.w, WID);
  assert.deepEqual([shown.work, shown.snapshot, shown.needs[0].receipts, shown.needs[0].lastOutcome, shown.needs[0].state], [WID, "rs-aaaaaaaaaaaa", 1, "ok", "pending"]);
  assert.deepEqual([shown.root.id, shown.sessions, shown.lastCheckpoint], ["4312", 0, null]);
});

test("the summary counts a work whose requirement is not complete as open, and one that has a blocking question as blocked", () => {
  const m = world({ docs: { "rs-aaaaaaaaaaaa": snap("rs-aaaaaaaaaaaa", "complete"), "rs-bbbbbbbbbbbb": snap("rs-bbbbbbbbbbbb", "blocked") } });
  started(m);
  const second = "req-aaaaaaaaaaaa";
  m.works.create({ id: workOf(second), objective: "another", root: { ...IDENTITY, id: "1" } });
  m.works.append(workOf(second), "snapshot", { id: "snp-1", snapshot: "rs-bbbbbbbbbbbb" });
  const noSnapshot = "req-bbbbbbbbbbbb";
  m.works.create({ id: workOf(noSnapshot), objective: "third", root: { ...IDENTITY, id: "2" } });
  const s = workSummary(m.works, m.w.snapshot);
  assert.deepEqual([s.works.length, s.open, s.blocked], [3, 2, 1]);
  assert.deepEqual(s.works.map((w) => w.clarity).sort(), ["blocked", "complete", null].sort());
});

test("the summary is never a reason for anything else to fail: a journal from a newer engine is counted open and not read", () => {
  const m = world();
  m.works.create({ id: WID, objective: "from the future", root: IDENTITY, schema: 99 });
  const s = workSummary(m.works);
  assert.deepEqual([s.works.length, s.open, s.works[0].needs], [1, 1, null]);
  assert.deepEqual(listed({ list: () => { throw new Error("disk gone"); } }), []);
});

test("a task is about a work when it names its item by id, or shares enough of its words", () => {
  const head = { id: WID, root: IDENTITY, objective: "Implement the refund limit for large orders" };
  assert.equal(aboutTask(head, "continue PBI 4312 please"), true);
  assert.equal(aboutTask(head, "continue pbi 43120"), false, "a longer number is another item");
  assert.equal(aboutTask(head, "implement the refund limit"), true);
  assert.equal(aboutTask(head, "refund"), false, "one shared word is not enough");
  assert.equal(aboutTask(head, `look at ${WID}`), true);
  assert.equal(aboutTask({ ...head, root: null }, "continue PBI 4312"), false);
});

test("recall lists the work a task is about, its frontier bounded, and never fails on a journal it cannot read", () => {
  const m = world();
  started(m);
  addNeeds(m.w, WID, Array.from({ length: 8 }, (_, i) => row({ subject: `s${i}` })));
  const out = recallWork(m.w, "Implement the refund limit for PBI 4312");
  assert.deepEqual([out.kept, out.matches.length, out.matches[0].frontier, out.matches[0].next.length], [1, 1, 8, 5]);
  m.works.create({ id: "w-aaaaaaaaaaaa", objective: "Implement the refund limit too", root: { ...IDENTITY, id: "5" }, schema: 99 });
  assert.equal(recallWork(m.w, "Implement the refund limit").matches.length, 1, "the unreadable one is left out");
});

test("a checkpoint finds what moved BEFORE it marks the frontier, so the frontier is never a stale one", () => {
  const m = world();
  started(m);
  addNeeds(m.w, WID, [row({ dependsOn: ["rf-aaaaaaaaaaaa"] }), row({ subject: "free" })]);
  m.state.docs["rs-bbbbbbbbbbbb"] = snap("rs-bbbbbbbbbbbb", "complete", [["rf-aaaaaaaaaaaa", "decided"], ["rf-bbbbbbbbbbbb", "unknown"]]);
  const cp = checkpointWork(m.w, WID);
  assert.deepEqual([cp.stale.length, cp.frontier.map((f) => f.subject)], [1, ["free"]], "the need that rested on the moved fact is not ready");
  assert.deepEqual(model(m).records.map((r) => r.kind).slice(-2), ["stale", "checkpoint"], "what moved is written first");
});
