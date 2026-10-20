// The Requirement Roundtable, as the engine sees it: what a round IS (a digest of the
// requirement state it reviewed, and a fold of two journal kinds), what a reviewer may hand in,
// what the critic may do with it, and how the retained questions reach the ONE writer of
// questions -- never a decision, never a person's word, never a transcript.
//
// A reviewer is a host's model; nothing here calls one. These tests drive the engine the way a
// host does: ask for the envelope, hand a review in, hand the critique in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { answer, ask, ingest } from "../src/requirements/ingest.mjs";
import { markAsked, withdraw } from "../src/requirements/questions.mjs";
import { compared, pending, refolded } from "../src/requirements/replay.mjs";
import { roundContent, roundDigest } from "../src/requirements/roundtable/digest.mjs";
import { foldOf, nextOf, stopOf } from "../src/requirements/roundtable/model.mjs";
import { judgeCritique } from "../src/requirements/roundtable/critique.mjs";
import { judgeReview } from "../src/requirements/roundtable/review.mjs";
import { LIMITS, PERSPECTIVES, REVIEWERS } from "../src/requirements/roundtable/vocab.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { KINDS } from "../src/requirements/vocab.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const T1 = "2026-09-30T10:00:00.000Z";
const T2 = "2026-10-01T09:30:00.000Z";
const A = (rev) => `source:src-aaaaaaaaaaaa@${rev}`;
const SLOT = { subject: "export", aspect: "authorization" };

function world(over = {}) {
  const clock = { at: over.at ?? T1 };
  const io = fakeIo({ now: () => clock.at });
  const requirements = createRequirements("/store/acme", io);
  const port = requirements.open(ROOT);
  const sources = { "src-aaaaaaaaaaaa": { revision: "1", kind: "workitem", authorityBearing: true } };
  const resolves = (ref) => {
    const m = /^source:(src-[0-9a-f]{12})@(.+)$/.exec(ref);
    const s = m && sources[m[1]];
    return s ? { sid: m[1], cited: m[2], revision: s.revision, digest: `d${s.revision}`, kind: s.kind, authorityBearing: true } : null;
  };
  const ctx = { requirements, now: () => clock.at, world: { resolves }, seenBy: { host: over.host ?? "laptop-a", at: clock.at } };
  return { io, port, sources, clock, ctx, put: (c) => ingest(ctx, ROOT, c), ask: (s) => ask(ctx, ROOT, s), answer: (a) => answer(ctx, ROOT, a) };
}

const fact = (subject, aspect, says, rev = 1) => ({ subject, aspect, says, status: "stated", sources: [A(rev)] });
const question = (over = {}) => ({ slots: [SLOT], asks: "Which users may export reports?", blocking: true, ...over });
const reviewed = (sequence, perspective, digest, over = {}) => ({ v: 1, kind: "reviewed", sequence, digest, perspective, outcome: "reviewed", candidates: [], ...over });
const closed = (sequence, digest, after, over = {}) => ({ v: 1, kind: "round-closed", sequence, digest, after, round: 1, pooled: 0, retained: 0, questions: [], asked: 0, settled: 0, failed: [], ...over });

// ---- the round digest ---------------------------------------------------------------------------

test("the same facts, decisions and questions give the same digest, whatever order they were written in and whenever", () => {
  const a = world({ at: T1, host: "laptop-a" });
  const b = world({ at: T2, host: "laptop-b" });
  a.put([fact("export", "scope", "Search results can be exported"), fact("cart", "size", "A cart holds at most 50 lines")]);
  b.put([fact("cart", "size", "A cart holds at most 50 lines"), fact("export", "scope", "Search results can be exported")]);
  assert.equal(roundDigest(a.port, ROOT), roundDigest(b.port, ROOT));
  assert.match(roundDigest(a.port, ROOT), /^[0-9a-f]{16}$/);
});

test("a question asked twice, and a question marked as put to a person, leave the digest alone", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const [q] = w.ask([question()]);
  const before = roundDigest(w.port, ROOT);
  w.ask([question({ blocking: false })]);
  w.port.saveQuestion(markAsked(w.port.question(q.id), { workflow: "orbit-requirements", at: T1, seenBy: { host: "laptop-a", at: T1 } }));
  assert.equal(roundDigest(w.port, ROOT), before);
});

test("a person's answer, a withdrawal, a new fact revision and a new question each move the digest", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const start = roundDigest(w.port, ROOT);
  const [q] = w.ask([question()]);
  const asked = roundDigest(w.port, ROOT);
  w.answer({ question: q.id, says: "Only users with export permission", human: true });
  const answered = roundDigest(w.port, ROOT);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([fact("export", "scope", "Search results and saved lists can be exported", 2)]);
  const revised = roundDigest(w.port, ROOT);
  const [other] = w.ask([question({ slots: [{ subject: "export", aspect: "failure" }], asks: "What happens when export fails?" })]);
  withdraw(w.ctx, ROOT, { question: other.id, human: true });
  const withdrawn = roundDigest(w.port, ROOT);
  assert.equal(new Set([start, asked, answered, revised, withdrawn]).size, 5);
});

test("a question changing state, with nothing else changing, moves the digest: a withdrawal is a change a round must notice", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const [q] = w.ask([question()]);
  const before = { digest: roundDigest(w.port, ROOT), content: roundContent(w.port, ROOT) };
  withdraw(w.ctx, ROOT, { question: q.id, human: true });
  const after = { digest: roundDigest(w.port, ROOT), content: roundContent(w.port, ROOT) };
  assert.deepEqual(after.content.facts, before.content.facts, "withdrawing leaves every fact exactly as it was");
  assert.deepEqual(after.content.questions.map((x) => x.state), ["withdrawn"]);
  assert.notEqual(after.digest, before.digest);
});

// ---- the journal kinds and the fold ---------------------------------------------------------------

test("a round is two journal kinds, an allow-list like every other, and none carries the journal's own word", () => {
  assert.ok(KINDS.reviewed && KINDS["round-closed"]);
  for (const kind of ["reviewed", "round-closed"]) assert.equal(KINDS[kind].includes("kind"), false, kind);
  const w = world();
  w.port.transact(() => w.port.journal({ kind: "reviewed", digest: "d".repeat(16), perspective: "product", outcome: "reviewed", candidates: [], reasoning: "a chain of thought", status: "decided" }));
  const [line] = w.port.journalLines();
  assert.deepEqual([line.kind, line.perspective, line.sequence], ["reviewed", "product", 1]);
  assert.equal("reasoning" in line, false, "a field nobody declared never reaches the disk");
  assert.equal("status" in line, false);
});

test("round lines are invisible to everything that already reads the journal: replay, healing and why", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  w.port.transact(() => w.port.journal({ kind: "reviewed", digest: "d".repeat(16), perspective: "qa", outcome: "failed", candidates: [] }));
  const verdicts = compared(w.port.facts(), refolded(w.port.journalLines(), ROOT));
  assert.deepEqual(verdicts.map((v) => v.verdict), ["same"]);
  assert.deepEqual(pending(w.port), { facts: [], questions: [], decisions: [] });
});

test("the fold is the round: nothing on the journal means round one with every reviewer queued", () => {
  const fold = foldOf([], "d1");
  assert.deepEqual([fold.closes.length, fold.reviews, fold.settled], [0, {}, null]);
  assert.equal(nextOf(fold), "product");
  assert.deepEqual(stopOf(fold, { blockingOpen: false }), { id: "start", stop: null });
});

test("reviewers may hand in in any order, and next is always the first one still queued, then the critic", () => {
  const lines = [reviewed(1, "qa", "d1"), reviewed(2, "product", "d1")];
  assert.equal(nextOf(foldOf(lines, "d1")), "domain");
  assert.equal(nextOf(foldOf([...lines, reviewed(3, "domain", "d1", { outcome: "failed" })], "d1")), "socrates", "a failed review is a hand-in, never coverage -- and never a reason to wait");
  const swapped = [reviewed(1, "product", "d1"), reviewed(2, "qa", "d1"), reviewed(3, "domain", "d1")];
  assert.deepEqual(Object.keys(foldOf(swapped, "d1").reviews).sort(), [...REVIEWERS].sort());
});

test("lines written against a digest that is no longer the state are ignored, never deleted", () => {
  const fold = foldOf([reviewed(1, "product", "d1"), reviewed(2, "domain", "d1")], "d2");
  assert.deepEqual(fold.reviews, {});
  assert.equal(stopOf(fold, { blockingOpen: false }).id, "start");
});

test("a later hand-in for the same perspective replaces the earlier one in the fold", () => {
  const fold = foldOf([reviewed(1, "qa", "d1", { outcome: "failed" }), reviewed(2, "qa", "d1", { candidates: [{ id: "qa-1" }] })], "d1");
  assert.deepEqual([fold.reviews.qa.outcome, fold.reviews.qa.candidates.length], ["reviewed", 1]);
});

test("a closed round settles the digest it LEFT behind, and its own lines do not reopen it", () => {
  const lines = [reviewed(1, "product", "d1"), reviewed(2, "domain", "d1"), reviewed(3, "qa", "d1"), closed(4, "d1", "d2", { asked: 2, questions: ["rq-aaaaaaaaaaaa"] })];
  const atAfter = foldOf(lines, "d2");
  assert.equal(atAfter.settled.round, 1);
  assert.equal(stopOf(atAfter, { blockingOpen: true }).id, "waiting-human");
  const atReviewed = foldOf(lines, "d1");
  assert.equal(atReviewed.settled, null, "the state moved on; d1 is not the state any more");
  assert.deepEqual(atReviewed.reviews, {}, "reviews before the close belong to the closed round");
});

test("a close written twice for one state is one round: a retried critique never spends a second of the three", () => {
  const lines = [reviewed(1, "product", "d1"), reviewed(2, "domain", "d1"), reviewed(3, "qa", "d1"), closed(4, "d1", "d2", { asked: 2 }), closed(5, "d1", "d2", { asked: 2 })];
  const fold = foldOf(lines, "d2");
  assert.deepEqual([fold.closes.length, fold.settled.sequence, Object.keys(fold.settled.reviews).sort()], [1, 4, ["domain", "product", "qa"]]);
  assert.equal(stopOf(foldOf([...lines, closed(6, "d2", "d3"), closed(7, "d3", "d4")], "e"), { blockingOpen: false }).id, "round-limit", "three DISTINCT states reviewed is the limit; a duplicate was not one of them");
});

test("a round that asked nothing changed nothing: rerunning it is no-new-questions, not another round", () => {
  const lines = [reviewed(1, "product", "d1"), reviewed(2, "domain", "d1"), reviewed(3, "qa", "d1"), closed(4, "d1", "d1")];
  const fold = foldOf(lines, "d1");
  assert.deepEqual(fold.reviews, {}, "its own lines are before the close");
  assert.equal(stopOf(fold, { blockingOpen: false }).id, "no-new-questions");
});

test("the stop table, row by row: first row that holds, and the last always answers", () => {
  const settled = (over, after = "d2") => foldOf([closed(5, "d1", after, over)], after);
  const open = foldOf([reviewed(1, "product", "d1")], "d1");
  assert.equal(stopOf(open, { blockingOpen: true }).id, "continue", "an open round goes on, even with a blocking question standing");
  assert.equal(stopOf(settled({ asked: 3 }), { blockingOpen: true }).id, "waiting-human");
  assert.equal(stopOf(settled({ failed: [...REVIEWERS] }), { blockingOpen: false }).id, "reviewer-failed");
  assert.equal(stopOf(settled({ asked: 0 }), { blockingOpen: false }).id, "no-new-questions");
  assert.equal(stopOf(settled({ asked: 2 }), { blockingOpen: false }).id, "already-reviewed");
  const three = foldOf([closed(1, "a", "b"), closed(2, "b", "c"), closed(3, "c", "d")], "e");
  assert.equal(stopOf(three, { blockingOpen: false }).id, "round-limit");
  assert.equal(LIMITS.rounds, 3);
  assert.deepEqual(stopOf(foldOf([closed(1, "a", "b")], "z"), { blockingOpen: false }), { id: "start", stop: null });
});

test("every stop names itself, and only the rows that end the loop carry a stop reason", () => {
  const rows = [
    [foldOf([closed(1, "a", "b", { asked: 1 })], "b"), { blockingOpen: true }, "waiting-human"],
    [foldOf([closed(1, "a", "a")], "a"), { blockingOpen: false }, "no-new-questions"],
    [foldOf([closed(1, "a", "b", { asked: 1 })], "b"), { blockingOpen: false }, "already-reviewed"],
    [foldOf([closed(1, "a", "b"), closed(2, "b", "c"), closed(3, "c", "d")], "e"), { blockingOpen: false }, "round-limit"],
  ];
  for (const [fold, state, id] of rows) assert.deepEqual(stopOf(fold, state), { id, stop: id });
});

test("the perspective table is data: four rows, three of them reviewers, no model or provider name, bounded", () => {
  assert.deepEqual(PERSPECTIVES.map((p) => p.id), ["product", "domain", "qa", "socrates"]);
  assert.deepEqual(REVIEWERS, ["product", "domain", "qa"]);
  for (const p of PERSPECTIVES) assert.ok(p.purpose && p.working && Array.isArray(p.focus) && p.focus.length, p.id);
  assert.doesNotMatch(JSON.stringify(PERSPECTIVES), /claude|codex|gpt|openai|anthropic|gemini/i);
  assert.deepEqual([LIMITS.rounds, LIMITS.candidates, LIMITS.retained], [3, 5, 8]);
});

// ---- what a reviewer may hand in ------------------------------------------------------------------

const lines = (...rows) => `${rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n")}\n`;
const cand = (over = {}) => ({ slots: [SLOT], asks: "Which users may export reports?", blocking: true, ...over });
const refusal = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof Refused, e.message); return e.message; }
  return assert.fail("expected a refusal");
};

test("a review is question proposals and nothing else: normalised, numbered by who handed them in, bounded", () => {
  const got = judgeReview("product", lines(cand({ proposed: "Only users with export permission.", dependsOn: [A(1)] }), cand({ slots: [{ subject: "export", aspect: "filters" }, { subject: "export", aspect: "scope" }], asks: "Does export respect the active filters?", blocking: false })));
  assert.deepEqual(got.map((c) => c.id), ["product-1", "product-2"]);
  assert.deepEqual(Object.keys(got[0]).sort(), ["asks", "blocking", "dependsOn", "id", "proposed", "slots"]);
  assert.deepEqual([got[0].blocking, got[1].blocking, "proposed" in got[1], "dependsOn" in got[1]], [true, false, false, false]);
  assert.equal(got[1].slots.length, 2);
});

test("found nothing is a review: an empty hand-in is zero candidates, not an error", () => {
  assert.deepEqual(judgeReview("qa", ""), []);
  assert.deepEqual(judgeReview("qa", "\n\n"), []);
});

test("at most five candidates from one perspective; six is refused whole, and the refusal says what to do", () => {
  const five = Array.from({ length: LIMITS.candidates }, (_, i) => cand({ slots: [{ subject: "export", aspect: `a${i}` }] }));
  assert.equal(judgeReview("domain", lines(...five)).length, 5);
  const message = refusal(() => judgeReview("domain", lines(...five, cand({ slots: [{ subject: "export", aspect: "a9" }] }))));
  assert.match(message, /at most 5 candidates/);
});

test("one bad line refuses the whole hand-in, and names the line; nothing is repaired", () => {
  const message = refusal(() => judgeReview("product", lines(cand(), { slots: [], asks: "" }, "not json")));
  assert.match(message, /line 2/);
  assert.match(message, /line 3: not valid JSON/);
  assert.match(message, /all or nothing/);
});

test("a reviewer proposes; it cannot answer, decide, claim authority, stamp the engine's fields or bring a transcript", () => {
  for (const key of ["status", "human", "answer", "decision", "authority", "state", "id", "decided", "says", "outcome", "approved", "reasoning", "hypothesis", "chain_of_thought"]) {
    const message = refusal(() => judgeReview("product", lines({ ...cand(), [key]: "x" })));
    assert.match(message, new RegExp(key), key);
  }
  assert.match(refusal(() => judgeReview("product", lines({ ...cand(), status: "decided", human: true }))), /a person decides/);
});

test("a question rests only on a source at a revision, and a slot is a plain slug that looks like no secret", () => {
  assert.match(refusal(() => judgeReview("qa", lines(cand({ dependsOn: ["src/app/export.ts"] })))), /dependsOn names sources/);
  assert.match(refusal(() => judgeReview("qa", lines(cand({ slots: [{ subject: "abcdef0123456789abcdef0123456789", aspect: "x" }] })))), /secret/);
  assert.match(refusal(() => judgeReview("qa", lines(cand({ slots: Array.from({ length: 5 }, (_, i) => ({ subject: "export", aspect: `a${i}` })) })))), /at most 4 slots/);
  assert.match(refusal(() => judgeReview("qa", lines(cand({ slots: [{ subject: "export", aspect: "x", note: "a reason" }] })))), /a slot is a subject and an aspect/);
});

test("what is kept of the words is short and masked, and a question that says nothing is refused", () => {
  const [kept] = judgeReview("qa", lines(cand({ asks: `${"Why? ".repeat(200)} ask bob@example.com`, proposed: "Use token=abc123abc123abc123abc123abc123abc123" })));
  assert.ok(kept.asks.length <= 240, `asks is ${kept.asks.length}`);
  assert.equal(JSON.stringify(kept).includes("bob@example.com"), false);
  assert.equal(JSON.stringify(kept).includes("abc123abc123"), false);
  assert.match(refusal(() => judgeReview("qa", lines(cand({ asks: "```" })))), /asks something/);
});

test("only a reviewer hands in a review; the critic has its own door", () => {
  assert.match(refusal(() => judgeReview("socrates", "")), /not a reviewer/);
  assert.match(refusal(() => judgeReview("nobody", "")), /not a reviewer/);
});

// ---- what the critic may do with them ---------------------------------------------------------------

const slot = (aspect, subject = "export") => ({ subject, aspect });
const pooled = (id, aspect, over = {}) => ({ id, perspective: id.split("-")[0], slots: [slot(aspect)], asks: `What about ${aspect}?`, blocking: false, ...over });
const POOL = [pooled("product-1", "authorization", { blocking: true }), pooled("qa-1", "authorization", { asks: "Which roles can export reports?", proposed: "Admins only" }), pooled("domain-1", "snapshot", { blocking: true }), pooled("qa-2", "empty")];
const verdicts = (...rows) => lines(...rows);
const keepAll = POOL.map((c) => ({ candidate: c.id, verdict: "keep" }));

test("every candidate gets exactly one verdict: a missing one and a repeated one are both refused", () => {
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...keepAll.slice(1)), ROOT)), /no verdict for product-1/);
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...keepAll, keepAll[0]), ROOT)), /product-1 has more than one verdict/);
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...keepAll, { candidate: "nobody-9", verdict: "keep" }), ROOT)), /not one a reviewer handed in/);
});

test("keep passes a proposal through as the question it would be, with nothing of the pool's bookkeeping", () => {
  const { retained } = judgeCritique(POOL.slice(2, 3), verdicts({ candidate: "domain-1", verdict: "keep" }), ROOT);
  assert.deepEqual(retained, [{ spec: { slots: [slot("snapshot")], asks: "What about snapshot?", blocking: true }, from: ["domain-1"] }]);
});

test("drop removes a candidate and keeps the reason, short and masked", () => {
  const rows = keepAll.map((r) => (r.candidate === "qa-2" ? { candidate: "qa-2", verdict: "drop", because: `an implementation detail ${"x".repeat(300)} ask bob@example.com` } : r));
  const got = judgeCritique(POOL, verdicts(...rows), ROOT);
  assert.equal(got.retained.some((k) => k.from.includes("qa-2")), false);
  const why = got.verdicts.find((v) => v.candidate === "qa-2");
  assert.ok(why.because.length <= 120 && !why.because.includes("bob@example.com"));
});

test("two candidates about the same slots are ONE question: blocking is kept, a proposal is kept, nothing is asked twice", () => {
  const { retained } = judgeCritique(POOL, verdicts(...keepAll), ROOT);
  assert.equal(retained.length, 3);
  const auth = retained.find((k) => k.from.includes("product-1"));
  assert.deepEqual([auth.from, auth.spec.blocking, auth.spec.proposed, auth.spec.asks], [["product-1", "qa-1"], true, "Admins only", "What about authorization?"]);
});

test("merge folds a candidate into one that stays: slots join, blocking and dependencies are kept, and it never exceeds four slots", () => {
  const rows = [{ candidate: "product-1", verdict: "keep" }, { candidate: "qa-1", verdict: "keep" }, { candidate: "domain-1", verdict: "merge", into: "product-1", because: "one decision" }, { candidate: "qa-2", verdict: "drop" }];
  const { retained } = judgeCritique(POOL, verdicts(...rows), ROOT);
  const merged = retained.find((k) => k.from.includes("domain-1"));
  assert.deepEqual(merged.spec.slots.map((s) => s.aspect).sort(), ["authorization", "snapshot"]);
  assert.deepEqual(merged.from, ["product-1", "domain-1"]);
  assert.equal(retained.length, 2, "qa-1 asks about one of the two slots, which is a different question from asking about both");
  const wide = [pooled("product-1", "a", { slots: ["a", "b", "c"].map((a) => slot(a)) }), pooled("qa-1", "d", { slots: ["d", "e"].map((a) => slot(a)) })];
  assert.match(refusal(() => judgeCritique(wide, verdicts({ candidate: "product-1", verdict: "keep" }, { candidate: "qa-1", verdict: "merge", into: "product-1" }), ROOT)), /at most 4 slots/);
});

test("a merge goes into a candidate that stays: not itself, not a dropped one, not another merge", () => {
  const into = (target, targetVerdict) => verdicts(...POOL.map((c) => (c.id === "qa-2" ? { candidate: "qa-2", verdict: "merge", into: target } : c.id === target ? { candidate: target, verdict: targetVerdict } : { candidate: c.id, verdict: "keep" })));
  assert.match(refusal(() => judgeCritique(POOL, into("qa-2", "keep"), ROOT)), /merges into a candidate that is not kept or refined/);
  assert.match(refusal(() => judgeCritique(POOL, into("domain-1", "drop"), ROOT)), /merges into a candidate that is not kept or refined/);
  assert.match(refusal(() => judgeCritique(POOL, into("nobody-1", "keep"), ROOT)), /merges into a candidate that is not kept or refined/);
  const chain = [{ candidate: "product-1", verdict: "merge", into: "qa-1" }, { candidate: "qa-1", verdict: "merge", into: "product-1" }, ...keepAll.slice(2)];
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...chain), ROOT)), /merges into a candidate that is not kept or refined/);
});

test("refine rewords a question, and only that: its slots are what make it that question", () => {
  const rows = keepAll.map((r) => (r.candidate === "domain-1" ? { candidate: "domain-1", verdict: "refine", asks: "Which point in time does an export show?", blocking: false, proposed: "The time the export started" } : r));
  const { retained } = judgeCritique(POOL, verdicts(...rows), ROOT);
  const refined = retained.find((k) => k.from.includes("domain-1"));
  assert.deepEqual(refined.spec, { slots: [slot("snapshot")], asks: "Which point in time does an export show?", blocking: false, proposed: "The time the export started" });
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...keepAll.map((r) => (r.candidate === "qa-2" ? { candidate: "qa-2", verdict: "refine", slots: [slot("other")] } : r))), ROOT)), /which slots a question is about/);
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...keepAll.map((r) => (r.candidate === "qa-2" ? { candidate: "qa-2", verdict: "refine" } : r))), ROOT)), /a refine changes asks, blocking or proposed/);
});

test("the critic challenges and never answers: an answer, a decision or a claim of authority is refused by name", () => {
  for (const key of ["answer", "says", "decision", "decided", "human", "authority", "approved", "status", "state", "outcome"]) {
    const rows = keepAll.map((r) => (r.candidate === "qa-2" ? { candidate: "qa-2", verdict: "keep", [key]: "Only admins" } : r));
    assert.match(refusal(() => judgeCritique(POOL, verdicts(...rows), ROOT)), new RegExp(key), key);
  }
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...keepAll.map((r) => ({ ...r, answer: "yes" }))), ROOT)), /never answers it/);
  assert.match(refusal(() => judgeCritique(POOL, verdicts(...keepAll.map((r) => ({ ...r, reasoning: "because" }))), ROOT)), /a keep says candidate, verdict/);
});

test("a round keeps at most eight questions, and an empty pool needs no verdicts", () => {
  const many = Array.from({ length: 9 }, (_, i) => pooled(`qa-${i + 1}`, `a${i}`));
  const all = many.map((c) => ({ candidate: c.id, verdict: "keep" }));
  assert.match(refusal(() => judgeCritique(many, verdicts(...all), ROOT)), /at most 8 questions/);
  assert.equal(judgeCritique(many, verdicts(...all.slice(0, 8), { candidate: "qa-9", verdict: "drop" }), ROOT).retained.length, 8);
  assert.deepEqual(judgeCritique([], "", ROOT), { retained: [], verdicts: [] });
  assert.match(refusal(() => judgeCritique([], verdicts({ candidate: "qa-1", verdict: "keep" }), ROOT)), /not one a reviewer handed in/);
});

test("a critique is all or nothing, and a line that is not JSON is named", () => {
  const message = refusal(() => judgeCritique(POOL, `${verdicts(...keepAll.slice(0, 2))}not json\n`, ROOT));
  assert.match(message, /not valid JSON/);
  assert.match(message, /all or nothing/);
});
