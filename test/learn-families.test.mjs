import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FAMILY_NAMES, findingsOf } from "../src/learn/families/index.mjs";
import { evidenceOf } from "../src/learn/evidence.mjs";
import { promote } from "../src/learn/promote.mjs";
import { ranked, recommendationsFor } from "../src/learn/recommend.mjs";
import { fakeLessons } from "./fakes/lessons.mjs";

// Deliberately NOT in test/fixtures/ui-tests/memory/runs/: run-case APPENDS to
// that ledger, so a fixture living there would grow every time somebody forgot
// --dry, and test/memory.test.mjs asserts it holds exactly three runs.
const HERE = dirname(fileURLToPath(import.meta.url));

const RUNS = readFileSync(join(HERE, "fixtures", "learn", "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const NOTES = [
  { about: "home/Add", title: "The dialog animates in", type: "trap", fe_commit: "abc1234", at: "2026-09-01T09:00:00.000Z", host: "laptop-a", body: "Waiting for the dialog node passes before it is usable." },
  { about: "home/Add", title: "Same on Edge", type: "finding", fe_commit: "abc1234", at: "2026-09-02T09:00:00.000Z", host: "laptop-b", body: "Same thing on the other machine." },
];

const evidence = (over = {}) =>
  evidenceOf({ memory: { runs: () => RUNS, notes: () => NOTES, host: "laptop-b" }, frontend: { commit: () => "def5678" } }, over);

const of = (family) => findingsOf(evidence(), { family });

const one = (family, match) => of(family).find((f) => match.test(f.statement));

test("failures group on the step the ledger records, and say the message is not one of them", () => {
  const f = one("failures", /create-thing stops/);
  assert.equal(f.for, 3, "three sessions, not six runs");
  assert.equal(f.hosts, 2);
  assert.match(f.key, /step 2 click home\/Add/);
  assert.ok(f.missing.some((m) => /records where a run stopped, never why/.test(m)));
});

// A laptop off the VPN is not a defect, and a store that learned otherwise would
// teach the next session to distrust a working product.
test("BLOCKED is grouped apart from FAIL and never reads as a product defect", () => {
  const f = one("failures", /open-thing/);
  assert.match(f.statement, /BLOCKED/);
  assert.ok(!/stops at step/.test(f.statement));
  assert.ok(f.missing.some((m) => /not a product defect/.test(m)));
});

test("a later passing session contradicts, an earlier one does not", () => {
  assert.equal(one("failures", /create-thing stops/).against, 0, "the passes came BEFORE the failures");
  assert.equal(one("failures", /flaky-thing/).against, 1, "this one passed an hour later");
});

test("drift is computed on time and commit, never on commit ancestry", () => {
  const f = one("drift", /last passed at frontend abc1234/);
  assert.match(f.statement, /since def5678 appeared/);
  assert.ok(f.missing.some((m) => /carries no order/.test(m)));
  assert.ok(f.missing.some((m) => /query verify/.test(m)));
});

// The same turn said about the control rather than the case, because that is what
// somebody writing the next selector needs.
test("drift also names the control that stopped working, under the selectors topic", () => {
  const f = one("drift", /home\/Add stopped working/);
  assert.equal(f.topic, "orbit-ui-selectors");
  assert.equal(f.about, "home/Add");
});

test("timing claims whole-run milliseconds only, and says that is all it has", () => {
  const f = one("timing", /slow-thing takes about/);
  assert.match(f.statement, /whole-run time/);
  assert.ok(!/p9|percentile|average|mean/i.test(f.statement), "no statistic the sample cannot carry");
  assert.ok(f.missing.some((m) => /a failing step records no duration at all/.test(m)));
});

test("a timing difference on too few sessions cannot reach a lesson", () => {
  const thin = RUNS.filter((r) => r.case !== "slow-thing" || r.at < "2026-09-06" || r.at > "2026-09-16");
  const found = findingsOf(evidenceOf({ memory: { runs: () => thin, notes: () => [], host: "l" }, frontend: { commit: () => "def5678" } }), { family: "timing" });
  const f = found.find((x) => /slow-thing/.test(x.statement));
  assert.equal(f.for, 1, "pinned to one session, so the ladder can only call it a candidate");
  assert.ok(f.notWhen.some((n) => /sample this small/.test(n)));
});

// There is no retry in this engine, so a family that reported attempt counts
// would be inventing them.
test("recovery reports what happened next, and refuses to pretend the engine retries", () => {
  const f = one("recovery", /flaky-thing/);
  assert.match(f.statement, /failed and then passed on the same frontend/);
  assert.match(f.statement, /does not prove much/);
  assert.ok(f.missing.some((m) => /this engine does not retry/.test(m)));
});

test("a note and the runs that agree with it corroborate, and stay an inference", () => {
  const f = one("notes", /matches what the runs do/);
  assert.equal(f.kind, "saw", "reading several notes together is the tool's inference, not a person's instruction");
  assert.equal(f.notes, 2);
  assert.ok(f.missing.some((m) => /as it was spelled, not on meaning/.test(m)));
});

test("a note the frontend has moved past is reported as unchecked, not as wrong", () => {
  const f = one("notes", /was true at frontend abc1234/);
  assert.match(f.statement, /nothing has rechecked it/);
  assert.ok(f.missing.some((m) => /not the same as being wrong/.test(m)));
});

test("every family says what it could not compute rather than inferring it", () => {
  for (const name of FAMILY_NAMES) {
    for (const f of of(name)) assert.ok(f.missing?.length, `${name} produced a finding with nothing in its "not known" list`);
  }
});

// One odd ledger line must not take the other four families down with it.
test("a family that throws is reported and the rest still run", () => {
  const found = findingsOf({ runs: null, notes: [], sessions: new Map(), head: "x" });
  assert.ok(found.some((f) => f.failed), "the broken family reports itself");
  assert.ok(found.length >= 1);
});

// The end-to-end the whole feature exists for: several sessions hit one problem,
// a lesson forms, a recommendation follows, and re-running changes nothing.
test("several sessions hitting one problem become one lesson with one recommendation, twice over", () => {
  const store = fakeLessons();
  const opts = { head: "def5678", now: () => "2026-09-20T00:00:00.000Z" };
  const first = promote(store, findingsOf(evidence()), opts);
  const lesson = store.all().find((l) => /create-thing stops/.test(l.statement));
  assert.equal(lesson.state, "validated");
  assert.equal(lesson.sessions, 3);

  const recs = recommendationsFor(lesson);
  assert.equal(recs.length, 1);
  assert.match(recs[0].verify, /run-case\.mjs/);
  assert.ok(recs[0].rollback);

  const before = store.all().length;
  const again = promote(store, findingsOf(evidence()), opts);
  assert.equal(store.all().length, before, "a second analysis over the same evidence must add nothing");
  assert.equal(again.fresh, 0);
  assert.equal(first.lessons, again.lessons);
});

test("the ranking is the printed keys, in order, with no invented score", () => {
  const store = fakeLessons();
  promote(store, findingsOf(evidence()), { head: "def5678", now: () => "2026-09-20T00:00:00.000Z" });
  const list = ranked(store.all());
  assert.ok(list.length > 1);
  const states = list.map((r) => r.confidence);
  assert.deepEqual([...states].sort(byRank), states, "validated must come before candidate");
  for (const r of list) assert.ok(!/\d\.\d/.test(String(r.basis).replace(/\d{4}-\d\d-\d\d/g, "")), "no fake-precise score");
});

const byRank = (a, b) => ({ validated: 0, stale: 1, candidate: 2 })[a] - ({ validated: 0, stale: 1, candidate: 2 })[b];
