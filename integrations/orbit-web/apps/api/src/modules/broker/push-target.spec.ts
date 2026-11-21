import assert from "node:assert/strict";
import { test } from "node:test";
import { pushRefusal, type ListedBranch } from "./push-target.js";

const LISTED: ListedBranch[] = [
  { name: "main", protected: false },
  { name: "release", protected: true },
  { name: "story-2.7-qsbn-built-plugin-release-rule", protected: false },
];
const refused = (branch: string, defaults: string[] = ["main"]) => pushRefusal(branch, defaults, LISTED)?.code ?? null;

test("a chat pushes to a working branch -- the one it started from too -- after a person approves the exact commit", () => {
  // A chat started from a story branch and committed on it: the story branch is where its work goes.
  assert.equal(refused("story-2.7-qsbn-built-plugin-release-rule"), null);
  assert.equal(refused("orbit-web/4f1c2a9b"), null, "a branch of the chat's own");
});

test("never the default branch, never a protected one, and nothing when the default is not known", () => {
  assert.equal(refused("main"), "default_branch");
  assert.equal(refused("MAIN"), "default_branch", "names compare as Azure DevOps does");
  assert.equal(refused("release"), "protected_branch");
  assert.equal(refused("story-2.7-qsbn-built-plugin-release-rule", []), "default_unknown");
});
