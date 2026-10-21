// What an assessment may conclude about a control (ADR 0040; doc §7): a refusal proves nothing
// while the positive control beside it is broken; a leak -- an access or a field the refused actor
// must not reach -- is a finding, CONFIRMED only when every condition holds and SUSPECTED with what
// is missing otherwise; reported evidence is never proof; a control only design evidence can settle
// is not-tested; and nothing an assessment says is a certification or a severity score.
import assert from "node:assert/strict";
import { test } from "node:test";
import { VERIFICATION_OUTCOME_IDS } from "../src/investigation/verification.mjs";
import { FINDING, OBLIGATION_STATE_IDS, PAIRING, assessmentOf, obligationsInEffect } from "../src/qa/security/assessment.mjs";
import { CATALOG_API, catalogDigest, effectiveCatalogs, layerOf } from "../src/qa/security/catalog.mjs";

const DOC = {
  apiVersion: CATALOG_API,
  catalog: "team-policy",
  title: "A team's policy",
  version: "3",
  labels: { owasp: { title: "categories", items: { A01: { title: "Broken Access Control" } } } },
  controls: [
    { id: "read-own", summary: "Only the owner reads its record.", methods: ["runtime-test"], minimumEvidence: ["positive", "negative"], applies: { all: [{ role: "interface" }, { relation: "permission" }] }, shapes: ["permission-enforced"], labels: ["owasp:A01"] },
    { id: "documented", summary: "Access rules are written down.", methods: ["design-review"], applies: { role: "interface" } },
    { id: "schedules", summary: "Schedules are owned.", methods: ["runtime-test"], applies: { role: "schedule" }, shapes: ["occurrence-one-execution"] },
  ],
};

const layers = layerOf([{ doc: DOC, from: "team-policy.json" }], "adopted");
const effective = effectiveCatalogs({ ...layers, refused: [] }, { enabled: [{ catalog: "team-policy", digest: catalogDigest(DOC) }] });
const GRAPH = { nodes: [{ id: "records-api", role: "interface" }, { id: "owner", role: "principal" }], relations: [{ id: "owner-may-read", role: "permission", from: "owner", to: "records-api" }], complete: true };

// A result as QA's verification would hand it in, read back from its owner, every condition holding.
const result = (role, outcome, over = {}) => ({ catalog: "team-policy", control: "read-own", role, outcome, fresh: true, authority: "accepted", target: "records-api", testValid: true, identityValid: true, fixtureValid: true, readBack: "rcp-readback-1", source: "owner", evidenceRefs: [`ev-${role}`], ...over });

const conclude = (results) => assessmentOf({ effective, graph: GRAPH, results, scopeDigest: "g" });
const row = (snapshot, control = "read-own") => snapshot.controls.find((c) => c.control === control);

test("the outcome words an assessment reads are verification outcomes the engine emits", () => {
  for (const word of ["SATISFIED", "CONTRADICTED", "INCONCLUSIVE"]) assert.ok(VERIFICATION_OUTCOME_IDS.includes(word), word);
  assert.deepEqual(OBLIGATION_STATE_IDS, ["generated", "executable", "executed", "verified"]);
  assert.equal(PAIRING.at(-1).when({}), true, "the last row always matches");
});

test("a positive control that failed beside a refusal makes the refusal prove nothing: INCONCLUSIVE", () => {
  const r = row(conclude([result("positive", "CONTRADICTED"), result("negative", "SATISFIED")]));
  assert.deepEqual([r.conclusion, r.rule], ["inconclusive", "POSITIVE_BROKEN"]);
  assert.match(r.why, /every refusal beside it proves nothing/);
});

test("a leak is a finding, CONFIRMED when every condition holds -- with impact, preconditions, confidence, reproducibility and scope, and no score", () => {
  const s = conclude([result("positive", "SATISFIED"), result("negative", "CONTRADICTED", { leak: { kind: "access", ref: "obs-1" }, reproducibility: "2 of 2 attempts on the same pinned inputs" })]);
  const f = row(s).finding;
  assert.deepEqual([row(s).conclusion, f.status, f.confidence], ["finding", "confirmed", "high"]);
  assert.equal(f.impact, "an actor reached a resource its permission does not allow");
  assert.deepEqual(f.scope, { target: "records-api", boundary: "synchronous" });
  assert.equal(f.reproducibility, "2 of 2 attempts on the same pinned inputs");
  assert.deepEqual(f.labels, ["owasp:A01"]);
  assert.deepEqual(s.findings.map((x) => x.id), [f.id]);
  assert.equal(JSON.stringify(s).match(/"(severity|score|cvss)"/i), null, "a severity is a person's call, never a number here");
});

test("a field leak is a finding too; one missing condition makes it SUSPECTED, saying what is missing", () => {
  const s = conclude([result("positive", "SATISFIED"), result("negative", "CONTRADICTED", { leak: { kind: "field", ref: "email" }, readBack: null })]);
  const f = row(s).finding;
  assert.deepEqual([f.status, f.confidence, f.impact], ["suspected", "low", "an answer carried a field its caller is not allowed to see"]);
  assert.deepEqual(f.needs, [FINDING.find((c) => c.id === "READ_BACK").needs]);
});

test("a leak beside a broken positive control is still kept -- as SUSPECTED, never dropped and never confirmed", () => {
  const f = row(conclude([result("positive", "CONTRADICTED"), result("negative", "CONTRADICTED", { leak: { kind: "access" } })])).finding;
  assert.equal(f.status, "suspected");
  assert.ok(f.needs.includes(FINDING.find((c) => c.id === "CONTROLS").needs));
});

test("evidence somebody REPORTED is shown and never proof: it verifies nothing and confirms no finding", () => {
  const reported = (r) => ({ ...r, source: "reported" });
  assert.equal(row(conclude([reported(result("positive", "SATISFIED")), reported(result("negative", "SATISFIED"))])).conclusion, "pending");
  const f = row(conclude([result("positive", "SATISFIED"), reported(result("negative", "CONTRADICTED", { leak: { kind: "access" } }))])).finding;
  assert.equal(f.status, "suspected");
  assert.ok(f.needs.some((n) => /owner's record/.test(n)));
});

test("verified needs every piece of minimum evidence satisfied on a fresh, accepted oracle -- a stale one leaves it owed", () => {
  const ok = row(conclude([result("positive", "SATISFIED"), result("negative", "SATISFIED")]));
  assert.deepEqual([ok.conclusion, ok.obligationState], ["verified", "verified"]);
  const stale = row(conclude([result("positive", "SATISFIED"), result("negative", "SATISFIED", { fresh: false })]));
  assert.deepEqual([stale.conclusion, stale.obligationState], ["pending", "executed"]);
  assert.match(stale.why, /still owes the negative control/);
  assert.equal(row(conclude([])).obligationState, "generated");
  assert.equal(row(conclude([{ ...result("positive", null), outcome: null, executable: true }])).obligationState, "executable");
});

test("what only design evidence settles is not-tested, what does not apply says so, and nothing is called compliant", () => {
  const s = conclude([]);
  assert.deepEqual([row(s, "documented").conclusion, row(s, "documented").obligationState], ["not-tested", null]);
  assert.match(row(s, "schedules").why, /complete for its scope, holds no role schedule/);
  assert.equal(row(s, "schedules").conclusion, "not-applicable");
  assert.deepEqual(s.catalogs, [{ catalog: "team-policy", version: "3", digest: catalogDigest(DOC) }], "it pins the catalog it used");
  assert.doesNotMatch(JSON.stringify(s), /complian/i);
  assert.match(s.id, /^asm-[0-9a-f]{16}$/);
  assert.equal(conclude([]).id, s.id, "the same inputs are the same snapshot");
});

test("the security obligations an applicable control owes: shape, boundary, controls and templates, for QA to design from", () => {
  const owed = obligationsInEffect({ effective, graph: GRAPH });
  assert.deepEqual(owed.map((o) => [o.control, o.shape, o.boundary, o.controls, o.method]), [["read-own", "permission-enforced", "synchronous", ["positive", "negative"], "runtime-test"]]);
  assert.deepEqual(owed[0].templates, ["value-eq", "value-excludes"]);
  assert.match(owed[0].id, /^tob-[0-9a-f]{16}$/);
  assert.equal(owed[0].digest, catalogDigest(DOC), "an obligation names the catalog revision it was derived from");
});
