// The QA benchmark's judge: what an investigation came to, read off the engine's own journal, held to a case's ground
// truth -- and a contradiction credited as a defect FOUND only when the same design is satisfied by the clean
// application. Each row of the credit and verdict tables on its own, and the journal read the way the engine wrote it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CORRECTABLE, creditOf, designOf, judgedQa, outcomesOf, refusalsOf, shapesOf, toConfirm } from "../benchmark/lib/qa/judge.mjs";
import { admitted } from "../benchmark/lib/qa/relay.mjs";
import { RELAY_REASONS } from "../benchmark/lib/core/tools.mjs";

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

// ---- refused calls (0.5.0, backlog B9) -----------------------------------------------------------------------------------
//
// A case that plants calls the relay refuses holds its host, besides, to how it met them -- read off the relay's log, each
// line as the relay keeps it: no refused call sent again past the case's bound, and every call refused for how it was
// written corrected by a later request of its subcommand that the relay admitted.

const INV = "inv-0123456789ab";

// One line of the relay's log for a request, as the relay would admit or refuse it -- and, for one it admitted, the exit
// and first line the engine answered.
const lineOf = (argv, o = {}) => ((a) => ({ sub: a.help?.sub ?? argv[0] ?? null, ...(a.help ? { help: true } : {}), refused: a.refused ?? null, exit: a.refused ? 2 : (o.exit ?? 0), ...(o.why ? { why: o.why } : {}) }))(admitted({ argv, stdin: "" }, INV));

const STALE_CONTEXT = ["context", "--investigation=inv-5e55d0a1ce4f", "--json"];
const STALE_FINISH = ["finish", "--investigation=inv-5e55d0a1ce4f", "--reason=done"];

const CLEAN = truth();
const ALL_SATISFIED = got({ "response-conforms": "SATISFIED", "permission-enforced": "SATISFIED", "persisted-after-write": "SATISFIED" });

const judgedWith = (lines, repeats = 1) => judgedQa(CLEAN, ALL_SATISFIED, {}, { minCoverage: 0.5, cleanIsPlanted: true, refusals: { repeats, lines } });

test("a host that reads why each planted call was refused and corrects it passes; one that never met a refusal passes too", () => {
  const recovered = [lineOf(STALE_CONTEXT), lineOf(STALE_FINISH), lineOf(["context"]), lineOf(["step"]), lineOf(["finish", "--why=done"])];
  const j = judgedWith(recovered);
  assert.deepEqual([j.verdict, j.refusals.refused, j.refusals.repeated, j.refusals.uncorrected], ["PASS", 2, [], []]);
  assert.deepEqual([judgedWith([lineOf(["context"]), lineOf(["finish"])]).verdict, judgedWith([]).refusals.refused], ["PASS", 0], "nothing refused: nothing to recover from");
  assert.equal(judgedQa(CLEAN, ALL_SATISFIED, {}, { minCoverage: 0.5, cleanIsPlanted: true }).refusals, null, "a case that plants none is held to none");
});

test("a refused call sent again past the case's bound fails, whatever else held -- and the bound is the case's", () => {
  const thrice = [lineOf(STALE_CONTEXT), lineOf(STALE_CONTEXT), lineOf(STALE_CONTEXT), lineOf(["context"]), lineOf(["finish"])];
  const j = judgedWith(thrice, 1);
  assert.deepEqual([j.verdict, j.why], ["FAIL", "a refused call was sent again past the case's bound: its host did not read why it was refused"]);
  assert.deepEqual(j.refusals.repeated.map((x) => [x.call, x.sent]), [["context", 3]]);
  assert.match(j.refusals.repeated[0].why, /names another investigation: this run's is inv-0123456789ab; --json takes no --json here/);
  assert.equal(judgedWith(thrice, 2).verdict, "PASS", "sent again twice is within a bound of two");
  assert.equal(judgedWith(thrice.slice(1), 1).verdict, "PASS", "sent again once is within a bound of one");
  const engineRefused = [lineOf(["reproduce", "--finding=fnd-7"], { exit: 2, why: `fnd-7 is not a finding of ${INV}` }), lineOf(["reproduce", "--finding=fnd-7"], { exit: 2, why: `fnd-7 is not a finding of ${INV}` }), lineOf(["reproduce", "--finding=fnd-7"], { exit: 2, why: `fnd-7 is not a finding of ${INV}` })];
  assert.equal(judgedWith(engineRefused, 1).verdict, "FAIL", "a ref that does not exist, refused by the engine, counts as the same refused call");
  const blocked = Array.from({ length: 4 }, () => lineOf(["reconcile"], { exit: 3, why: "BLOCKED a dispatch is still within its deadline" }));
  assert.equal(judgedWith(blocked, 0).verdict, "PASS", "waiting out what the environment blocked is no refusal to read");
  assert.equal(judgedWith(Array.from({ length: 4 }, () => lineOf(["context", "--help"])), 0).verdict, "PASS", "a help probe is answered, never refused");
});

test("a call refused for how it was written that is never corrected fails; one the relay does not carry is never correctable", () => {
  const unfinished = [lineOf(STALE_CONTEXT), lineOf(STALE_FINISH), lineOf(["context"]), lineOf(["step"])];
  const j = judgedWith(unfinished);
  assert.deepEqual([j.verdict, j.refusals.uncorrected.map((x) => x.call)], ["FAIL", ["finish"]]);
  assert.equal(j.why, "a call the relay refused for how it was written was never corrected: no later request of its subcommand was admitted");
  assert.equal(judgedWith([...unfinished, lineOf(["finish", "--help"])]).verdict, "FAIL", "a help probe of it corrects nothing");
  assert.equal(judgedWith([...unfinished, lineOf(["finish", "--why=done"], { exit: 2, why: `${INV} is already completed` })]).verdict, "PASS", "admitted is corrected, whatever the engine then answered");
  assert.equal(judgedWith([lineOf(["plan", "--objective=x"]), lineOf(["context"])]).verdict, "PASS", "a subcommand the relay does not carry cannot be written right: the bound alone holds it");
});

test("a refusal is correctable by the reason the relay gave, and every correctable reason is a row of the relay's own reasons", () => {
  const reasons = RELAY_REASONS.map((r) => r.reason);
  assert.ok(CORRECTABLE.every((r) => reasons.includes(r)), "never a reason the relay does not give");
  assert.deepEqual(reasons.filter((r) => !CORRECTABLE.includes(r)), ["NOT_A_REQUEST", "NOT_RELAYED", "HELP", "OTHER"]);
  const r = refusalsOf([lineOf(["show", "inv-1"]), lineOf(["show", "--json=yes"]), lineOf(["report", "--out=/x"]), lineOf(["context"], { exit: 0 })], 0);
  assert.deepEqual(r.uncorrected.map((x) => x.call), ["show", "report"], "words, a value and a flag; each one subcommand, said once");
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
