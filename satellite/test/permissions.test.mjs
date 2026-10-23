// PERMISSIONS, as a whole matrix: every profile × operation kind × mode is judged by one table, and the answers that
// matter are held here by hand -- a write never rides a reading mode or a READ_ONLY profile, a source patch happens
// only through an engineering task, ORCHESTRATOR is never a role's, and grants only ever narrow.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MODES } from "../src/execution/modes.mjs";
import { evaluate } from "../src/permissions/evaluate.mjs";
import { effectiveGrants } from "../src/permissions/grants.mjs";
import { OPERATION_KINDS, OPERATION_NAMES } from "../src/permissions/operations.mjs";
import { PROFILE_IDS, REQUESTABLE } from "../src/permissions/profiles.mjs";

const ALL = OPERATION_NAMES;

const judged = (profile, operationKind, mode, provider = "host-agent") => evaluate({ profile, operationKind, mode, provider, grants: ALL });

const CASES = [
  ["READ_ONLY", "repository.read", "EXPLORING", "host-agent", "allow", "ALLOW"],
  ["READ_ONLY", "repository.read", "REVIEWING", "host-agent", "allow", "ALLOW"],
  ["IMPLEMENT", "repository.read", "IMPLEMENTING", "engineering", "allow", "ALLOW"],
  ["IMPLEMENT", "source.patch", "IMPLEMENTING", "engineering", "allow", "ALLOW"],
  ["VERIFY", "check.run", "TESTING", "engineering", "allow", "ALLOW"],
  ["ORCHESTRATOR", "schema.validate", "SKILL_VALIDATING", "engine", "allow", "ALLOW"],
  ["IMPLEMENT", "source.patch", "EXPLORING", "engineering", "deny", "WRITE_IN_READ_MODE"],
  ["IMPLEMENT", "source.patch", "REVIEWING", "engineering", "deny", "WRITE_IN_READ_MODE"],
  ["READ_ONLY", "source.patch", "IMPLEMENTING", "engineering", "deny", "WRITE_ON_READ_PROFILE"],
  ["IMPLEMENT", "source.patch", "IMPLEMENTING", "host-agent", "deny", "OWNER_REQUIRED"],
  ["DESIGN", "check.run", "BUILDING", "engineering", "deny", "PROFILE_MODE"],
  ["READ_ONLY", "artifact.publish", "HANDOFF", "engine", "deny", "WRITE_ON_READ_PROFILE"],
  ["VERIFY", "definition.register", "ROLE_GENERATING", "engine", "deny", "PROFILE_MODE"],
  ["READ_ONLY", "shell.run", "EXPLORING", "host-agent", "deny", "UNKNOWN_KIND"],
];

test("the decisions that matter, by hand", () => {
  for (const [profile, kind, mode, provider, verdict, rule] of CASES) assert.deepEqual([judged(profile, kind, mode, provider).verdict, judged(profile, kind, mode, provider).rule], [verdict, rule], `${profile} ${kind} ${mode} ${provider}`);
});

test("across the whole matrix, no write is ever allowed in a reading mode or under READ_ONLY", () => {
  for (const profile of PROFILE_IDS) for (const kind of ALL) for (const mode of Object.keys(MODES)) {
    const v = judged(profile, kind, mode, OPERATION_KINDS[kind].owners?.[0] ?? "engine");
    if (OPERATION_KINDS[kind].effect !== "read" && (MODES[mode].reads || profile === "READ_ONLY")) assert.equal(v.verdict, "deny", `${profile} ${kind} ${mode}`);
  }
});

test("ORCHESTRATOR is the engine's own: no role may request it", () => {
  assert.equal(REQUESTABLE.includes("ORCHESTRATOR"), false);
  assert.deepEqual(REQUESTABLE, ["READ_ONLY", "DESIGN", "IMPLEMENT", "VERIFY"]);
});

test("grants only narrow: a parent's grants and a spent budget each take away, and each says by whom", () => {
  const full = effectiveGrants({ profile: "IMPLEMENT", mode: "IMPLEMENTING", values: {}, spent: { actions: 0 }, budget: { actions: 10 } });
  const child = effectiveGrants({ profile: "IMPLEMENT", mode: "IMPLEMENTING", values: {}, spent: { actions: 0 }, budget: { actions: 10 }, parentGrants: ["repository.read"] });
  const spent = effectiveGrants({ profile: "IMPLEMENT", mode: "IMPLEMENTING", values: {}, spent: { actions: 10 }, budget: { actions: 10 } });
  assert.deepEqual([full.operationKinds, child.operationKinds, spent.operationKinds], [["repository.read", "source.patch"], ["repository.read"], []]);
  assert.equal(child.withheld.find((w) => w.kind === "source.patch").by, "parent-run");
});
