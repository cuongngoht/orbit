// A claim's identity, its context, and the contract a candidate is held to.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applies, merged, narrower, parseContext, unmet } from "../src/knowledge/applies.mjs";
import { candidateFindings } from "../src/knowledge/candidate.mjs";
import { canonical, claimFindings, claimId, isReference, makeClaim, said, watched } from "../src/knowledge/model.mjs";
import { judge, parseCandidates } from "../src/knowledge/record.mjs";
import { trackedSet } from "../src/engineering/record.mjs";
import { candidate } from "./fakes/knowledge.mjs";

test("identity is the triple AND the context, in canonical order -- two contexts are two claims, one context typed two ways is one", () => {
  const a = claimId(candidate({ context: { zone: "a", tier: "x" } }));
  assert.equal(a, claimId(candidate({ context: { tier: "x", zone: "a" } })));
  assert.notEqual(a, claimId(candidate({ context: { zone: "b", tier: "x" } })));
  assert.notEqual(claimId(candidate()), claimId(candidate({ object: "group.removed" })));
  assert.deepEqual(Object.keys(canonical({ z: "1", a: "2" })), ["a", "z"]);
});

test("the one constructor stamps and derives the id, whatever a caller wrote into it", () => {
  const made = makeClaim({ ...candidate(), id: "k-000000000000", confidence: "possible" }, { now: () => "2026-09-24T00:00:00.000Z", status: "fresh" });
  assert.equal(made.id, claimId(candidate()));
  assert.deepEqual([made.v, made.layer, made.status, made.at], [1, "project", "fresh", "2026-09-24T00:00:00.000Z"]);
});

test("there is no stored statement: a reader sees the triple, and a global claim SAYS it holds everywhere", () => {
  assert.equal(said(candidate()), "workspace.create results-in group.created (everywhere)");
  assert.equal(said(candidate({ context: { component: "api" } })), "workspace.create results-in group.created when component=api");
});

test("context matching is structural: excluded · holds · conditional, and specificity is nesting only", () => {
  assert.equal(applies({ zone: "a" }, { zone: "b" }), "excluded");
  assert.equal(applies({ zone: "a" }, { zone: "a", tier: "x" }), "holds");
  assert.equal(applies({}, { zone: "a" }), "holds", "a claim with no context holds everywhere");
  assert.equal(applies({ zone: "a" }, {}), "conditional");
  assert.deepEqual(unmet({ zone: "a", tier: "x" }, { tier: "x" }), ["zone"]);
  assert.equal(narrower({ zone: "a", tier: "x" }, { zone: "a" }), true);
  assert.equal(narrower({ zone: "a", tier: "x" }, { zone: "b" }), false, "more dimensions is not narrower when one differs");
  assert.equal(narrower({ a: "1" }, { b: "1" }), false);
  assert.deepEqual([merged({ a: "1" }, { b: "2" }), merged({ a: "1" }, { a: "2" })], [{ a: "1", b: "2" }, null]);
});

test("--context parses dimension=value pairs and refuses anything that is not a slug", () => {
  assert.deepEqual(parseContext("zone=a, tier=x").context, { zone: "a", tier: "x" });
  assert.equal(parseContext("Zone=A").findings.length, 1);
  assert.equal(parseContext("nokey").findings.length, 1);
});

test("a claim's paths never leave the checkout and never carry a credential; a scheme reference is the engine's own", () => {
  const bad = claimFindings({ ...makeClaim(candidate()), evidence: ["/etc/passwd", "../outside", "https://user:pw@x.example/"] });
  assert.equal(bad.filter((f) => /repo-relative/.test(f)).length, 3);
  assert.deepEqual([isReference("host:claude#abc"), isReference("worker::src/a.ts"), isReference("C:\\x")], [true, false, false]);
  assert.deepEqual(watched({ evidence: ["src/a.ts", "host:x#1"], enforcedBy: ["test/gate.mjs"] }), ["src/a.ts", "test/gate.mjs"]);
});

test("a context holds at most six slug dimensions, and an identity field that looks like a secret is refused, never masked", () => {
  const seven = Object.fromEntries("abcdefg".split("").map((k) => [k, "v"]));
  assert.match(claimFindings(makeClaim(candidate({ context: seven }))).join("\n"), /at most 6/);
  const hex = "a".repeat(40);
  assert.match(claimFindings(makeClaim(candidate({ object: hex }))).join("\n"), /looks like a secret/);
});

test("a candidate may not stamp what the engine owns, claim a person's strength, or come from a host's memory", () => {
  const at = "line 1";
  assert.match(candidateFindings({ ...candidate(), confidence: "certain" }, at).join(), /stamped by the engine/);
  assert.match(candidateFindings(candidate({ strength: "adopted" }), at).join(), /only an explicit --human record/);
  assert.equal(candidateFindings(candidate({ strength: "adopted", source: "human-declared-memory" }), at, { trusted: true }).length, 0);
  assert.match(candidateFindings(candidate({ strength: "enforced" }), at, { trusted: true }).join(), /needs enforcedBy/);
  assert.match(candidateFindings(candidate({ source: "host-memory" }), at).join(), /never recorded/);
  assert.match(candidateFindings(candidate({ layer: "organization" }), at).join(), /never recorded into a project/);
  assert.match(candidateFindings({ ...candidate(), contradicts: "k-000000000000" }, at).join(), /own claim/);
});

test("a batch is all or nothing, and every cited path must be tracked", () => {
  const world = { tracked: trackedSet(["src/app/workspace.ts"]), gates: new Set(), trusted: false };
  const good = JSON.stringify(candidate());
  const bad = JSON.stringify(candidate({ evidence: ["src/nowhere.ts"] }));
  assert.equal(judge(parseCandidates(`${good}\n${good}`), world).accepted.length, 2);
  const mixed = judge(parseCandidates(`${good}\n${bad}`), world);
  assert.deepEqual([mixed.refused, mixed.accepted.length, mixed.rejected.length], [true, 0, 1]);
  assert.match(mixed.rejected[0].why, /not tracked here/);
});
