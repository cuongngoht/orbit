// The outcome table: one word per run, from what was observed, in a fixed order of precedence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { outcomeOf, OUTCOME_ORDER, RATED, WORDS } from "../lib/core/outcome.mjs";

const graded = (o) => ({ ran: true, applied: true, resolved: false, regressed: false, f2pFailed: ["test/a.test.mjs"], p2pFailed: [], ...o });

const base = { infra: null, timedOut: false, stoppedOn: null, patchBytes: 10, saidDone: false, grade: graded({}) };

const word = (f) => outcomeOf({ ...base, ...f }).word;

test("every word the brief names is a row, and INFRA_ERROR alone is out of the rates", () => {
  assert.deepEqual([...OUTCOME_ORDER].sort(), [...WORDS].sort());
  assert.deepEqual(WORDS.filter((w) => !RATED.includes(w)), ["INFRA_ERROR"]);
});

test("the observed facts, in order", () => {
  assert.equal(word({ grade: graded({ resolved: true }) }), "RESOLVED");
  assert.equal(word({}), "UNRESOLVED");
  assert.equal(word({ saidDone: true }), "FALSE_DONE");
  assert.equal(word({ grade: graded({ regressed: true, p2pFailed: ["test/b.test.mjs"] }), saidDone: true }), "REGRESSED");
  assert.equal(word({ patchBytes: 0, saidDone: true, grade: null }), "EMPTY_PATCH");
  assert.equal(word({ patchBytes: 0, grade: null }), "EMPTY_PATCH");
  assert.equal(word({ grade: { ran: false, applied: false, why: "docker" } }), "UNGRADABLE");
  assert.equal(word({ grade: { ran: true, applied: false, why: "conflict" } }), "UNGRADABLE");
  assert.equal(word({ grade: null }), "UNGRADABLE");
});

test("the run's own end outranks its grade: a timeout or a budget stop is that, resolved or not", () => {
  assert.equal(word({ timedOut: true, grade: graded({ resolved: true }) }), "TIMEOUT");
  assert.equal(word({ stoppedOn: "budget", grade: graded({ resolved: true }) }), "BUDGET");
  assert.equal(word({ stoppedOn: "turns", grade: graded({ resolved: true }) }), "RESOLVED");
});

test("the environment outranks everything, and says why", () => {
  const o = outcomeOf({ ...base, infra: { code: "EGRESS", says: "the API did not answer" }, timedOut: true, grade: graded({ resolved: true }) });
  assert.deepEqual(o, { word: "INFRA_ERROR", why: "EGRESS: the API did not answer" });
});

test("the agent's word alone never resolves anything", () => {
  assert.equal(word({ saidDone: true, grade: graded({}) }), "FALSE_DONE");
  assert.equal(word({ saidDone: true, patchBytes: 0, grade: null }), "EMPTY_PATCH");
});
