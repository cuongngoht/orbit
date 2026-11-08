// What one generated test's execution EARNS (doc §11; PBI 16): ordered rows over typed facts -- the
// envelope, staleness, the runner's status and what its stop said about itself, the oracle's
// authority -- never a message's text. Exactly one word counts and one accuses; a draft oracle never
// confirms; an observation that could not see everything never passes; a negative proves nothing
// without its positive; and a contradiction another attempt did not repeat is FLAKY.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTEMPTS, OBLIGATION, RESULT, VERIFICATION_OUTCOMES, VERIFICATION_OUTCOME_IDS, accusesProduct, attemptsOutcome, countsForCoverage, obligationOutcome, resultOf } from "../src/investigation/verification.mjs";

const accepted = (over = {}) => ({ status: "PASS", authority: "accepted", ...over });
const word = (facts) => resultOf(facts).outcome;

test("exactly one word counts toward coverage and exactly one accuses the product", () => {
  assert.deepEqual(VERIFICATION_OUTCOMES.filter((o) => o.counts).map((o) => o.id), ["SATISFIED"]);
  assert.deepEqual(VERIFICATION_OUTCOMES.filter((o) => o.defect).map((o) => o.id), ["CONTRADICTED"]);
  assert.ok(countsForCoverage("SATISFIED") && accusesProduct("CONTRADICTED") && !countsForCoverage("PASS"));
});

test("every row answers a word the outcomes table holds, and the last always answers", () => {
  for (const row of RESULT) assert.ok(VERIFICATION_OUTCOME_IDS.includes(row.word), row.id);
  assert.equal(RESULT.at(-1).when({}), true);
  assert.equal(ATTEMPTS.at(-1).when([]), true);
  assert.equal(OBLIGATION.at(-1).when({}), true);
});

test("each fact earns its own word, in order", () => {
  const cases = [
    [accepted({ envelope: ["no envelope came back — the worker left none"], wrote: true, ran: false }), "EXECUTION_ERROR"],
    [accepted({ envelope: ["status re-derived as FAIL"], wrote: true }), "AMBIGUOUS"],
    [accepted({ envelope: ["status re-derived as FAIL"] }), "EXECUTION_ERROR"],
    [accepted({ stale: true }), "STALE"],
    [accepted({ status: "BLOCKED", failure: { helperClass: "ambiguous", ambiguous: "msg-1" } }), "AMBIGUOUS"],
    [accepted({ status: "BLOCKED", failure: { gap: { capability: "orbit.messaging.publish" } } }), "CAPABILITY_MISSING"],
    [accepted({ status: "REFUSED", failure: { authorization: true } }), "AUTHORIZATION_BLOCKED"],
    [accepted({ status: "REFUSED" }), "INVALID_TEST"],
    [accepted({ status: "BLOCKED", failure: { helperClass: "incomplete" } }), "INCONCLUSIVE"],
    [accepted({ status: "BLOCKED", failure: { helperClass: "protocol" } }), "EXECUTION_ERROR"],
    [accepted({ status: "BLOCKED", failure: { helperClass: "transport" } }), "ENVIRONMENT_BLOCKED"],
    [{ status: "FAIL", authority: "draft", failure: { contradiction: true } }, "REQUIRES_REQUIREMENT"],
    [accepted({ status: "FAIL", failure: { contradiction: true } }), "CONTRADICTED"],
    [accepted({ status: "FAIL" }), "EXECUTION_ERROR"],
    [accepted(), "SATISFIED"],
    [accepted({ status: "INCONCLUSIVE" }), "INCONCLUSIVE"],
    [accepted({ status: "PARTIAL" }), "INCONCLUSIVE"],
  ];
  for (const [facts, want] of cases) assert.equal(word(facts), want, JSON.stringify(facts));
});

// What B7's review found (0.5.0): a run the host could not believe -- no envelope came back, or one that failed the
// host's check -- was EXECUTION_ERROR, so a run that had grants to write was free to run again although nothing said
// what it did. It is AMBIGUOUS, as an interrupted one is and as reconcile calls a lost one; only the worker's own receipt
// saying it never ran, or having had nothing to write with, lets a new attempt run.
test("a run the host could not believe is AMBIGUOUS when it had grants -- unless its worker's receipt says it never ran", () => {
  const unbelieved = (over) => resultOf(accepted({ envelope: ["no envelope came back — the worker was killed"], ...over }));
  for (const ran of [true, null, undefined]) assert.deepEqual([unbelieved({ wrote: true, ran }).outcome, unbelieved({ wrote: true, ran }).rule], ["AMBIGUOUS", "UNBELIEVED_WRITE"], String(ran));
  assert.deepEqual([unbelieved({ wrote: true, ran: false }).outcome, unbelieved({ wrote: true, ran: false }).rule], ["EXECUTION_ERROR", "NEVER_RAN"], "nothing it was granted was spent");
  assert.deepEqual([unbelieved({ wrote: false, ran: true }).outcome, unbelieved({ wrote: false, ran: true }).rule], ["EXECUTION_ERROR", "ENVELOPE"], "it could write nothing");
  assert.equal(word(accepted({ envelope: [], wrote: true, ran: true })), "SATISFIED", "a run the host believed is judged on what it ran, grants or not");
});

test("nothing makes a word stronger than its evidence", () => {
  assert.equal(word({ status: "PASS", authority: "draft" }), "REQUIRES_REQUIREMENT", "a draft oracle never confirms a PASS");
  assert.equal(word(accepted({ status: "PASS", envelope: ["a file the envelope names is missing"] })), "EXECUTION_ERROR", "a worker's claimed PASS is never taken over the host's check");
  assert.equal(word(accepted({ status: "PASS", stale: true })), "STALE", "a PASS on a moved tree raises nothing");
});

test("a fault the run never observed leaves it INCONCLUSIVE whether what followed held or failed -- a PASS is never earned without it", () => {
  assert.deepEqual(resultOf(accepted({ envelope: [], faultMissed: true })), { outcome: "INCONCLUSIVE", rule: "FAULT_NOT_SEEN", why: RESULT.find((r) => r.id === "FAULT_NOT_SEEN").why });
  assert.equal(word(accepted({ status: "FAIL", failure: { contradiction: true }, faultMissed: true })), "INCONCLUSIVE");
  assert.equal(word(accepted({ faultMissed: false })), "SATISFIED", "a fault it saw lets the pass stand");
  assert.equal(word(accepted({ status: "PASS", authority: "draft", faultMissed: true })), "REQUIRES_REQUIREMENT", "a draft oracle still confirms nothing first");
});

test("a negative proves nothing without its positive; a contradiction anywhere stands; only all met satisfies", () => {
  assert.equal(obligationOutcome({ positive: "ENVIRONMENT_BLOCKED", negative: "SATISFIED" }).outcome, "INCONCLUSIVE");
  assert.equal(obligationOutcome({ positive: "CONTRADICTED", negative: "SATISFIED" }).outcome, "INCONCLUSIVE", "a refusal of everybody proves nothing about permission -- the allowed actor's refusal is its own criterion's finding");
  assert.deepEqual(resultOf({ status: "FAIL", failure: { contradiction: true }, envelope: [], authority: "accepted", positiveFailed: true }), { outcome: "INCONCLUSIVE", rule: "POSITIVE_CONTROL", why: RESULT.find((r) => r.id === "POSITIVE_CONTROL").why });
  assert.equal(obligationOutcome({ positive: "SATISFIED", negative: "CONTRADICTED" }).outcome, "CONTRADICTED");
  assert.equal(obligationOutcome({ positive: "SATISFIED", negative: "SATISFIED", state: "SATISFIED" }).outcome, "SATISFIED");
  assert.equal(obligationOutcome({ positive: "SATISFIED", state: "INCONCLUSIVE" }).outcome, "INCONCLUSIVE");
  assert.equal(obligationOutcome({}).outcome, "INCONCLUSIVE", "no control ran: nothing to count");
});

test("across attempts on the same pinned inputs, a contradiction that did not repeat is FLAKY -- never the last pass", () => {
  assert.equal(attemptsOutcome(["CONTRADICTED", "SATISFIED"]), "FLAKY");
  assert.equal(attemptsOutcome(["SATISFIED", "CONTRADICTED"]), "FLAKY");
  assert.equal(attemptsOutcome(["ENVIRONMENT_BLOCKED", "SATISFIED"]), "SATISFIED");
  assert.equal(attemptsOutcome([]), "INCONCLUSIVE");
});
