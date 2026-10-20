import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { shownPath } from "../src/shown-path.mjs";

// The store lives outside every checkout, so a run's log and report were printed as `../../../.orbit/…`.
test("a path below where a person stands is relative, and one outside it is whole", () => {
  const cwd = join("/", "work", "app");
  assert.equal(shownPath(join(cwd, "ui-tests", "r.html"), cwd), join("ui-tests", "r.html"));
  assert.equal(shownPath(join("/", "home", "me", ".orbit", "r.html"), cwd), join("/", "home", "me", ".orbit", "r.html"));
  assert.equal(shownPath(cwd, cwd), cwd, "where they stand is named, never an empty string");
});
