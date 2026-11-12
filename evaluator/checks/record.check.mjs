// The record a release's publish gate reads (lib/record.mjs), from campaign rooms written by hand under the real
// pre-registration: every run's word per arm and task, each arm's commit, the pre-registration's path and digest, the
// pre-registered comparisons by its own rule, and what it still owes -- and refused whenever it would be a mixture: a
// campaign made under another pre-registration, an arm at two commits, a run in two campaigns.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonical, EVALUATOR_DIR, sha256, appendLine, writeJson } from "../lib/core/util.mjs";
import { amendedOf, amendmentsOf, loadPrereg, overallOf, setTasks, verdictOf } from "../lib/prereg/index.mjs";
import { RECORD_KIND, recordOf } from "../lib/record.mjs";

const FILE = join(EVALUATOR_DIR, "prereg", "0.6.0.json");
const P = loadPrereg(FILE);
const AMENDMENTS = amendmentsOf(FILE);
const Q = amendedOf(P, AMENDMENTS);
const DIGEST = sha256(canonical(P));
const HELD = setTasks(P, "heldOut");
const RC = "1".repeat(40);
const V050 = "54aaf0b65bdb8f931ab6fe80c7bf368a971f2aab";

const keyOf = (arm, task) => `${arm}__${task.replace(/[:/]/g, "_")}__t1`;

const armsFor = (ids, commits) => Object.fromEntries(ids.map((id) => [id, { ...Q.arms[id], rev: Q.arms[id].rev ?? commits[id], frozen: commits[id] ? { commit: commits[id] } : {} }]));

// The amendment a phase is in, as a campaign made from it freezes it.
const amendmentOf = (ph) => ((a) => (a ? { n: a.n, file: a.file, digest: a.digest } : null))(AMENDMENTS.find((x) => x.n === ph.amendment));

const COMMITS = { "orbit-0.5.0": V050, "orbit-0.6.0": RC, "mini-orbit-0.6.0": RC, "orbit-0.5.0-seated": V050, "orbit-0.6.0-seated": RC };

// One campaign room: its frozen campaign.json and a journal saying each run's word (or that it never ran).
function campaign(home, id, phase, words, o = {}) {
  const ph = Q.phases.find((x) => x.id === phase);
  const plan = HELD.flatMap((task) => ph.arms.map((arm) => ({ arm, task, trial: 1, key: keyOf(arm, task) })));
  const dir = join(home, "campaigns", id);
  mkdirSync(dir, { recursive: true });
  const amendment = o.amendment === undefined ? amendmentOf(ph) : o.amendment;
  writeJson(join(dir, "campaign.json"), { id, prereg: { release: P.release, phase, digest: o.digest ?? DIGEST, ...(amendment ? { amendment } : {}) }, model: P.host.model, effort: P.host.effort, limits: P.limits, budgetUsd: ph.budgetUsd, claudeCode: "2.1.322", arms: armsFor(ph.arms, o.commits ?? COMMITS), plan, evaluator: { commit: "e", dirty: false } });
  for (const r of plan) said(join(dir, "journal.jsonl"), r, words(r.arm, r.task));
  appendLine(join(dir, "journal.jsonl"), { kind: "finished" });
}

function said(journal, r, word) {
  if (word === "NOT_RUN") return appendLine(journal, { kind: "skipped", run: r.key, reason: "credential: the controller's environment has no ORBIT_EVAL_ANTHROPIC_API_KEY" });
  appendLine(journal, { kind: "started", run: r.key, attempt: 1, capUsd: 1 });
  appendLine(journal, { kind: "ended", run: r.key, attempt: 1, chargedUsd: 0.3, wallMs: 300000, summary: { costUsd: 0.3 } });
  if (word) appendLine(journal, { kind: "outcome", run: r.key, attempt: 1, word, why: null });
}

// The release resolves every held-out task, the plain host and 0.5.0 half of them; the mini arms never ran.
const FINAL = (arm, task) => (arm === "orbit-0.6.0" || HELD.indexOf(task) % 2 === 0 ? "RESOLVED" : "UNRESOLVED");

const withHome = (f) => {
  const home = mkdtempSync(join(tmpdir(), "evl-rec-"));
  try { return f(home); }
  finally { rmSync(home, { recursive: true, force: true }); }
};

test("a record of the held-out campaigns: every run's word, each arm's commit, the pre-registration's path and digest, its comparisons by its own rule", () => withHome((home) => {
  campaign(home, "final-060", "final", FINAL);
  campaign(home, "mini-060", "mini", () => "NOT_RUN");
  const r = recordOf({ prereg: FILE, campaigns: ["final-060", "mini-060"], home });
  assert.deepEqual([r.schema, r.kind, r.release, r.prereg], [1, RECORD_KIND, "0.6.0", { file: "evaluator/prereg/0.6.0.json", digest: DIGEST }]);
  assert.deepEqual([r.arms["orbit-0.6.0"].commit, r.arms["mini-orbit-0.6.0"].commit, r.arms["orbit-0.5.0"].commit, r.arms.plain.commit], [RC, RC, V050, null]);
  assert.equal(r.runs.length, HELD.length * 5);
  assert.ok(r.runs.filter((x) => x.phase === "mini").every((x) => x.word === "NOT_RUN"), "an arm whose credential never came is NOT_RUN, said");
  const rows = r.runs.map((x) => ({ task: x.task, arm: x.arm, word: x.word }));
  for (const c of r.comparisons) assert.equal(c.verdict, verdictOf(rows, c.a, c.b, P.verdictRule).verdict, `${c.a} against ${c.b}`);
  assert.deepEqual(r.comparisons.map((c) => [c.a, c.b, c.gate, c.verdict]), [["orbit-0.6.0", "plain", true, "IMPROVED"], ["orbit-0.6.0", "orbit-0.5.0", true, "IMPROVED"], ["mini-orbit-0.6.0", "mini", false, "INCONCLUSIVE"]]);
  assert.equal(r.verdict, "IMPROVED", "the mini comparison is reported and not part of the verdict");
  assert.deepEqual(r.missing, [], "NOT_RUN is allowed only where the verdict does not rest on the arm");
  assert.deepEqual([r.comparisons[0].medianCostUsd, r.comparisons[0].medianMinutes], [{ "orbit-0.6.0": 0.3, plain: 0.3 }, { "orbit-0.6.0": 5, plain: 5 }]);
}));

test("what a record still owes is said: a run with no word, and NOT_RUN on an arm the verdict rests on", () => withHome((home) => {
  campaign(home, "final-060", "final", (arm, task) => (arm === "plain" && task === HELD[0] ? null : arm === "orbit-0.5.0" && task === HELD[1] ? "NOT_RUN" : "RESOLVED"));
  const r = recordOf({ prereg: FILE, campaigns: ["final-060"], home });
  assert.deepEqual(r.missing.slice(0, 2), [`plain on ${HELD[0]}`, `orbit-0.5.0 on ${HELD[1]}`]);
  assert.ok(r.missing.includes(`mini on ${HELD[0]}`), "a held-out phase nobody named is owed too");
}));

test("a record is one evaluation: another pre-registration, an arm at two commits, a run in two campaigns are refused", () => withHome((home) => {
  campaign(home, "other", "final", FINAL, { digest: "0".repeat(64) });
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["other"], home }), /not made from this pre-registration/);
  campaign(home, "final-a", "final", FINAL);
  campaign(home, "final-b", "final", FINAL, { commits: { "orbit-0.5.0": V050, "orbit-0.6.0": "2".repeat(40) } });
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["final-a", "final-b"], home }), /ran at two commits/);
  campaign(home, "final-c", "final", FINAL);
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["final-a", "final-c"], home }), /in two campaigns named/);
  assert.throws(() => recordOf({ prereg: FILE, campaigns: [], home }), /name the campaigns/);
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["absent"], home }), /no campaign absent/);
}));

// ---- the amendment: the seated condition, a secondary verdict beside the primary ----------------------------------------------

// Seated, the release resolves every held-out task but one, 0.5.0 seated half of them.
const SEATED = (arm, task) => (arm === "orbit-0.6.0-seated" ? (task === HELD[0] ? "UNRESOLVED" : "RESOLVED") : arm === "orbit-0.5.0-seated" ? (HELD.indexOf(task) % 2 ? "UNRESOLVED" : "RESOLVED") : "REGRESSED");

test("an amendment's comparisons are the record's SECONDARY verdict, by the registered rule over the same held-out runs; the primary is what it would be without them", () => withHome((home) => {
  campaign(home, "final-060", "final", FINAL);
  campaign(home, "mini-060", "mini", () => "NOT_RUN");
  const primary = recordOf({ prereg: FILE, campaigns: ["final-060", "mini-060"], home });
  campaign(home, "final-seated-060", "final-seated", SEATED);
  const r = recordOf({ prereg: FILE, campaigns: ["final-060", "mini-060", "final-seated-060"], home });
  assert.deepEqual([r.comparisons, r.verdict, r.missing], [primary.comparisons, primary.verdict, primary.missing], "the primary comparisons, verdict and what they owe are the registration's alone");
  assert.deepEqual(r.secondary.amendments, AMENDMENTS.map((a) => ({ n: a.n, file: a.file, digest: a.digest })));
  const rows = r.runs.map((x) => ({ task: x.task, arm: x.arm, word: x.word }));
  assert.deepEqual(r.secondary.comparisons.map((c) => [c.a, c.b, c.gate, c.verdict]), [["orbit-0.6.0-seated", "plain", false, verdictOf(rows, "orbit-0.6.0-seated", "plain", P.verdictRule).verdict], ["orbit-0.6.0-seated", "orbit-0.5.0-seated", false, verdictOf(rows, "orbit-0.6.0-seated", "orbit-0.5.0-seated", P.verdictRule).verdict]]);
  assert.deepEqual(r.secondary.comparisons.map((c) => c.verdict), ["IMPROVED", "IMPROVED"], "plain's words are the registered final's");
  assert.equal(r.secondary.verdict, overallOf(r.secondary.comparisons.map((c) => c.verdict)));
  assert.deepEqual(r.secondary.missing.filter((m) => !/memory-seated|track/.test(m)), [], "the held-out seated runs are all held (the memory phase's are owed apart)");
  assert.deepEqual([r.arms["orbit-0.6.0-seated"], r.arms["orbit-0.5.0-seated"].commit], [{ kind: "claude+orbit", rev: RC, commit: RC, seat: true }, V050]);
  const without = recordOf({ prereg: FILE, campaigns: ["final-060"], home });
  assert.ok(without.secondary.missing.includes(`orbit-0.6.0-seated on ${HELD[0]}`), "a seated run the amendment owes and the record does not hold is said");
}));

test("an amendment's campaign must freeze that amendment as it stands; a registered phase's must name none; the candidate is one commit", () => withHome((home) => {
  campaign(home, "final-060", "final", FINAL);
  campaign(home, "seated-none", "final-seated", SEATED, { amendment: null });
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["final-060", "seated-none"], home }), /amendment 1's, and the campaign did not freeze that amendment as it stands/);
  campaign(home, "seated-old", "final-seated", SEATED, { amendment: { n: 1, file: "0.6.0-amendment-1.json", digest: "0".repeat(64) } });
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["final-060", "seated-old"], home }), /did not freeze that amendment as it stands/);
  campaign(home, "final-named", "final", FINAL, { amendment: { n: 1, file: "0.6.0-amendment-1.json", digest: AMENDMENTS[0].digest } });
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["final-named"], home }), /is the registration's, and the campaign names amendment 1/);
  campaign(home, "seated-other", "final-seated", SEATED, { commits: { ...COMMITS, "orbit-0.6.0-seated": "2".repeat(40) } });
  assert.throws(() => recordOf({ prereg: FILE, campaigns: ["final-060", "seated-other"], home }), /the release candidate's arms ran at different commits/);
}));

// ---- amendment 2: a memory track, seated, against its cold run -------------------------------------------------------------------

// A memory-seated campaign room: its cold runs and both tracks, steps in order.
function memoryRoom(home, id, words) {
  const ph = Q.phases.find((x) => x.id === "memory-seated");
  const cold = ph.tasks.map((task) => ({ arm: ph.arms[0], task, trial: 1, key: keyOf(ph.arms[0], task) }));
  const steps = ph.tracks.flatMap((t) => t.tasks.map((x, i) => ({ arm: t.arm, task: `pack:${x}`, trial: 1, track: t.id, step: i + 1, key: `${keyOf(t.arm, `pack:${x}`)}__${t.id}-${i + 1}` })));
  const dir = join(home, "campaigns", id);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "campaign.json"), { id, prereg: { release: P.release, phase: "memory-seated", digest: DIGEST, amendment: amendmentOf(ph) }, model: P.host.model, effort: P.host.effort, limits: P.limits, budgetUsd: 7, claudeCode: "2.1.322", arms: armsFor(ph.arms, COMMITS), plan: [...cold, ...steps], evaluator: { commit: "e", dirty: false } });
  for (const r of [...cold, ...steps]) said(join(dir, "journal.jsonl"), r, words(r));
  appendLine(join(dir, "journal.jsonl"), { kind: "finished" });
}

test("an amendment's memory track: each pair's second task with the store kept, beside its own cold seated run, reported with no verdict", () => withHome((home) => {
  campaign(home, "final-060", "final", FINAL);
  memoryRoom(home, "memory-seated-060", (r) => (r.track ? "RESOLVED" : r.task.endsWith("001") ? "UNRESOLVED" : "RESOLVED"));
  const r = recordOf({ prereg: FILE, campaigns: ["final-060", "memory-seated-060"], home });
  assert.deepEqual(r.secondary.memory.map((m) => [m.track, m.task, m.kept?.word, m.cold?.word, m.gate]), [["pair1", "pack:lending-hld-001", "RESOLVED", "UNRESOLVED", false], ["pair2", "pack:lending-hld-002", "RESOLVED", "RESOLVED", false]]);
  assert.ok(!r.secondary.missing.some((m) => /track|cold/.test(m)), "every step and cold run has a word");
  assert.deepEqual([r.comparisons, r.verdict], [recordOf({ prereg: FILE, campaigns: ["final-060"], home }).comparisons, recordOf({ prereg: FILE, campaigns: ["final-060"], home }).verdict], "the primary is untouched");
  const owed = recordOf({ prereg: FILE, campaigns: ["final-060"], home }).secondary.missing;
  assert.ok(owed.includes("orbit-0.6.0-seated on pack:lending-hld-001 (track pair1, step 2)") && owed.includes("orbit-0.6.0-seated on pack:lending-hld-002 (cold, memory-seated)"));
}));
