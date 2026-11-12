// ONE MODEL of what a design causes (src/qa/backend/causes.mjs, 0.6.0 Q2), held as properties over the whole corpus of
// designs (test/qa-designs.mjs): the contradiction rules read every design through it, and neither module names a
// family operation or a shape -- what a step does is its effects, what a shape says comes again is its own column.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OPERATIONS } from "../src/adapters/families.mjs";
import { SHAPE_IDS } from "../src/qa/obligations/shapes.mjs";
import { ROOT } from "./qa-designs.mjs";

const MODULES = ["causes.mjs", "contradictions.mjs"].map((f) => [f, readFileSync(join(ROOT, "src", "qa", "backend", f), "utf8")]);

test("neither the model nor the rules over it hold a family operation's id or a shape's id, in code or in a comment", () => {
  for (const [f, text] of MODULES) {
    assert.deepEqual(text.match(/orbit\.[a-z]+\.[a-z]+/g) ?? [], [], `${f}: an orbit.<family>.<op> literal`);
    assert.deepEqual(OPERATIONS.map((o) => o.capability).filter((c) => text.includes(c)), [], f);
    assert.deepEqual(SHAPE_IDS.filter((id) => new RegExp(`\\b${id}\\b`).test(text)), [], `${f}: a shape id`);
  }
});
