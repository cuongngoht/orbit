// What a REPAIR may change (doc §4.1, PBI 11): the representation of a test -- a step's locator, a
// wait, the shape of its input -- and never what it rules on. A repaired design keeps every
// assertion exactly (the criterion slot, the template, the step), the controls by role, the
// trigger and the fixture; and what it compiles to keeps the same digests. So "change the test
// until it passes" is refused here by construction, the rule AGENTS.md states for self-healing.
import { canonicalJson } from "../../hash.mjs";

const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const roles = (d) => (d.controls ?? []).map((c) => c.role).sort();

export const KEPT = [
  { id: "ASSERTIONS", kept: (a, b) => same(a.assertions, b.assertions), say: "the assertions -- which accepted slot each step rules on, and with which template" },
  { id: "CONTROLS", kept: (a, b) => same(roles(a), roles(b)), say: "the controls it runs, by role" },
  { id: "TRIGGER", kept: (a, b) => same(a.trigger, b.trigger), say: "what triggers the system, and at which step" },
  { id: "FIXTURE", kept: (a, b) => same(a.fixtureRefs, b.fixtureRefs) && same(a.effectScope, b.effectScope), say: "the fixture it acts on and where it may have effects" },
];

// `compiled` is each design's compileDesign() digests: a repair whose verdicts compile to anything
// else changed what the test means.
export function repairFindings(before, after, compiled = {}) {
  const lost = KEPT.filter((row) => !row.kept(before, after)).map((row) => ({ rule: row.id, say: `a repair changed ${row.say} — it may change only how the test is written` }));
  const moved = same(compiled.before, compiled.after) ? [] : [{ rule: "PREDICATES", say: "a repair changed what a step's verdict compiles to — the oracle is kept, or it is a new design" }];
  return [...lost, ...moved];
}
