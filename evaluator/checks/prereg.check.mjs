// The pre-registration: the committed file is what its own rule derives (packs always; SWE-bench rows when the pinned
// dataset is cached under ORBIT_EVAL_HOME), its ledger adds up, a campaign is built from it and nothing else, and the
// verdict rule says INCONCLUSIVE for a one-task difference.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { RATED } from "../lib/core/outcome.mjs";
import { evalHome } from "../lib/core/util.mjs";
import { campaignOf, loadPrereg, overallOf, PREREG_DIR, runsOf, verdictOf, verifyPrereg } from "../lib/prereg/index.mjs";
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
