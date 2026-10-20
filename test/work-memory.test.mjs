// What a piece of work learned, kept as knowledge: only from a receipt that was answered,
// only through the engine's stamped door, held no higher than the evidence allows, and never
// as a requirement. The knowledge room is the real one over a fake filesystem, so every
// support count below is reconciliation's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { judge, parseCandidates } from "../src/knowledge/record.mjs";
import { authorityOf, sourceRow, stampedOnly, verifiedBy } from "../src/knowledge/vocab.mjs";
import { factCandidateFindings } from "../src/requirements/candidate.mjs";
import { modelOf, needId } from "../src/work/model.mjs";
import { HOST_KEYS, claimCandidates, projectClaims, receiptFor, referenceOf, resolverOf, seenByOf, strengthOf } from "../src/work/memory.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";

const ROOT = "req-3f9a1c0b7e21";
const WID = workOf(ROOT);
const DAY1 = "2026-09-30T10:00:00.000Z";
const DAY2 = "2026-10-01T10:00:00.000Z";
const REFS = ["https://docs.example/refunds"];

const claim = (over = {}) => ({ subject: "refund.limit", relation: "results-in", object: "manager.approval", context: {}, because: "the documentation says a refund above the limit needs a manager", ...over });

function room(files = { "src/app/refunds.ts": "x" }) {
  const k = knowledgeWorld({ files });
  const works = createWorks("/store/acme", fakeIo({ now: () => DAY1 }));
  works.create({ id: WID, objective: "Implement the refund limit", root: { id: "4312" }, at: DAY1 });
  const w = { works, memory: { knowledge: k, tracked: k.tracked() } };
  return { k, works, w };
}

const need = (works, capability = "documentation.search") => {
  const n = { id: needId(WID, "knowledge", capability, "limit"), type: "knowledge", capability, subject: "limit", asks: "what is the limit" };
  works.append(WID, "need", n);
  return n;
};

const receipt = (works, n, over = {}) => {
  const count = works.read(WID).filter((r) => r.kind === "receipt").length + 1;
  const row = { id: `rct-${count}`, need: n.id, capability: n.capability, provider: "managed:corp", tool: "search", queryDigest: "q".repeat(64), resultDigest: "r".repeat(64), sourceRefs: REFS, outcome: "ok", why: null, seen: { host: "laptop-a", session: "claude:0123456789abcdef" }, at: DAY1, ...over };
  works.append(WID, "receipt", row);
  return row;
};

const model = (works) => modelOf(works.read(WID));

test("the source row is stamped, recordable, never verified, and a claim resting on it is never the current source or a rule", () => {
  const row = sourceRow("work-receipt");
  assert.deepEqual([row.verified, row.stamped, row.recordable, row.host, row.strengths], [false, true, true, false, ["observed", "suggested"]]);
  assert.equal(stampedOnly("work-receipt"), true);
  assert.equal(verifiedBy("work-receipt"), false);
  for (const strength of ["observed", "suggested"]) for (const confidence of ["certain", "possible"]) {
    const tier = authorityOf({ source: "work-receipt", strength, confidence, status: "fresh", layer: "project" }).tier;
    assert.ok(!["source", "rule", "adopted"].includes(tier), `${strength}/${confidence} reached ${tier}`);
  }
});

test("an answer that said where it came from is an observation, and one that did not is a suggestion", () => {
  const { works } = room();
  const n = need(works);
  assert.equal(strengthOf(receipt(works, n)), "observed");
  assert.equal(strengthOf(receipt(works, n, { sourceRefs: [] })), "suggested");
  assert.equal(strengthOf({}), "suggested");
});

test("a claim from a receipt is stamped with the source and the reference, and lands in knowledge", () => {
  const { k, works, w } = room();
  const n = need(works);
  const r = receipt(works, n);
  const { candidates, receipt: used } = claimCandidates(WID, model(works), n.id, [claim()]);
  const out = projectClaims(w, used, candidates);
  assert.deepEqual([out.state, out.projected], ["synced", 1]);
  const [saved] = k.know.all();
  assert.deepEqual([saved.source, saved.strength, saved.evidence], ["work-receipt", "observed", [referenceOf(WID, r.id)]]);
  assert.equal(authorityOf({ ...saved, measured: saved.status }).tier, "inference", "one session, one observation");
});

test("with no reference in the answer the claim stays a suggestion", () => {
  const { k, works, w } = room();
  const n = need(works);
  receipt(works, n, { sourceRefs: [] });
  const { candidates, receipt: used } = claimCandidates(WID, model(works), n.id, [claim()]);
  projectClaims(w, used, candidates);
  assert.equal(k.know.all()[0].strength, "suggested");
});

test("the same receipt projected again adds no support, and two independent sessions earn confirmation and no more", () => {
  const { k, works, w } = room();
  const n = need(works);
  const first = receipt(works, n);
  const c1 = claimCandidates(WID, model(works), n.id, [claim()]);
  projectClaims(w, c1.receipt, c1.candidates);
  projectClaims(w, c1.receipt, c1.candidates);
  assert.equal(k.know.all()[0].confidence, "possible", "one session however often it is projected");
  const second = receipt(works, n, { at: DAY2, seen: { host: "laptop-b", session: "claude:fedcba9876543210" } });
  const c2 = claimCandidates(WID, model(works), n.id, [claim()], second.id);
  projectClaims(w, c2.receipt, c2.candidates);
  assert.ok(first.id !== second.id);
  const [saved] = k.know.all();
  assert.equal(saved.confidence, "certain");
  assert.equal(authorityOf({ ...saved, measured: saved.status }).tier, "confirmed", "two sessions earn confirmation; a work receipt is never the current source");
});

test("a claim rests on an ANSWERED receipt of that need: none, another need's, or a refused one is refused", () => {
  const { works } = room();
  const a = need(works);
  const b = need(works, "documentation.microsoft");
  assert.throws(() => receiptFor(model(works), a.id), (e) => e instanceof Refused && /work invoke/.test(e.message));
  receipt(works, b);
  assert.throws(() => receiptFor(model(works), a.id), Refused, "another need's receipt is not this need's");
  const refused = receipt(works, a, { outcome: "refused", resultDigest: null, sourceRefs: [] });
  assert.throws(() => receiptFor(model(works), a.id), Refused);
  assert.throws(() => receiptFor(model(works), a.id, refused.id), /named rct-/);
  assert.equal(resolverOf(works)(referenceOf(WID, refused.id)), false, "the door does not resolve a refused call");
});

test("the reference resolves only against the work and the receipt it names", () => {
  const { works } = room();
  const n = need(works);
  const r = receipt(works, n);
  const resolves = resolverOf(works);
  assert.equal(resolves(referenceOf(WID, r.id)), true);
  assert.equal(resolves(referenceOf(WID, "rct-99")), false);
  assert.equal(resolves(referenceOf("w-aaaaaaaaaaaa", r.id)), false, "a work nobody started");
});

test("a host that supplies what only the engine may is refused by name, and none of the batch is kept", () => {
  const { k, works, w } = room();
  const n = need(works);
  receipt(works, n);
  for (const key of ["source", "evidence", "strength", "layer", "contradicts", "seenBy", "id"]) {
    assert.throws(() => claimCandidates(WID, model(works), n.id, [claim(), claim({ subject: "other.thing", [key]: "x" })]), (e) => e instanceof Refused && new RegExp(`"${key}"`).test(e.message) && /claim 2/.test(e.message), key);
  }
  assert.throws(() => claimCandidates(WID, model(works), n.id, ["not an object"]), /a claim is a JSON object/);
  assert.equal(k.know.all().length, 0);
  assert.ok(HOST_KEYS.every((key) => !["source", "evidence", "strength"].includes(key)));
  assert.equal(w.memory.knowledge, k);
});

test("a claim knowledge would refuse is a refusal with its reason, and nothing is written", () => {
  const { k, works, w } = room();
  const n = need(works);
  receipt(works, n);
  const { candidates, receipt: used } = claimCandidates(WID, model(works), n.id, [claim({ subject: "Not A Slug!" })]);
  assert.throws(() => projectClaims(w, used, candidates), (e) => e instanceof Refused && /the knowledge door refused a claim/.test(e.message));
  assert.equal(k.know.all().length, 0);
});

test("a scope must be a tracked file, like everywhere else knowledge is written", () => {
  const { k, works, w } = room();
  const n = need(works);
  receipt(works, n);
  const good = claimCandidates(WID, model(works), n.id, [claim({ scope: ["src/app/refunds.ts"] })]);
  assert.equal(projectClaims(w, good.receipt, good.candidates).projected, 1);
  const bad = claimCandidates(WID, model(works), n.id, [claim({ subject: "other.thing", scope: ["src/nowhere.ts"] })]);
  assert.throws(() => projectClaims(w, bad.receipt, bad.candidates), /matches no tracked file/);
  assert.equal(k.know.all().length, 1);
});

test("with no knowledge room bound, projection is off and says why", () => {
  const { works } = room();
  const n = need(works);
  receipt(works, n);
  const { candidates, receipt: used } = claimCandidates(WID, model(works), n.id, [claim()]);
  const out = projectClaims({ works }, used, candidates);
  assert.deepEqual([out.state, out.projected], ["off", 0]);
  assert.match(out.why, /no knowledge room/);
});

test("nobody can type a work-receipt claim in: the ordinary door refuses it", () => {
  const { k } = room();
  const line = JSON.stringify({ ...claim(), evidence: ["work:w-3f9a1c0b7e21#rct-1"], source: "work-receipt", strength: "observed" });
  const out = judge(parseCandidates(line), { tracked: k.tracked(), gates: new Set() });
  assert.equal(out.refused, true);
  assert.match(out.rejected[0].why, /the engine's own/);
});

test("and it is never a requirement: a requirement fact may not cite a work reference", () => {
  const found = factCandidateFindings({ subject: "refund", aspect: "limit", says: "Needs a manager", sources: [referenceOf(WID, "rct-1")] });
  assert.ok(found.length > 0);
  assert.match(found.join("\n"), /sources|source:/);
});

test("the door accepts only a reference to a work receipt, not to another kind of record", () => {
  const { k, works, w } = room();
  const n = need(works);
  const r = receipt(works, n);
  const foreign = { ...claim(), evidence: ["investigation:inv-20260930-100000-abcd#rct-1"], source: "work-receipt", strength: "observed" };
  assert.throws(() => projectClaims(w, r, [foreign]), (e) => e instanceof Refused && /not a reference this door accepts/.test(e.message));
  assert.equal(k.know.all().length, 0);
});

test("a claim is credited to the session that produced the evidence, by host, day and session", () => {
  assert.deepEqual(seenByOf({ at: DAY1, seen: { host: "laptop-a", session: "claude:0123456789abcdef" } }), { host: "laptop-a", at: DAY1, session: "claude:0123456789abcdef" });
  assert.deepEqual(seenByOf({ at: DAY1 }), { host: "unknown", at: DAY1 });
});
