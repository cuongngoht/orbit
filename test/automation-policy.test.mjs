// What a coordinated workflow may do on its own: a table of action classes, narrowed by a person's
// settings and never looser than a resource's own verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveOf } from "../src/automation/settings.mjs";
import { ACTION_CLASSES, matrixOf, verdictOf } from "../src/automation/policy.mjs";

const values = (content) => effectiveOf([{ by: "machine", content }]).values;

test("the five classes no workflow may ever take are deny whatever a person set, and nothing maps to them", () => {
  const never = ACTION_CLASSES.filter((c) => c.default === "deny");
  assert.deepEqual(never.map((c) => c.id), ["execute-generated-script", "install-dependency", "secrets-or-external-write", "production-mutation", "push-merge-deploy"]);
  for (const c of never) {
    assert.deepEqual(c.maps, []);
    assert.equal(verdictOf(values({}), c.id), "deny");
  }
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
