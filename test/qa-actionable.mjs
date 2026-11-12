// What every generation refusal that requires a criterion must say (0.5.0, ORBIT-QA-001 on the ship): which slot rules
// the step, where the slot it names rules, or that none does -- the candidates the compiler's own functions find
// (src/qa/generation/compile.mjs rulingSaid, whereSaid), within the 240 characters a host reads of a finding
// (src/investigation/loop.mjs findingLine). Shared by the corpora that hold it: the worked designs
// (test/qa-worked-designs.test.mjs) and the reference designs the benchmark's controls send
// (test/qa-accepted-trigger.test.mjs), each with the designs a host gets wrong made from them.

// A refusal of that kind: a step a criterion must rule, a slot nothing rules, a page test with no report to rule, a slot
// nobody accepted, a slot put on a step whose answer does not carry it.
export const REQUIRES_CRITERION = /must rule on it|rules on nothing|nothing in the design rules on it|a page test ends with a report|not an expectation of an ACCEPTED criterion|carries nothing that means|has no answer a verdict can read/;

// What makes it actionable: a candidate with its template, the step a slot rules, the kinds of step it rules -- or none,
// said plainly with what holds instead.
export const ACTIONABLE = /rule it by \S+\/\S+ \([a-z-]+: |\S+\/\S+ \([a-z-]+\) rules step \d|\S+\/\S+ \([a-z-]+\) is carried by a step asking \S|no slot of \S.* states what its answer carries|no answer a step here can ask carries /;

export const HOST_READS = 240;

// The findings of that kind that a host could not act on, as it reads them.
export const unactionable = (findings) => (findings ?? []).filter((f) => REQUIRES_CRITERION.test(f) && !ACTIONABLE.test(String(f).slice(0, HOST_READS)));

const clone = (d) => JSON.parse(JSON.stringify(d));

// The designs a host gets wrong, made from a right one: each assertion dropped, moved to every other step, or named by
// a slot nobody accepted; the closing report dropped; the trigger put on every step.
export function mutationsOf(design) {
  const steps = design.skeleton?.steps?.length ?? 0;
  const assertions = design.assertions ?? [];
  const at = (n) => Array.from({ length: steps }, (_, i) => i + 1).filter((s) => s !== n);
  return [...dropped(design, assertions), ...assertions.flatMap((a, i) => at(a.step).map((step) => withAssertion(design, i, { ...a, step }))), ...assertions.map((a, i) => withAssertion(design, i, { ...a, criterionRef: "NOBODY-1/E1" })), ...lastDropped(design), ...Array.from({ length: steps }, (_, i) => ({ ...clone(design), trigger: { kind: design.trigger?.kind ?? "interface", ref: design.trigger?.ref ?? "x", step: i + 1 } }))];
}

const dropped = (design, assertions) => assertions.map((_, i) => ({ ...clone(design), assertions: assertions.filter((__, j) => j !== i) }));

const withAssertion = (design, i, a) => ({ ...clone(design), assertions: design.assertions.map((x, j) => (j === i ? a : x)) });

function lastDropped(design) {
  const steps = design.skeleton?.steps ?? [];
  return steps.at(-1)?.do === "report" ? [{ ...clone(design), skeleton: { ...design.skeleton, steps: steps.slice(0, -1) }, assertions: (design.assertions ?? []).filter((a) => a.step !== steps.length) }] : [];
}
