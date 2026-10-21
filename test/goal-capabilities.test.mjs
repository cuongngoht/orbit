// A capability a goal's analysis names goes to the work kind a TABLE assigns it (src/goal/vocab.mjs
// KIND_CAPABILITIES): a standalone reverse-engineering pass is asked for by its capability word on
// the analyze unit, in any language, and never by a pattern over the goal's text. A capability no
// row assigns still goes to the procedure that names its own, and a procedure left with none is
// unresolved, exactly as before.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAnalysis } from "../src/goal/analyze.mjs";
import { planUnits } from "../src/goal/plan.mjs";
import { KIND_CAPABILITIES, capabilitiesOfKind, workKindOf } from "../src/goal/vocab.mjs";

const DIGEST = "c".repeat(64);

const analysis = (intent) => validateAnalysis({ objective: "Map how the billing parts talk, then make a release check.", intent: { category: "investigation", verification: [], dependencies: [], missing: [], ...intent }, requirements: [{ statement: "The map covers every billing component", sourceRef: `spec@${DIGEST}#L1` }], acceptance: [{ statement: "Every component is in the map", sourceRef: `spec@${DIGEST}#L2` }], unknowns: [], conflicts: [] }, DIGEST);

const capsByKind = (units) => Object.fromEntries(units.map((u) => [u.kind, u.capabilities]));

test("every capability the table assigns names a work kind that exists", () => {
  for (const row of KIND_CAPABILITIES) assert.ok(workKindOf(row.kind), `${row.capability} → ${row.kind}`);
  assert.ok(KIND_CAPABILITIES.some((r) => r.capability === "architecture.reverse" && r.kind === "analyze"));
});

test("architecture.reverse rides on the analyze unit, and a procedure keeps only the capabilities no row assigns", () => {
  const units = planUnits(analysis({ workKinds: ["analyze", "procedure"], capabilities: ["architecture.reverse", "release.quality.verification"] }), DIGEST);
  assert.deepEqual(capsByKind(units), { analyze: ["architecture.reverse"], procedure: ["release.quality.verification"] });
  assert.equal(units.every((u) => u.state !== "unresolved"), true);
});

test("a procedure left with only capabilities another kind takes is unresolved, never started on a guess", () => {
  const units = planUnits(analysis({ workKinds: ["analyze", "procedure"], capabilities: ["architecture.reverse"] }), DIGEST);
  const procedure = units.find((u) => u.kind === "procedure");
  assert.equal(procedure.state, "unresolved");
  assert.match(procedure.because, /names the capability it provides, and the analysis names none/);
});

test("a kind that names no capability of its own takes only what the table gives it", () => {
  const verify = workKindOf("verify");
  assert.deepEqual(capabilitiesOfKind(verify, ["architecture.reverse", "release.quality.verification"]), []);
  assert.deepEqual(capabilitiesOfKind(workKindOf("analyze"), ["release.quality.verification"]), []);
});
