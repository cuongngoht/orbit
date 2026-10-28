// What a coordinated workflow may do on its own: a table of action classes, narrowed by a person's
// settings and never looser than a resource's own verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveOf } from "../src/automation/settings.mjs";
import { ACTION_CLASSES, matrixOf, verdictOf } from "../src/automation/policy.mjs";
import { BOUNDARIES, DECISIONS } from "../src/protected/boundaries.mjs";

const values = (content) => effectiveOf([{ by: "machine", content }]).values;

test("autonomous by default: every class a workflow takes is allow, an owner's is owner, and only two nobody can approve are deny", () => {
  const own = ACTION_CLASSES.filter((c) => !c.boundary);
  assert.deepEqual(own.filter((c) => c.default === "deny").map((c) => c.id), ["execute-generated-script", "secret-read"]);
  assert.ok(own.filter((c) => c.maps.length).every((c) => c.default === "allow"), "a class a workflow step takes itself is never asked of a person");
  for (const c of own.filter((x) => x.default === "deny")) {
    assert.deepEqual(c.maps, []);
    assert.equal(verdictOf(values({}), c.id), "deny");
  }
});

test("the protected boundaries are rows DERIVED from src/protected/: approval where a person approves once, deny for the primary checkout -- and no workflow step maps to one", () => {
  const rows = ACTION_CLASSES.filter((c) => c.boundary);
  assert.deepEqual(rows.map((c) => c.boundary), BOUNDARIES.map((b) => b.id));
  assert.deepEqual(rows.map((c) => c.default), BOUNDARIES.map((b) => (b.decision === DECISIONS.DENY ? "deny" : "approval")));
  assert.ok(rows.every((c) => c.maps.length === 0), "a protected boundary is crossed only as an owner's own approved action");
  assert.equal(verdictOf(values({}), "protected:git-push"), "approval");
  assert.equal(verdictOf(values({}), "protected:primary-checkout-write"), "deny");
});

test("no usage header of a Orbit command offers a never-class", () => {
  const headers = readdirSync("cli").filter((f) => f.endsWith(".mjs")).map((f) => readFileSync(join("cli", f), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
  for (const word of ["push", "merge", "deploy", "--exec", "install-dependency"]) {
    assert.ok(!headers.some((h) => new RegExp(`node \\S*automation\\.mjs[^\\n]*${word}`).test(h)), `the automation CLI documents ${word}`);
  }
});



test("a resource's own deny or approval is never widened by any mode", () => {
  const all = values({});
  assert.equal(verdictOf(all, "dispatch-skill", "deny"), "deny");
  assert.equal(verdictOf(all, "dispatch-skill", "approval"), "approval");
  assert.equal(verdictOf(all, "generate-instruction-skill", "deny"), "deny");
});

test("what a task owner gates is shown as the owner's, and an unknown class is deny", () => {
  assert.equal(verdictOf(values({}), "edit-task-workspace"), "owner");
  assert.equal(verdictOf(values({}), "anything-else"), "deny");
  assert.equal(matrixOf(values({})).length, ACTION_CLASSES.length);
});
