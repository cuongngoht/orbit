// The Security Auditor's evidence READ BACK from its owner (doc §7; ADR 0040): what an investigation's generated tests
// came to, placed on the control roles their designs ran -- a positive control that did not hold is that role's
// contradiction and leaves the rest inconclusive, a refusal that did not hold is a leak, and nothing is re-judged.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resultsFromInvestigation } from "../skills/orbit-security-audit/evidence.mjs";

const DESIGN = { controls: [{ role: "positive", identityRef: "tenant-a-reader" }, { role: "negative", identityRef: "tenant-b-reader" }] };
const CASE = { id: "gen-perm", steps: [{ input: { identityRef: "tenant-a-reader" } }, { input: { identityRef: "tenant-b-reader" } }] };

function owner(outcome, cause, failedStep) {
  const root = mkdtempSync(join(tmpdir(), "orbit-sec-evidence-"));
  mkdirSync(join(root, "ev"), { recursive: true });
  writeFileSync(join(root, "ev", "run-log.jsonl"), failedStep ? `${JSON.stringify({ kind: "step", i: failedStep, ok: false })}\n` : "");
  const model = {
    obligations: [{ obligation: "tob-perm", shape: "permission-enforced", target: "endpoint:invoice-read", bindings: ["bnd-1"], authority: "accepted", applicability: { state: "applicable" } }],
    bindings: [{ binding: "bnd-1", state: "fresh" }],
    designs: [{ design: "tds-1", digest: "d1", state: "designed" }],
    versions: [{ version: "gen-perm@0123456789abcdef", design: "tds-1", case: "gen-perm" }],
    validations: [{ version: "gen-perm@0123456789abcdef", state: "valid" }],
    preparations: [{ version: "gen-perm@0123456789abcdef", state: "prepared" }],
    runs: [{ id: "run-1", execution: "exe-1", version: "gen-perm@0123456789abcdef", evidence: "ev" }],
    evaluations: [{ id: "evl-1", obligation: "tob-perm", execution: "exe-1", outcome, cause }],
  };
  const input = { model, readArtifact: () => DESIGN, readVersion: () => ({ case: CASE }), storeRoot: root, tenancy: { identities: { "tenant-a-reader": ["A"], "tenant-b-reader": ["B"] } }, controls: [{ catalog: "asvs-5.0.0-l1", control: "v5.0.0-8.2.1", shapes: ["permission-enforced"] }, { catalog: "asvs-5.0.0-l1", control: "v5.0.0-15.3.1", shapes: ["fields-restricted"] }] };
  return { results: resultsFromInvestigation(input), done: () => rmSync(root, { recursive: true, force: true }) };
}

const roles = (results) => Object.fromEntries(results.map((r) => [r.role, r.outcome]));

test("a run that held is every role's, on the controls whose shapes it served -- and only those", () => {
  const o = owner("SATISFIED", "MET");
  assert.deepEqual(roles(o.results), { positive: "SATISFIED", negative: "SATISFIED" });
  assert.deepEqual([...new Set(o.results.map((r) => r.control))], ["v5.0.0-8.2.1"]);
  const r = o.results[0];
  assert.deepEqual([r.fresh, r.authority, r.target, r.testValid, r.identityValid, r.fixtureValid, r.readBack], [true, "accepted", "endpoint:invoice-read", true, true, true, "evl-1"]);
  o.done();
});

test("a refusal that did not hold is the negative role's contradiction, a leak, with the positive beside it held", () => {
  const o = owner("CONTRADICTED", "CONTRADICTED", 2);
  assert.deepEqual(roles(o.results), { positive: "SATISFIED", negative: "CONTRADICTED" });
  assert.deepEqual(o.results.find((r) => r.role === "negative").leak, { kind: "access" });
  o.done();
});

test("a positive control that did not hold is that role's contradiction, and leaves the refusal beside it inconclusive", () => {
  const o = owner("INCONCLUSIVE", "POSITIVE_CONTROL", 1);
  assert.deepEqual(roles(o.results), { positive: "CONTRADICTED", negative: "INCONCLUSIVE" });
  assert.equal(o.results.some((r) => r.leak), false);
  o.done();
});
