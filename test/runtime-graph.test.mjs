// The checkout's COMPONENT GRAPH has ONE definition (src/runtime/graph.mjs): the shape src/orchestration/impact.mjs
// derives a change's reach from, read off what runtime understanding keeps. Every composition root that hands a graph
// in -- a task's verification plan, and since 0.5.0 what a task touches in project context -- asks it, so one checkout
// is never read as two graphs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { impactOf } from "../src/orchestration/impact.mjs";
import { componentGraphOf } from "../src/runtime/graph.mjs";

const COMPONENTS = [
  { key: "web", dir: "web", kind: "web", dependencies: [{ dependsOn: "core", via: "manifest", reference: "core" }, { via: "shared", reference: "tsconfig.base.json" }, { via: "manifest", reference: "a-unit-nothing-read" }] },
  { key: "core", dir: "packages/core", kind: "library", dependencies: [] },
];

test("what understanding read becomes the graph impact.mjs reads: what each component depends on, inherits and cannot resolve", () => {
  const graph = componentGraphOf(COMPONENTS);
  assert.deepEqual(graph.components, [
    { key: "web", dir: "web", kind: "web", live: "browser", dependsOn: ["core"], inherits: ["tsconfig.base.json"], unresolved: ["a-unit-nothing-read"] },
    { key: "core", dir: "packages/core", kind: "library", live: null, dependsOn: [], inherits: [], unresolved: [] },
  ]);
  assert.deepEqual(impactOf(["packages/core/index.mjs"], graph).components.map((c) => [c.key, c.reason]), [["core", "MODIFIED"], ["web", "DEPENDENT"]]);
  assert.deepEqual(componentGraphOf(undefined), { components: [] }, "nothing understood is an empty graph, never a throw");
});

test("every composition root that hands a component graph in asks the one definition, and keeps no mapping of its own", () => {
  for (const root of ["cli/autonomous-engineering.mjs"]) {
    const text = readFileSync(new URL(`../${root}`, import.meta.url), "utf8");
    assert.match(text, /from "\.\.\/src\/runtime\/graph\.mjs"/, `${root} asks src/runtime/graph.mjs`);
    assert.doesNotMatch(text, /via === "shared"|via === "manifest"/, `${root} maps no dependency of its own`);
  }
});
