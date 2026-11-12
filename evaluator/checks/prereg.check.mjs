// The pre-registration: the committed file is what its own rule derives (packs always; SWE-bench rows when the pinned
// dataset is cached under ORBIT_EVAL_HOME), its ledger adds up, a campaign is built from it and nothing else, and the
// verdict rule says INCONCLUSIVE for a one-task difference.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { RATED } from "../lib/core/outcome.mjs";
import { evalHome } from "../lib/core/util.mjs";
import { amendmentsOf, campaignOf, digestOf, loadPrereg, overallOf, PREREG_DIR, runsOf, verdictOf, verifyAmendment, verifyPrereg } from "../lib/prereg/index.mjs";
import { measuredTop, orderedInstances, repoSplit, selection } from "../lib/prereg/select.mjs";

const P = loadPrereg(join(PREREG_DIR, "0.6.0.json"));

test("the committed pre-registration is what its rule derives", () => {
  const r = verifyPrereg(P, { home: evalHome() });
  assert.deepEqual(r.problems, []);
});

test("the selection rule: disjoint repositories, one instance per repository in turn, an image over the limit passed over", () => {
  const rows = ["a", "b", "c", "d"].flatMap((repo) => [1, 2, 3].map((i) => ({ repo, instance_id: `${repo}-${i}`, difficulty: i === 3 ? "1-4 hours" : "<15 min fix" })));
  const split = repoSplit(["a", "b", "c", "d"], 5);
  assert.deepEqual([...split.dev, ...split.heldOut].sort(), ["a", "b", "c", "d"]);
  assert.equal(split.dev.filter((r) => split.heldOut.includes(r)).length, 0);
  const rule = { seed: 5, strata: ["<15 min fix"], maxCompressedBytes: 10, packs: { dev: "o-", heldOut: "l-" }, repoImages: { a: { compressedBytes: 1 }, b: { compressedBytes: 1 }, c: { compressedBytes: 1 }, d: { compressedBytes: 99 } } };
  const order = orderedInstances(rows, ["a", "b"], rule);
  assert.equal(order.length, 4);
  assert.deepEqual(order.map((id) => id[0]), ["a", "b", "a", "b"]);
  assert.deepEqual(measuredTop(order, { [order[0]]: 1, [order[1]]: 50, [order[2]]: 1 }, rule), { kept: [order[0], order[2]], passedOver: [order[1]] });
  const sizes = Object.fromEntries(rows.map((r) => [r.instance_id, 1]));
  const sel = selection(rows, ["o-1", "o-2", "l-1"], rule, sizes);
  assert.ok(![...sel.dev.swebench, ...sel.heldOut.swebench].some((id) => id.startsWith("d")), "a repository over the limit is never selected");
  assert.deepEqual(sel.heldOut.packs, ["l-1"]);
  assert.deepEqual(selection(rows, ["o-1", "o-2", "l-1"], rule, sizes), sel);
});

test("the ledger adds up: the Claude phases to $50, the mini phase to its own $15, every phase's budget its line", () => {
  const claude = P.budget.ledger.filter((l) => !l.ledger);
  assert.equal(claude.reduce((s, l) => s + l.usd, 0), P.budget.claudeUsd);
  assert.equal(P.budget.ledger.filter((l) => l.ledger === "mini").reduce((s, l) => s + l.usd, 0), P.budget.miniUsd);
  for (const ph of P.phases) assert.equal(ph.budgetUsd, P.budget.ledger.find((l) => l.phase === ph.id).usd, ph.id);
  const t = P.counts.targets;
  const worst = 1 + 2 * (t.dev.swebench + t.dev.packs) * 2 + 3 * (t.heldOut.swebench + t.heldOut.packs) + 6;
  assert.ok(worst * P.limits.usd <= P.budget.claudeUsd, `the targets' worst case $${worst} must fit`);
});

test("a campaign is built from the pre-registration: its model, effort, limits, arms, budget and tasks, task by task", () => {
  const c = campaignOf(P, "pilot", { id: "p" });
  assert.equal(c.model, P.host.model);
  assert.equal(c.effort, P.host.effort);
  assert.deepEqual(c.limits, P.limits);
  assert.equal(c.budgetUsd, 1);
  assert.deepEqual(c.runs, [{ arm: "plain", task: `pack:${P.order.dev.packs[0].id}`, trial: 1 }]);
  assert.throws(() => campaignOf({ ...P, counts: { ...P.counts, dev: null } }, "baseline"), /not fixed/);
  const fixed = { ...P, counts: { ...P.counts, dev: { swebench: 2, packs: 1 }, heldOut: { swebench: 4, packs: 2 } } };
  const b = campaignOf(fixed, "baseline");
  assert.deepEqual([...new Set(b.runs.map((r) => r.task))], [`swebench:${P.order.dev.swebench[0].id}`, `swebench:${P.order.dev.swebench[1].id}`, `pack:${P.order.dev.packs[0].id}`]);
  for (let i = 0; i < b.runs.length; i += 2) assert.deepEqual([b.runs[i].arm, b.runs[i + 1].arm].sort(), ["orbit-0.5.0", "plain"]);
  assert.equal(b.arms["orbit-0.5.0"].rev, "v0.5.0");
  assert.throws(() => campaignOf(fixed, "final"), /--rev/);
  assert.equal(campaignOf(fixed, "final", { rev: "abc" }).arms["orbit-0.6.0"].rev, "abc");
  assert.deepEqual(runsOf(P, ["t1"], ["x", "y"]), runsOf(P, ["t1"], ["y", "x"]));
});

test("the verdict: a one-task difference is INCONCLUSIVE, two is IMPROVED or REGRESSED, infra is out of the pairs", () => {
  const rule = { ...P.verdictRule, rated: RATED };
  const rows = (aWords, bWords) => [...aWords.map((word, i) => ({ arm: "a", task: `t${i}`, word })), ...bWords.map((word, i) => ({ arm: "b", task: `t${i}`, word }))];
  const R = "RESOLVED";
  const U = "UNRESOLVED";
  assert.equal(verdictOf(rows([R, U, U, U, U, U], [U, U, U, U, U, U]), "a", "b", rule).verdict, "INCONCLUSIVE");
  assert.equal(verdictOf(rows([R, R, U, U, U, U], [U, U, U, U, U, U]), "a", "b", rule).verdict, "IMPROVED");
  assert.equal(verdictOf(rows([U, U, U, U, U, U], [R, R, U, U, U, U]), "a", "b", rule).verdict, "REGRESSED");
  assert.equal(verdictOf(rows([R, U, U, U, U, U], [R, U, U, U, U, U]), "a", "b", rule).verdict, "NO_DIFFERENCE");
  assert.equal(verdictOf(rows([R, "REGRESSED", "REGRESSED", U, U, U], [R, U, U, U, U, U]), "a", "b", rule).verdict, "REGRESSED");
  const infra = verdictOf(rows([R, R, "INFRA_ERROR", "INFRA_ERROR", "INFRA_ERROR", U], [U, U, U, U, U, U]), "a", "b", rule);
  assert.equal(infra.paired, 3);
  assert.equal(infra.verdict, "INCONCLUSIVE");
  assert.equal(overallOf(["IMPROVED", "INCONCLUSIVE"]), "INCONCLUSIVE");
  assert.equal(overallOf(["IMPROVED", "REGRESSED"]), "REGRESSED");
  assert.equal(overallOf(["IMPROVED", "IMPROVED"]), "IMPROVED");
  assert.equal(overallOf(["NO_DIFFERENCE", "NO_DIFFERENCE"]), "NO_DIFFERENCE");
});

// ---- amendment 1: the seated condition --------------------------------------------------------------------------------------------

const AMENDMENTS = amendmentsOf(join(PREREG_DIR, "0.6.0.json"));
const A = AMENDMENTS[0];

test("amendment 1 stands beside the registration: it names the registration's digest, says only what an amendment may, and adds ids of its own", () => {
  assert.deepEqual(AMENDMENTS.map((a) => [a.n, a.file]), [[1, "0.6.0-amendment-1.json"]]);
  assert.deepEqual(verifyAmendment(P, A), []);
  assert.equal(A.value.amends.digest, digestOf(P));
  assert.deepEqual(A.value.phases.map((ph) => [ph.id, ph.set, ph.arms]), [["dev3", "dev", ["orbit-0.6.0-seated"]], ["final-seated", "heldOut", ["orbit-0.5.0-seated", "orbit-0.6.0-seated"]]]);
  assert.ok(A.value.comparisons.every((c) => c.gate === false), "the gate never reads an amendment's comparisons");
  assert.ok(Object.values(A.value.arms).every((a) => a.seat === true && a.kind === "claude+orbit"));
  assert.deepEqual(Object.values(A.value.arms).map((a) => a.rev), [P.arms["orbit-0.5.0"].rev, P.arms["orbit-0.6.0"].rev], "the seated arms are the registered plugin arms, seated");
});

test("amendment 1's ledger: its lines add up to its $15, and with what was spent before it and the registered phases still to run it fits the owner's $50", () => {
  const b = A.value.budget;
  assert.equal(b.ledger.reduce((s, l) => s + l.usd, 0), b.usd);
  const toRun = P.budget.ledger.filter((l) => ["final", "memory"].includes(l.phase)).reduce((s, l) => s + l.usd, 0);
  const spent = Object.values(b.spentBefore).reduce((s, x) => s + x, 0);
  assert.ok(spent + toRun + b.usd <= P.budget.claudeUsd, `${spent} + ${toRun} + ${b.usd} must fit $${P.budget.claudeUsd}`);
  assert.ok(A.value.phases.find((ph) => ph.id === "final-seated").budgetUsd >= 12 * P.limits.usd, "final-seated's 12 runs fit at the cap");
});

test("every registered phase's campaign is the same with the amendment beside it; an amendment's phase is built from the same rule, and freezes the amendment", () => {
  for (const ph of P.phases) assert.deepEqual(campaignOf(P, ph.id, { id: "x", rev: "abc", amendments: AMENDMENTS }), campaignOf(P, ph.id, { id: "x", rev: "abc" }), ph.id);
  assert.throws(() => campaignOf(P, "dev3", { rev: "abc" }), /no phase dev3/, "an amendment's phase exists only beside its amendment");
  const dev3 = campaignOf(P, "dev3", { rev: "abc", amendments: AMENDMENTS });
  assert.deepEqual([dev3.id, dev3.budgetUsd, dev3.arms, dev3.prereg], ["dev3-060", 3, { "orbit-0.6.0-seated": { kind: "claude+orbit", rev: "abc", seat: true } }, { release: "0.6.0", phase: "dev3", digest: digestOf(P), amendment: { n: 1, file: A.file, digest: A.digest } }]);
  assert.deepEqual(dev3.runs.map((r) => r.task), campaignOf(P, "dev1", { rev: "abc" }).runs.map((r) => r.task), "the dev set, in the registered order");
  const seated = campaignOf(P, "final-seated", { rev: "abc", amendments: AMENDMENTS });
  assert.deepEqual([seated.budgetUsd, seated.runs.length, seated.arms["orbit-0.5.0-seated"].rev], [12, 12, "v0.5.0"]);
  assert.deepEqual([...new Set(seated.runs.map((r) => r.task))], [...new Set(campaignOf(P, "final", { rev: "abc" }).runs.map((r) => r.task))], "the held-out set, in the registered order");
  assert.throws(() => campaignOf(P, "final-seated", { amendments: AMENDMENTS }), /--rev/);
});

test("an amendment never changes what was registered: a registered arm or phase re-declared, a field it may not say, a comparison the gate would read, another digest -- each refused by name", () => {
  const bad = (over) => verifyAmendment(P, { ...A, value: { ...A.value, ...over } });
  assert.match(bad({ arms: { ...A.value.arms, "orbit-0.6.0": { kind: "claude+orbit", rev: null, seat: true } } }).join("\n"), /arm orbit-0\.6\.0 is the registration's/);
  assert.match(bad({ phases: [...A.value.phases, { ...P.phases.find((x) => x.id === "final"), arms: ["orbit-0.6.0-seated"] }] }).join("\n"), /phase final is the registration's/);
  assert.match(bad({ limits: { ...P.limits, usd: 2 } }).join("\n"), /limits is not something an amendment may say/);
  assert.match(bad({ verdictRule: P.verdictRule }).join("\n"), /verdictRule is not something an amendment may say/);
  assert.match(bad({ comparisons: [{ a: "orbit-0.6.0-seated", b: "plain", set: "heldOut" }] }).join("\n"), /that the gate does not read/);
  assert.match(bad({ amends: { file: "0.6.0.json", digest: "0".repeat(64) } }).join("\n"), /does not name the registration as it stands/);
  assert.match(bad({ budget: { ...A.value.budget, usd: 16 } }).join("\n"), /do not add up/);
  assert.match(bad({ phases: [{ ...A.value.phases[0], arms: ["plain"] }, A.value.phases[1]] }).join("\n"), /phase dev3 runs only its own arms/);
});
