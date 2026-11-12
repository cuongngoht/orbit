// ONE MODEL of what a design causes (src/qa/backend/causes.mjs, 0.6.0 Q2), held as properties over the whole corpus of
// designs (test/qa-designs.mjs): the contradiction rules read every design through it, and neither module names a
// family operation or a shape -- what a step does is its effects, what a shape says comes again is its own column.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OPERATIONS } from "../src/adapters/families.mjs";
import { SHAPE_IDS } from "../src/qa/obligations/shapes.mjs";
import { fixtureCaseOf, fixtureNamesIn, fixtureOf, ROOT, saidOf, STACKS } from "./qa-designs.mjs";

const DIR = "qa-contradictions";
const rulesOf = (said) => ({ findings: said.findings.map((f) => f.rule), advice: said.advice.map((f) => f.rule) });

const MODULES = ["causes.mjs", "contradictions.mjs"].map((f) => [f, readFileSync(join(ROOT, "src", "qa", "backend", f), "utf8")]);

test("neither the model nor the rules over it hold a family operation's id or a shape's id, in code or in a comment", () => {
  for (const [f, text] of MODULES) {
    assert.deepEqual(text.match(/orbit\.[a-z]+\.[a-z]+/g) ?? [], [], `${f}: an orbit.<family>.<op> literal`);
    assert.deepEqual(OPERATIONS.map((o) => o.capability).filter((c) => text.includes(c)), [], f);
    assert.deepEqual(SHAPE_IDS.filter((id) => new RegExp(`\\b${id}\\b`).test(text)), [], `${f}: a shape id`);
  }
});

// ── the gaps a review of the 0.5.0 rows found, each a regression fixture (test/fixtures/qa-contradictions/) ───────────
//
// Each fixture says what the rules refuse and say of it on stack A (`expect`), and on another stack where its broker
// declares otherwise (`expectOn`): a false alarm or a missed defect of a future host, fixed by reading the one model.
test("every regression fixture is refused and advised as it says, on each stack", () => {
  const names = fixtureNamesIn(DIR);
  assert.ok(names.length >= 15);
  const off = names.flatMap((name) => STACKS.map((stack) => [name, stack, fixtureOf(DIR, name)])).map(([name, stack, f]) => [`${name} ${stack}`, f.expectOn?.[stack] ?? f.expect, rulesOf(saidOf(fixtureCaseOf(DIR, name, stack)))]).filter(([, want, got]) => JSON.stringify(want) !== JSON.stringify(got));
  assert.deepEqual(off, []);
});
