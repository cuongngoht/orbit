// Turning one candidate into a decision about one slot: an ordered table, pure, first row
// that holds wins. What is under test is what reconciliation REFUSES to do: overwrite a
// contradiction, undo a person's decision, weaken a settled fact with a weaker source, or
// take anything but a requirement source as one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RULES, OUTCOMES, reconcile } from "../src/requirements/reconcile.mjs";
import { makeFact } from "../src/requirements/model.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const AT = "2026-09-30T10:00:00.000Z";
const SEEN = { host: "laptop-a", at: AT };
const A = (rev) => `source:src-aaaaaaaaaaaa@${rev}`;
const B = (rev) => `source:src-bbbbbbbbbbbb@${rev}`;

// The revisions of each source in the order they were first cited.
const ORDER = { "src-aaaaaaaaaaaa": ["1", "2", "3"], "src-bbbbbbbbbbbb": ["1"] };
const ctx = (over = {}) => ({ root: ROOT, at: AT, seenBy: SEEN, order: (sid) => ORDER[sid] ?? [], bearing: (sid) => sid !== "src-cccccccccccc", ...over });

const fact = (over = {}) => makeFact({ root: ROOT, subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", status: "stated", sources: [A(1)], revision: 1, at: AT, seenBy: SEEN, ...over });
const cand = (over = {}) => ({ subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", status: "stated", sources: [A(1)], ...over });

test("the table is ordered, ends in a row that always matches, and every outcome has exactly one row", () => {
  assert.deepEqual(RULES.map((r) => r.outcome), OUTCOMES);
  assert.equal(RULES.at(-1).when(), true);
});

test("nothing there and something stated: a NEW fact, revision 1, resting on what it cites", () => {
  const d = reconcile(cand(), null, ctx());
  assert.deepEqual([d.outcome, d.changed, d.fact.revision, d.fact.status, d.fact.sources, d.kept, d.question], ["new", true, 1, "stated", [A(1)], undefined, undefined]);
  assert.equal(d.fact.at, AT);
  assert.deepEqual(d.fact.seenBy, SEEN);
});

test("the same saying again is CONFIRMED, and nothing is written: punctuation and case are not a different requirement", () => {
  for (const says of ["A refund above 500 needs a manager", "a refund above 500 needs a manager.", "  A refund  above 500 needs a MANAGER!! "]) {
    const d = reconcile(cand({ says }), fact(), ctx());
    assert.deepEqual([d.outcome, d.changed, d.fact.revision], ["confirm", false, 1], says);
  }
});

test("a corroboration from another source is confirmed, never merged: a weaker source must not weaken what a stronger settled", () => {
  const d = reconcile(cand({ sources: [B(1)] }), fact(), ctx());
  assert.deepEqual([d.outcome, d.changed, d.fact.sources], ["confirm", false, [A(1)]]);
});

test("the same saying resting now on a LATER revision moves the citation and not the version", () => {
  const d = reconcile(cand({ sources: [`${A(3)}#ac-2`] }), fact({ sources: [`${A(1)}#ac-2`, B(1)] }), ctx());
  assert.deepEqual([d.outcome, d.changed, d.fact.revision, d.kept], ["restated", true, 1, undefined]);
  assert.deepEqual(d.fact.sources, [`${A(3)}#ac-2`, B(1)], "only the source that moved moved, and its locator stayed");
});

test("a different saying on a LATER revision of a source it cites is a CHANGE: a new version, the old kept and marked", () => {
  const d = reconcile(cand({ says: "A refund above 300 needs a manager", sources: [A(2)] }), fact(), ctx());
  assert.deepEqual([d.outcome, d.fact.revision, d.fact.supersedes, d.fact.says], ["changed", 2, `${fact().id}@1`, "A refund above 300 needs a manager"]);
  assert.deepEqual([d.kept.status, d.kept.supersededBy, d.kept.revision], ["superseded", `${fact().id}@2`, 1]);
});

test("a different saying from ANOTHER source, or from the same source at no later revision, is a RIVAL: both kept, and a person is asked, blocking", () => {
  for (const sources of [[B(1)], [A(1)]]) {
    const d = reconcile(cand({ says: "A refund above 300 needs a manager", sources }), fact(), ctx());
    assert.deepEqual([d.outcome, d.fact.status, d.fact.revision, d.fact.rivals], ["rival", "conflict", 2, [`${fact().id}@1`]], JSON.stringify(sources));
    assert.equal(d.kept.status, "stated", "the earlier version stays as it was said, beside the conflict");
    assert.deepEqual([d.question.blocking, d.question.slots], [true, [{ subject: "refund", aspect: "limit" }]]);
    assert.deepEqual(d.question.dependsOn.sort(), [...new Set([A(1), ...sources])].sort());
    assert.match(d.question.asks, /which is right/);
    assert.equal(d.finding.kind, "requirement-conflict");
  }
});

test("a stale citation of an older revision does not win against a later one", () => {
  const d = reconcile(cand({ says: "Something else", sources: [A(1)] }), fact({ sources: [A(3)], revision: 2 }), ctx());
  assert.equal(d.outcome, "rival");
});

test("rivals accumulate, bounded, and a contradiction NEVER overwrites the version it disagrees with", () => {
  let current = fact();
  for (let n = 0; n < 6; n++) current = reconcile(cand({ says: `Version ${n} of the rule`, sources: [B(1)] }), current, ctx()).fact;
  assert.equal(current.status, "conflict");
  assert.ok(current.rivals.length <= 4, `${current.rivals.length}`);
  assert.equal(current.rivals[0], `${fact().id}@6`, "newest first: each rival is the version that stood before");
});

test("a conflict is settled by a LATER revision of a source that removes one side: the fact stands again, with no rivals", () => {
  const conflict = fact({ status: "conflict", says: "Version B", sources: [B(1)], revision: 2, rivals: [`${fact().id}@1`] });
  const d = reconcile(cand({ says: "Version A wins", sources: [B(1)] }), conflict, ctx({ order: (sid) => (sid === "src-bbbbbbbbbbbb" ? ["1", "2"] : ["1"]) }));
  assert.equal(d.outcome, "rival", "the same source at no later revision is one more rival");
  const settled = reconcile(cand({ says: "Version A wins", sources: [B(2)] }), conflict, ctx({ order: (sid) => (sid === "src-bbbbbbbbbbbb" ? ["1", "2"] : ["1"]) }));
  assert.deepEqual([settled.outcome, settled.fact.status, settled.fact.revision, settled.fact.rivals], ["changed", "stated", 3, undefined]);
});

test("a person's DECISION holds: what a source says now does not change it, and the journal says it was contested", () => {
  const decided = fact({ status: "decided", decision: "rd-dddddddddddd", sources: ["decision:rd-dddddddddddd"], says: "Reject; no account is created" });
  const d = reconcile(cand({ says: "Create the account anyway", sources: [A(3)] }), decided, ctx());
  assert.deepEqual([d.outcome, d.changed, d.contested, d.fact.status, d.fact.says], ["held", false, true, "decided", "Reject; no account is created"]);
  assert.equal(d.finding.kind, "requirement-decision-holds");
});

test("a source that AGREES with a decision changes nothing, however late its revision: there is no citation of the decision's to move", () => {
  const decided = fact({ status: "decided", decision: "rd-dddddddddddd", sources: ["decision:rd-dddddddddddd"], says: "Reject; no account is created" });
  const d = reconcile(cand({ says: "Reject; no account is created.", sources: [A(3)] }), decided, ctx());
  assert.deepEqual([d.outcome, d.changed, d.contested, d.fact], ["confirm", false, undefined, decided]);
});

test("an UNKNOWN candidate never disturbs a slot that already stands, decided or not: asking about a slot says nothing about its answer", () => {
  for (const standing of [fact(), fact({ status: "decided", decision: "rd-dddddddddddd", sources: ["decision:rd-dddddddddddd"] }), fact({ status: "conflict", rivals: [`${fact().id}@1`], revision: 2 })]) {
    const d = reconcile({ subject: "refund", aspect: "limit", says: "", status: "unknown", sources: [] }, standing, ctx());
    assert.deepEqual([d.outcome, d.changed, d.fact], ["confirm", false, standing], standing.status);
  }
  const first = reconcile({ subject: "refund", aspect: "limit", says: "", status: "unknown", sources: [] }, null, ctx());
  assert.deepEqual([first.outcome, first.fact.status, first.fact.says], ["new", "unknown", ""]);
});

test("a person's decision settles the slot whatever stood, and keeps what stood beside it", () => {
  const c = { subject: "refund", aspect: "limit", says: "Reject; no account is created", status: "decided", decision: "rd-eeeeeeeeeeee", sources: [], seenBy: SEEN };
  const over = reconcile(c, fact(), ctx());
  assert.deepEqual([over.outcome, over.fact.status, over.fact.revision, over.fact.sources, over.kept.status], ["decided", "decided", 2, ["decision:rd-eeeeeeeeeeee"], "superseded"]);
  assert.equal(reconcile(c, null, ctx()).fact.revision, 1);
  const again = reconcile(c, over.fact, ctx());
  assert.deepEqual([again.outcome, again.changed], ["confirm", false], "the same decision applied twice is nothing");
});

test("an UNKNOWN slot that something now states becomes a new version, and the unknown is kept", () => {
  const unknown = fact({ status: "unknown", says: "", sources: [] });
  const d = reconcile(cand({ sources: [B(1)] }), unknown, ctx());
  assert.deepEqual([d.outcome, d.fact.revision, d.fact.status, d.kept.status], ["changed", 2, "stated", "superseded"]);
});

test("a candidate that cites something that is not a requirement source is REFUSED, and nothing is written", () => {
  const d = reconcile(cand({ sources: ["source:src-cccccccccccc@1"] }), null, ctx());
  assert.deepEqual([d.outcome, d.fact, d.changed, d.finding.kind], ["refused", null, false, "requirement-refused"]);
  const over = reconcile(cand({ sources: ["source:src-cccccccccccc@1"] }), fact(), ctx());
  assert.equal(over.outcome, "refused", "and a standing fact is never touched by one");
});

test("a derived candidate becomes a derived fact that names what it follows from", () => {
  const d = reconcile({ subject: "refund", aspect: "approval", says: "A manager approves refunds above 500", status: "derived", sources: [], derivedFrom: ["rf-cccccccccccc"] }, null, ctx());
  assert.deepEqual([d.outcome, d.fact.status, d.fact.derivedFrom, d.fact.sources], ["new", "derived", ["rf-cccccccccccc"], []]);
});

test("reconciliation reads no clock and no store: the same inputs are the same decision", () => {
  const args = [cand({ says: "Another", sources: [A(2)] }), fact(), ctx()];
  assert.deepEqual(reconcile(...args), reconcile(...args));
});
