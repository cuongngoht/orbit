// The one door a requirement fact is written through -- and the judge in front of it.
// What is under test is the order things are written in (so a crash can be explained),
// that a batch is all or nothing, that an operation is applied once, that a slot's
// history is never lost, and that the room can be re-derived from its own journal.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { MAX_FACTS, ingest, recover } from "../src/requirements/ingest.mjs";
import { factId, makeFact } from "../src/requirements/model.mjs";
import { MAX_BATCH, judge, parseCandidates } from "../src/requirements/record.mjs";
import { compared, refolded } from "../src/requirements/replay.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const T1 = "2026-09-30T10:00:00.000Z";
const SEEN = { host: "laptop-a", at: T1 };
const A = (rev) => `source:src-aaaaaaaaaaaa@${rev}`;
const B = (rev) => `source:src-bbbbbbbbbbbb@${rev}`;

function world() {
  const io = fakeIo({ now: () => clock.at });
  const clock = { at: T1 };
  const requirements = createRequirements("/store/acme", io);
  const port = requirements.open(ROOT);
  const sources = { "src-aaaaaaaaaaaa": { revision: "1", kind: "workitem", authorityBearing: true }, "src-bbbbbbbbbbbb": { revision: "1", kind: "comment", authorityBearing: true }, "src-cccccccccccc": { revision: "1", kind: "commit", authorityBearing: false } };
  const resolves = (ref) => {
    const m = /^source:(src-[0-9a-f]{12})@(.+)$/.exec(ref);
    const s = m && sources[m[1]];
    return s ? { sid: m[1], cited: m[2], revision: s.revision, digest: `digest-${s.revision}`, kind: s.kind, authorityBearing: s.authorityBearing } : null;
  };
  const judged = { resolves, seen: (sid) => port.state().sources?.[sid]?.seen ?? [], fact: (id) => port.fact(id) };
  const ctx = { requirements, now: () => clock.at, world: { resolves }, seenBy: SEEN };
  return { io, port, sources, clock, ctx, judged, put: (candidates, opts) => ingest(ctx, ROOT, candidates, opts) };
}

const cand = (over = {}) => ({ subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", status: "stated", sources: [A(1)], ...over });
const id = factId(ROOT, "refund", "limit");

test("a new candidate is journaled FIRST, then written, and the state remembers which revisions were cited", () => {
  const w = world();
  const [r] = w.put([cand()]);
  assert.deepEqual([r.outcome, r.factId, r.fact.revision], ["new", id, 1]);
  const [line] = w.port.journalLines();
  assert.deepEqual([line.kind, line.outcome, line.factId, line.result.id, line.candidate.subject], ["recorded", "new", id, id, "refund"]);
  assert.equal(w.port.fact(id).says, "A refund above 500 needs a manager");
  const state = w.port.state();
  assert.deepEqual([state.sources["src-aaaaaaaaaaaa"].seen, state.position], [["1"], 1]);
});

test("the journal is written BEFORE the file it describes: when the file cannot be written, the line is already there, and the next batch heals it", () => {
  const w = world();
  const real = w.io.write;
  w.io.write = (p, text) => (/rf-[0-9a-f]{12}\.json\.tmp/.test(p) ? (() => { throw new Error("disk full"); })() : real(p, text));
  assert.throws(() => w.put([cand()]), /could not be written/);
  assert.deepEqual(w.port.journalLines().map((l) => [l.kind, l.factId, l.outcome]), [["recorded", id, "new"]]);
  assert.equal(w.port.fact(id), null);
  w.io.write = real;
  w.put([cand({ subject: "signup", aspect: "email", says: "An email is required" })]);
  assert.equal(w.port.fact(id).says, "A refund above 500 needs a manager", "what the journal carried came back");
});

test("the journal line is written before the fact file: a crash between the two leaves a journal that is ahead, and the next batch heals it first", () => {
  const w = world();
  w.put([cand()]);
  w.io.removeFile([...w.io.files.keys()].find((k) => k.endsWith(`${id}.json`)));
  assert.equal(w.port.fact(id), null, "the process died after the journal line");
  const [again] = w.put([cand({ subject: "signup", aspect: "email", says: "An email is required" })]);
  assert.equal(again.outcome, "new");
  assert.equal(w.port.fact(id).revision, 1, "the earlier fact came back through the same door");
  assert.equal(w.port.facts().length, 2);
});

test("the same saying again is journaled as confirmed and the fact file is not touched", () => {
  const w = world();
  w.put([cand()]);
  const file = [...w.io.files.keys()].find((k) => k.endsWith(`${id}.json`));
  const before = w.io.read(file);
  w.clock.at = "2026-09-30T11:00:00.000Z";
  const [r] = w.put([cand({ says: "a refund above 500 needs a manager." })]);
  assert.deepEqual([r.outcome, r.changed], ["confirm", false]);
  assert.equal(w.io.read(file), before, "not one byte of the fact moved");
  assert.deepEqual(w.port.journalLines().map((l) => l.outcome), ["new", "confirm"]);
});

test("a later revision that says something else supersedes: the new version stands, the old is kept beside it and marked", () => {
  const w = world();
  w.put([cand()]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  const [r] = w.put([cand({ says: "A refund above 300 needs a manager", sources: [A(2)] })]);
  assert.deepEqual([r.outcome, w.port.fact(id).revision, w.port.fact(id).supersedes], ["changed", 2, `${id}@1`]);
  assert.deepEqual(w.port.versions(id).map((f) => [f.revision, f.status, f.says]), [[1, "superseded", "A refund above 500 needs a manager"]]);
  assert.deepEqual(w.port.state().sources["src-aaaaaaaaaaaa"].seen, ["1", "2"]);
});

test("the same saying on a later revision moves the citation and not the version", () => {
  const w = world();
  w.put([cand()]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  const [r] = w.put([cand({ sources: [A(2)] })]);
  assert.deepEqual([r.outcome, w.port.fact(id).revision, w.port.fact(id).sources, w.port.versions(id).length], ["restated", 1, [A(2)], 0]);
});

test("another source saying something else is a CONFLICT: both are kept, a blocking question is asked once, and a finding says so", () => {
  const w = world();
  w.put([cand()]);
  const [r] = w.put([cand({ says: "A refund above 300 needs a manager", sources: [B(1)] })]);
  assert.equal(r.outcome, "rival");
  const fact = w.port.fact(id);
  assert.deepEqual([fact.status, fact.revision, fact.rivals, fact.says], ["conflict", 2, [`${id}@1`], "A refund above 300 needs a manager"]);
  assert.equal(w.port.versions(id)[0].says, "A refund above 500 needs a manager", "the earlier saying is kept whole");
  const [q] = w.port.questions();
  assert.deepEqual([q.blocking, q.state, q.slots, q.dependsOn.sort()], [true, "open", [{ subject: "refund", aspect: "limit" }], [A(1), B(1)]]);
  assert.deepEqual(w.port.findings().map((f) => f.kind), ["requirement-conflict"]);
  w.put([cand({ says: "A refund above 200 needs a manager", sources: [B(1)] })]);
  assert.equal(w.port.questions().length, 1, "one question per slot, however many disagreements");
  assert.deepEqual(w.port.journalLines().map((l) => l.kind), ["recorded", "recorded", "asked", "recorded", "asked"]);
});

test("a decision holds against a source: the fact is untouched and the journal and findings say it was contested", () => {
  const w = world();
  const decided = makeFact({ root: ROOT, subject: "refund", aspect: "limit", says: "Above 500 needs a manager", status: "decided", decision: "rd-dddddddddddd", sources: ["decision:rd-dddddddddddd"], at: T1, seenBy: SEEN });
  w.port.transact(() => w.port.saveFact(decided));
  const [r] = w.put([cand({ says: "Above 500 needs nobody" })]);
  assert.deepEqual([r.outcome, w.port.fact(id).status, w.port.fact(id).says], ["held", "decided", "Above 500 needs a manager"]);
  assert.deepEqual(w.port.findings().map((f) => f.kind), ["requirement-decision-holds"]);
});

test("a candidate that reaches ingest citing context is refused for that one and the rest of the batch still lands", () => {
  const w = world();
  const [bad, good] = w.put([cand({ sources: ["source:src-cccccccccccc@1"] }), cand({ subject: "signup", aspect: "email", says: "An email is required" })]);
  assert.deepEqual([bad.outcome, good.outcome], ["refused", "new"]);
  assert.equal(w.port.fact(id), null);
  assert.deepEqual(w.port.findings().map((f) => f.kind), ["requirement-refused"]);
});

test("an operation is applied ONCE: asked again after a lost answer, it is replayed and nothing is written twice", () => {
  const w = world();
  const first = w.put([cand()], { operation: "op-1" });
  const lines = w.port.journalLines().length;
  const again = w.put([cand()], { operation: "op-1" });
  assert.deepEqual([again[0].replayed, again[0].outcome, again[0].fact.id], [true, "new", first[0].fact.id]);
  assert.equal(w.port.journalLines().length, lines);
  const other = w.put([cand()], { operation: "op-2" });
  assert.equal(other[0].outcome, "confirm", "a different operation is a different question");
});

test("the bound is checked before anything is written: past it, none of the batch lands", () => {
  const w = world();
  w.port.transact(() => {
    for (let i = 0; i < MAX_FACTS; i++) w.port.saveFact(makeFact({ root: ROOT, subject: `s${i}`, aspect: "a", says: "x", status: "stated", sources: [A(1)], at: T1, seenBy: SEEN }));
  });
  const journal = w.port.journalLines().length;
  assert.throws(() => w.put([cand()]), (e) => e instanceof Refused && /more than 2048 facts/.test(e.message));
  assert.equal(w.port.fact(id), null);
  assert.equal(w.port.journalLines().length, journal);
  assert.doesNotThrow(() => w.put([cand({ subject: "s1", aspect: "a", says: "x" })]), "a slot that exists is not a new one");
});

test("with no source world bound, nothing is recorded", () => {
  const w = world();
  assert.throws(() => ingest({ ...w.ctx, world: undefined }, ROOT, [cand()]), /none is bound/);
  assert.equal(w.port.journalLines().length, 0);
});

test("the room is re-derived from its own journal: every fact is the same after a mix of outcomes", () => {
  const w = world();
  w.put([cand(), cand({ subject: "signup", aspect: "email", says: "An email is required", sources: [B(1)] })]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "A refund above 300 needs a manager", sources: [A(2)] })]);
  w.put([cand({ says: "A refund above 200 needs a manager", sources: [B(1)] })]);
  w.put([cand({ subject: "signup", aspect: "email", says: "An email is required.", sources: [B(1)] })]);
  w.put([cand({ subject: "cart", aspect: "size", sources: ["source:src-cccccccccccc@1"] })]);
  const verdicts = compared(w.port.facts(), refolded(w.port.journalLines(), ROOT));
  assert.deepEqual(verdicts.map((v) => v.verdict), ["same", "same"], JSON.stringify(verdicts));
  assert.equal(w.port.facts().length, 2);
});

test("recovery writes only what the journal carries whole, and a room that is already right is left alone", () => {
  const w = world();
  w.put([cand()]);
  assert.deepEqual(w.port.transact(() => recover(w.port)), { facts: [], questions: [], decisions: [], answers: [] });
});

// ---- the judge -------------------------------------------------------------------------------

const lines = (...raws) => raws.map((raw, i) => ({ i, raw }));

test("a good batch is accepted whole, with a stated status by default", () => {
  const w = world();
  const out = judge(lines({ subject: "refund", aspect: "limit", says: "Needs a manager", sources: [A(1)] }), w.judged);
  assert.deepEqual([out.refused, out.accepted.length, out.accepted[0].status], [false, 1, "stated"]);
});

test("one bad line refuses the WHOLE batch: half an answer is not stored", () => {
  const w = world();
  const out = judge(lines(cand(), cand({ subject: "signup", sources: ["source:src-cccccccccccc@1"] })), w.judged);
  assert.deepEqual([out.refused, out.accepted, out.rejected.length], [true, [], 1]);
  assert.match(out.rejected[0].why, /is a commit — context for what was built, never where a requirement comes from/);
});

test("a citation must name something that was read here, at a revision somebody read", () => {
  const w = world();
  const why = (sources) => judge(lines(cand({ sources })), w.judged).rejected[0]?.why ?? "";
  assert.match(why(["source:src-dddddddddddd@1"]), /is not one that was read here/);
  assert.match(why([A(9)]), /revision 9 of src-aaaaaaaaaaaa was never read here \(it stands at 1\)/);
  assert.equal(why([A(1)]), "");
  w.put([cand()]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  assert.equal(why([A(1)]), "", "an older revision is fine once it was cited to this requirement");
  assert.equal(why([A(2)]), "", "and so is the one the source stands at");
  const other = world();
  other.sources["src-aaaaaaaaaaaa"].revision = "2";
  assert.match(judge(lines(cand({ sources: [A(1)] })), other.judged).rejected[0].why, /revision 1 of src-aaaaaaaaaaaa was never read here \(it stands at 2\)/, "a reading of a revision nobody cited, after the source moved on, is stale");
});

test("implementation evidence is never a source: a path, a test, a claim, a run, a commit, a URL", () => {
  const w = world();
  for (const bad of ["src/app/refunds.ts", "test/refunds.test.mjs", "k-aaaaaaaaaaaa", "work:w-aaaaaaaaaaaa#rct-1", "commit:abc1234", "https://tracker.example.test/1", "decision:rd-dddddddddddd"]) {
    const out = judge(lines(cand({ sources: [A(1), bad] })), w.judged);
    assert.match(out.rejected[0].why, /only sources at a revision/, bad);
  }
});

test("a derived candidate follows from STANDING facts that SAY something -- not an unknown, a conflict or a missing one", () => {
  const w = world();
  w.put([cand()]);
  const derived = (from) => judge(lines({ subject: "refund", aspect: "approval", says: "A manager approves", status: "derived", derivedFrom: from }), w.judged);
  assert.deepEqual(derived([id]).accepted.length, 1);
  assert.match(derived(["rf-eeeeeeeeeeee"]).rejected[0].why, /is not a standing fact that says something/);
  w.port.transact(() => w.port.saveFact(makeFact({ root: ROOT, subject: "x", aspect: "y", says: "", status: "unknown", at: T1, seenBy: SEEN })));
  assert.match(derived([factId(ROOT, "x", "y")]).rejected[0].why, /is not a standing fact that says something/);
});

test("stamped fields, unknown fields, a bad shape and a bad line are named", () => {
  const w = world();
  const why = (raw) => judge(lines(raw), w.judged).rejected[0].why;
  assert.match(why({ ...cand(), authority: "accepted" }), /authority is the engine's to say/);
  assert.match(why({ ...cand(), colour: "blue" }), /unknown field "colour"/);
  assert.match(why({ ...cand(), status: "decided" }), /a candidate is stated or derived/);
  const [bad] = parseCandidates("{ not json");
  assert.match(judge([bad], w.judged).rejected[0].why, /not valid JSON/);
});

test("candidates are read a line at a time, blank lines skipped, and a batch is bounded", () => {
  const rows = parseCandidates(`\n${JSON.stringify(cand())}\n\n${JSON.stringify(cand({ subject: "signup" }))}\n`);
  assert.deepEqual(rows.map((r) => r.i), [0, 1]);
  const big = judge(Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ i, raw: cand() })), world().judged);
  assert.deepEqual([big.refused, big.accepted], [true, []]);
});

// ---- one door -------------------------------------------------------------------------------

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

test("nothing but ingest writes a fact or keeps a version: a second writer would be a way round reconciliation", () => {
  const dir = join(REPO, "src", "requirements");
  const callers = readdirSync(dir).filter((f) => f.endsWith(".mjs") && f !== "store.mjs").filter((f) => /\.(saveFact|keepAside)\(/.test(readFileSync(join(dir, f), "utf8").replace(/^\s*\/\/.*$/gm, "")));
  assert.deepEqual(callers, ["ingest.mjs"]);
});
