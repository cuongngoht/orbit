// The QA benchmark's judge: what an investigation came to, read off the engine's own journal, held to a case's ground
// truth -- and a contradiction credited as a defect FOUND only when the same design is satisfied by the clean
// application. Each row of the credit and verdict tables on its own, and the journal read the way the engine wrote it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { creditOf, designOf, judgedQa, outcomesOf, shapesOf, toConfirm } from "../benchmark/lib/qa/judge.mjs";

const SHAPES = ["response-conforms", "permission-enforced", "persisted-after-write"];

const truth = (expect = {}) => ({ schema: 1, default: "SATISFIED", shapes: SHAPES, expect });

const got = (o) => Object.fromEntries(Object.entries(o).map(([shape, outcome]) => [shape, { outcome }]));

test("a contradiction is a defect found only when the clean application satisfies the same design", () => {
  assert.equal(creditOf({ expected: "CONTRADICTED", got: "CONTRADICTED", clean: "SATISFIED" }), "DETECTED");
  assert.equal(creditOf({ expected: "CONTRADICTED", got: "CONTRADICTED", clean: "CONTRADICTED" }), "FALSE_ALARM", "a test that fails whatever it runs on");
  assert.equal(creditOf({ expected: "SATISFIED", got: "CONTRADICTED", clean: null, cleanIsPlanted: true }), "FALSE_ALARM", "on the clean application itself, every contradiction is one");
  assert.equal(creditOf({ expected: "CONTRADICTED", got: "CONTRADICTED", clean: "EXECUTION_ERROR" }), "UNCONFIRMED");
  assert.equal(creditOf({ expected: "CONTRADICTED", got: "SATISFIED", clean: null }), "MISSED");
  assert.equal(creditOf({ expected: "CONTRADICTED", got: "NOT_TESTED", clean: null }), "MISSED");
  assert.equal(creditOf({ expected: "SATISFIED", got: "NOT_TESTED", clean: null }), "NOT_TESTED");
  assert.equal(creditOf({ expected: "INCONCLUSIVE", got: "INCONCLUSIVE", clean: null }), "TESTED");
});

test("the verdict: every planted defect found and nothing else contradicted is a PASS, and nothing less", () => {
  const t = truth({ "persisted-after-write": "CONTRADICTED" });
  const all = got({ "response-conforms": "SATISFIED", "permission-enforced": "SATISFIED", "persisted-after-write": "CONTRADICTED" });
  const pass = judgedQa(t, all, got({ "persisted-after-write": "SATISFIED" }));
  assert.deepEqual([pass.verdict, pass.found, pass.planted, pass.falseAlarms, pass.coverage], ["PASS", 1, 1, 0, 1]);
  assert.equal(judgedQa(t, all, got({ "persisted-after-write": "CONTRADICTED" })).verdict, "FAIL", "the design contradicts the clean application too");
  assert.deepEqual([judgedQa(t, {}, {}).verdict, judgedQa(t, {}, {}).coverage], ["FAIL", 0], "nothing tested: the planted defect was missed, and nothing was covered");
  assert.equal(judgedQa(t, all, got({ "persisted-after-write": "EXECUTION_ERROR" })).verdict, "INCONCLUSIVE");
  const spray = got({ "response-conforms": "CONTRADICTED", "permission-enforced": "CONTRADICTED", "persisted-after-write": "CONTRADICTED" });
  assert.equal(judgedQa(t, spray, got({ "response-conforms": "CONTRADICTED", "permission-enforced": "CONTRADICTED", "persisted-after-write": "SATISFIED" })).verdict, "FAIL", "a host that contradicts everything is refused");
});

test("a test the environment kept from running is no coverage and no miss: a planted defect's blocked test blocks the run", () => {
  const t = truth({ "persisted-after-write": "CONTRADICTED" });
  const j = judgedQa(t, got({ "response-conforms": "ENVIRONMENT_BLOCKED", "permission-enforced": "SATISFIED", "persisted-after-write": "ENVIRONMENT_BLOCKED" }), {});
  assert.deepEqual([j.verdict, j.blocked, j.missed, Math.round(j.coverage * 3)], ["BLOCKED", 2, 0, 1]);
  assert.equal(creditOf({ expected: "SATISFIED", got: "ENVIRONMENT_BLOCKED", clean: null }), "BLOCKED");
});

test("a contradiction the ground truth does not list, satisfied by the clean application, is a defect found beyond it", () => {
  const t = truth({ "persisted-after-write": "CONTRADICTED" });
  const j = judgedQa(t, got({ "permission-enforced": "CONTRADICTED", "persisted-after-write": "CONTRADICTED" }), got({ "permission-enforced": "SATISFIED", "persisted-after-write": "SATISFIED" }));
  assert.deepEqual([j.verdict, j.beyondTruth], ["PASS", ["permission-enforced"]]);
});

test("on the clean application, nothing tested is no pass: it must have tested what its case asks", () => {
  const t = truth();
  assert.equal(judgedQa(t, {}, {}, { minCoverage: 0.5, cleanIsPlanted: true }).verdict, "FAIL");
  assert.equal(judgedQa(t, got({ "response-conforms": "SATISFIED", "permission-enforced": "SATISFIED" }), {}, { minCoverage: 0.5, cleanIsPlanted: true }).verdict, "PASS");
  assert.equal(judgedQa(t, got({ "response-conforms": "CONTRADICTED", "permission-enforced": "SATISFIED" }), {}, { minCoverage: 0.5, cleanIsPlanted: true }).verdict, "FAIL");
  assert.deepEqual(toConfirm(got({ "response-conforms": "CONTRADICTED" }), true), [], "the clean application is never asked to confirm itself");
});

// A journal as the engine writes one: obligations by shape, a generate decision, the design and version it froze,
// and the evaluation that ran it -- twice for one shape, the later one the one that counts.
const JOURNAL = [
  { kind: "obligation", obligation: "tob-a", shape: "persisted-after-write" },
  { kind: "obligation", obligation: "tob-b", shape: "response-conforms" },
  { kind: "decision", id: "d-1", action: { kind: "generate", obligation: "tob-a", design: { skeleton: { steps: [1] } } } },
  { kind: "designed", obligation: "tob-a", design: "tds-1", state: "designed" },
  { kind: "version", design: "tds-1", version: "gen-a@1111111111111111" },
  { kind: "decision", id: "d-2", action: { kind: "run-version", version: "gen-a@1111111111111111" } },
  { kind: "evaluated", obligation: "tob-a", outcome: "SATISFIED", execution: "exe-1111111111111111-1" },
  { kind: "decision", id: "d-3", action: { kind: "generate", obligation: "tob-a", design: { skeleton: { steps: [1, 2] } } } },
  { kind: "designed", obligation: "tob-a", design: "tds-2", state: "designed" },
  { kind: "version", design: "tds-2", version: "gen-a@2222222222222222" },
  { kind: "evaluated", obligation: "tob-a", outcome: "CONTRADICTED", execution: "exe-2222222222222222-1" },
];

test("each shape's latest evaluation, the version that made it, and the design the host sent for that version", () => {
  assert.deepEqual(shapesOf(JOURNAL), { "tob-a": "persisted-after-write", "tob-b": "response-conforms" });
  const o = outcomesOf(JOURNAL);
  assert.deepEqual(o, { "persisted-after-write": { obligation: "tob-a", outcome: "CONTRADICTED", cause: null, version: "gen-a@2222222222222222" } });
  assert.deepEqual(designOf(JOURNAL, "tob-a", "gen-a@2222222222222222"), { skeleton: { steps: [1, 2] } }, "the later design, never the one an earlier version ran");
  assert.deepEqual(toConfirm(o, false).map((x) => [x.shape, x.version]), [["persisted-after-write", "gen-a@2222222222222222"]]);
});
