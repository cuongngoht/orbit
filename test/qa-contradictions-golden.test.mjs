// THE GOLDEN SNAPSHOT of what the contradiction rules say (src/qa/backend/contradictions.mjs, 0.6.0 Q2): for every design
// of the corpus (test/qa-designs.mjs) -- the reference designs on both stacks, the playbook's worked designs, every design
// the old benchmark's scripted hosts sent, every regression fixture -- each finding and each piece of advice, by its rule
// and in its words. Taken before the rules were read off one model of what a design causes (src/qa/backend/causes.mjs),
// so that refactor is held to say exactly what the rules said; a change a gap's fix makes is a change of this file, in the
// same commit, entry by entry. Regenerate it only for such a change:
//   node -e 'import("./test/qa-designs.mjs").then((m) => process.stdout.write(JSON.stringify(m.goldenOf(), null, 1) + "\n"))' > test/fixtures/qa-contradictions/golden.json
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { goldenOf, ROOT } from "./qa-designs.mjs";

const GOLDEN = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "qa-contradictions", "golden.json"), "utf8"));

test("every design of the corpus is refused and advised exactly as the golden snapshot says, in its words", () => {
  const now = goldenOf();
  assert.ok(now.checked >= 300, `the whole corpus: ${now.checked}`);
  assert.deepEqual(Object.keys(now.said).sort(), Object.keys(GOLDEN.said).sort(), "the same designs say something");
  for (const [label, said] of Object.entries(GOLDEN.said)) assert.deepEqual(now.said[label], said, label);
  assert.equal(now.checked, GOLDEN.checked, "the same corpus");
});
