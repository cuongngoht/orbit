// THE TABLES AGREE WITH EACH OTHER: every action, under every way its plan can resolve, derives a mode, an operation
// kind and a profile that the policy table accepts together -- so a refusal is only ever a real policy decision,
// never two of this engine's own tables disagreeing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UNIT_KINDS } from "../src/execution/unit-kinds.mjs";
import { ACTIONS } from "../src/mission/actions.mjs";
import { evaluate } from "../src/permissions/evaluate.mjs";
import { OPERATION_NAMES } from "../src/permissions/operations.mjs";

const PLANS = {
  "resolve-role": ["REUSE", "REUSE_STARTER", "COMPOSE", "GENERATE", "REJECT"].map((word) => ({ word, findings: [] })),
  "resolve-template": ["REUSE", "GENERATE", "REJECT"].map((word) => ({ word, findings: [] })),
  "resolve-skill": ["REUSE", "WRAP", "GENERATE", "BLOCKED"].map((word) => ({ word })),
  "resolve-workflow": ["REUSE", "GENERATE", "REJECT"].map((word) => ({ word, findings: [] })),
  dispatch: Object.keys(UNIT_KINDS).map((kind) => ({ kind: UNIT_KINDS[kind], role: { content: { requestedPermissionProfile: UNIT_KINDS[kind].profile } } })),
};

const ASKED = { recall: [{ via: "context" }, { via: "knowledge" }] };

const STRUCTURAL = ["UNKNOWN_KIND", "UNKNOWN_MODE", "UNKNOWN_PROFILE", "WRITE_IN_READ_MODE", "MODE_FORBIDS", "PROFILE_MODE", "PROFILE_FORBIDS", "OWNER_REQUIRED"];

test("every action, under every plan it can come to, derives a mode, operation and profile the policy accepts together", () => {
  for (const [kind, row] of Object.entries(ACTIONS)) for (const plan of PLANS[kind] ?? [{}]) for (const a of ASKED[kind] ?? [{}]) {
    const c = { profile: row.profile(plan, a), operationKind: row.operation(plan, a), mode: row.mode(plan, a), provider: row.provider(plan, a), grants: OPERATION_NAMES };
    const v = evaluate(c);
    assert.ok(!STRUCTURAL.includes(v.rule), `${kind} ${plan.word ?? plan.kind?.mode ?? ""}: ${v.rule} -- ${v.say}`);
  }
});

import { KINDS } from "../src/mission/vocab.mjs";

// `kind` and `at` are the journal's own words on every line, and `n` is the fold's word for where a line sits: a line
// that declared one would have it overwritten.
test("no journal kind declares a field the journal or the fold writes itself", () => {
  for (const [kind, row] of Object.entries(KINDS)) for (const reserved of ["kind", "at", "n"]) assert.equal(row.fields.includes(reserved), false, `${kind} declares ${reserved}`);
});
