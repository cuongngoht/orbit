// The ordered tables a mission is judged by, each asked directly at its boundary: a work graph's depth limit, what a
// consumer may rely on in a handoff, when a run's evidence reaches its contract, and when a mission is VERIFIED.
import assert from "node:assert/strict";
import { test } from "node:test";
import { verdictOf } from "../src/evidence/verdict.mjs";
import { consumeFinding, handoffDigest } from "../src/handoff/handoff.mjs";
import { outcomeOf } from "../src/mission/conclude.mjs";
import { graphFinding } from "../src/planning/graph.mjs";

// A proposal of `depth + 1` units, each delegated by the one before it: the last nests `depth` deep.
const nested = (depth, maxDepth) => {
  const units = Array.from({ length: depth + 1 }, (_, i) => ({ id: `u${i}`, key: `k${i}`, dependencyIds: [], parentUnit: i ? `u${i - 1}` : undefined }));
  return { m: { units: new Map() }, states: new Map(), limits: { maxDepth, maxUnits: 50, maxAgentRuns: 50 }, spent: { agentRuns: 0 }, units, cancel: [], reset: [] };
};

test("delegation nests at most maxDepth deep: the limit is inclusive, and one deeper is refused", () => {
  assert.equal(graphFinding(nested(2, 2)), null);
  assert.equal(graphFinding(nested(3, 2))?.rule, "PLAN_DEPTH");
});

const handoff = (over = {}) => ((r) => ({ ...r, digest: handoffDigest(r) }))({ id: "hof-1", sourceUnitId: "u1", targetWorkUnitIds: ["u2"], scope: { paths: ["src/app"] }, outputContract: { fields: [] }, findings: [], evidenceRefs: [], artifactPins: [], ...over });
const consumed = (record, over = {}) => consumeFinding({ m: { units: new Map() }, unit: { id: "u2", scope: { paths: ["src/app/a.mjs"] } }, record, tree: null, published: { id: record.id, digest: record.digest, n: 1 }, ...over });

test("a consumer relies only on the very handoff that was published, and only for paths inside its scope", () => {
  assert.equal(consumed(handoff()), null);
  const changed = handoff({ findings: ["rewritten after publishing"] });
  assert.equal(consumed(changed, { published: { id: "hof-1", digest: handoff().digest, n: 1 } })?.rule, "HOF_DIGEST", "digested again after publishing is still not what was published");
  assert.equal(consumed(handoff(), { unit: { id: "u2", scope: { paths: ["src/application/a.mjs"] } } })?.rule, "HOF_SCOPE", "a path that only shares a prefix with a scope root is not inside it");
});

test("a contract that asks for an independent owner is reached only by an independent owner's evidence", () => {
  const unit = { id: "u1", verificationContract: { min: "VERIFIED", owner: "independent" } };
  assert.equal(outcomeOf({ state: "reported", unit, rows: [{ owner: "task", level: "VERIFIED", independent: false }] }), "insufficient");
  assert.equal(outcomeOf({ state: "reported", unit, rows: [{ owner: "task", level: "VERIFIED", independent: true }] }), "succeeded");
});

test("a mission that recorded no acceptance criterion is never VERIFIED", () => {
  const m = { intent: { acceptanceCriteria: [] }, evidence: new Map(), runs: new Map(), units: new Map(), actions: new Map() };
  assert.deepEqual([verdictOf(m, true).verdict, verdictOf(m, false).verdict], ["NOT_VERIFIED", "PENDING"]);
});
