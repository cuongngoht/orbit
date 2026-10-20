// The three stages of a round, driven as a host drives them against a real room (a fake disk):
// ask for the envelope, hand a review in, hand the critique in. What they must keep true is the
// authority model 1.7.1 built -- a model proposes, only a person decides -- and that a round is
// idempotent on an unchanged state, resumable after a crash, and the same however the three
// reviewers were scheduled.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Refused } from "../src/errors.mjs";
import { answer, ask, ingest } from "../src/requirements/ingest.mjs";
import { withdraw } from "../src/requirements/questions.mjs";
import { critique, handoff, review } from "../src/requirements/roundtable/clarify.mjs";
import { roundDigest } from "../src/requirements/roundtable/digest.mjs";
import { foldOf, poolOf } from "../src/requirements/roundtable/model.mjs";
import { LIMITS } from "../src/requirements/roundtable/vocab.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const T1 = "2026-09-30T10:00:00.000Z";
const A = (rev) => `source:src-aaaaaaaaaaaa@${rev}`;
const slot = (aspect, subject = "export") => ({ subject, aspect });

function world() {
  const clock = { at: T1 };
  const io = fakeIo({ now: () => clock.at });
  const requirements = createRequirements("/store/acme", io);
  const port = requirements.open(ROOT);
  const resolves = (ref) => {
    const m = /^source:(src-[0-9a-f]{12})@(.+)$/.exec(ref);
    return m ? { sid: m[1], cited: m[2], revision: m[2], digest: `d${m[2]}`, kind: "workitem", authorityBearing: true } : null;
  };
  const ctx = { requirements, now: () => clock.at, world: { resolves }, seenBy: { host: "laptop-a", at: T1 } };
  return { io, port, ctx, put: (c) => ingest(ctx, ROOT, c), ask: (s) => ask(ctx, ROOT, s), answer: (a) => answer(ctx, ROOT, a) };
}

const lines = (...rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
const fact = (subject, aspect, says) => ({ subject, aspect, says, status: "stated", sources: [A(1)] });
const proposal = (aspect, over = {}) => ({ slots: [slot(aspect)], asks: `What about export ${aspect}?`, blocking: false, ...over });
const handIn = (w, perspective, rows, over = {}) => review(w.ctx, ROOT, { perspective, text: lines(...rows), ...over });
const critic = (w, rows, over = {}) => critique(w.ctx, ROOT, { text: lines(...rows), ...over });
const keep = (...ids) => ids.map((candidate) => ({ candidate, verdict: "keep" }));
const refusal = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof Refused, `${e.constructor.name}: ${e.message}`); return e.message; }
  return assert.fail("expected a refusal");
};
const kinds = (w) => w.port.journalLines().map((l) => l.kind);

// A requirement with a fact standing, and every reviewer handed in with what they found.
function reviewed(w, { product = [], domain = [], qa = [] } = {}) {
  w.put([fact("export", "scope", "Search results can be exported")]);
  handIn(w, "product", product);
  handIn(w, "domain", domain);
  return handIn(w, "qa", qa);
}

// ---- the hand-off -------------------------------------------------------------------------------------

test("the first call opens round one: nothing written, product at work, and its envelope in hand", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const before = w.port.journalLines().length;
  const doc = handoff(w.ctx, ROOT);
  assert.deepEqual([doc.stage, doc.round, doc.stop, doc.next, doc.failed], ["handoff", 1, null, "product", []]);
  assert.equal(doc.digest, roundDigest(w.port, ROOT));
  assert.equal(w.port.journalLines().length, before, "reading a round writes nothing");
  assert.deepEqual(doc.events.map((e) => [e.actor, e.state]), [["product", "working"], ["domain", "queued"], ["qa", "queued"], ["socrates", "queued"]]);
});

test("the envelope is what a reviewer needs and nothing it could not read already: the state, what is open, what is settled", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported"), fact("cart", "size", "A cart holds at most 50 lines")]);
  const [pending] = w.ask([proposal("authorization", { blocking: true })]);
  const [done] = w.ask([proposal("failure")]);
  const decision = w.answer({ question: done.id, says: "Show an error and keep the file", human: true }).decision.id;
  const { envelope } = handoff(w.ctx, ROOT);
  assert.deepEqual(Object.keys(envelope).sort(), ["digest", "facts", "focus", "limits", "open", "perspective", "purpose", "round", "settled", "truncated"]);
  assert.deepEqual([envelope.perspective, envelope.round, envelope.limits], ["product", 1, { candidates: LIMITS.candidates }]);
  assert.deepEqual(envelope.facts[0], { slot: "export/authorization", status: "unknown" }, "what nobody has said comes first");
  assert.deepEqual(envelope.facts.find((f) => f.slot === "export/failure"), { slot: "export/failure", status: "decided", says: "Show an error and keep the file", decision });
  assert.deepEqual(envelope.facts.find((f) => f.slot === "cart/size"), { slot: "cart/size", status: "stated", says: "A cart holds at most 50 lines", sources: [A(1)] });
  assert.deepEqual(envelope.open, [{ id: pending.id, blocking: true, asks: "What about export authorization?", slots: ["export/authorization"] }]);
  assert.deepEqual(envelope.settled, [{ id: done.id, state: "answered", slots: ["export/failure"] }]);
});

test("the envelope is bounded, says what it left out, and puts what nobody has said ahead of what is already settled", () => {
  const w = world();
  w.put(Array.from({ length: 40 }, (_, i) => fact("item", `a${String(i).padStart(2, "0")}`, `Item ${i} is settled`)));
  w.ask(Array.from({ length: 3 }, (_, i) => proposal(`gap${i}`)));
  const { envelope } = handoff(w.ctx, ROOT);
  assert.equal(envelope.facts.length, LIMITS.envelope.facts);
  assert.deepEqual(envelope.facts.slice(0, 3).map((f) => f.status), ["unknown", "unknown", "unknown"]);
  assert.deepEqual(envelope.truncated, { facts: 43 - LIMITS.envelope.facts, open: 0, settled: 0 });
  const many = world();
  many.put([fact("export", "scope", "x")]);
  many.ask(Array.from({ length: 20 }, (_, i) => proposal(`q${i}`)));
  assert.deepEqual([many.port.questions().length, handoff(many.ctx, ROOT).envelope.open.length, handoff(many.ctx, ROOT).envelope.truncated.open], [20, LIMITS.envelope.open, 20 - LIMITS.envelope.open]);
});

// ---- a review handed in -----------------------------------------------------------------------------

test("a review is journaled against the state it saw, the board moves, and the next perspective's envelope comes back", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const start = handoff(w.ctx, ROOT);
  const doc = handIn(w, "product", [proposal("authorization", { blocking: true }), proposal("filters")], { digest: start.digest });
  assert.deepEqual([doc.stage, doc.next, doc.did, doc.digest], ["review", "domain", "product reviewed (2 candidates)", start.digest]);
  assert.equal(doc.envelope.perspective, "domain");
  const line = w.port.journalLines().at(-1);
  assert.deepEqual([line.kind, line.perspective, line.outcome, line.digest, line.candidates.map((c) => c.id)], ["reviewed", "product", "reviewed", start.digest, ["product-1", "product-2"]]);
  assert.deepEqual(doc.events.slice(0, 2).map((e) => [e.actor, e.state, e.summary]), [["product", "completed", "2 candidate ambiguities"], ["domain", "working", "reviewing rules and state transitions"]]);
  assert.equal(roundDigest(w.port, ROOT), start.digest, "a review is not a change of the requirement");
});

test("a hand-in is refused when the state moved while it was being reviewed, naming what to do", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const seen = handoff(w.ctx, ROOT).digest;
  const [q] = w.ask([proposal("authorization", { blocking: true })]);
  w.answer({ question: q.id, says: "Only users with export permission", human: true });
  assert.match(refusal(() => handIn(w, "product", [], { digest: seen })), /moved while this was being reviewed — run clarify again/);
  assert.deepEqual(kinds(w).filter((k) => k === "reviewed"), []);
});

test("a perspective reviews a state once; a failed one may be handed in again, and the later hand-in is the one that counts", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  handIn(w, "qa", [proposal("failure")]);
  assert.match(refusal(() => handIn(w, "qa", [proposal("retry")])), /qa has already reviewed this state/);
  handIn(w, "domain", [], { failed: true, text: undefined });
  const failed = foldOf(w.port.journalLines(), roundDigest(w.port, ROOT));
  assert.equal(failed.reviews.domain.outcome, "failed");
  handIn(w, "domain", [proposal("rules")]);
  const again = foldOf(w.port.journalLines(), roundDigest(w.port, ROOT));
  assert.deepEqual([again.reviews.domain.outcome, poolOf(again).map((c) => c.id)], ["reviewed", ["domain-1", "qa-1"]]);
});

test("a failed review carries no candidates, shows as a failure on the board, and a bad hand-in writes nothing at all", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const doc = handIn(w, "domain", [proposal("rules")], { failed: true });
  assert.deepEqual([doc.failed, doc.events[1].state], [["domain"], "failed"]);
  assert.deepEqual(w.port.journalLines().at(-1).candidates, []);
  const lengthBefore = w.port.journalLines().length;
  assert.match(refusal(() => handIn(w, "qa", [{ ...proposal("x"), status: "decided" }])), /a person decides/);
  assert.match(refusal(() => handIn(w, "socrates", [])), /not a reviewer/);
  assert.equal(w.port.journalLines().length, lengthBefore);
});

// ---- the critique -------------------------------------------------------------------------------------

test("the critic judges what all three handed in -- or failed at -- and not before", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  handIn(w, "product", [proposal("authorization")]);
  assert.match(refusal(() => critic(w, keep("product-1"))), /domain, qa have not reviewed/);
  handIn(w, "domain", [], { failed: true });
  handIn(w, "qa", []);
  const doc = critic(w, keep("product-1"));
  assert.deepEqual([doc.stage, doc.failed, doc.counts], ["critique", ["domain"], { pooled: 1, retained: 1, asked: 1, settled: 0 }]);
});

test("a round end to end: the retained questions are asked through the one door, blocking ones wait for a person", () => {
  const w = world();
  const first = reviewed(w, { product: [proposal("authorization", { blocking: true }), proposal("filters")], domain: [proposal("snapshot", { blocking: true })], qa: [proposal("authorization", { asks: "Which roles can export?", proposed: "Admins only" }), proposal("empty"), proposal("failure", { blocking: true })] });
  assert.equal(first.next, "socrates");
  assert.equal(first.envelope.pooled.length, 6);
  const doc = critic(w, [...keep("product-1", "domain-1", "qa-1", "qa-3"), { candidate: "product-2", verdict: "merge", into: "domain-1", because: "one decision about the export" }, { candidate: "qa-2", verdict: "drop", because: "an implementation detail" }]);
  assert.deepEqual(doc.counts, { pooled: 6, retained: 3, asked: 3, settled: 0 });
  assert.deepEqual([doc.stop, doc.next, doc.round, doc.questions.length], ["waiting-human", null, 1, 3]);
  assert.equal(doc.questions[0].blocking, true);
  assert.deepEqual(doc.questions.find((q) => q.proposed)?.proposed, "Admins only");
  assert.deepEqual(w.port.questions().map((q) => q.state), ["open", "open", "open"]);
  assert.equal(kinds(w).filter((k) => k === "round-closed").length, 1);
  const close = w.port.journalLines().find((l) => l.kind === "round-closed");
  assert.deepEqual([close.round, close.pooled, close.retained, close.asked, close.settled, close.failed, close.digest === doc.digest], [1, 6, 3, 3, 0, [], false]);
  assert.equal(close.after, doc.digest, "the round remembers the state it LEFT, which asking questions changed");
  assert.deepEqual(close.questions.sort(), w.port.questions().map((q) => q.id).sort());
});

test("nothing a round does is a decision: only a person's answer decides, and no round writes one", () => {
  const w = world();
  reviewed(w, { product: [proposal("authorization", { blocking: true, proposed: "Only admins" })] });
  critic(w, keep("product-1"));
  assert.deepEqual(w.port.decisions(), []);
  assert.deepEqual([...new Set(w.port.facts().map((f) => f.status))].sort(), ["stated", "unknown"]);
  assert.equal(w.port.facts().some((f) => f.decision), false);
  assert.equal(w.port.journalLines().some((l) => l.kind === "answered"), false);
});

test("asking the same state again is a no-op: no round, no lines, no second question", () => {
  const w = world();
  reviewed(w, { product: [proposal("authorization", { blocking: true })] });
  const closed = critic(w, keep("product-1"));
  const count = w.port.journalLines().length;
  const again = handoff(w.ctx, ROOT);
  assert.deepEqual([again.stop, again.next, again.digest], ["waiting-human", null, closed.digest]);
  assert.equal(w.port.journalLines().length, count);
  assert.match(refusal(() => handIn(w, "product", [proposal("authorization")])), /not open for review/);
  assert.match(refusal(() => critic(w, [])), /not open for review|have not reviewed/);
  assert.equal(w.port.questions().length, 1);
});

test("a person's answer is a new state, and the next round begins; a round that finds nothing ends the loop", () => {
  const w = world();
  reviewed(w, { product: [proposal("authorization", { blocking: true })] });
  const waiting = critic(w, keep("product-1"));
  w.answer({ question: waiting.questions[0].id, says: "Only users with export permission", human: true });
  const next = handoff(w.ctx, ROOT);
  assert.deepEqual([next.stop, next.next, next.round], [null, "product", 2]);
  handIn(w, "product", []);
  handIn(w, "domain", []);
  handIn(w, "qa", []);
  const done = critic(w, []);
  assert.deepEqual([done.stop, done.round, done.counts, done.events[3].state], ["no-new-questions", 2, { pooled: 0, retained: 0, asked: 0, settled: 0 }, "skipped"]);
  const count = w.port.journalLines().length;
  assert.equal(handoff(w.ctx, ROOT).stop, "no-new-questions");
  assert.equal(w.port.journalLines().length, count);
  assert.equal(done.digest, roundDigest(w.port, ROOT), "a round that asked nothing left the state exactly as it found it");
});

test("three rounds and no more: after the third the answer opens no fourth", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  for (let round = 1; round <= LIMITS.rounds; round += 1) {
    for (const p of ["product", "domain", "qa"]) handIn(w, p, p === "product" ? [proposal(`a${round}`, { blocking: true })] : []);
    const doc = critic(w, keep("product-1"));
    assert.equal(doc.stop, "waiting-human", `round ${round}`);
    w.answer({ question: doc.questions[0].id, says: `Decision ${round}`, human: true });
  }
  const limit = handoff(w.ctx, ROOT);
  assert.deepEqual([limit.stop, limit.next, limit.events.map((e) => e.actor)], ["round-limit", null, ["roundtable"]]);
  assert.match(refusal(() => handIn(w, "product", [])), /not open for review/);
});

// ---- what already stands is never asked again ----------------------------------------------------------

test("an answered question stays answered: a reviewer asking it again changes nothing and is counted as already settled", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const [q] = w.ask([proposal("authorization", { blocking: true })]);
  w.answer({ question: q.id, says: "Only users with export permission", human: true });
  handIn(w, "product", [proposal("authorization", { asks: "Reworded: who is allowed to export?", blocking: true })]);
  handIn(w, "domain", []);
  handIn(w, "qa", []);
  const count = w.port.journalLines().length;
  const doc = critic(w, keep("product-1"));
  assert.deepEqual(doc.counts, { pooled: 1, retained: 1, asked: 0, settled: 1 });
  assert.equal(w.port.question(q.id).state, "answered");
  assert.equal(w.port.journalLines().slice(count).map((l) => l.kind).join(), "round-closed", "nothing was asked, reopened or decided");
});

test("a slot a person already decided is not asked about again, even under another question's slots", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const [both] = w.ask([{ slots: [slot("authorization"), slot("failure")], asks: "Who may export, and what happens on failure?", blocking: true }]);
  w.answer({ question: both.id, says: "Admins; show an error", human: true });
  handIn(w, "product", [proposal("authorization", { blocking: true })]);
  handIn(w, "domain", []);
  handIn(w, "qa", []);
  const doc = critic(w, keep("product-1"));
  assert.deepEqual([doc.counts.asked, doc.counts.settled, w.port.questions().length], [0, 1, 1]);
});

test("a withdrawn question stays withdrawn, and an open one is extended rather than asked a second time", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  const [gone] = w.ask([proposal("filters")]);
  withdraw(w.ctx, ROOT, { question: gone.id, human: true });
  const [open] = w.ask([proposal("authorization")]);
  handIn(w, "product", [proposal("filters"), proposal("authorization", { blocking: true, proposed: "Only admins" })]);
  handIn(w, "domain", []);
  handIn(w, "qa", []);
  const doc = critic(w, keep("product-1", "product-2"));
  assert.deepEqual(doc.counts, { pooled: 2, retained: 2, asked: 1, settled: 1 });
  assert.equal(w.port.question(gone.id).state, "withdrawn");
  const extended = w.port.question(open.id);
  assert.deepEqual([extended.blocking, extended.proposed, w.port.questions().length], [true, "Only admins", 2]);
});

// ---- scheduling, crashes, and what is never kept ---------------------------------------------------------

test("however the three reviewers were scheduled, the same questions come out: order is not part of the requirement", () => {
  const run = (order) => {
    const w = world();
    w.put([fact("export", "scope", "Search results can be exported")]);
    const found = { product: [proposal("authorization", { blocking: true })], domain: [proposal("snapshot")], qa: [proposal("failure", { blocking: true }), proposal("empty")] };
    for (const p of order) handIn(w, p, found[p]);
    const doc = critic(w, keep("product-1", "domain-1", "qa-1", "qa-2"));
    return { questions: doc.questions.map((q) => q.id), digest: doc.digest, pool: poolOf({ reviews: foldOf(w.port.journalLines(), doc.digest).settled.reviews }).map((c) => c.id) };
  };
  assert.deepEqual(run(["product", "domain", "qa"]), run(["qa", "domain", "product"]));
});

test("a crash between asking and closing leaves questions and no close: the next round sees them and asks nothing twice", () => {
  const w = world();
  reviewed(w, { product: [proposal("authorization", { blocking: true })] });
  const write = w.io.append;
  w.io.append = (file, text) => {
    if (text.includes('"round-closed"')) throw new Error("the disk filled up");
    return write(file, text);
  };
  assert.throws(() => critic(w, keep("product-1")), /the disk filled up/);
  w.io.append = write;
  assert.equal(w.port.questions().length, 1, "the question was asked");
  assert.equal(kinds(w).includes("round-closed"), false);
  const resumed = handoff(w.ctx, ROOT);
  assert.deepEqual([resumed.stop, resumed.next, resumed.round, resumed.envelope.open.length], [null, "product", 1, 1]);
  handIn(w, "product", [proposal("authorization", { blocking: true })]);
  handIn(w, "domain", []);
  handIn(w, "qa", []);
  assert.equal(critic(w, keep("product-1")).counts.asked, 1);
  assert.equal(w.port.questions().length, 1, "the same slots are the same question");
});

test("a reviewer's reasoning has nowhere to go: a hand-in carrying it is refused, and not a word of it is on the disk", () => {
  const w = world();
  w.put([fact("export", "scope", "Search results can be exported")]);
  refusal(() => handIn(w, "product", [{ ...proposal("authorization"), reasoning: "SENTINEL-REASONING first I considered" }]));
  handIn(w, "product", [proposal("authorization", { asks: "Who may export? Contact bob@example.com", proposed: "Use token=SENTINELTOKEN0123456789abcdef0123456789" })]);
  handIn(w, "domain", []);
  handIn(w, "qa", []);
  critic(w, [{ candidate: "product-1", verdict: "keep" }]);
  const everything = [...w.io.files.values()].join("\n");
  for (const leak of ["SENTINEL-REASONING", "bob@example.com", "SENTINELTOKEN"]) assert.equal(everything.includes(leak), false, leak);
});

test("the round's code has one way to change a requirement -- the question door -- and no way to decide", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "requirements", "roundtable");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    const code = readFileSync(join(dir, name), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /\b(saveQuestion|saveFact|saveDecision|keepAside|makeDecision|makeFact)\b/, `${name} writes a requirement without the door`);
    assert.doesNotMatch(code, /human\s*:\s*true|status\s*:\s*"decided"|answer\(/, `${name} speaks for a person`);
    const imports = [...code.matchAll(/import \{([^}]*)\} from "\.\.\/ingest\.mjs"/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
    assert.ok(imports.every((n) => n === "ask"), `${name} imports ${imports} from ingest`);
  }
});
