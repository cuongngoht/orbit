import assert from "node:assert/strict";
import { test } from "node:test";
import { CANDIDATE_REQUIRED, candidateFindings, candidateOf, ignoredNotes } from "../src/engineering/candidate.mjs";
import { STAMPED } from "../src/engineering/fields.mjs";
import { factId } from "../src/engineering/model.mjs";
import { KINDS, STRENGTH } from "../src/engineering/vocab.mjs";

const raw = (over = {}) => ({ kind: "pattern", key: "repository", statement: "Persistence access goes through repository abstractions", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", strength: "observed", ...over });

const says = (c, world = {}) => candidateFindings(c, "line 1", world).join(" · ");

test("a candidate owes everything a fact does except confidence, which the engine derives", () => {
  assert.ok(!CANDIDATE_REQUIRED.includes("confidence"));
  assert.equal(says(raw()), "", "a complete observed candidate is clean without a confidence");
});

// One row per engine-owned field, asserted from the declaration itself -- a
// field added to STAMPED later is covered without anybody extending this test.
test("a candidate cannot claim any field the engine owns", () => {
  for (const k of STAMPED) assert.match(says(raw({ [k]: k === "support" ? { sessions: 9 } : "x" })), new RegExp(`"${k}" is stamped`), `${k} must be refused`);
});

test("a supplied confidence is ignored out loud and never reaches reconciliation", () => {
  const c = raw({ confidence: "certain" });
  assert.equal(says(c), "", "ignored, so it does not refuse the batch");
  assert.ok(!("confidence" in candidateOf(c)));
  assert.match(ignoredNotes(c, "line 1")[0], /derived by the engine/);
});

test("a key is a slug: prose cannot become an id", () => {
  assert.match(says(raw({ key: "Repository Pattern!" })), /key does not look like/);
});

test("an invariant is only ever enforced — read off the kind row, not a hand-written rule", () => {
  const onlyEnforced = KINDS.filter((k) => k.onlyStrength).map((k) => k.name);
  assert.deepEqual(onlyEnforced, ["invariant"]);
  assert.match(says(raw({ kind: "invariant", key: "no-raw-sql" }), { trusted: true }), /only ever enforced/);
});

test("an observer may suggest or observe, never adopt or enforce", () => {
  assert.equal(says(raw({ strength: "suggested" })), "");
  assert.match(says(raw({ strength: "adopted" })), /may not be claimed by a candidate/);
  assert.match(says(raw({ strength: "enforced", enforcedBy: ["ci.yml"] }), { gates: new Set(["ci.yml"]) }), /may not be claimed by a candidate/, "even with a real gate, an observer may not enforce on its own");
});

test("a person may adopt; enforced needs machine evidence as well", () => {
  assert.equal(says(raw({ strength: "adopted" }), { trusted: true }), "");
  assert.match(says(raw({ strength: "enforced" }), { trusted: true }), /needs enforcedBy/);
  assert.match(says(raw({ strength: "enforced", enforcedBy: ["notes.md"] }), { trusted: true, gates: new Set(["ci.yml"]) }), /"notes.md" is not a gate/);
  assert.equal(says(raw({ strength: "enforced", enforcedBy: ["ci.yml"] }), { trusted: true, gates: new Set(["ci.yml"]) }), "");
  assert.equal(says(raw({ strength: "enforced", source: "test-suite", enforcedBy: ["test/x.test.mjs"] }), { trusted: true }), "", "a test the source names is its own gate");
});

test("only the strength that needs a gate declares it", () => {
  assert.deepEqual(STRENGTH.filter((s) => s.needsGate).map((s) => s.name), ["enforced"]);
});

test("somebody's word cannot be recorded as an observation of the code", () => {
  assert.match(says(raw({ source: "human-declared-memory" }), { trusted: true }), /may be adopted or suggested, not observed/);
  assert.match(says(raw({ source: "claude-memory", strength: "adopted" }), { trusted: true }), /may be observed or suggested, not adopted/);
});

test("a contradiction names this candidate's own subject, never some other fact", () => {
  assert.equal(says(raw({ contradicts: factId(raw()) })), "");
  assert.match(says(raw({ contradicts: "eng-invariant-deadbeef" })), /contradicts must name this candidate's own fact/);
  assert.match(says(raw({ contradicts: true })), /contradicts must be a string/);
});
