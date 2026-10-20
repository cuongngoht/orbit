// Which units a shared file reaches: the nearest one of its name above a unit, in the unit's own
// checkout and ecosystem, and no other. Intelligence and runtime understanding both ask it, so it is
// held here once, over plain records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reachedBy } from "../src/ecosystems/reach.mjs";

const unit = (path, ecosystem = "build") => ({ path, ecosystem, unit: true });
const shared = (path, ecosystem = "build") => ({ path, ecosystem, unit: false, reach: "subtree" });

test("a unit takes the NEAREST shared file of that name above it, and no other", () => {
  const [outer, inner] = [shared("src/Shared.props"), shared("src/legacy/Shared.props")];
  const [a, b] = [unit("src/a/A.proj"), unit("src/legacy/b/B.proj")];
  const records = [outer, inner, a, b];
  assert.deepEqual(reachedBy(records, outer), ["src/a/A.proj"]);
  assert.deepEqual(reachedBy(records, inner), ["src/legacy/b/B.proj"], "the nearer file shadows the one above it");
});

test("files of different names do not compete: a unit is reached by one of each", () => {
  const [props, targets, a] = [shared("src/Shared.props"), shared("src/Shared.targets"), unit("src/a/A.proj")];
  const records = [props, targets, a];
  assert.deepEqual([reachedBy(records, props), reachedBy(records, targets)], [["src/a/A.proj"], ["src/a/A.proj"]]);
});

test("a shared file at the root reaches every unit, and one beside a unit reaches it", () => {
  const [root, near, a, b] = [shared("Shared.props"), shared("src/Shared.props"), unit("src/A.proj"), unit("tools/B.proj")];
  assert.deepEqual(reachedBy([root, a, b], root), ["src/A.proj", "tools/B.proj"]);
  assert.deepEqual(reachedBy([near, a, b], near), ["src/A.proj"], "tools/ is outside its reach");
});

test("a unit of ANOTHER ecosystem is never reached, whatever folder it sits in", () => {
  const [file, mine, theirs] = [shared("backend/Shared.props", "build"), unit("backend/A.proj", "build"), unit("backend/tools/package.json", "scripts")];
  assert.deepEqual(reachedBy([file, mine, theirs], file), ["backend/A.proj"]);
});

test("a shared file in another checkout never reaches into this one", () => {
  const [file, here, there] = [shared("Shared.props"), unit("src/A.proj"), unit("worker::src/B.proj")];
  assert.deepEqual(reachedBy([file, here, there], file), ["src/A.proj"]);
});

test("only a unit is reached: a file that is not buildable is nobody's to inherit", () => {
  const [file, list] = [shared("src/Shared.props"), { ...shared("src/Packages.props"), unit: false }];
  assert.deepEqual(reachedBy([file, list], file), []);
});
