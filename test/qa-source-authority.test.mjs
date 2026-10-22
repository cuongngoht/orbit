// Where an obligation's authority comes from (ADR 0031): the owner's own answer, at the pinned
// revision -- implementation, memory and drafts never become an oracle, and the word is the
// table's, never the sender's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTHORITY, authorityOf, confirms, weakestOf } from "../src/qa/obligations/authority.mjs";
import { proposalFindings } from "../src/qa/obligations/validate.mjs";

const bound = { revision: "r2", digest: "d2" };
const accepted = { found: true, revision: "r2", digest: "d2", authority: "accepted", acceptanceRef: "sources:accept:1", bearing: true };

test("every row is reachable, in order, and the last always matches", () => {
  const cases = [
    ["unknown", bound, { found: false }],
    ["stale", bound, { ...accepted, revision: "r3" }],
    ["anomaly", bound, { ...accepted, digest: "other" }],
    ["conflict", bound, { ...accepted, conflicts: ["api-contract:2"] }],
    ["implementation", bound, { ...accepted, bearing: false }],
    ["hint", bound, { ...accepted, hint: true }],
    ["draft", bound, { ...accepted, authority: "draft" }],
    ["draft", bound, { ...accepted, acceptanceRef: null }],
    ["accepted", bound, accepted],
  ];
  for (const [want, b, a] of cases) assert.equal(authorityOf(b, a).id, want, JSON.stringify(a));
  assert.equal(AUTHORITY.at(-1).when({}, {}), true);
});

test("only an accepted source confirms anything; code, a commit, the graph and a memory never do", () => {
  assert.deepEqual(AUTHORITY.filter((r) => r.confirms).map((r) => r.id), ["accepted"]);
  assert.equal(confirms(authorityOf(bound, { ...accepted, bearing: false }).id), false);
  assert.equal(confirms(authorityOf(bound, { ...accepted, hint: true }).id), false);
});

test("an obligation stands at its weakest binding, and no binding at all is unknown -- never accepted", () => {
  assert.equal(weakestOf(["accepted", "accepted"]).id, "accepted");
  assert.equal(weakestOf(["accepted", "stale", "draft"]).id, "stale");
  assert.equal(weakestOf(["accepted", "conflict"]).id, "conflict");
  assert.equal(weakestOf([]).id, "unknown");
});

test("a sender cannot say what the authority is: the field is refused by name", () => {
  assert.match(proposalFindings("binding", { type: "criterion", ref: "rs-1:AC1", sourceAuthority: "accepted" }).join(), /sourceAuthority is the engine's to stamp/);
  assert.match(proposalFindings("obligation", { statement: "x", authority: "accepted" }).join(), /authority is the engine's to stamp/);
});
