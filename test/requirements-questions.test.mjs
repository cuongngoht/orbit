// What is asked of a person, and where it stands: one question per set of slots, moved by
// a table that says WHO moves it, answered by a person only, and reopened only when the
// ground it rested on moves and contradicts it. An answer survives a restart, and a crash
// inside an answer is finished from the journal, so a question is never left answered
// over a slot that still says nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { answer, ask, ingest, recover } from "../src/requirements/ingest.mjs";
import { factId } from "../src/requirements/model.mjs";
import { REOPEN, TRANSITIONS, markAsked, moved, reopens, wasAsked, withdraw } from "../src/requirements/questions.mjs";
import { compared, refolded } from "../src/requirements/replay.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { clarityOf } from "../src/requirements/vocab.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const T1 = "2026-09-30T10:00:00.000Z";
const SEEN = { host: "laptop-a", at: T1 };
const A = (rev) => `source:src-aaaaaaaaaaaa@${rev}`;
const B = (rev) => `source:src-bbbbbbbbbbbb@${rev}`;
const SLOT = { subject: "signup", aspect: "duplicate-email" };
const id = factId(ROOT, SLOT.subject, SLOT.aspect);

function world(existing) {
  const clock = { at: T1 };
  const io = existing ?? fakeIo({ now: () => clock.at });
  const requirements = createRequirements("/store/acme", io);
  const port = requirements.open(ROOT);
  const sources = { "src-aaaaaaaaaaaa": { revision: "1", kind: "workitem", authorityBearing: true }, "src-bbbbbbbbbbbb": { revision: "1", kind: "comment", authorityBearing: true } };
  const resolves = (ref) => {
    const m = /^source:(src-[0-9a-f]{12})@(.+)$/.exec(ref);
    const s = m && sources[m[1]];
    return s ? { sid: m[1], cited: m[2], revision: s.revision, digest: `d${s.revision}`, kind: s.kind, authorityBearing: s.authorityBearing } : null;
  };
  const ctx = { requirements, now: () => clock.at, world: { resolves }, seenBy: SEEN };
  return { io, port, sources, clock, ctx, requirements, put: (c, o) => ingest(ctx, ROOT, c, o), ask: (specs) => ask(ctx, ROOT, specs), answer: (a) => answer(ctx, ROOT, a) };
}

const cand = (over = {}) => ({ subject: SLOT.subject, aspect: SLOT.aspect, says: "Reject with a validation message", status: "stated", sources: [A(1)], ...over });
const spec = (over = {}) => ({ slots: [SLOT], asks: "What happens when the email already exists?", blocking: true, dependsOn: [A(1)], ...over });
const person = (question, says = "Reject; no account is created", over = {}) => ({ question, says, human: true, ...over });

test("asking stands an UNKNOWN where nothing stood, opens one blocking question, and clarity says so", () => {
  const w = world();
  const [q] = w.ask([spec()]);
  assert.deepEqual([q.state, q.blocking, q.slots, q.dependsOn], ["open", true, [SLOT], [A(1)]]);
  assert.deepEqual([w.port.fact(id).status, w.port.fact(id).says], ["unknown", ""]);
  assert.equal(clarityOf(w.port.facts(), w.port.questions()), "blocked");
  assert.deepEqual(w.port.journalLines().map((l) => l.kind), ["recorded", "asked"]);
});

test("a slot that already says something is left as it is when it is asked about", () => {
  const w = world();
  w.put([cand()]);
  const before = w.port.fact(id);
  w.ask([spec({ blocking: false })]);
  assert.deepEqual(w.port.fact(id), before);
  assert.equal(w.port.questions()[0].blocking, false);
});

test("asking again about the same slots extends the question that is there: never a second, and blocking never lets go", () => {
  const w = world();
  w.ask([spec({ blocking: false })]);
  w.ask([spec({ blocking: true, dependsOn: [B(1)], proposed: "reject with a message" })]);
  w.ask([spec({ blocking: false, dependsOn: [A(1)], proposed: "something else" })]);
  const [q] = w.port.questions();
  assert.equal(w.port.questions().length, 1);
  assert.deepEqual([q.blocking, q.dependsOn.sort(), q.proposed], [true, [A(1), B(1)], "reject with a message"]);
  assert.deepEqual(q.history.map((h) => h.action), ["opened", "extended", "extended"]);
});

test("a question this requirement cannot ask is refused by name, and writes nothing", () => {
  const w = world();
  assert.throws(() => w.ask([{ ...spec(), state: "answered" }]), (e) => e instanceof Refused && /state is the engine's to say/.test(e.message));
  assert.throws(() => w.ask([spec({ dependsOn: ["src/x.ts"] })]), /dependsOn names sources/);
  assert.equal(w.port.journalLines().length, 0);
});

test("only a person answers: without --human it is refused, and the engine cannot make the person's move", () => {
  const w = world();
  const [q] = w.ask([spec()]);
  assert.throws(() => w.answer({ question: q.id, says: "reject", human: false }), /an answer is a person's word — relay it with --human/);
  assert.throws(() => w.answer({ question: q.id, says: "reject" }), /--human/);
  assert.throws(() => moved(q, "answer", "engine"), /answer is a person's to do, never the engine's/);
  assert.throws(() => moved({ ...q, state: "answered" }, "reopen", "person"), /reopen is the engine's to do, never a person's/);
  assert.equal(w.port.question(q.id).state, "open");
  assert.equal(w.port.fact(id).status, "unknown");
});

test("an answer is a decision: recorded, settling the slot as decided on the person's word alone, keeping what stood, and answering the question", () => {
  const w = world();
  w.put([cand({ says: "Silently ignore it" })]);
  const [q] = w.ask([spec()]);
  const got = w.answer(person(q.id));
  const fact = w.port.fact(id);
  assert.deepEqual([fact.status, fact.says, fact.decision, fact.sources, fact.revision, fact.supersedes], ["decided", "Reject; no account is created", got.decision.id, [`decision:${got.decision.id}`], 2, `${id}@1`]);
  assert.deepEqual([w.port.decision(got.decision.id).by, w.port.decision(got.decision.id).human], ["person", true]);
  assert.deepEqual([w.port.question(q.id).state, w.port.question(q.id).answer], ["answered", got.decision.id]);
  assert.deepEqual(w.port.versions(id).map((f) => [f.revision, f.status, f.says]), [[1, "superseded", "Silently ignore it"]]);
  assert.equal(clarityOf(w.port.facts(), w.port.questions()), "complete");
});

test("an answered question survives a restart: a fresh process finds it answered and the decision standing", () => {
  const w = world();
  const [q] = w.ask([spec()]);
  const got = w.answer(person(q.id));
  const again = world(w.io);
  assert.deepEqual([again.port.question(q.id).state, again.port.fact(id).status, again.port.decision(got.decision.id).says], ["answered", "decided", "Reject; no account is created"]);
  assert.throws(() => again.answer(person(q.id, "something else")), /answered; it can be answered only from open or reopened/);
  assert.equal(again.port.fact(id).says, "Reject; no account is created", "the second answer did not land");
});

test("a question about several slots settles them all on the one decision", () => {
  const w = world();
  const other = { subject: "signup", aspect: "password-length" };
  const [q] = w.ask([spec({ slots: [SLOT, other], asks: "What are the signup rules?" })]);
  w.answer(person(q.id, "Reject a duplicate email; passwords are 12 characters or more"));
  assert.deepEqual([SLOT, other].map((s) => w.port.fact(factId(ROOT, s.subject, s.aspect)).status), ["decided", "decided"]);
  assert.equal(w.port.fact(factId(ROOT, other.subject, other.aspect)).decision, w.port.decisions()[0].id);
});

test("a conflict is settled by an answer: the decided version stands and both rivals are kept beside it", () => {
  const w = world();
  w.put([cand({ says: "Reject" })]);
  w.put([cand({ says: "Merge the accounts", sources: [B(1)] })]);
  const [q] = w.port.questions();
  w.answer(person(q.id, "Reject"));
  const fact = w.port.fact(id);
  assert.deepEqual([fact.status, fact.revision, fact.rivals], ["decided", 3, undefined]);
  assert.deepEqual(w.port.versions(id).map((f) => [f.revision, f.status]), [[1, "stated"], [2, "superseded"]]);
  assert.deepEqual(w.port.questions().map((x) => x.state), ["answered"]);
});

// ---- when an answer stops holding ---------------------------------------------------------------

function answered() {
  const w = world();
  w.put([cand()]);
  const [q] = w.ask([spec()]);
  w.answer(person(q.id, "Reject; no account is created"));
  return { w, q };
}

test("a LATER revision of a source the question rested on that says something else reopens it -- and the decision keeps holding", () => {
  const { w, q } = answered();
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  const [r] = w.put([cand({ says: "Merge the two accounts", sources: [A(2)] })]);
  assert.equal(r.outcome, "held");
  const now = w.port.question(q.id);
  assert.deepEqual([now.state, now.answer, now.dependsOn], ["reopened", undefined, [A(2)]]);
  assert.deepEqual([w.port.fact(id).status, w.port.fact(id).says], ["decided", "Reject; no account is created"]);
  assert.deepEqual(w.port.findings().map((f) => f.kind), ["requirement-decision-holds", "question-reopened"]);
  assert.equal(w.port.journalLines().at(-1).kind, "reopened");
  assert.equal(clarityOf(w.port.facts(), w.port.questions()), "blocked", "it is asked again");
});

test("a later revision that says the SAME thing leaves the question answered", () => {
  const { w, q } = answered();
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  const [r] = w.put([cand({ says: "Reject; no account is created.", sources: [A(2)] })]);
  assert.equal(r.outcome, "confirm");
  assert.equal(w.port.question(q.id).state, "answered");
  assert.deepEqual(w.port.findings(), []);
});

test("something contradicting from a source the question did NOT rest on, or from no later revision, asks nobody anything", () => {
  const { w, q } = answered();
  const [other] = w.put([cand({ says: "Merge the two accounts", sources: [B(1)] })]);
  assert.deepEqual([other.outcome, w.port.question(q.id).state], ["held", "answered"]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "Fine", sources: [A(2)] })]);
  w.put([cand({ says: "Merge the two accounts", sources: [A(1)] })]);
  assert.deepEqual(w.port.findings().map((f) => f.kind).filter((k) => k === "question-reopened").length, 1, "only the later revision that contradicted");
});

test("a question a person withdrew is never reopened by the engine", () => {
  const w = world();
  w.put([cand()]);
  const [q] = w.ask([spec()]);
  withdraw(w.ctx, ROOT, { question: q.id, human: true, why: "not needed" });
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "Something else entirely", sources: [A(2)] })]);
  assert.equal(w.port.question(q.id).state, "withdrawn");
});

test("the reopen table is ordered and ends in a row that always holds", () => {
  assert.deepEqual(REOPEN.map((r) => r.id), ["not-answered", "no-later-source", "moved-and-contradicted"]);
  const q = { state: "answered", dependsOn: [A(1)] };
  const order = () => ["1", "2"];
  assert.deepEqual(reopens(q, { sources: [A(2)] }, order), { reopen: true, row: "moved-and-contradicted" });
  assert.deepEqual(reopens(q, { sources: [A(1)] }, order), { reopen: false, row: "no-later-source" });
  assert.deepEqual(reopens({ ...q, state: "open" }, { sources: [A(2)] }, order), { reopen: false, row: "not-answered" });
});

test("answering a reopened question decides again: a new decision, and it rests on the newer revision", () => {
  const { w, q } = answered();
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "Merge the two accounts", sources: [A(2)] })]);
  const first = w.port.decisions()[0];
  w.answer(person(q.id, "Merge the two accounts"));
  assert.deepEqual([w.port.question(q.id).state, w.port.fact(id).says, w.port.decisions().length], ["answered", "Merge the two accounts", 2]);
  assert.notEqual(w.port.fact(id).decision, first.id);
  w.put([cand({ says: "Merge the two accounts", sources: [A(2)] })]);
  assert.equal(w.port.question(q.id).state, "answered", "and the revision it now rests on agrees");
});

// ---- a person's other move, and the table -----------------------------------------------------------

test("a person may withdraw a question; the slots stay as they were and nothing is decided by not asking", () => {
  const w = world();
  const [q] = w.ask([spec()]);
  assert.throws(() => withdraw(w.ctx, ROOT, { question: q.id }), /a person's decision — relay it with --human/);
  const done = withdraw(w.ctx, ROOT, { question: q.id, human: true, why: "the product owner says it does not matter" });
  assert.deepEqual([done.state, w.port.fact(id).status], ["withdrawn", "unknown"]);
  assert.equal(w.port.journalLines().at(-1).kind, "withdrawn");
  assert.throws(() => withdraw(w.ctx, ROOT, { question: q.id, human: true }), /withdrawn; it can be withdrawed only from open or reopened|it can be withdraw/);
  assert.equal(clarityOf(w.port.facts(), w.port.questions()), "partial", "an unknown slot still says so");
});

test("the transition table says who moves each step, and from where", () => {
  assert.deepEqual(TRANSITIONS.map((t) => [t.action, t.by]), [["open", "engine"], ["answer", "person"], ["reopen", "engine"], ["withdraw", "person"]]);
  assert.throws(() => withdraw(world().ctx, ROOT, { question: "rq-aaaaaaaaaaaa", human: true }), /no question rq-aaaaaaaaaaaa/);
});

test("asking a question again after a person answered it changes nothing: only a moved source reopens one", () => {
  const w = world();
  w.put([cand({ says: "Reject" })]);
  const [q] = w.ask([spec()]);
  w.answer(person(q.id, "Reject"));
  const written = w.port.journalLines().length;
  const [again] = w.ask([spec({ asks: "Should it really reject?", blocking: true })]);
  assert.deepEqual([again.state, again.answer, again.asks], ["answered", q.answer ?? again.answer, q.asks]);
  assert.equal(w.port.journalLines().length, written, "a repeated question writes nothing at all");
  assert.equal(clarityOf(w.port.facts(), w.port.questions()), "complete");
  assert.equal(w.port.fact(w.port.facts().find((f) => f.subject === q.slots[0].subject).id).status, "decided");
});

test("a withdrawn question is not put again by asking it again either: a person said it need not be asked", () => {
  const w = world();
  const [q] = w.ask([spec()]);
  withdraw(w.ctx, ROOT, { question: q.id, human: true });
  const written = w.port.journalLines().length;
  const [again] = w.ask([spec({ blocking: true })]);
  assert.deepEqual([again.state, w.port.journalLines().length], ["withdrawn", written]);
});

// ---- once per session --------------------------------------------------------------------------------

test("a question is put to a person once per session and workflow, and a new session asks again", () => {
  const w = world();
  const [q] = w.ask([spec()]);
  const one = { workflow: "orbit-requirements", seenBy: { host: "laptop-a", at: T1, session: "claude:aaaaaaaaaaaaaaaa" } };
  assert.equal(wasAsked(q, one), false);
  const marked = markAsked(q, one);
  assert.equal(wasAsked(marked, one), true);
  assert.equal(wasAsked(marked, { ...one, workflow: "orbit-develop" }), false, "another workflow is another conversation");
  assert.equal(wasAsked(marked, { ...one, seenBy: { ...one.seenBy, session: "claude:bbbbbbbbbbbbbbbb" } }), false, "another real session");
  assert.equal(marked.history.at(-1).action, "surfaced");
  const many = Array.from({ length: 12 }, (_, i) => `wf-${i}`).reduce((acc, workflow) => markAsked(acc, { ...one, workflow }), q);
  assert.ok(Object.keys(many.asked).length <= 8, "bounded");
});

// ---- a crash inside an answer -------------------------------------------------------------------------

function crashing() {
  const w = world();
  const [q] = w.ask([spec()]);
  const real = w.io.write;
  w.io.write = (p, text) => (/rf-[0-9a-f]{12}\.json\.tmp/.test(p) ? (() => { throw new Error("disk full"); })() : real(p, text));
  assert.throws(() => w.answer(person(q.id)), /could not be written/);
  w.io.write = real;
  return { w, q };
}

test("a crash after the answer is journaled and before its facts land is FINISHED from the journal: decided, and answered, exactly once", () => {
  const { w, q } = crashing();
  assert.deepEqual([w.port.question(q.id).state, w.port.fact(id).status], ["open", "unknown"], "the process died half way");
  const healed = w.port.transact(() => recover(w.port));
  assert.deepEqual([healed.decisions.length, healed.answers], [0, [q.id]], "the decision file was already there; the rest is finished");
  assert.deepEqual([w.port.question(q.id).state, w.port.fact(id).status, w.port.fact(id).says], ["answered", "decided", "Reject; no account is created"]);
  assert.equal(w.port.decisions().length, 1);
  const journal = w.port.journalLines().length;
  w.port.transact(() => recover(w.port));
  assert.equal(w.port.journalLines().length, journal, "healing twice is nothing");
});

test("the next batch heals the answer first, so nobody is ever left with an answered question over an unknown slot", () => {
  const { w, q } = crashing();
  w.put([{ subject: "cart", aspect: "size", says: "At most 50 lines", status: "stated", sources: [A(1)] }]);
  assert.deepEqual([w.port.question(q.id).state, w.port.fact(id).status], ["answered", "decided"]);
});

test("an answer that a reopening came after is not finished again: only the last word counts", () => {
  const { w, q } = answered();
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "Merge the two accounts", sources: [A(2)] })]);
  assert.equal(w.port.question(q.id).state, "reopened");
  w.port.transact(() => recover(w.port));
  assert.equal(w.port.question(q.id).state, "reopened");
});

test("the room re-derives from its journal after asking, answering and settling: every fact is the same", () => {
  const { w } = answered();
  w.put([cand({ subject: "cart", aspect: "size", says: "At most 50", sources: [B(1)] })]);
  const verdicts = compared(w.port.facts(), refolded(w.port.journalLines(), ROOT));
  assert.deepEqual(verdicts.map((v) => v.verdict), ["same", "same"], JSON.stringify(verdicts));
});
