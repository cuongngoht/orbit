// The sidecars a generated test carries (doc §4.4; ADR 0031, 0032): a host proposes, the engine
// stamps, and a stamped field in a proposal is refused BY NAME -- never silently dropped.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFINITIONS, SIDECAR_KINDS } from "../src/qa/obligations/contract.mjs";
import { artifactFindings, proposalFindings } from "../src/qa/obligations/validate.mjs";
import { OBLIGATION_SHAPES, SHAPE_IDS } from "../src/qa/obligations/shapes.mjs";
import { BOUNDARY_IDS, RELATION_ROLE_IDS } from "../src/topology/vocab.mjs";
import { mergeSemantics } from "../src/adapters/semantics.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMANTICS = mergeSemantics([{ layer: "orbit", from: "catalog", doc: JSON.parse(readFileSync(join(ROOT, "catalog/semantics.json"), "utf8")) }]);

test("every definition stamps only fields its own table declares, and requires only fields it has", () => {
  for (const kind of SIDECAR_KINDS) {
    const d = DEFINITIONS[kind];
    for (const k of d.stamped) assert.ok(k in d.table, `${kind}.${k} is stamped and declared`);
    for (const k of d.required) assert.ok(k in d.table, `${kind}.${k} is required and declared`);
    for (const k of d.aliases ?? []) assert.ok(k in d.table, `${kind}.${k} holds aliases and is declared`);
  }
});

// Iterating STAMPED means a field the engine starts owning tomorrow is refused without a new test.
test("a proposal that carries any field the engine stamps is refused by that field's name", () => {
  for (const kind of SIDECAR_KINDS.filter((k) => DEFINITIONS[k].proposable !== false)) {
    for (const field of DEFINITIONS[kind].stamped) {
      const found = proposalFindings(kind, { [field]: "x" });
      assert.ok(found.some((f) => f.includes(`${field} is the engine's to stamp`)), `${kind}.${field}: ${found.join(" · ")}`);
    }
  }
});

test("a host never proposes a version, an execution, a result, an assessment or a binding record of what was observed", () => {
  for (const kind of ["version", "execution", "result", "assessment", "message", "schedule", "observation", "temporal"]) {
    assert.match(proposalFindings(kind, {}).join(), /is the engine's to write — a host never proposes one/, kind);
  }
});

test("an obligation proposal is walked like a plan: nested members, unknown fields and patterns", () => {
  assert.deepEqual(proposalFindings("obligation", { statement: "one reminder per invoice and occurrence", target: "worker", bindings: ["bnd-abc123"], method: "runtime-test" }), []);
  const found = proposalFindings("design", { obligation: "tob-abcdef", controls: [{ role: "positive", identityRef: "https://example.test/u" }, { role: "spy" }], fixtureRefs: ["tenant-a", "../etc"], trigger: { kind: "schedule", ref: "daily" }, extra: 1 }).join("\n");
  assert.match(found, /unknown field "extra"/);
  assert.match(found, /controls\[1\]: identityRef does not look like/, "an identity is an alias, never a URL");
  assert.match(found, /controls\[2\]: role must be/);
  assert.match(found, /fixtureRefs holds "..\/etc", which is not a logical alias/);
});

test("an artifact the engine wrote is held to the same table when it is read back", () => {
  assert.deepEqual(artifactFindings("result", { id: "res-abc123", execution: "exe-1", verificationOutcome: "SATISFIED", provedBoundary: "state" }), []);
  assert.match(artifactFindings("result", { id: "res-abc123", execution: "exe-1", verificationOutcome: "SATISFIED", provedBoundary: "everything" }).join(), /provedBoundary must be/);
  assert.match(artifactFindings("nonsense", {}).join(), /is not a sidecar this engine knows/);
});

test("every obligation shape names a boundary, graph relation roles and semantics that exist, and controls a verdict can use", () => {
  assert.equal(new Set(SHAPE_IDS).size, SHAPE_IDS.length);
  for (const s of OBLIGATION_SHAPES) {
    assert.ok(BOUNDARY_IDS.includes(s.boundary), `${s.id}: ${s.boundary}`);
    for (const r of s.relations) assert.ok(RELATION_ROLE_IDS.includes(r), `${s.id}: ${r}`);
    for (const f of Object.keys(s.semantics)) assert.ok(SEMANTICS.fields.has(f), `${s.id} needs semantics.${f}`);
    assert.ok(s.controls.length && s.templates.length && s.contract.length, s.id);
  }
  assert.ok(OBLIGATION_SHAPES.filter((s) => s.contractOnly).every((s) => s.family), "a contract-only shape names its family");
});
