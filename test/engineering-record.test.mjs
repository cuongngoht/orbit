import assert from "node:assert/strict";
import { test } from "node:test";
import { judge, parseCandidates, trackedSet } from "../src/engineering/record.mjs";

const FILES = ["AGENTS.md", "src/Application/IOrderRepository.cs", "src/Infrastructure/OrderRepository.cs", "src/Application/ICustomerRepository.cs"];

const TRACKED = trackedSet(FILES);

const line = (over = {}) =>
  JSON.stringify({ kind: "pattern", key: "repository", statement: "Persistence access goes through repository abstractions", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", confidence: "certain", strength: "observed", ...over });

const of = (opts, ...lines) => judge(parseCandidates(lines.join("\n")), { tracked: TRACKED, stamps: { commit: "abc1234" }, ...opts });

test("the tracked set carries the directories as well as the files", () => {
  assert.ok(TRACKED.has("src/Application/IOrderRepository.cs"));
  assert.ok(TRACKED.has("src/Application"));
  assert.ok(TRACKED.has("src"));
  assert.ok(!TRACKED.has("src/nope"));
});

test("a well-formed observed candidate is accepted as a CANDIDATE — no id, no confidence, no stamp yet", () => {
  const v = of({}, line());
  assert.equal(v.refused, false);
  assert.equal(v.accepted.length, 1);
  for (const k of ["id", "confidence", "commit", "status", "support"]) assert.ok(!(k in v.accepted[0]), `${k} is the engine's to give, at reconciliation`);
  assert.match(v.notes[0], /"confidence" is derived by the engine .* ignored/, "a supplied confidence is dropped out loud, not silently");
});

test("a fact citing a file nothing tracks is refused, and says which file", () => {
  const v = of({}, line({ evidence: ["src/Invented.cs"] }));
  assert.equal(v.refused, true);
  assert.match(v.rejected[0].why, /evidence "src\/Invented.cs" is not tracked here/);
  assert.deepEqual(v.accepted, []);
});

test("a scope matching no tracked file is refused too", () => {
  assert.match(of({}, line({ scope: ["src/Imaginary"] })).rejected[0].why, /scope "src\/Imaginary" matches no tracked file/);
});

// The guard architecture's own record.mjs has no counterpart for.
test("an observer's candidate may not claim enforced or adopted", () => {
  const v = of({}, line({ strength: "enforced" }));
  assert.equal(v.refused, true);
  assert.match(v.rejected[0].why, /strength "enforced" may not be claimed by a candidate/);
  assert.match(of({}, line({ strength: "adopted" })).rejected[0].why, /strength "adopted" may not be claimed/);
});

test("a trusted (--human) record may claim adopted, but enforced needs a gate the engine can see", () => {
  assert.equal(of({ trusted: true }, line({ strength: "adopted" })).refused, false);
  assert.match(of({ trusted: true }, line({ strength: "enforced" })).rejected[0].why, /needs enforcedBy/, "a person saying so buys adopted, not enforced");
  const gated = { trusted: true, gates: new Set(["AGENTS.md"]) };
  assert.equal(of(gated, line({ strength: "enforced", enforcedBy: ["AGENTS.md"] })).refused, false);
});

test("observed and suggested need no --human", () => {
  assert.equal(of({}, line({ strength: "suggested" })).refused, false);
  assert.equal(of({}, line({ strength: "observed" })).refused, false);
});

test("one bad candidate refuses the whole batch, and every rejection is listed", () => {
  const v = of({}, line(), line({ key: "second", evidence: ["nope.cs"] }), line({ key: "third", scope: ["also/nope"] }));
  assert.equal(v.refused, true);
  assert.equal(v.rejected.length, 2, "both rejections are reported, not just the first");
  assert.deepEqual(v.accepted, []);
  assert.deepEqual(v.rejected.map((r) => r.i), [1, 2], "each names its own line");
});

test("a line that is not JSON is a rejection with its line number, not a crash", () => {
  const v = of({}, line(), "{ truncated");
  assert.equal(v.refused, true);
  assert.match(v.rejected[0].why, /line 2: not valid JSON/);
});

test("the field table still applies to a recorded candidate", () => {
  assert.match(of({}, line({ strength: "mandatory" })).rejected[0].why, /strength must be/);
  assert.match(of({}, line({ kind: "convention", appliesWhen: ["x"] })).rejected[0].why, /appliesWhen belongs to a pattern fact/);
});
