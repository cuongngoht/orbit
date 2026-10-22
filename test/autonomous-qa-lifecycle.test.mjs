// A generated test's lifecycle in the investigation journal (doc §4.5; ADR 0032): milestone kinds folded
// once by their eventId, every revision and attempt kept, a journal of any other schema refused and kept
// byte for byte, and the lineage of a result read link by link.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { keepArtifact, recordOnce, testsOf, lineageOf } from "../src/investigation/index.mjs";
import { deduped, modelOf } from "../src/investigation/model.mjs";
import { createInvestigations, eventIdOf, JOURNAL } from "../src/investigation/store.mjs";
import { JOURNAL_SCHEMA, KINDS, MILESTONES, MILESTONE_WORDS, milestoneOf, OBLIGATION_STATE_IDS } from "../src/investigation/vocab.mjs";
import { VERIFICATION_OUTCOMES, accusesProduct, countsForCoverage } from "../src/investigation/verification.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "/store/repo-1";
const ID = "inv-20261021-120000-abcd";

function journal() {
  const io = fakeIo();
  const store = createInvestigations(ROOT, io);
  store.create({ id: ID, objective: "verify the reminders", mode: "observe" });
  return { io, store, w: { store, io, id: ID } };
}

const lines = (t) => t.io.read(join(t.store.dirOf(ID), JOURNAL)).trim().split("\n");

test("every lifecycle kind carries an eventId, and the milestones are the document's", () => {
  for (const m of MILESTONES) assert.ok(KINDS[m.kind].includes("eventId"), `${m.kind} is folded once by its eventId`);
  assert.deepEqual(MILESTONE_WORDS.sort(), ["DRAFT_CREATED", "EXECUTION_AUTHORIZED", "GENERATION_FAILED", "OBLIGATION_DISCOVERED", "OBSERVATIONS_CAPTURED", "REPORT_FAILED", "REPORT_PUBLISHED", "RESULT_EVALUATED", "SANDBOX_PREPARED", "SCHEMA_VALIDATED", "TEST_DESIGNED", "TEST_RUNNING"]);
  assert.equal(milestoneOf({ kind: "designed", state: "failed" }), "GENERATION_FAILED");
  assert.equal(milestoneOf({ kind: "validated", state: "invalid" }), null, "an invalid test reached no milestone");
  assert.equal(milestoneOf({ kind: "published", state: "published" }), "REPORT_PUBLISHED");
  assert.equal(milestoneOf({ kind: "binding" }), null);
});

test("the verification outcomes: exactly one counts for coverage, exactly one accuses the product, each moves the obligation to a state the loop knows", () => {
  assert.deepEqual(VERIFICATION_OUTCOMES.filter((o) => o.counts).map((o) => o.id), ["SATISFIED"]);
  assert.deepEqual(VERIFICATION_OUTCOMES.filter((o) => o.defect).map((o) => o.id), ["CONTRADICTED"]);
  for (const o of VERIFICATION_OUTCOMES) assert.ok(o.obligation === null || OBLIGATION_STATE_IDS.includes(o.obligation), `${o.id} → ${o.obligation}`);
  for (const o of VERIFICATION_OUTCOMES) assert.ok(["safe", "read-back", "never"].includes(o.retry), o.id);
  assert.equal(countsForCoverage("PASS"), false, "a runner status is not a verification outcome");
  assert.equal(accusesProduct("FAIL"), false, "a FAIL is not mechanically a defect");
});

test("an event recorded again with the same eventId is the same event: nothing is written, the record already there comes back", () => {
  const t = journal();
  const first = recordOnce(t.w, "obligation", { obligation: "tob-a1b2c3", revision: "1", statement: "x" }, { inputs: { a: 1 } });
  const again = recordOnce(t.w, "obligation", { obligation: "tob-a1b2c3", revision: "1" }, { inputs: { a: 1 } });
  assert.equal(again.duplicate, true);
  assert.equal(again.eventId, first.eventId);
  assert.equal(lines(t).length, 2, "the created line and ONE obligation");
  assert.equal(modelOf(t.store.read(ID)).obligations.length, 1);
});

test("a line replayed with an eventId already folded is folded once, and the journal's position still counts its lines", () => {
  const t = journal();
  const eventId = eventIdOf("started", "ver-1", 1, { x: 1 });
  t.store.append(ID, "started", { id: "str-1", eventId, version: "v@1", execution: "exe-1", attempt: 1 });
  t.store.append(ID, "started", { id: "str-1", eventId, version: "v@1", execution: "exe-1", attempt: 1 });
  const m = modelOf(t.store.read(ID));
  assert.equal(m.starts.length, 1);
  assert.equal(m.position, 3, "a decision names the journal it read, replays included");
  assert.deepEqual(deduped([{ eventId: "a" }, { kind: "x" }, { eventId: "a" }, { kind: "x" }]).length, 3, "a record with no eventId is always its own");
});

test("the eventId is the kind, the subject, the attempt and what it was made from -- nothing else", () => {
  assert.equal(eventIdOf("evaluated", "exe-1", 1, { outcome: "SATISFIED" }), eventIdOf("evaluated", "exe-1", 1, { outcome: "SATISFIED" }));
  assert.notEqual(eventIdOf("evaluated", "exe-1", 1, {}), eventIdOf("evaluated", "exe-1", 2, {}), "another attempt is another event");
  assert.notEqual(eventIdOf("evaluated", "exe-1", 1, { a: 1 }), eventIdOf("evaluated", "exe-1", 1, { a: 2 }));
  assert.match(eventIdOf("x", null, null, null), /^[0-9a-f]{16}$/);
});

test("a journal of any other schema is refused -- an older one too -- and its bytes are kept exactly", () => {
  const io = fakeIo();
  const store = createInvestigations(ROOT, io);
  const file = join(store.dirOf(ID), JOURNAL);
  const bytes = `${JSON.stringify({ at: "2026-01-01T00:00:00Z", kind: "created", id: ID, schema: 2 })}\n${JSON.stringify({ at: "2026-01-01T00:00:01Z", kind: "plan" })}\n`;
  io.files.set(file, bytes);
  assert.throws(() => modelOf(store.read(ID)), (e) => e instanceof Refused && /journal schema 2, and this engine reads only schema 3 — it is kept exactly as it is, never migrated/.test(e.message));
  assert.equal(io.files.get(file), bytes, "refused, never rewritten");
  assert.equal(JOURNAL_SCHEMA, 3);
});

// One obligation, two revisions, one design and version, two attempts: the first INCONCLUSIVE, the second
// SATISFIED -- and the report whose assessment counted the second.
function twoAttempts() {
  const t = journal();
  const add = (kind, record) => t.store.append(ID, kind, { eventId: eventIdOf(kind, record.obligation ?? record.version ?? record.execution ?? record.assessment ?? record.binding, record.attempt, record), ...record });
  add("binding", { id: "bnl-1", binding: "bnd-req001", type: "criterion", ref: "rs-1:AC1", authority: "accepted" });
  add("binding", { id: "bnl-2", binding: "bnd-msg001", type: "message-contract", ref: "source:async-1#/channels/reminders", authority: "accepted" });
  add("obligation", { id: "obr-1", obligation: "tob-rem001", revision: "1", bindings: ["bnd-req001"] });
  add("obligation", { id: "obr-2", obligation: "tob-rem001", revision: "2", bindings: ["bnd-req001", "bnd-msg001"] });
  add("designed", { id: "dsg-1", obligation: "tob-rem001", design: "tds-rem001", state: "designed" });
  add("version", { id: "ver-1", design: "tds-rem001", case: "reminder-once", version: "reminder-once@0123456789abcdef", digest: "d".repeat(64) });
  add("validated", { id: "val-1", version: "reminder-once@0123456789abcdef", state: "valid", attempt: 1 });
  add("started", { id: "str-1", version: "reminder-once@0123456789abcdef", execution: "exe-1", attempt: 1 });
  add("run", { id: "run-1", case: "reminder-once", status: "INCONCLUSIVE", execution: "exe-1", attempt: 1, evidence: "evidence/exe-1" });
  add("evaluated", { id: "evl-1", execution: "exe-1", obligation: "tob-rem001", result: "res-rem001", outcome: "INCONCLUSIVE", attempt: 1 });
  add("started", { id: "str-2", version: "reminder-once@0123456789abcdef", execution: "exe-2", attempt: 2 });
  add("run", { id: "run-2", case: "reminder-once", status: "PASS", execution: "exe-2", attempt: 2, evidence: "evidence/exe-2" });
  add("evaluated", { id: "evl-2", execution: "exe-2", obligation: "tob-rem001", result: "res-rem002", outcome: "SATISFIED", attempt: 2 });
  add("assessed", { id: "asd-1", assessment: "asm-rem001", results: ["res-rem002"] });
  add("published", { id: "pub-1", report: "reports/_investigations/x.html", assessment: "asm-rem001", state: "published" });
  return modelOf(t.store.read(ID));
}

test("testsOf: one obligation with every revision, its design, its frozen version and every attempt", () => {
  const [one, ...rest] = testsOf(twoAttempts());
  assert.equal(rest.length, 0, "two attempts are one test");
  assert.equal(one.obligation, "tob-rem001");
  assert.deepEqual(one.revisions.map((r) => r.revision), ["1", "2"]);
  assert.equal(one.current.revision, "2");
  const [version] = one.designs[0].versions;
  assert.deepEqual(version.executions.map((e) => [e.execution, e.attempt, e.evaluations[0].outcome, e.runs[0].status]), [["exe-1", 1, "INCONCLUSIVE", "INCONCLUSIVE"], ["exe-2", 2, "SATISFIED", "PASS"]]);
  assert.equal(version.validations.length, 1);
});

test("lineageOf: requirement → bindings → obligation → version → run → evidence → result → report", () => {
  const l = lineageOf(twoAttempts(), "res-rem002");
  assert.deepEqual(l.requirement, ["rs-1:AC1", "source:async-1#/channels/reminders"]);
  assert.deepEqual(l.bindings.map((b) => b.binding), ["bnd-req001", "bnd-msg001"]);
  assert.equal(l.obligation.revision, "2");
  assert.equal(l.version.case, "reminder-once");
  assert.equal(l.run.id, "run-2");
  assert.equal(l.evidence, "evidence/exe-2");
  assert.equal(l.result.outcome, "SATISFIED");
  assert.equal(l.report.report, "reports/_investigations/x.html");
  const first = lineageOf(twoAttempts(), "res-rem001");
  assert.equal(first.report, null, "a result no assessment counted has no report -- never guessed");
  assert.deepEqual(lineageOf(twoAttempts(), "res-nothing"), { requirement: [], bindings: [], obligation: null, version: null, run: null, evidence: null, result: null, report: null });
});

test("an artifact kept through the index is written under the journal lock, once", () => {
  const t = journal();
  const a = keepArtifact(t.w, "obligations", { statement: "x", n: 1 });
  const b = keepArtifact(t.w, "obligations", { n: 1, statement: "x" });
  assert.equal(a.digest, b.digest, "the same document, whatever its key order");
  assert.ok(!t.io.dirs.has(join(t.store.dirOf(ID), ".lock")), "the lock is released");
});
