// The words and shapes of requirement intelligence: what a fact, a question and a
// decision are made of, how clear a set of them is, whose word it is -- and what a
// proposed fact may never claim. Nothing here looks at code, a screen or a run, and
// no rule names a status: the tables are read by their columns.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_FIELDS } from "../src/qa/fields.mjs";
import { VALUE } from "../src/knowledge/fields.mjs";
import { AUTHORITIES } from "../src/sources/contract-v1.mjs";
import { SPECS, QUESTION_SPECS, factCandidateFindings, questionCandidateFindings } from "../src/requirements/candidate.mjs";
import { CANDIDATE_FIELDS, FACT_FIELDS, QUESTION_CANDIDATE_FIELDS, QUESTION_FIELDS, SLOT, STAMPED } from "../src/requirements/fields.mjs";
import { authorityOf, decisionId, factAuthority, factDigest, factId, makeDecision, makeFact, makeQuestion, questionId } from "../src/requirements/model.mjs";
import { AUTHORITY_ORDER, CLARITY, CLARITY_NAMES, KINDS, QUESTION_STATES, STATUS, clarityOf, candidateStatuses, humanOnly, isCurrent, isOpen, settles, weakerAuthority } from "../src/requirements/vocab.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const AT = "2026-09-30T10:00:00.000Z";
const SRC = "source:src-bbbbbbbbbbbb@7";
const SEEN = { host: "laptop-a", at: AT };

const fact = (over = {}) => makeFact({ root: ROOT, subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", status: "stated", sources: [SRC], at: AT, seenBy: SEEN, ...over });

test("authority speaks ADR 0007's two words, the same ones a source and a plan use", () => {
  assert.deepEqual(AUTHORITY_ORDER, AUTHORITIES);
  assert.deepEqual(AUTHORITY_ORDER, SOURCE_FIELDS.authority.enum);
  assert.equal(weakerAuthority("accepted", "draft"), "draft");
  assert.equal(weakerAuthority("draft", "accepted"), "draft");
  assert.equal(weakerAuthority("accepted", "accepted"), "accepted");
});

test("a slot is the same shape a knowledge dimension value is, so nothing drifts between the two memories", () => {
  assert.equal(SLOT, VALUE);
});

test("the STATUS table is read by its columns: what settles, what stands, what only a person may say, what a candidate may claim", () => {
  assert.deepEqual(STATUS.map((s) => s.name), ["stated", "decided", "derived", "unknown", "conflict", "superseded"]);
  assert.deepEqual(STATUS.filter((s) => settles(s.name)).map((s) => s.name), ["stated", "decided", "derived"]);
  assert.deepEqual(STATUS.filter((s) => !isCurrent(s.name)).map((s) => s.name), ["superseded"]);
  assert.deepEqual(STATUS.filter((s) => humanOnly(s.name)).map((s) => s.name), ["decided"]);
  assert.deepEqual(candidateStatuses(), ["stated", "derived"]);
  for (const s of STATUS) assert.ok(s.doc.length > 10, s.name);
});

test("ids are functions of what a thing is about: a slot is one fact whoever says it, and the order of a question's slots does not matter", () => {
  assert.equal(factId(ROOT, "refund", "limit"), factId(ROOT, "refund", "limit"));
  assert.notEqual(factId(ROOT, "refund", "limit"), factId(ROOT, "refund", "approval"));
  assert.notEqual(factId(ROOT, "refund", "limit"), factId("req-cccccccccccc", "refund", "limit"));
  const a = [{ subject: "refund", aspect: "limit" }, { subject: "signup", aspect: "email" }];
  assert.equal(questionId(ROOT, a), questionId(ROOT, [...a].reverse()));
  assert.match(factId(ROOT, "a", "b"), /^rf-[0-9a-f]{12}$/);
  assert.match(questionId(ROOT, a), /^rq-[0-9a-f]{12}$/);
  assert.match(decisionId("rq-aaaaaaaaaaaa", AT), /^rd-[0-9a-f]{12}$/);
});

test("makeFact is the one constructor: it stamps the id and version, restates and masks the text, and drops what is absent instead of writing null", () => {
  const f = makeFact({ root: ROOT, subject: "refund", aspect: "limit", says: "  Needs   a manager, password=hunter2hunter2 [link](x) ", status: "stated", sources: [SRC], at: AT, seenBy: SEEN, supersedes: undefined, decision: null });
  assert.equal(f.id, factId(ROOT, "refund", "limit"));
  assert.deepEqual([f.v, f.revision], [1, 1]);
  assert.doesNotMatch(f.says, /hunter2/);
  assert.doesNotMatch(f.says, /[\[\]]/);
  assert.equal("supersedes" in f || "decision" in f, false);
});

test("a fact's text is a short restatement: clipped, never a copy of a source", () => {
  assert.ok(fact({ says: "x".repeat(2000) }).says.length <= 400);
});

test("a status is tied to what it must rest on: stated cites a source, derived names its facts and cites none, decided names and cites its decision", () => {
  const refused = (over, re) => assert.throws(() => fact(over), re, JSON.stringify(over));
  refused({ sources: [] }, /a stated fact cites the source it comes from/);
  refused({ status: "derived", sources: [SRC], derivedFrom: ["rf-cccccccccccc"] }, /cites no source of its own/);
  refused({ status: "derived", sources: [], derivedFrom: [] }, /names the facts it follows from/);
  refused({ status: "decided", sources: [SRC] }, /names the decision, and cites it/);
  assert.equal(fact({ status: "derived", sources: [], derivedFrom: ["rf-cccccccccccc"] }).status, "derived");
  assert.equal(fact({ status: "decided", decision: "rd-dddddddddddd", sources: ["decision:rd-dddddddddddd"] }).status, "decided");
});

test("a fact that settles something says it; an unknown one need not", () => {
  assert.throws(() => fact({ says: "   " }), /a fact that settles something says it/);
  assert.equal(fact({ status: "unknown", says: "", sources: [] }).says, "");
});

test("only sources at a revision and decisions are where a fact comes from: never a path, a URL, a claim, a run or a commit", () => {
  for (const bad of ["src/app/refunds.ts", "https://tracker.example.test/1", "k-aaaaaaaaaaaa", "work:w-aaaaaaaaaaaa#rct-1", "commit:abcdef1", "source:src-bbbbbbbbbbbb", "source:src-BBBB@7"]) {
    assert.throws(() => fact({ sources: [SRC, bad] }), /neither a source at a revision nor a decision/, bad);
  }
  assert.equal(fact({ sources: [`${SRC}#ac-2`] }).sources[0], `${SRC}#ac-2`, "a locator a person can find it by is fine");
});

test("a subject or an aspect that looks like a secret is refused, never masked -- they are the fact's id", () => {
  assert.throws(() => fact({ subject: "0123456789abcdef0123456789abcdef01234567" }), /looks like a secret/);
});

test("a fact or a question is bounded: a fact that needs more sources is several facts", () => {
  assert.throws(() => fact({ sources: Array.from({ length: 9 }, (_, i) => `source:src-bbbbbbbbbbbb@${i}`) }), /more than 8 sources/);
  assert.throws(() => makeQuestion({ root: ROOT, slots: Array.from({ length: 5 }, (_, i) => ({ subject: `s${i}`, aspect: "a" })), asks: "why", state: "open", at: AT }), /one to 4 objects/);
});

test("a question is about slots, asks one thing, is blocking or not, and never carries a decision of its own", () => {
  const q = makeQuestion({ root: ROOT, slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What happens when the email already exists?", blocking: true, proposed: "reject with a validation message", state: "open", dependsOn: [SRC], at: AT });
  assert.equal(q.id, questionId(ROOT, q.slots));
  assert.deepEqual([q.blocking, q.state, q.dependsOn], [true, "open", [SRC]]);
  assert.throws(() => makeQuestion({ root: ROOT, slots: [{ subject: "a", aspect: "b" }], asks: "x", state: "open", at: AT, dependsOn: ["decision:rd-dddddddddddd"] }), /dependsOn .* is not a source at a revision/);
  assert.equal(makeQuestion({ root: ROOT, slots: [{ subject: "a", aspect: "b" }], asks: "x", state: "open", at: AT }).blocking, false, "a question does not block unless it says so");
});

test("a decision is a person's, relayed: without --human it is not one", () => {
  const d = makeDecision({ root: ROOT, question: "rq-eeeeeeeeeeee", says: "reject; no account is created", human: true, at: AT, seenBy: SEEN });
  assert.deepEqual([d.by, d.human, d.id], ["person", true, decisionId("rq-eeeeeeeeeeee", AT, d.says)]);
  assert.equal(makeDecision({ root: ROOT, question: "rq-eeeeeeeeeeee", says: d.says, human: true, at: AT, seenBy: SEEN }).id, d.id, "the same answer retried is the same decision");
  assert.notEqual(makeDecision({ root: ROOT, question: "rq-eeeeeeeeeeee", says: "keep the account", human: true, at: AT, seenBy: SEEN }).id, d.id, "a different answer in the same instant is another");
  assert.throws(() => makeDecision({ root: ROOT, question: "rq-eeeeeeeeeeee", says: "x", human: false, at: AT }), /a decision is a person's, relayed with --human/);
  assert.throws(() => makeDecision({ root: ROOT, question: "rq-eeeeeeeeeeee", says: "x", human: true, at: AT, by: "engine" }), /by must be person/);
});

// ---- clarity -------------------------------------------------------------------------

const standing = (status, over = {}) => ({ status, ...over });
const asked = (state, blocking = false) => ({ state, blocking });

test("clarity is the first row that holds: blocked, then partial, then complete -- read by columns, never by name", () => {
  assert.deepEqual(CLARITY.map((c) => c.name), CLARITY_NAMES);
  assert.equal(clarityOf([standing("stated")], []), "complete");
  assert.equal(clarityOf([], []), "complete", "nothing unsettled is complete, and an empty set says so only here -- coverage of nothing is a different matter");
  assert.equal(clarityOf([standing("stated"), standing("unknown")], []), "partial");
  assert.equal(clarityOf([standing("conflict")], []), "partial");
  assert.equal(clarityOf([standing("stated")], [asked("open")]), "partial", "an open question that does not block");
  assert.equal(clarityOf([standing("stated")], [asked("open", true)]), "blocked");
  assert.equal(clarityOf([standing("unknown")], [asked("reopened", true)]), "blocked", "a reopened question is open");
});

test("an answered or withdrawn question, and a superseded fact, no longer count against clarity", () => {
  assert.equal(clarityOf([standing("stated"), standing("superseded")], [asked("answered", true), asked("withdrawn", true)]), "complete");
  assert.deepEqual(QUESTION_STATES.filter((s) => s.open).map((s) => s.name), ["open", "reopened"]);
  assert.equal(isOpen({ state: "answered" }), false);
});

// ---- authority ------------------------------------------------------------------------

function contextOf(sources = {}, facts = {}) {
  return { sourceAuthority: (sid) => sources[sid], fact: (id) => facts[id] ?? null };
}

const F = (status, over = {}) => ({ status, sources: [SRC], ...over });

test("authority is derived from what a fact rests on NOW: a stated fact is as strong as its weakest source, and accepting the source later changes it", () => {
  const two = F("stated", { sources: [SRC, "source:src-cccccccccccc@2"] });
  assert.equal(factAuthority(two, contextOf({ "src-bbbbbbbbbbbb": "accepted", "src-cccccccccccc": "accepted" })), "accepted");
  assert.equal(factAuthority(two, contextOf({ "src-bbbbbbbbbbbb": "accepted", "src-cccccccccccc": "draft" })), "draft");
  assert.equal(factAuthority(F("stated"), contextOf({})), "draft", "a source nobody can vouch for is a draft");
  assert.equal(factAuthority(F("stated"), contextOf({ "src-bbbbbbbbbbbb": "draft" })), "draft");
  assert.equal(factAuthority(F("stated"), contextOf({ "src-bbbbbbbbbbbb": "accepted" })), "accepted", "and the same fact, once the source is accepted");
});

test("a decided fact is the team's word whatever its source said; a derived one is as strong as the weakest fact it follows from", () => {
  assert.equal(factAuthority(F("decided", { decision: "rd-dddddddddddd", sources: ["decision:rd-dddddddddddd"] }), contextOf({})), "accepted");
  const facts = { "rf-1": F("stated"), "rf-2": F("decided", { sources: ["decision:rd-dddddddddddd"] }) };
  const derived = { status: "derived", derivedFrom: ["rf-1", "rf-2"] };
  assert.equal(factAuthority(derived, contextOf({ "src-bbbbbbbbbbbb": "draft" }, facts)), "draft");
  assert.equal(factAuthority(derived, contextOf({ "src-bbbbbbbbbbbb": "accepted" }, facts)), "accepted");
  assert.equal(factAuthority({ status: "derived", derivedFrom: ["rf-missing"] }, contextOf({})), "draft", "a fact that cannot be found vouches for nothing");
  const loop = { "rf-a": { status: "derived", derivedFrom: ["rf-a"] } };
  assert.equal(factAuthority(loop["rf-a"], contextOf({}, loop)), "draft", "a fact that follows from itself is bounded, and no word of anybody's");
});

test("a set's authority is its weakest STANDING fact that says something; nothing standing is a draft, and clarity does not change it", () => {
  const ctx = contextOf({ "src-bbbbbbbbbbbb": "accepted" });
  const ok = F("stated");
  assert.equal(authorityOf([ok], ctx), "accepted");
  assert.equal(authorityOf([ok, F("stated", { sources: ["source:src-cccccccccccc@1"] })], ctx), "draft");
  assert.equal(authorityOf([ok, F("unknown", { sources: [] }), F("superseded", { sources: ["source:src-cccccccccccc@1"] })], ctx), "accepted", "an unknown or superseded fact says nothing that could weaken it");
  assert.equal(authorityOf([], ctx), "draft");
  assert.equal(clarityOf([ok], []), "complete", "complete and accepted are different axes");
  assert.equal(clarityOf([F("stated", { sources: ["source:src-cccccccccccc@1"] })], []), "complete", "complete and a draft");
});

test("a fact's digest covers what it says and rests on, not when or by whom", () => {
  const a = fact();
  assert.equal(factDigest(a), factDigest({ ...a, at: "2027-01-01T00:00:00.000Z", seenBy: { host: "other", at: AT }, revision: 9 }));
  assert.equal(factDigest(a), factDigest({ ...a, status: "superseded", supersededBy: `${a.id}@2` }), "what became of it since is not what it said");
  assert.notEqual(factDigest(a), factDigest({ ...a, says: "Something else" }));
  assert.notEqual(factDigest(a), factDigest({ ...a, sources: ["source:src-bbbbbbbbbbbb@8"] }));
  assert.match(factDigest(a), /^[0-9a-f]{16}$/);
});

// ---- candidates ----------------------------------------------------------------------

const cand = (over = {}) => ({ subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", sources: [SRC], ...over });

test("a candidate is held to the contract by a table of rows: a good one has no findings", () => {
  assert.deepEqual(factCandidateFindings(cand()), []);
  assert.deepEqual(factCandidateFindings(cand({ status: "derived", sources: [], derivedFrom: ["rf-cccccccccccc"] })), []);
  assert.ok(SPECS.every((r) => r.name && typeof r.when === "function" && typeof r.say === "function"));
});

test("a candidate cannot bring what the engine stamps -- refused BY NAME, for every one", () => {
  for (const key of STAMPED) {
    const found = factCandidateFindings({ ...cand(), [key]: "x" });
    assert.ok(found.some((f) => f.includes(key) && /engine's to say/.test(f)), `${key}: ${found.join(" | ")}`);
  }
  assert.ok(STAMPED.includes("authority"), "whose word it is is never a candidate's to say");
});

test("a candidate cannot claim a status only a person or the engine can give", () => {
  for (const status of ["decided", "unknown", "conflict", "superseded", "settled"]) {
    assert.ok(factCandidateFindings(cand({ status })).some((f) => /a candidate is stated or derived/.test(f)), status);
  }
});

test("a candidate cites only sources at a revision: implementation evidence is not where a requirement comes from", () => {
  for (const bad of ["src/app/refunds.ts", "test/refunds.test.mjs", "https://x.example.test/y", "commit:abc1234", "decision:rd-dddddddddddd", "k-aaaaaaaaaaaa"]) {
    assert.ok(factCandidateFindings(cand({ sources: [SRC, bad] })).some((f) => /only sources at a revision/.test(f)), bad);
  }
  assert.ok(factCandidateFindings(cand({ sources: [] })).some((f) => /a stated fact cites the source/.test(f)));
});

test("a derived candidate names facts and cites nothing; a fact says something about a real slot; unknown fields are named", () => {
  assert.ok(factCandidateFindings(cand({ status: "derived" })).some((f) => /derived fact names the facts it follows from and cites no source/.test(f)));
  assert.ok(factCandidateFindings(cand({ status: "derived", sources: [], derivedFrom: ["not-a-fact"] })).some((f) => /rf- ids/.test(f)));
  assert.ok(factCandidateFindings(cand({ says: "  " })).some((f) => /says something/.test(f)));
  assert.ok(factCandidateFindings(cand({ subject: "Not A Slug" })).some((f) => /subject and an aspect/.test(f)));
  assert.ok(factCandidateFindings(cand({ colour: "blue" })).some((f) => /unknown field "colour"/.test(f)));
  assert.ok(factCandidateFindings("nope")[0].includes("must be a JSON object"));
  assert.deepEqual(CANDIDATE_FIELDS.filter((k) => STAMPED.includes(k)), [], "no field is both a candidate's and the engine's");
});

test("a question candidate says which slots, what it asks and what it rests on -- and nothing the engine owns", () => {
  const q = { slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What happens?", blocking: true, dependsOn: [SRC] };
  assert.deepEqual(questionCandidateFindings(q), []);
  for (const key of ["id", "state", "answer", "asked", "history", "at", "root", "v"]) assert.ok(questionCandidateFindings({ ...q, [key]: "x" }).some((f) => f.includes(key)), key);
  assert.ok(questionCandidateFindings({ ...q, slots: [] }).some((f) => /one or more slots/.test(f)));
  assert.ok(questionCandidateFindings({ ...q, asks: "" }).some((f) => /asks something/.test(f)));
  assert.ok(questionCandidateFindings({ ...q, dependsOn: ["src/x.ts"] }).some((f) => /dependsOn names sources/.test(f)));
  assert.ok(QUESTION_SPECS.length >= 4 && QUESTION_CANDIDATE_FIELDS.every((k) => k in QUESTION_FIELDS));
});

test("every field a candidate may carry is one the fact table declares, and the journal kinds are an allow-list with no `kind` field", () => {
  for (const k of CANDIDATE_FIELDS) assert.ok(k in FACT_FIELDS, k);
  for (const [name, fields] of Object.entries(KINDS)) assert.equal(fields.includes("kind"), false, `${name} must not carry the journal's own word`);
});
